import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const privacyCleanupPlugin: FastifyPluginAsync = async (fastify, opts) => {
    // Schedule a background job to run periodically (e.g., once a day)
    // For demo purposes, we'll run it on startup and then set an interval for every 24 hours.

    const cleanupPII = async () => {
        let client;
        try {
            client = await fastify.pg.connect();
            fastify.log.info('Starting PII Privacy Cleanup job...');

            // 1. Delete check-ins where scheduled_deletion_at has passed
            // Usually this is 30 days after check-in.
            const resultCheckins = await client.query(`
                DELETE FROM checkins 
                WHERE scheduled_deletion_at IS NOT NULL 
                AND scheduled_deletion_at < CURRENT_TIMESTAMP
            `);

            // 2. Delete users where scheduled_deletion_at has passed
            const resultUsers = await client.query(`
                DELETE FROM users
                WHERE scheduled_deletion_at IS NOT NULL
                AND scheduled_deletion_at < CURRENT_TIMESTAMP
            `);

            fastify.log.info(`Cleanup complete: Removed ${resultCheckins.rowCount} checkins and ${resultUsers.rowCount} users.`);
        } catch (err) {
            fastify.log.error('PII Privacy Cleanup job failed: ' + err);
        } finally {
            if (client) {
                client.release();
            }
        }
    };

    // Run once on startup
    fastify.addHook('onReady', async () => {
        await cleanupPII();
        // and run every 24 hours (86400000 ms)
        setInterval(cleanupPII, 86400000);
    });
};

export default fp(privacyCleanupPlugin);
