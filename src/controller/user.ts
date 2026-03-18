import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { BASE_URL } from "../helpers/constants.js";
import { BadRequestError, NotFoundError } from "../model/error.js";
import { USER_ROLE_TYPES, UserModel } from "../model/user.js";
import { SALT_ROUNDS } from '../helpers/constants.js';

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/users`;

    fastify.get(`${uri}/`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    role: {
                        type: 'string',
                        enum: [
                            USER_ROLE_TYPES.STUDENT,
                            USER_ROLE_TYPES.TA,
                            USER_ROLE_TYPES.INSTRUCTOR,
                            USER_ROLE_TYPES.ADMIN
                        ]
                    },
                    is_active: { type: 'boolean' },
                    search: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const {
                role,
                is_active,
                search,
                limit = 50,
                offset = 0
            } = req.query as {
                role?: USER_ROLE_TYPES;
                is_active?: boolean;
                search?: string;
                limit?: number;
                offset?: number;
            };

            const where: string[] = [];
            const params: any[] = [];

            if (role) {
                params.push(role);
                where.push(`u.role = $${params.length}`);
            }
            if (typeof is_active === 'boolean') {
                params.push(is_active);
                where.push(`u.is_active = $${params.length}`);
            }
            if (search?.trim()) {
                params.push(`%${search.trim()}%`);
                where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
            }

            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const countResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total
                 FROM users u
                 ${whereClause}`,
                params
            );

            params.push(limit, offset);
            const itemsResult = await pgClient.query(
                `SELECT u.id, u.email, u.full_name, u.role, u.is_active,
                        u.face_enrolled, u.created_at
                 FROM users u
                 ${whereClause}
                 ORDER BY u.created_at DESC
                 LIMIT $${params.length - 1}
                 OFFSET $${params.length}`,
                params
            );

            res.status(200).send({
                items: itemsResult.rows,
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/me`, { preHandler: [(fastify as any).authorize()] }, async (req: FastifyRequest, res: FastifyReply) => {
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

    fastify.get(`${uri}/:user_id`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR])],
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
                `SELECT id, email, full_name, role, is_active,
                        camera_consent, geolocation_consent,
                        face_enrolled, created_at, last_login_at
                 FROM users
                 WHERE id = $1`,
                [user_id]
            );

            if (!result.rows.length) {
                throw new NotFoundError();
            }

            res.status(200).send(result.rows[0]);
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${uri}/:user_id`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])],
        schema: {
            params: {
                type: 'object',
                required: ['user_id'],
                properties: {
                    user_id: { type: 'string' }
                }
            },
            body: {
                type: 'object',
                properties: {
                    role: {
                        type: 'string',
                        enum: [
                            USER_ROLE_TYPES.STUDENT,
                            USER_ROLE_TYPES.TA,
                            USER_ROLE_TYPES.INSTRUCTOR,
                            USER_ROLE_TYPES.ADMIN
                        ]
                    },
                    is_active: { type: 'boolean' },
                    full_name: { type: 'string', minLength: 2 }
                },
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { user_id } = req.params as { user_id: string };
            const body = req.body as {
                role?: USER_ROLE_TYPES;
                is_active?: boolean;
                full_name?: string;
            };

            const updates: string[] = [];
            const values: any[] = [];
            let p = 1;

            if (body.role !== undefined) {
                updates.push(`role = $${p++}`);
                values.push(body.role);
            }
            if (body.is_active !== undefined) {
                updates.push(`is_active = $${p++}`);
                values.push(body.is_active);
            }
            if (body.full_name !== undefined) {
                updates.push(`full_name = $${p++}`);
                values.push(body.full_name);
            }

            if (!updates.length) {
                throw new BadRequestError('No fields provided for update');
            }

            values.push(user_id);
            const result = await pgClient.query(
                `UPDATE users
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE id = $${p}
                 RETURNING id, email, full_name, role, is_active,
                           camera_consent, geolocation_consent,
                           face_enrolled, created_at, last_login_at`,
                values
            );

            if (!result.rows.length) {
                throw new NotFoundError();
            }

            res.status(200).send(result.rows[0]);
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${BASE_URL}/admin/users/:user_id/deactivate`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])],
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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])],
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
                        $1, $2, $3, $4, $5,
                        TRUE, FALSE, FALSE, FALSE,
                        NOW(), NOW()
                    )
                    ON CONFLICT (email) DO NOTHING
                    RETURNING id, email, full_name, role, is_active, created_at`,
                    [uuidv4(), user.email, user.full_name, hashed_password, user.role]
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

    fastify.put(`${uri}/me`, {
        preHandler: [(fastify as any).authorize()],
        schema: {
            body: {
                type: 'object',
                properties: {
                    camera_consent: { type: 'boolean' },
                    geolocation_consent: { type: 'boolean' },
                    full_name: { type: 'string', minLength: 2 }
                },
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new NotFoundError();
            }

            const body = req.body as {
                camera_consent?: boolean;
                geolocation_consent?: boolean;
                full_name?: string;
            };

            const updates: string[] = [];
            const values: any[] = [];
            let p = 1;

            if (body.camera_consent !== undefined) {
                updates.push(`camera_consent = $${p++}`);
                values.push(body.camera_consent);
            }
            if (body.geolocation_consent !== undefined) {
                updates.push(`geolocation_consent = $${p++}`);
                values.push(body.geolocation_consent);
            }
            if (body.full_name !== undefined) {
                updates.push(`full_name = $${p++}`);
                values.push(body.full_name);
            }

            if (!updates.length) {
                throw new BadRequestError('No fields provided for update');
            }

            values.push(userId);
            const result = await pgClient.query(
                `UPDATE users
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE id = $${p}
                 RETURNING id, email, full_name, role, camera_consent, geolocation_consent, face_enrolled, created_at`,
                values
            );

            if (!result.rows.length) {
                throw new NotFoundError();
            }

            res.status(200).send(result.rows[0]);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/me/face/enroll`, {
        preHandler: [(fastify as any).authorize()],
        schema: {
            body: {
                type: 'object',
                properties: {
                    image: { type: 'string', minLength: 1 }
                },
                required: ['image'],
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new NotFoundError();
            }

            const user = await UserModel.getById(pgClient, userId);
            if (!user.camera_consent) {
                throw new BadRequestError('Camera consent required before face enrollment');
            }

            // Placeholder enrollment flow: mark user as face_enrolled.
            await pgClient.query(
                'UPDATE users SET face_enrolled = TRUE, updated_at = NOW() WHERE id = $1',
                [userId]
            );

            res.status(200).send({
                message: 'Face enrolled successfully',
                face_enrolled: true,
                quality_score: 0.9
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(userController);