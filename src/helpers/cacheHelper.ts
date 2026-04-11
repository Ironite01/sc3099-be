export interface CacheOptions {
    ttl?: number; // Time to live in seconds, default 5 minutes
    key: string;
}

/**
 * Get value from Redis cache
 */
export async function getCache(redis: any, key: string): Promise<any | null> {
    try {
        const cached = await redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
        return null;
    } catch (err) {
        console.error(`Cache get error for key ${key}:`, err);
        return null;
    }
}

/**
 * Set value in Redis cache with TTL
 */
export async function setCache(
    redis: any,
    key: string,
    value: any,
    ttl: number = 300 // Default 5 minutes
): Promise<boolean> {
    try {
        await redis.setEx(key, ttl, JSON.stringify(value));
        return true;
    } catch (err) {
        console.error(`Cache set error for key ${key}:`, err);
        return false;
    }
}

/**
 * Delete cache by key
 */
export async function deleteCache(redis: any, key: string): Promise<boolean> {
    try {
        const deleted = await redis.del(key);
        return deleted > 0;
    } catch (err) {
        console.error(`Cache delete error for key ${key}:`, err);
        return false;
    }
}

/**
 * Generate cache key for stats endpoints
 */
export function generateStatsCacheKey(type: string, id?: string, params?: Record<string, any>): string {
    let key = `stats:${type}`;
    if (id) {
        key += `:${id}`;
    }
    if (params && Object.keys(params).length > 0) {
        const paramString = Object.entries(params)
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
            .map(([k, v]) => `${k}=${v}`)
            .join('|');
        key += `:${paramString}`;
    }
    return key;
}

/**
 * Invalidate all cache keys matching a pattern using SCAN
 */
export async function invalidateCachePattern(redis: any, pattern: string): Promise<number> {
    try {
        let cursor = '0';
        let deletedCount = 0;

        while (true) {
            const { cursor: newCursor, keys } = await redis.scan(cursor, {
                MATCH: pattern,
                COUNT: 100,
            });
            cursor = String(newCursor);

            if (keys.length > 0) {
                deletedCount += await redis.del(keys);
            }
            if (cursor === '0') {
                break;
            }
        }

        return deletedCount;
    } catch (err) {
        console.error(`Cache pattern invalidation error for pattern ${pattern}:`, err);
        return 0;
    }
}
