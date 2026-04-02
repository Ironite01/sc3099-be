import { randomUUID } from 'crypto';
import type { PrismaClient, courses as Course } from '../generated/prisma/client.js';
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "./error.js";
import { USER_ROLE_TYPES } from "./user.js";
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';

export type { Course }

export const CourseModel = {
    getFilteredCourses: async (prisma: PrismaClient, filters: {
        is_active?: boolean | undefined;
        semester?: string | undefined;
        instructor_id?: string | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
    }) => {
        try {
            const [items, total] = await prisma.$transaction([
                prisma.courses.findMany({
                    where: {
                        ...(filters.is_active !== undefined && { is_active: filters.is_active }),
                        ...(filters.semester !== undefined && { semester: filters.semester }),
                        ...(filters.instructor_id !== undefined && { instructor_id: filters.instructor_id })
                    },
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        semester: true,
                        instructor_id: true,
                        venue_name: true,
                        venue_latitude: true,
                        venue_longitude: true,
                        geofence_radius_meters: true,
                        risk_threshold: true,
                        is_active: true,
                        created_at: true,
                        users: {
                            select: {
                                full_name: true
                            }
                        }
                    },
                    orderBy: { created_at: 'desc' },
                    skip: filters?.offset || 0,
                    take: filters?.limit || 50
                }),
                prisma.courses.count({
                    where: {
                        ...(filters.is_active !== undefined && { is_active: filters.is_active }),
                        ...(filters.semester !== undefined && { semester: filters.semester }),
                        ...(filters.instructor_id !== undefined && { instructor_id: filters.instructor_id })
                    }
                })
            ]);

            return {
                items: items.map((i: any) => {
                    const instructor_name = i.users!.full_name;
                    delete i.users;
                    return { ...i, instructor_name };
                }), total
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    findById: async (prisma: PrismaClient, id: string): Promise<Course> => {
        try {
            return await prisma.courses.findUniqueOrThrow({
                where: { id }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('Course not found');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (prisma: PrismaClient, data: {
        code: string;
        name: string;
        semester: string;
        description?: string | null;
        venue_name?: string | null;
        venue_latitude?: number | null;
        venue_longitude?: number | null;
        geofence_radius_meters?: number;
        require_face_recognition?: boolean;
        require_device_binding?: boolean;
        risk_threshold?: number;
        instructor_id: string;
    }): Promise<Course> => {
        try {
            return await prisma.courses.create({
                data: {
                    id: randomUUID(),
                    code: data.code!,
                    name: data.name!,
                    semester: data.semester!,
                    is_active: true,
                    instructor_id: data.instructor_id!,
                    created_at: new Date(),
                    updated_at: new Date(),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.venue_name !== undefined && { venue_name: data.venue_name }),
                    ...(data.venue_latitude !== undefined && { venue_latitude: data.venue_latitude }),
                    ...(data.venue_longitude !== undefined && { venue_longitude: data.venue_longitude }),
                    ...(data.geofence_radius_meters !== undefined && { geofence_radius_meters: data.geofence_radius_meters }),
                    ...(data.require_device_binding !== undefined && { require_device_binding: data.require_device_binding }),
                    ...(data.risk_threshold !== undefined && { risk_threshold: data.risk_threshold }),
                    ...(data.require_face_recognition !== undefined && { require_face_recognition: data.require_face_recognition }),
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    update: async (prisma: PrismaClient, id: string, data: {
        name?: string;
        description?: string;
        venue_name?: string;
        venue_latitude?: number;
        venue_longitude?: number;
        geofence_radius_meters?: number;
        require_face_recognition?: boolean;
        require_device_binding?: boolean;
        risk_threshold?: number;
        instructor_id?: string | null;
    }, user: { sub: string; role: USER_ROLE_TYPES }): Promise<Course> => {
        try {
            if (Object.keys(data).length === 0) {
                throw new BadRequestError('No fields to update');
            }

            // For instructors, only allow editing their own courses
            if (user?.role === USER_ROLE_TYPES.INSTRUCTOR && data.instructor_id !== undefined && data.instructor_id !== user.sub) {
                throw new UnauthorizedError('Instructors cannot change course ownership');
            }

            const where: any = { id };
            if (user?.role === USER_ROLE_TYPES.INSTRUCTOR) {
                where.instructor_id = user.sub;
            }

            return await prisma.courses.update({
                where,
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.venue_name !== undefined && { venue_name: data.venue_name }),
                    ...(data.venue_latitude !== undefined && { venue_latitude: data.venue_latitude }),
                    ...(data.venue_longitude !== undefined && { venue_longitude: data.venue_longitude }),
                    ...(data.geofence_radius_meters !== undefined && { geofence_radius_meters: data.geofence_radius_meters }),
                    ...(data.require_face_recognition !== undefined && { require_face_recognition: data.require_face_recognition }),
                    ...(data.require_device_binding !== undefined && { require_device_binding: data.require_device_binding }),
                    ...(data.risk_threshold !== undefined && { risk_threshold: data.risk_threshold }),
                    ...(data.instructor_id !== undefined && USER_ROLE_TYPES.ADMIN && { instructor_id: data.instructor_id }),
                    updated_at: new Date()
                } as any
            }) as Course;
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('Course not found');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    delete: async (prisma: PrismaClient, id: string): Promise<void> => {
        try {
            await prisma.courses.update({
                where: { id },
                data: {
                    is_active: false,
                    updated_at: new Date()
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError('Course not found');
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    isCourseActiveAndValid: async (prisma: PrismaClient, courseId: string, instructorId?: string): Promise<boolean> => {
        try {
            const where: any = { id: courseId, is_active: true };
            if (instructorId) {
                where.instructor_id = instructorId;
            }
            const course = await prisma.courses.findUnique({
                where,
                select: { is_active: true }
            });

            return course ? true : false;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}