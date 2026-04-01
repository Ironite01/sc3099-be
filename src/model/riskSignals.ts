import type { PoolClient } from 'pg';
import { AppError, BadRequestError } from './error.js';

type RiskSignalSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RiskSignalFactor = {
    type: string;
    severity?: RiskSignalSeverity;
    confidence?: number;
    weight?: number;
    details?: Record<string, any> | null;
};

function inferSeverity(weight: number): RiskSignalSeverity {
    if (weight >= 0.7) return 'critical';
    if (weight >= 0.5) return 'high';
    if (weight >= 0.3) return 'medium';
    return 'low';
}

function normalizeRiskSignalFactor(factor: RiskSignalFactor): Required<Pick<RiskSignalFactor, 'type' | 'severity' | 'confidence' | 'weight'>> & { details: Record<string, any> | null } {
    const weight = typeof factor.weight === 'number' ? factor.weight : 0.1;
    return {
        type: factor.type,
        severity: factor.severity || inferSeverity(weight),
        confidence: typeof factor.confidence === 'number' ? factor.confidence : 1.0,
        weight,
        details: factor.details ?? null
    };
}

function parseDetails(details: any): Record<string, any> | null {
    if (!details) return null;
    if (typeof details === 'object') return details as Record<string, any>;
    if (typeof details === 'string') {
        try {
            return JSON.parse(details) as Record<string, any>;
        } catch {
            return null;
        }
    }
    return null;
}

export const RiskSignalModel = {
    replaceForCheckin: async function replaceForCheckin(pgClient: PoolClient, checkinId: string, factors: RiskSignalFactor[]): Promise<void> {
        try {
            await pgClient.query('DELETE FROM risk_signals WHERE checkin_id = $1', [checkinId]);

            for (const factor of factors) {
                if (!factor?.type) continue;
                const normalized = normalizeRiskSignalFactor(factor);
                await pgClient.query(
                    `INSERT INTO risk_signals (
						id, checkin_id, signal_type, severity, confidence, details, weight, detected_at
					) VALUES (
						gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW()
					)`,
                    [
                        checkinId,
                        normalized.type,
                        normalized.severity,
                        normalized.confidence,
                        normalized.details ? JSON.stringify(normalized.details) : null,
                        normalized.weight
                    ]
                );
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getByCheckinId: async function getByCheckinId(pgClient: PoolClient, checkinId: string): Promise<RiskSignalFactor[]> {
        try {
            const { rows } = await pgClient.query(
                `SELECT signal_type, severity, confidence, details, weight
				 FROM risk_signals
				 WHERE checkin_id = $1
				 ORDER BY detected_at ASC`,
                [checkinId]
            );

            return rows.map((row: any) => ({
                type: row.signal_type,
                severity: row.severity,
                confidence: row.confidence,
                details: parseDetails(row.details),
                weight: row.weight
            }));
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },

    getByCheckinIds: async function getByCheckinIds(pgClient: PoolClient, checkinIds: string[]): Promise<Map<string, RiskSignalFactor[]>> {
        try {
            if (checkinIds.length === 0) return new Map();

            const { rows } = await pgClient.query(
                `SELECT checkin_id, signal_type, severity, confidence, details, weight
				 FROM risk_signals
				 WHERE checkin_id = ANY($1::text[])
				 ORDER BY detected_at ASC`,
                [checkinIds]
            );

            const grouped = new Map<string, RiskSignalFactor[]>();
            for (const row of rows) {
                const id = row.checkin_id as string;
                const existing = grouped.get(id) || [];
                existing.push({
                    type: row.signal_type,
                    severity: row.severity,
                    confidence: row.confidence,
                    details: parseDetails(row.details),
                    weight: row.weight
                });
                grouped.set(id, existing);
            }
            return grouped;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
};