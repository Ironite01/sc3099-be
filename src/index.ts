import fastify from 'fastify';
import controller from './controller/index.js';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';
import fastifyEnv from '@fastify/env';
import fastifyCookie from '@fastify/cookie';
import envSchema from './services/envSchema.json' with { type: 'json' };
import pg from './services/pg.js';
import schemaBootstrap from './services/schema.js';
import auth from './services/auth.js';
import cors from './services/cors.js';
import errorHandler from './services/errorHandler.js';
import metricsPlugin from './services/metrics.js';

const server = fastify({
    ajv: {
        customOptions: {
            removeAdditional: false,
            allErrors: true,
            strict: true
        }
    }
});

try {
    console.log('[startup] Registering fastifyEnv...');
    await server.register(fastifyEnv, { schema: envSchema, dotenv: true });
    console.log('[startup] ENV loaded, PORT:', (server as any).config.PORT);
    
    console.log('[startup] Registering plugins...');
    await server
        .register(fastifyMultipart, {
            limits: { fileSize: 50 * 1024 * 1024 }
        })
        .register(fastifyCookie)
        .register(auth)
        .register(pg)
        .register(schemaBootstrap)
        .register(fastifyFormbody)
        .register(cors)
        .register(metricsPlugin)
        .register(controller)
        .register(errorHandler);
    console.log('[startup] All plugins registered');

    console.log('[startup] Starting server listen...');
    const host = process.env.HOST || server.config.HOST || '0.0.0.0';
    const address = await server.listen({ port: (server as any).config.PORT!!, host });
    console.log(`Server listening at ${address}`);
} catch (e: any) {
    console.error('❌ STARTUP ERROR:', e?.message || e);
    console.error(e?.stack);
    process.exit(1);
}
