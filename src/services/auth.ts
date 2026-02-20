import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLE_TYPES } from '../helpers/constants.js';

function auth(fastify: any) {
    const secret = fastify.config.JWT_SECRET!!;

    fastify.register(fastifyJwt, {
        secret: secret,
        cookie: {
            cookieName: 'access_token',
            signed: false
        }
    })

    // Usage: { preHandler: [authorize([USER_ROLE_TYPES.STUDENT, USER_ROLE_TYPES.TA])]}
    fastify.decorate("authorize", (roles?: USER_ROLE_TYPES[]) =>
        async function (request: FastifyRequest, reply: FastifyReply) {
            try {
                await request.jwtVerify();
                const userRole = (request.user as { role: string })?.role;

                if (roles && (!userRole || !roles.includes(userRole as USER_ROLE_TYPES))) {
                    return reply.status(403).send({ error: "Forbidden!" });
                }
            } catch (err) {
                return reply.status(401).send(err);
            }
        }
    );
}

export default fp(auth);