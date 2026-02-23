import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { NotFoundError } from "../model/error.js";
import { UserModel } from "../model/user.js";

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/users`;

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
}

export default fp(userController);