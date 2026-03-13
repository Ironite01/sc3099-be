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
                total_sessions,
                active_sessions,
                total_checkins_today,
                total_checkins_week,
                average_attendance_rate,
                flagged_pending_review,
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
                attendance_rate,
                by_status: {
                    approved: parseInt(cs.approved, 10),
                    flagged: parseInt(cs.flagged, 10),
                    rejected: parseInt(cs.rejected, 10),
                    pending: parseInt(cs.pending, 10)
                },
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
}

export default fp(statsController);
