import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import IORedis from 'ioredis';

const rateLimitPlugin: FastifyPluginAsync = async (fastify, opts) => {
    // SECURITY-REQUIREMENTS:
    // API requests: 1000/hour
    // Login attempts: 60/hour (IP based) -> Configured in routes
    // Check-in attempts: 10/min -> Configured in routes
    // Registration: 10/hour -> Configured in routes

    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380/0';

    // Create connection to redis for rate limiter
    const redis = new (IORedis as any)(REDIS_URL);

    fastify.decorate('redis', redis);

    await fastify.register(fastifyRateLimit, {
        global: false, // Default limits are off globally, turned on per route or set a low global default
        redis: redis,
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
