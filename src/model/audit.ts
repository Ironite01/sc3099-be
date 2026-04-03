import { randomUUID } from 'node:crypto';
import { AppError, BadRequestError } from './error.js';
import { DeviceModel } from './device.js';
import type { PrismaClient } from '../generated/prisma/client.js';

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
    FACE_ENROLLED = 'face_enrolled',
    SECURITY_VIOLATION = 'security_violation',
    DATA_EXPORTED = 'data_exported'
}

export const AuditModel = {
    getFilteredLogs: async function (prisma: PrismaClient, filters: {
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

            // Ensure limit is valid
            const validLimit = Math.max(1, Math.min(limit, 500));

            // Build where clause
            const where: any = {};

            if (user_id) where.user_id = user_id;
            if (action) where.action = action;
            if (resource_type) where.resource_type = resource_type;
            if (resource_id) where.resource_id = resource_id;
            if (success !== undefined) where.success = success;
            if (start_date) where.timestamp = { ...where.timestamp, gte: new Date(start_date) };
            if (end_date) where.timestamp = { ...where.timestamp, lte: new Date(end_date) };
            if (search) {
                where.OR = [
                    { users: { email: { contains: search, mode: 'insensitive' } } },
                    { resource_id: { contains: search, mode: 'insensitive' } },
                    { details: { contains: search, mode: 'insensitive' } }
                ];
            }

            const [total, logs] = await prisma.$transaction([
                prisma.audit_logs.count({ where }),
                prisma.audit_logs.findMany({
                    where,
                    select: {
                        id: true,
                        user_id: true,
                        users: { select: { email: true } },
                        action: true,
                        resource_type: true,
                        resource_id: true,
                        ip_address: true,
                        user_agent: true,
                        device_id: true,
                        details: true,
                        success: true,
                        timestamp: true
                    },
                    orderBy: { timestamp: 'desc' },
                    take: validLimit,
                    skip: offset
                })
            ]);

            const items = logs.map(row => ({
                id: row.id,
                user_id: row.user_id,
                user_email: row.users?.email,
                action: row.action,
                resource_type: row.resource_type,
                resource_id: row.resource_id,
                ip_address: row.ip_address,
                user_agent: row.user_agent,
                device_id: row.device_id,
                details: (() => {
                    try {
                        return typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
                    } catch {
                        return row.details;
                    }
                })(),
                success: row.success,
                timestamp: row.timestamp
            }));

            return { items, total, limit: validLimit, offset };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getSummary: async function (prisma: PrismaClient, days = 7) {
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);

            const [total, grouped] = await Promise.all([
                prisma.audit_logs.count({
                    where: { timestamp: { gte: cutoff } }
                }),
                prisma.audit_logs.groupBy({
                    by: ['action'],
                    where: { timestamp: { gte: cutoff } },
                    _count: true,
                    orderBy: { _count: { action: 'desc' } }
                })
            ]);

            const by_action: Record<string, number> = {};
            for (const group of grouped) {
                by_action[group.action] = group._count;
            }

            return {
                period_days: days,
                total_logs: total,
                by_action
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    log: async (
        prisma: PrismaClient,
        data:
            {
                userId: string | null,
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
            if (!deviceId && action !== AUDIT_ACTIONS.USER_CREATED && userId) {
                try {
                    const devices = await DeviceModel.getCurrentActiveDevice(prisma, userId);
                    deviceId = devices.id;
                } catch (err) {
                    console.error(`No device found for user with id ${userId} during audit logging`);
                }
            }
            await prisma.audit_logs.create({
                data: {
                    id: randomUUID(),
                    user_id: userId || null,
                    action: action,
                    resource_type: resourceType,
                    resource_id: resourceId,
                    ip_address: ipAddress,
                    user_agent: userAgent,
                    device_id: deviceId || null,
                    success: success,
                    details: JSON.stringify(details || {}),
                    timestamp: new Date()
                }
            });
        } catch (error) {
            console.error('Failed to insert audit log:', error);
        }
    }
};
