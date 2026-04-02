import type { PrismaClient, enrollments as Enrollment } from '../generated/prisma/client.js';
import { CourseModel } from "./course.js";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "./error.js";
import { USER_ROLE_TYPES, UserModel } from "./user.js";
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';
import extractNameFromEmail from "../helpers/extractNameFromEmail.js";
import { randomUUID } from 'node:crypto';

type EnrollmentActor = {
    id: string;
    role: USER_ROLE_TYPES;
};

export type { Enrollment };

export const EnrollmentModel = {
    getEnrollmentsByStudentId: async (prisma: PrismaClient, studentId: string) => {
        try {
            if (!studentId) {
                throw new NotFoundError();
            }
            // We do not consider if course and enrollments are active or not
            const enrollments = await prisma.enrollments.findMany({
                where: { student_id: studentId },
                select: {
                    id: true,
                    student_id: true,
                    course_id: true,
                    is_active: true,
                    enrolled_at: true,
                    dropped_at: true,
                    courses: {
                        select: {
                            code: true,
                            name: true,
                            semester: true,
                            users: {
                                select: {
                                    full_name: true
                                }
                            }
                        }
                    }
                },
                orderBy: { enrolled_at: 'desc' }
            });

            const data = enrollments.map(e => ({
                ...e,
                course_code: e.courses?.code,
                course_name: e.courses?.name,
                semester: e.courses?.semester,
                instructor_name: e.courses?.users?.full_name,
            })) as any;

            delete data.courses;
            return data;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getStudentsByCourseEnrollment: async (prisma: PrismaClient, actor: EnrollmentActor, courseId: string, { is_active = true, search }: { is_active?: boolean, search?: string }): Promise<{ course_id: string; course_code: string; total_enrolled: number; students: (Enrollment & { student_name?: string, student_email?: string, face_enrolled?: boolean })[] }> => {
        try {
            if (!courseId || !actor?.id) {
                throw new NotFoundError();
            }

            let course;
            try {
                course = await CourseModel.findById(prisma, courseId);
            } catch (err) {
                throw new NotFoundError('Course not found');
            }
            if (actor.role === USER_ROLE_TYPES.INSTRUCTOR && course.instructor_id !== actor.id) {
                throw new NotFoundError();
            }

            const enrollments = await prisma.enrollments.findMany({
                where: {
                    course_id: courseId,
                    is_active,
                    ...(search && {
                        users: {
                            OR: [
                                { full_name: { contains: search, mode: 'insensitive' } },
                                { email: { contains: search, mode: 'insensitive' } }
                            ]
                        }
                    })
                },
                select: {
                    id: true,
                    student_id: true,
                    course_id: true,
                    is_active: true,
                    enrolled_at: true,
                    dropped_at: true,
                    users: {
                        select: {
                            full_name: true,
                            email: true,
                            face_enrolled: true
                        }
                    }
                }
            });

            const totalEnrolled = await prisma.enrollments.count({
                where: {
                    course_id: courseId,
                    is_active
                }
            });

            const parsedEnrollments = enrollments.map(e => ({
                ...e,
                student_name: e.users?.full_name,
                student_email: e.users?.email,
                face_enrolled: e.users?.face_enrolled,
            })) as any;
            delete parsedEnrollments.users;

            return {
                course_id: courseId,
                course_code: course.code,
                total_enrolled: totalEnrolled,
                students: parsedEnrollments
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (prisma: PrismaClient, user: EnrollmentActor, payload: { studentId: string, courseId: string }): Promise<Partial<Enrollment>> => {
        try {
            const { studentId, courseId } = payload;
            if (!studentId || !courseId) {
                throw new NotFoundError();
            }

            const isCourseActiveAndValid =
                user.role === USER_ROLE_TYPES.INSTRUCTOR ?
                    await CourseModel.isCourseActiveAndValid(prisma, courseId, user.id) :
                    await CourseModel.isCourseActiveAndValid(prisma, courseId);

            if (!isCourseActiveAndValid) {
                throw new NotFoundError('Course not found or is not active');
            }

            // Check if student account is active and has student role
            try {
                const student = await UserModel.getById(prisma, studentId);
                if (student.role !== USER_ROLE_TYPES.STUDENT) {
                    throw new ForbiddenError('User is not a student');
                }
                if (!student.is_active) {
                    throw new ForbiddenError('Student account is not active');
                }
            } catch (err) {
                throw new ForbiddenError('Student account is not valid');
            }

            const existingEnrollment = await prisma.enrollments.findFirst({
                where: {
                    student_id: studentId,
                    course_id: courseId,
                    is_active: true
                }
            });

            if (existingEnrollment) {
                throw new BadRequestError('Student is already enrolled in this course');
            }

            return await prisma.enrollments.create({
                data: {
                    id: randomUUID(),
                    student_id: studentId,
                    course_id: courseId,
                    is_active: true,
                    enrolled_at: new Date()
                },
                select: {
                    id: true,
                    student_id: true,
                    course_id: true,
                    is_active: true,
                    enrolled_at: true
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    bulkCreate: async (prisma: PrismaClient, actor: EnrollmentActor, courseId: string, studentEmails: string[], shouldCreateAccs: boolean) => {
        try {
            return await prisma.$transaction(async (tx) => {
                const isCourseActiveAndValid =
                    actor.role === USER_ROLE_TYPES.INSTRUCTOR ?
                        await CourseModel.isCourseActiveAndValid(tx as any, courseId, actor.id) :
                        await CourseModel.isCourseActiveAndValid(tx as any, courseId);

                if (!isCourseActiveAndValid) {
                    throw new NotFoundError('Course not found or is not active');
                }

                let not_found = 0;
                let created = 0;
                const detailByEmail = new Map<string, { email: string; status: string }>();

                const setDetail = (email: string, status: string) => {
                    detailByEmail.set(email, { email, status });
                };

                const originalEmails = [...studentEmails];
                const existingUsers = await UserModel.getUsersByEmail(tx as any, studentEmails);
                const existingEmails = new Set(existingUsers.map(u => u.email));

                let usersToProcess = existingUsers;

                if (shouldCreateAccs) {
                    const missingEmails = studentEmails.filter(email => !existingEmails.has(email));

                    if (missingEmails.length > 0) {
                        const newUsers = UserModel.createMultipleUsers(tx as any, missingEmails.map(email => ({
                            email,
                            full_name: extractNameFromEmail(email),
                            role: USER_ROLE_TYPES.STUDENT
                        })));

                        created = (await newUsers).length;

                        const newlyCreated = await tx.users.findMany({
                            where: { email: { in: missingEmails } }
                        });

                        usersToProcess = [...existingUsers, ...newlyCreated];
                    }
                }

                // Filter valid users
                const validUsers = usersToProcess.filter(u => {
                    if (!u.is_active) {
                        setDetail(u.email, 'inactive');
                        return false;
                    }
                    if (u.role !== USER_ROLE_TYPES.STUDENT) {
                        setDetail(u.email, 'not_student');
                        return false;
                    }
                    return true;
                });

                const validEmails = validUsers.map(u => u.email);
                const emailsNotFound = studentEmails.filter(e => !validEmails.includes(e) && !detailByEmail.has(e));
                emailsNotFound.forEach(email => {
                    setDetail(email, 'not_found');
                    not_found++;
                });

                // Check existing enrollments
                const existingEnrollments = await tx.enrollments.findMany({
                    where: {
                        course_id: courseId,
                        is_active: true,
                        users: {
                            email: { in: validEmails }
                        }
                    },
                    select: {
                        users: { select: { email: true } }
                    }
                });

                const alreadyEnrolledEmails = new Set(
                    existingEnrollments.map(e => e.users?.email).filter(Boolean)
                );

                const emailsToEnroll = validEmails.filter(email => !alreadyEnrolledEmails.has(email));

                // Enroll students
                let enrolled = 0;
                if (emailsToEnroll.length > 0) {
                    const usersToEnroll = validUsers.filter(u => emailsToEnroll.includes(u.email));

                    await tx.enrollments.createMany({
                        data: usersToEnroll.map(u => ({
                            id: randomUUID(),
                            student_id: u.id,
                            course_id: courseId,
                            is_active: true,
                            enrolled_at: new Date()
                        })),
                        skipDuplicates: true
                    });

                    enrolled = usersToEnroll.length;
                    usersToEnroll.forEach(u => {
                        setDetail(u.email, 'enrolled');
                    });
                }

                // Mark already enrolled
                Array.from(alreadyEnrolledEmails).forEach(email => {
                    setDetail(email, 'already_enrolled');
                });

                const already_enrolled = alreadyEnrolledEmails.size;
                const details = originalEmails
                    .map(email => detailByEmail.get(email))

                return {
                    enrolled,
                    already_enrolled,
                    not_found,
                    created,
                    details
                };
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getEnrollmentByStudentIdAndCourseId: async (prisma: PrismaClient, studentId: string, courseId: string): Promise<Enrollment> => {
        try {
            if (!studentId || !courseId) {
                throw new NotFoundError();
            }

            const enrollment = await prisma.enrollments.findFirstOrThrow({
                where: {
                    student_id: studentId,
                    course_id: courseId,
                    is_active: true
                }
            });

            return enrollment;
        } catch (err: any) {
            if (err.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('Enrollment not found');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    delete: async (prisma: PrismaClient, user: EnrollmentActor, enrollmentId: string) => {
        try {
            if (!enrollmentId) {
                throw new NotFoundError();
            }

            const where = { id: enrollmentId } as any;
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                where.courses = {
                    instructor_id: user.id
                };
            }
            const result = await prisma.enrollments.update({
                where,
                data: {
                    is_active: false,
                    dropped_at: new Date()
                }
            });

            return {
                student_id: result.student_id,
                course_id: result.course_id
            };
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('Enrollment not found');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}