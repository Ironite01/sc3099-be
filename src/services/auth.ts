import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';

async function auth(fastify: any) {
    const secret = fastify.config.JWT_SECRET!!;

    fastify.register(fastifyJwt, {
        secret: secret,
        cookie: {
            cookieName: 'access_token',
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

    // Usage: { preHandler: [fastify.authorize(['instructor', 'admin'])] }
    fastify.decorate("authorize", function (roles: string[]) {
        return async function (request: FastifyRequest, reply: FastifyReply) {
            try {
                await request.jwtVerify();
                const userRole = (request?.user as { role: string }).role;
                if (!userRole || !roles.includes(userRole)) {
                    reply.status(403).send({ error: "Forbidden" });
                }
            } catch (err) {
                reply.status(401).send(err);
            }
        };
    });
}

export default fp(auth);