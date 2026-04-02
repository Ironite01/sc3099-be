import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { CHECKIN_STATUS, CheckinModel } from '../model/checkin.js';
import { AUDIT_ACTIONS, AuditModel } from '../model/audit.js';
import { LivenessChallengeType } from '../services/ml/liveness/check.js';

async function checkinController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/checkins`;
    const resourceType = 'checkin';

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
                    liveness_challenge_type: { type: 'string', enum: Object.values(LivenessChallengeType) },
                    qr_code: { type: 'string' }
                },
                required: ['session_id', 'latitude', 'longitude', 'location_accuracy_meters', 'device_fingerprint'],
                additionalProperties: false
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit({
            limit: 10,
            window: 60,
            keyGenerator: (req: FastifyRequest) => `rl:checkin:${(req.user as any)?.sub || req.ip}`
        })]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response, qr_code } = req.body as any;
        const userId = (req.user as any)?.sub;
        const ipAddr = req.ip;
        const userAgent = req.headers['user-agent'];

        const u = {
            ipAddr,
            session_id,
            latitude,
            longitude,
            location_accuracy_meters,
            device_fingerprint,
            liveness_challenge_response,
            qr_code
        };

        const pgClient = await fastify.pg.connect();
        try {
            const checkin = await CheckinModel.create(fastify.pg.transact, userId, userAgent ? { ...u, userAgent } : u);

            let auditAction = AUDIT_ACTIONS.CHECKIN_ATTEMPTED;
            let details = {};
            switch (checkin.status) {
                case CHECKIN_STATUS.APPROVED:
                    auditAction = AUDIT_ACTIONS.CHECKIN_APPROVED;
                    details = { checkin_id: checkin.id, reviewer_id: null };
                    break;
                case CHECKIN_STATUS.FLAGGED:
                    auditAction = AUDIT_ACTIONS.CHECKIN_FLAGGED;
                    details = {
                        session_id: checkin.session_id,
                        risk_score: checkin.risk_score,
                        liveness_passed: checkin.liveness_passed,
                        distance_meters: checkin.distance_from_venue_meters
                    };
                    break;
                case CHECKIN_STATUS.REJECTED:
                    auditAction = AUDIT_ACTIONS.CHECKIN_REJECTED;
                    details = { checkin_id: checkin.id, reason: 'Failed risk checks' };
                    break;
            }

            await AuditModel.log(await fastify.prisma, {
                userId,
                action: auditAction,
                resourceType,
                resourceId: checkin.id,
                ipAddress: ipAddr,
                userAgent: userAgent || '',
                success: true,
                details
            });


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
                risk_factors: checkin.risk_factors,
                risk_signals: checkin.risk_signals || []
            });
        } catch (err) {
            await AuditModel.log(await fastify.prisma, {
                userId,
                action: AUDIT_ACTIONS.CHECKIN_ATTEMPTED,
                resourceType,
                resourceId: session_id,
                ipAddress: ipAddr,
                userAgent: userAgent || '',
                success: false,
                details: {
                    student_id: userId,
                    session_id,
                    location: { latitude, longitude, accuracy_meters: location_accuracy_meters }
                }
            });
            throw err;
        } finally {
            pgClient.release();
        }
    });

    fastify.get(uri, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    session_id: { type: 'string' },
                    course_id: { type: 'string' },
                    student_id: { type: 'string' },
                    status: {
                        type: 'string',
                        enum: Object.values(CHECKIN_STATUS)
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
        const pgClient = await fastify.pg.connect();
        try {
            const status = (req.query as any).status as CHECKIN_STATUS | undefined;
            const checkins = await CheckinModel.getFilteredCheckins(pgClient, req.user as any, {
                ...req.query as any,
                status: status ? [status] : []
            });

            res.status(200).send({
                items: checkins.items,
                total: checkins.total,
                limit: checkins.limit,
                offset: checkins.offset
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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const studentId = (req.user as any)?.sub;
            const checkins = await CheckinModel.getFilteredCheckinsByStudentId(pgClient, studentId, req.query as any);

            res.status(200).send(checkins.map((c) => ({
                session_id: c.session_id,
                session_name: c.session_name,
                course_id: c.course_id,
                course_code: c.course_code,
                course_name: c.course_name,
                status: c.status,
                checked_in_at: c.checked_in_at,
                risk_score: c.risk_score
            })));
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
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.TA]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { sessionId } = req.params as { sessionId: string };
            const checkins = await CheckinModel.getBySessionIdAndUser(pgClient, req.user as any, sessionId);

            res.status(200).send(checkins.map((c) => ({
                id: c.id,
                student_id: c.student_id,
                student_name: c.student_name,
                student_email: c.student_email,
                status: c.status,
                checked_in_at: c.checked_in_at,
                distance_from_venue_meters: c.distance_from_venue_meters,
                risk_score: c.risk_score,
                risk_factors: c.risk_factors,
                risk_signals: c.risk_signals || [],
                liveness_passed: c.liveness_passed,
                device_trusted: c.device_is_trusted
            })));
        } finally {
            pgClient.release();
        }
    });

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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.TA]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const result = await CheckinModel.getFilteredCheckins(pgClient, req.user as any, {
                ...req.query as any,
                status: [CHECKIN_STATUS.FLAGGED, CHECKIN_STATUS.APPEALED]
            });
            res.status(200).send({
                items: result.items,
                total: result.total,
                limit: result.limit,
                offset: result.offset
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/:checkin_id`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()],
        schema: {
            params: {
                type: 'object',
                required: ['checkin_id'],
                properties: {
                    checkin_id: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { checkin_id } = req.params as any;
            const user = req.user as any;

            const checkin = await CheckinModel.getByIdAndUser(pgClient, user, checkin_id);

            res.status(200).send(checkin);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/:id/appeal`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()],
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
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params as { id: string };
            const { appeal_reason } = req.body as { appeal_reason: string };
            const studentId = (req.user as any)?.sub;

            const result = await CheckinModel.appeal(pgClient, studentId, id, appeal_reason);

            await AuditModel.log(await fastify.prisma, {
                userId: (req.user as any)?.sub,
                action: AUDIT_ACTIONS.CHECKIN_APPEALED,
                resourceType,
                resourceId: id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: {
                    studentId,
                    appeal_reason,
                    appealed_at: result.appealed_at
                }
            });

            res.status(200).send({
                id: result.id,
                status: result.status,
                appeal_reason: result.appeal_reason,
                appealed_at: result.appealed_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/:id/review`, {
        preHandler: [fastify.authorize(2), fastify.rateLimit()],
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
                    status: { type: 'string', enum: [CHECKIN_STATUS.APPROVED, CHECKIN_STATUS.REJECTED] },
                    review_notes: { type: 'string', maxLength: 2000 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const result = await CheckinModel.review(pgClient, (req.params as any).id, {
                user: req.user as any,
                status: (req.body as any).status,
                notes: (req.body as any).review_notes
            });

            const auditAction = result.status === CHECKIN_STATUS.APPROVED
                ? AUDIT_ACTIONS.CHECKIN_APPROVED
                : result.status === CHECKIN_STATUS.REJECTED
                    ? AUDIT_ACTIONS.CHECKIN_REJECTED
                    : AUDIT_ACTIONS.CHECKIN_REVIEWED;

            let details;
            if (result.status === CHECKIN_STATUS.APPROVED) {
                details = { checkin_id: result.id, reviewer_id: result.reviewed_by_id };
            } else if (result.status === CHECKIN_STATUS.REJECTED) {
                details = { checkin_id: result.id, reason: result.review_notes };
            } else {
                details = {
                    new_status: result.status,
                    reviewed_at: result.reviewed_at,
                    review_notes: result.review_notes
                }
            }

            await AuditModel.log(await fastify.prisma, {
                userId: (req.user as any)?.sub,
                action: auditAction,
                resourceType,
                resourceId: result.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details
            });

            res.status(200).send({
                id: result.id,
                status: result.status,
                reviewed_by_id: result.reviewed_by_id,
                reviewed_at: result.reviewed_at,
                review_notes: result.review_notes
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(checkinController);
