import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from './error.js';
import { SESSION_STATUS, SessionModel } from './session.js';
import { DeviceModel, TRUST_SCORE_TYPES } from './device.js';
import { EnrollmentModel } from './enrollment.js';
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';
import haversineDistance from '../helpers/haversineDistance.js';
import { MlServices } from '../services/ml/index.js';
import { LivenessChallengeType } from '../services/ml/liveness/check.js';
import { USER_ROLE_TYPES, UserModel } from './user.js';
import { isBase64 } from '../helpers/regex.js';
import { APPEAL_WINDOW_MS, DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
import { parseQrPayload, secureEqualsHex, signQrPayload } from '../helpers/qr.js';
import getRiskLevel from '../helpers/getRiskLevels.js';
import { buildRiskSignals, getSignalSeverity, normalizeRiskFactors, RiskSignalModel, type RiskSignal } from './riskSignals.js';

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

export const CheckinModel = {
    create: async (prisma: PrismaClient, studentId: string, payload: {
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
    }) => {
        try {
            const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response = null, liveness_challenge_type = LivenessChallengeType.PASSIVE, qr_code, ipAddr, userAgent } = payload;
            return await prisma.$transaction(async (tx) => {
                // 1. Validate device
                const device = await DeviceModel.getByFingerprintAndUserId(tx as any, studentId, device_fingerprint);
                if (!device || !device.is_active || device.revoked_at) {
                    throw new BadRequestError('Device is not allowed for check-in');
                }
                // 2. Validate session
                const session = await SessionModel.getById(tx as any, session_id);
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
                const enrollment = await EnrollmentModel.getEnrollmentByStudentIdAndCourseId(tx as any, studentId, session.course_id);
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
                const user = await UserModel.getById(tx as any, studentId);
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
                    const checkin = await tx.checkins.create({
                        data: {
                            id: randomUUID(),
                            session_id: session_id,
                            device_id: device.id,
                            student_id: studentId,
                            status: status,
                            checked_in_at: now,
                            latitude: latitude,
                            longitude: longitude,
                            distance_from_venue_meters: diffDist,
                            liveness_passed: livenessPassed,
                            liveness_score: livenessScore,
                            risk_score: risk_score,
                            risk_factors: JSON.stringify(riskFactors),
                            location_accuracy_meters: location_accuracy_meters,
                            liveness_challenge_type: liveness_challenge_type,
                            face_match_passed: matchPassed,
                            face_match_score: matchScore,
                            face_embedding_hash: faceEmbeddingHash,
                            qr_code_verified: requireQr
                        },
                        select: {
                            id: true,
                            session_id: true,
                            student_id: true,
                            status: true,
                            checked_in_at: true,
                            latitude: true,
                            longitude: true,
                            distance_from_venue_meters: true,
                            liveness_passed: true,
                            liveness_score: true,
                            risk_score: true,
                            risk_factors: true
                        }
                    });

                    // 8. Update relevant records after check in
                    const persistedRiskSignals = await RiskSignalModel.insertRiskSignals(tx as any, checkin.id, riskSignals);

                    await DeviceModel.updateAfterCheckin(tx as any, device.id, getRiskLevel(risk_score) as TRUST_SCORE_TYPES);

                    return {
                        ...checkin,
                        recommendations,
                        risk_signals: persistedRiskSignals
                    } as any;
                } catch (err: any) {
                    if (err.code === PrismaCodeMap.CONFLICT) {
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
    getFilteredCheckins: async (prisma: PrismaClient, user: { sub: string; role: USER_ROLE_TYPES }, data: {
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

            const where: any = {};

            // Instructors only can see checkins related to their courses
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                where.sessions = {
                    courses: {
                        instructor_id: user.sub
                    }
                };
            } else if (user.role === USER_ROLE_TYPES.TA) {
                where.sessions = {
                    instructor_id: user.sub
                };
            }

            if (session_id) where.session_id = session_id;
            if (course_id) where.sessions = { ...where.sessions, course_id };
            if (student_id) where.student_id = student_id;
            if (status && status.length > 0) where.status = { in: status };
            if (min_risk_score !== undefined) where.risk_score = { ...where.risk_score, gte: min_risk_score };
            if (max_risk_score !== undefined) where.risk_score = { ...where.risk_score, lte: max_risk_score };
            if (start_date) where.checked_in_at = { ...where.checked_in_at, gte: new Date(start_date) };
            if (end_date) where.checked_in_at = { ...where.checked_in_at, lte: new Date(end_date) };

            const [total, checkins] = await Promise.all([
                prisma.checkins.count({ where }),
                prisma.checkins.findMany({
                    where,
                    select: {
                        id: true,
                        session_id: true,
                        sessions: { select: { name: true, actual_start: true, course_id: true, courses: { select: { code: true } } } },
                        student_id: true,
                        users_checkins_student_idTousers: { select: { full_name: true, email: true } },
                        status: true,
                        checked_in_at: true,
                        distance_from_venue_meters: true,
                        risk_score: true,
                        risk_factors: true,
                        liveness_passed: true,
                        appealed_at: true,
                        appeal_reason: true
                    },
                    orderBy: { checked_in_at: 'desc' },
                    take: limit,
                    skip: offset
                })
            ]);

            const signalMap = await RiskSignalModel.getRiskSignalsByCheckinIds(prisma, checkins.map(c => c.id));
            const items: any = checkins.map(c => ({
                id: c.id,
                session_id: c.session_id,
                session_name: c.sessions?.name,
                session_date: c.sessions?.actual_start,
                course_id: c.sessions?.course_id,
                course_code: c.sessions?.courses?.code,
                student_id: c.student_id,
                student_name: c.users_checkins_student_idTousers?.full_name,
                student_email: c.users_checkins_student_idTousers?.email,
                status: c.status,
                checked_in_at: c.checked_in_at,
                distance_from_venue_meters: c.distance_from_venue_meters,
                risk_score: c.risk_score,
                risk_factors: normalizeRiskFactors(c.risk_factors),
                liveness_passed: c.liveness_passed,
                appealed_at: c.appealed_at,
                appeal_reason: c.appeal_reason,
                risk_signals: signalMap.get(c.id) || []
            }));
            delete items.sessions;
            delete items.users_checkins_student_idTousers;

            return {
                items,
                total,
                limit,
                offset
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFilteredCheckinsByStudentId: async (prisma: PrismaClient, studentId: string, filters: { limit?: number; course_id?: string }) => {
        try {
            if (!studentId) {
                throw new UnauthorizedError();
            }

            const { course_id, limit = 50 } = filters;
            const where: any = { student_id: studentId };
            if (course_id) where.sessions = { course_id };

            const checkins = await prisma.checkins.findMany({
                where,
                select: {
                    id: true,
                    session_id: true,
                    sessions: { select: { name: true, course_id: true, courses: { select: { code: true, name: true } } } },
                    status: true,
                    checked_in_at: true,
                    risk_score: true
                },
                orderBy: { checked_in_at: 'desc' },
                take: Math.max(1, Math.min(limit, 200))
            });

            const data: any = checkins.map(c => ({
                id: c.id,
                session_id: c.session_id,
                session_name: c.sessions?.name,
                course_id: c.sessions?.course_id,
                course_code: c.sessions?.courses?.code,
                course_name: c.sessions?.courses?.name,
                status: c.status,
                checked_in_at: c.checked_in_at,
                risk_score: c.risk_score
            }));

            delete data.sessions;
            return data;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByIdAndUser: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, checkin_id: string) => {
        try {
            const role = user.role as USER_ROLE_TYPES;
            const userId = user.sub as string;

            const where: any = { id: checkin_id };

            switch (role) {
                case USER_ROLE_TYPES.STUDENT:
                    where.student_id = userId;
                    break;
                case USER_ROLE_TYPES.INSTRUCTOR:
                    where.sessions = { courses: { instructor_id: userId } };
                    break;
                case USER_ROLE_TYPES.TA:
                    where.sessions = { instructor_id: userId };
                    break;
                case USER_ROLE_TYPES.ADMIN:
                    // Do nothing...
                    break;
                default:
                    throw new UnauthorizedError();
            }

            const result = await prisma.checkins.findFirst({
                where,
                select: {
                    id: true,
                    session_id: true,
                    student_id: true,
                    status: true,
                    checked_in_at: true,
                    latitude: true,
                    longitude: true,
                    distance_from_venue_meters: true,
                    liveness_passed: true,
                    liveness_score: true,
                    risk_score: true,
                    risk_factors: true,
                    appealed_at: true,
                    sessions: { select: { course_id: true, name: true, courses: { select: { code: true, name: true } } } },
                    users_checkins_student_idTousers: { select: { full_name: true, email: true } }
                }
            });

            if (!result) {
                throw new NotFoundError();
            }

            const signalMap = await RiskSignalModel.getRiskSignalsByCheckinIds(prisma, [result.id]);
            const data: any = {
                ...result,
                session_name: result.sessions?.name,
                course_id: result.sessions?.course_id,
                course_code: result.sessions?.courses?.code,
                course_name: result.sessions?.courses?.name,
                student_name: result.users_checkins_student_idTousers?.full_name,
                student_email: result.users_checkins_student_idTousers?.email,
                risk_factors: normalizeRiskFactors(result.risk_factors),
                risk_signals: signalMap.get(result.id) || []
            };
            delete data.sessions;
            delete data.users_checkins_student_idTousers;
            return data;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getBySessionIdAndUser: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, sessionId: string) => {
        try {
            let where: any = {};

            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                where = {
                    AND: [
                        { session_id: sessionId },
                        {
                            OR: [
                                { instructor_id: user.sub },
                                { courses: { is: { instructor_id: user.sub } } }
                            ]
                        }
                    ]
                };
            } else if (user.role === USER_ROLE_TYPES.TA) {
                where.sessions = {
                    instructor_id: user.sub
                };
            } else if (user.role === USER_ROLE_TYPES.ADMIN) {
                where = { session_id: sessionId };
            } else {
                throw new ForbiddenError();
            }

            const checkins = await prisma.checkins.findMany({
                where,
                select: {
                    id: true,
                    student_id: true,
                    users_checkins_student_idTousers: { select: { full_name: true, email: true } },
                    status: true,
                    checked_in_at: true,
                    latitude: true,
                    longitude: true,
                    distance_from_venue_meters: true,
                    liveness_passed: true,
                    liveness_score: true,
                    risk_score: true,
                    risk_factors: true,
                    devices: { select: { is_trusted: true } }
                },
                orderBy: { checked_in_at: 'desc' }
            });

            const signalMap = await RiskSignalModel.getRiskSignalsByCheckinIds(prisma, checkins.map(c => c.id));

            const data: any = checkins.map(c => ({
                id: c.id,
                student_id: c.student_id,
                student_name: c.users_checkins_student_idTousers?.full_name,
                student_email: c.users_checkins_student_idTousers?.email,
                status: c.status,
                timestamp: c.checked_in_at,
                checked_in_at: c.checked_in_at,
                latitude: c.latitude,
                longitude: c.longitude,
                distance_from_venue_meters: c.distance_from_venue_meters,
                liveness_passed: c.liveness_passed,
                liveness_score: c.liveness_score,
                risk_score: c.risk_score,
                risk_factors: normalizeRiskFactors(c.risk_factors),
                device_is_trusted: c.devices?.is_trusted,
                risk_signals: signalMap.get(c.id) || []
            }));

            delete data.users_checkins_student_idTousers;
            delete data.devices;

            return data;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    appeal: async (prisma: PrismaClient, studentId: string, checkinId: string, appeal_reason: string) => {
        try {
            const currentCheckin = await CheckinModel.getByIdAndUser(prisma, { sub: studentId, role: USER_ROLE_TYPES.STUDENT }, checkinId);
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

            const updated = await prisma.checkins.update({
                where: { id: checkinId, student_id: studentId },
                data: {
                    status: CHECKIN_STATUS.APPEALED,
                    appeal_reason: appeal_reason,
                    appealed_at: new Date()
                },
                select: {
                    id: true,
                    status: true,
                    appeal_reason: true,
                    appealed_at: true
                }
            });

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
    review: async (prisma: PrismaClient, id: string, { user, status, notes }: { user: { sub: string, role: USER_ROLE_TYPES }, status: CHECKIN_STATUS, notes?: string }) => {
        try {
            const currentCheckin = await CheckinModel.getByIdAndUser(prisma, user, id);
            if (!currentCheckin) {
                throw new NotFoundError();
            }
            if (![CHECKIN_STATUS.FLAGGED, CHECKIN_STATUS.APPEALED].includes(currentCheckin.status)) {
                throw new BadRequestError('Only flagged or appealed check-ins can be reviewed');
            }

            await prisma.checkins.update({
                where: { id },
                data: {
                    status: status,
                    reviewed_by_id: user.sub,
                    reviewed_at: new Date(),
                    review_notes: notes ?? null
                }
            });

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
