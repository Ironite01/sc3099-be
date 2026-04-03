import type { PrismaClient, devices as Device } from '../generated/prisma/client.js';
import { AppError, BadRequestError, NotFoundError, ForbiddenError } from './error.js';
import { USER_ROLE_TYPES } from './user.js';
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';
import deviceAttestationService from '../services/attestation/index.js';
import { randomUUID } from 'crypto';

export enum PLATFORM_TYPES {
    IOS = 'ios',
    ANDROID = 'android',
    WEB = 'web',
    DESKTOP = 'desktop'
}

export enum TRUST_SCORE_TYPES {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high'
}

export type { Device };

export const DeviceModel = {
    register: async function register(
        prisma: PrismaClient,
        userId: string,
        payload: {
            device_fingerprint: string;
            device_name?: string;
            platform?: string;
            browser?: string;
            os_version?: string;
            app_version?: string;
            public_key: string;
            platformAttestation?: {
                integrityToken?: string;
                attestationObject?: string;
            }
            deviceDetectedEmulator?: boolean;
            deviceDetectedRooted?: boolean;
        }
    ) {
        const {
            device_fingerprint,
            device_name,
            platform,
            browser,
            os_version,
            app_version,
            public_key,
            platformAttestation,
            deviceDetectedEmulator,
            deviceDetectedRooted
        } = payload;

        // Check if the platform is valid if platform is provided in the payload
        if (platform && !Object.values(PLATFORM_TYPES).includes(platform as PLATFORM_TYPES)) {
            throw new BadRequestError("Invalid platform type");
        }

        const attestationResult = await deviceAttestationService({
            platform,
            platformAttestation,
            deviceDetectedEmulator,
            deviceDetectedRooted
        });

        return prisma.$transaction(async (tx) => {
            try {
                const existingDevice = await tx.devices.findFirst({
                    where: {
                        device_fingerprint,
                        user_id: userId
                    }
                });

                if (existingDevice && existingDevice.revocation_reason === `Deleted by ${USER_ROLE_TYPES.ADMIN}`) {
                    throw new ForbiddenError("This device has been revoked by an administrator");
                }

                // Upsert device
                const device = await tx.devices.upsert({
                    where: { device_fingerprint },
                    select: {
                        id: true,
                        device_fingerprint: true,
                        device_name: true,
                        platform: true,
                        is_trusted: true,
                        trust_score: true,
                        is_active: true,
                        first_seen_at: true,
                        is_emulator: true,
                        is_rooted_jailbroken: true,
                        attestation_passed: true
                    },
                    create: {
                        id: randomUUID(),
                        user_id: userId,
                        device_fingerprint,
                        device_name: device_name ?? null,
                        platform: platform ?? null,
                        public_key,
                        browser: browser ?? null,
                        os_version: os_version ?? null,
                        app_version: app_version ?? null,
                        attestation_passed: attestationResult.passed,
                        is_emulator: attestationResult.isEmulator,
                        is_rooted_jailbroken: attestationResult.isRootedJailbroken,
                        is_trusted: false,
                        trust_score: TRUST_SCORE_TYPES.LOW,
                        is_active: true,
                        first_seen_at: new Date(),
                        last_seen_at: new Date(),
                        total_checkins: 0,
                        public_key_created_at: new Date()
                    },
                    update: {
                        ...(payload.device_name !== undefined && { device_name: payload.device_name }),
                        ...(payload.platform !== undefined && { platform: payload.platform }),
                        ...(payload.browser !== undefined && { browser: payload.browser }),
                        ...(payload.os_version !== undefined && { os_version: payload.os_version }),
                        ...(payload.app_version !== undefined && { app_version: payload.app_version }),
                        public_key,
                        public_key_created_at: new Date(),
                        attestation_passed: attestationResult.passed,
                        is_emulator: attestationResult.isEmulator,
                        is_rooted_jailbroken: attestationResult.isRootedJailbroken,
                        is_active: true,
                        revoked_at: null,
                        revocation_reason: null,
                        last_seen_at: new Date()
                    }
                });

                // Deactivate all other devices for this user
                await tx.devices.updateMany({
                    where: {
                        user_id: userId,
                        is_active: true,
                        id: { not: device.id }
                    },
                    data: { is_active: false }
                });

                return device;
            } catch (err: any) {
                if (err instanceof AppError) throw err;
                throw new BadRequestError('Database operation failed');
            }
        });
    },
    getCurrentActiveDevice: async (prisma: PrismaClient, userId: string) => {
        try {
            return await prisma.devices.findFirstOrThrow({
                where: {
                    user_id: userId,
                    is_active: true
                },
                orderBy: { last_seen_at: 'desc' },
                select: {
                    id: true
                }
            });
        } catch (err: any) {
            if (err.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('No active device found for this user');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getAllByUserId: async (prisma: PrismaClient, userId: string, isActiveOnly = false) => {
        try {
            return await prisma.devices.findMany({
                where: {
                    user_id: userId,
                    ...(isActiveOnly && { is_active: true })
                },
                orderBy: { last_seen_at: 'desc' },
                select: {
                    id: true,
                    device_name: true,
                    platform: true,
                    is_trusted: true,
                    trust_score: true,
                    is_active: true,
                    first_seen_at: true,
                    last_seen_at: true,
                    total_checkins: true
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByFingerprintAndUserId: async (prisma: PrismaClient, userId: string, fingerprint: string) => {
        try {
            const device = await prisma.devices.findFirst({
                where: {
                    device_fingerprint: fingerprint,
                    user_id: userId
                },
                select: {
                    id: true,
                    device_name: true,
                    platform: true,
                    is_trusted: true,
                    trust_score: true,
                    is_active: true,
                    first_seen_at: true,
                    last_seen_at: true,
                    total_checkins: true,
                    revoked_at: true,
                    revocation_reason: true,
                    device_fingerprint: true,
                    public_key: true
                }
            });

            if (!device) {
                throw new NotFoundError('Device not found');
            }

            return device;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    update: async (prisma: PrismaClient, deviceId: string, user: any, payload: { device_name?: string; is_trusted?: boolean; is_active?: boolean; }) => {
        const userId = user.sub;
        const userRole = user.role;
        const { device_name, is_trusted, is_active } = payload;

        try {
            let updateData: any = {};

            if (userRole === USER_ROLE_TYPES.STUDENT) {
                if (!device_name && is_active === undefined) {
                    throw new BadRequestError();
                }
                if (device_name !== undefined) updateData.device_name = device_name;
                if (is_active !== undefined) updateData.is_active = is_active;
            } else if (userRole === USER_ROLE_TYPES.ADMIN) {
                if (is_trusted !== undefined) updateData.is_trusted = is_trusted;
                if (is_active !== undefined) updateData.is_active = is_active;
            } else {
                throw new ForbiddenError();
            }

            if (Object.keys(updateData).length === 0) {
                throw new BadRequestError();
            }

            return await prisma.$transaction(async (tx) => {
                const updated = await tx.devices.update({
                    where: USER_ROLE_TYPES.STUDENT ? { id: deviceId, user_id: userId } : { id: deviceId },
                    data: updateData,
                    select: {
                        id: true,
                        device_name: true,
                        platform: true,
                        is_trusted: true,
                        trust_score: true,
                        is_active: true,
                        first_seen_at: true,
                        last_seen_at: true,
                        total_checkins: true
                    }
                });

                // If activating this device, deactivate others
                if (is_active) {
                    await tx.devices.updateMany({
                        where: {
                            user_id: userId,
                            is_active: true,
                            id: { not: deviceId }
                        },
                        data: { is_active: false }
                    });
                }

                return updated;
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new ForbiddenError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    delete: async (prisma: PrismaClient, deviceId: string, user: { userId: string, userRole: string }) => {
        try {
            const { userId, userRole } = user;

            if (userRole !== USER_ROLE_TYPES.ADMIN && userRole !== USER_ROLE_TYPES.STUDENT) {
                throw new ForbiddenError();
            }

            await prisma.devices.update({
                where: user.userRole === USER_ROLE_TYPES.STUDENT ? { id: deviceId, user_id: userId } : { id: deviceId },
                data: {
                    is_active: false,
                    revoked_at: new Date(),
                    revocation_reason: `Deleted by ${userRole}`
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new ForbiddenError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    updateAfterCheckin: async (prisma: PrismaClient, deviceId: string, trustScore: TRUST_SCORE_TYPES) => {
        try {
            await prisma.devices.update({
                where: { id: deviceId },
                data: {
                    total_checkins: { increment: 1 },
                    last_seen_at: new Date(),
                    trust_score: trustScore
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError("Device not found");
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFiltered: async (prisma: PrismaClient, params: { user_id?: string; is_active?: boolean; limit?: number; offset?: number }) => {
        try {
            const { user_id, is_active, limit = 50, offset = 0 } = params;

            const where: any = {};
            if (user_id) where.user_id = user_id;
            if (typeof is_active === 'boolean') where.is_active = is_active;

            const [devices, total] = await Promise.all([
                prisma.devices.findMany({
                    where,
                    select: {
                        id: true,
                        user_id: true,
                        device_fingerprint: true,
                        device_name: true,
                        platform: true,
                        is_trusted: true,
                        trust_score: true,
                        is_active: true,
                        first_seen_at: true,
                        last_seen_at: true,
                        total_checkins: true,
                        users: { select: { email: true, full_name: true } }
                    },
                    orderBy: { last_seen_at: 'desc' },
                    take: limit,
                    skip: offset
                }),
                prisma.devices.count({ where })
            ]);

            return {
                items: devices.map(d => ({
                    id: d.id,
                    user_id: d.user_id,
                    email: d.users?.email,
                    full_name: d.users?.full_name,
                    device_fingerprint: d.device_fingerprint,
                    device_name: d.device_name,
                    platform: d.platform,
                    is_trusted: d.is_trusted,
                    trust_score: d.trust_score,
                    is_active: d.is_active,
                    first_seen_at: d.first_seen_at,
                    last_seen_at: d.last_seen_at,
                    total_checkins: d.total_checkins
                })),
                total
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
};
