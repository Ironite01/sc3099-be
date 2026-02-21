import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BASE_URL } from "../helpers/constants.js";
import { UserModel } from "../model/user.js";

async function userController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/user`;

    fastify.get(`${uri}/me`, { preHandler: [(fastify as any).authorize()] }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new Error("User not found!");
            }
            const user = await UserModel.getById(pgClient, userId);

            res.status(200).send({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                camera_consent: user.camera_consent,
                geolocation_consent: true,
                face_enrolled: false,
                created_at: user.created_at
            });
        } catch (e: any) {
            res.status(e?.statusCode || 500).send({ message: e.message });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(userController);