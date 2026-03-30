import face from './face/index.js';
import health from './health.js';
import liveness from './liveness/index.js';
import risk from './risk/index.js';

export const ML_BASE_URL = `http://${process.env.ML_HOST || 'localhost'}:${process.env.ML_PORT || 8001}`;

export const MlServices = {
    face,
    health,
    liveness,
    risk,
}