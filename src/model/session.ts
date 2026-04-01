import { NotFoundError, BadRequestError, AppError } from './error.js';
import type { PoolClient } from 'pg';
import { USER_ROLE_TYPES } from './user.js';
import { buildQrPayload, generateQrSecretAndExpiry } from '../helpers/qr.js';
import QRCode from 'qrcode';

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

export type Session = {
    id: string;
    course_id: string;
    instructor_id: string | null;
    name: string;
    session_type: SESSION_TYPE;
    description?: string;
    scheduled_start: Date;
    scheduled_end: Date;
    checkin_opens_at: Date;
    checkin_closes_at: Date;
    status: SESSION_STATUS;
    actual_start?: Date | null;
    actual_end?: Date | null;
    venue_latitude?: number | null;
    venue_longitude?: number | null;
    venue_name?: string | null;
    geofence_radius_meters?: number | null;
    require_liveness_check?: boolean;
    require_face_match?: boolean;
    risk_threshold?: number | null;
    qr_code_enabled?: boolean;
    qr_code_secret?: string | null;
    qr_code_expires_at?: Date | null;
    created_at: Date;
    updated_at: Date;
};

export type SessionQrPayload = {
    qr_payload: string;
    qr_expires_at: Date;
    qr_ttl_seconds: number;
    qr_code: string;
};

export const SessionModel = {
    getById: async function (pgClient: any, id: string): Promise<Session> {
        try {
            const { rows } = await pgClient.query(
                `SELECT * FROM sessions WHERE id = $1`,
                [id]
            );
            if (rows.length === 0) {
                throw new NotFoundError();
            }
            return rows[0] as Session;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getActiveSessions: async function (pgClient: any, params: {
        course_id?: string,
        instructor_id?: string,
        start_date?: string,
        end_date?: string,
        limit: number,
        offset: number
    }): Promise<(Session & { course_code: string })[]> {
        try {
            const { course_id, instructor_id, start_date, end_date, limit, offset } = params;

            const filters: string[] = ['status = $1'];
            const values: any[] = [SESSION_STATUS.ACTIVE];

            if (course_id) {
                filters.push(`course_id = $${filters.length + 1}`);
                values.push(course_id);
            }
            if (instructor_id) {
                filters.push(`instructor_id = $${filters.length + 1}`);
                values.push(instructor_id);
            }
            if (start_date) {
                if (isNaN(Date.parse(start_date))) {
                    throw new BadRequestError('Invalid start_date format');
                }
                filters.push(`scheduled_end >= $${filters.length + 1}`);
                values.push(start_date);
            }
            if (end_date) {
                if (isNaN(Date.parse(end_date))) {
                    throw new BadRequestError('Invalid end_date format');
                }
                filters.push(`scheduled_start <= $${filters.length + 1}`);
                values.push(end_date);
            }
            if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
                throw new BadRequestError('start_date cannot be after end_date');
            }

            const { rows } = await pgClient.query(
                `SELECT s.id, s.course_id, s.name, s.status, s.scheduled_start,
            s.scheduled_end, s.checkin_opens_at, s.checkin_closes_at, s.venue_name,
            s.venue_latitude, s.venue_longitude, c.code AS course_code
            FROM sessions s 
            INNER JOIN courses c 
            ON s.course_id = c.id 
            WHERE ${filters.join(' AND ')} 
            LIMIT $${filters.length + 1}
            OFFSET $${filters.length + 2}`,
                [...values, limit, offset]
            );
            return rows as ({ course_code: string } & Session)[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getAllFilteredSessions: async function (pgClient: any, filters: any): Promise<{ items: any[], total: number }> {
        try {
            const { status, course_id, instructor_id, start_date, end_date, limit = 50, offset = 0 } = filters;

            let query = `
            WITH enroll_counts AS (
                SELECT e.course_id, COUNT(*)::int AS total_enrolled
                FROM enrollments e
                WHERE e.is_active = TRUE
                GROUP BY e.course_id
            ),
            checkin_counts AS (
                SELECT ch.session_id, COUNT(*)::int AS checked_in_count
                FROM checkins ch
                GROUP BY ch.session_id
            )
            SELECT s.*, c.code as course_code, c.name as course_name,
                   u.full_name as instructor_name,
                   COALESCE(ec.total_enrolled, 0) as total_enrolled,
                   COALESCE(cc.checked_in_count, 0) as checked_in_count
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN users u ON s.instructor_id = u.id
            LEFT JOIN enroll_counts ec ON ec.course_id = s.course_id
            LEFT JOIN checkin_counts cc ON cc.session_id = s.id
            WHERE 1=1
        `;
            const params: any[] = [];
            let paramIndex = 1;

            if (status) {
                query += ` AND s.status = $${paramIndex++}`;
                params.push(status);
            }
            if (course_id) {
                query += ` AND s.course_id = $${paramIndex++}`;
                params.push(course_id);
            }
            if (instructor_id) {
                query += ` AND s.instructor_id = $${paramIndex++}`;
                params.push(instructor_id);
            }
            if (start_date) {
                query += ` AND s.scheduled_start >= $${paramIndex++}`;
                params.push(start_date);
            }
            if (end_date) {
                query += ` AND s.scheduled_start <= $${paramIndex++}`;
                params.push(end_date);
            }

            query += ` ORDER BY s.scheduled_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(limit, offset);

            const result = await pgClient.query(query, params);

            let countQuery = 'SELECT COUNT(*) FROM sessions s WHERE 1=1';
            const countParams: any[] = [];
            let countParamIndex = 1;
            if (status) {
                countQuery += ` AND s.status = $${countParamIndex++}`;
                countParams.push(status);
            }
            if (course_id) {
                countQuery += ` AND s.course_id = $${countParamIndex++}`;
                countParams.push(course_id);
            }
            if (instructor_id) {
                countQuery += ` AND s.instructor_id = $${countParamIndex++}`;
                countParams.push(instructor_id);
            }
            if (start_date) {
                countQuery += ` AND s.scheduled_start >= $${countParamIndex++}`;
                countParams.push(start_date);
            }
            if (end_date) {
                countQuery += ` AND s.scheduled_start <= $${countParamIndex++}`;
                countParams.push(end_date);
            }
            const countResult = await pgClient.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].count);

            return { items: result.rows as Session[], total };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getFilteredSessionsByUser: async function (pgClient: any, user: { sub: string, role: USER_ROLE_TYPES }, { status, upcoming, limit = 50, session_id }: { status?: string, upcoming?: boolean, limit?: number, session_id?: string }): Promise<Session[]> {
        try {
            const params: any[] = [];
            const where: string[] = [];

            const userId = user?.sub as string;
            const role = user?.role as USER_ROLE_TYPES;

            if (role === USER_ROLE_TYPES.STUDENT) {
                params.push(userId);
                where.push(`EXISTS (
                    SELECT 1 FROM enrollments e
                    WHERE e.course_id = s.course_id
                      AND e.student_id = $${params.length}
                      AND e.is_active = TRUE
                )`);
            } else if (role === USER_ROLE_TYPES.ADMIN) {
                // Admin sees all sessions - no filter needed
            } else {
                // Instructor/TA sees only their own sessions
                params.push(userId);
                where.push(`s.instructor_id = $${params.length}`);
            }

            if (status) {
                params.push(status);
                where.push(`s.status = $${params.length}`);
            }

            if (upcoming) {
                where.push('s.scheduled_start >= NOW()');
            }

            if (session_id) {
                params.push(session_id);
                where.push(`s.id = $${params.length}`);
            }

            params.push(Math.max(1, Math.min(limit, 200)));

            const query = `
                SELECT s.*, c.code AS course_code, c.name AS course_name,
                       u.full_name AS instructor_name
                FROM sessions s
                JOIN courses c ON c.id = s.course_id
                LEFT JOIN users u ON u.id = s.instructor_id
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY s.scheduled_start ASC
                LIMIT $${params.length}
            `;

            const result = await pgClient.query(query, params);
            return result.rows as Session[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    findById: async function (pgClient: any, userRole: USER_ROLE_TYPES, id: string): Promise<any | null> {
        try {
            const { rows } = await pgClient.query(`
            SELECT s.*, c.code as course_code, c.name as course_name,
                   u.full_name as instructor_name
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN users u ON s.instructor_id = u.id
            WHERE s.id = $1
        `, [id]);

            if (rows.length === 0) {
                throw new NotFoundError();
            }
            const data: any = rows[0] as Session & { course_code: string, course_name: string, instructor_name: string };

            // Session detail should remain read-only. QR issuance is handled
            // explicitly through the dedicated session QR endpoint.
            delete data.qr_code_secret;
            delete data.qr_code_expires_at;

            return data;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async function (pgClient: PoolClient, payload: {
        course_id: string;
        instructor_id?: string;
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
    }) {
        try {
            const {
                course_id,
                instructor_id,
                name,
                session_type,
                description,
                scheduled_start,
                scheduled_end,
                status,
                venue_latitude,
                venue_longitude,
                venue_name,
                geofence_radius_meters,
                require_liveness_check,
                require_face_match,
                risk_threshold,
                qr_code_enabled = false
            } = payload;
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

            // Default values...
            if (!checkin_closes_at) {
                checkin_closes_at = new Date(new Date(scheduled_start).getTime() + 30 * 60 * 1000);
            }
            if (!checkin_opens_at) {
                checkin_opens_at = new Date(new Date(scheduled_start).getTime() - 15 * 60 * 1000);
            }

            let qr_code_secret = null;
            let qr_code_expires_at = null;

            if (qr_code_enabled) {
                const { qrSecret, qrCodeExpiresAt } = generateQrSecretAndExpiry();
                qr_code_secret = qrSecret;
                qr_code_expires_at = qrCodeExpiresAt;
            }

            const res = await pgClient.query(
                `INSERT INTO sessions (
                id, course_id, instructor_id, name, session_type, description,
                scheduled_start, scheduled_end, checkin_opens_at, checkin_closes_at,
                status, venue_latitude, venue_longitude, venue_name,
                geofence_radius_meters, require_liveness_check, require_face_match,
                risk_threshold, qr_code_enabled, qr_code_secret, qr_code_expires_at,
                created_at, updated_at
            ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            RETURNING *`,
                [
                    course_id,
                    instructor_id,
                    name,
                    session_type || SESSION_TYPE.OTHER,
                    description,
                    scheduled_start,
                    scheduled_end,
                    checkin_opens_at,
                    checkin_closes_at,
                    status || SESSION_STATUS.SCHEDULED,
                    venue_latitude,
                    venue_longitude,
                    venue_name,
                    geofence_radius_meters,
                    require_liveness_check,
                    require_face_match,
                    risk_threshold,
                    qr_code_enabled,
                    qr_code_secret,
                    qr_code_expires_at,
                    now,
                    now
                ]
            );
            return res.rows[0] as Session;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    update: async function (pgClient: any, user: { sub: string, role: USER_ROLE_TYPES }, id: string, data: {
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
    }): Promise<Session | null> {
        try {
            const getSessionRes = await this.getFilteredSessionsByUser(pgClient, user, { limit: 1, session_id: id });
            if (getSessionRes.length === 0) {
                throw new NotFoundError();
            }
            const currentSession = getSessionRes[0]!;
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
            const fields: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            const UPDATABLE_FIELDS = [
                'name', 'description', 'status', 'scheduled_start', 'scheduled_end',
                'checkin_opens_at', 'checkin_closes_at', 'venue_name', 'venue_latitude',
                'venue_longitude', 'geofence_radius_meters', 'require_liveness_check',
                'require_face_match', 'risk_threshold', 'qr_code_enabled'
            ];

            for (const field of UPDATABLE_FIELDS) {
                if ((data as any)[field] !== undefined) {
                    fields.push(`${field} = $${paramIndex++}`);
                    values.push((data as any)[field]);
                }
            }

            if (data.qr_code_enabled === false) {
                fields.push(`qr_code_secret = $${paramIndex++}`);
                values.push(null);
                fields.push(`qr_code_expires_at = $${paramIndex++}`);
                values.push(null);
            }

            if (fields.length === 0) {
                throw new Error('No valid fields to update');
            }

            fields.push('updated_at = NOW()');
            values.push(id);

            let query = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
            if (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA) {
                query += ` AND instructor_id = $${paramIndex + 1}`;
                values.push(user.sub);
            }
            query += ' RETURNING *';

            const { rows } = await pgClient.query(query, values);

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            return rows[0] as Session;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    delete: async function (pgClient: any, user: { sub: string, role: USER_ROLE_TYPES }, id: string) {
        try {
            const userId = user?.sub as string;
            const role = user?.role as USER_ROLE_TYPES;

            let sessionRes;
            if (role === USER_ROLE_TYPES.INSTRUCTOR || role === USER_ROLE_TYPES.TA) {
                sessionRes = await pgClient.query('DELETE FROM sessions WHERE id = $1 AND instructor_id = $2 AND status = $3 RETURNING *', [id, userId, SESSION_STATUS.SCHEDULED]);
            } else {
                sessionRes = await pgClient.query('DELETE FROM sessions WHERE id = $1 AND status = $2 RETURNING *', [id, SESSION_STATUS.SCHEDULED]);
            }
            const { rows } = sessionRes;

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            return sessionRes.rows[0] as Session;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    updateStatusById: async function (pgClient: any, id: string, status: SESSION_STATUS): Promise<Session | null> {
        try {
            // Admin can update status regardless of transition states
            const { rows } = await pgClient.query(
                `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [status, id]
            );

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            return rows[0] as Session;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    // TODO: Everything below needs to be refactored and tested accordingly
    closeExpiredActiveSessions: async function (pgClient: any): Promise<number> {
        const result = await pgClient.query(
            `UPDATE sessions
             SET status = $1,
                 actual_end = COALESCE(actual_end, NOW()),
                 updated_at = NOW()
             WHERE status = $2
               AND checkin_closes_at IS NOT NULL
               AND checkin_closes_at < NOW()`,
            [SESSION_STATUS.CLOSED, SESSION_STATUS.ACTIVE]
        );
        return result.rowCount ?? 0;
    },
    issueQr: async function (pgClient: any, id: string): Promise<SessionQrPayload> {
        const session = await this.getById(pgClient, id);

        if (session.status !== SESSION_STATUS.ACTIVE) {
            throw new BadRequestError('QR codes can only be issued for active sessions');
        }
        if (!session.qr_code_enabled) {
            throw new BadRequestError('QR codes are not enabled for this session');
        }

        const now = Date.now();
        let qrSecret = session.qr_code_secret;
        let qrExpiresAt = session.qr_code_expires_at ? new Date(session.qr_code_expires_at) : null;

        if (!qrSecret || !qrExpiresAt || qrExpiresAt.getTime() <= now) {
            const nextQr = generateQrSecretAndExpiry();
            qrSecret = nextQr.qrSecret;
            qrExpiresAt = nextQr.qrCodeExpiresAt;

            const updateResult = await pgClient.query(
                `UPDATE sessions
                 SET qr_code_secret = $1,
                     qr_code_expires_at = $2,
                     updated_at = NOW()
                 WHERE id = $3
                 RETURNING qr_code_secret, qr_code_expires_at`,
                [qrSecret, qrExpiresAt, id]
            );

            if (!updateResult.rows.length) {
                throw new NotFoundError();
            }

            qrSecret = updateResult.rows[0].qr_code_secret as string;
            qrExpiresAt = new Date(updateResult.rows[0].qr_code_expires_at);
        }

        const qrPayload = buildQrPayload(id, qrSecret, qrExpiresAt);
        const qrCode = await QRCode.toDataURL(qrPayload);
        const ttlSeconds = Math.max(0, Math.floor((qrExpiresAt.getTime() - now) / 1000));

        return {
            qr_payload: qrPayload,
            qr_expires_at: qrExpiresAt,
            qr_ttl_seconds: ttlSeconds,
            qr_code: qrCode
        };
    }
}