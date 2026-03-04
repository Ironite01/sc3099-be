import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import checkinController from './checkin.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController)
        .register(checkinController);
}

export default fp(controller);