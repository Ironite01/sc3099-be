import fastify from 'fastify';
import controller from './controller/index.js';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';

const server = fastify();

server
    .register(fastifyMultipart, {
        limits: { fileSize: 50 * 1024 * 1024 }
    })
    .register(fastifyFormbody)
    .register(controller);

server.listen({ port: 3000 }, (err: Error | null, address: string) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});