import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestError } from './error.js';

export enum CHECKIN_STATUS {
    PENDING = 'pending',
    APPROVED = 'approved',
    FLAGGED = 'flagged',
    REJECTED = 'rejected',
    APPEALED = 'appealed'
}

export type Checkin = {
    id: string;
    session_id: string;
    student_id: string;
    status: CHECKIN_STATUS;
    checked_in_at: Date;
    latitude: number;
    longitude: number;
    distance_from_venue_meters: number;
    liveness_passed: boolean;
    liveness_score: number | null;
    risk_score: number | null;
    risk_factors: Record<string, any>[];
};

export type SessionCheckinRecord = {
    id: string;
    student_id: string;
    student_name: string;
    student_email: string;
    status: CHECKIN_STATUS;
    timestamp: Date;
    checked_in_at: Date;
    latitude: number;
    longitude: number;
    distance_from_venue_meters: number;
    liveness_passed: boolean;
    liveness_score: number | null;
    risk_score: number | null;
    risk_factors: Record<string, any>[];
};

export type StudentCheckinRecord = {
    id: string;
    session_id: string;
    session_name: string;
    course_id: string;
    course_code: string;
    course_name: string;
    status: CHECKIN_STATUS;
    checked_in_at: Date;
    risk_score: number | null;
};

export const CheckinModel = {
    listByStudent: async function listByStudent(
        pgClient: PoolClient,
        studentId: string,
        filters: { course_id?: string; limit?: number }
    ): Promise<StudentCheckinRecord[]> {
        const { course_id, limit = 50 } = filters;
        const params: any[] = [studentId];
        let where = 'WHERE ci.student_id = $1';

        if (course_id) {
            params.push(course_id);
            where += ` AND s.course_id = $${params.length}`;
        }

        params.push(Math.max(1, Math.min(limit, 200)));

        const { rows } = await pgClient.query(
            `SELECT ci.id,
                    ci.session_id,
                    s.name AS session_name,
                    s.course_id,
                    c.code AS course_code,
                    c.name AS course_name,
                    ci.status,
                    ci.checked_in_at,
                    ci.risk_score
             FROM checkins ci
             JOIN sessions s ON s.id = ci.session_id
             JOIN courses c ON c.id = s.course_id
             ${where}
             ORDER BY ci.checked_in_at DESC
             LIMIT $${params.length}`,
            params
        );

        return rows as StudentCheckinRecord[];
    },

    listBySession: async function listBySession(
        pgClient: PoolClient,
        sessionId: string
    ): Promise<SessionCheckinRecord[]> {
        const { rows } = await pgClient.query(
            `SELECT c.id,
                    c.student_id,
                    u.full_name AS student_name,
                    u.email AS student_email,
                    c.status,
                    c.checked_in_at AS timestamp,
                    c.checked_in_at,
                    c.latitude,
                    c.longitude,
                    c.distance_from_venue_meters,
                    c.liveness_passed,
                    c.liveness_score,
                    c.risk_score,
                    c.risk_factors
             FROM checkins c
             INNER JOIN users u ON u.id = c.student_id
             WHERE c.session_id = $1
             ORDER BY c.checked_in_at DESC`,
            [sessionId]
        );

        return rows.map((row) => {
            const normalizedRiskFactors = Array.isArray(row.risk_factors)
                ? row.risk_factors
                : row.risk_factors && typeof row.risk_factors === 'object'
                    ? [row.risk_factors]
                    : [];

            return {
                ...row,
                risk_factors: normalizedRiskFactors
            } as SessionCheckinRecord;
        });
    },

    getBySessionAndStudent: async function getBySessionAndStudent(
        pgClient: PoolClient,
        sessionId: string,
        studentId: string
    ): Promise<Checkin | null> {
        const { rows } = await pgClient.query(
            `SELECT id, session_id, student_id, status, checked_in_at, latitude, longitude,
                    distance_from_venue_meters, liveness_passed, liveness_score, risk_score, risk_factors
             FROM checkins
             WHERE session_id = $1 AND student_id = $2
             ORDER BY checked_in_at DESC
             LIMIT 1`,
            [sessionId, studentId]
        );
        return (rows[0] as Checkin) || null;
    },

    create: async function create(
        pgClient: PoolClient,
        payload: {
            session_id: string;
            student_id: string;
            latitude: number;
            longitude: number;
            distance_from_venue_meters: number;
            liveness_passed?: boolean;
            liveness_score?: number | null;
            risk_score?: number | null;
            risk_factors?: Record<string, any>[];
            status?: CHECKIN_STATUS;
        }
    ): Promise<Checkin> {
        const existing = await CheckinModel.getBySessionAndStudent(
            pgClient,
            payload.session_id,
            payload.student_id
        );
        if (existing) {
            throw new BadRequestError('Already checked in');
        }

        const now = new Date();
        const status = payload.status || CHECKIN_STATUS.APPROVED;
        const livenessPassed = payload.liveness_passed ?? false;
        const riskFactors = payload.risk_factors ?? [];

        const { rows } = await pgClient.query(
            `INSERT INTO checkins (
                id, session_id, student_id, status, checked_in_at,
                latitude, longitude, distance_from_venue_meters,
                liveness_passed, liveness_score, risk_score, risk_factors
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12::jsonb
            )
            RETURNING id, session_id, student_id, status, checked_in_at,
                      latitude, longitude, distance_from_venue_meters,
                      liveness_passed, liveness_score, risk_score, risk_factors`,
            [
                uuidv4(),
                payload.session_id,
                payload.student_id,
                status,
                now,
                payload.latitude,
                payload.longitude,
                payload.distance_from_venue_meters,
                livenessPassed,
                payload.liveness_score ?? 0,
                payload.risk_score ?? 0,
                JSON.stringify(riskFactors)
            ]
        );

        return rows[0] as Checkin;
    }
};
