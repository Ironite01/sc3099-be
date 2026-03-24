import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, BadRequestError } from './error.js';

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
        const { rows } = await pgClient.query(
            `SELECT * FROM sessions WHERE id = $1`,
            [id]
        );
        if (rows.length === 0) {
            throw new NotFoundError();
        }
        return rows[0] as Session;
    },
    getActiveSessions: async function (pgClient: any, params: {
        course_id?: string,
        instructor_id?: string,
        start_date?: string,
        end_date?: string,
        limit: number,
        offset: number
    }): Promise<(Session & { course_code: string })[]> {
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
    }
};
