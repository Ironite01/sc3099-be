import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import deviceController from './device.js';
import checkinController from './checkin.js';
import sessionController from './session.js';
import enrollmentController from './enrollment.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController)
        .register(deviceController)
        .register(sessionController)
        .register(enrollmentController)
        .register(checkinController);
}

export default fp(controller);