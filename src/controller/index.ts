import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController);
}

export default fp(controller);