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

export const CheckinModel = {
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
                liveness_passed, liveness_score, risk_score, risk_factors,
                created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12::jsonb,
                $13, $14
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
                payload.liveness_score ?? null,
                payload.risk_score ?? null,
                JSON.stringify(riskFactors),
                now,
                now
            ]
        );

        return rows[0] as Checkin;
    }
};
