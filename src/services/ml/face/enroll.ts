import { ML_BASE_URL } from "../index.js";

export interface FaceEnrollPostRequest {
    user_id: string;
    image: string;
    camera_consent?: boolean;
}

export interface FaceEnrollResponse {
    enrollment_successful: boolean;
    face_template_hash: string;
    quality_score: number;
    details: Record<string, any>;
}

const enroll = {
    post: async (payload: FaceEnrollPostRequest) => {
        const { user_id, image, camera_consent = false } = payload;
        if (!payload || !user_id || !image) {
            throw new Error('Missing required fields: user_id and image are required.');
        }

        const response = await fetch(`${ML_BASE_URL}/face/enroll`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user_id,
                image,
                camera_consent
            })
        });

        if (!response || !response.ok) {
            let detail = 'Failed to enroll face.';
            try {
                const body = await response.json();
                detail = body?.detail || body?.message || body?.error || detail;
            } catch {
                // ignore parse failure
            }
            throw new Error(`ML ${response.status}: ${detail}`);
        }

        return await response.json() as FaceEnrollResponse;
    }
}

export default enroll;