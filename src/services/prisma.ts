import fp from 'fastify-plugin';
import { type FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

declare module 'fastify' {
    interface FastifyInstance {
        prisma: PrismaClient
    }
}

const prismaPlugin: FastifyPluginAsync = fp(async (server, options) => {
    const { DATABASE_URL } = server.config;
    const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: DATABASE_URL })
    })

    await prisma.$connect()

    server.decorate('prisma', prisma)

    server.addHook('onClose', async (server) => {
        await server.prisma.$disconnect()
    })
})

export default prismaPlugin