import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestError } from './error.js';
import { SESSION_STATUS, SessionModel } from './session.js';
import { DeviceModel } from './device.js';
import { DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
import haversineDistance from '../helpers/haversineDistance.js';

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
    create: async function performCheckin(
        pgClient: PoolClient,
        studentId: string,
        payload: {
            session_id: string;
            latitude: number;
            longitude: number;
            location_accuracy_meters: number;
            device_fingerprint: string;
            liveness_challenge_response?: any;
            qr_code?: string;
        }
    ) {
        const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response = null, qr_code } = payload;
        // TODO: QR code verification
        const qrCodeVerified = false;

        const device = await DeviceModel.getByFingerprint(pgClient, studentId, device_fingerprint);
        if (!device || !device.is_active || device.revoked_at || !device.is_trusted) {
            throw new BadRequestError('Device is not allowed for check-in');
        }
        const session = await SessionModel.getById(pgClient, session_id);
        if (!session) {
            throw new BadRequestError('Session not found');
        }
        if (session.status !== SESSION_STATUS.ACTIVE) {
            throw new BadRequestError('Session not active');
        }
        // TODO: Verify that the student is enrolled in the course
        //

        const now = new Date();
        if (now < new Date(session.checkin_opens_at) || now > new Date(session.checkin_closes_at)) {
            throw new BadRequestError('Check-in window closed');
        }

        const venueLat = session.venue_latitude;
        const venueLon = session.venue_longitude;
        if (!venueLat || !venueLon) {
            throw new BadRequestError('Session does not have a valid venue location');
        }

        const geofenceRadius = session.geofence_radius_meters || DEFAULT_GEOFENCE_RADIUS_METERS;
        const diffDist = haversineDistance(latitude, longitude, venueLat, venueLon);
        if (diffDist > geofenceRadius) {
            throw new BadRequestError('Location is outside the permitted geofence');
        }

        // TODO: Get from Redis or ML side the risk and liveness
        const livenessPassed = true;
        const livenessScore = 0.95;
        const livenessChallengeType = JSON.stringify(liveness_challenge_response) || null;
        const riskScore = 0.1;
        const riskFactors: any[] = [];
        const status = CHECKIN_STATUS.APPROVED;
        const faceMatchPassed = null;
        const faceMatchScore = null;
        const faceEmbeddingHash = null;

        try {
            const { rows } = await pgClient.query(
                `INSERT INTO checkins (
                id, session_id, device_id, student_id, status, checked_in_at,
                latitude, longitude, distance_from_venue_meters,
                liveness_passed, liveness_score, risk_score, risk_factors,
                created_at, updated_at, location_accuracy_meters,
                liveness_challenge_type, face_match_passed, face_match_score, face_embedding_hash,
                qr_code_verified
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12::jsonb,
                $13, $14, $15, $16, $17, $18, $19, $20, $21
            )
            RETURNING id, session_id, student_id, status, checked_in_at,
                      latitude, longitude, distance_from_venue_meters,
                      liveness_passed, liveness_score, risk_score, risk_factors`,
                [
                    uuidv4(),
                    session_id,
                    device.id,
                    studentId,
                    status,
                    now,
                    latitude,
                    longitude,
                    diffDist,
                    livenessPassed,
                    livenessScore,
                    riskScore,
                    riskFactors,
                    now,
                    now,
                    location_accuracy_meters,
                    livenessChallengeType,
                    faceMatchPassed,
                    faceMatchScore,
                    faceEmbeddingHash,
                    qrCodeVerified
                ]
            );

            return rows[0] as Checkin;
        } catch (err: any) {
            if (err.code === '23505') {
                throw new BadRequestError('Student has already checked in for this session');
            }
            throw err;
        }
    },
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
                    TO_CHAR(ci.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
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
                    TO_CHAR(c.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS timestamp,
                    TO_CHAR(c.checked_in_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS checked_in_at,
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
    }
};
