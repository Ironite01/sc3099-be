import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';

function toCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (v: unknown): string => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(','))
    ].join('\n');
}

async function exportController(fastify: FastifyInstance) {

    // GET /api/v1/export/attendance/:courseId
    fastify.get(`${BASE_URL}/export/attendance/:courseId`, {
        schema: {
            params: {
                type: 'object',
                required: ['courseId'],
                properties: { courseId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['csv', 'json'], default: 'csv' },
                    start_date: { type: 'string' },
                    end_date: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { courseId } = req.params as { courseId: string };
        const { format = 'csv', start_date, end_date } = req.query as {
            format?: string; start_date?: string; end_date?: string;
        };

        const pgClient = await fastify.pg.connect();
        try {
            // Verify course exists
            const courseRow = await pgClient.query(
                `SELECT id, code, name FROM courses WHERE id = $1`, [courseId]
            );
            if (!courseRow.rows.length) {
                return res.status(404).send({ message: 'Course not found' });
            }
            const course = courseRow.rows[0];

            const conditions: string[] = ['s.course_id = $1'];
            const params: unknown[] = [courseId];
            let p = 2;
            if (start_date) { conditions.push(`ci.checked_in_at >= $${p++}`); params.push(start_date); }
            if (end_date) { conditions.push(`ci.checked_in_at <= $${p++}`); params.push(end_date); }

            const dataRow = await pgClient.query(
                `SELECT
                   ci.student_id,
                   u.full_name AS student_name,
                   u.email AS student_email,
                   DATE(s.scheduled_start) AS session_date,
                   s.name AS session_name,
                   ci.status,
                   ci.checked_in_at,
                   ci.risk_score,
                   ci.distance_from_venue_meters,
                   ci.liveness_passed,
                   ci.face_match_passed
                 FROM checkins ci
                 JOIN users u ON u.id = ci.student_id
                 JOIN sessions s ON s.id = ci.session_id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY s.scheduled_start ASC, u.full_name ASC`,
                params
            );

            const rows = dataRow.rows.map(r => ({
                student_id: r.student_id,
                student_name: r.student_name,
                student_email: r.student_email,
                session_date: r.session_date instanceof Date
                    ? r.session_date.toISOString().split('T')[0] : String(r.session_date),
                session_name: r.session_name,
                status: r.status,
                checked_in_at: r.checked_in_at,
                risk_score: r.risk_score,
                distance_from_venue_meters: r.distance_from_venue_meters,
                liveness_passed: r.liveness_passed,
                face_match_passed: r.face_match_passed
            }));

            const safeCode = course.code.replace(/[^a-zA-Z0-9_-]/g, '_');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            if (format === 'json') {
                res.header('Content-Type', 'application/json');
                res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.json"`);
                return res.status(200).send(rows);
            }

            const csv = toCsv(rows as Record<string, unknown>[]);
            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.csv"`);
            return res.status(200).send(csv);
        } finally {
            pgClient.release();
        }
    });

    // GET /api/v1/export/session/:sessionId
    fastify.get(`${BASE_URL}/export/session/:sessionId`, {
        schema: {
            params: {
                type: 'object',
                required: ['sessionId'],
                properties: { sessionId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['csv', 'json'], default: 'csv' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { sessionId } = req.params as { sessionId: string };
        const { format = 'csv' } = req.query as { format?: string };

        const pgClient = await fastify.pg.connect();
        try {
            // Verify session exists
            const sessionRow = await pgClient.query(
                `SELECT s.id, s.name, s.course_id, c.code AS course_code
                 FROM sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = $1`,
                [sessionId]
            );
            if (!sessionRow.rows.length) {
                return res.status(404).send({ message: 'Session not found' });
            }
            const session = sessionRow.rows[0];

            const dataRow = await pgClient.query(
                `SELECT
                   ci.id AS checkin_id,
                   ci.student_id,
                   u.full_name AS student_name,
                   u.email AS student_email,
                   ci.status,
                   ci.checked_in_at,
                   ci.risk_score,
                   ci.distance_from_venue_meters,
                   ci.latitude,
                   ci.longitude,
                   ci.liveness_passed,
                   ci.liveness_score,
                   ci.face_match_passed,
                   ci.face_match_score,
                   ci.qr_code_verified,
                   ci.risk_factors
                 FROM checkins ci
                 JOIN users u ON u.id = ci.student_id
                 WHERE ci.session_id = $1
                 ORDER BY ci.checked_in_at ASC`,
                [sessionId]
            );

            const rows = dataRow.rows.map(r => ({
                checkin_id: r.checkin_id,
                student_id: r.student_id,
                student_name: r.student_name,
                student_email: r.student_email,
                status: r.status,
                checked_in_at: r.checked_in_at,
                risk_score: r.risk_score,
                distance_from_venue_meters: r.distance_from_venue_meters,
                latitude: r.latitude,
                longitude: r.longitude,
                liveness_passed: r.liveness_passed,
                liveness_score: r.liveness_score,
                face_match_passed: r.face_match_passed,
                face_match_score: r.face_match_score,
                qr_code_verified: r.qr_code_verified
            }));

            const safeName = session.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            if (format === 'json') {
                res.header('Content-Type', 'application/json');
                res.header('Content-Disposition', `attachment; filename="session_${safeName}_${timestamp}.json"`);
                return res.status(200).send(rows);
            }

            const csv = toCsv(rows as Record<string, unknown>[]);
            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', `attachment; filename="session_${safeName}_${timestamp}.csv"`);
            return res.status(200).send(csv);
        } finally {
            pgClient.release();
        }
    });
}

export default fp(exportController);
