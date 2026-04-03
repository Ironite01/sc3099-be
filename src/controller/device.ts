import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { DeviceModel, PLATFORM_TYPES } from "../model/device.js";
import { AUDIT_ACTIONS, AuditModel } from "../model/audit.js";
import { USER_ROLE_TYPES } from "../model/user.js";
// import { deviceRegistrationTotal } from '../services/metrics.js';

async function deviceController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/devices`;
    const resourceType = 'device';

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

        const prisma = await fastify.prisma;
        const result = await DeviceModel.getFiltered(prisma, {
            ...(user_id && { user_id }),
            ...(typeof is_active === 'boolean' && { is_active }),
            limit,
            offset
        });

        res.status(200).send({
            items: result.items,
            total: result.total,
            limit,
            offset
        });
    });

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
        const prisma = await fastify.prisma;
        const userId = (req?.user as any).sub;

        const device = await DeviceModel.register(prisma, userId, req.body as any);
        await AuditModel.log(prisma, {
            userId: userId,
            action: AUDIT_ACTIONS.DEVICE_REGISTERED,
            resourceType,
            resourceId: device.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] || '',
            deviceId: device.id,
            success: true,
            details: {
                device_name: device.device_name,
                platform: device.platform,
                is_emulator: device.is_emulator,
                is_rooted: device.is_rooted_jailbroken
            }
        });
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

    fastify.get(`${uri}/my-devices`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = await fastify.prisma;
        const userId = (req?.user as any).sub;
        const devices = await DeviceModel.getAllByUserId(prisma, userId);

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
        const prisma = await fastify.prisma;

        const deviceId = (req?.params as any).device_id;
        const body: any = req.body;

        const updatedDevice = await DeviceModel.update(prisma, deviceId, req?.user, body);

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
        const prisma = await fastify.prisma;
        const userId = (req?.user as any).sub;
        const userRole = (req?.user as any).role;
        const deviceId = (req?.params as any).device_id;

        await DeviceModel.delete(prisma, deviceId, { userId, userRole });

        res.status(204).send();
    });
}

export default fp(deviceController);