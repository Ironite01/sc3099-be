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
}

export default fp(enrollmentController);