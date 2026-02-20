import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLE_HIERARCHY, USER_ROLE_TYPES } from '../model/user.js';

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
    // Usage: { preHandler: [authorize(2)]}
    fastify.decorate("authorize", (arg: USER_ROLE_TYPES[] | number = 1) =>
        async function (request: FastifyRequest, reply: FastifyReply) {
            try {
                await request.jwtVerify();
                const userRole = (request.user as { role: USER_ROLE_TYPES })?.role;

                if (typeof arg === 'number') {
                    const userRoleLevel = USER_ROLE_HIERARCHY[userRole] || 0;

                    if (userRoleLevel < arg) {
                        throw new Error("Forbidden!");
                    }
                } else {
                    if (typeof arg === "object" && (!userRole || !arg.includes(userRole))) {
                        throw new Error("Forbidden!");
                    }
                }

            } catch (err: any) {
                return reply.status(401).send({ success: false, message: err.message });
            }
        }
    );
}

export default fp(auth);