import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';

async function statsController(fastify: FastifyInstance) {

    // GET /api/v1/stats/overview
    fastify.get(`${BASE_URL}/stats/overview`, {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    days: { type: 'integer', minimum: 1, maximum: 365, default: 7 },
                    course_id: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { days = 7, course_id } = req.query as { days?: number; course_id?: string };
        const pgClient = await fastify.pg.connect();
        try {
            const since = new Date();
            since.setDate(since.getDate() - days);
            const sinceIso = since.toISOString();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayIso = today.toISOString();
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekAgoIso = weekAgo.toISOString();

            const courseFilter = course_id ? `AND c.id = $1` : '';
            const courseParam = course_id ? [course_id] : [];

            // Total courses
            const totalCoursesRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM courses c WHERE c.is_active = TRUE ${course_id ? 'AND c.id = $1' : ''}`,
                courseParam
            );
            const total_courses = parseInt(totalCoursesRow.rows[0].cnt, 10);

            // Total active students (or distinct enrolled students when course filter is used)
            const totalStudentsRow = await pgClient.query(
                course_id
                    ? `SELECT COUNT(DISTINCT e.student_id)::int AS cnt
                       FROM enrollments e
                       WHERE e.course_id = $1 AND e.is_active = TRUE`
                    : `SELECT COUNT(*)::int AS cnt
                       FROM users u
                       WHERE u.role = 'student' AND u.is_active = TRUE`,
                courseParam
            );
            const total_students = parseInt(totalStudentsRow.rows[0].cnt, 10);

            // Total sessions
            const totalSessionsRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM sessions s
                 JOIN courses c ON c.id = s.course_id
                 WHERE c.is_active = TRUE ${courseFilter}`,
                courseParam
            );
            const total_sessions = parseInt(totalSessionsRow.rows[0].cnt, 10);

            // Active sessions
            const activeSessionsRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM sessions s
                 JOIN courses c ON c.id = s.course_id
                 WHERE s.status = 'active' AND c.is_active = TRUE ${courseFilter}`,
                courseParam
            );
            const active_sessions = parseInt(activeSessionsRow.rows[0].cnt, 10);

            // Checkins today
            const checkinsBaseParams = course_id ? [todayIso, course_id] : [todayIso];
            const checkinsTodayRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.checked_in_at >= $1 ${course_id ? 'AND c.id = $2' : ''}`,
                checkinsBaseParams
            );
            const total_checkins_today = parseInt(checkinsTodayRow.rows[0].cnt, 10);

            // Checkins this week
            const checkinsWeekParams = course_id ? [weekAgoIso, course_id] : [weekAgoIso];
            const checkinsWeekRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.checked_in_at >= $1 ${course_id ? 'AND c.id = $2' : ''}`,
                checkinsWeekParams
            );
            const total_checkins_week = parseInt(checkinsWeekRow.rows[0].cnt, 10);

            // Flagged pending review
            const flaggedParams = course_id ? [course_id] : [];
            const flaggedRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.status = 'flagged' ${courseFilter}`,
                flaggedParams
            );
            const flagged_pending_review = parseInt(flaggedRow.rows[0].cnt, 10);

            // Approval rate (approved / (approved + rejected), ignoring pending/flagged)
            const rateParams = course_id ? [course_id] : [];
            const approvalRow = await pgClient.query(
                `SELECT
                   COUNT(*) FILTER (WHERE ci.status = 'approved') AS approved,
                   COUNT(*) FILTER (WHERE ci.status IN ('approved','rejected')) AS decided
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE 1=1 ${courseFilter}`,
                rateParams
            );
            const decided = parseInt(approvalRow.rows[0].decided, 10);
            const approved = parseInt(approvalRow.rows[0].approved, 10);
            const approval_rate = decided > 0 ? approved / decided : 0;

            // Average risk score
            const avgRiskRow = await pgClient.query(
                `SELECT AVG(ci.risk_score) AS avg_risk FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.risk_score IS NOT NULL ${courseFilter}`,
                rateParams
            );
            const average_risk_score = parseFloat(avgRiskRow.rows[0].avg_risk) || 0;

            // High risk checkins today
            const highRiskParams = course_id ? [todayIso, course_id] : [todayIso];
            const highRiskRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.checked_in_at >= $1 AND ci.risk_score >= 0.5 ${course_id ? 'AND c.id = $2' : ''}`,
                highRiskParams
            );
            const high_risk_checkins_today = parseInt(highRiskRow.rows[0].cnt, 10);

            // Average attendance rate across closed sessions
            const attendanceParams = course_id ? [course_id] : [];
            const attendanceRow = await pgClient.query(
                `SELECT
                   SUM(ci_count.cnt) AS total_checkins,
                   SUM(enroll_count.enrolled) AS total_enrolled
                 FROM sessions s
                 JOIN courses c ON c.id = s.course_id
                 LEFT JOIN (
                   SELECT session_id, COUNT(*) AS cnt FROM checkins GROUP BY session_id
                 ) ci_count ON ci_count.session_id = s.id
                 LEFT JOIN (
                   SELECT e.course_id, COUNT(*) AS enrolled
                   FROM enrollments e WHERE e.is_active = TRUE GROUP BY e.course_id
                 ) enroll_count ON enroll_count.course_id = s.course_id
                 WHERE s.status IN ('closed','active') ${courseFilter}`,
                attendanceParams
            );
            const totalCheckins = parseInt(attendanceRow.rows[0].total_checkins, 10) || 0;
            const totalEnrolled = parseInt(attendanceRow.rows[0].total_enrolled, 10) || 0;
            const average_attendance_rate = totalEnrolled > 0 ? totalCheckins / totalEnrolled : 0;

            // Daily checkins trend
            const trendParams = course_id ? [sinceIso, course_id] : [sinceIso];
            const trendRow = await pgClient.query(
                `SELECT DATE(ci.checked_in_at) AS date, COUNT(*) AS count
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.checked_in_at >= $1 ${course_id ? 'AND c.id = $2' : ''}
                 GROUP BY DATE(ci.checked_in_at)
                 ORDER BY DATE(ci.checked_in_at) ASC`,
                trendParams
            );
            const checkins_by_day = trendRow.rows.map(r => ({
                date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
                count: parseInt(r.count, 10)
            }));

            // Recent check-ins (last 20)
            const recentParams = course_id ? [course_id] : [];
            const recentRow = await pgClient.query(
                `SELECT ci.id, u.full_name AS student_name, u.email AS student_email,
                        s.name AS session_name, c.code AS course_code,
                        ci.status, ci.risk_score, ci.checked_in_at AS timestamp
                 FROM checkins ci
                 JOIN users u ON u.id = ci.student_id
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE 1=1 ${courseFilter}
                 ORDER BY ci.checked_in_at DESC
                 LIMIT 20`,
                recentParams
            );

            res.status(200).send({
                total_courses,
                total_students,
                total_sessions,
                active_sessions,
                total_checkins_today,
                total_checkins_week,
                average_attendance_rate,
                flagged_pending_review,
                today_checkins: total_checkins_today,
                flagged_pending: flagged_pending_review,
                approval_rate,
                average_risk_score,
                high_risk_checkins_today,
                trends: {
                    checkins_by_day
                },
                recent_checkins: recentRow.rows
            });
        } finally {
            pgClient.release();
        }
    });

    // GET /api/v1/stats/sessions/:sessionId
    fastify.get(`${BASE_URL}/stats/sessions/:sessionId`, {
        schema: {
            params: {
                type: 'object',
                required: ['sessionId'],
                properties: { sessionId: { type: 'string' } }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { sessionId } = req.params as { sessionId: string };
        const pgClient = await fastify.pg.connect();
        try {
            const sessionRow = await pgClient.query(
                `SELECT s.*, c.code AS course_code FROM sessions s
                 JOIN courses c ON c.id = s.course_id WHERE s.id = $1`,
                [sessionId]
            );
            if (!sessionRow.rows.length) {
                return res.status(404).send({ message: 'Session not found' });
            }
            const session = sessionRow.rows[0];

            const enrolledRow = await pgClient.query(
                `SELECT COUNT(*) AS cnt FROM enrollments WHERE course_id = $1 AND is_active = TRUE`,
                [session.course_id]
            );
            const total_enrolled = parseInt(enrolledRow.rows[0].cnt, 10);

            const checkinStatsRow = await pgClient.query(
                `SELECT
                   COUNT(*) AS checked_in,
                   COUNT(*) FILTER (WHERE status = 'approved') AS approved,
                   COUNT(*) FILTER (WHERE status = 'flagged') AS flagged,
                   COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
                   COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                   AVG(risk_score) AS avg_risk,
                   AVG(distance_from_venue_meters) AS avg_distance,
                   COUNT(*) FILTER (WHERE risk_score < 0.3) AS low_risk,
                   COUNT(*) FILTER (WHERE risk_score >= 0.3 AND risk_score < 0.5) AS medium_risk,
                   COUNT(*) FILTER (WHERE risk_score >= 0.5) AS high_risk
                 FROM checkins WHERE session_id = $1`,
                [sessionId]
            );
            const cs = checkinStatsRow.rows[0];

            const checked_in = parseInt(cs.checked_in, 10);
            const attendance_rate = total_enrolled > 0 ? checked_in / total_enrolled : 0;

            res.status(200).send({
                session_id: session.id,
                session_name: session.name,
                course_code: session.course_code,
                scheduled_start: session.scheduled_start,
                status: session.status,
                total_enrolled,
                checked_in,
                checked_in_count: checked_in,
                attendance_rate,
                by_status: {
                    approved: parseInt(cs.approved, 10),
                    flagged: parseInt(cs.flagged, 10),
                    rejected: parseInt(cs.rejected, 10),
                    pending: parseInt(cs.pending, 10)
                },
                approved_count: parseInt(cs.approved, 10),
                flagged_count: parseInt(cs.flagged, 10),
                average_risk_score: parseFloat(cs.avg_risk) || 0,
                average_distance_meters: parseFloat(cs.avg_distance) || 0,
                risk_distribution: {
                    low: parseInt(cs.low_risk, 10),
                    medium: parseInt(cs.medium_risk, 10),
                    high: parseInt(cs.high_risk, 10)
                }
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${BASE_URL}/stats/courses/:courseId`, {
        schema: {
            params: {
                type: 'object',
                required: ['courseId'],
                properties: { courseId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', format: 'date-time' },
                    end_date: { type: 'string', format: 'date-time' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { courseId } = req.params as { courseId: string };
        const { start_date, end_date } = req.query as { start_date?: string; end_date?: string };

        const pgClient = await fastify.pg.connect();
        try {
            const courseResult = await pgClient.query(
                `SELECT id, code, name
                 FROM courses
                 WHERE id = $1`,
                [courseId]
            );
            if (!courseResult.rows.length) {
                return res.status(404).send({ detail: 'Course not found' });
            }
            const course = courseResult.rows[0];

            const params: any[] = [courseId];
            const where: string[] = ['s.course_id = $1'];

            if (start_date) {
                params.push(start_date);
                where.push(`s.scheduled_start >= $${params.length}`);
            }
            if (end_date) {
                params.push(end_date);
                where.push(`s.scheduled_start <= $${params.length}`);
            }

            const whereClause = `WHERE ${where.join(' AND ')}`;

            const sessionsResult = await pgClient.query(
                `SELECT s.id AS session_id,
                        s.name,
                        DATE(s.scheduled_start) AS date,
                        COALESCE(ec.enrolled, 0) AS enrolled,
                        COALESCE(cc.checked_in, 0) AS checked_in
                 FROM sessions s
                 LEFT JOIN (
                    SELECT course_id, COUNT(*)::int AS enrolled
                    FROM enrollments
                    WHERE is_active = TRUE
                    GROUP BY course_id
                 ) ec ON ec.course_id = s.course_id
                 LEFT JOIN (
                    SELECT session_id, COUNT(*)::int AS checked_in
                    FROM checkins
                    GROUP BY session_id
                 ) cc ON cc.session_id = s.id
                 ${whereClause}
                 ORDER BY s.scheduled_start ASC`,
                params
            );

            const enrolledResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total_enrolled
                 FROM enrollments
                 WHERE course_id = $1 AND is_active = TRUE`,
                [courseId]
            );
            const total_enrolled = enrolledResult.rows[0]?.total_enrolled ?? 0;

            const sessions = sessionsResult.rows.map((r: any) => ({
                session_id: r.session_id,
                name: r.name,
                date: r.date,
                checked_in: r.checked_in,
                attendance_rate: r.enrolled > 0 ? r.checked_in / r.enrolled : 0
            }));

            const total_sessions = sessions.length;
            const overall_attendance_rate = total_sessions > 0
                ? sessions.reduce((acc: number, s: any) => acc + s.attendance_rate, 0) / total_sessions
                : 0;

            const studentAttendanceResult = await pgClient.query(
                `SELECT u.id AS student_id,
                        u.full_name AS student_name,
                        COUNT(DISTINCT ci.session_id)::int AS sessions_attended,
                        COALESCE(AVG(ci.risk_score), 0) AS average_risk_score
                 FROM enrollments e
                 JOIN users u ON u.id = e.student_id
                 LEFT JOIN sessions s ON s.course_id = e.course_id
                 LEFT JOIN checkins ci ON ci.session_id = s.id AND ci.student_id = e.student_id
                 WHERE e.course_id = $1 AND e.is_active = TRUE
                 GROUP BY u.id, u.full_name
                 ORDER BY u.full_name ASC`,
                [courseId]
            );

            const student_attendance = studentAttendanceResult.rows.map((r: any) => ({
                student_id: r.student_id,
                student_name: r.student_name,
                sessions_attended: r.sessions_attended,
                attendance_rate: total_sessions > 0 ? r.sessions_attended / total_sessions : 0,
                average_risk_score: parseFloat(r.average_risk_score) || 0
            }));

            const low_attendance_alerts = student_attendance
                .filter((s: any) => s.attendance_rate < 0.75)
                .map((s: any) => ({
                    student_id: s.student_id,
                    student_name: s.student_name,
                    attendance_rate: s.attendance_rate,
                    sessions_missed: Math.max(total_sessions - s.sessions_attended, 0)
                }));

            const flaggedCheckinsResult = await pgClient.query(
                `SELECT COUNT(*)::int AS cnt
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 WHERE s.course_id = $1
                   AND ci.status IN ('flagged', 'appealed')`,
                [courseId]
            );
            const flagged_checkins = flaggedCheckinsResult.rows[0]?.cnt ?? 0;

            res.status(200).send({
                course_id: course.id,
                course_code: course.code,
                course_name: course.name,
                total_sessions,
                total_enrolled,
                overall_attendance_rate,
                average_attendance_rate: overall_attendance_rate,
                flagged_checkins,
                sessions,
                student_attendance,
                low_attendance_alerts
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${BASE_URL}/stats/students/:studentId`, {
        schema: {
            params: {
                type: 'object',
                required: ['studentId'],
                properties: { studentId: { type: 'string' } }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR, USER_ROLE_TYPES.ADMIN])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { studentId } = req.params as { studentId: string };
        const pgClient = await fastify.pg.connect();
        try {
            const studentResult = await pgClient.query(
                `SELECT id, full_name, email
                 FROM users
                 WHERE id = $1`,
                [studentId]
            );
            if (!studentResult.rows.length) {
                return res.status(404).send({ detail: 'Student not found' });
            }
            const student = studentResult.rows[0];

            const coursesResult = await pgClient.query(
                `SELECT c.id AS course_id,
                        c.code AS course_code,
                        COUNT(DISTINCT s.id)::int AS total_sessions,
                        COUNT(DISTINCT ci.session_id)::int AS sessions_attended,
                        COALESCE(AVG(ci.risk_score), 0) AS average_risk_score
                 FROM enrollments e
                 JOIN courses c ON c.id = e.course_id
                 LEFT JOIN sessions s ON s.course_id = c.id
                 LEFT JOIN checkins ci ON ci.session_id = s.id AND ci.student_id = e.student_id
                 WHERE e.student_id = $1 AND e.is_active = TRUE
                 GROUP BY c.id, c.code
                 ORDER BY c.code ASC`,
                [studentId]
            );

            const courses = coursesResult.rows.map((r: any) => ({
                course_id: r.course_id,
                course_code: r.course_code,
                attendance_rate: r.total_sessions > 0 ? r.sessions_attended / r.total_sessions : 0,
                sessions_attended: r.sessions_attended,
                total_sessions: r.total_sessions,
                average_risk_score: parseFloat(r.average_risk_score) || 0
            }));

            const recentCheckinsResult = await pgClient.query(
                `SELECT s.name AS session_name,
                        c.code AS course_code,
                        ci.checked_in_at,
                        ci.status
                 FROM checkins ci
                 JOIN sessions s ON s.id = ci.session_id
                 JOIN courses c ON c.id = s.course_id
                 WHERE ci.student_id = $1
                 ORDER BY ci.checked_in_at DESC
                 LIMIT 20`,
                [studentId]
            );

            const totalSessions = courses.reduce((acc: number, c: any) => acc + c.total_sessions, 0);
            const attendedSessions = courses.reduce((acc: number, c: any) => acc + c.sessions_attended, 0);

            res.status(200).send({
                student_id: student.id,
                student_name: student.full_name,
                student_email: student.email,
                total_enrolled_courses: courses.length,
                total_sessions: totalSessions,
                attended_sessions: attendedSessions,
                attendance_rate: totalSessions > 0 ? attendedSessions / totalSessions : 0,
                courses,
                recent_checkins: recentCheckinsResult.rows,
                recent_sessions: recentCheckinsResult.rows
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(statsController);
