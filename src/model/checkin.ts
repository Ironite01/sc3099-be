import type { PoolClient } from 'pg';
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from './error.js';
import { SESSION_STATUS, SessionModel } from './session.js';
import { DeviceModel } from './device.js';
import { EnrollmentModel } from './enrollment.js';
import haversineDistance from '../helpers/haversineDistance.js';
import { MlServices } from '../services/ml/index.js';
import { LivenessChallengeType } from '../services/ml/liveness/check.js';
import { USER_ROLE_TYPES, UserModel } from './user.js';
import { isBase64 } from '../helpers/regex.js';
import { APPEAL_WINDOW_MS, DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
import { parseQrPayload, secureEqualsHex, signQrPayload } from '../helpers/qr.js';
import getRiskLevel from '../helpers/getRiskLevels.js';

export enum CHECKIN_STATUS {
    PENDING = 'pending',
    APPROVED = 'approved',
    FLAGGED = 'flagged',
    REJECTED = 'rejected',
    APPEALED = 'appealed'
}

export type Checkin = {
    id: string;
    session_id: string;
    student_id: string;
    status: CHECKIN_STATUS;
    checked_in_at: Date;
    reviewed_at?: Date | null;
    reviewed_notes?: string | null;
    reviewed_by_id?: string | null;
    qr_code_verified: boolean;
    latitude: number;
    longitude: number;
    location_accuracy_meters: number;
    verified_at: Date | null;
    distance_from_venue_meters: number;
    liveness_passed: boolean;
    liveness_score: number | null;
    liveness_challenge_type: LivenessChallengeType | null;
    risk_score: number | null;
    risk_factors: Record<string, any>[];
    risk_signals?: RiskSignal[];
    appealed_at?: string | null;
    appeal_reason?: string | null;
    face_embedding_hash?: string | null;
    face_match_score?: number | null;
    face_match_passed?: boolean | null;
};

export type RiskSignal = {
    id: string;
    checkin_id: string;
    signal_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    details: Record<string, any> | null;
    weight: number;
    detected_at: Date;
};

function normalizeRiskFactors(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
}

function getSignalSeverity(weight: number): RiskSignal['severity'] {
    const normalizedWeight = Math.abs(weight);
    if (normalizedWeight >= 0.5) {
        return 'critical';
    }
    if (normalizedWeight >= 0.3) {
        return 'high';
    }
    if (normalizedWeight >= 0.1) {
        return 'medium';
    }
    return 'low';
}

function buildRiskSignals(
    signalBreakdown: Record<string, number>,
    detectedAt: Date,
    recommendations: string[]
): Omit<RiskSignal, 'id' | 'checkin_id'>[] {
    return Object.entries(signalBreakdown).map(([signalType, rawWeight]) => {
        const weight = Number(rawWeight) || 0;
        return {
            signal_type: signalType,
            severity: getSignalSeverity(weight),
            confidence: 1,
            details: recommendations.length ? { recommendations } : null,
            weight,
            detected_at: detectedAt
        };
    });
}

async function insertRiskSignals(
    pgClient: PoolClient,
    checkinId: string,
    signals: Omit<RiskSignal, 'id' | 'checkin_id'>[]
): Promise<RiskSignal[]> {
    if (!signals.length) {
        return [];
    }

    const values: any[] = [];
    const placeholders = signals.map((signal, index) => {
        const baseIndex = index * 7;
        values.push(
            checkinId,
            signal.signal_type,
            signal.severity,
            signal.confidence,
            signal.details ? JSON.stringify(signal.details) : null,
            signal.weight,
            signal.detected_at
        );
        return `(gen_random_uuid()::text, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}::jsonb, $${baseIndex + 6}, $${baseIndex + 7})`;
    });

    const { rows } = await pgClient.query(
        `INSERT INTO risk_signals (
            id,
            checkin_id,
            signal_type,
            severity,
            confidence,
            details,
            weight,
            detected_at
        ) VALUES ${placeholders.join(', ')}
        RETURNING id, checkin_id, signal_type, severity, confidence, details, weight, detected_at`,
        values
    );

    return rows as RiskSignal[];
}

async function getRiskSignalsByCheckinIds(pgClient: PoolClient, checkinIds: string[]): Promise<Map<string, RiskSignal[]>> {
    const signalMap = new Map<string, RiskSignal[]>();
    if (!checkinIds.length) {
        return signalMap;
    }

    const { rows } = await pgClient.query(
        `SELECT id, checkin_id, signal_type, severity, confidence, details, weight, detected_at
         FROM risk_signals
         WHERE checkin_id = ANY($1::text[])
         ORDER BY detected_at ASC, id ASC`,
        [checkinIds]
    );

    for (const row of rows as RiskSignal[]) {
        const existing = signalMap.get(row.checkin_id) || [];
        existing.push(row);
        signalMap.set(row.checkin_id, existing);
    }

    return signalMap;
}

export const CheckinModel = {
    create: async function create(
        transact: (fn: (pgClient: PoolClient) => Promise<any>) => Promise<any>,
        studentId: string,
        payload: {
            ipAddr: string;
            userAgent?: string;
            session_id: string;
            latitude: number;
            longitude: number;
            location_accuracy_meters: number;
            device_fingerprint: string;
            liveness_challenge_response?: any;
            liveness_challenge_type?: LivenessChallengeType;
            qr_code?: string;
        }
    ) {
        try {
            const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response = null, liveness_challenge_type = LivenessChallengeType.PASSIVE, qr_code, ipAddr, userAgent } = payload;
            return await transact(async (pgClient) => {
                // 1. Validate device
                const device = await DeviceModel.getByFingerprint(pgClient, studentId, device_fingerprint);
                if (!device || !device.is_active || device.revoked_at) {
                    throw new BadRequestError('Device is not allowed for check-in');
                }
                // 2. Validate session
                const session = await SessionModel.getById(pgClient, session_id);
                if (!session) {
                    throw new BadRequestError('Session not found');
                }
                const now = new Date();
                if (session.status !== SESSION_STATUS.ACTIVE || session.checkin_closes_at < now) {
                    throw new BadRequestError('Session not active');
                }
                if (now < new Date(session.checkin_opens_at) || now > new Date(session.checkin_closes_at)) {
                    throw new BadRequestError('Check-in window closed');
                }

                // 3. Validate QR code
                const requireQr = Boolean(session.qr_code_enabled);
                if (requireQr) {
                    if (!qr_code || typeof qr_code !== 'string') {
                        throw new BadRequestError('QR code is required for this session');
                    }

                    if (!session.qr_code_secret) {
                        throw new BadRequestError('QR code is not available for this session');
                    }

                    const parsedQr = parseQrPayload(qr_code);
                    if (!parsedQr || parsedQr.sessionId !== session_id || !Number.isFinite(parsedQr.exp)) {
                        throw new BadRequestError('Invalid QR code');
                    }

                    const sessionQrExpiresAt = session.qr_code_expires_at ? new Date(session.qr_code_expires_at).getTime() : null;
                    if (Date.now() > parsedQr.exp || (sessionQrExpiresAt && Date.now() > sessionQrExpiresAt)) {
                        throw new BadRequestError('QR code expired');
                    }

                    const expectedSig = signQrPayload(session_id, parsedQr.exp, session.qr_code_secret!);
                    if (!secureEqualsHex(parsedQr.sig, expectedSig)) {
                        throw new BadRequestError('Invalid QR code');
                    }
                }

                // 4. Validate enrollment
                const enrollment = await EnrollmentModel.getEnrollmentByStudentIdAndCourseId(pgClient, studentId, session.course_id);
                if (!enrollment) {
                    throw new BadRequestError('Student is not enrolled in this course');
                }

                // 5. Geofencing
                const venueLat = session.venue_latitude;
                const venueLon = session.venue_longitude;
                if (!venueLat || !venueLon) {
                    throw new BadRequestError('Session does not have a valid venue location');
                }

                const geofenceRadius = session.geofence_radius_meters || DEFAULT_GEOFENCE_RADIUS_METERS;
                const diffDist = haversineDistance(latitude, longitude, venueLat, venueLon);

                // 6. Liveness check and face verification
                const user = await UserModel.getById(pgClient, studentId);
                if (!user || !user.is_active || !user.face_embedding_hash) {
                    throw new BadRequestError('Unable to perform face verification for user');
                }

                let status = CHECKIN_STATUS.PENDING;
                const requireLiveness = session.require_liveness_check !== false;
                if (requireLiveness && (!liveness_challenge_response || !isBase64(liveness_challenge_response))) {
                    throw new BadRequestError('Liveness challenge response is required and must be a valid base64 string');
                }

                const requireFaceMatch = session.require_face_match !== false;
                if (requireFaceMatch && (!liveness_challenge_response || !isBase64(liveness_challenge_response))) {
                    throw new BadRequestError('Face image is required and must be a valid base64 string');
                }

                let livenessPassed = true;
                let livenessScore: number | null = null;
                let faceEmbeddingHash: string | null = null;

                if (requireLiveness) {
                    let livenessResult;
                    try {
                        livenessResult = await MlServices.liveness.check.post({
                            challenge_response: liveness_challenge_response,
                            challenge_type: liveness_challenge_type
                        });
                    } catch (err: any) {
                        const msg = String(err?.message || 'Failed to check liveness.');
                        if (/^ML 4\d\d:/.test(msg)) {
                            throw new BadRequestError(msg.replace(/^ML \d{3}:\s*/, ''));
                        }
                        throw err;
                    }
                    livenessPassed = Boolean(livenessResult.liveness_passed);
                    livenessScore = livenessResult.liveness_score;
                    faceEmbeddingHash = livenessResult.face_embedding_hash;
                }

                let matchPassed = true;
                let matchScore: number | null = null;
                if (requireFaceMatch) {
                    let faceResult;
                    try {
                        faceResult = await MlServices.face.verify.post({
                            image: liveness_challenge_response,
                            reference_template_hash: user.face_embedding_hash
                        });
                    } catch (err: any) {
                        const msg = String(err?.message || 'Failed to verify face.');
                        if (/^ML 4\d\d:/.test(msg)) {
                            throw new BadRequestError(msg.replace(/^ML \d{3}:\s*/, ''));
                        }
                        throw err;
                    }
                    matchPassed = Boolean(faceResult.match_passed);
                    matchScore = faceResult.match_score;
                }

                // 7. Risk assessment
                const riskFactors: { type: string; weight: number; severity: RiskSignal['severity']; confidence: number }[] = [];
                const {
                    risk_score, pass_threshold, signal_breakdown, recommendations
                } = await MlServices.risk.assess.post({
                    ...(livenessScore !== null ? { liveness_score: livenessScore } : {}),
                    ...(matchScore !== null ? { face_match_score: matchScore } : {}),
                    ...(userAgent ? { user_agent: userAgent } : {}),
                    device_signature: device.device_fingerprint,
                    device_public_key: device.public_key,
                    ip_address: ipAddr,
                    geolocation: {
                        latitude,
                        longitude,
                        accuracy: location_accuracy_meters
                    }
                });
                const signalBreakdown = typeof signal_breakdown === 'object' ? signal_breakdown : JSON.parse(signal_breakdown);
                for (const [key, value] of Object.entries(signalBreakdown)) {
                    const weight = Number(value) || 0;
                    riskFactors.push({
                        type: key,
                        weight,
                        severity: getSignalSeverity(weight),
                        confidence: 1
                    });
                }
                const riskSignals = buildRiskSignals(signalBreakdown, now, recommendations || []);

                if ((requireLiveness && !livenessPassed) || diffDist > geofenceRadius * 2) {
                    status = CHECKIN_STATUS.REJECTED;
                } else if (!Boolean(pass_threshold)) {
                    status = CHECKIN_STATUS.FLAGGED;
                } else {
                    status = CHECKIN_STATUS.APPROVED;
                }

                try {
                    const { rows } = await pgClient.query(
                        `INSERT INTO checkins (
                id, session_id, device_id, student_id, status, checked_in_at,
                latitude, longitude, distance_from_venue_meters,
                liveness_passed, liveness_score, risk_score, risk_factors,
                location_accuracy_meters, liveness_challenge_type,
                face_match_passed, face_match_score, face_embedding_hash, qr_code_verified
            ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18
            )
            RETURNING id, session_id, student_id, status, checked_in_at,
                      latitude, longitude, distance_from_venue_meters,
                      liveness_passed, liveness_score, risk_score, risk_factors`,
                        [
                            session_id,
                            device.id,
                            studentId,
                            status,
                            now,
                            latitude,
                            longitude,
                            diffDist,
                            livenessPassed,
                            livenessScore,
                            risk_score,
                            JSON.stringify(riskFactors),
                            location_accuracy_meters,
                            liveness_challenge_type,
                            matchPassed,
                            matchScore,
                            faceEmbeddingHash,
                            requireQr
                        ]
                    );

                    // 8. Update relevant records after check in
                    const persistedRiskSignals = await insertRiskSignals(pgClient, rows[0].id as string, riskSignals);

                    await DeviceModel.updateAfterCheckin(pgClient, device.id, getRiskLevel(risk_score));

                    return {
                        ...rows[0],
                        recommendations,
                        risk_signals: persistedRiskSignals
                    } as (Checkin & { recommendations?: string[] });
                } catch (err: any) {
                    if (err.code === '23505') {
                        throw new BadRequestError('Student has already checked in for this session');
                    }
                    throw err;
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFilteredCheckins: async (pgClient: PoolClient, user: { sub: string; role: USER_ROLE_TYPES }, data: {
        session_id?: string;
        course_id?: string;
        student_id?: string;
        status?: CHECKIN_STATUS[];
        min_risk_score?: number;
        max_risk_score?: number;
        start_date?: string;
        end_date?: string;
        limit?: number;
        offset?: number;
    }) => {
        try {
            let {
                session_id,
                course_id,
                student_id,
                status,
                min_risk_score,
                max_risk_score,
                start_date,
                end_date,
                limit = 50,
                offset = 0
            } = data;

            const params: any[] = [];
            const where: string[] = [];

            // Instructors only can see checkins related to their courses
            // They should see checkins for all sessions in their courses
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                params.push(user.sub);
                where.push(`c.instructor_id = $${params.length}`);
            } else if (user.role === USER_ROLE_TYPES.TA) {
                params.push(user.sub);
                where.push(`s.instructor_id = $${params.length}`);
            }

            if (session_id) {
                params.push(session_id);
                where.push(`ci.session_id = $${params.length}`);
            }
            if (course_id) {
                params.push(course_id);
                where.push(`s.course_id = $${params.length}`);
            }
            if (student_id) {
                params.push(student_id);
                where.push(`ci.student_id = $${params.length}`);
            }
            if (status && status.length > 0) {
                params.push(status);
                where.push(`ci.status = ANY($${params.length}::text[])`);
            }
            if (min_risk_score !== undefined) {
                params.push(min_risk_score);
                where.push(`ci.risk_score >= $${params.length}`);
            }
            if (max_risk_score !== undefined) {
                params.push(max_risk_score);
                where.push(`ci.risk_score <= $${params.length}`);
            }
            if (start_date) {
                params.push(start_date);
                where.push(`ci.checked_in_at >= $${params.length}`);
            }
            if (end_date) {
                params.push(end_date);
                where.push(`ci.checked_in_at <= $${params.length}`);
            }

            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const countResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 ${whereClause}`,
                params
            );

            params.push(limit, offset);
            const { rows } = await pgClient.query(
                `SELECT ci.id,
                        ci.session_id,
                        s.name AS session_name,
                        ci.student_id,
                        u.full_name AS student_name,
                        u.email AS student_email,
                        ci.status,
                        TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                        ci.distance_from_venue_meters,
                        ci.risk_score,
                        ci.risk_factors,
                           ci.liveness_passed,
                        ci.appealed_at,
                        ci.appeal_reason
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 JOIN users u ON u.id = ci.student_id
                 ${whereClause}
                 ORDER BY ci.checked_in_at DESC
                 LIMIT $${params.length - 1}
                 OFFSET $${params.length}`,
                params
            );

            const signalMap = await getRiskSignalsByCheckinIds(pgClient, rows.map((row) => row.id as string));
            const items = rows.map((row) => ({
                ...row,
                risk_factors: normalizeRiskFactors(row.risk_factors),
                risk_signals: signalMap.get(row.id as string) || []
            }));

            return {
                items: items as (Checkin & { session_name: string; student_name: string; student_email: string })[],
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFilteredCheckinsByStudentId: async (pgClient: PoolClient, studentId: string, filters: { limit?: number; course_id?: string }) => {
        try {
            if (!studentId) {
                throw new UnauthorizedError();
            }

            const { course_id, limit = 50 } = filters;
            const params: any[] = [studentId];
            let where = 'WHERE ci.student_id = $1';

            if (course_id) {
                params.push(course_id);
                where += ` AND s.course_id = $${params.length}`;
            }

            params.push(Math.max(1, Math.min(limit, 200)));

            const { rows } = await pgClient.query(
                `SELECT ci.id,
                    ci.session_id,
                    s.name AS session_name,
                    s.course_id as course_id,
                    c.code AS course_code,
                    c.name AS course_name,
                    ci.status,
                    TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                    ci.risk_score
             FROM checkins ci
             JOIN sessions s ON s.id = ci.session_id
             JOIN courses c ON c.id = s.course_id
             ${where}
             ORDER BY ci.checked_in_at DESC
             LIMIT $${params.length}`,
                params
            );

            return rows as (Partial<Checkin> & { session_name: string; course_id: string; course_code: string; course_name: string })[];

        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByIdAndUser: async (pgClient: PoolClient, user: { sub: string, role: USER_ROLE_TYPES }, checkin_id: string) => {
        try {
            const role = user.role as USER_ROLE_TYPES;
            const userId = user.sub as string;

            let query = `SELECT ci.id, ci.session_id, ci.student_id, ci.status,
                        TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                        ci.latitude, ci.longitude, ci.distance_from_venue_meters,
                        ci.liveness_passed, ci.liveness_score, ci.risk_score, ci.risk_factors,
                        s.course_id, s.name AS session_name,
                        c.code AS course_code, c.name AS course_name, ci.appealed_at,
                        u.full_name AS student_name, u.email AS student_email
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 JOIN users u ON u.id = ci.student_id
                 WHERE ci.id = $1`;
            let params = [checkin_id];

            switch (role) {
                case USER_ROLE_TYPES.STUDENT:
                    query += ` AND ci.student_id = $2`;
                    params.push(userId);
                    break;
                case USER_ROLE_TYPES.INSTRUCTOR:
                    query += ` AND c.instructor_id = $2`;
                    params.push(userId);
                    break;
                case USER_ROLE_TYPES.TA:
                    query += ` AND s.instructor_id = $2`;
                    params.push(userId);
                    break;
                case USER_ROLE_TYPES.ADMIN:
                    // Do nothing...
                    break;
                default:
                    throw new UnauthorizedError();
            }

            const { rows } = await pgClient.query(query, params);

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            const result = rows[0] as (Checkin & {
                session_name: string;
                course_id: string;
                course_code: string;
                course_name: string;
                student_name: string;
                student_email: string;
            });
            const signalMap = await getRiskSignalsByCheckinIds(pgClient, [result.id]);
            result.risk_factors = normalizeRiskFactors(result.risk_factors);
            result.risk_signals = signalMap.get(result.id) || [];
            return result;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getBySessionIdAndUser: async (pgClient: PoolClient, user: { sub: string, role: USER_ROLE_TYPES }, sessionId: string) => {
        try {
            const { rows } = await pgClient.query(
                `SELECT c.id,
                    c.student_id,
                    u.full_name AS student_name,
                    u.email AS student_email,
                    c.status,
                    TO_CHAR(c.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS timestamp,
                    TO_CHAR(c.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                    c.latitude,
                    c.longitude,
                    c.distance_from_venue_meters,
                    c.liveness_passed,
                    c.liveness_score,
                    c.risk_score,
                    c.risk_factors,
                    d.is_trusted as device_is_trusted
             FROM checkins c
             INNER JOIN users u ON u.id = c.student_id
             INNER JOIN sessions s ON s.id = c.session_id
             INNER JOIN devices d on d.id = c.device_id
             WHERE c.session_id = $1 ${user.role !== USER_ROLE_TYPES.ADMIN ? ' AND s.instructor_id = $2' : ''}
             ORDER BY c.checked_in_at DESC`,
                user.role !== USER_ROLE_TYPES.ADMIN ? [sessionId, user.sub] : [sessionId]
            );

            const signalMap = await getRiskSignalsByCheckinIds(pgClient, rows.map((row) => row.id as string));
            return rows.map((row) => ({
                ...row,
                risk_factors: normalizeRiskFactors(row.risk_factors),
                risk_signals: signalMap.get(row.id as string) || []
            }));
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    appeal: async (pgClient: PoolClient, studentId: string, checkinId: string, appeal_reason: string) => {
        try {
            const currentCheckin = await CheckinModel.getByIdAndUser(pgClient, { sub: studentId, role: USER_ROLE_TYPES.STUDENT }, checkinId);
            if (!currentCheckin) {
                throw new NotFoundError();
            }

            if (![CHECKIN_STATUS.REJECTED, CHECKIN_STATUS.FLAGGED].includes(currentCheckin.status)) {
                throw new BadRequestError('Only rejected or flagged check-ins can be appealed');
            }

            if (currentCheckin.appealed_at) {
                throw new BadRequestError('Check-in has already been appealed');
            }

            const checkedInAt = new Date(currentCheckin.checked_in_at).getTime();
            if (Date.now() - checkedInAt > APPEAL_WINDOW_MS) {
                throw new BadRequestError('Appeal window has expired');
            }

            const { rows } = await pgClient.query(
                `UPDATE checkins
                 SET status = $4, appeal_reason = $3, appealed_at = NOW()
                 WHERE id = $1 AND student_id = $2
                 RETURNING id, status, appeal_reason, appealed_at`,
                [checkinId, studentId, appeal_reason, CHECKIN_STATUS.APPEALED]
            );

            const updated = rows[0] as Partial<Checkin>;

            return {
                id: updated.id,
                status: updated.status,
                appeal_reason: updated.appeal_reason,
                appealed_at: updated.appealed_at
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    review: async (pgClient: PoolClient, id: string, { user, status, notes }: { user: { sub: string, role: USER_ROLE_TYPES }, status: CHECKIN_STATUS, notes?: string }) => {
        try {
            const currentCheckin = await CheckinModel.getByIdAndUser(pgClient, user, id);
            if (!currentCheckin) {
                throw new NotFoundError();
            }
            if (![CHECKIN_STATUS.FLAGGED, CHECKIN_STATUS.APPEALED].includes(currentCheckin.status)) {
                throw new BadRequestError('Only flagged or appealed check-ins can be reviewed');
            }

            await pgClient.query(
                `UPDATE checkins
                 SET status = $2, reviewed_by_id = $3, reviewed_at = NOW(), review_notes = $4
                 WHERE id = $1`,
                [id, status, user.sub, notes ?? null]
            );

            return {
                id,
                status,
                reviewed_by_id: user.sub,
                reviewed_at: new Date().toISOString(),
                review_notes: notes ?? null
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
};
