import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import deviceController from './device.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController)
        .register(deviceController);
}

export default fp(controller);