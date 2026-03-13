import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import checkinController from './checkin.js';
import courseController from './course.js';
import sessionController from './session.js';
import statsController from './stats.js';
import auditController from './audit.js';
import exportController from './export.js';
import enrollmentController from './enrollment.js';

async function controller(fastify: FastifyInstance) {
    fastify.register(authController)
        .register(userController)
        .register(courseController)
        .register(sessionController)
        .register(checkinController)
        .register(statsController)
        .register(auditController)
        .register(exportController)
        .register(enrollmentController);
}

export default fp(controller);