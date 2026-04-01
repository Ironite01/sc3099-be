import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { USER_ROLE_TYPES } from '../model/user.js';
import { BASE_URL } from '../helpers/constants.js';

// These are APIs that are not from API specs
async function course_archiveController(fastify: any) {
    const uri = `${BASE_URL}/courses'`;

    fastify.get(`${uri}/available`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const studentId = (req.user as any)?.sub;
            const result = await pgClient.query(
                `SELECT c.*
                 FROM courses c
                 WHERE c.is_active = TRUE
                   AND NOT EXISTS (
                     SELECT 1
                     FROM enrollments e
                     WHERE e.course_id = c.id
                       AND e.student_id = $1
                       AND e.is_active = TRUE
                   )
                 ORDER BY c.code ASC`,
                [studentId]
            );
            res.status(200).send(result.rows);
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/register`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()],
        schema: {
            body: {
                type: 'object',
                required: ['course_id'],
                properties: {
                    course_id: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const studentId = (req.user as any)?.sub;
            const { course_id } = req.body as { course_id: string };

            const courseCheck = await pgClient.query(
                'SELECT id, is_active FROM courses WHERE id = $1',
                [course_id]
            );
            if (!courseCheck.rows.length) {
                return res.status(404).send({ detail: 'Course not found' });
            }
            if (!courseCheck.rows[0].is_active) {
                return res.status(400).send({ detail: 'Course is not active' });
            }

            const existing = await pgClient.query(
                `SELECT id, is_active
                 FROM enrollments
                 WHERE student_id = $1 AND course_id = $2`,
                [studentId, course_id]
            );

            if (existing.rows.length && existing.rows[0].is_active) {
                return res.status(409).send({ detail: 'Already registered for this course' });
            }

            await pgClient.query(
                `INSERT INTO enrollments (id, student_id, course_id, is_active, enrolled_at)
                 VALUES (gen_random_uuid()::text, $1, $2, TRUE, NOW())
                 ON CONFLICT (student_id, course_id)
                 DO UPDATE SET is_active = TRUE, dropped_at = NULL`,
                [studentId, course_id]
            );

            res.status(201).send({ message: 'Registration successful' });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(course_archiveController);
