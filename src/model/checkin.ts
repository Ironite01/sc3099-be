import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestError, NotFoundError } from './error.js';
import { SESSION_STATUS, SessionModel } from './session.js';
import { DeviceModel } from './device.js';
import { EnrollmentModel } from './enrollment.js';
import haversineDistance from '../helpers/haversineDistance.js';
import { MlServices } from '../services/ml/index.js';
import { LivenessChallengeType } from '../services/ml/liveness/check.js';
import { UserModel } from './user.js';
import { isBase64 } from '../helpers/regex.js';
import { DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
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
    latitude: number;
    longitude: number;
    distance_from_venue_meters: number;
    liveness_passed: boolean;
    liveness_score: number | null;
    risk_score: number | null;
    risk_factors: Record<string, any>[];
};

export type SessionCheckinRecord = {
    id: string;
    student_id: string;
    student_name: string;
    student_email: string;
    status: CHECKIN_STATUS;
    timestamp: Date;
    checked_in_at: Date;
    latitude: number;
    longitude: number;
    distance_from_venue_meters: number;
    liveness_passed: boolean;
    liveness_score: number | null;
    risk_score: number | null;
    risk_factors: Record<string, any>[];
};

export type StudentCheckinRecord = {
    id: string;
    session_id: string;
    session_name: string;
    course_id: string;
    course_code: string;
    course_name: string;
    status: CHECKIN_STATUS;
    checked_in_at: Date;
    risk_score: number | null;
};

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
        const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response = null, liveness_challenge_type = LivenessChallengeType.PASSIVE, qr_code, ipAddr, userAgent } = payload;

        return await transact(async (pgClient) => {
            const device = await DeviceModel.getByFingerprint(pgClient, studentId, device_fingerprint);
            if (!device || !device.is_active || device.revoked_at) {
                throw new BadRequestError('Device is not allowed for check-in');
            }
            const session = await SessionModel.getById(pgClient, session_id);
            if (!session) {
                throw new BadRequestError('Session not found');
            }
            if (session.status !== SESSION_STATUS.ACTIVE || session.checkin_closes_at < new Date()) {
                throw new BadRequestError('Session not active');
            }

            let enrollment = null;
            try {
                enrollment = await EnrollmentModel.getEnrollmentByStudentIdAndCourseId(pgClient, studentId, session.course_id);
            } catch (err: any) {
                if (err instanceof NotFoundError) {
                    throw new BadRequestError('Student is not enrolled in this course');
                }
                throw err;
            }
            if (!enrollment) {
                throw new BadRequestError('Student is not enrolled in this course');
            }

            const now = new Date();
            if (now < new Date(session.checkin_opens_at) || now > new Date(session.checkin_closes_at)) {
                throw new BadRequestError('Check-in window closed');
            }

            const venueLat = session.venue_latitude;
            const venueLon = session.venue_longitude;
            if (!venueLat || !venueLon) {
                throw new BadRequestError('Session does not have a valid venue location');
            }

            const geofenceRadius = session.geofence_radius_meters || DEFAULT_GEOFENCE_RADIUS_METERS;
            const diffDist = haversineDistance(latitude, longitude, venueLat, venueLon);

            const user = await UserModel.getById(pgClient, studentId);
            if (!user || !user.is_active || !user.face_embedding_hash) {
                throw new BadRequestError('Unable to perform face verification for user');
            }

            const requireQr = Boolean(session.qr_code_secret);
            if (requireQr) {
                if (!qr_code || typeof qr_code !== 'string') {
                    throw new BadRequestError('QR code is required for this session');
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

            const requireLiveness = session.require_liveness_check !== false;
            if (requireLiveness && (!liveness_challenge_response || !isBase64(liveness_challenge_response))) {
                throw new BadRequestError('Liveness challenge response is required and must be a valid base64 string');
            }

            const requireFaceMatch = session.require_face_match !== false;
            if (requireFaceMatch && (!liveness_challenge_response || !isBase64(liveness_challenge_response))) {
                throw new BadRequestError('Face image is required and must be a valid base64 string');
            }

            let status = CHECKIN_STATUS.PENDING;
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

            const riskFactors: { type: string; weight: number }[] = [];
            const u = {
                ...(livenessScore !== null ? { liveness_score: livenessScore } : {}),
                ...(matchScore !== null ? { face_match_score: matchScore } : {}),
                device_signature: device.device_fingerprint,
                device_public_key: device.public_key,
                ip_address: ipAddr,
                geolocation: {
                    latitude,
                    longitude,
                    accuracy: location_accuracy_meters
                }
            };
            const {
                risk_score, pass_threshold, signal_breakdown, recommendations
            } = await MlServices.risk.assess.post(userAgent ? {
                ...u,
                user_agent: userAgent
            } : u);
            const signalBreakdown = typeof signal_breakdown === 'object' ? signal_breakdown : JSON.parse(signal_breakdown);
            for (const [key, value] of Object.entries(signalBreakdown)) {
                riskFactors.push({
                    type: key,
                    weight: Number(value)
                });
            }

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
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19
            )
            RETURNING id, session_id, student_id, status, checked_in_at,
                      latitude, longitude, distance_from_venue_meters,
                      liveness_passed, liveness_score, risk_score, risk_factors`,
                    [
                        uuidv4(),
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

                await DeviceModel.updateAfterCheckin(pgClient, device.id, getRiskLevel(risk_score));

                return { ...rows[0], recommendations } as (Checkin & { recommendations?: string[] });
            } catch (err: any) {
                if (err.code === '23505') {
                    throw new BadRequestError('Student has already checked in for this session');
                }
                throw err;
            }
        });
    },
    listByStudent: async function listByStudent(
        pgClient: PoolClient,
        studentId: string,
        filters: { course_id?: string; limit?: number }
    ): Promise<StudentCheckinRecord[]> {
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
                    s.course_id,
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

        return rows as (StudentCheckinRecord[] & { recommendations?: string[] });
    },

    listBySession: async function listBySession(
        pgClient: PoolClient,
        sessionId: string
    ): Promise<SessionCheckinRecord[]> {
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
                    c.risk_factors
             FROM checkins c
             INNER JOIN users u ON u.id = c.student_id
             WHERE c.session_id = $1
             ORDER BY c.checked_in_at DESC`,
            [sessionId]
        );

        return rows.map((row) => {
            const normalizedRiskFactors = Array.isArray(row.risk_factors)
                ? row.risk_factors
                : row.risk_factors && typeof row.risk_factors === 'object'
                    ? [row.risk_factors]
                    : [];

            return {
                ...row,
                risk_factors: normalizedRiskFactors
            } as SessionCheckinRecord;
        });
    },

    getBySessionAndStudent: async function getBySessionAndStudent(
        pgClient: PoolClient,
        sessionId: string,
        studentId: string
    ): Promise<Checkin | null> {
        const { rows } = await pgClient.query(
            `SELECT id, session_id, student_id, status, checked_in_at, latitude, longitude,
                    distance_from_venue_meters, liveness_passed, liveness_score, risk_score, risk_factors
             FROM checkins
             WHERE session_id = $1 AND student_id = $2
             ORDER BY checked_in_at DESC
             LIMIT 1`,
            [sessionId, studentId]
        );
        return (rows[0] as Checkin) || null;
    }
};
