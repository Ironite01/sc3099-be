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
            let detail = 'Failed to check ML service health.';
            try {
                const body = await response.json();
                detail = body?.detail || body?.message || body?.error || detail;
            } catch {
                // ignore parse failure
            }
            throw new Error(`ML ${response.status}: ${detail}`);
        }

        return await response.json() as { status: string; };
    }
}

export default health;