import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { USER_ROLE_TYPES } from "../model/user.js";
import { EnrollmentModel } from "../model/enrollment.js";
import { BASE_URL } from "../helpers/constants.js";

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
}

export default fp(enrollmentController);