import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL, DEFAULT_GEOFENCE_RADIUS_METERS } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { BadRequestError, UnauthorizedError } from '../model/error.js';
import haversineDistance from '../helpers/haversineDistance.js';
import { SESSION_STATUS, SessionModel } from '../model/session.js';
import { CheckinModel } from '../model/checkin.js';

async function checkinController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/checkins`;

    fastify.post(uri, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    location_accuracy_meters: { type: 'number' },
                    device_fingerprint: { type: 'string' },
                    liveness_challenge_response: { type: 'string' },
                    qr_code: { type: 'string' }
                },
                required: ['session_id', 'latitude', 'longitude'],
                additionalProperties: false
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { session_id, latitude, longitude } = req.body as any;
            const studentId = (req.user as any)?.sub;
            if (!studentId) {
                throw new UnauthorizedError();
            }

            const session = await SessionModel.getById(pgClient, session_id);
            const venueLat = session.venue_latitude; // e.g. SMU
            const venueLon = session.venue_longitude;
            const geofenceRadius = session.geofence_radius_meters || DEFAULT_GEOFENCE_RADIUS_METERS;

            if (session.status !== SESSION_STATUS.ACTIVE) {
                throw new BadRequestError('Session not active');
            }

            const now = new Date();
            if (now < new Date(session.checkin_opens_at) || now > new Date(session.checkin_closes_at)) {
                throw new BadRequestError('Check-in window closed');
            }

            if (!venueLat || !venueLon) {
                throw new BadRequestError('Session does not have a valid venue location');
            }

            const distance = haversineDistance(latitude, longitude, venueLat, venueLon);
            if (distance > geofenceRadius) {
                throw new BadRequestError('Location is outside the permitted geofence');
            }

            // TODO: Add the checkin
            // TODO: Get from Redis or ML side the risk and liveness

            const checkin = await CheckinModel.create(pgClient, {
                session_id,
                student_id: studentId,
                latitude,
                longitude,
                distance_from_venue_meters: distance,
                liveness_passed: false,
                liveness_score: null,
                risk_score: null,
                risk_factors: []
            });

            res.status(201).send({
                id: checkin.id,
                session_id: checkin.session_id,
                student_id: checkin.student_id,
                status: checkin.status,
                checked_in_at: checkin.checked_in_at,
                latitude: checkin.latitude,
                longitude: checkin.longitude,
                distance_from_venue_meters: checkin.distance_from_venue_meters,
                liveness_passed: checkin.liveness_passed,
                liveness_score: checkin.liveness_score,
                risk_score: checkin.risk_score,
                risk_factors: checkin.risk_factors
            });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(checkinController);
