import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as UserModel from '../model/user.js';
import { USER_ROLE_TYPES } from '../helpers/constants.js';

async function userController(fastify: FastifyInstance) {
    const uri = '/user';

    fastify.get('/me', { preHandler: [(fastify as any).authorize([USER_ROLE_TYPES.STUDENT, USER_ROLE_TYPES.INSTRUCTOR])] }, async (req: FastifyRequest, res: FastifyReply) => {
        try {
            if (req?.user) {
                return res.status(200).send({ message: "User authenticated!", user: req.user });
            }
            return res.status(400).send({ message: "Currently not logged in..." });
        } catch (e: any) {
            res.send({ error: e.message });
        }
    });

    fastify.post(`${uri}/login`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            const user = await UserModel.authenticate(pgClient, email, passwordClaim);

            // Generate JWT token
            const token = fastify.jwt.sign({
                id: user.id,
                email: user.email,
                role: user.role
            }, {
                expiresIn: '7d' // Token expires in 7 days
            });

            // Set token in HTTP-only cookie
            res.setCookie('access_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                sameSite: 'strict',
                path: '/',
                maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
            });

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