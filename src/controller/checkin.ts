import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { BASE_URL, DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../model/error.js';
import haversineDistance from '../helpers/haversineDistance.js';
import { SESSION_STATUS, SessionModel } from '../model/session.js';
import { CHECKIN_STATUS, CheckinModel } from '../model/checkin.js';
import { checkinTotal, riskScoreHistogram, checkinDistanceHistogram } from '../services/metrics.js';

function normalizeRiskFactors(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
}

function extractMetadata(riskFactors: any[]): Record<string, any> {
    const meta = riskFactors.find((f) => f && f.type === 'metadata');
    return meta && typeof meta === 'object' ? (meta.data || {}) : {};
}

function mergeMetadata(riskFactors: any[], patch: Record<string, any>): any[] {
    const cleaned = normalizeRiskFactors(riskFactors).filter((f) => !(f && f.type === 'metadata'));
    return [...cleaned, { type: 'metadata', data: patch }];
}

function parseQrPayload(rawQr: string): { sessionId: string; exp: number; sig: string } | null {
    try {
        const parsed = JSON.parse(rawQr);
        if (parsed && parsed.sessionId && parsed.exp && parsed.sig) {
            return {
                sessionId: String(parsed.sessionId),
                exp: Number(parsed.exp),
                sig: String(parsed.sig)
            };
        }
    } catch {
        // Continue to URL format parsing
    }

    try {
        const url = new URL(rawQr);
        const sessionId = url.searchParams.get('sessionId');
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');
        if (!sessionId || !exp || !sig) {
            return null;
        }
        return { sessionId, exp: Number(exp), sig };
    } catch {
        return null;
    }
}

function signQrPayload(sessionId: string, exp: number, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${sessionId}.${exp}`)
        .digest('hex');
}

function secureEqualsHex(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a, 'hex');
        const right = Buffer.from(b, 'hex');
        if (left.length !== right.length || left.length === 0) {
            return false;
        }
        return timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

async function ensureCheckinTimezoneColumn(fastify: FastifyInstance): Promise<void> {
    const pgClient = await fastify.pg.connect();
    try {
        const result = await pgClient.query(
            `SELECT data_type
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'checkins'
               AND column_name = 'checked_in_at'`
        );

        const dataType = result.rows[0]?.data_type as string | undefined;
        if (dataType !== 'timestamp without time zone') {
            // Continue to sanity-fix legacy rows that may have been written 8h ahead.
            const driftFix = await pgClient.query(
                `UPDATE checkins
                 SET checked_in_at = checked_in_at - INTERVAL '8 hours'
                 WHERE checked_in_at > NOW() + INTERVAL '2 hours'`
            );
            if ((driftFix.rowCount ?? 0) > 0) {
                fastify.log.warn(`[checkins] Corrected ${(driftFix.rowCount ?? 0)} future-drifted check-in timestamps (-8h).`);
            }
            return;
        }

        // Legacy DBs may have checkins.checked_in_at as timestamp (without timezone).
        // Interpret existing stored values as UTC and migrate to TIMESTAMPTZ once.
        await pgClient.query(
            `ALTER TABLE checkins
             ALTER COLUMN checked_in_at TYPE TIMESTAMPTZ
             USING checked_in_at AT TIME ZONE 'UTC'`
        );

        const driftFix = await pgClient.query(
            `UPDATE checkins
             SET checked_in_at = checked_in_at - INTERVAL '8 hours'
             WHERE checked_in_at > NOW() + INTERVAL '2 hours'`
        );
        if ((driftFix.rowCount ?? 0) > 0) {
            fastify.log.warn(`[checkins] Corrected ${(driftFix.rowCount ?? 0)} future-drifted check-in timestamps (-8h).`);
        }
    } finally {
        pgClient.release();
    }
}

async function checkinController(fastify: FastifyInstance) {
    await ensureCheckinTimezoneColumn(fastify);

    const uri = `${BASE_URL}/checkins`;

    fastify.get(`${uri}/`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    session_id: { type: 'string' },
                    course_id: { type: 'string' },
                    student_id: { type: 'string' },
                    status: {
                        type: 'string',
                        enum: ['pending', 'approved', 'flagged', 'rejected', 'appealed']
                    },
                    min_risk_score: { type: 'number' },
                    max_risk_score: { type: 'number' },
                    start_date: { type: 'string', format: 'date-time' },
                    end_date: { type: 'string', format: 'date-time' },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const {
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
        } = req.query as any;

        const pgClient = await fastify.pg.connect();
        try {
            const params: any[] = [];
            const where: string[] = [];

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
            if (status) {
                params.push(status);
                where.push(`ci.status = $${params.length}`);
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
            const itemsResult = await pgClient.query(
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
                        ci.liveness_passed
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

            res.status(200).send({
                items: itemsResult.rows,
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/my-checkins`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    course_id: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const studentId = (req.user as any)?.sub;
        if (!studentId) {
            throw new UnauthorizedError();
        }

        const { course_id, limit = 50 } = req.query as { course_id?: string; limit?: number };
        const pgClient = await fastify.pg.connect();
        try {
            const filters = {
                ...(course_id ? { course_id } : {}),
                limit
            };
            const checkins = await CheckinModel.listByStudent(pgClient, studentId, filters);
            res.status(200).send(checkins);
        } finally {
            pgClient.release();
        }
    });

    // GET /api/v1/checkins/flagged - instructor/admin: list flagged checkins pending review
    fastify.get(`${uri}/flagged`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    course_id: { type: 'string' },
                    session_id: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.TA])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const {
            course_id,
            session_id,
            limit = 20,
            offset = 0
        } = req.query as { course_id?: string; session_id?: string; limit?: number; offset?: number };
        const pgClient = await fastify.pg.connect();
        try {
            const params: any[] = [];
            const where: string[] = [`ci.status IN ('flagged','appealed')`];

            if (course_id) {
                params.push(course_id);
                where.push(`c.id = $${params.length}`);
            }
            if (session_id) {
                params.push(session_id);
                where.push(`s.id = $${params.length}`);
            }

            const whereClause = `WHERE ${where.join(' AND ')}`;

            const countResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 ${whereClause}`,
                params
            );

            params.push(limit, offset);
            const result = await pgClient.query(
                `SELECT ci.id, ci.student_id, u.full_name AS student_name, u.email AS student_email,
                        ci.session_id, s.name AS session_name, c.code AS course_code,
                        ci.status, ci.risk_score, ci.risk_factors,
                        TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                        ci.distance_from_venue_meters, ci.liveness_passed
                 FROM checkins ci
                 JOIN users u ON u.id = ci.student_id
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 ${whereClause}
                 ORDER BY ci.checked_in_at DESC
                 LIMIT $${params.length - 1}
                 OFFSET $${params.length}`,
                params
            );
            res.status(200).send({
                items: result.rows,
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/:id`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { id } = req.params as { id: string };
        const user = req.user as any;
        const userId = user?.sub as string;
        const role = user?.role as USER_ROLE_TYPES;

        const pgClient = await fastify.pg.connect();
        try {
            const result = await pgClient.query(
                `SELECT ci.id, ci.session_id, ci.student_id, ci.status,
                        TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
                        ci.latitude, ci.longitude, ci.distance_from_venue_meters,
                        ci.liveness_passed, ci.liveness_score, ci.risk_score, ci.risk_factors,
                        s.course_id, s.name AS session_name,
                        c.code AS course_code, c.name AS course_name,
                        u.full_name AS student_name, u.email AS student_email
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 JOIN users u ON u.id = ci.student_id
                 WHERE ci.id = $1`,
                [id]
            );
            if (!result.rows.length) {
                throw new NotFoundError();
            }

            const checkin = result.rows[0];
            const isOwner = checkin.student_id === userId;
            const privileged = role === USER_ROLE_TYPES.ADMIN || role === USER_ROLE_TYPES.INSTRUCTOR || role === USER_ROLE_TYPES.TA;
            if (!isOwner && !privileged) {
                throw new ForbiddenError();
            }

            res.status(200).send(checkin);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/:id/appeal`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT])],
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string' }
                }
            },
            body: {
                type: 'object',
                required: ['appeal_reason'],
                properties: {
                    appeal_reason: { type: 'string', minLength: 5, maxLength: 1000 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { id } = req.params as { id: string };
        const { appeal_reason } = req.body as { appeal_reason: string };
        const studentId = (req.user as any)?.sub;

        const pgClient = await fastify.pg.connect();
        try {
            const result = await pgClient.query(
                `SELECT id, student_id, status, checked_in_at, risk_factors
                 FROM checkins WHERE id = $1`,
                [id]
            );
            if (!result.rows.length) {
                throw new NotFoundError();
            }

            const checkin = result.rows[0];
            if (checkin.student_id !== studentId) {
                throw new ForbiddenError();
            }
            if (!['rejected', 'flagged'].includes(checkin.status)) {
                throw new BadRequestError('Only rejected or flagged check-ins can be appealed');
            }

            const checkedInAt = new Date(checkin.checked_in_at).getTime();
            const windowMs = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - checkedInAt > windowMs) {
                throw new BadRequestError('Appeal window has expired');
            }

            const currentMeta = extractMetadata(normalizeRiskFactors(checkin.risk_factors));
            if (currentMeta.appealed_at) {
                throw new BadRequestError('Check-in has already been appealed');
            }

            const metadataPatch = {
                ...currentMeta,
                appeal_reason,
                appealed_at: new Date().toISOString(),
                review_notes: currentMeta.review_notes,
                reviewed_by_id: currentMeta.reviewed_by_id,
                reviewed_at: currentMeta.reviewed_at
            };

            const updatedRiskFactors = mergeMetadata(normalizeRiskFactors(checkin.risk_factors), metadataPatch);
            const updated = await pgClient.query(
                `UPDATE checkins
                 SET status = 'appealed',
                     risk_factors = $2::jsonb
                 WHERE id = $1
                 RETURNING id, status`,
                [id, JSON.stringify(updatedRiskFactors)]
            );

            res.status(200).send({
                id,
                status: updated.rows[0]?.status ?? 'appealed',
                appeal_reason,
                appealed_at: metadataPatch.appealed_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/:id/review`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.TA])],
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string' }
                }
            },
            body: {
                type: 'object',
                required: ['status'],
                properties: {
                    status: { type: 'string', enum: ['approved', 'rejected'] },
                    review_notes: { type: 'string', maxLength: 2000 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { id } = req.params as { id: string };
        const { status, review_notes } = req.body as { status: 'approved' | 'rejected'; review_notes?: string };
        const reviewerId = (req.user as any)?.sub;

        const pgClient = await fastify.pg.connect();
        try {
            const result = await pgClient.query(
                `SELECT id, status, risk_factors
                 FROM checkins
                 WHERE id = $1`,
                [id]
            );
            if (!result.rows.length) {
                throw new NotFoundError();
            }

            const checkin = result.rows[0];
            if (!['flagged', 'appealed'].includes(checkin.status)) {
                throw new BadRequestError('Only flagged or appealed check-ins can be reviewed');
            }

            const currentMeta = extractMetadata(normalizeRiskFactors(checkin.risk_factors));
            const metadataPatch = {
                ...currentMeta,
                review_notes: review_notes ?? currentMeta.review_notes ?? null,
                reviewed_by_id: reviewerId,
                reviewed_at: new Date().toISOString()
            };

            const updatedRiskFactors = mergeMetadata(normalizeRiskFactors(checkin.risk_factors), metadataPatch);

            await pgClient.query(
                `UPDATE checkins
                 SET status = $2,
                     risk_factors = $3::jsonb
                 WHERE id = $1`,
                [id, status, JSON.stringify(updatedRiskFactors)]
            );

            res.status(200).send({
                id,
                status,
                reviewed_by_id: reviewerId,
                reviewed_at: metadataPatch.reviewed_at,
                review_notes: metadataPatch.review_notes
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/session/:sessionId`, {
        schema: {
            params: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            student_id: { type: 'string' },
                            student_name: { type: 'string' },
                            student_email: { type: 'string' },
                            status: { type: 'string' },
                            timestamp: { type: 'string', format: 'date-time' },
                            checked_in_at: { type: 'string', format: 'date-time' },
                            latitude: { type: 'number' },
                            longitude: { type: 'number' },
                            distance_from_venue_meters: { type: 'number' },
                            liveness_passed: { type: 'boolean' },
                            liveness_score: { type: ['number', 'null'] },
                            risk_score: { type: ['number', 'null'] },
                            risk_factors: { type: 'array', items: { type: 'object' } }
                        }
                    }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.TA])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { sessionId } = req.params as { sessionId: string };
            const checkins = await CheckinModel.listBySession(pgClient, sessionId);
            res.status(200).send(checkins);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(uri, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    location_accuracy_meters: { type: 'number' },
                    device_fingerprint: { type: 'string' },
                    liveness_challenge_response: { type: 'string' },
                    qr_code: { type: 'string' }
                },
                required: ['session_id', 'latitude', 'longitude'],
                additionalProperties: false
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await SessionModel.closeExpiredActiveSessions(pgClient);

            const { session_id, latitude, longitude, qr_code, device_fingerprint, liveness_challenge_response } = req.body as any;
            const studentId = (req.user as any)?.sub;
            if (!studentId) {
                throw new UnauthorizedError();
            }

            const session = await SessionModel.getById(pgClient, session_id);
            const venueLat = session.venue_latitude; // e.g. SMU
            const venueLon = session.venue_longitude;
            const geofenceRadius = session.geofence_radius_meters || DEFAULT_GEOFENCE_RADIUS_METERS;

            const enrollment = await pgClient.query(
                `SELECT 1
                 FROM enrollments
                 WHERE student_id = $1
                   AND course_id = $2
                   AND is_active = TRUE`,
                [studentId, session.course_id]
            );
            if (!enrollment.rows.length) {
                throw new BadRequestError('Student is not enrolled in this course');
            }

            if (session.status !== SESSION_STATUS.ACTIVE) {
                throw new BadRequestError('Session not active');
            }

            if (session.qr_code_secret) {
                if (!qr_code || typeof qr_code !== 'string') {
                    throw new BadRequestError('QR code is required for this session');
                }

                const parsedQr = parseQrPayload(qr_code);
                if (!parsedQr || parsedQr.sessionId !== session_id || !Number.isFinite(parsedQr.exp)) {
                    throw new BadRequestError('Invalid QR code');
                }

                if (Date.now() > parsedQr.exp) {
                    throw new BadRequestError('QR code expired');
                }

                const expectedSig = signQrPayload(session_id, parsedQr.exp, session.qr_code_secret);
                if (!secureEqualsHex(parsedQr.sig, expectedSig)) {
                    throw new BadRequestError('Invalid QR code');
                }
            }

            const now = new Date();
            if (now < new Date(session.checkin_opens_at) || now > new Date(session.checkin_closes_at)) {
                throw new BadRequestError('Check-in window closed');
            }

            if (!venueLat || !venueLon) {
                throw new BadRequestError('Session does not have a valid venue location');
            }

            const distance = haversineDistance(latitude, longitude, venueLat, venueLon);
            // Only hard-reject at 2x geofence radius (per spec: GPS > 2x geofence -> rejected).
            // Distances between 1x and 2x are allowed through but will receive a higher
            // geo risk score, likely resulting in the check-in being flagged for review.
            if (distance > geofenceRadius * 2) {
                throw new BadRequestError('Location is outside the permitted geofence');
            }

            // -- Device binding enforcement --
            const courseResult = await pgClient.query(
                `SELECT require_device_binding, risk_threshold FROM courses WHERE id = $1`,
                [session.course_id]
            );
            const course = courseResult.rows[0];
            const requireDeviceBinding: boolean = course?.require_device_binding ?? true;
            const riskThreshold: number = course?.risk_threshold ?? 0.5;

            let deviceRecord: { id: string; is_trusted: boolean; trust_score: string; is_active: boolean } | null = null;
            if (device_fingerprint) {
                const deviceQuery = await pgClient.query(
                    `SELECT id, is_trusted, trust_score, is_active
                     FROM devices
                     WHERE user_id = $1 AND device_fingerprint = $2
                     LIMIT 1`,
                    [studentId, device_fingerprint]
                );
                deviceRecord = deviceQuery.rows[0] ?? null;
            }

            if (requireDeviceBinding) {
                if (!device_fingerprint) {
                    throw new BadRequestError('Device fingerprint is required for this course');
                }
                if (!deviceRecord) {
                    throw new BadRequestError('Device not registered. Please register your device before checking in.');
                }
                if (!deviceRecord.is_active) {
                    throw new BadRequestError('Your device has been deactivated. Please contact support.');
                }
            }

            // -- Liveness / attestation token validation --
            let livenessPassed = false;
            let livenessScore: number | null = null;
            if (liveness_challenge_response && typeof liveness_challenge_response === 'string') {
                try {
                    const decoded = Buffer.from(liveness_challenge_response, 'base64').toString('utf8');
                    const parts = decoded.split('_');
                    if (parts.length >= 3 && parts[0] === 'liveness') {
                        const ts = Number(parts[1]);
                        const tokenAge = Date.now() - ts;
                        if (Number.isFinite(ts) && tokenAge >= 0 && tokenAge < 600_000 && (parts[2]?.length ?? 0) > 0) {
                            livenessPassed = true;
                            livenessScore = 0.75;
                        }
                    }
                } catch {
                    // Malformed token -- liveness stays false
                }
            }

            // -- Risk score calculation --
            const riskFactors: Record<string, any>[] = [];

            // Geolocation signal (15% weight)
            const geoRisk = Math.min(distance / geofenceRadius, 1.0) * 0.15;
            riskFactors.push({ type: 'geolocation', distance_meters: Math.round(distance), geofence_radius: geofenceRadius, weight: parseFloat(geoRisk.toFixed(4)) });

            // Device attestation signal (20% weight)
            let deviceRisk: number;
            if (!device_fingerprint) {
                deviceRisk = 0.20;
                riskFactors.push({ type: 'device_unknown', severity: 'high', weight: 0.20 });
            } else if (!deviceRecord) {
                deviceRisk = 0.20;
                riskFactors.push({ type: 'device_unregistered', severity: 'high', weight: 0.20 });
            } else {
                deviceRisk = deviceRecord.is_trusted ? 0.0 : 0.10;
                riskFactors.push({ type: 'device_attestation', is_trusted: deviceRecord.is_trusted, trust_score: deviceRecord.trust_score, weight: deviceRisk });
            }

            // Liveness signal (25% weight)
            const livenessRisk = livenessPassed ? parseFloat((0.25 * (1 - (livenessScore ?? 0.75))).toFixed(4)) : 0.25;
            riskFactors.push({ type: 'liveness', passed: livenessPassed, score: livenessScore, weight: livenessRisk });

            // Face match and network (no ML/detection yet)
            riskFactors.push({ type: 'face_match', passed: false, weight: 0 });
            riskFactors.push({ type: 'network', weight: 0 });

            const riskScore = parseFloat((geoRisk + deviceRisk + livenessRisk).toFixed(4));

            // -- Determine check-in status --
            let checkinStatus: CHECKIN_STATUS;
            if (riskScore < 0.3) {
                checkinStatus = CHECKIN_STATUS.APPROVED;
            } else if (riskScore < riskThreshold) {
                checkinStatus = CHECKIN_STATUS.APPROVED;
            } else if (riskScore < 0.7) {
                checkinStatus = CHECKIN_STATUS.FLAGGED;
            } else {
                checkinStatus = CHECKIN_STATUS.REJECTED;
            }

            // -- Update device activity if found --
            if (deviceRecord) {
                await pgClient.query(
                    `UPDATE devices
                     SET last_seen_at = NOW(), total_checkins = total_checkins + 1, updated_at = NOW()
                     WHERE id = $1`,
                    [deviceRecord.id]
                );
            }

            const checkin = await CheckinModel.create(pgClient, {
                session_id,
                student_id: studentId,
                latitude,
                longitude,
                distance_from_venue_meters: distance,
                liveness_passed: livenessPassed,
                liveness_score: livenessScore,
                risk_score: riskScore,
                risk_factors: riskFactors,
                status: checkinStatus
            });

            // Record Prometheus metrics
            checkinTotal.inc({ status: checkinStatus });
            riskScoreHistogram.observe(riskScore);
            checkinDistanceHistogram.observe(distance);

            res.status(201).send({
                id: checkin.id,
                session_id: checkin.session_id,
                student_id: checkin.student_id,
                status: checkin.status,
                checked_in_at: checkin.checked_in_at,
                latitude: checkin.latitude,
                longitude: checkin.longitude,
                distance_from_venue_meters: checkin.distance_from_venue_meters,
                liveness_passed: checkin.liveness_passed,
                liveness_score: checkin.liveness_score,
                risk_score: checkin.risk_score,
                risk_factors: checkin.risk_factors
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(checkinController);
