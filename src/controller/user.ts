import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { NotFoundError } from "../model/error.js";
import { USER_ROLE_TYPES, UserModel } from "../model/user.js";

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/users`;

    fastify.get(uri,
        {
            schema: {
                querystring: {
                    type: "object",
                    properties: {
                        is_active: { type: "boolean" },
                        search: { type: "string" },
                        role: { type: "string", enum: Object.values(USER_ROLE_TYPES) },
                        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
                        offset: { type: "integer", minimum: 0, default: 0 }
                    }
                }
            },
            preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN])]
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

    fastify.get(`${uri}/me`, { preHandler: [fastify.authorize()] }, async (req: FastifyRequest, res: FastifyReply) => {
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
        preHandler: [fastify.authorize()]
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
}

export default fp(userController);