import { TRUST_SCORE_TYPES } from "../model/device.js";

export default function getRiskLevel(riskScore: number): string {
    if (riskScore < 0.3) {
        return TRUST_SCORE_TYPES.LOW;
    } else if (riskScore < 0.7) {
        return TRUST_SCORE_TYPES.MEDIUM
    } else {
        return TRUST_SCORE_TYPES.HIGH;
    }
}