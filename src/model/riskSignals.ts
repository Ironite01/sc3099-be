import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError, BadRequestError } from './error.js';

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
        prisma: PrismaClient,
        checkinId: string,
        signals: Omit<RiskSignal, 'id' | 'checkin_id'>[]
    ): Promise<RiskSignal[]> => {
        try {
            if (!signals.length) {
                return [];
            }

            return await prisma.risk_signals.createManyAndReturn({
                data: signals.map(signal => ({
                    id: randomUUID(),
                    checkin_id: checkinId,
                    signal_type: signal.signal_type as any,
                    severity: signal.severity as any,
                    confidence: signal.confidence,
                    details: signal.details as any,
                    weight: signal.weight,
                    detected_at: signal.detected_at
                }))
            }) as RiskSignal[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getRiskSignalsByCheckinIds: async (prisma: PrismaClient, checkinIds: string[]): Promise<Map<string, RiskSignal[]>> => {
        const signalMap = new Map<string, RiskSignal[]>();
        if (!checkinIds.length) {
            return signalMap;
        }

        const rows = await prisma.risk_signals.findMany({
            where: { checkin_id: { in: checkinIds } },
            orderBy: [{ detected_at: 'asc' }, { id: 'asc' }]
        });

        for (const row of rows as RiskSignal[]) {
            const existing = signalMap.get(row.checkin_id) || [];
            existing.push(row);
            signalMap.set(row.checkin_id, existing);
        }

        return signalMap;
    }
};