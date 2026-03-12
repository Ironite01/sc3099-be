import type { FastifyPluginAsync } from 'fastify';

const checkinController: FastifyPluginAsync = async (fastify, opts) => {

    fastify.get('/', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const query = request.query as { limit?: string; offset?: string };
        const limit = parseInt(query.limit || '10');
        const offset = parseInt(query.offset || '0');

        const client = await fastify.pg.connect();
        try {
            const { rows: items } = await client.query(`
                SELECT c.*, u.full_name as student_name, s.name as session_name 
                FROM checkins c
                JOIN users u ON c.student_id = u.id
                JOIN sessions s ON c.session_id = s.id
                ORDER BY c.checked_in_at DESC
                LIMIT $1 OFFSET $2
            `, [limit, offset]);

            const { rows: totalRows } = await client.query('SELECT COUNT(*) as count FROM checkins');

            return {
                items,
                total: parseInt(totalRows[0].count),
                limit,
                offset
            };
        } finally {
            client.release();
        }
    });

    fastify.get('/session/:id', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const client = await fastify.pg.connect();
        try {
            const { rows: items } = await client.query(`
                SELECT c.id, c.status, c.checked_in_at, c.risk_score, 
                       u.full_name as student_name, u.email as student_email,
                       c.liveness_score, c.face_match_score, c.location_accuracy_meters
                FROM checkins c
                JOIN users u ON c.student_id = u.id
                WHERE c.session_id = $1
                ORDER BY c.checked_in_at DESC
            `, [id]);
            return items;
        } finally {
            client.release();
        }
    });

    fastify.get('/flagged', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const client = await fastify.pg.connect();
        try {
            const { rows: items } = await client.query(`
                SELECT c.id, c.session_id, c.student_id, c.status, c.checked_in_at, c.risk_score, 
                       u.full_name as student_name, s.name as session_name
                FROM checkins c
                JOIN users u ON c.student_id = u.id
                JOIN sessions s ON c.session_id = s.id
                WHERE c.status IN ('flagged', 'appealed')
                ORDER BY c.risk_score DESC, c.checked_in_at DESC
            `);

            return {
                items,
                total: items.length
            };
        } finally {
            client.release();
        }
    });

    fastify.get('/my-checkins', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const user = (request as any).user;
        const client = await fastify.pg.connect();
        try {
            const { rows: items } = await client.query(`
                SELECT c.id, c.status, c.checked_in_at, c.risk_score, s.name as session_name
                FROM checkins c
                JOIN sessions s ON c.session_id = s.id
                WHERE c.student_id = $1
                ORDER BY c.checked_in_at DESC
            `, [user.id]);
            return items;
        } finally {
            client.release();
        }
    });

    fastify.post('/', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const user = (request as any).user;
        const body = request.body as any;
        const client = await fastify.pg.connect();
        try {
            // Check if already checked in
            const { rows: existing } = await client.query('SELECT id FROM checkins WHERE session_id = $1 AND student_id = $2', [body.session_id, user.id]);
            if (existing.length > 0) return reply.code(400).send({ detail: 'Already checked in' });

            // Dummy Risk score logic (Liveness, Face, Device, Geo)
            let risk_score = 0;
            if (body.liveness_challenge_response) {
                // Should call Face Service, but we simulate success in testing
                risk_score += 0.05;
            } else {
                risk_score += 0.3; // High risk if liveness skipped implicitly via missing challenge
            }

            // Dummy status evaluation based on thresholds
            let status = 'approved';
            if (risk_score > 0.5) status = 'flagged';
            if (risk_score > 0.8) status = 'rejected';

            const { rows: checkinRows } = await client.query(`
                INSERT INTO checkins (
                    id, session_id, student_id, status, checked_in_at, latitude, longitude, location_accuracy_meters, risk_score
                ) VALUES (
                    $1, $2, $3, $4, current_timestamp, $5, $6, $7, $8
                ) RETURNING id, status, checked_in_at, risk_score
            `, [
                crypto.randomUUID ? crypto.randomUUID() : (Math.random() * 1000000).toString(),
                body.session_id, user.id, status, body.latitude, body.longitude,
                body.location_accuracy_meters || 10.0, risk_score
            ]);

            // Track custom Prometheus metrics
            const customMetrics = (fastify as any).customMetrics;
            if (customMetrics) {
                customMetrics.checkinsTotal.inc({ status });
                if (status === 'flagged') customMetrics.flaggedCheckinsTotal.inc();
                customMetrics.riskScoreDistribution.observe(risk_score);
            }

            return reply.code(201).send(checkinRows[0]);
        } catch (err: any) {
            return reply.code(400).send({ detail: err.message });
        } finally {
            client.release();
        }
    });
}

export default checkinController;
