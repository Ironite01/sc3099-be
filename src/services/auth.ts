import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLE_TYPES } from '../helpers/constants.js';

async function auth(fastify: any) {
    const secret = fastify.config.JWT_SECRET!!;

    fastify.register(fastifyJwt, {
        secret: secret,
        cookie: {
            cookieName: 'token',
            signed: false
        }
    })

    fastify.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.send(err);
        }
    });

    // Example usage on controller middleware : { preHandler: [fastify.auth_student] }
    for (const v of Object.values(USER_ROLE_TYPES)) {
        fastify.decorate(`auth_${v.toLowerCase()}`, async function (request: FastifyRequest, reply: FastifyReply) {
            try {
                await request.jwtVerify();
                if ((request?.user as { role: string }).role) {
                    if ((request.user as { role: string }).role !== v)
                        throw new Error("Unauthorized!");
                }
            } catch (err) {
                reply.send(err);
            }
        });
    }
}

export default fp(auth);