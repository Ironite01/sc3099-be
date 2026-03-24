import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import deviceController from './device.js';
import checkinController from './checkin.js';
import sessionController from './session.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController)
        .register(deviceController)
        .register(sessionController)
        .register(checkinController);
}

export default fp(controller);