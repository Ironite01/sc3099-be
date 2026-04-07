import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { USER_ROLE_TYPES, UserModel } from "../model/user.js";
import { SESSION_STATUS, SessionModel } from '../model/session.js';
import { EnrollmentModel } from '../model/enrollment.js';

async function adminController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/admin`;

    fastify.patch(`${uri}/users/:user_id/deactivate`, {
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
            const user = await UserModel.deactivateById(pgClient, user_id);

            res.status(200).send({
                id: user_id,
                is_active: user.is_active,
                email: user.email,
                message: "User deactivated successfully"
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${uri}/users/:user_id/activate`, {
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
            const user = await UserModel.activateById(pgClient, user_id);

            res.status(200).send({
                id: user_id,
                is_active: user.is_active,
                email: user.email,
                message: "User deactivated successfully"
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/users/bulk`, {
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
            const { users } = req.body as any;

            const createdUsers = await UserModel.createMultipleUsers(pgClient, users);

            const error = users.filter((u: any) => !createdUsers.some((cu: any) => cu.email === u.email)).map((u: any) => {
                return { email: u.email, reason: 'User creation failed (possibly due to duplicate email)' };
            });

            res.status(201).send({
                users: createdUsers,
                created: createdUsers.length,
                failed: users.length - createdUsers.length,
                error
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${uri}/sessions/:session_id/status`, {
        schema: {
            params: {
                type: 'object',
                required: ['session_id'],
                properties: { session_id: { type: 'string' } }
            },
            body: {
                type: 'object',
                required: ['status'],
                properties: {
                    status: { type: 'string', enum: Object.values(SESSION_STATUS) }
                }
            }
        }, preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const sessionId = (req.params as any).session_id;
            const nextStatus = (req.body as any).status;
            const session = await SessionModel.updateStatusById(pgClient, sessionId, nextStatus);

            res.status(200).send({
                id: session!.id,
                name: session!.name,
                status: session!.status,
                message: `Session status updated to '${nextStatus}'`
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/enrollments/`, {
        schema: {
            body: {
                type: 'object',
                required: ['student_id', 'course_id'],
                properties: {
                    student_id: { type: 'string' },
                    course_id: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { student_id, course_id } = req.body as { student_id: string; course_id: string };
            const enrollment = await EnrollmentModel.create(pgClient, req.user as any, { studentId: student_id, courseId: course_id });

            res.status(201).send({
                id: enrollment.id,
                student_id: enrollment.student_id,
                course_id: enrollment.course_id,
                is_active: enrollment.is_active,
                enrolled_at: enrollment.enrolled_at
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(adminController);
