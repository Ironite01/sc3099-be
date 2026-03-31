import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Course } from '../model/course.js';
import type { CourseCreateData, CourseUpdateData, CourseListFilters } from '../model/course.js';
import { USER_ROLE_TYPES } from '../model/user.js';

const courseProperties = {
    id: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    semester: { type: 'string' },
    is_active: { type: 'boolean' },
    venue_name: { type: ['string', 'null'] },
    venue_latitude: { type: ['number', 'null'] },
    venue_longitude: { type: ['number', 'null'] },
    geofence_radius_meters: { type: 'number' },
    require_face_recognition: { type: 'boolean' },
    require_device_binding: { type: 'boolean' },
    risk_threshold: { type: 'number' },
    instructor_id: { type: ['string', 'null'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' }
};

const courseResponseSchema = {
    type: 'object',
    properties: courseProperties
};

const errorResponseSchema = {
    type: 'object',
    properties: {
        detail: { type: 'string' }
    }
};

const listCoursesSchema = {
    querystring: {
        type: 'object',
        properties: {
            is_active: { type: 'boolean' },
            semester: { type: 'string' },
            instructor_id: { type: 'string' },
            limit: { type: 'integer', default: 50 },
            offset: { type: 'integer', default: 0 }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                items: { type: 'array', items: courseResponseSchema },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' }
            }
        }
    }
};

const getCourseSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
    },
    response: {
        200: courseResponseSchema,
        404: errorResponseSchema
    }
};

const createCourseSchema = {
    body: {
        type: 'object',
        required: ['code', 'name', 'semester'],
        properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            semester: { type: 'string' },
            description: { type: 'string' },
            venue_name: { type: 'string' },
            venue_latitude: { type: 'number' },
            venue_longitude: { type: 'number' },
            geofence_radius_meters: { type: 'number', default: 100.0 },
            require_face_recognition: { type: 'boolean', default: false },
            require_device_binding: { type: 'boolean', default: true },
            risk_threshold: { type: 'number', default: 0.5 },
            instructor_id: { type: 'string' }
        }
    },
    response: {
        201: courseResponseSchema,
        400: errorResponseSchema
    }
};

const updateCourseSchema = {
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
            venue_name: { type: 'string' },
            venue_latitude: { type: 'number' },
            venue_longitude: { type: 'number' },
            geofence_radius_meters: { type: 'number' },
            require_face_recognition: { type: 'boolean' },
            require_device_binding: { type: 'boolean' },
            risk_threshold: { type: 'number' },
            is_active: { type: 'boolean' },
            instructor_id: { type: 'string' }
        }
    },
    response: {
        200: courseResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema
    }
};

const deleteCourseSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
    },
    response: {
        404: errorResponseSchema
    }
};

async function courseController(fastify: any) {
    const baseUri = '/api/v1/courses';

    fastify.get(baseUri + '/', { 
        schema: listCoursesSchema,
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.TA, USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()]
    }, async (req: FastifyRequest<{ Querystring: CourseListFilters }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { is_active, semester, limit = 50, offset = 0 } = req.query;
            let req_instructor_id = req.query.instructor_id;

            const user = req.user as any;
            // Only sandbox if they are specifically an instructor or TA 
            if (user && (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA)) {
                req_instructor_id = user.sub; // Force filter to logged-in user's courses
            }

            const { items, total } = await Course.findAll(pgClient, { 
                is_active, 
                semester, 
                instructor_id: req_instructor_id, 
                limit, 
                offset 
            });
            res.status(200).send({ items, total, limit, offset });
        } catch (err: any) {
            console.error('Error listing courses:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(baseUri + '/:id', { schema: getCourseSchema, preHandler: [fastify.rateLimit()] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const course = await Course.findById(pgClient, req.params.id);
            if (!course) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }
            res.status(200).send(course);
        } catch (err: any) {
            console.error('Error getting course:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(baseUri + '/', { schema: createCourseSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()] }, async (req: FastifyRequest<{ Body: CourseCreateData }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const body = req.body;
            if ((req.user as any)?.role === USER_ROLE_TYPES.INSTRUCTOR && !body.instructor_id) {
                body.instructor_id = (req.user as any).sub;
            }
            const course = await Course.create(pgClient, body);
            res.status(201).send(course);
        } catch (err: any) {
            console.error('Error creating course:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.put(baseUri + '/:id', { schema: updateCourseSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()] }, async (req: FastifyRequest<{ Params: { id: string }, Body: CourseUpdateData }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const course = await Course.update(pgClient, req.params.id, req.body);
            if (!course) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }
            res.status(200).send(course);
        } catch (err: any) {
            if (err.message === 'No valid fields to update') {
                res.status(400).send({ detail: err.message });
            } else {
                console.error('Error updating course:', err.message);
                res.status(500).send({ detail: err.message });
            }
        } finally {
            pgClient.release();
        }
    });

    fastify.delete(baseUri + '/:id', { schema: deleteCourseSchema, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const deleted = await Course.delete(pgClient, req.params.id);
            if (!deleted) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }
            res.status(204).send();
        } catch (err: any) {
            console.error('Error deleting course:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(courseController);
