import { SessionStatus, VALID_SESSION_STATUSES } from '../enums.js';

export interface SessionCreateData {
    course_id: string;
    instructor_id?: string | null;
    name: string;
    session_type?: string;
    description?: string | null;
    scheduled_start: string;
    scheduled_end: string;
    checkin_opens_at?: string;
    checkin_closes_at?: string;
    venue_name?: string | null;
    venue_latitude?: number | null;
    venue_longitude?: number | null;
    geofence_radius_meters?: number | null;
    require_liveness_check?: boolean;
    require_face_match?: boolean;
    risk_threshold?: number | null;
}

export interface SessionUpdateData {
    name?: string;
    description?: string;
    status?: SessionStatus;
    scheduled_start?: string;
    scheduled_end?: string;
    checkin_opens_at?: string;
    checkin_closes_at?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_liveness_check?: boolean;
    require_face_match?: boolean;
    risk_threshold?: number;
}

export interface SessionListFilters {
    status?: string;
    course_id?: string;
    instructor_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
}

export interface MySessionsFilters {
    status?: string;
    upcoming?: boolean;
    limit?: number;
}

const UPDATABLE_FIELDS = [
    'name', 'description', 'status', 'scheduled_start', 'scheduled_end',
    'checkin_opens_at', 'checkin_closes_at', 'venue_name', 'venue_latitude',
    'venue_longitude', 'geofence_radius_meters', 'require_liveness_check',
    'require_face_match', 'risk_threshold'
];

export class Session {
    id!: string;
    course_id!: string;
    instructor_id!: string | null;
    name!: string;
    session_type!: string;
    description!: string | null;
    scheduled_start!: Date;
    scheduled_end!: Date;
    checkin_opens_at!: Date;
    checkin_closes_at!: Date;
    status!: string;
    venue_name!: string | null;
    venue_latitude!: number | null;
    venue_longitude!: number | null;
    geofence_radius_meters!: number | null;
    require_liveness_check!: boolean;
    require_face_match!: boolean;
    risk_threshold!: number | null;
    created_at!: Date;
    updated_at!: Date;

    constructor(row: any) {
        Object.assign(this, row);
    }

    /**
     * List all sessions with filters and joined course/instructor info (instructor/admin).
     */
    static async findAll(pgClient: any, filters: SessionListFilters): Promise<{ items: any[], total: number }> {
        const { status, course_id, instructor_id, start_date, end_date, limit = 50, offset = 0 } = filters;

        let query = `
            SELECT s.*, c.code as course_code, c.name as course_name,
                   u.full_name as instructor_name,
                   COALESCE((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id AND e.is_active = TRUE), 0) as total_enrolled,
                   COALESCE((SELECT COUNT(*) FROM checkins ch WHERE ch.session_id = s.id), 0) as checked_in_count
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN users u ON s.instructor_id = u.id
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

        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM sessions WHERE 1=1';
        const countParams: any[] = [];
        let countParamIndex = 1;
        if (status) {
            countQuery += ` AND status = $${countParamIndex++}`;
            countParams.push(status);
        }
        if (course_id) {
            countQuery += ` AND course_id = $${countParamIndex++}`;
            countParams.push(course_id);
        }
        if (instructor_id) {
            countQuery += ` AND instructor_id = $${countParamIndex++}`;
            countParams.push(instructor_id);
        }
        const countResult = await pgClient.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        return { items: result.rows, total };
    }

    /**
     * List currently active sessions (public, no auth needed).
     */
    static async findActive(pgClient: any): Promise<any[]> {
        const result = await pgClient.query(`
            SELECT s.id, s.course_id, c.code as course_code, s.name, s.status,
                   s.scheduled_start, s.scheduled_end,
                   s.checkin_opens_at, s.checkin_closes_at, s.venue_name
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            WHERE s.status = 'active'
              AND NOW() >= s.checkin_opens_at
              AND NOW() <= s.checkin_closes_at
            ORDER BY s.scheduled_start ASC
        `);
        return result.rows;
    }

    /**
     * Find sessions for a specific user based on their role.
     * Students: enrolled courses only. Instructors/TAs: taught sessions. Admin: all.
     */
    static async findByUser(pgClient: any, user: { id: string, role: string }, filters: MySessionsFilters): Promise<any[]> {
        const { status, upcoming, limit = 50 } = filters;

        let query = `
            SELECT s.*, c.code as course_code, c.name as course_name
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
        `;
        const params: any[] = [];
        let paramIndex = 1;

        if (user.role === 'student') {
            query += ` INNER JOIN enrollments e ON e.course_id = s.course_id
                       AND e.student_id = $${paramIndex++} AND e.is_active = TRUE`;
            params.push(user.id);
        } else if (user.role === 'instructor' || user.role === 'ta') {
            query += ` WHERE s.instructor_id = $${paramIndex++}`;
            params.push(user.id);
        }
        // Admin sees all sessions (no filter)

        const hasWhere = user.role === 'instructor' || user.role === 'ta';

        if (status) {
            query += hasWhere ? ` AND` : ` WHERE`;
            query += ` s.status = $${paramIndex++}`;
            params.push(status);
        }
        if (upcoming) {
            query += (hasWhere || status) ? ` AND` : ` WHERE`;
            query += ` s.scheduled_start > NOW()`;
        }

        query += ` ORDER BY s.scheduled_start ASC LIMIT $${paramIndex++}`;
        params.push(limit);

        const result = await pgClient.query(query, params);
        return result.rows;
    }

    /**
     * Find a single session by ID with joined course/instructor info.
     */
    static async findById(pgClient: any, id: string): Promise<any | null> {
        const result = await pgClient.query(`
            SELECT s.*, c.code as course_code, c.name as course_name,
                   u.full_name as instructor_name
            FROM sessions s
            LEFT JOIN courses c ON s.course_id = c.id
            LEFT JOIN users u ON s.instructor_id = u.id
            WHERE s.id = $1
        `, [id]);

        return result.rows.length > 0 ? result.rows[0] : null;
    }

    /**
     * Create a new session with validation.
     */
    static async create(pgClient: any, data: SessionCreateData): Promise<Session> {
        const {
            course_id,
            instructor_id = null,
            name,
            session_type = 'lecture',
            description = null,
            scheduled_start,
            scheduled_end,
            checkin_opens_at,
            checkin_closes_at,
            venue_name = null,
            venue_latitude = null,
            venue_longitude = null,
            geofence_radius_meters = null,
            require_liveness_check = true,
            require_face_match = false,
            risk_threshold = null
        } = data;

        // Default check-in window: opens 15min before start, closes 30min after start
        const startTime = new Date(scheduled_start);
        const endTime = new Date(scheduled_end);
        const defaultOpensAt = checkin_opens_at || new Date(startTime.getTime() - 15 * 60 * 1000).toISOString();
        const defaultClosesAt = checkin_closes_at || new Date(startTime.getTime() + 30 * 60 * 1000).toISOString();
        const opensAt = new Date(defaultOpensAt);
        const closesAt = new Date(defaultClosesAt);

        // Validation
        if (startTime <= new Date()) {
            throw new Error('scheduled_start must be in the future');
        }
        if (endTime <= startTime) {
            throw new Error('scheduled_end must be after scheduled_start');
        }
        if (closesAt <= opensAt) {
            throw new Error('checkin_closes_at must be after checkin_opens_at');
        }

        const result = await pgClient.query(
            `INSERT INTO sessions (
                id, course_id, instructor_id, name, session_type, description,
                scheduled_start, scheduled_end, checkin_opens_at, checkin_closes_at,
                status, venue_name, venue_latitude, venue_longitude,
                geofence_radius_meters, require_liveness_check, require_face_match,
                risk_threshold, created_at, updated_at
            )
             VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                'scheduled', $10, $11, $12,
                $13, $14, $15, $16, NOW(), NOW()
             )
             RETURNING *`,
            [
                course_id, instructor_id, name, session_type, description,
                scheduled_start, scheduled_end, defaultOpensAt, defaultClosesAt,
                venue_name, venue_latitude, venue_longitude,
                geofence_radius_meters, require_liveness_check, require_face_match,
                risk_threshold
            ]
        );

        return new Session(result.rows[0]);
    }

    /**
     * Update a session by ID. Only updates fields that are provided.
     */
    static async update(pgClient: any, id: string, data: SessionUpdateData): Promise<Session | null> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (const field of UPDATABLE_FIELDS) {
            if ((data as any)[field] !== undefined) {
                fields.push(`${field} = $${paramIndex++}`);
                values.push((data as any)[field]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const query = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await pgClient.query(query, values);

        return result.rows.length > 0 ? new Session(result.rows[0]) : null;
    }

    /**
     * Update only the status of a session. Validates the status value.
     */
    static async updateStatus(pgClient: any, id: string, status: string): Promise<Session | null> {
        if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
            throw new Error(`Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}`);
        }

        const result = await pgClient.query(
            `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id]
        );

        return result.rows.length > 0 ? new Session(result.rows[0]) : null;
    }

    /**
     * Delete a session. Only scheduled sessions can be deleted.
     */
    static async delete(pgClient: any, id: string): Promise<boolean> {
        // Check if session exists and is scheduled
        const checkResult = await pgClient.query(
            'SELECT status FROM sessions WHERE id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            throw new Error('Session not found');
        }

        if (checkResult.rows[0].status !== SessionStatus.SCHEDULED) {
            throw new Error('Only scheduled sessions can be deleted. Use cancel for active/closed sessions.');
        }

        await pgClient.query('DELETE FROM sessions WHERE id = $1', [id]);
        return true;
    }
}
