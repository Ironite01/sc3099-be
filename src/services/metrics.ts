import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyMetrics from 'fastify-metrics';
import client from 'prom-client';

// Keep a reference to custom metrics
export const customMetrics = {
    checkinsTotal: new client.Counter({
        name: 'saiv_checkins_total',
        help: 'Total number of check-in attempts',
        labelNames: ['status', 'course_id']
    }),
    flaggedCheckinsTotal: new client.Counter({
        name: 'saiv_flagged_checkins_total',
        help: 'Total number of flagged check-ins',
        labelNames: ['course_id']
    }),
    riskScoreDistribution: new client.Histogram({
        name: 'saiv_risk_score_distribution',
        help: 'Distribution of check-in risk scores',
        buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    }),
    livenessScoreDistribution: new client.Histogram({
        name: 'saiv_liveness_score_distribution',
        help: 'Distribution of liveness check scores',
        buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    }),
    faceMatchScoreDistribution: new client.Histogram({
        name: 'saiv_face_match_score_distribution',
        help: 'Distribution of face match scores',
        buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    })
};

const metricsPlugin: FastifyPluginAsync = async (fastify, opts) => {
    // Register fastify-metrics which automatically exposes default Node.js and HTTP metrics
    // on /metrics GET endpoint
    await fastify.register(fastifyMetrics as any, {
        endpoint: '/metrics',
        defaultMetrics: {
            enabled: true,
            register: client.register
        },
        routeMetrics: {
            enabled: true,
            registeredRoutesOnly: false
        }
    });

    // We can also attach the custom metrics instance to fastify for easier access
    fastify.decorate('customMetrics', customMetrics);
};

export default fp(metricsPlugin);
