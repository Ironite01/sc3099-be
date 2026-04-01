import type { PoolClient } from 'pg';
import { AppError, BadRequestError } from './error.js';


export const AuditModel = {
    getFilteredLogs: async function (pgClient: PoolClient, filters: {
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
    }) {
        try {
            const {
                user_id,
                action,
                resource_type,
                resource_id,
                success,
                start_date,
                end_date,
                search,
                limit = 100,
                offset = 0
            } = filters;

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

            const countRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt
				 FROM audit_logs al
				 LEFT JOIN users u ON u.id = al.user_id
				 ${where}`,
                params
            );
            const total = parseInt(countRow.rows[0].cnt, 10);

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

            const items = dataRow.rows.map((row) => ({
                ...row,
                details: (() => {
                    try {
                        return typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
                    } catch {
                        return row.details;
                    }
                })()
            }));

            return { items, total, limit, offset };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getSummary: async function (pgClient: PoolClient, days = 7) {
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            const cutoffIso = cutoff.toISOString();

            const totalRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM audit_logs WHERE timestamp >= $1`,
                [cutoffIso]
            );

            const byActionRows = await pgClient.query(
                `SELECT action, COUNT(*) AS cnt
				 FROM audit_logs
				 WHERE timestamp >= $1
				 GROUP BY action
				 ORDER BY cnt DESC`,
                [cutoffIso]
            );

            const by_action: Record<string, number> = {};
            for (const row of byActionRows.rows) {
                by_action[row.action] = parseInt(row.cnt, 10);
            }

            return {
                period_days: days,
                total_logs: parseInt(totalRow.rows[0].cnt, 10),
                by_action
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
};
