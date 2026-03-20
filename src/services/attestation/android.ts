import { GoogleAuth } from 'google-auth-library';
import { playintegrity } from '@googleapis/playintegrity';

// This only works if frontend is an Android app
/* https://developer.android.com/google/play/integrity/verdicts */

export default async function androidAttestationService(token: string) {
    const packageName = process.env.PLAY_INTEGRITY_PACKAGE_NAME;
    if (!packageName) {
        throw new Error('Missing PLAY_INTEGRITY_PACKAGE_NAME');
    }

    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/playintegrity']
    });

    const client = playintegrity({
        version: 'v1',
        auth
    });

    const response = await client.v1.decodeIntegrityToken({
        packageName,
        requestBody: {
            integrityToken: token
        }
    });

    const payload = response.data.tokenPayloadExternal;
    const verdicts = payload?.deviceIntegrity?.deviceRecognitionVerdict || [];

    // Check if it is emulated
    const isEmulator = verdicts.includes('MEETS_VIRTUAL_INTEGRITY');
    // Check if rooted
    const isRootedJailbroken = verdicts.includes('MEETS_DEVICE_INTEGRITY');

    return {
        isEmulator,
        isRootedJailbroken,
        integrityVerdict: verdicts.join(',') || null
    };
}