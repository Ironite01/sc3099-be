import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { NotFoundError, UnauthorizedError } from "../model/error.js";
import { AUDIT_ACTIONS, AuditModel } from "../model/audit.js";
import { USER_ROLE_TYPES, UserModel } from "../model/user.js";

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/users`;
    const resourceType = 'user';

    fastify.get(`${uri}/`,
        {
            schema: {
                querystring: {
                    type: "object",
                    properties: {
                        is_active: { type: "boolean" },
                        search: { type: "string" },
                        role: { type: "string", enum: Object.values(USER_ROLE_TYPES) },
                        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
                        offset: { type: "integer", minimum: 0, default: 0 }
                    }
                }
            },
            preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
        },
        async (req: FastifyRequest, res: FastifyReply) => {
            const pgClient = await fastify.pg.connect();
            try {
                const data = await UserModel.getByFilteredUsers(pgClient, req.query as any);
                res.status(200).send(data);
            } finally {
                pgClient.release();
            }
        });

    fastify.get(`${uri}/me`, { preHandler: [fastify.authorize(), fastify.rateLimit()] }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new NotFoundError();
            }
            const user = await UserModel.getById(pgClient, userId);

            res.status(200).send({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                camera_consent: user.camera_consent,
                geolocation_consent: user.geolocation_consent,
                face_enrolled: user.face_enrolled,
                created_at: user.created_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.put(`${uri}/me`, {
        schema: {
            body: {
                type: "object",
                properties: {
                    full_name: { type: "string" },
                    camera_consent: { type: "boolean" },
                    geolocation_consent: { type: "boolean" }
                }
            }
        },
        preHandler: [fastify.authorize(), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new NotFoundError();
            }
            const updatedUser = await UserModel.updateById(pgClient, userId, req.body as any);

            await AuditModel.log(pgClient, {
                userId,
                action: AUDIT_ACTIONS.USER_UPDATED,
                resourceType,
                resourceId: userId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: { updated_fields: Object.keys(req.body as any) }
            });

            res.status(200).send({
                id: updatedUser.id,
                email: updatedUser.email,
                full_name: updatedUser.full_name,
                role: updatedUser.role,
                camera_consent: updatedUser.camera_consent,
                geolocation_consent: updatedUser.geolocation_consent,
                face_enrolled: updatedUser.face_enrolled,
                created_at: updatedUser.created_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/:user_id`, {
        schema: {
            params: {
                type: "object",
                properties: {
                    user_id: { type: "string", format: 'uuid' }
                },
                required: ["user_id"]
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    },
        async (req: FastifyRequest, res: FastifyReply) => {
            const pgClient = await fastify.pg.connect();
            try {
                const requesterUserId = (req?.user as any).sub;
                const requesterUserRole = (req?.user as any).role;

                const { user_id: requestedUserId } = req?.params as any;
                if (!requestedUserId) {
                    throw new NotFoundError();
                }
                let user;
                if (requesterUserRole === USER_ROLE_TYPES.ADMIN) {
                    user = await UserModel.getById(pgClient, requestedUserId);
                } else if (requesterUserRole === USER_ROLE_TYPES.INSTRUCTOR) {
                    user = await UserModel.getEnrolledUserByInstructorId(pgClient, requesterUserId, requestedUserId);
                } else {
                    throw new UnauthorizedError();
                }

                res.status(200).send({
                    id: user!.id,
                    email: user!.email,
                    full_name: user!.full_name,
                    role: user!.role,
                    camera_consent: user!.camera_consent,
                    geolocation_consent: user!.geolocation_consent,
                    face_enrolled: user!.face_enrolled,
                    created_at: user!.created_at
                });
            } finally {
                pgClient.release();
            }
        });

    fastify.patch(`${uri}/:user_id`, {
        schema: {
            params: {
                type: "object",
                properties: {
                    user_id: { type: "string", format: 'uuid' }
                },
                required: ["user_id"]
            },
            body: {
                type: "object",
                properties: {
                    is_active: { type: "boolean" },
                    role: { type: "string", enum: Object.values(USER_ROLE_TYPES) }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { user_id } = req.params as any;
            if (!user_id) {
                throw new NotFoundError();
            }
            const user = await UserModel.patchUserById(pgClient, user_id, req.body as any);

            res.status(200).send({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                camera_consent: user.camera_consent,
                geolocation_consent: user.geolocation_consent,
                face_enrolled: user.face_enrolled,
                created_at: user.created_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/me/face/enroll`, {
        preHandler: [fastify.authorize(), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                properties: {
                    image: { type: 'string', minLength: 1 } // base64-encoded image string
                },
                required: ['image'],
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;

            const u = await UserModel.faceEnroll(pgClient, userId, (req.body as { image: string }).image);

            await AuditModel.log(pgClient, {
                userId,
                action: AUDIT_ACTIONS.FACE_ENROLLED,
                resourceType,
                resourceId: userId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: {
                    quality_score: u.quality_score,
                    face_enrolled: u.face_enrolled
                }
            });

            res.status(200).send(u);
        } finally {
            pgClient.release();
        }
    });
}

export default fp(userController);
