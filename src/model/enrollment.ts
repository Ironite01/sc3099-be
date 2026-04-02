import type { PoolClient } from "pg";
import { CourseModel } from "./course.js";
import { AppError, BadRequestError, NotFoundError } from "./error.js";
import { USER_ROLE_TYPES, UserModel } from "./user.js";
import extractNameFromEmail from "../helpers/extractNameFromEmail.js";

type EnrollmentActor = {
    id: string;
    role: USER_ROLE_TYPES;
};

async function assertInstructorOwnsCourse(pgClient: any, courseId: string, userId: string) {
    const ownershipResult = await pgClient.query(
        `SELECT 1
         FROM courses
         WHERE id = $1 AND instructor_id = $2`,
        [courseId, userId]
    );

    if (ownershipResult.rowCount === 0) {
        throw new NotFoundError('Course not found');
    }
}

async function assertCanViewCourseEnrollments(pgClient: any, actor: EnrollmentActor, courseId: string) {
    const courseResult = await pgClient.query(
        `SELECT id, code, instructor_id
         FROM courses
         WHERE id = $1`,
        [courseId]
    );

    if (courseResult.rowCount === 0) {
        throw new NotFoundError('Course not found');
    }

    const course = courseResult.rows[0] as { id: string; code: string; instructor_id: string | null };

    if (actor.role === USER_ROLE_TYPES.ADMIN) {
        return course;
    }

    if (actor.role === USER_ROLE_TYPES.INSTRUCTOR) {
        return course;
    }

    if (course.instructor_id === actor.id) {
        return course;
    }

    if (actor.role === USER_ROLE_TYPES.TA) {
        const taAccess = await pgClient.query(
            `SELECT 1
             FROM course_tas
             WHERE course_id = $1 AND ta_id = $2
             LIMIT 1`,
            [courseId, actor.id]
        );

        if (taAccess.rowCount > 0) {
            return course;
        }
    }

    throw new NotFoundError('Course not found');
}

async function assertStudentCanBeEnrolled(pgClient: any, studentId: string) {
    const studentResult = await pgClient.query(
        `SELECT id, role, is_active
         FROM users
         WHERE id = $1`,
        [studentId]
    );

    if (studentResult.rowCount === 0) {
        throw new NotFoundError('Student not found');
    }

    const student = studentResult.rows[0] as { role: USER_ROLE_TYPES; is_active: boolean };
    if (student.role !== USER_ROLE_TYPES.STUDENT) {
        throw new BadRequestError('User is not a student');
    }

    if (!student.is_active) {
        throw new BadRequestError('Student account is inactive');
    }
}

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
                `SELECT c.name as course_name, c.code as course_code, c.semester, c.id as course_id, COALESCE(u.full_name, 'Unassigned') as instructor_name, e.enrolled_at, e.id, e.is_active
                 FROM enrollments e
                 JOIN courses c ON c.id = e.course_id
                 LEFT JOIN users u ON u.id = c.instructor_id
                 WHERE e.student_id = $1
                   AND e.is_active = TRUE
                   AND c.is_active = TRUE
                 ORDER BY e.enrolled_at DESC`,
                [studentId]
            );

            return rows as (Enrollment & { instructor_name: string, course_code: string, course_name: string, semester: string })[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getStudentsByCourseEnrollment: async (pgClient: any, actor: EnrollmentActor, courseId: string, { is_active = true, search }: { is_active?: boolean, search?: string }): Promise<{ course_id: string; course_code: string; total_enrolled: number; students: (Enrollment & { student_name: string, student_email: string, face_enrolled: boolean })[] }> => {
        try {
            if (!courseId || !actor?.id) {
                throw new NotFoundError();
            }

            const course = await assertCanViewCourseEnrollments(pgClient, actor, courseId);

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
                course_code: course.code,
                total_enrolled: totalEnrolled,
                students: rows as (Enrollment & { student_name: string, student_email: string, face_enrolled: boolean })[] || []
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (pgClient: any, user: EnrollmentActor, payload: { studentId: string, courseId: string }): Promise<Enrollment> => {
        try {
            const { studentId, courseId } = payload;
            if (!studentId || !courseId) {
                throw new NotFoundError();
            }

            const isCourseActiveAndValid = await CourseModel.isCourseActiveAndValid(pgClient, courseId);
            if (!isCourseActiveAndValid) {
                throw new NotFoundError('Course not found or is not active');
            }

            await assertStudentCanBeEnrolled(pgClient, studentId);

            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                await assertInstructorOwnsCourse(pgClient, courseId, user.id);
            }

            const existingEnrollmentResult = await pgClient.query(
                `SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
                [studentId, courseId]
            );
            if (existingEnrollmentResult.rowCount > 0) {
                throw new BadRequestError('Student is already enrolled in this course');
            }

            const { rows } = await pgClient.query(
                `INSERT INTO enrollments (id, student_id, course_id, is_active, enrolled_at)
                 VALUES (gen_random_uuid()::text, $1, $2, true, NOW())
                 RETURNING id, student_id, course_id, is_active, enrolled_at`,
                [studentId, courseId]
            );

            return rows[0] as Enrollment;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    bulkCreate: async (transact: (fn: (pgClient: PoolClient) => Promise<any>) => Promise<any>, actor: EnrollmentActor, courseId: string, studentEmails: string[], shouldCreateAccs: boolean) => {
        try {
            return await transact(async (pgClient) => {
                const isCourseActiveAndValid = await CourseModel.isCourseActiveAndValid(pgClient, courseId);
                if (!isCourseActiveAndValid) {
                    throw new NotFoundError('Course not found or is not active');
                }

                if (actor.role === USER_ROLE_TYPES.INSTRUCTOR) {
                    await assertInstructorOwnsCourse(pgClient, courseId, actor.id);
                }

                let not_found = 0;
                let created = 0;
                const detailByEmail = new Map<string, { email: string; status: string }>();

                const setDetail = (email: string, status: string) => {
                    detailByEmail.set(email, { email, status });
                };

                const originalEmails = [...studentEmails];

                if (shouldCreateAccs) {
                    const existingUsers = await UserModel.getUsersByEmail(pgClient, studentEmails);
                    const existingEmails = new Set(existingUsers.map(user => user.email));
                    const missingEmails = studentEmails.filter(email => !existingEmails.has(email));

                    const createResult = missingEmails.length > 0
                        ? await UserModel.createMultipleUsers(pgClient, missingEmails.map(email => ({
                            email,
                            full_name: extractNameFromEmail(email),
                            role: USER_ROLE_TYPES.STUDENT
                        })))
                        : [];

                    created = createResult.length;

                    const createdEmails = createResult.map(u => u.email);
                    missingEmails.forEach(email => {
                        if (!createdEmails.includes(email)) {
                            setDetail(email, 'not_found');
                            not_found++;
                        }
                    });

                    const combinedUsers = [...existingUsers, ...createResult];
                    const filteredOnlyActiveUser = combinedUsers.filter(u => {
                        if (!u.is_active) {
                            setDetail(u.email, 'inactive');
                        }
                        return u.is_active;
                    });

                    const filteredByRole = filteredOnlyActiveUser.filter(u => {
                        if (u.role !== USER_ROLE_TYPES.STUDENT) {
                            setDetail(u.email, 'not_student');
                            return false;
                        }
                        return true;
                    });

                    const existingUserEmails = filteredByRole.map(u => u.email);

                    studentEmails = studentEmails.filter(e => existingUserEmails.includes(e));
                } else {
                    const existingUsers = await UserModel.getUsersByEmail(pgClient, studentEmails);

                    const filteredOnlyActiveUser = existingUsers.filter(u => {
                        if (!u.is_active) {
                            setDetail(u.email, 'inactive');
                        }
                        return u.is_active;
                    });

                    const filteredByRole = filteredOnlyActiveUser.filter(u => {
                        if (u.role !== USER_ROLE_TYPES.STUDENT) {
                            setDetail(u.email, 'not_student');
                            return false;
                        }
                        return true;
                    });

                    const existingUserEmails = filteredByRole.map(u => u.email);

                    studentEmails = studentEmails.filter(e => {
                        if (!existingUserEmails.includes(e)) {
                            setDetail(e, 'not_found');
                            not_found++;
                            return false;
                        }
                        return true;
                    });
                }

                const activeEnrollmentResult = await pgClient.query(
                    `SELECT u.email
                     FROM enrollments e
                     JOIN users u ON u.id = e.student_id
                     WHERE e.course_id = $1
                       AND e.is_active = TRUE
                       AND u.email = ANY($2)`,
                    [courseId, studentEmails]
                );

                const alreadyEnrolledEmails = new Set<string>(
                    activeEnrollmentResult.rows.map((row: { email: string }) => row.email)
                );

                const studentIdByEmailResult = await pgClient.query(
                    `SELECT id, email
                     FROM users
                     WHERE email = ANY($1)
                       AND is_active = TRUE
                       AND role = $2`,
                    [studentEmails, USER_ROLE_TYPES.STUDENT]
                );

                const emailByStudentId = new Map<string, string>(
                    studentIdByEmailResult.rows.map((row: { id: string; email: string }) => [row.id, row.email])
                );

                const emailsToEnroll = studentEmails.filter(email => !alreadyEnrolledEmails.has(email));

                let enrolled = 0;
                if (emailsToEnroll.length > 0) {
                    const { rows } = await pgClient.query(
                        `INSERT INTO enrollments (id, student_id, course_id, is_active, enrolled_at)
                            SELECT gen_random_uuid()::text, u.id, $1, TRUE, NOW()
                            FROM users u
                            WHERE u.email = ANY($2) AND u.is_active = TRUE AND u.role = $3
                        ON CONFLICT (student_id, course_id)
                        DO UPDATE SET is_active = TRUE, dropped_at = NULL
                        RETURNING id, student_id`,
                        [courseId, emailsToEnroll, USER_ROLE_TYPES.STUDENT]
                    );

                    const enrolledEmails = new Set<string>(
                        (rows as Array<{ student_id: string }>).map(row => emailByStudentId.get(row.student_id) || '')
                    );

                    for (const email of emailsToEnroll) {
                        if (enrolledEmails.has(email)) {
                            setDetail(email, 'enrolled');
                            enrolled++;
                        }
                    }
                }

                for (const email of studentEmails) {
                    if (alreadyEnrolledEmails.has(email)) {
                        setDetail(email, 'already_enrolled');
                    }
                }

                const already_enrolled = Array.from(alreadyEnrolledEmails).length;
                const details = originalEmails
                    .map(email => detailByEmail.get(email))
                    .filter((detail): detail is { email: string; status: string } => Boolean(detail));

                return {
                    enrolled,
                    already_enrolled,
                    not_found,
                    created,
                    details
                }
            });
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
    },
    delete: async (pgClient: any, user: EnrollmentActor, enrollmentId: string) => {
        try {
            if (!enrollmentId) {
                throw new NotFoundError();
            }

            let result;
            if (user.role === USER_ROLE_TYPES.ADMIN) {
                result = await pgClient.query(
                    `UPDATE enrollments
                     SET is_active = false, dropped_at = NOW()
                     WHERE id = $1 AND is_active = TRUE
                     RETURNING id`,
                    [enrollmentId]
                );
            } else {
                result = await pgClient.query(
                    `UPDATE enrollments e
                     SET is_active = false, dropped_at = NOW()
                     FROM courses c
                     WHERE e.id = $1
                       AND e.course_id = c.id
                       AND e.is_active = TRUE
                       AND c.instructor_id = $2
                     RETURNING e.student_id, e.course_id`,
                    [enrollmentId, user.id]
                );
            }

            if (result.rows.length === 0) {
                throw new NotFoundError('Enrollment not found');
            }

            return result.rows[0] as { student_id: string; course_id: string };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}
