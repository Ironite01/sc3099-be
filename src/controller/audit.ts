import type { FastifyPluginAsync } from 'fastify';

const auditController: FastifyPluginAsync = async (fastify, opts) => {

    fastify.get('/', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const user = (request as any).user;
        if (user.role !== 'admin') {
            return reply.code(403).send({ detail: 'Forbidden: Admin access required.' });
        }

        const query = request.query as { limit?: string; offset?: string };
        const limit = parseInt(query.limit || '10');
        const offset = parseInt(query.offset || '0');

        const client = await fastify.pg.connect();
        try {
            const { rows: items } = await client.query(`
                SELECT * FROM audit_logs
                ORDER BY timestamp DESC
                LIMIT $1 OFFSET $2
            `, [limit, offset]);

            const { rows: totalRows } = await client.query('SELECT COUNT(*) as count FROM audit_logs');

            return {
                items,
                total: parseInt(totalRows[0].count)
            };
        } finally {
            client.release();
        }
    });

    fastify.get('/summary', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const user = (request as any).user;
        if (user.role !== 'admin') {
            return reply.code(403).send({ detail: 'Forbidden: Admin access required.' });
        }

        const query = request.query as { days?: string };
        const days = parseInt(query.days || '7');

        const client = await fastify.pg.connect();
        try {
            const { rows: countRows } = await client.query(`
                SELECT COUNT(*) as count FROM audit_logs
                WHERE timestamp > CURRENT_DATE - INTERVAL '$1 days'
            `, [days]);

            const { rows: actionRows } = await client.query(`
                SELECT action, COUNT(*) as count FROM audit_logs
                WHERE timestamp > CURRENT_DATE - INTERVAL '$1 days'
                GROUP BY action
            `, [days]);

            const by_action = actionRows.reduce((acc: any, row: any) => {
                acc[row.action] = parseInt(row.count);
                return acc;
            }, {});

            return {
                period_days: days,
                total_logs: parseInt(countRows[0].count),
                by_action: by_action
            };
        } finally {
            client.release();
        }
    });
}

export default auditController;
