import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import {
    collectDefaultMetrics,
    Registry,
    Counter,
    Histogram,
    Gauge,
} from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'saiv_' });


export const loginTotal = new Counter({
    name: 'saiv_login_total',
    help: 'Total login attempts',
    labelNames: ['status'] as const, // status: success | failure
    registers: [registry],
});

export const registrationTotal = new Counter({
    name: 'saiv_registration_total',
    help: 'Total user registrations',
    labelNames: ['role'] as const,
    registers: [registry],
});

export const checkinTotal = new Counter({
    name: 'saiv_checkin_total',
    help: 'Total check-in submissions',
    labelNames: ['status'] as const, // approved | flagged | rejected
    registers: [registry],
});

export const checkinStatusCurrent = new Gauge({
    name: 'saiv_checkin_status_current',
    help: 'Current number of check-ins in each status (DB snapshot)',
    labelNames: ['status'] as const, // pending | approved | flagged | rejected | appealed
    registers: [registry],
});

export const deviceRegistrationTotal = new Counter({
    name: 'saiv_device_registration_total',
    help: 'Total device registrations (upserts)',
    registers: [registry],
});

export const riskScoreHistogram = new Histogram({
    name: 'saiv_checkin_risk_score',
    help: 'Distribution of check-in risk scores',
    buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    registers: [registry],
});

export const checkinDistanceHistogram = new Histogram({
    name: 'saiv_checkin_distance_meters',
    help: 'Distance from venue at check-in time (metres)',
    buckets: [10, 25, 50, 75, 100, 150, 200, 300, 500, 1000],
    registers: [registry],
});

export const httpRequestDuration = new Histogram({
    name: 'saiv_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    registers: [registry],
});

export const activeSessionsGauge = new Gauge({
    name: 'saiv_active_sessions',
    help: 'Number of currently active sessions',
    registers: [registry],
});

async function metricsPlugin(fastify: FastifyInstance) {
    // Track HTTP request durations via lifecycle hooks
    fastify.addHook('onRequest', async (req) => {
        (req as any)._metricsStart = process.hrtime.bigint();
    });

    fastify.addHook('onResponse', async (req, reply) => {
        const start: bigint | undefined = (req as any)._metricsStart;
        if (start !== undefined) {
            const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
            const route = (req.routeOptions as any)?.url ?? req.url ?? 'unknown';
            httpRequestDuration.observe(
                { method: req.method, route, status: String(reply.statusCode) },
                durationSec
            );
        }
    });

    // Expose /metrics endpoint — no authentication required for Prometheus scraping
    fastify.get('/metrics', { logLevel: 'warn' }, async (_req, reply) => {
        // Keep active session gauge aligned with current DB state.
        try {
            const activeCount = await (fastify as any).prisma.sessions.count({
                where: { status: 'active' }
            });
            activeSessionsGauge.set(activeCount);

            // Keep current check-in status totals aligned with DB state.
            const grouped = await (fastify as any).prisma.checkins.groupBy({
                by: ['status'],
                _count: { _all: true }
            });
            const statusMap = new Map<string, number>();
            for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
                statusMap.set(String(row.status), Number(row._count?._all || 0));
            }
            const knownStatuses = ['pending', 'approved', 'flagged', 'rejected', 'appealed'];
            for (const status of knownStatuses) {
                checkinStatusCurrent.set({ status }, statusMap.get(status) || 0);
            }
        } catch {
            // Keep metrics endpoint available even if DB read fails transiently.
        }

        reply.header('Content-Type', registry.contentType);
        return reply.send(await registry.metrics());
    });
}

export default fp(metricsPlugin);
