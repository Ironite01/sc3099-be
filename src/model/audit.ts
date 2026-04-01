import type { PoolClient } from 'pg';
import { AppError, BadRequestError } from './error.js';
import { DeviceModel } from './device.js';

export enum AUDIT_ACTIONS {
    LOGIN_SUCCESS = 'login_success',
    LOGIN_FAILED = 'login_failed',
    LOGOUT = 'logout',
    USER_CREATED = 'user_created',
    USER_UPDATED = 'user_updated',
    CHECKIN_ATTEMPTED = 'checkin_attempted',
    CHECKIN_APPROVED = 'checkin_approved',
    CHECKIN_FLAGGED = 'checkin_flagged',
    CHECKIN_REJECTED = 'checkin_rejected',
    CHECKIN_APPEALED = 'checkin_appealed',
    CHECKIN_REVIEWED = 'checkin_reviewed',
    SESSION_CREATED = 'session_created',
    SESSION_UPDATED = 'session_updated',
    SESSION_DELETED = 'session_deleted',
    ENROLLMENT_ADDED = 'enrollment_added',
    ENROLLMENT_REMOVED = 'enrollment_removed',
    DEVICE_REGISTERED = 'device_registered',
    FACE_ENROLLED = 'face_enrolled'
}

export const AuditModel = {
    getFilteredLogs: async function (pgClient: PoolClient, filters: {
        user_id?: string;
        action?: AUDIT_ACTIONS;
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
    },
    log: async (
        pgClient: PoolClient,
        data:
            {
                userId: string,
                action: AUDIT_ACTIONS,
                resourceType: string,
                resourceId: string,
                ipAddress: string,
                userAgent: string,
                deviceId?: string,
                success: boolean,
                details?: Record<string, any>
            }) => {
        try {
            let { userId, action, resourceType, resourceId, ipAddress, userAgent, deviceId, success, details } = data;
            if (!deviceId && action !== AUDIT_ACTIONS.USER_CREATED) {
                const devices = await DeviceModel.getByUserId(pgClient, userId);
                if (devices.length > 0) {
                    deviceId = devices[0]!.id;
                } else {
                    console.error(`No device found for user with id ${userId} during audit logging`);
                }
            }
            await pgClient.query(
                `INSERT INTO audit_logs 
                    (id, user_id, action, resource_type, resource_id, ip_address, user_agent, device_id, success, details, timestamp)
                 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                [userId, action, resourceType, resourceId, ipAddress, userAgent, deviceId, success, JSON.stringify(details || {})]
            );
        } catch (error) {
            console.error('Failed to insert audit log:', error);
        }
    }
};
