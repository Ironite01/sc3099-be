import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import User from '../model/user.js';
import { ROLE_TYPES } from '../helpers/constants.js';

async function userController(fastify: FastifyInstance) {
    const uri = '/user';

    fastify.post(`${uri}/login`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            const user = await User.authenticate(pgClient, email, passwordClaim);

            // Generate JWT token
            const token = fastify.jwt.sign({
                id: user.id,
                email: user.email,
                role: user.role
            }, {
                expiresIn: '7d' // Token expires in 7 days
            });

            // Set token in HTTP-only cookie
            res.setCookie('token', token, {
                httpOnly: true,
                secure: (fastify as any).config.NODE_ENV === 'production', // Use secure cookies in production
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

    // TODO: Seperate logic
    // This is for student only
    fastify.post(uri, async (req: FastifyRequest, res: FastifyReply) => {
        try {
            const pgClient = await fastify.pg.connect();
            const role: string = (req.body as any)!!.role!!.toLowerCase();

            // Validates whether or not the role in the request payload originates from the correct corresponding system
            if (!((req.port === parseInt((fastify as any).config.FE_PORT) && role === ROLE_TYPES.STUDENT) ||
                (req.port === parseInt((fastify as any).config.DASHBOARD_PORT) && (role === ROLE_TYPES.ADMIN || role === ROLE_TYPES.INSTRUCTOR || role === ROLE_TYPES.TA)))) {
                throw new Error("Role invalid or missing");
            }

            await User.create(pgClient, req.body);
            res.status(201).send({ message: "Successfully created user!" });
        } catch (err) {
            console.error(err);
        }
    });
}

export default fp(userController);