import { createClient } from 'redis';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
    interface FastifyInstance {
        redis: ReturnType<typeof createClient>;
    }
}

async function redis(fastify: FastifyInstance) {
    const client = createClient({
        url: fastify.config.REDIS_URL,
    });

    client.on('error', (err) => {
        console.error('Redis Client Error', err);
    });

    client.on('connect', () => {
        console.log('Redis Client Connected');
    });

    await client.connect();

    fastify.decorate('redis', client);

    fastify.addHook('onClose', async () => {
        await client.quit();
    });
}

export default fp(redis);
