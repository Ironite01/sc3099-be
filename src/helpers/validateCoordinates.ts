/**
 * Validates that latitude and longitude are within valid bounds
 * Latitude: -90 to 90
 * Longitude: -180 to 180
 * 
 * Per SECURITY-REQUIREMENTS.md
 */
export function validateCoordinates(latitude: number, longitude: number): void {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new Error('Latitude and longitude must be numbers');
    }

    if (latitude < -90 || latitude > 90) {
        throw new Error(`Invalid latitude: ${latitude}. Must be between -90 and 90`);
    }

    if (longitude < -180 || longitude > 180) {
        throw new Error(`Invalid longitude: ${longitude}. Must be between -180 and 180`);
    }
}
