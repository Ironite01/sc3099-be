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
        preHandler: [fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const { is_active, semester, limit = 50, offset = 0 } = req.query as any;
        let req_instructor_id = (req.user as any)?.role === USER_ROLE_TYPES.ADMIN ? (req.query as any).instructor_id : undefined;

        const { items, total } = await CourseModel.getFilteredCourses(prisma, {
            is_active,
            semester,
            ...(req_instructor_id && { instructor_id: req_instructor_id }),
            limit,
            offset
        });
        res.status(200).send({ items, total, limit, offset });
    });

    fastify.get(`${uri}/:course_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['course_id'],
                properties: { course_id: { type: 'string' } }
            }
        }, preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const { course_id } = req.params as any;
        const course = await CourseModel.findById(prisma, course_id);
        res.status(200).send(course);
    });

    fastify.post(`${uri}/`, {
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
                    is_active: { type: 'boolean' },
                    instructor_id: { type: 'string' }
                },
                required: ['code', 'name', 'semester'],
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const course = await CourseModel.create(prisma, req.body as any);
        res.status(201).send(course);
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
                    is_active: { type: 'boolean' },
                    instructor_id: { type: 'string' }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const user = req.user as any;
        const course = await CourseModel.update(prisma, (req.params as any).course_id, req.body as any, user);
        res.status(200).send(course);
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
        const prisma = fastify.prisma;
        await CourseModel.delete(prisma, (req.params as any).course_id);
        res.status(204).send();
    });
}

export default fp(courseController);
