import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

function cors(fastify: FastifyInstance) {
    fastify.register(fastifyCors, {
        origin: [fastify.config.FRONTEND_URL, fastify.config.DASHBOARD_URL].filter(Boolean),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    });
}

export default fp(cors);