import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { USER_ROLE_TYPES } from "../model/user.js";
import { AUDIT_ACTIONS, AuditModel } from "../model/audit.js";
import { EnrollmentModel } from "../model/enrollment.js";
import { BASE_URL } from "../helpers/constants.js";

function enrollmentController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/enrollments`;
    const resourceType = 'enrollment';

    fastify.get(`${uri}/my-enrollments`, { preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT]), fastify.rateLimit()] }, async (req: FastifyRequest, res: FastifyReply) => {
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
            preHandler: [fastify.authorize(2), fastify.rateLimit()]
        },
        async (req: FastifyRequest, res: FastifyReply) => {
            const pgClient = await fastify.pg.connect();
            try {
                const user = req.user as { sub: string; role: USER_ROLE_TYPES };
                const courseId = (req.params as { courseId: string }).courseId;
                const results = await EnrollmentModel.getStudentsByCourseEnrollment(pgClient, { id: user.sub, role: user.role }, courseId, req.query as { is_active?: boolean, search?: string });
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

    fastify.post(`${uri}/`, {
        schema: {
            body: {
                type: "object",
                properties: {
                    student_id: { type: "string" },
                    course_id: { type: "string" }
                },
                required: ["student_id", "course_id"]
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req.user as any)?.sub;
            const userRole = (req.user as any)?.role;
            const { student_id, course_id } = req.body as { student_id: string, course_id: string };

            const enrollment = await EnrollmentModel.create(pgClient, { id: userId, role: userRole }, { studentId: student_id, courseId: course_id });

            await AuditModel.log(pgClient, {
                userId: userId,
                action: AUDIT_ACTIONS.ENROLLMENT_ADDED,
                resourceType,
                resourceId: enrollment.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: { student_id: enrollment.student_id, course_id: enrollment.course_id }
            });

            res.status(201).send({
                id: enrollment.id,
                student_id: enrollment.student_id,
                course_id: enrollment.course_id,
                enrolled_at: enrollment.enrolled_at,
                is_active: enrollment.is_active
            });
        } finally {
            pgClient.release();
        }
    });

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
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub;
        const userRole = (req.user as any)?.role;
        const { course_id, student_emails, create_accounts = false } = req.body as any;
        const results = await EnrollmentModel.bulkCreate(fastify.pg.transact, { id: userId, role: userRole }, course_id, student_emails, create_accounts);
        res.status(200).send({
            course_id,
            enrolled: results.enrolled,
            already_enrolled: results.already_enrolled,
            not_found: results.not_found,
            created: results.created,
            details: results.details
        });
    });

    fastify.delete(`${uri}/:enrollment_id`, {
        schema: {
            params: {
                type: 'object',
                properties: {
                    enrollment_id: { type: 'string' }
                },
                required: ['enrollment_id']
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const user = req.user as { sub: string; role: USER_ROLE_TYPES };
            const enrollmentId = (req.params as { enrollment_id: string }).enrollment_id;
            const enrollment = await EnrollmentModel.delete(pgClient, { id: user.sub, role: user.role }, enrollmentId);

            if (enrollment) {
                const details: Record<string, string> = {};
                if (enrollment.student_id) {
                    details.student_id = enrollment.student_id;
                }
                if (enrollment.course_id) {
                    details.course_id = enrollment.course_id;
                }
                await AuditModel.log(pgClient, {
                    userId: user.sub,
                    action: AUDIT_ACTIONS.ENROLLMENT_REMOVED,
                    resourceType,
                    resourceId: enrollmentId,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'] || '',
                    success: true,
                    details
                });
            }

            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
}

export default fp(enrollmentController);