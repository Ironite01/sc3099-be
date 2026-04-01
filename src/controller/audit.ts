import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { AuditModel } from '../model/audit.js';

async function auditController(fastify: FastifyInstance) {
    fastify.get(`${BASE_URL}/audit/`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    user_id: { type: 'string' },
                    action: { type: 'string' },
                    resource_type: { type: 'string' },
                    resource_id: { type: 'string' },
                    success: { type: 'boolean' },
                    start_date: { type: 'string' },
                    end_date: { type: 'string' },
                    search: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const query = req.query as {
            user_id?: string;
            action?: string;
            resource_type?: string;
            resource_id?: string;
            success?: boolean;
            start_date?: string;
            end_date?: string;
            search?: string;
            limit?: number;
            offset?: number;
        };
        const pgClient = await fastify.pg.connect();
        try {
            const result = await AuditModel.getFilteredLogs(pgClient as any, query);
            res.status(200).send(result);
        } finally {
            pgClient.release();
        }
    });

    // GET /api/v1/audit/summary  (admin only)
    fastify.get(`${BASE_URL}/audit/summary`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    days: { type: 'integer', minimum: 1, maximum: 365, default: 7 }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { days = 7 } = req.query as { days?: number };

        const pgClient = await fastify.pg.connect();
        try {
            const result = await AuditModel.getSummary(pgClient as any, days);
            res.status(200).send(result);
        } finally {
            pgClient.release();
        }
    });
}

export default fp(auditController);
