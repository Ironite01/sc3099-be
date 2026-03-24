import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestError } from './error.js';
import { DeviceModel } from './device.js';
import { SESSION_STATUS, SessionModel } from './session.js';
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
    device_id?: string;
    status: CHECKIN_STATUS;
    checked_in_at: Date;
    verified_at?: Date;
    latitude?: number;
    longitude?: number;
    location_accuracy_meters?: number;
    distance_from_venue_meters?: number;
    liveness_passed?: boolean;
    liveness_score?: number;
    liveness_challenge_type?: string;
    face_match_passed?: boolean;
    face_match_score?: number;
    face_embedding_hash?: string;
    risk_score: number;
    risk_factors?: string;
    qr_code_verified?: boolean;
    reviewed_by_id?: string;
    reviewed_at?: Date;
    review_notes?: string;
    appeal_reason?: string;
    appealed_at?: Date;
    scheduled_deletion_at?: Date;
};

// TODO: Appeal, scheduled deletion, review, verify
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
    }
};
