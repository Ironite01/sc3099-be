import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { StatsModel } from '../model/stats.js';
import { USER_ROLE_TYPES } from '../model/user.js';

async function statsController(fastify: FastifyInstance) {

    // GET /api/v1/stats/overview
    fastify.get(`${BASE_URL}/stats/overview`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    days: { type: 'integer', minimum: 1, maximum: 365, default: 7 },
                    course_id: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { days = 7, course_id } = req.query as { days?: number; course_id?: string };
        const overviewParams: { days?: number; course_id?: string } = { days };
        if (course_id !== undefined) {
            overviewParams.course_id = course_id;
        }
        const data = await StatsModel.getOverview(fastify.prisma, req.user as any, overviewParams);
        res.status(200).send(data);
    });

    // GET /api/v1/stats/sessions/:sessionId
    fastify.get(`${BASE_URL}/stats/sessions/:sessionId`, {
        schema: {
            params: {
                type: 'object',
                required: ['sessionId'],
                properties: { sessionId: { type: 'string' } }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { sessionId } = req.params as { sessionId: string };
        const data = await StatsModel.getSessionStatsById(fastify.prisma, req.user as any, sessionId);
        res.status(200).send(data);
    });

    fastify.get(`${BASE_URL}/stats/courses/:courseId`, {
        schema: {
            params: {
                type: 'object',
                required: ['courseId'],
                properties: { courseId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', format: 'date-time' },
                    end_date: { type: 'string', format: 'date-time' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { courseId } = req.params as { courseId: string };
        const { start_date, end_date } = req.query as { start_date?: string; end_date?: string };

        const rangeQuery: { start_date?: string; end_date?: string } = {};
        if (start_date !== undefined) {
            rangeQuery.start_date = start_date;
        }
        if (end_date !== undefined) {
            rangeQuery.end_date = end_date;
        }
        const data = await StatsModel.getCourseStatsById(fastify.prisma, req.user as any, courseId, rangeQuery);
        res.status(200).send(data);
    });

    fastify.get(`${BASE_URL}/stats/students/:studentId`, {
        schema: {
            params: {
                type: 'object',
                required: ['studentId'],
                properties: { studentId: { type: 'string' } }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { studentId } = req.params as { studentId: string };
        const data = await StatsModel.getStudentStatsById(fastify.prisma, req.user as any, studentId);
        res.status(200).send(data);
    });
}

export default fp(statsController);
