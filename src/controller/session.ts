import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SessionModel, SESSION_STATUS } from '../model/session.js';
import { AUDIT_ACTIONS, AuditModel } from '../model/audit.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { BASE_URL } from '../helpers/constants.js';

// TODO: Check how to do maybeCloseExpiredSessions

async function sessionController(fastify: any) {
    const uri = `${BASE_URL}/sessions`;
    const resourceType = 'session';

    fastify.get(`${uri}/`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['scheduled', 'active', 'closed', 'cancelled'] },
                    course_id: { type: 'string' },
                    instructor_id: { type: 'string' },
                    start_date: { type: 'string', format: 'date-time' },
                    end_date: { type: 'string', format: 'date-time' },
                    limit: { type: 'integer', default: 50 },
                    offset: { type: 'integer', default: 0 }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.TA, USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { limit = 50, offset = 0 } = (req.query) as any;
            const { items, total } = await SessionModel.getAllFilteredSessions(pgClient, req.query as any);

            res.status(200).send({ items, total, limit, offset });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/active`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', format: 'uuid' },
                    instructor_id: { type: 'string', format: 'uuid' },
                    start_date: { type: 'string', format: 'date-time' },
                    end_date: { type: 'string', format: 'date-time' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            },
        },
        preHandler: [fastify.rateLimit()]
    },
        async (req: FastifyRequest, res: FastifyReply) => {
            const pgClient = await fastify.pg.connect();
            try {
                // We assume that this API may have some filters
                const queryStrings = req?.query as any;
                const sessions = await SessionModel.getActiveSessions(pgClient, queryStrings);
                res.status(200).send(sessions.map(s => ({
                    id: s.id,
                    course_id: s.course_id,
                    course_code: s.course_code,
                    name: s.name,
                    status: s.status,
                    scheduled_start: s.scheduled_start,
                    scheduled_end: s.scheduled_end,
                    checkin_opens_at: s.checkin_opens_at,
                    checkin_closes_at: s.checkin_closes_at,
                    venue_name: s.venue_name
                })));
            } finally {
                pgClient.release();
            }
        });

    fastify.get(`${uri}/my-sessions`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: Object.values(SESSION_STATUS) },
                    upcoming: { type: 'boolean', default: false },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            const sessions = await SessionModel.getFilteredSessionsByUser(pgClient, user, req.query as any);

            res.status(200).send(sessions);
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/:session_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['session_id'],
                properties: { session_id: { type: 'string' } }
            }
        }, preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userRole = (req.user as any)?.role;
            const session = await SessionModel.findById(pgClient, userRole, (req.params as any).session_id);
            res.status(200).send(session);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/`, {
        schema: {
            body: {
                type: 'object',
                required: ['course_id', 'name', 'scheduled_start', 'scheduled_end'],
                properties: {
                    course_id: { type: 'string' },
                    instructor_id: { type: 'string' },
                    name: { type: 'string' },
                    session_type: { type: 'string', enum: ['lecture', 'tutorial', 'lab', 'exam'], default: 'lecture' },
                    description: { type: 'string' },
                    scheduled_start: { type: 'string', format: 'date-time' },
                    scheduled_end: { type: 'string', format: 'date-time' },
                    checkin_opens_at: { type: 'string', format: 'date-time' },
                    checkin_closes_at: { type: 'string', format: 'date-time' },
                    venue_name: { type: 'string' },
                    venue_latitude: { type: 'number' },
                    venue_longitude: { type: 'number' },
                    geofence_radius_meters: { type: 'number' },
                    require_liveness_check: { type: 'boolean', default: true },
                    require_face_match: { type: 'boolean', default: false },
                    risk_threshold: { type: 'number' },
                    qr_code_enabled: { type: 'boolean', default: false }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.TA, USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest<{ Body: any }>, res: FastifyReply) => {
        // In this endpoint, we also allow TA since there is a relation with them and sessions.
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA) {
                (req.body as any).instructor_id = user.sub;
            }
            const session = await SessionModel.create(pgClient, req.body as any);

            await AuditModel.log(pgClient, {
                userId: user.sub,
                action: AUDIT_ACTIONS.SESSION_CREATED,
                resourceType,
                resourceId: session.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                deviceId: '',
                success: true,
                details: {
                    course_id: session.course_id,
                    session_name: session.name,
                    scheduled_start: session.scheduled_start
                }
            });

            res.status(201).send(session);
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${uri}/:session_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['session_id'],
                properties: { session_id: { type: 'string' } }
            },
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    status: { type: 'string', enum: ['scheduled', 'active', 'closed', 'cancelled'] },
                    scheduled_start: { type: 'string', format: 'date-time' },
                    scheduled_end: { type: 'string', format: 'date-time' },
                    checkin_opens_at: { type: 'string', format: 'date-time' },
                    checkin_closes_at: { type: 'string', format: 'date-time' },
                    venue_name: { type: 'string' },
                    venue_latitude: { type: 'number' },
                    venue_longitude: { type: 'number' },
                    geofence_radius_meters: { type: 'number' },
                    require_liveness_check: { type: 'boolean' },
                    require_face_match: { type: 'boolean' },
                    risk_threshold: { type: 'number' },
                    qr_code_enabled: { type: 'boolean' }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.TA, USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            const session = await SessionModel.update(pgClient, user, (req.params as any).session_id, req.body as any);
            if (!session) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            await AuditModel.log(pgClient, {
                userId: user.sub,
                action: AUDIT_ACTIONS.SESSION_UPDATED,
                resourceType,
                resourceId: session.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: {
                    updated_fields: Object.keys(req.body as any),
                    session_name: session.name
                }
            });

            res.status(200).send(session);
        } catch (err: any) {
            if (err.message === 'No valid fields to update') {
                res.status(400).send({ detail: err.message });
            } else {
                console.error('Error updating session:', err.message);
                res.status(500).send({ detail: err.message });
            }
        } finally {
            pgClient.release();
        }
    });

    fastify.delete(`${uri}/:session_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['session_id'],
                properties: { session_id: { type: 'string' } }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.TA, USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            const session = await SessionModel.delete(pgClient, user, (req.params as any).session_id);

            await AuditModel.log(pgClient, {
                userId: user.sub,
                action: AUDIT_ACTIONS.SESSION_DELETED,
                resourceType,
                resourceId: session.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                deviceId: '',
                success: true,
                details: {
                    course_id: session.course_id,
                    session_name: session.name
                }
            });
            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
    fastify.get(`${uri}/:id/qr`, {
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const qrPayload = await SessionModel.issueQr(pgClient, req.params.id);
            res.status(200).send(qrPayload);
        } catch (err: any) {
            if (err?.message === 'QR codes can only be issued for active sessions') {
                res.status(400).send({ detail: err.message });
            } else if (err?.message === 'QR codes are not enabled for this session') {
                res.status(400).send({ detail: err.message });
            } else if (err?.statusCode === 404) {
                res.status(404).send({ detail: 'Session not found' });
            } else {
                console.error('Error generating session QR:', err.message);
                res.status(500).send({ detail: err.message || 'Failed to generate QR code' });
            }
        } finally {
            pgClient.release();
        }
    });
}

export default fp(sessionController);
