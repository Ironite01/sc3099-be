import fp from 'fastify-plugin';
import userController from './user.js';
import courseController from './course.js';
import sessionController from './session.js';
import checkinController from './checkin.js';
import statsController from './stats.js';
import enrollmentController from './enrollment.js';
import auditController from './audit.js';
import exportController from './export.js';
import type { FastifyInstance } from 'fastify';

async function controller(fastify: FastifyInstance) {
    fastify.register(userController);
    fastify.register(courseController);
    fastify.register(sessionController);
    fastify.register(checkinController, { prefix: '/api/v1/checkins' });
    fastify.register(statsController, { prefix: '/api/v1/stats' });
    fastify.register(enrollmentController, { prefix: '/api/v1/enrollments' });
    fastify.register(auditController, { prefix: '/api/v1/audit' });
    fastify.register(exportController, { prefix: '/api/v1/export' });
}

export default fp(controller);