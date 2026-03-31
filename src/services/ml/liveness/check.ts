import { ML_BASE_URL } from "../index.js";

export enum LivenessChallengeType {
    BLINK = "blink",
    HEAD_TURN = "head_turn",
    HEAD_UP = "head_up",
    HEAD_DOWN = "head_down",
    HEAD_LEFT = "head_left",
    HEAD_RIGHT = "head_right",
    PASSIVE = "passive"
}

export interface LivenessCheckPostRequest {
    challenge_response: string;
    challenge_type?: LivenessChallengeType;
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
        const { challenge_response, challenge_type = LivenessChallengeType.PASSIVE } = payload;
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
            let detail = 'Failed to check liveness.';
            try {
                const body = await response.json();
                detail = body?.detail || body?.message || body?.error || detail;
            } catch {
                // ignore parse failure
            }
            throw new Error(`ML ${response.status}: ${detail}`);
        }

        return await response.json() as LivenessCheckResponse;
    }
}

export default check;
