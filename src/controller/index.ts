import fp from 'fastify-plugin';
import authController from './auth.js';
import type { FastifyInstance } from 'fastify';
import userController from './user.js';
import deviceController from './device.js';
import checkinController from './checkin.js';
import courseController from './course.js';
import sessionController from './session.js';
import statsController from './stats.js';
import auditController from './audit.js';
import exportController from './export.js';
import enrollmentController from './enrollment.js';

async function controller(fastify: FastifyInstance) {
    fastify.get('/health', async (_req, res) => {
        res.status(200).send({ status: 'healthy', api: 'up' });
    });

    fastify.get('/api/v1/health', async (_req, res) => {
        res.status(200).send({ status: 'healthy', api: 'up' });
    });

    fastify.register(authController)
        .register(userController)
        .register(deviceController)
        .register(courseController)
        .register(sessionController)
        .register(checkinController)
        .register(statsController)
        .register(auditController)
        .register(exportController)
        .register(enrollmentController);
}

export default fp(controller);
