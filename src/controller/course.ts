import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { CourseModel } from '../model/course.js';

async function courseController(fastify: any) {
    const uri = `${BASE_URL}/courses`;

    fastify.get(`${uri}/`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    is_active: { type: 'boolean' },
                    semester: { type: 'string' },
                    instructor_id: { type: 'string' },
                    limit: { type: 'integer', default: 50 },
                    offset: { type: 'integer', default: 0 }
                }
            }
        },
        preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { is_active, semester, limit = 50, offset = 0 } = req.query as any;
            let req_instructor_id = (req.query as any).instructor_id;

            const user = req.user as any;

            // For TAs and Instructors, we only allow them to view their own courses
            if (user && (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA)) {
                req_instructor_id = user.sub;
            }

            const { items, total } = await CourseModel.getFilteredCourses(pgClient, {
                is_active,
                semester,
                instructor_id: req_instructor_id,
                limit,
                offset
            });
            res.status(200).send({ items, total, limit, offset });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/:course_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['course_id'],
                properties: { course_id: { type: 'string' } }
            }
        }, preHandler: [fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { course_id } = req.params as any;
            const user = req.user as any;

            const course = await CourseModel.findById(pgClient, course_id, user);

            res.status(200).send(course);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(uri, {
        schema: {
            body: {
                type: 'object',
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
                },
                required: ['code', 'name', 'semester'],
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            const body = { ...(req.body as any) };

            if (!body.instructor_id) {
                body.instructor_id = user?.sub;
            }

            const course = await CourseModel.create(pgClient, body);
            res.status(201).send(course);
        } catch (err: any) {
            console.error('Error creating course:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.put(`${uri}/:course_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['course_id'],
                properties: { course_id: { type: 'string' } }
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
                    instructor_id: { type: 'string' }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as any;
            const course = await CourseModel.update(pgClient, (req.params as any).course_id, req.body as any, user);
            res.status(200).send(course);
        } finally {
            pgClient.release();
        }
    });

    fastify.delete(uri + '/:course_id', {
        schema: {
            params: {
                type: 'object',
                required: ['course_id'],
                properties: { course_id: { type: 'string' } }
            },
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            await CourseModel.delete(pgClient, (req.params as any).course_id);
            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
}

export default fp(courseController);
