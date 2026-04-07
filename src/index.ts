import fastify from 'fastify';
import controller from './controller/index.js';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';
import fastifyEnv from '@fastify/env';
import fastifyCookie from '@fastify/cookie';
import envSchema from './services/envSchema.json' with { type: 'json' };
import pg from './services/pg.js';
import auth from './services/auth.js';
import cors from './services/cors.js';
import errorHandler from './services/errorHandler.js';
import redis from './services/redis.js';
import rateLimiter from './services/rateLimiter.js';
import { MlServices } from './services/ml/index.js';
import metricsPlugin from './services/metrics.js';
import { SessionModel } from './model/session.js';

const server = fastify({
    ignoreTrailingSlash: true,
    ajv: {
        customOptions: {
            removeAdditional: false,
            allErrors: true,
            strict: true
        }
    }
});

let sessionLifecycleTimer: NodeJS.Timeout | null = null;

async function runSessionLifecycleSweep() {
    const pgClient = await (server as any).pg.connect();
    try {
        const autoActivated = await SessionModel.activateDueScheduledSessions(pgClient);
        const autoClosed = await SessionModel.closeExpiredActiveSessions(pgClient);

        if (autoActivated > 0 || autoClosed > 0) {
            console.log(`[session-lifecycle] auto-activated=${autoActivated}, auto-closed=${autoClosed}`);
        }
    } catch (e: any) {
        console.error(`[session-lifecycle] sweep failed: ${e?.message || e}`);
    } finally {
        pgClient.release();
    }
}

try {
    await server.register(fastifyEnv, { schema: envSchema, dotenv: true });
    await server
        .register(fastifyMultipart, {
            limits: { fileSize: 50 * 1024 * 1024 }
        })
        .register(fastifyCookie)
        .register(redis) // TODO: Use caching
        .register(rateLimiter)
        .register(auth)
        .register(pg)
        .register(fastifyFormbody)
        .register(cors)
        .register(errorHandler)
        .register(controller)
        .register(metricsPlugin);

    const address = await server.listen({ port: server.config.PORT!!, host: server.config.HOST!! });
    console.log(`Server listening at ${address}`);

    const lifecycleIntervalMs = Math.max(5000, Number(process.env.SESSION_LIFECYCLE_INTERVAL_MS || 30000));
    await runSessionLifecycleSweep();
    sessionLifecycleTimer = setInterval(() => {
        runSessionLifecycleSweep().catch((e: any) => {
            console.error(`[session-lifecycle] interval error: ${e?.message || e}`);
        });
    }, lifecycleIntervalMs);

    server.addHook('onClose', async () => {
        if (sessionLifecycleTimer) {
            clearInterval(sessionLifecycleTimer);
            sessionLifecycleTimer = null;
        }
    });

    const mlHealthResponse = await MlServices.health.get();
    console.log(`ML Service Health: ${mlHealthResponse.status}`);
} catch (e: any) {
    console.error(e.message);
}
