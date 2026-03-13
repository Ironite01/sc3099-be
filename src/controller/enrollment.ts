import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as bcrypt from 'bcrypt';
import { BASE_URL, SALT_ROUNDS } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';

async function enrollmentController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/enrollments`;

    // GET /api/v1/enrollments/course/:courseId
    fastify.get(`${uri}/course/:courseId`, {
        schema: {
            params: {
                type: 'object',
                required: ['courseId'],
                properties: {
                    courseId: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { courseId } = req.params as { courseId: string };
        const pgClient = await fastify.pg.connect();
        try {
            const result = await pgClient.query(
                `SELECT e.id, e.student_id, e.course_id, e.enrolled_at, e.is_active,
                        u.full_name AS student_name, u.email AS student_email,
                        u.face_enrolled
                 FROM enrollments e
                 JOIN users u ON u.id = e.student_id
                 WHERE e.course_id = $1 AND e.is_active = TRUE
                 ORDER BY e.enrolled_at DESC`,
                [courseId]
            );

            const students = result.rows.map((row: any) => ({
                id: row.id,
                student_id: row.student_id,
                course_id: row.course_id,
                student_name: row.student_name,
                student_email: row.student_email,
                face_enrolled: !!row.face_enrolled,
                status: row.is_active ? 'active' : 'inactive',
                enrolled_at: row.enrolled_at
            }));

            res.status(200).send({
                course_id: courseId,
                total_enrolled: students.length,
                students
            });
        } finally {
            pgClient.release();
        }
    });

    // POST /api/v1/admin/enrollments/
    fastify.post(`${BASE_URL}/admin/enrollments/`, {
        schema: {
            body: {
                type: 'object',
                required: ['student_id', 'course_id'],
                properties: {
                    student_id: { type: 'string' },
                    course_id: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { student_id, course_id } = req.body as { student_id: string; course_id: string };
        const pgClient = await fastify.pg.connect();
        try {
            const userCheck = await pgClient.query(
                'SELECT id, role, is_active FROM users WHERE id = $1',
                [student_id]
            );
            if (!userCheck.rows.length) {
                return res.status(404).send({ detail: 'Student not found' });
            }
            if (userCheck.rows[0].role !== USER_ROLE_TYPES.STUDENT) {
                return res.status(400).send({ detail: 'User is not a student' });
            }
            if (!userCheck.rows[0].is_active) {
                return res.status(400).send({ detail: 'Student account is inactive' });
            }

            const courseCheck = await pgClient.query(
                'SELECT id, is_active FROM courses WHERE id = $1',
                [course_id]
            );
            if (!courseCheck.rows.length) {
                return res.status(404).send({ detail: 'Course not found' });
            }
            if (!courseCheck.rows[0].is_active) {
                return res.status(400).send({ detail: 'Course is inactive' });
            }

            const existing = await pgClient.query(
                'SELECT id, is_active FROM enrollments WHERE student_id = $1 AND course_id = $2',
                [student_id, course_id]
            );

            if (existing.rows.length && existing.rows[0].is_active) {
                return res.status(200).send({
                    message: 'Student already enrolled',
                    enrollment_id: existing.rows[0].id,
                    student_id,
                    course_id
                });
            }

            const upsert = await pgClient.query(
                `INSERT INTO enrollments (id, student_id, course_id, is_active, enrolled_at)
                 VALUES (gen_random_uuid()::text, $1, $2, TRUE, NOW())
                 ON CONFLICT (student_id, course_id)
                 DO UPDATE SET is_active = TRUE, dropped_at = NULL
                 RETURNING id, student_id, course_id, is_active, enrolled_at`,
                [student_id, course_id]
            );

            res.status(201).send({
                message: 'Student enrolled successfully',
                enrollment: upsert.rows[0]
            });
        } finally {
            pgClient.release();
        }
    });

    // POST /api/v1/enrollments/bulk
    fastify.post(`${uri}/bulk`, {
        schema: {
            body: {
                type: 'object',
                required: ['course_id', 'student_emails'],
                properties: {
                    course_id: { type: 'string' },
                    student_emails: {
                        type: 'array',
                        items: { type: 'string', format: 'email' },
                        minItems: 1
                    },
                    create_accounts: { type: 'boolean', default: false }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const {
            course_id,
            student_emails,
            create_accounts = false
        } = req.body as { course_id: string; student_emails: string[]; create_accounts?: boolean };

        const pgClient = await fastify.pg.connect();
        try {
            const courseCheck = await pgClient.query(
                'SELECT id, is_active FROM courses WHERE id = $1',
                [course_id]
            );
            if (!courseCheck.rows.length) {
                return res.status(404).send({ detail: 'Course not found' });
            }
            if (!courseCheck.rows[0].is_active) {
                return res.status(400).send({ detail: 'Course is inactive' });
            }

            let enrolled = 0;
            let already_enrolled = 0;
            let not_found = 0;
            const details: any[] = [];

            for (const emailRaw of student_emails) {
                const email = emailRaw.trim().toLowerCase();
                if (!email) {
                    continue;
                }

                let userId: string | null = null;

                const userRes = await pgClient.query(
                    'SELECT id, role, is_active FROM users WHERE email = $1',
                    [email]
                );

                if (!userRes.rows.length) {
                    if (!create_accounts) {
                        not_found++;
                        details.push({ email, status: 'not_found' });
                        continue;
                    }

                    const generatedPassword = `Temp${Date.now()}!Aa1`;
                    const hashedPassword = bcrypt.hashSync(generatedPassword, SALT_ROUNDS);
                    const fullName = (email.split('@')[0] ?? '')
                        .replace(/[._-]+/g, ' ')
                        .replace(/\b\w/g, (c: string) => c.toUpperCase())
                        .trim() || 'Student';

                    const newUser = await pgClient.query(
                        `INSERT INTO users (
                            id, email, full_name, hashed_password, role,
                            is_active, face_embedding_hash, created_at, updated_at
                        ) VALUES (
                            gen_random_uuid()::text, $1, $2, $3, $4,
                            TRUE, 'autocreated', NOW(), NOW()
                        ) RETURNING id`,
                        [email, fullName, hashedPassword, USER_ROLE_TYPES.STUDENT]
                    );

                    userId = newUser.rows[0].id;
                } else {
                    const user = userRes.rows[0];
                    if (user.role !== USER_ROLE_TYPES.STUDENT) {
                        details.push({ email, status: 'not_student' });
                        continue;
                    }
                    if (!user.is_active) {
                        details.push({ email, status: 'inactive_account' });
                        continue;
                    }
                    userId = user.id;
                }

                const existing = await pgClient.query(
                    'SELECT id, is_active FROM enrollments WHERE student_id = $1 AND course_id = $2',
                    [userId, course_id]
                );

                if (existing.rows.length && existing.rows[0].is_active) {
                    already_enrolled++;
                    details.push({ email, status: 'already_enrolled', enrollment_id: existing.rows[0].id });
                    continue;
                }

                const upsert = await pgClient.query(
                    `INSERT INTO enrollments (id, student_id, course_id, is_active, enrolled_at)
                     VALUES (gen_random_uuid()::text, $1, $2, TRUE, NOW())
                     ON CONFLICT (student_id, course_id)
                     DO UPDATE SET is_active = TRUE, dropped_at = NULL
                     RETURNING id`,
                    [userId, course_id]
                );

                enrolled++;
                details.push({ email, status: 'enrolled', enrollment_id: upsert.rows[0].id });
            }

            res.status(200).send({
                course_id,
                enrolled,
                already_enrolled,
                not_found,
                details
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(enrollmentController);
