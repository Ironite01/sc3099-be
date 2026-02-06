import fastify from 'fastify';
import controller from './controller/index.js';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';
import fastifyEnv from '@fastify/env';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import envSchema from './services/envSchema.json' with { type: 'json' };
import pg from './services/pg.js';

const server = fastify();

try {
    await server.register(fastifyEnv, { schema: envSchema, dotenv: true });
    await server.register(fastifyJwt, {
        secret: (server as any).config.JWT_SECRET!!,
        cookie: {
            cookieName: 'token',
            signed: false
        }
    })
        .register(fastifyMultipart, {
            limits: { fileSize: 50 * 1024 * 1024 }
        })
        .register(fastifyCookie)
        .register(pg)
        .register(fastifyFormbody)
        .register(controller);
    await server.listen({ port: (server as any).config.PORT!! }, (err: Error | null, address: string) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(`Server listening at ${address}`);
    });
} catch (e: any) {
    console.error(e.message);
}
