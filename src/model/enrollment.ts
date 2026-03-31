import type Course from "./course.js";
import { AppError, BadRequestError, NotFoundError } from "./error.js";
import { USER_ROLE_TYPES } from "./user.js";

export type Enrollment = {
    id: string;
    student_id: string;
    course_id: string;
    is_active: boolean;
    enrolled_at: Date;
    dropped_at?: Date;
}

export const EnrollmentModel = {
    getEnrollmentsByStudentId: async (pgClient: any, studentId: string): Promise<(Enrollment & { instructor_name: string, course_code: string, course_name: string, semester: string })[]> => {
        try {
            if (!studentId) {
                throw new NotFoundError();
            }

            // We do not consider if course and enrollments are active or not
            const { rows } = await pgClient.query(
                `SELECT c.name as course_name, c.code as course_code, c.semester, c.id as course_id, u.full_name as instructor_name, e.enrolled_at, e.id, e.is_active
                 FROM enrollments e
                 JOIN courses c ON c.id = e.course_id
                 JOIN users u ON u.id = c.instructor_id
                 WHERE e.student_id = $1
                 ORDER BY e.enrolled_at DESC`,
                [studentId]
            );

            return rows as (Enrollment & { instructor_name: string, course_code: string, course_name: string, semester: string })[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getStudentsByCourseEnrollment: async (pgClient: any, userId: string, courseId: string, { is_active = true, search }: { is_active?: boolean, search?: string }): Promise<{ course_id: string; course_code: string; total_enrolled: number; students: (Enrollment & { student_name: string, student_email: string, face_enrolled: boolean })[] }> => {
        try {
            if (!courseId || !userId) {
                throw new NotFoundError();
            }

            // TODO: Check if course is active

            // Check if instructor/TA is in the (active) course - assume TA => instructor in this session table
            const userInCourse = await pgClient.query(
                `SELECT 1 FROM sessions s
     WHERE s.course_id = $1 AND s.instructor_id = $2`,
                [courseId, userId]
            );
            // We do not allow user to view enrollments outside of their own courses
            if (userInCourse.rowCount === 0) {
                throw new NotFoundError();
            }

            const totalEnrolledResult = await pgClient.query(
                `SELECT COUNT(*) FROM enrollments e
     WHERE e.course_id = $1 AND e.is_active = $2`,
                [courseId, is_active]
            );
            const totalEnrolled = parseInt(totalEnrolledResult.rows[0].count || "0");

            const searchQuery = search ? `%${search}%` : null;
            const values = searchQuery ? [courseId, is_active, searchQuery] : [courseId, is_active];

            const { rows } = await pgClient.query(
                `SELECT e.id, e.student_id, e.course_id, e.is_active, e.enrolled_at, u.full_name as student_name, u.email as student_email, u.face_enrolled as face_enrolled, c.code as course_code
     FROM enrollments e
     JOIN users u ON e.student_id = u.id
     JOIN courses c ON e.course_id = c.id
     WHERE e.course_id = $1 AND e.is_active = $2 ${searchQuery ? 'AND (u.full_name ILIKE $3 OR u.email ILIKE $3)' : ''}`,
                values
            );

            return {
                course_id: courseId,
                course_code: rows[0]?.course_code || "",
                total_enrolled: totalEnrolled,
                students: rows as (Enrollment & { student_name: string, student_email: string, face_enrolled: boolean })[] || []
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (pgClient: any, user: { role: USER_ROLE_TYPES, id: string }, payload: { studentId: string, courseId: string }): Promise<Enrollment> => {
        try {
            const { studentId, courseId } = payload;
            if (!studentId || !courseId) {
                throw new NotFoundError();
            }

            // TODO: Check if course is active

            // We only allow instructor to enroll students into his own course
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                const instructorInCourse = await pgClient.query(
                    `SELECT 1 FROM sessions s WHERE s.course_id = $1 AND s.instructor_id = $2`,
                    [courseId, user.id]
                );
                if (instructorInCourse.rowCount === 0) {
                    throw new NotFoundError();
                }
            }

            const existingEnrollmentResult = await pgClient.query(
                `SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
                [studentId, courseId]
            );
            if (existingEnrollmentResult.rowCount > 0) {
                throw new BadRequestError('Student is already enrolled in this course');
            }

            const { rows } = await pgClient.query(
                `INSERT INTO enrollments (student_id, course_id, is_active, enrolled_at) VALUES ($1, $2, true, NOW()) RETURNING id, student_id, course_id, is_active, enrolled_at`,
                [studentId, courseId]
            );

            return rows[0] as Enrollment;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getEnrollmentByStudentIdAndCourseId: async (pgClient: any, studentId: string, courseId: string): Promise<Enrollment> => {
        try {
            if (!studentId || !courseId) {
                throw new NotFoundError();
            }

            const { rows } = await pgClient.query(
                `SELECT id, student_id, course_id, is_active, enrolled_at, dropped_at 
                 FROM enrollments 
                 WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
                [studentId, courseId]
            );

            if (rows.length === 0) {
                throw new NotFoundError('Enrollment not found for the given student and course');
            }

            return rows[0] as Enrollment;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}