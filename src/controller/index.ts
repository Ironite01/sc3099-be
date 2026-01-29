import fp from 'fastify-plugin';
import userController from './user.js';
import type { FastifyInstance } from 'fastify';

async function controller(fastify: FastifyInstance) {
    fastify.register(userController);
}

export default fp(controller);