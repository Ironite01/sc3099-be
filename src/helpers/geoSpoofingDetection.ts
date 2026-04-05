import haversineDistance from './haversineDistance.js';

/**
 * Maximum realistic speed for human travel (commercial flight speed, km/h)
 * Account for acceleration, altitude changes, etc.
 */
const MAX_REALISTIC_SPEED_KMH = 900;

/**
 * Minimum time between check-ins to avoid impossible travel false positives
 */
const MIN_TIME_BETWEEN_CHECKINS_MS = 1000;

export interface GeoSpoofingResult {
    isImpossibleTravel: boolean;
    distanceKm: number;
    timeElapsedMinutes: number;
    requiredSpeedKmh: number;
    maxRealisticSpeedKmh: number;
    gpsAccuracyAnomalies: string[];
}

/**
 * Detect GPS spoofing patterns:
 * 1. Impossible travel (too far too fast)
 * 2. Accuracy anomalies (suspiciously perfect or terrible accuracy)
 */
export function detectGeoSpoofing(
    currentLat: number,
    currentLng: number,
    currentAccuracyM: number,
    previousLat: number | null,
    previousLng: number | null,
    previousAccuracyM: number | null,
    previousCheckInTimeMs: number | null
): GeoSpoofingResult {
    const result: GeoSpoofingResult = {
        isImpossibleTravel: false,
        distanceKm: 0,
        timeElapsedMinutes: 0,
        requiredSpeedKmh: 0,
        maxRealisticSpeedKmh: MAX_REALISTIC_SPEED_KMH,
        gpsAccuracyAnomalies: []
    };

    // Check current accuracy anomalies
    if (currentAccuracyM < 2) {
        // Suspiciously perfect accuracy (likely spoofed)
        result.gpsAccuracyAnomalies.push('impossibly_precise_accuracy');
    }
    if (currentAccuracyM > 5000) {
        // Terrible accuracy (might indicate spoofing or poor GPS)
        result.gpsAccuracyAnomalies.push('extremely_poor_accuracy');
    }

    // If no previous check-in, can't detect impossible travel
    if (
        previousLat === null ||
        previousLng === null ||
        previousCheckInTimeMs === null
    ) {
        return result;
    }

    // Calculate distance and time
    const distanceM = haversineDistance(
        currentLat,
        currentLng,
        previousLat,
        previousLng
    );
    const distanceKm = distanceM / 1000;

    const now = Date.now();
    const timeElapsedMs = now - previousCheckInTimeMs;
    const timeElapsedMinutes = timeElapsedMs / (1000 * 60);
    const timeElapsedHours = timeElapsedMs / (1000 * 60 * 60);

    // Avoid false positives for very quick consecutive check-ins
    if (timeElapsedMs < MIN_TIME_BETWEEN_CHECKINS_MS) {
        // Too soon to travel any distance
        result.isImpossibleTravel = distanceM > 100; // Allow 100m for location fluctuation
        result.distanceKm = distanceKm;
        result.timeElapsedMinutes = timeElapsedMinutes;
        result.requiredSpeedKmh = distanceKm / timeElapsedHours;
        return result;
    }

    // Calculate required speed
    const requiredSpeedKmh = distanceKm / timeElapsedHours;

    // Detect impossible travel
    if (requiredSpeedKmh > MAX_REALISTIC_SPEED_KMH && timeElapsedHours > 0) {
        result.isImpossibleTravel = true;
    }

    // Check for accuracy regression (previous was good, now is bad)
    if (
        previousAccuracyM !== null &&
        previousAccuracyM < 50 &&
        currentAccuracyM > 1000
    ) {
        result.gpsAccuracyAnomalies.push('accuracy_degradation');
    }

    result.distanceKm = distanceKm;
    result.timeElapsedMinutes = timeElapsedMinutes;
    result.requiredSpeedKmh = requiredSpeedKmh;

    return result;
}

/**
 * Convert GPS spoofing detection results to risk signals
 */
export function getGeoSpoofingRiskFactors(
    spoofingResult: GeoSpoofingResult
): Array<{ type: string; weight: number }> {
    const factors: Array<{ type: string; weight: number }> = [];

    if (spoofingResult.isImpossibleTravel) {
        factors.push({
            type: 'impossible_travel',
            weight: 0.3 // High risk weight
        });
    }

    if (spoofingResult.gpsAccuracyAnomalies.includes('impossibly_precise_accuracy')) {
        factors.push({
            type: 'gps_accuracy_too_precise',
            weight: 0.15
        });
    }

    if (spoofingResult.gpsAccuracyAnomalies.includes('extremely_poor_accuracy')) {
        factors.push({
            type: 'geo_accuracy_low',
            weight: 0.1
        });
    }

    if (spoofingResult.gpsAccuracyAnomalies.includes('accuracy_degradation')) {
        factors.push({
            type: 'gps_accuracy_degradation',
            weight: 0.12
        });
    }

    return factors;
}
