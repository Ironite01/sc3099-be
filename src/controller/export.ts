import type { FastifyPluginAsync } from 'fastify';

const exportController: FastifyPluginAsync = async (fastify, opts) => {

    fastify.get('/session/:id', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        // const query = request.query as { format?: string };
        const client = await fastify.pg.connect();
        try {
            const { rows: records } = await client.query(`
                SELECT u.full_name as "Student Name", u.email as "Email",
                       c.checked_in_at as "Check-in Time", c.status as "Status", c.risk_score as "Risk Score",
                       c.latitude as "Latitude", c.longitude as "Longitude"
                FROM checkins c
                JOIN users u ON c.student_id = u.id
                WHERE c.session_id = $1
                ORDER BY c.checked_in_at ASC
            `, [id]);

            const { rows: enrollRows } = await client.query(`
                SELECT COUNT(*) as count FROM enrollments e
                JOIN sessions s ON e.course_id = s.course_id
                WHERE s.id = $1 AND e.is_active = true
            `, [id]);

            const totalEnrolled = parseInt(enrollRows[0].count);
            const totalCheckins = records.length;
            const attendanceRate = totalEnrolled > 0 ? (totalCheckins / totalEnrolled) * 100 : 0;

            return {
                session_id: id,
                summary: {
                    total_enrolled: totalEnrolled,
                    total_checkins: totalCheckins,
                    attendance_rate: attendanceRate
                },
                records: records
            };
        } finally {
            client.release();
        }
    });

}

export default exportController;
