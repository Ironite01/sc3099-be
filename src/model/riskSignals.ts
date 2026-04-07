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

const ALLOWED_SIGNAL_TYPES = new Set([
    'geo_out_of_bounds',
    'impossible_travel',
    'geo_accuracy_low',
    'vpn_detected',
    'proxy_detected',
    'tor_detected',
    'suspicious_ip',
    'device_unknown',
    'device_emulator',
    'device_rooted',
    'attestation_failed',
    'rapid_succession',
    'unusual_time',
    'pattern_anomaly',
    'liveness_failed',
    'liveness_low_confidence',
    'deepfake_suspected',
    'replay_suspected',
    'face_match_failed',
    'face_match_low_confidence'
]);

function normalizeSignalType(signalType: string): string {
    const key = String(signalType || '').trim().toLowerCase();
    if (ALLOWED_SIGNAL_TYPES.has(key)) {
        return key;
    }

    // Map ML aggregate keys into enum-backed categories.
    switch (key) {
        case 'liveness':
            return 'liveness_low_confidence';
        case 'face_match':
        case 'face_policy_penalty':
            return 'face_match_low_confidence';
        case 'device':
            return 'device_unknown';
        case 'network':
            return 'suspicious_ip';
        case 'geolocation':
            return 'geo_out_of_bounds';
        default:
            return 'pattern_anomaly';
    }
}

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
    // Multiple ML keys can map to the same persisted signal_type; collapse to one row per type.
    const dedupedByType = new Map<string, number>();
    for (const [signalType, rawWeight] of Object.entries(signalBreakdown)) {
        const normalizedType = normalizeSignalType(signalType);
        const weight = Number(rawWeight) || 0;
        const existing = dedupedByType.get(normalizedType);

        if (existing === undefined || Math.abs(weight) > Math.abs(existing)) {
            dedupedByType.set(normalizedType, weight);
        }
    }

    return Array.from(dedupedByType.entries()).map(([signal_type, weight]) => ({
        signal_type,
        severity: getSignalSeverity(weight),
        confidence: 1,
        details: recommendations.length ? { recommendations } : null,
        weight,
        detected_at: detectedAt
    }));
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
                    details: signal.details ? JSON.stringify(signal.details) : null,
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
