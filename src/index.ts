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
        .register(controller)
        .register(errorHandler)
        .register(metricsPlugin);

    const address = await server.listen({ port: server.config.PORT!!, host: server.config.HOST!! });
    console.log(`Server listening at ${address}`);

    const mlHealthResponse = await MlServices.health.get();
    console.log(`ML Service Health: ${mlHealthResponse.status}`);
} catch (e: any) {
    console.error(e.message);
}