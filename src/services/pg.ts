import postgres from '@fastify/postgres';
import fp from 'fastify-plugin';

// Reference:
// https://www.npmjs.com/package/@fastify/postgres

interface POSTGRES_CONFIG {
    POSTGRES_USERNAME: string,
    POSTGRES_PASSWORD: string,
    POSTGRES_URI: string,
    POSTGRES_DB: string
}

async function pg(fastify: any) {
    const { POSTGRES_USERNAME, POSTGRES_URI, POSTGRES_DB, POSTGRES_PASSWORD }: POSTGRES_CONFIG = fastify.config;
    fastify.register(postgres, {
        promise: true,
        connectionString: `postgres://${POSTGRES_USERNAME}:${POSTGRES_PASSWORD}@${POSTGRES_URI}/${POSTGRES_DB}`
    });
}

export default fp(pg);