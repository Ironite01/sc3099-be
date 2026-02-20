import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController);
}

export default fp(controller);