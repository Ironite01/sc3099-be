import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { CheckinModel } from '../model/checkin.js';
import { AUDIT_ACTIONS, AuditModel } from '../model/audit.js';

function toCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (v: unknown): string => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(','))
    ].join('\n');
}

async function exportController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/export`;
    const resourceType = 'export';

    fastify.get(`${uri}/attendance/:courseId`, {
        schema: {
            params: {
                type: 'object',
                required: ['courseId'],
                properties: { courseId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['csv', 'json'], default: 'csv' },
                    start_date: { type: 'string' },
                    end_date: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { courseId } = req.params as { courseId: string };
        const { format = 'csv', start_date, end_date } = req.query as {
            format?: string; start_date?: string; end_date?: string;
        };

        const pgClient = await fastify.pg.connect();
        try {
            const checkinRes = await CheckinModel.getFilteredCheckins(pgClient, req.user as any, {
                course_id: courseId,
                start_date: start_date!,
                end_date: end_date!,
                limit: Infinity
            });
            if (!checkinRes) {
                throw new Error('Failed to retrieve check-in data');
            }

            const allCheckins = checkinRes.items;
            if (allCheckins.length === 0) {
                if (format === 'json') {
                    return res.status(200).send({
                        course_id: courseId,
                        summary: {
                            total_enrolled: 0,
                            total_records: 0,
                            attendance_rate: 0
                        },
                        records: []
                    });
                }
                return res.status(200).send('');
            }

            const rows = allCheckins.map(r => ({
                student_id: r.student_id,
                student_name: r.student_name,
                student_email: r.student_email,
                session_date: r.session_date,
                session_name: r.session_name,
                status: r.status,
                checked_in_at: r.checked_in_at,
                risk_score: r.risk_score,
                distance_from_venue_meters: r.distance_from_venue_meters,
                liveness_passed: r.liveness_passed,
                face_match_passed: r.face_match_passed
            }));

            const safeCode = allCheckins[0]!.course_code.replace(/[^a-zA-Z0-9_-]/g, '_');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            if (format === 'json') {
                res.header('Content-Type', 'application/json');
                res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.json"`);
                return res.status(200).send({
                    course_id: courseId,
                    summary: {
                        total_enrolled: rows.length,
                        total_records: rows.length,
                        attendance_rate: 100
                    },
                    records: rows
                });
            }

            const csv = toCsv(rows as Record<string, unknown>[]);
            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.csv"`);

            await AuditModel.log(pgClient, {
                userId: (req.user as any)?.sub,
                action: AUDIT_ACTIONS.DATA_EXPORTED,
                resourceType,
                resourceId: courseId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: { user_id: (req.user as any)?.sub, export_type: format }
            });

            return res.status(200).send(csv);
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/session/:sessionId`, {
        schema: {
            params: {
                type: 'object',
                required: ['sessionId'],
                properties: { sessionId: { type: 'string' } }
            },
            querystring: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['csv', 'json'], default: 'csv' }
                }
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.INSTRUCTOR]), fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { sessionId } = req.params as { sessionId: string };
        const { format = 'csv' } = req.query as { format?: string };

        const pgClient = await fastify.pg.connect();
        try {
            const checkinRes = await CheckinModel.getFilteredCheckins(pgClient, req.user as any, {
                session_id: sessionId,
                limit: Infinity
            });
            if (!checkinRes) {
                throw new Error('Failed to retrieve check-in data');
            }

            const allCheckins = checkinRes.items;
            if (allCheckins.length === 0) {
                if (format === 'json') {
                    return res.status(200).send({
                        session_id: sessionId,
                        summary: {
                            total_enrolled: 0,
                            total_records: 0,
                            attendance_rate: 0
                        },
                        records: []
                    });
                }
                return res.status(200).send('');
            }

            const rows = allCheckins.map(r => ({
                student_id: r.student_id,
                student_name: r.student_name,
                student_email: r.student_email,
                session_date: r.session_date,
                session_name: r.session_name,
                status: r.status,
                checked_in_at: r.checked_in_at,
                risk_score: r.risk_score,
                distance_from_venue_meters: r.distance_from_venue_meters,
                liveness_passed: r.liveness_passed,
                face_match_passed: r.face_match_passed
            }));

            const safeCode = allCheckins[0]!.course_code.replace(/[^a-zA-Z0-9_-]/g, '_');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            if (format === 'json') {
                res.header('Content-Type', 'application/json');
                res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.json"`);
                return res.status(200).send({
                    session_id: sessionId,
                    summary: {
                        total_enrolled: rows.length,
                        total_records: rows.length,
                        attendance_rate: 100
                    },
                    records: rows
                });
            }

            const csv = toCsv(rows as Record<string, unknown>[]);
            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', `attachment; filename="attendance_${safeCode}_${timestamp}.csv"`);

            await AuditModel.log(pgClient, {
                userId: (req.user as any)?.sub,
                action: AUDIT_ACTIONS.DATA_EXPORTED,
                resourceType,
                resourceId: sessionId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: { user_id: (req.user as any)?.sub, export_type: format }
            });
            return res.status(200).send(csv);
        } finally {
            pgClient.release();
        }
    });
}

export default fp(exportController);
