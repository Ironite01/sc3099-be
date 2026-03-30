import { ML_BASE_URL } from "../index.js";

export interface FaceVerifyPostRequest {
    image: string;
    reference_template_hash: string;
}

export interface FaceVerifyResponse {
    match_passed: boolean;
    match_score: number;
    match_threshold: number;
    face_detected: boolean;
    current_template_hash: string;
}

const verify = {
    post: async (payload: FaceVerifyPostRequest) => {
        const { image, reference_template_hash } = payload;
        if (!payload || !image || !reference_template_hash) {
            throw new Error('Missing required fields: image and reference_template_hash are required.');
        }

        const response = await fetch(`${ML_BASE_URL}/face/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image,
                reference_template_hash
            })
        });

        if (!response || !response.ok) {
            throw new Error('Failed to verify face.');
        }

        return await response.json() as FaceVerifyResponse;
    }
}

export default verify;
