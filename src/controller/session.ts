import fp from 'fastify-plugin';
import { BASE_URL } from '../helpers/constants.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SessionModel } from '../model/session.js';

async function sessionController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/sessions`;

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
        }
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
}

export default fp(sessionController);