import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { NotFoundError } from '../model/error.js';
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
        const pgClient = await fastify.pg.connect();
        try {
            const overviewParams: { days?: number; course_id?: string } = { days };
            if (course_id !== undefined) {
                overviewParams.course_id = course_id;
            }
            const data = await StatsModel.getOverview(pgClient, overviewParams);
            res.status(200).send(data);
        } finally {
            pgClient.release();
        }
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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.TA, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { sessionId } = req.params as { sessionId: string };
        const pgClient = await fastify.pg.connect();
        try {
            const data = await StatsModel.getSessionStatsById(pgClient, sessionId);
            res.status(200).send(data);
        } catch (err: any) {
            if (err instanceof NotFoundError) {
                return res.status(404).send({ message: 'Session not found' });
            }
            throw err;
        } finally {
            pgClient.release();
        }
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

        const pgClient = await fastify.pg.connect();
        try {
            const rangeQuery: { start_date?: string; end_date?: string } = {};
            if (start_date !== undefined) {
                rangeQuery.start_date = start_date;
            }
            if (end_date !== undefined) {
                rangeQuery.end_date = end_date;
            }
            const data = await StatsModel.getCourseStatsById(pgClient, courseId, rangeQuery);
            res.status(200).send(data);
        } catch (err: any) {
            if (err instanceof NotFoundError) {
                return res.status(404).send({ detail: 'Course not found' });
            }
            throw err;
        } finally {
            pgClient.release();
        }
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
        const pgClient = await fastify.pg.connect();
        try {
            const data = await StatsModel.getStudentStatsById(pgClient, studentId);
            res.status(200).send(data);
        } catch (err: any) {
            if (err instanceof NotFoundError) {
                return res.status(404).send({ detail: 'Student not found' });
            }
            throw err;
        } finally {
            pgClient.release();
        }
    });
}

export default fp(statsController);
