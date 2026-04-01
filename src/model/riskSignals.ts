import type { PoolClient } from 'pg';

export enum RiskSignalSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
};

export type RiskSignal = {
    id: string;
    checkin_id: string;
    signal_type: string;
    severity: RiskSignalSeverity;
    confidence: number;
    details: Record<string, any> | null;
    weight: number;
    detected_at: Date;
};

export function normalizeRiskFactors(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
}

export function getSignalSeverity(weight: number): RiskSignal['severity'] {
    const normalizedWeight = Math.abs(weight);
    if (normalizedWeight >= 0.5) {
        return RiskSignalSeverity.CRITICAL;
    }
    if (normalizedWeight >= 0.3) {
        return RiskSignalSeverity.HIGH;
    }
    if (normalizedWeight >= 0.1) {
        return RiskSignalSeverity.MEDIUM;
    }
    return RiskSignalSeverity.LOW;
}

export function buildRiskSignals(
    signalBreakdown: Record<string, number>,
    detectedAt: Date,
    recommendations: string[]
): Omit<RiskSignal, 'id' | 'checkin_id'>[] {
    return Object.entries(signalBreakdown).map(([signalType, rawWeight]) => {
        const weight = Number(rawWeight) || 0;
        return {
            signal_type: signalType,
            severity: getSignalSeverity(weight),
            confidence: 1,
            details: recommendations.length ? { recommendations } : null,
            weight,
            detected_at: detectedAt
        };
    });
}

export const RiskSignalModel = {
    insertRiskSignals: async (
        pgClient: PoolClient,
        checkinId: string,
        signals: Omit<RiskSignal, 'id' | 'checkin_id'>[]
    ): Promise<RiskSignal[]> => {
        if (!signals.length) {
            return [];
        }

        const values: any[] = [];
        const placeholders = signals.map((signal, index) => {
            const baseIndex = index * 7;
            values.push(
                checkinId,
                signal.signal_type,
                signal.severity,
                signal.confidence,
                signal.details ? JSON.stringify(signal.details) : null,
                signal.weight,
                signal.detected_at
            );
            return `(gen_random_uuid()::text, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}::jsonb, $${baseIndex + 6}, $${baseIndex + 7})`;
        });

        const { rows } = await pgClient.query(
            `INSERT INTO risk_signals (
                id,
                checkin_id,
                signal_type,
                severity,
                confidence,
                details,
                weight,
                detected_at
            ) VALUES ${placeholders.join(', ')}
            RETURNING id, checkin_id, signal_type, severity, confidence, details, weight, detected_at`,
            values
        );

        return rows as RiskSignal[];
    },
    getRiskSignalsByCheckinIds: async (pgClient: PoolClient, checkinIds: string[]): Promise<Map<string, RiskSignal[]>> => {
        const signalMap = new Map<string, RiskSignal[]>();
        if (!checkinIds.length) {
            return signalMap;
        }

        const { rows } = await pgClient.query(
            `SELECT id, checkin_id, signal_type, severity, confidence, details, weight, detected_at
             FROM risk_signals
             WHERE checkin_id = ANY($1::text[])
             ORDER BY detected_at ASC, id ASC`,
            [checkinIds]
        );

        for (const row of rows as RiskSignal[]) {
            const existing = signalMap.get(row.checkin_id) || [];
            existing.push(row);
            signalMap.set(row.checkin_id, existing);
        }

        return signalMap;
    }
};