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
    session_type: string; // could be SESSION_TYPE
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

    // TODO: Validate if this works
    create: async function (pgClient: PoolClient, payload: Partial<Session>) {
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
        } = payload as any;

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
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            RETURNING *`,
            [
                uuidv4(),
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
    }
};
