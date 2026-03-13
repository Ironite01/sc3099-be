import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
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

async function sessionController(fastify: any) {
    const baseUri = '/api/v1/sessions';
    const adminUri = '/api/v1/admin/sessions';

    fastify.get(baseUri + '/', { schema: listSessionsSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Querystring: SessionListFilters }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
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

    fastify.get(baseUri + '/:id', { schema: getSessionSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
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
            const session = await SessionModel.updateStatus(pgClient, req.params.id, req.body.status);
            if (!session) {
                res.status(404).send({ detail: 'Session not found' });
                return;
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
