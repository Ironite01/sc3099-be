import fp from 'fastify-plugin';
import { type FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

declare module 'fastify' {
    interface FastifyInstance {
        prisma: PrismaClient
    }
}

interface POSTGRES_CONFIG {
    POSTGRES_USERNAME: string,
    POSTGRES_PASSWORD: string,
    POSTGRES_URI: string,
    POSTGRES_DB: string
}

const prismaPlugin: FastifyPluginAsync = fp(async (server, options) => {
    const { POSTGRES_USERNAME, POSTGRES_URI, POSTGRES_DB, POSTGRES_PASSWORD }: POSTGRES_CONFIG = server.config;
    const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: `postgres://${POSTGRES_USERNAME}:${POSTGRES_PASSWORD}@${POSTGRES_URI}/${POSTGRES_DB}` })
    })

    await prisma.$connect()

    server.decorate('prisma', prisma)

    server.addHook('onClose', async (server) => {
        await server.prisma.$disconnect()
    })
})

export default prismaPlugin