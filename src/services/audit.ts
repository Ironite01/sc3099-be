import type { PoolClient } from 'pg';
import crypto from 'crypto';

export type AuditAction =
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'user_created'
    | 'checkin_attempted'
    | 'checkin_approved'
    | 'checkin_rejected'
    | 'security_violation'
    | 'data_exported';

export async function logAuditAction(
    client: PoolClient,
    action: AuditAction,
    options: {
        userId?: string,
        resourceType?: string,
        resourceId?: string,
        ipAddress?: string,
        userAgent?: string,
        deviceId?: string,
        details?: any,
        success?: boolean
    }
) {
    const query = `
        INSERT INTO audit_logs (
            id, user_id, action, resource_type, resource_id, 
            ip_address, user_agent, device_id, details, success, timestamp
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, current_timestamp
        )
    `;

    const values = [
        crypto.randomUUID ? crypto.randomUUID() : (Math.random() * 1000000).toString(),
        options.userId || null,
        action,
        options.resourceType || null,
        options.resourceId || null,
        options.ipAddress || null,
        options.userAgent || null,
        options.deviceId || null,
        options.details ? JSON.stringify(options.details) : null,
        options.success !== undefined ? options.success : true
    ];

    try {
        await client.query(query, values);
    } catch (err) {
        console.error('Failed to write audit log:', err);
    }
}
