import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const rateLimitPlugin: FastifyPluginAsync = async (fastify, opts) => {
    // SECURITY-REQUIREMENTS:
    // API requests: 1000/hour
    // Login attempts: 60/hour (IP based) -> Configured in routes
    // Check-in attempts: 10/min -> Configured in routes
    // Registration: 10/hour -> Configured in routes

    const redisUrl = process.env.REDIS_URL;
    let redis: any = undefined;

    if (redisUrl) {
        try {
            const redisModule = require('ioredis');
            const IORedis = redisModule.default ?? redisModule;
            redis = new (IORedis as any)(redisUrl);
            redis.on('error', (err: Error) => {
                fastify.log.warn({ err }, 'Redis rate-limit backend error; falling back to in-memory if unavailable');
            });
            fastify.decorate('redis', redis);
        } catch (err) {
            fastify.log.warn('ioredis not installed; using in-memory rate limiting');
        }
    }

    await fastify.register(fastifyRateLimit, {
        global: false, // Default limits are off globally, turned on per route or set a low global default
        redis,
        keyGenerator: (req) => {
            // Try to rate limit by user if they are logged in, fallback to IP
            if ((req as any).user) {
                return (req as any).user.id;
            }
            return req.ip;
        },
        errorResponseBuilder: (req, context) => {
            return {
                statusCode: 429,
                error: 'Too Many Requests',
                message: `Rate limit exceeded, retry in ${context.after}`
            }
        }
    });
};

export default fp(rateLimitPlugin);
