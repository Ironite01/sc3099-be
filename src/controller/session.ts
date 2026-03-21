import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createHmac, randomBytes } from 'crypto';
import { SessionModel } from '../model/session.js';
import type { SessionCreateData, SessionUpdateData, SessionListFilters } from '../model/session.js';
import { USER_ROLE_TYPES } from '../model/user.js';

const sessionProperties = {
    id: { type: 'string' },
    course_id: { type: 'string' },
    instructor_id: { type: ['string', 'null'] },
    name: { type: 'string' },
    session_type: { type: 'string' },
    description: { type: ['string', 'null'] },
    scheduled_start: { type: 'string', format: 'date-time' },
    scheduled_end: { type: 'string', format: 'date-time' },
    checkin_opens_at: { type: 'string', format: 'date-time' },
    checkin_closes_at: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['scheduled', 'active', 'closed', 'cancelled'] },
    venue_name: { type: ['string', 'null'] },
    venue_latitude: { type: ['number', 'null'] },
    venue_longitude: { type: ['number', 'null'] },
    geofence_radius_meters: { type: ['number', 'null'] },
    require_liveness_check: { type: 'boolean' },
    require_face_match: { type: 'boolean' },
    risk_threshold: { type: ['number', 'null'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' }
};

const sessionListItemProperties = {
    ...sessionProperties,
    course_code: { type: ['string', 'null'] },
    course_name: { type: ['string', 'null'] },
    instructor_name: { type: ['string', 'null'] },
    total_enrolled: { type: ['string', 'integer'] },
    checked_in_count: { type: ['string', 'integer'] }
};

const sessionResponseSchema = {
    type: 'object',
    properties: sessionProperties
};

const errorResponseSchema = {
    type: 'object',
    properties: {
        detail: { type: 'string' }
    }
};

const listSessionsSchema = {
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
    },
    response: {
        200: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'object', properties: sessionListItemProperties } },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' }
            }
        }
    }
};

const getSessionSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
    },
    response: {
        200: { type: 'object', properties: sessionListItemProperties },
        404: errorResponseSchema
    }
};

const createSessionSchema = {
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
            risk_threshold: { type: 'number' }
        }
    },
    response: {
        201: sessionResponseSchema,
        400: errorResponseSchema
    }
};

const updateSessionSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
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
            risk_threshold: { type: 'number' }
        }
    },
    response: {
        200: sessionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema
    }
};

const updateStatusSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
    },
    body: {
        type: 'object',
        required: ['status'],
        properties: {
            status: { type: 'string', enum: ['scheduled', 'active', 'closed', 'cancelled'] }
        }
    },
    response: {
        200: sessionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema
    }
};

const deleteSessionSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
    },
    response: {
        400: errorResponseSchema,
        404: errorResponseSchema
    }
};

const QR_TTL_SECONDS = 300;
const SESSION_TIMEZONE = 'Asia/Singapore';
const CLOSE_EXPIRED_COOLDOWN_MS = 30_000;
let lastCloseExpiredRunAt = 0;

async function maybeCloseExpiredSessions(pgClient: any): Promise<number> {
    const now = Date.now();
    if (now - lastCloseExpiredRunAt < CLOSE_EXPIRED_COOLDOWN_MS) {
        return 0;
    }

    lastCloseExpiredRunAt = now;
    return SessionModel.closeExpiredActiveSessions(pgClient);
}

async function ensureSessionTimezoneColumns(fastify: any) {
    const pgClient = await fastify.pg.connect();
    const timezoneColumns = [
        'scheduled_start',
        'scheduled_end',
        'checkin_opens_at',
        'checkin_closes_at',
        'actual_start',
        'actual_end',
        'qr_code_expires_at',
        'created_at',
        'updated_at'
    ];
    const nullableColumns = new Set(['actual_start', 'actual_end', 'qr_code_expires_at']);

    try {
        const { rows } = await pgClient.query(
            `SELECT column_name, data_type
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'sessions'
               AND column_name = ANY($1::text[])`,
            [timezoneColumns]
        );

        for (const row of rows) {
            if (row.data_type !== 'timestamp without time zone') {
                continue;
            }

            const columnName = row.column_name as string;
            const usingExpression = nullableColumns.has(columnName)
                ? `CASE WHEN ${columnName} IS NULL THEN NULL ELSE ${columnName} AT TIME ZONE '${SESSION_TIMEZONE}' END`
                : `${columnName} AT TIME ZONE '${SESSION_TIMEZONE}'`;

            await pgClient.query(
                `ALTER TABLE sessions
                 ALTER COLUMN ${columnName} TYPE TIMESTAMPTZ
                 USING ${usingExpression}`
            );
        }
    } finally {
        pgClient.release();
    }
}

function signQrPayload(sessionId: string, expiresAtMs: number, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${sessionId}.${expiresAtMs}`)
        .digest('hex');
}

function buildQrPayload(sessionId: string, secret: string, expiresAt: Date): string {
    const exp = expiresAt.getTime();
    const sig = signQrPayload(sessionId, exp, secret);
    return JSON.stringify({ sessionId, exp, sig });
}

async function issueSessionQr(pgClient: any, sessionId: string) {
    const qrSecret = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);

    const { rows } = await pgClient.query(
        `UPDATE sessions
         SET qr_code_secret = $1,
             qr_code_expires_at = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [qrSecret, expiresAt, sessionId]
    );

    return rows[0] ?? null;
}

async function sessionController(fastify: any) {
    const baseUri = '/api/v1/sessions';
    const adminUri = '/api/v1/admin/sessions';

    await ensureSessionTimezoneColumns(fastify);

    fastify.get(`${baseUri}/active`, async (_req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await maybeCloseExpiredSessions(pgClient);

            const result = await pgClient.query(
                `SELECT s.id, s.course_id, c.code AS course_code, c.name AS course_name,
                        s.name, s.session_type, s.status,
                        s.scheduled_start, s.scheduled_end,
                        s.checkin_opens_at, s.checkin_closes_at,
                        s.venue_name, s.venue_latitude, s.venue_longitude,
                        s.geofence_radius_meters, s.require_liveness_check,
                        s.require_face_match, s.risk_threshold
                 FROM sessions s
                 JOIN courses c ON c.id = s.course_id
                 WHERE s.status = 'active'
                 ORDER BY s.checkin_opens_at ASC`
            );

            const now = Date.now();
            const activeWithinWindow = result.rows.filter((row: any) => {
                const opensAt = new Date(row.checkin_opens_at).getTime();
                const closesAt = new Date(row.checkin_closes_at).getTime();
                if (Number.isNaN(opensAt) || Number.isNaN(closesAt)) {
                    return false;
                }
                return now >= opensAt && now <= closesAt;
            });

            res.status(200).send(activeWithinWindow);
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${baseUri}/my-sessions`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['scheduled', 'active', 'closed', 'cancelled'] },
                    upcoming: { type: 'boolean', default: false },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await maybeCloseExpiredSessions(pgClient);

            const user = req.user as any;
            const userId = user?.sub as string;
            const role = user?.role as USER_ROLE_TYPES;
            const { status, upcoming = false, limit = 50 } = req.query as {
                status?: string;
                upcoming?: boolean;
                limit?: number;
            };

            const params: any[] = [];
            const where: string[] = [];

            if (role === USER_ROLE_TYPES.STUDENT) {
                params.push(userId);
                where.push(`EXISTS (
                    SELECT 1 FROM enrollments e
                    WHERE e.course_id = s.course_id
                      AND e.student_id = $${params.length}
                      AND e.is_active = TRUE
                )`);
            } else {
                params.push(userId);
                where.push(`(
                    s.instructor_id = $${params.length}
                    OR $${params.length} IN (
                        SELECT id FROM users WHERE role IN ('admin','instructor','ta')
                    )
                )`);
            }

            if (status) {
                params.push(status);
                where.push(`s.status = $${params.length}`);
            }

            if (upcoming) {
                where.push('s.scheduled_start >= NOW()');
            }

            params.push(Math.max(1, Math.min(limit, 200)));

            const query = `
                SELECT s.*, c.code AS course_code, c.name AS course_name,
                       u.full_name AS instructor_name
                FROM sessions s
                JOIN courses c ON c.id = s.course_id
                LEFT JOIN users u ON u.id = s.instructor_id
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY s.scheduled_start ASC
                LIMIT $${params.length}
            `;

            const result = await pgClient.query(query, params);
            res.status(200).send(result.rows);
        } finally {
            pgClient.release();
        }
    });

    fastify.get(baseUri + '/', { schema: listSessionsSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Querystring: SessionListFilters }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await maybeCloseExpiredSessions(pgClient);

            const { limit = 50, offset = 0 } = req.query;
            const { items, total } = await SessionModel.findAll(pgClient, req.query);

            res.status(200).send({ items, total, limit, offset });
        } catch (err: any) {
            console.error('Error listing sessions:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(baseUri + '/:id', { schema: getSessionSchema, preHandler: [fastify.authorize(1)] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await maybeCloseExpiredSessions(pgClient);

            const session = await SessionModel.findById(pgClient, req.params.id);
            if (!session) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }
            res.status(200).send(session);
        } catch (err: any) {
            console.error('Error getting session:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(baseUri + '/', { schema: createSessionSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Body: SessionCreateData }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const session = await SessionModel.create(pgClient, req.body);
            res.status(201).send(session);
        } catch (err: any) {
            console.error('Error creating session:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(baseUri + '/:id', { schema: updateSessionSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Params: { id: string }, Body: SessionUpdateData }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const session = await SessionModel.update(pgClient, req.params.id, req.body);
            if (!session) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }
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

    fastify.patch(adminUri + '/:id/status', { schema: updateStatusSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Params: { id: string }, Body: { status: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            let session = await SessionModel.updateStatus(pgClient, req.params.id, req.body.status);
            if (!session) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            if (req.body.status === 'active') {
                session = await issueSessionQr(pgClient, req.params.id);
            }

            res.status(200).send(session);
        } catch (err: any) {
            if (err.message.startsWith('Invalid status')) {
                res.status(400).send({ detail: err.message });
            } else {
                console.error('Error updating session status:', err.message);
                res.status(500).send({ detail: err.message });
            }
        } finally {
            pgClient.release();
        }
    });

    fastify.get(adminUri + '/:id/qr', {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])],
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'string' } }
            }
        }
    }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await maybeCloseExpiredSessions(pgClient);

            const session = await SessionModel.getById(pgClient, req.params.id);
            if (session.status !== 'active') {
                res.status(400).send({ detail: 'QR code is only available for active sessions' });
                return;
            }

            // Always rotate to a fresh short-lived QR token when instructor opens QR.
            const currentSession = await issueSessionQr(pgClient, session.id);
            if (!currentSession) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            const qrExpiresAt = currentSession.qr_code_expires_at
                ? new Date(currentSession.qr_code_expires_at)
                : new Date(Date.now() + QR_TTL_SECONDS * 1000);

            const qrPayload = buildQrPayload(currentSession.id, currentSession.qr_code_secret!, qrExpiresAt);

            res.status(200).send({
                session_id: currentSession.id,
                qr_payload: qrPayload,
                qr_expires_at: qrExpiresAt.toISOString(),
                qr_ttl_seconds: Math.max(0, Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000))
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.delete(baseUri + '/:id', { schema: deleteSessionSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await SessionModel.delete(pgClient, req.params.id);
            res.status(204).send();
        } catch (err: any) {
            if (err.message === 'Session not found') {
                res.status(404).send({ detail: err.message });
            } else if (err.message.startsWith('Only scheduled')) {
                res.status(400).send({ detail: err.message });
            } else {
                console.error('Error deleting session:', err.message);
                res.status(500).send({ detail: err.message });
            }
        } finally {
            pgClient.release();
        }
    });
}

export default fp(sessionController);
