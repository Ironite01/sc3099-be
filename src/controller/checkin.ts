import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';
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
                required: ['session_id', 'latitude', 'longitude', 'location_accuracy_meters', 'device_fingerprint'],
                additionalProperties: false
            }
        },
        preHandler: [fastify.authorize([USER_ROLE_TYPES.STUDENT])]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { session_id, latitude, longitude, location_accuracy_meters, device_fingerprint, liveness_challenge_response, qr_code } = req.body as any;
            const userId = (req.user as any)?.sub;

            const checkin = await CheckinModel.create(pgClient, userId, {
                session_id,
                latitude,
                longitude,
                location_accuracy_meters,
                device_fingerprint,
                liveness_challenge_response,
                qr_code
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
