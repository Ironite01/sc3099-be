import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';

async function auditController(fastify: FastifyInstance) {

    // GET /api/v1/audit/  (admin only)
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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const {
            user_id, action, resource_type, resource_id,
            success, start_date, end_date, search,
            limit = 100, offset = 0
        } = req.query as {
            user_id?: string; action?: string; resource_type?: string;
            resource_id?: string; success?: boolean; start_date?: string;
            end_date?: string; search?: string; limit?: number; offset?: number;
        };

        const pgClient = await fastify.pg.connect();
        try {
            const conditions: string[] = [];
            const params: unknown[] = [];
            let p = 1;

            if (user_id) {
                conditions.push(`al.user_id = $${p++}`);
                params.push(user_id);
            }
            if (action) {
                conditions.push(`al.action = $${p++}`);
                params.push(action);
            }
            if (resource_type) {
                conditions.push(`al.resource_type = $${p++}`);
                params.push(resource_type);
            }
            if (resource_id) {
                conditions.push(`al.resource_id = $${p++}`);
                params.push(resource_id);
            }
            if (success !== undefined) {
                conditions.push(`al.success = $${p++}`);
                params.push(success);
            }
            if (start_date) {
                conditions.push(`al.timestamp >= $${p++}`);
                params.push(start_date);
            }
            if (end_date) {
                conditions.push(`al.timestamp <= $${p++}`);
                params.push(end_date);
            }
            if (search) {
                conditions.push(`(u.email ILIKE $${p} OR al.resource_id::text ILIKE $${p} OR al.details ILIKE $${p})`);
                params.push(`%${search}%`);
                p++;
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Count total
            const countRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt
                 FROM audit_logs al
                 LEFT JOIN users u ON u.id = al.user_id
                 ${where}`,
                params
            );
            const total = parseInt(countRow.rows[0].cnt, 10);

            // Fetch page
            const dataParams = [...params, limit, offset];
            const dataRow = await pgClient.query(
                `SELECT al.id, al.user_id, u.email AS user_email,
                        al.action, al.resource_type, al.resource_id,
                        al.ip_address, al.user_agent, al.device_id,
                        al.details, al.success, al.timestamp
                 FROM audit_logs al
                 LEFT JOIN users u ON u.id = al.user_id
                 ${where}
                 ORDER BY al.timestamp DESC
                 LIMIT $${p} OFFSET $${p + 1}`,
                dataParams
            );

            const items = dataRow.rows.map(row => ({
                ...row,
                details: (() => {
                    try {
                        return typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
                    } catch {
                        return row.details;
                    }
                })()
            }));

            res.status(200).send({ items, total, limit, offset });
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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { days = 7 } = req.query as { days?: number };

        const pgClient = await fastify.pg.connect();
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);

            const totalRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM audit_logs WHERE timestamp >= $1`,
                [cutoff.toISOString()]
            );

            const byActionRows = await pgClient.query(
                `SELECT action, COUNT(*) AS cnt
                 FROM audit_logs
                 WHERE timestamp >= $1
                 GROUP BY action
                 ORDER BY cnt DESC`,
                [cutoff.toISOString()]
            );

            const by_action: Record<string, number> = {};
            for (const row of byActionRows.rows) {
                by_action[row.action] = parseInt(row.cnt, 10);
            }

            res.status(200).send({
                period_days: days,
                total_logs: parseInt(totalRow.rows[0].cnt, 10),
                by_action
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(auditController);
