import { randomUUID } from 'crypto';
import type { PrismaClient, sessions as Session } from '../generated/prisma/client.js';
import { NotFoundError, BadRequestError, AppError, ForbiddenError } from './error.js';
import { USER_ROLE_TYPES } from './user.js';
import { buildQrPayload, generateQrSecretAndExpiry } from '../helpers/qr.js';
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';
import QRCode from 'qrcode';
import { CourseModel } from './course.js';

export enum SESSION_STATUS {
    SCHEDULED = 'scheduled',
    ACTIVE = 'active',
    CLOSED = 'closed',
    CANCELLED = 'cancelled'
}

export enum SESSION_TYPE {
    LECTURE = 'lecture',
    TUTORIAL = 'tutorial',
    LAB = 'lab',
    OTHER = 'other'
}

export type { Session };

export type SessionQrPayload = {
    qr_payload: string;
    qr_expires_at: Date;
    qr_ttl_seconds: number;
    qr_code: string;
};

export const SessionModel = {
    getById: async (prisma: PrismaClient, id: string): Promise<Session> => {
        try {
            return await prisma.sessions.findUniqueOrThrow({
                where: { id }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getActiveSessions: async (prisma: PrismaClient, params: {
        course_id?: string,
        instructor_id?: string,
        start_date?: string,
        end_date?: string,
        limit: number,
        offset: number
    }) => {
        try {
            const { course_id, instructor_id, start_date, end_date, limit, offset } = params;

            if (start_date && isNaN(Date.parse(start_date))) {
                throw new BadRequestError('Invalid start_date format');
            }
            if (end_date && isNaN(Date.parse(end_date))) {
                throw new BadRequestError('Invalid end_date format');
            }
            if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
                throw new BadRequestError('start_date cannot be after end_date');
            }

            const where: any = { status: SESSION_STATUS.ACTIVE };

            if (course_id) where.course_id = course_id;
            if (instructor_id) where.instructor_id = instructor_id;
            if (start_date) where.scheduled_end = { gte: new Date(start_date) };
            if (end_date) where.scheduled_start = { lte: new Date(end_date) };

            const sessions = await prisma.sessions.findMany({
                where,
                select: {
                    id: true,
                    course_id: true,
                    name: true,
                    status: true,
                    scheduled_start: true,
                    scheduled_end: true,
                    checkin_opens_at: true,
                    checkin_closes_at: true,
                    venue_name: true,
                    venue_latitude: true,
                    venue_longitude: true,
                    require_liveness_check: true,
                    require_face_match: true,
                    courses: {
                        select: {
                            code: true
                        }
                    }
                },
                skip: offset,
                take: limit
            });
            return sessions.map((s: any) => {
                const course_code = s.courses.code;
                delete s.courses;
                return {
                    ...s,
                    course_code
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getAllFilteredSessions: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, filters: any): Promise<{ items: any[], total: number }> => {
        try {
            const { session_id, status, course_id, instructor_id, start_date, end_date, limit = 50, offset = 0 } = filters;
            const userId = user.sub;
            const role = user.role;

            const where: any = {};

            if (status) where.status = status;
            if (start_date) where.scheduled_start = { gte: new Date(start_date) };
            if (end_date) where.scheduled_start = { lte: new Date(end_date) };

            // Role-based authorization
            if (role === USER_ROLE_TYPES.INSTRUCTOR) {
                // Instructors see sessions in courses they teach OR sessions they teach directly
                where.OR = [
                    {
                        courses: {
                            is: {
                                instructor_id: userId
                            }
                        }
                    },
                    {
                        instructor_id: userId
                    }
                ];
            } else if (role === USER_ROLE_TYPES.TA) {
                // TAs see only sessions they teach
                where.instructor_id = userId;
            } else if (role !== USER_ROLE_TYPES.ADMIN) {
                // Students can't access this endpoint
                throw new ForbiddenError('Insufficient permissions');
            }

            if (course_id) where.course_id = course_id;
            if (instructor_id && role === USER_ROLE_TYPES.ADMIN) where.instructor_id = instructor_id;
            if (session_id) where.id = session_id;

            const [sessions, total] = await prisma.$transaction([
                prisma.sessions.findMany({
                    where,
                    select: {
                        id: true,
                        course_id: true,
                        instructor_id: true,
                        name: true,
                        status: true,
                        scheduled_start: true,
                        scheduled_end: true,
                        checkin_opens_at: true,
                        checkin_closes_at: true,
                        qr_code_enabled: true,
                        courses: {
                            select: {
                                _count: {
                                    select: {
                                        enrollments: {
                                            where: { is_active: true }
                                        }
                                    }
                                },
                                code: true,
                                name: true
                            }
                        },
                        users: {
                            select: {
                                full_name: true
                            }
                        },
                        _count: {
                            select: {
                                checkins: true
                            }
                        }
                    },
                    orderBy: { scheduled_start: 'desc' },
                    skip: offset,
                    take: limit
                }),
                prisma.sessions.count({ where })
            ]);

            const items = sessions.map((s: any) => {
                const course_code = s.courses?.code;
                const course_name = s.courses?.name;
                const total_enrolled = s.courses?._count?.enrollments ?? 0;
                const instructor_name = s.users?.full_name;
                const checked_in_count = s._count?.checkins ?? 0;
                delete s.courses;
                delete s.users;
                delete s._count;
                return {
                    ...s,
                    course_code,
                    course_name,
                    instructor_name,
                    total_enrolled,
                    checked_in_count
                }
            });

            return { items, total };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFilteredSessionsByUser: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, { status, upcoming, limit = 50, session_id }: { status?: string, upcoming?: boolean, limit?: number, session_id?: string }): Promise<Session[]> => {
        try {
            const userId = user.sub;
            const role = user.role;
            const safeLimit = Math.max(1, Math.min(limit || 50, 200));

            const where: any = {};

            if (role === USER_ROLE_TYPES.STUDENT) {
                where.courses = {
                    enrollments: {
                        some: {
                            student_id: userId,
                            is_active: true
                        }
                    }
                };
            } else if (role === USER_ROLE_TYPES.INSTRUCTOR) {
                // Instructors see sessions in courses they teach OR sessions they teach directly
                where.OR = [
                    {
                        courses: {
                            is: {
                                instructor_id: userId
                            }
                        }
                    },
                    {
                        instructor_id: userId
                    }
                ];
            } else if (role === USER_ROLE_TYPES.TA) {
                // TAs see only sessions they teach
                where.instructor_id = userId;
            }

            if (status) where.status = status;
            if (upcoming) where.scheduled_start = { gte: new Date() };
            if (session_id) where.id = session_id;

            const sessions = await prisma.sessions.findMany({
                where,
                select: {
                    id: true,
                    course_id: true,
                    name: true,
                    status: true,
                    scheduled_start: true,
                    scheduled_end: true,
                    checkin_opens_at: true,
                    checkin_closes_at: true,
                    venue_name: true,
                    venue_latitude: true,
                    venue_longitude: true,
                    geofence_radius_meters: true,
                    require_liveness_check: true,
                    require_face_match: true,
                    risk_threshold: true,
                    qr_code_enabled: true,
                    courses: {
                        select: {
                            code: true,
                            name: true
                        }
                    },
                    users: {
                        select: {
                            full_name: true
                        }
                    }
                },
                orderBy: { scheduled_start: 'asc' },
                take: safeLimit
            });

            return sessions.map((s: any) => {
                const course_code = s.courses.code;
                const course_name = s.courses.name;
                const instructor_name = s.users?.full_name;
                delete s.courses;
                delete s.users;
                return {
                    ...s,
                    course_code,
                    course_name,
                    instructor_name
                }
            })
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    findById: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, id: string): Promise<any | null> => {
        try {
            const userId = user.sub;
            const role = user.role;

            let where: any = { id };
            if (role === USER_ROLE_TYPES.STUDENT) {
                where.enrollments = {
                    some: {
                        student_id: userId,
                        is_active: true
                    }
                };
            } else if (role === USER_ROLE_TYPES.INSTRUCTOR) {
                // Instructors can see sessions in courses they teach OR sessions they teach directly
                where.AND = [
                    { id },
                    {
                        OR: [
                            {
                                courses: {
                                    is: {
                                        instructor_id: userId
                                    }
                                }
                            },
                            {
                                instructor_id: userId
                            }
                        ]
                    }
                ];
            } else if (role === USER_ROLE_TYPES.TA) {
                where.instructor_id = userId;
            }

            const session = await prisma.sessions.findUniqueOrThrow({
                where,
                select: {
                    id: true,
                    course_id: true,
                    instructor_id: true,
                    name: true,
                    session_type: true,
                    description: true,
                    scheduled_start: true,
                    scheduled_end: true,
                    checkin_opens_at: true,
                    checkin_closes_at: true,
                    status: true,
                    actual_start: true,
                    actual_end: true,
                    venue_latitude: true,
                    venue_longitude: true,
                    venue_name: true,
                    geofence_radius_meters: true,
                    require_liveness_check: true,
                    require_face_match: true,
                    risk_threshold: true,
                    qr_code_enabled: true,
                    created_at: true,
                    updated_at: true,
                    courses: {
                        select: {
                            code: true,
                            name: true
                        }
                    },
                    users: {
                        select: {
                            full_name: true
                        }
                    }
                }
            });

            const data: any = {
                ...session,
                course_code: session.courses.code,
                course_name: session.courses.name,
                instructor_name: session.users?.full_name
            };

            delete data.courses;
            delete data.users;

            delete (data as any).qr_code_secret;
            delete (data as any).qr_code_expires_at;

            return data;
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (prisma: PrismaClient, payload: {
        course_id: string;
        instructor_id: string;
        name: string;
        session_type?: SESSION_TYPE;
        description?: string;
        scheduled_start: Date;
        scheduled_end: Date;
        checkin_opens_at?: Date;
        checkin_closes_at?: Date;
        status?: SESSION_STATUS;
        venue_latitude?: number;
        venue_longitude?: number;
        venue_name?: string;
        geofence_radius_meters?: number;
        require_liveness_check?: boolean;
        require_face_match?: boolean;
        risk_threshold?: number;
        qr_code_enabled?: boolean;
    }) => {
        try {
            const { instructor_id, course_id, name, scheduled_start, scheduled_end } = payload;
            let checkin_opens_at = payload?.checkin_opens_at ? new Date(payload.checkin_opens_at) : null;
            let checkin_closes_at = payload?.checkin_closes_at ? new Date(payload.checkin_closes_at) : null;

            if (!course_id || !name || !scheduled_start || !scheduled_end) {
                throw new BadRequestError('Missing required session fields');
            }

            const now = new Date();
            const startDate = new Date(scheduled_start);
            const endDate = new Date(scheduled_end);

            if (startDate <= now) {
                throw new BadRequestError('scheduled_start must be in the future');
            }
            if (endDate <= startDate) {
                throw new BadRequestError('scheduled_end must be after scheduled_start');
            }

            if (checkin_opens_at && checkin_closes_at) {
                const opensAt = new Date(checkin_opens_at);
                const closesAt = new Date(checkin_closes_at);
                if (closesAt <= opensAt) {
                    throw new BadRequestError('checkin_closes_at must be after checkin_opens_at');
                }
            }

            if (!checkin_closes_at) {
                checkin_closes_at = new Date(new Date(scheduled_start).getTime() + 30 * 60 * 1000);
            }
            if (!checkin_opens_at) {
                checkin_opens_at = new Date(new Date(scheduled_start).getTime() - 15 * 60 * 1000);
            }

            let qr_code_secret = null;
            let qr_code_expires_at = null;

            if (payload.qr_code_enabled) {
                const { qrSecret, qrCodeExpiresAt } = generateQrSecretAndExpiry(new Date(checkin_closes_at));
                qr_code_secret = qrSecret;
                qr_code_expires_at = qrCodeExpiresAt;
            }

            return await prisma.sessions.create({
                data: {
                    id: randomUUID(),
                    course_id,
                    instructor_id,
                    name,
                    session_type: payload.session_type || SESSION_TYPE.OTHER,
                    ...(payload.description !== undefined && { description: payload.description }),
                    scheduled_start,
                    scheduled_end,
                    checkin_opens_at,
                    checkin_closes_at,
                    status: payload.status || SESSION_STATUS.SCHEDULED,
                    ...(payload.venue_latitude !== undefined && { venue_latitude: payload.venue_latitude }),
                    ...(payload.venue_longitude !== undefined && { venue_longitude: payload.venue_longitude }),
                    ...(payload.venue_name !== undefined && { venue_name: payload.venue_name }),
                    ...(payload.geofence_radius_meters !== undefined && { geofence_radius_meters: payload.geofence_radius_meters }),
                    ...(payload.require_liveness_check !== undefined && { require_liveness_check: payload.require_liveness_check }),
                    ...(payload.require_face_match !== undefined && { require_face_match: payload.require_face_match }),
                    ...(payload.risk_threshold !== undefined && { risk_threshold: payload.risk_threshold }),
                    qr_code_enabled: payload.qr_code_enabled || false,
                    qr_code_secret,
                    qr_code_expires_at,
                    created_at: now,
                    updated_at: now
                },
                select: {
                    id: true,
                    course_id: true,
                    instructor_id: true,
                    name: true,
                    session_type: true,
                    description: true,
                    scheduled_start: true,
                    scheduled_end: true,
                    checkin_opens_at: true,
                    checkin_closes_at: true,
                    status: true,
                    actual_start: true,
                    actual_end: true,
                    venue_latitude: true,
                    venue_longitude: true,
                    venue_name: true,
                    geofence_radius_meters: true,
                    require_liveness_check: true,
                    require_face_match: true,
                    risk_threshold: true,
                    qr_code_enabled: true,
                    created_at: true,
                    updated_at: true
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    update: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, id: string, data: {
        name?: string;
        description?: string;
        status?: SESSION_STATUS;
        scheduled_start?: Date;
        scheduled_end?: Date;
        checkin_opens_at?: Date;
        checkin_closes_at?: Date;
        venue_name?: string;
        venue_latitude?: number;
        venue_longitude?: number;
        geofence_radius_meters?: number;
        require_liveness_check?: boolean;
        require_face_match?: boolean;
        risk_threshold?: number | null;
        qr_code_enabled?: boolean;
    }) => {
        try {
            if (Object.keys(data).length === 0) {
                throw new BadRequestError('No fields to update');
            }

            const currentSession = await prisma.sessions.findUniqueOrThrow({
                where: { id },
                select: { status: true, instructor_id: true }
            });

            if (currentSession.status === SESSION_STATUS.CANCELLED) {
                throw new BadRequestError('Cannot update a cancelled session');
            }

            if (data.status) {
                const validTransitions: Record<SESSION_STATUS, SESSION_STATUS[]> = {
                    [SESSION_STATUS.SCHEDULED]: [SESSION_STATUS.ACTIVE, SESSION_STATUS.CANCELLED],
                    [SESSION_STATUS.ACTIVE]: [SESSION_STATUS.CLOSED, SESSION_STATUS.CANCELLED],
                    [SESSION_STATUS.CLOSED]: [SESSION_STATUS.CANCELLED],
                    [SESSION_STATUS.CANCELLED]: []
                };

                const allowedNextStatuses = validTransitions[currentSession.status];
                if (!allowedNextStatuses.includes(data.status)) {
                    throw new BadRequestError(`Cannot transition from ${currentSession.status} to ${data.status}`);
                }
            }

            const where: any = { id };
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA) {
                where.instructor_id = user.sub;
            }

            const updateData: any = {
                updated_at: new Date()
            };

            if (data.name !== undefined) updateData.name = data.name;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.status !== undefined) updateData.status = data.status;
            if (data.scheduled_start !== undefined) updateData.scheduled_start = data.scheduled_start;
            if (data.scheduled_end !== undefined) updateData.scheduled_end = data.scheduled_end;
            if (data.checkin_opens_at !== undefined) updateData.checkin_opens_at = data.checkin_opens_at;
            if (data.checkin_closes_at !== undefined) updateData.checkin_closes_at = data.checkin_closes_at;
            if (data.venue_name !== undefined) updateData.venue_name = data.venue_name;
            if (data.venue_latitude !== undefined) updateData.venue_latitude = data.venue_latitude;
            if (data.venue_longitude !== undefined) updateData.venue_longitude = data.venue_longitude;
            if (data.geofence_radius_meters !== undefined) updateData.geofence_radius_meters = data.geofence_radius_meters;
            if (data.require_liveness_check !== undefined) updateData.require_liveness_check = data.require_liveness_check;
            if (data.require_face_match !== undefined) updateData.require_face_match = data.require_face_match;
            if (data.risk_threshold !== undefined) updateData.risk_threshold = data.risk_threshold;
            if (data.qr_code_enabled !== undefined) updateData.qr_code_enabled = data.qr_code_enabled;

            if (data.qr_code_enabled === false) {
                updateData.qr_code_secret = null;
                updateData.qr_code_expires_at = null;
            }

            return await prisma.sessions.update({
                where,
                data: updateData,
                select: {
                    id: true,
                    course_id: true,
                    instructor_id: true,
                    name: true,
                    session_type: true,
                    description: true,
                    scheduled_start: true,
                    scheduled_end: true,
                    checkin_opens_at: true,
                    checkin_closes_at: true,
                    status: true,
                    actual_start: true,
                    actual_end: true,
                    venue_latitude: true,
                    venue_longitude: true,
                    venue_name: true,
                    geofence_radius_meters: true,
                    require_liveness_check: true,
                    require_face_match: true,
                    risk_threshold: true,
                    qr_code_enabled: true,
                    created_at: true,
                    updated_at: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    delete: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, id: string) => {
        try {
            const userId = user.sub;
            const role = user.role;

            return await prisma.sessions.delete({
                where: {
                    id,
                    status: SESSION_STATUS.SCHEDULED,
                    ...(role === USER_ROLE_TYPES.INSTRUCTOR || role === USER_ROLE_TYPES.TA ? { instructor_id: userId } : {})
                },
                select: {
                    id: true,
                    name: true,
                    course_id: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    updateStatusById: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, id: string, status: SESSION_STATUS) => {
        try {
            let where: any = { id };
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                where.AND = [
                    { id },
                    {
                        OR: [
                            { instructor_id: user.sub },
                            {
                                courses: {
                                    is: {
                                        instructor_id: user.sub
                                    }
                                }
                            }
                        ]
                    }
                ];
            }
            return await prisma.sessions.update({
                where,
                data: { status, updated_at: new Date() },
                select: {
                    id: true,
                    name: true,
                    status: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    issueQr: async (prisma: PrismaClient, user: { sub: string, role: USER_ROLE_TYPES }, id: string): Promise<SessionQrPayload> => {
        try {
            const results = await SessionModel.getAllFilteredSessions(prisma, user, { session_id: id, limit: 1 });
            if (results.total === 0) {
                throw new NotFoundError();
            }
            const session = results.items[0];

            if (session.status !== SESSION_STATUS.ACTIVE) {
                throw new BadRequestError('QR codes can only be issued for active sessions');
            }
            if (!session.qr_code_enabled) {
                throw new BadRequestError('QR codes are not enabled for this session');
            }

            let qrSecret = session.qr_code_secret;
            let qrExpiresAt = new Date(session.qr_code_expires_at);

            if (!qrSecret) {
                const nextQr = generateQrSecretAndExpiry(new Date(session.checkin_closes_at));
                qrSecret = nextQr.qrSecret;
                qrExpiresAt = nextQr.qrCodeExpiresAt;

                const updateResult = await prisma.sessions.update({
                    where: { id },
                    data: {
                        qr_code_secret: qrSecret,
                        qr_code_expires_at: qrExpiresAt,
                        updated_at: new Date()
                    },
                    select: {
                        qr_code_secret: true,
                        qr_code_expires_at: true
                    }
                });

                qrSecret = updateResult.qr_code_secret as string;
                qrExpiresAt = new Date(updateResult.qr_code_expires_at!);
            }

            const qrPayload = buildQrPayload(id, qrSecret, qrExpiresAt);
            const qrCode = await QRCode.toDataURL(qrPayload);
            const ttlSeconds = Math.max(0, Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000));

            return {
                qr_payload: qrPayload,
                qr_expires_at: qrExpiresAt,
                qr_ttl_seconds: ttlSeconds,
                qr_code: qrCode
            };
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}