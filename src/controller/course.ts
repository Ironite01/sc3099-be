import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Course } from '../model/course.js';
import type { CourseCreateData, CourseUpdateData, CourseListFilters } from '../model/course.js';

// --- JSON Schemas for validation & serialization ---

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
            risk_threshold: { type: 'number', default: 0.5 }
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
            is_active: { type: 'boolean' }
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

// --- Controller ---

async function courseController(fastify: any) {
    const baseUri = '/api/v1/courses';

    // GET /courses/ - List courses with filters (students: enrolled only, instructors: their courses)
    fastify.get(baseUri + '/', { schema: listCoursesSchema, preHandler: [fastify.authorize(['student', 'ta', 'instructor', 'admin'])] }, async (req: FastifyRequest<{ Querystring: CourseListFilters }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as { id: string, role: string };
            const { is_active, semester, limit = 50, offset = 0 } = req.query;
            const { items, total } = await Course.findAll(pgClient, { is_active, semester, limit, offset }, user);

            res.status(200).send({ items, total, limit, offset });
        } catch (err: any) {
            console.error('Error listing courses:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // GET /courses/{id} - Get single course
    fastify.get(baseUri + '/:id', { schema: getCourseSchema, preHandler: [fastify.authorize(['student', 'ta', 'instructor', 'admin'])] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
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

    // POST /courses/ - Create a new course (admin only)
    fastify.post(baseUri + '/', { schema: createCourseSchema, preHandler: [fastify.authorize(['admin'])] }, async (req: FastifyRequest<{ Body: CourseCreateData }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const course = await Course.create(pgClient, req.body);
            res.status(201).send(course);
        } catch (err: any) {
            console.error('Error creating course:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // PUT /courses/{id} - Update course (admin or course instructor)
    fastify.put(baseUri + '/:id', { schema: updateCourseSchema, preHandler: [fastify.authorize(['instructor', 'admin'])] }, async (req: FastifyRequest<{ Params: { id: string }, Body: CourseUpdateData }>, res: FastifyReply) => {
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

    // DELETE /courses/{id} - Soft delete course (admin only)
    fastify.delete(baseUri + '/:id', { schema: deleteCourseSchema, preHandler: [fastify.authorize(['admin'])] }, async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
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
