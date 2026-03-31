import { NotFoundError, BadRequestError, AppError } from './error.js';
import type { PoolClient } from 'pg';

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
    qr_code_secret?: string | null;
    qr_code_expires_at?: Date | null;
    created_at: Date;
    updated_at: Date;
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
                filters.push(`scheduled_start >= $${filters.length + 1}`);
                values.push(start_date);
            }
            if (end_date) {
                if (isNaN(Date.parse(end_date))) {
                    throw new BadRequestError('Invalid end_date format');
                }
                filters.push(`scheduled_end <= $${filters.length + 1}`);
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
    findAll: async function (pgClient: any, filters: any): Promise<{ items: any[], total: number }> {
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
        const total = parseInt(countResult.rows[0].count, 10);

        return { items: result.rows, total };
    },
    findById: async function (pgClient: any, id: string): Promise<any | null> {
        const result = await pgClient.query(`
            SELECT s.*, c.code as course_code, c.name as course_name,
                   u.full_name as instructor_name
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN users u ON s.instructor_id = u.id
            WHERE s.id = $1
        `, [id]);

        return result.rows.length > 0 ? result.rows[0] : null;
    },
    create: async function (pgClient: PoolClient, payload: any) {
        const {
            course_id,
            instructor_id,
            name,
            session_type,
            description,
            scheduled_start,
            scheduled_end,
            checkin_opens_at,
            checkin_closes_at,
            status,
            venue_latitude,
            venue_longitude,
            venue_name,
            geofence_radius_meters,
            require_liveness_check,
            require_face_match,
            risk_threshold,
            qr_code_secret,
            qr_code_expires_at
        } = payload;

        if (!course_id || !name || !scheduled_start || !scheduled_end || !checkin_opens_at || !checkin_closes_at) {
            throw new BadRequestError('Missing required session fields');
        }

        const now = new Date();
        const res = await pgClient.query(
            `INSERT INTO sessions (
                id, course_id, instructor_id, name, session_type, description,
                scheduled_start, scheduled_end, checkin_opens_at, checkin_closes_at,
                status, venue_latitude, venue_longitude, venue_name,
                geofence_radius_meters, require_liveness_check, require_face_match,
                risk_threshold, qr_code_secret, qr_code_expires_at,
                created_at, updated_at
            ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
                qr_code_secret,
                qr_code_expires_at,
                now,
                now
            ]
        );
        return res.rows[0] as Session;
    },

    update: async function (pgClient: any, id: string, data: any): Promise<Session | null> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        const UPDATABLE_FIELDS = [
            'name', 'description', 'status', 'scheduled_start', 'scheduled_end',
            'checkin_opens_at', 'checkin_closes_at', 'venue_name', 'venue_latitude',
            'venue_longitude', 'geofence_radius_meters', 'require_liveness_check',
            'require_face_match', 'risk_threshold'
        ];

        for (const field of UPDATABLE_FIELDS) {
            if ((data as any)[field] !== undefined) {
                fields.push(`${field} = $${paramIndex++}`);
                values.push((data as any)[field]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }

        fields.push('updated_at = NOW()');
        values.push(id);

        const query = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await pgClient.query(query, values);

        return result.rows.length > 0 ? result.rows[0] as Session : null;
    },

    updateStatus: async function (pgClient: any, id: string, status: SESSION_STATUS): Promise<Session | null> {
        const result = await pgClient.query(
            `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id]
        );

        return result.rows.length > 0 ? result.rows[0] as Session : null;
    },

    delete: async function (pgClient: any, id: string): Promise<boolean> {
        const checkResult = await pgClient.query(
            'SELECT status FROM sessions WHERE id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            throw new Error('Session not found');
        }

        if (checkResult.rows[0].status !== SESSION_STATUS.SCHEDULED) {
            throw new Error('Only scheduled sessions can be deleted. Use cancel for active/closed sessions.');
        }

        await pgClient.query('DELETE FROM sessions WHERE id = $1', [id]);
        return true;
    }
}