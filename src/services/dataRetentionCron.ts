import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { CronJob } from 'cron';

async function dataRetentionCronPlugin(fastify: FastifyInstance) {
    async function performDataRetention() {
        const now = new Date();
        const prisma = fastify.prisma;

        try {
            console.log(`[${now.toISOString()}] Starting data retention cleanup...`);

            // 1. Delete check-in records where scheduled_deletion_at has passed
            const checkinsDeleted = await prisma.checkins.deleteMany({
                where: {
                    scheduled_deletion_at: {
                        lte: now
                    }
                }
            });

            console.log(`Deleted ${checkinsDeleted.count} expired check-in records`);

            // 2. Delete users where scheduled_deletion_at has passed
            const usersDeleted = await prisma.users.deleteMany({
                where: {
                    scheduled_deletion_at: {
                        lte: now
                    }
                }
            });

            console.log(`Deleted ${usersDeleted.count} expired user records`);

            // 3. Log the cleanup action (for audit trail)
            await prisma.audit_logs.create({
                data: {
                    id: randomUUID(),
                    user_id: null, // System action
                    action: 'data_exported', // Use data_exported as closest match for system cleanup
                    resource_type: 'retention_cleanup',
                    resource_id: null,
                    ip_address: null,
                    user_agent: 'system',
                    device_id: null,
                    details: JSON.stringify({
                        checkins_deleted: checkinsDeleted.count,
                        users_deleted: usersDeleted.count,
                        timestamp: now.toISOString()
                    }),
                    success: true,
                    timestamp: now
                }
            });

            console.log(`Cleanup audit logged`);
            console.log(`[${now.toISOString()}] Data retention cleanup completed successfully`);

            return {
                success: true,
                checkinsDeleted: checkinsDeleted.count,
                usersDeleted: usersDeleted.count
            };
        } catch (error) {
            console.error('Data retention cleanup failed:', error);

            // Log the failure
            try {
                await prisma.audit_logs.create({
                    data: {
                        id: randomUUID(),
                        user_id: null,
                        action: 'security_violation',
                        resource_type: 'retention_cleanup',
                        resource_id: null,
                        ip_address: null,
                        user_agent: 'system',
                        device_id: null,
                        details: JSON.stringify({
                            error: String(error),
                            timestamp: now.toISOString()
                        }),
                        success: false,
                        timestamp: now
                    }
                });
            } catch (logError) {
                console.error('Failed to log cleanup failure:', logError);
            }

            throw error;
        }
    }

    // Schedule the cron job to run daily at 2:00 AM UTC
    // Format: second minute hour day month day-of-week
    const job = new CronJob('0 2 * * *', async () => {
        try {
            await performDataRetention();
        } catch (err) {
            console.error('Cron job error:', err);
        }
    }, null, true, 'UTC');

    // Expose cleanup function for manual triggers (e.g., admin endpoint)
    fastify.decorate('dataRetentionCleanup', performDataRetention);

    fastify.addHook('onClose', async () => {
        job.stop();
        console.log('Data retention cron job stopped');
    });

    console.log('Data retention cron job scheduled for daily execution at 2:00 AM UTC');
}

export default fp(dataRetentionCronPlugin);
