import { ML_BASE_URL } from "../index.js";

export interface LivenessCheckPostRequest {
    challenge_response: string;
    challenge_type?: string;
}

export interface LivenessCheckResponse {
    liveness_passed: boolean;
    liveness_score: number;
    liveness_threshold: number;
    face_embedding_hash: string;
    details: Record<string, any>;
}

const check = {
    post: async (payload: LivenessCheckPostRequest) => {
        const { challenge_response, challenge_type = "passive" } = payload;
        if (!payload || !challenge_response) {
            throw new Error('Missing required fields: challenge_response is required.');
        }

        const response = await fetch(`${ML_BASE_URL}/liveness/check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                challenge_response,
                challenge_type
            })
        });

        if (!response || !response.ok) {
            throw new Error('Failed to check liveness.');
        }

        return await response.json() as LivenessCheckResponse;
    }
}

export default check;
