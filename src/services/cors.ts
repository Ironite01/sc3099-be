import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

function cors(fastify: FastifyInstance) {
    fastify.register(fastifyCors, {
        origin: true, // TODO: Change this to allow only the frontend and dashboard
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    });
}

export default fp(cors);