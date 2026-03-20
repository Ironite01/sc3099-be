import androidAttestationService from './android.js';
import { PLATFORM_TYPES } from '../../model/device.js';
import { BadRequestError } from '../../model/error.js';
import { iosAttestationService } from './ios.js';

interface AttestationResult {
    passed: boolean;
    isEmulator: boolean;
    isRootedJailbroken: boolean;
    integrityVerdict: string | null;
    error?: string;
}

interface PlatformAttestation {
    integrityToken?: string;
    attestationObject?: string;
}

interface DeviceAttestationPayload {
    platform?: string | undefined;
    platformAttestation?: PlatformAttestation | undefined;
    deviceDetectedEmulator?: boolean | undefined;
    deviceDetectedRooted?: boolean | undefined;
}

export default async function deviceAttestationService(payload: DeviceAttestationPayload): Promise<AttestationResult> {
    const platform = (payload.platform || PLATFORM_TYPES.WEB).toLowerCase();
    // Public key attestation


    // Platform attestation - not applicable for PWA
    const isEmulator = Boolean(payload.deviceDetectedEmulator);
    const isRootedJailbroken = Boolean(payload.deviceDetectedRooted);

    return {
        passed: !isEmulator && !isRootedJailbroken,
        isEmulator,
        isRootedJailbroken,
        integrityVerdict: null
    };

    /*
    if (platform === PLATFORM_TYPES.ANDROID) {
        if (!payload.platformAttestation?.integrityToken) {
            throw new BadRequestError('Android devices must provide integrityToken');
        }

        const results = await androidAttestationService(payload.platformAttestation.integrityToken);
        return { ...results, passed: (!results.isEmulator && !results.isRootedJailbroken) };
    }
    else if (platform === PLATFORM_TYPES.IOS) {
        if (!payload.platformAttestation?.attestationObject) {
            throw new BadRequestError('iOS devices must provide attestationObject');
        }
        return iosAttestationService(payload.platformAttestation.attestationObject);
    } else {
        const isEmulator = Boolean(payload.deviceDetectedEmulator);
        const isRootedJailbroken = Boolean(payload.deviceDetectedRooted);

        return {
            passed: !isEmulator && !isRootedJailbroken,
            isEmulator,
            isRootedJailbroken,
            integrityVerdict: null
        };
    }
    */
}