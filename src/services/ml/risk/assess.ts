import { ML_BASE_URL } from "../index.js";

export interface GeolocationData {
    latitude: number;
    longitude: number;
    accuracy: number;
}

export interface RiskAssessPostRequest {
    liveness_score?: number;
    face_match_score?: number;
    device_signature?: string;
    device_public_key?: string;
    ip_address?: string;
    user_agent?: string;
    geolocation?: GeolocationData;
}

export interface RiskAssessResponse {
    risk_score: number;
    risk_level: string;
    pass_threshold: boolean;
    risk_threshold: number;
    signal_breakdown: Record<string, number>;
    recommendations: string[];
}

const assess = {
    post: async (payload: RiskAssessPostRequest) => {
        if (!payload) {
            throw new Error('Missing required fields: payload is required.');
        }

        const response = await fetch(`${ML_BASE_URL}/risk/assess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                liveness_score: payload.liveness_score,
                face_match_score: payload.face_match_score,
                device_signature: payload.device_signature,
                device_public_key: payload.device_public_key,
                ip_address: payload.ip_address,
                user_agent: payload.user_agent,
                geolocation: payload.geolocation
            })
        });

        if (!response || !response.ok) {
            throw new Error('Failed to assess risk.');
        }

        return await response.json() as RiskAssessResponse;
    }
}

export default assess;
