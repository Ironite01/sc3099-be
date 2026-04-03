import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from './error.js';
import { USER_ROLE_TYPES } from './user.js';

export const StatsModel = {
    getOverview: async function (prisma: PrismaClient, user: { sub: string; role: USER_ROLE_TYPES }, params: { days?: number; course_id?: string }) {
        try {
            const { days = 7, course_id } = params;

            const since = new Date();
            since.setDate(since.getDate() - days);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            // Authorization: Instructors can only see their own courses
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR && course_id) {
                const course = await prisma.courses.findUnique({
                    where: { id: course_id },
                    select: { instructor_id: true }
                });
                if (!course || course.instructor_id !== user.sub) {
                    throw new ForbiddenError();
                }
            }

            // Build where clause based on role and course_id
            const courseWhere = (() => {
                if (course_id) return { id: course_id };
                if (user.role === USER_ROLE_TYPES.INSTRUCTOR) return { instructor_id: user.sub };
                return {};
            })();

            // Run all queries in parallel
            const [
                totalCourses,
                totalStudents,
                totalSessions,
                activeSessions,
                totalCheckinsToday,
                totalCheckinsWeek,
                flaggedCount,
                approvedCount,
                rejectedCount,
                checkinStats,
                highRiskToday,
                allCheckins,
                allEnrolled,
                recentCheckins
            ] = await Promise.all([
                // Count courses
                prisma.courses.count({
                    where: { ...courseWhere, is_active: true }
                }),
                // Count total students
                course_id
                    ? prisma.enrollments.count({
                        where: { course_id, is_active: true }
                    })
                    : prisma.users.count({
                        where: { role: USER_ROLE_TYPES.STUDENT, is_active: true }
                    }),
                // Count sessions
                prisma.sessions.count({
                    where: {
                        courses: { ...courseWhere, is_active: true }
                    }
                }),
                // Count active sessions
                prisma.sessions.count({
                    where: {
                        status: 'active',
                        courses: { ...courseWhere, is_active: true }
                    }
                }),
                // Count checkins today
                prisma.checkins.count({
                    where: {
                        checked_in_at: { gte: today },
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count checkins this week
                prisma.checkins.count({
                    where: {
                        checked_in_at: { gte: weekAgo },
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count flagged checkins
                prisma.checkins.count({
                    where: {
                        status: 'flagged',
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count approved checkins
                prisma.checkins.count({
                    where: {
                        status: 'approved',
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count rejected checkins
                prisma.checkins.count({
                    where: {
                        status: 'rejected',
                        sessions: { courses: courseWhere }
                    }
                }),
                // Get avg risk score
                prisma.checkins.aggregate({
                    where: {
                        sessions: { courses: courseWhere }
                    },
                    _avg: { risk_score: true }
                }),
                // Count high risk checkins today
                prisma.checkins.count({
                    where: {
                        checked_in_at: { gte: today },
                        risk_score: { gte: 0.5 },
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count all checkins (for attendance)
                prisma.checkins.count({
                    where: {
                        sessions: { courses: courseWhere }
                    }
                }),
                // Count all enrolled
                course_id
                    ? prisma.enrollments.count({
                        where: { course_id, is_active: true }
                    })
                    : prisma.enrollments.count({
                        where: { is_active: true }
                    }),
                // Get recent checkins
                prisma.checkins.findMany({
                    where: {
                        sessions: { courses: courseWhere }
                    },
                    select: {
                        id: true,
                        student_id: true,
                        users_checkins_student_idTousers: { select: { full_name: true, email: true } },
                        sessions: { select: { name: true, courses: { select: { code: true } } } },
                        status: true,
                        risk_score: true,
                        checked_in_at: true
                    },
                    orderBy: { checked_in_at: 'desc' },
                    take: 20
                })
            ]);

            const decided = approvedCount + rejectedCount;
            const approvalRate = decided > 0 ? approvedCount / decided : 0;
            const attendanceRate = allEnrolled > 0 ? allCheckins / allEnrolled : 0;
            const averageRiskScore = checkinStats._avg?.risk_score || 0;

            return {
                total_courses: totalCourses,
                total_students: totalStudents,
                total_sessions: totalSessions,
                active_sessions: activeSessions,
                total_checkins_today: totalCheckinsToday,
                total_checkins_week: totalCheckinsWeek,
                average_attendance_rate: attendanceRate,
                flagged_pending_review: flaggedCount,
                today_checkins: totalCheckinsToday,
                flagged_pending: flaggedCount,
                approval_rate: approvalRate,
                average_risk_score: parseFloat(String(averageRiskScore)),
                high_risk_checkins_today: highRiskToday,
                trends: {
                    checkins_by_day: []
                },
                recent_checkins: recentCheckins.map(rc => ({
                    id: rc.id,
                    student_id: rc.student_id,
                    student_name: rc.users_checkins_student_idTousers?.full_name,
                    student_email: rc.users_checkins_student_idTousers?.email,
                    session_name: rc.sessions?.name,
                    course_code: rc.sessions?.courses?.code,
                    status: rc.status,
                    risk_score: rc.risk_score,
                    timestamp: rc.checked_in_at
                }))
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getSessionStatsById: async function (prisma: PrismaClient, user: { sub: string; role: USER_ROLE_TYPES }, sessionId: string) {
        try {
            const session = await prisma.sessions.findUnique({
                where: { id: sessionId },
                select: {
                    id: true,
                    name: true,
                    scheduled_start: true,
                    status: true,
                    course_id: true,
                    courses: { select: { code: true, instructor_id: true } }
                }
            });

            if (!session) {
                throw new NotFoundError();
            }

            // Authorization: Instructors can only see their own sessions
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR && session.courses?.instructor_id !== user.sub) {
                throw new ForbiddenError();
            }

            // Run all queries in parallel
            const [
                totalEnrolled,
                checkedIn,
                checkinData,
                byStatus,
                riskLow,
                riskMedium,
                riskHigh
            ] = await Promise.all([
                prisma.enrollments.count({
                    where: { course_id: session.course_id, is_active: true }
                }),
                prisma.checkins.count({
                    where: { session_id: sessionId }
                }),
                prisma.checkins.aggregate({
                    where: { session_id: sessionId },
                    _avg: {
                        risk_score: true,
                        distance_from_venue_meters: true
                    }
                }),
                prisma.checkins.groupBy({
                    by: ['status'],
                    where: { session_id: sessionId },
                    _count: { id: true }
                }),
                prisma.checkins.count({
                    where: { session_id: sessionId, risk_score: { lt: 0.3 } }
                }),
                prisma.checkins.count({
                    where: { session_id: sessionId, risk_score: { gte: 0.3, lt: 0.5 } }
                }),
                prisma.checkins.count({
                    where: { session_id: sessionId, risk_score: { gte: 0.5 } }
                })
            ]);

            const statusCounts: any = {};
            for (const group of byStatus) {
                statusCounts[group.status] = group._count.id;
            }

            const riskDistribution = {
                low: riskLow,
                medium: riskMedium,
                high: riskHigh
            };

            const attendanceRate = totalEnrolled > 0 ? checkedIn / totalEnrolled : 0;

            return {
                session_id: session.id,
                session_name: session.name,
                course_code: session.courses?.code,
                scheduled_start: session.scheduled_start,
                status: session.status,
                total_enrolled: totalEnrolled,
                checked_in: checkedIn,
                checked_in_count: checkedIn,
                attendance_rate: attendanceRate,
                by_status: {
                    approved: statusCounts.approved || 0,
                    flagged: statusCounts.flagged || 0,
                    rejected: statusCounts.rejected || 0,
                    pending: statusCounts.pending || 0
                },
                approved_count: statusCounts.approved || 0,
                flagged_count: statusCounts.flagged || 0,
                average_risk_score: checkinData._avg?.risk_score || 0,
                average_distance_meters: checkinData._avg?.distance_from_venue_meters || 0,
                risk_distribution: riskDistribution
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getCourseStatsById: async function (prisma: PrismaClient, user: { sub: string; role: USER_ROLE_TYPES }, courseId: string, query: { start_date?: string; end_date?: string }) {
        try {
            const course = await prisma.courses.findUnique({
                where: { id: courseId },
                select: { id: true, code: true, name: true, instructor_id: true }
            });

            if (!course) {
                throw new NotFoundError();
            }

            // Authorization: Instructors can only see their own courses
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR && course.instructor_id !== user.sub) {
                throw new ForbiddenError();
            }

            const { start_date, end_date } = query;
            const sessionWhere: any = { course_id: courseId };
            if (start_date) sessionWhere.scheduled_start = { ...sessionWhere.scheduled_start, gte: new Date(start_date) };
            if (end_date) sessionWhere.scheduled_start = { ...sessionWhere.scheduled_start, lte: new Date(end_date) };

            // Fetch sessions and enrollment count in parallel
            const [sessions, totalEnrolled] = await Promise.all([
                prisma.sessions.findMany({
                    where: sessionWhere,
                    select: {
                        id: true,
                        name: true,
                        scheduled_start: true,
                        checkins: {
                            select: { id: true, student_id: true }
                        }
                    }
                }),
                prisma.enrollments.count({
                    where: { course_id: courseId, is_active: true }
                })
            ]);

            const sessionsData = sessions.map(s => ({
                session_id: s.id,
                name: s.name,
                date: s.scheduled_start,
                checked_in: s.checkins.length,
                enrolled: totalEnrolled,
                attendance_rate: totalEnrolled > 0 ? s.checkins.length / totalEnrolled : 0
            }));

            const totalSessions = sessions.length;
            const overallAttendanceRate = totalSessions > 0
                ? sessionsData.reduce((acc, s) => acc + s.attendance_rate, 0) / totalSessions
                : 0;

            // Fetch enrollments and flagged checkins in parallel
            const [enrollmentsList, flaggedCheckins] = await Promise.all([
                prisma.enrollments.findMany({
                    where: { course_id: courseId, is_active: true },
                    select: {
                        student_id: true,
                        users: { select: { full_name: true, id: true } }
                    }
                }),
                prisma.checkins.count({
                    where: {
                        status: { in: ['flagged', 'appealed'] },
                        sessions: { course_id: courseId }
                    }
                })
            ]);

            // Student attendance
            const studentAttendance = await Promise.all(
                enrollmentsList.map(async (e) => {
                    const attendedSessions = await prisma.checkins.findMany({
                        where: {
                            student_id: e.student_id,
                            sessions: { course_id: courseId }
                        },
                        select: { session_id: true, risk_score: true }
                    });

                    const distinctSessions = new Set(attendedSessions.map(c => c.session_id)).size;
                    const avgRisk = attendedSessions.length > 0
                        ? attendedSessions.reduce((acc, c) => acc + (c.risk_score || 0), 0) / attendedSessions.length
                        : 0;

                    return {
                        student_id: e.student_id,
                        student_name: e.users?.full_name,
                        sessions_attended: distinctSessions,
                        attendance_rate: totalSessions > 0 ? distinctSessions / totalSessions : 0,
                        average_risk_score: avgRisk
                    };
                })
            );

            const lowAttendanceAlerts = studentAttendance
                .filter(s => s.attendance_rate < 0.75)
                .map(s => ({
                    student_id: s.student_id,
                    student_name: s.student_name,
                    attendance_rate: s.attendance_rate,
                    sessions_missed: Math.max(totalSessions - s.sessions_attended, 0)
                }));

            return {
                course_id: course.id,
                course_code: course.code,
                course_name: course.name,
                total_sessions: totalSessions,
                total_enrolled: totalEnrolled,
                overall_attendance_rate: overallAttendanceRate,
                average_attendance_rate: overallAttendanceRate,
                flagged_checkins: flaggedCheckins,
                sessions: sessionsData,
                student_attendance: studentAttendance,
                low_attendance_alerts: lowAttendanceAlerts
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getStudentStatsById: async function (prisma: PrismaClient, user: { sub: string; role: USER_ROLE_TYPES }, studentId: string) {
        try {
            const student = await prisma.users.findUnique({
                where: { id: studentId },
                select: { id: true, full_name: true, email: true }
            });

            if (!student) {
                throw new NotFoundError();
            }

            // Students can only see their own stats, instructors can see any student in their courses
            if (user.role === USER_ROLE_TYPES.STUDENT && user.sub !== studentId) {
                throw new ForbiddenError();
            }

            // Fetch enrollments and instructor auth check in parallel
            let enrollments: Array<{ course_id: string; courses: { code: string } | null }>;
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR) {
                const [enrollment, enrollmentList] = await Promise.all([
                    prisma.enrollments.findFirst({
                        where: {
                            student_id: studentId,
                            courses: { instructor_id: user.sub },
                            is_active: true
                        }
                    }),
                    prisma.enrollments.findMany({
                        where: { student_id: studentId, is_active: true },
                        select: {
                            course_id: true,
                            courses: { select: { code: true } }
                        }
                    })
                ]);
                if (!enrollment) {
                    throw new ForbiddenError();
                }
                enrollments = enrollmentList;
            } else {
                enrollments = await prisma.enrollments.findMany({
                    where: { student_id: studentId, is_active: true },
                    select: {
                        course_id: true,
                        courses: { select: { code: true } }
                    }
                });
            }

            const courses = await Promise.all(
                enrollments.map(async (e: { course_id: string; courses: { code: string } | null }) => {
                    const totalSessions = await prisma.sessions.count({
                        where: { course_id: e.course_id }
                    });

                    const attended = await prisma.checkins.findMany({
                        where: {
                            student_id: studentId,
                            sessions: { course_id: e.course_id }
                        },
                        select: { session_id: true, risk_score: true }
                    });

                    const distinctSessions = new Set(attended.map(c => c.session_id)).size;
                    const avgRisk = attended.length > 0
                        ? attended.reduce((acc, c) => acc + (c.risk_score || 0), 0) / attended.length
                        : 0;

                    return {
                        course_id: e.course_id,
                        course_code: e.courses?.code,
                        attendance_rate: totalSessions > 0 ? distinctSessions / totalSessions : 0,
                        sessions_attended: distinctSessions,
                        total_sessions: totalSessions,
                        average_risk_score: avgRisk
                    };
                })
            );

            const recentCheckins = await prisma.checkins.findMany({
                where: { student_id: studentId },
                select: {
                    checked_in_at: true,
                    status: true,
                    sessions: {
                        select: { name: true, courses: { select: { code: true } } }
                    }
                },
                orderBy: { checked_in_at: 'desc' },
                take: 20
            });

            const totalSessions = courses.reduce((acc, c) => acc + c.total_sessions, 0);
            const attendedSessions = courses.reduce((acc, c) => acc + c.sessions_attended, 0);

            return {
                student_id: student.id,
                student_name: student.full_name,
                student_email: student.email,
                total_enrolled_courses: courses.length,
                total_sessions: totalSessions,
                attended_sessions: attendedSessions,
                attendance_rate: totalSessions > 0 ? attendedSessions / totalSessions : 0,
                courses,
                recent_checkins: recentCheckins.map(rc => ({
                    session_name: rc.sessions?.name,
                    course_code: rc.sessions?.courses?.code,
                    checked_in_at: rc.checked_in_at,
                    status: rc.status
                })),
                recent_sessions: recentCheckins.map(rc => ({
                    session_name: rc.sessions?.name,
                    course_code: rc.sessions?.courses?.code,
                    checked_in_at: rc.checked_in_at,
                    status: rc.status
                }))
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
};
