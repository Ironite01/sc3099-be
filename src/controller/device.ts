import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { DeviceModel, PLATFORM_TYPES } from "../model/device.js";

async function deviceController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/devices`;

    fastify.post(`${uri}/register`, {
        preHandler: [fastify.authorize()],
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

    fastify.get(`${uri}/my-devices`, {
        preHandler: [fastify.authorize()]
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
        preHandler: [fastify.authorize()],
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
        preHandler: [fastify.authorize()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            const deviceId = (req?.params as any).device_id;

            await DeviceModel.delete(pgClient, deviceId, userId);

            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
}

export default fp(deviceController);
