import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { USER_ROLE_TYPES } from "../model/user.js";
import { EnrollmentModel } from "../model/enrollment.js";
import { BASE_URL, SALT_ROUNDS } from "../helpers/constants.js";
import bcrypt from "bcrypt";

function enrollmentController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/enrollments`;

    fastify.get(`${uri}/my-enrollments`, { preHandler: fastify.authorize([USER_ROLE_TYPES.STUDENT]) }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const studentId = (req.user as any)?.sub;
            const enrollments = await EnrollmentModel.getEnrollmentsByStudentId(pgClient, studentId);

            res.status(200).send(enrollments.map(enrollment => ({
                id: enrollment.id,
                course_id: enrollment.course_id,
                course_code: enrollment.course_code,
                course_name: enrollment.course_name,
                semester: enrollment.semester,
                instructor_name: enrollment.instructor_name,
                enrolled_at: enrollment.enrolled_at,
                is_active: enrollment.is_active
            })));
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/course/:courseId`,
        {
            schema: {
                params: {
                    type: "object",
                    properties: {
                        courseId: { type: "string" }
                    },
                    required: ["courseId"]
                },
                querystring: {
                    type: "object",
                    properties: {
                        is_active: { type: "boolean" },
                        search: { type: "string" }
                    }
                }
            },
            preHandler: fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.TA])
        },
        async (req: FastifyRequest, res: FastifyReply) => {
            const pgClient = await fastify.pg.connect();
            try {
                const userId = (req.user as any)?.sub;
                const courseId = (req.params as { courseId: string }).courseId;
                const results = await EnrollmentModel.getStudentsByCourseEnrollment(pgClient, userId, courseId, req.query as { is_active?: boolean, search?: string });
                const students = results.students;

                res.status(200).send({
                    course_id: results.course_id,
                    course_code: results.course_code,
                    total_enrolled: results.total_enrolled,
                    students: students.map(student => ({
                        id: student.id,
                        student_id: student.student_id,
                        student_email: student.student_email,
                        student_name: student.student_name,
                        enrolled_at: student.enrolled_at,
                        is_active: student.is_active,
                        face_enrolled: student.face_enrolled
                    }))
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