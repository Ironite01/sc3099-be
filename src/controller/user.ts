import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as UserModel from '../model/user.js';

async function userController(fastify: FastifyInstance) {
    const uri = '/user';

    fastify.post(`${uri}/login`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            const user = await UserModel.authenticate(pgClient, email, passwordClaim);
            res.status(200).send({ success: true, user });
        } catch (err: any) {
            console.error(err.message);
            res.status(401).send({ success: false, error: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(uri, async (req: FastifyRequest, res: FastifyReply) => {
        try {
            const parts = req.parts();
            const payload: any = {};
            for await (const part of parts) {
                if (part.type === 'file') {
                    // TODO: Handle profile picture
                    const profilePicture = part.file;
                } else {
                    payload[part.fieldname] = part.value;
                }
            }
            await UserModel.createUser(payload);
            res.status(201).send({ message: "Successfully created user!" });
        } catch (err) {
            console.error(err);
        }
    });
}

export default fp(userController);