import type { FastifyPluginAsync } from 'fastify';

const enrollmentController: FastifyPluginAsync = async (fastify, opts) => {

    fastify.get('/course/:id', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const client = await fastify.pg.connect();
        try {
            // Get total enrolled and student list
            const { rows: enrollRows } = await client.query(`
                SELECT e.id as enrollment_id, u.id as student_id, u.full_name as student_name, u.email as student_email 
                FROM enrollments e
                JOIN users u ON e.student_id = u.id
                WHERE e.course_id = $1 AND e.is_active = true
            `, [id]);

            return {
                course_id: id,
                total_enrolled: enrollRows.length,
                students: enrollRows
            };
        } finally {
            client.release();
        }
    });

    fastify.get('/my-enrollments', { preValidation: [(fastify as any).authenticate] }, async (request, reply) => {
        const user = (request as any).user;
        const client = await fastify.pg.connect();
        try {
            const { rows: enrollRows } = await client.query(`
                SELECT e.id, e.course_id, c.code as course_code, c.name as course_name, e.is_active 
                FROM enrollments e
                JOIN courses c ON e.course_id = c.id
                WHERE e.student_id = $1
            `, [user.id]);

            return enrollRows;
        } finally {
            client.release();
        }
    });
}

export default enrollmentController;
