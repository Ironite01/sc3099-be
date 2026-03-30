import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { DeviceModel, PLATFORM_TYPES } from "../model/device.js";
import { USER_ROLE_TYPES } from "../model/user.js";
// import { deviceRegistrationTotal } from '../services/metrics.js';

async function deviceController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/devices`;

    // TODO: Confirm if this API is in use and refactor
    fastify.get(`${uri}/`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    user_id: { type: 'string' },
                    is_active: { type: 'boolean' },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { user_id, is_active, limit = 50, offset = 0 } = req.query as {
            user_id?: string;
            is_active?: boolean;
            limit?: number;
            offset?: number;
        };

        const params: any[] = [];
        const where: string[] = [];
        if (user_id) {
            params.push(user_id);
            where.push(`d.user_id = $${params.length}`);
        }
        if (typeof is_active === 'boolean') {
            params.push(is_active);
            where.push(`d.is_active = $${params.length}`);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pgClient = await (fastify as any).pg.connect();
        try {
            const countResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total
                 FROM devices d
                 ${whereClause}`,
                params
            );

            params.push(limit, offset);
            const result = await pgClient.query(
                `SELECT d.id, d.user_id, u.email, u.full_name, d.device_fingerprint,
                        d.device_name, d.platform, d.is_trusted, d.trust_score,
                        d.is_active,
                        TO_CHAR((d.first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at,
                        TO_CHAR((d.last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at,
                        d.total_checkins
                 FROM devices d
                 LEFT JOIN users u ON u.id = d.user_id
                 ${whereClause}
                 ORDER BY d.last_seen_at DESC
                 LIMIT $${params.length - 1}
                 OFFSET $${params.length}`,
                params
            );

            res.status(200).send({
                items: result.rows,
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            });
        } finally {
            pgClient.release();
        }
    });

    // TODO: Confirm if this API is in use and refactor
    fastify.post(`${uri}/register`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                properties: {
                    device_fingerprint: {
                        type: 'string',
                        minLength: 1
                    },
                    device_name: {
                        type: 'string'
                    },
                    platform: {
                        type: 'string',
                        enum: Object.values(PLATFORM_TYPES)
                    },
                    browser: {
                        type: 'string'
                    },
                    os_version: {
                        type: 'string'
                    },
                    app_version: {
                        type: 'string'
                    },
                    public_key: {
                        type: 'string',
                        minLength: 1
                    },
                    platformAttestation: {
                        type: 'object',
                        properties: {
                            integrityToken: {
                                type: 'string'
                            },
                            attestationObject: {
                                type: 'string'
                            }
                        },
                        additionalProperties: false
                    },
                    deviceDetectedEmulator: {
                        type: 'boolean'
                    },
                    deviceDetectedRooted: {
                        type: 'boolean'
                    }
                },
                required: ['device_fingerprint', 'public_key'],
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req?.user as any).sub;
        const body: any = req.body;

        const device = await DeviceModel.register(fastify.pg.transact, userId, body);

        res.status(201).send({
            id: device.id,
            device_fingerprint: device.device_fingerprint,
            device_name: device.device_name,
            platform: device.platform,
            is_trusted: device.is_trusted,
            trust_score: device.trust_score,
            is_active: device.is_active,
            attestation_passed: device.attestation_passed,
            is_emulator: device.is_emulator,
            is_rooted_jailbroken: device.is_rooted_jailbroken,
            first_seen_at: device.first_seen_at
        });
    });

    fastify.post(`${uri}/`, {
        preHandler: [fastify.authorize(1), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                required: ['device_fingerprint'],
                properties: {
                    device_fingerprint: { type: 'string', minLength: 4 },
                    device_name: { type: 'string' },
                    platform: { type: 'string' },
                    public_key: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub as string;
        const { device_fingerprint, device_name, platform, public_key } = req.body as any;
        const normalizedPublicKey = public_key ?? '';

        const pgClient = await (fastify as any).pg.connect();
        try {
            const result = await pgClient.query(
                `INSERT INTO devices (
                    id, user_id, device_fingerprint, device_name, platform, public_key,
                    public_key_created_at,
                    is_trusted, trust_score, is_active, first_seen_at, last_seen_at,
                    total_checkins, created_at, updated_at
                ) VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, $5,
                    NOW(),
                    FALSE, 'low', TRUE, NOW(), NOW(),
                    0, NOW(), NOW()
                )
                ON CONFLICT (user_id, device_fingerprint)
                DO UPDATE SET
                    device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
                    platform = COALESCE(EXCLUDED.platform, devices.platform),
                    public_key = COALESCE(EXCLUDED.public_key, devices.public_key),
                    is_active = TRUE,
                    last_seen_at = NOW(),
                    updated_at = NOW()
                RETURNING id, device_fingerprint, device_name, platform,
                          is_trusted, trust_score, is_active,
                          TO_CHAR((first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at,
                          TO_CHAR((last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at,
                          total_checkins`,
                [userId, device_fingerprint, device_name ?? null, platform ?? null, normalizedPublicKey]
            );

            res.status(201).send(result.rows[0]);
            // deviceRegistrationTotal.inc();
        } catch (err: any) {
            if (err.code === '23505' && err.constraint === 'devices_device_fingerprint_key') {
                res.status(409).send({ message: 'Device already registered to another account. Please unbind first.' });
                return;
            }
            throw err;
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/my-devices`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            const devices = await DeviceModel.getByUserId(pgClient, userId);

            res.status(200).send(
                devices.map(device => ({
                    id: device.id,
                    device_name: device.device_name,
                    platform: device.platform,
                    is_trusted: device.is_trusted,
                    trust_score: device.trust_score,
                    is_active: device.is_active,
                    first_seen_at: device.first_seen_at,
                    last_seen_at: device.last_seen_at,
                    total_checkins: device.total_checkins
                }))
            );
        } finally {
            pgClient.release();
        }
    });

    // TODO: Update the attestion and trust_score later
    fastify.patch(`${uri}/:device_id`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                properties: {
                    device_name: {
                        type: 'string',
                        minLength: 1
                    },
                    is_trusted: {
                        type: 'boolean'
                    },
                    is_active: {
                        type: 'boolean'
                    },
                    /*trust_score: {
                        type: 'string',
                        enum: ['low', 'medium', 'high']
                    },
                    attestation_passed: {
                        type: 'boolean'
                    }*/
                },
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const deviceId = (req?.params as any).device_id;
        const body: any = req.body;

        const updatedDevice = await DeviceModel.update(fastify.pg.transact, deviceId, req?.user, body);

        res.status(200).send({
            id: updatedDevice.id,
            device_name: updatedDevice.device_name,
            platform: updatedDevice.platform,
            is_trusted: updatedDevice.is_trusted,
            trust_score: updatedDevice.trust_score,
            is_active: updatedDevice.is_active,
            first_seen_at: updatedDevice.first_seen_at,
            last_seen_at: updatedDevice.last_seen_at,
            total_checkins: updatedDevice.total_checkins
        });
    });

    fastify.delete(`${uri}/:device_id`, {
        schema: {
            params: {
                type: 'object',
                required: ['device_id'],
                properties: { device_id: { type: 'string' } }
            }
        },
        preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            const userRole = (req?.user as any).role;
            const deviceId = (req?.params as any).device_id;

            await DeviceModel.delete(pgClient, deviceId, { userId, userRole });

            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
}

export default fp(deviceController);