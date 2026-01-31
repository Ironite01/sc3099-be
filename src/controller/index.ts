import fp from 'fastify-plugin';
import userController from './user.js';
import courseController from './course.js';
import sessionController from './session.js';
import type { FastifyInstance } from 'fastify';

async function controller(fastify: FastifyInstance) {
    fastify.register(userController);
    fastify.register(courseController);
    fastify.register(sessionController);
}

export default fp(controller);