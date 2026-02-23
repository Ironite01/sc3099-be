import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLE_HIERARCHY, USER_ROLE_TYPES } from '../model/user.js';
import { ForbiddenError, UnauthorizedError } from '../model/error.js';

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
        async function (request: FastifyRequest, _reply: FastifyReply) {
            try {
                await request.jwtVerify();
            } catch (_err: any) {
                throw new UnauthorizedError();
            }

            const userRole = (request.user as { role: USER_ROLE_TYPES })?.role;

            if (typeof arg === 'number') {
                const userRoleLevel = USER_ROLE_HIERARCHY[userRole] || 0;

                if (userRoleLevel < arg) {
                    throw new ForbiddenError();
                }
            } else {
                if (typeof arg === "object" && (!userRole || !arg.includes(userRole))) {
                    throw new ForbiddenError();
                }
            }
        }
    );
}

export default fp(auth);
