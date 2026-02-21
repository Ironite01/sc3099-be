import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

function validation(fastify: any) {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        if (error.validation) {
            return reply.status(422).send({ error });
        }

        // Default 500
        reply.status(500).send(error);
    });
}

export default fp(validation);