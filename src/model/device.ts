import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AppError, BadRequestError, NotFoundError, ForbiddenError } from './error.js';
import { USER_ROLE_TYPES } from './user.js';
import deviceAttestationService from '../services/attestation/index.js';

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

export type Device = {
    id: string;
    user_id: string;
    device_fingerprint: string;
    device_name?: string;
    platform?: string;
    browser?: string;
    os_version?: string;
    app_version?: string;
    public_key: string;
    public_key_created_at: Date;
    public_key_expires_at?: Date;
    attestation_passed: boolean;
    last_attestation_at?: Date;
    attestation_token?: string;
    is_trusted: boolean;
    trust_score: string;
    is_emulator: boolean;
    is_rooted_jailbroken: boolean;
    first_seen_at: Date;
    last_seen_at: Date;
    total_checkins: number;
    is_active: boolean;
    revoked_at?: Date;
    revocation_reason?: string;
};

export const DeviceModel = {
    register: async function register(
        transact: (fn: (pgClient: PoolClient) => Promise<any>) => Promise<any>,
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

        const deviceId = uuidv4();
        const now = new Date();

        // Default. This will change during the attendance taking flow
        const trustScore = TRUST_SCORE_TYPES.LOW;

        return transact(async (pgClient: PoolClient) => {
            try {
                const { rows } = await pgClient.query(
                    `INSERT INTO devices (
                        id, user_id, device_fingerprint, device_name, platform, browser, 
                        os_version, app_version, public_key, public_key_created_at,
                        attestation_passed, is_trusted, trust_score, is_emulator, 
                        is_rooted_jailbroken, first_seen_at, last_seen_at, total_checkins, is_active
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                    ON CONFLICT (device_fingerprint)
                    DO UPDATE SET
                        device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
                        platform = COALESCE(EXCLUDED.platform, devices.platform),
                        browser = COALESCE(EXCLUDED.browser, devices.browser),
                        os_version = COALESCE(EXCLUDED.os_version, devices.os_version),
                        app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
                        public_key = EXCLUDED.public_key,
                        public_key_created_at = EXCLUDED.public_key_created_at,
                        attestation_passed = EXCLUDED.attestation_passed,
                        is_emulator = EXCLUDED.is_emulator,
                        is_rooted_jailbroken = EXCLUDED.is_rooted_jailbroken,
                        is_active = TRUE,
                        revoked_at = NULL,
                        revocation_reason = NULL,
                        last_seen_at = EXCLUDED.last_seen_at
                    WHERE devices.user_id = EXCLUDED.user_id
                    RETURNING *`,
                    [
                        deviceId, userId, device_fingerprint, device_name || null, platform || null,
                        browser || null, os_version || null, app_version || null, public_key, now,
                        attestationResult.passed,
                        false,
                        trustScore,
                        attestationResult.isEmulator,
                        attestationResult.isRootedJailbroken,
                        now,
                        now,
                        0,
                        true
                    ]
                );

                if (rows.length === 0) {
                    const existing = await pgClient.query(
                        `SELECT user_id FROM devices WHERE device_fingerprint = $1 LIMIT 1`,
                        [device_fingerprint]
                    );
                    if (existing.rows[0]?.user_id && existing.rows[0].user_id !== userId) {
                        throw new BadRequestError('Device already registered to another account. Please unbind first.');
                    }
                    throw new BadRequestError('Failed to register device');
                }

                const device = rows[0] as Device;

                await pgClient.query(
                    `UPDATE devices SET is_active = false WHERE user_id = $1 AND is_active = true AND id != $2`,
                    [userId, device.id]
                );

                return device;
            } catch (err: any) {
                if (err instanceof AppError) throw err;
                throw new BadRequestError('Database operation failed');
            }
        });
    },
    getByUserId: async function getByUserId(pgClient: PoolClient, userId: string) {
        try {
            const { rows } = await pgClient.query(
                `SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
                [userId]
            );

            return rows as Device[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByFingerprint: async function getByFingerprint(pgClient: PoolClient, userId: string, fingerprint: string) {
        try {
            // We add an additional userId constraint since a device fingerprint should only belong to a single user
            const { rows } = await pgClient.query(
                `SELECT * FROM devices WHERE device_fingerprint = $1 AND user_id = $2`,
                [fingerprint, userId]
            );

            if (rows.length === 0) {
                throw new NotFoundError('Device not found');
            }

            return rows[0] as Device;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    update: async function update(
        transact: (fn: (pgClient: PoolClient) => Promise<any>) => Promise<any>,
        deviceId: string,
        user: any,
        payload: {
            device_name?: string;
            is_trusted?: boolean;
            is_active?: boolean;
        }
    ) {
        const userId = user.sub;
        const userRole = user.role.toLowerCase();
        let { device_name, is_trusted, is_active } = payload;

        const deRegisterDevices = async (pgClient: PoolClient, studentId: string, newDeviceId: string) => {
            return pgClient.query(
                `UPDATE devices SET is_active = false WHERE is_active = true AND id != $1 AND user_id = $2`,
                [newDeviceId, studentId]
            );
        }

        if (userRole === USER_ROLE_TYPES.STUDENT) { // User flow -> change device name ONLY
            if (!device_name) {
                throw new BadRequestError();
            }

            return transact(async (pgClient: PoolClient) => {
                const { rows } = await pgClient.query(
                    `UPDATE devices SET device_name = $3 ${is_active !== undefined ? `, is_active = $4` : ''} WHERE user_id = $1 AND id = $2 RETURNING *`,
                    [userId, deviceId, device_name].concat(is_active !== undefined ? [is_active] : [])
                );

                // Either error or the user does not own the device
                if (rows.length === 0) {
                    throw new ForbiddenError();
                }

                if (is_active) {
                    await deRegisterDevices(pgClient, userId, deviceId);
                }

                return rows[0] as Device;
            });
        }
        else if (userRole === USER_ROLE_TYPES.ADMIN) { // Admin flow -> change is_trusted and is_active
            const updates: string[] = [];
            const values: any[] = [];

            if (is_trusted !== undefined) {
                updates.push(`is_trusted = $${updates.length + 1}`);
                values.push(is_trusted);
            }
            if (is_active !== undefined) {
                updates.push(`is_active = $${updates.length + 1}`);
                values.push(is_active);
            }

            if (updates.length === 0) {
                throw new BadRequestError();
            }

            return transact(async (pgClient: PoolClient) => {
                const { rows } = await pgClient.query(
                    `UPDATE devices SET ${updates.join(', ')} WHERE id = $${updates.length + 1} RETURNING *`,
                    [...values, deviceId]
                );

                // Error or device not found
                if (rows.length === 0) {
                    throw new ForbiddenError();
                }

                const device = rows[0] as Device;

                if (is_active) {
                    await deRegisterDevices(pgClient, device.user_id, deviceId);
                }

                return device;
            });
        }
        else {
            throw new ForbiddenError();
        }
    },
    delete: async function deleteDevice(pgClient: PoolClient, deviceId: string, user: { userId: string, userRole: string }) {
        const { userId, userRole } = user;

        if (userRole !== USER_ROLE_TYPES.ADMIN && userRole !== USER_ROLE_TYPES.STUDENT) {
            throw new ForbiddenError();
        }

        const result = await pgClient.query(
            `DELETE FROM devices WHERE id = $1 ${userRole === USER_ROLE_TYPES.ADMIN ? '' : 'AND user_id = $2'} RETURNING id`,
            userRole === USER_ROLE_TYPES.ADMIN ? [deviceId] : [deviceId, userId]
        );

        // Either error or the user does not own the device
        if (result.rowCount === 0) {
            throw new ForbiddenError();
        }
    },
    updateAfterCheckin: async function updateAfterCheckin(pgClient: PoolClient, deviceId: string, riskScore: string) {
        const { rows } = await pgClient.query(
            `UPDATE devices SET total_checkins = total_checkins + 1, last_seen_at = NOW(), trust_score = $2
            WHERE id = $1 RETURNING *`,
            [deviceId, riskScore]
        );

        if (rows.length === 0) {
            throw new NotFoundError("Device not found");
        }

        return rows[0] as Device;
    },
    revoke: async function revoke(
        pgClient: PoolClient,
        deviceId: string,
        reason: string
    ) {
        const { rows } = await pgClient.query(
            `UPDATE devices SET revoked_at = NOW(), revocation_reason = $1, is_active = false 
            WHERE id = $2 RETURNING *`,
            [reason, deviceId]
        );

        if (rows.length === 0) {
            throw new NotFoundError();
        }

        return rows[0] as Device;
    }
};
