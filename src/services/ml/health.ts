import { ML_BASE_URL } from "./index.js";

const health = {
    get: async () => {
        const response = await fetch(`${ML_BASE_URL}/health`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response || !response.ok) {
            throw new Error('Failed to check ML service health.');
        }

        return await response.json() as { status: string; };
    }
}

export default health;