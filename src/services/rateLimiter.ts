import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitError } from '../model/error.js';

export interface RateLimitOptions {
    limit: number;
    window: number;
    keyGenerator?: (request: FastifyRequest) => string;
}

declare module 'fastify' {
    interface FastifyInstance {
        rateLimit: (options?: RateLimitOptions) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

async function rateLimiter(fastify: FastifyInstance) {
    fastify.decorate('rateLimit', (options = {
        limit: 1000,
        window: 3600,
        keyGenerator: (req: FastifyRequest) => `rl:api:${(req.user as any)?.sub || req.ip}`
    }) => {
        return async (request: FastifyRequest, reply: FastifyReply) => {
            const keyGenerator = options.keyGenerator || ((req: FastifyRequest) => `${(req.user as any)?.sub || req.ip}`);
            const key = keyGenerator(request);
            const limit = fastify.config.REDIS_LIMIT_HIGH === 'true' ? 100000 : (options.limit || 1000);
            const window = options.window || 3600;

            try {
                const current = await fastify.redis.get(key);
                const currentCount = current ? parseInt(current, 10) : 0;

                if (currentCount >= limit) {
                    const ttl = await fastify.redis.ttl(key);
                    reply.header('Retry-After', ttl > 0 ? ttl : window);
                    throw new RateLimitError();
                }

                // Increment counter and set expiration
                const pipe = fastify.redis.multi();
                pipe.incr(key);
                pipe.expire(key, window);
                await pipe.exec();

                // Store rate limit info in reply object for logging
                (reply as any).rateLimitRemaining = limit - currentCount - 1;
                (reply as any).rateLimitReset = Date.now() + window * 1000;
            } catch (error: any) {
                if (error.statusCode === 429) {
                    throw error;
                }
                console.error('Rate limiter error:', error.message);
            }
        };
    });
}

export default fp(rateLimiter);
