import fastify from 'fastify';
import controller from './controller/index.js';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';
import fastifyEnv from '@fastify/env';
import envSchema from './services/envSchema.json' with { type: 'json' };
import pg from './services/pg.js';

const server = fastify();

server
    .register(fastifyMultipart, {
        limits: { fileSize: 50 * 1024 * 1024 }
    })
    .register(fastifyEnv, { schema: envSchema, dotenv: true })
    .register(pg)
    .register(fastifyFormbody)
    .register(controller);

server.listen({ port: 3000 }, (err: Error | null, address: string) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});