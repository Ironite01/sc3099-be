import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL, SALT_ROUNDS } from "../helpers/constants.js";
import { NotFoundError, UnauthorizedError, BadRequestError } from "../model/error.js";
import { USER_ROLE_TYPES, UserModel } from "../model/user.js";
import bcrypt from 'bcrypt';

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/users`;

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

            res.status(200).send(u);
        } finally {
            pgClient.release();
        }
    });

    // TODO: Everything below needs to be refactored and tested accordingly
    fastify.patch(`${BASE_URL}/admin/users/:user_id/deactivate`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()],
        schema: {
            params: {
                type: 'object',
                required: ['user_id'],
                properties: {
                    user_id: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { user_id } = req.params as { user_id: string };
            const result = await pgClient.query(
                `UPDATE users
                 SET is_active = FALSE, updated_at = NOW()
                 WHERE id = $1
                 RETURNING id`,
                [user_id]
            );

            if (!result.rows.length) {
                throw new NotFoundError();
            }

            res.status(200).send({ id: user_id, is_active: false });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${BASE_URL}/admin/users/bulk`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                required: ['users'],
                properties: {
                    users: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 500,
                        items: {
                            type: 'object',
                            required: ['email', 'password', 'full_name', 'role'],
                            properties: {
                                email: { type: 'string', format: 'email' },
                                password: { type: 'string', minLength: 8 },
                                full_name: { type: 'string', minLength: 2 },
                                role: {
                                    type: 'string',
                                    enum: [
                                        USER_ROLE_TYPES.STUDENT,
                                        USER_ROLE_TYPES.TA,
                                        USER_ROLE_TYPES.INSTRUCTOR,
                                        USER_ROLE_TYPES.ADMIN
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { users } = req.body as {
                users: Array<{ email: string; password: string; full_name: string; role: USER_ROLE_TYPES }>;
            };

            const created: any[] = [];
            for (const user of users) {
                const hashed_password = await bcrypt.hash(user.password, SALT_ROUNDS);
                const result = await pgClient.query(
                    `INSERT INTO users (
                        id, email, full_name, hashed_password, role,
                        is_active, camera_consent, geolocation_consent, face_enrolled,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid()::text, $1, $2, $3, $4,
                        TRUE, FALSE, FALSE, FALSE,
                        NOW(), NOW()
                    )
                    ON CONFLICT (email) DO NOTHING
                    RETURNING id, email, full_name, role, is_active, created_at`,
                    [user.email, user.full_name, hashed_password, user.role]
                );

                if (result.rows.length) {
                    created.push(result.rows[0]);
                }
            }

            res.status(201).send({
                users: created,
                created_count: created.length,
                requested_count: users.length
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(userController);
