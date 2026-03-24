import type { Course } from "./course.js";
import { NotFoundError } from "./error.js";
import type { Session } from "./session.js";

export type Enrollment = {
    id: string;
    student_id: string;
    course_id: string;
    is_active: boolean;
    enrolled_at: Date;
    dropped_at?: Date;
}

export const EnrollmentModel = {
    getEnrollmentsByStudentId: async (pgClient: any, studentId: string): Promise<(Enrollment & { course_code: string; course_name: string, semester: string, instructor_name: string })[]> => {
        if (!studentId) {
            throw new NotFoundError();
        }

        // TODO: Validate this query with TA later...
        const { rows } = await pgClient.query(
            `SELECT DISTINCT ON (e.id) e.id, e.student_id, e.course_id, e.is_active, e.enrolled_at, e.dropped_at,
     c.code as course_code, c.name as course_name, c.semester, u.full_name as instructor_name 
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id AND c.is_active = true
     LEFT JOIN sessions s ON c.id = s.course_id AND s.status IN ('scheduled', 'active')
     LEFT JOIN users u ON s.instructor_id = u.id
     WHERE e.student_id = $1 AND e.is_active = true
     ORDER BY e.id, s.scheduled_start ASC NULLS LAST`,
            [studentId]
        );

        if (rows.length === 0) {
            throw new NotFoundError();
        }

        return rows as (Enrollment & { course_code: string; course_name: string, semester: string, instructor_name: string })[];
    }
}