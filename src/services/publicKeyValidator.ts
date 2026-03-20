import { createPublicKey, KeyObject } from 'crypto';

export interface ValidatedPublicKey {
    key: KeyObject;
    format: string; // 'pem' or 'der'
    type: string; // 'rsa', 'rsa-pss', 'dsa', 'ec', 'ed25519', 'ed448', 'x25519', 'x448'
    asymmetricKeyType: string;
    asymmetricKeyDetails: any;
}

/**
 * Validates a public key string and returns a parsed PublicKeyObject
 * Supports both PEM and base64-encoded DER formats
 * 
 * @param publicKeyString - PEM-encoded or base64-encoded public key
 * @returns Validated public key with metadata
 * @throws Error if the public key is invalid
 */
export function validatePublicKey(publicKeyString: string): ValidatedPublicKey {
    if (!publicKeyString || typeof publicKeyString !== 'string') {
        throw new Error('Public key must be a non-empty string');
    }

    const trimmed = publicKeyString.trim();

    try {
        // Try to parse as PEM format
        if (trimmed.startsWith('-----BEGIN')) {
            return parsePublicKey(trimmed, 'pem');
        }

        // Try to parse as base64-encoded DER
        if (isValidBase64(trimmed)) {
            try {
                const derBuffer = Buffer.from(trimmed, 'base64');
                return parsePublicKey(derBuffer, 'der');
            } catch (e) {
                // Not valid DER, might be PEM without headers
                throw new Error(`Invalid base64 or DER format: ${e instanceof Error ? e.message : 'unknown error'}`);
            }
        }

        throw new Error('Public key must be in PEM format (-----BEGIN PUBLIC KEY-----) or base64-encoded DER');
    } catch (error) {
        throw new Error(`Public key validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}

/**
 * Parses a public key from PEM or DER format
 */
function parsePublicKey(key: string | Buffer, format: 'pem' | 'der'): ValidatedPublicKey {
    const publicKeyObject = createPublicKey({
        key,
        format
    });

    return {
        key: publicKeyObject,
        format,
        type: publicKeyObject.asymmetricKeyType!,
        asymmetricKeyType: publicKeyObject.asymmetricKeyType!,
        asymmetricKeyDetails: publicKeyObject.asymmetricKeyDetails
    };
}

/**
 * Converts a public key to PEM format for storage
 * This ensures consistent storage format regardless of input format
 */
export function publicKeyToPEM(validatedKey: ValidatedPublicKey): string {
    return validatedKey.key.export({ type: 'spki', format: 'pem' }) as string;
}

/**
 * Verifies that a public key matches a given fingerprint
 * Useful for detecting key rotation or tampering
 * 
 * @param publicKeyPEM - PEM-encoded public key
 * @param expectedFingerprint - Expected fingerprint (SHA256 hex)
 * @returns true if fingerprints match
 */
export async function verifyPublicKeyFingerprint(publicKeyPEM: string, expectedFingerprint: string): Promise<boolean> {
    try {
        const { createHash } = await import('crypto');
        const fingerprint = createHash('sha256')
            .update(publicKeyPEM)
            .digest('hex');

        return fingerprint === expectedFingerprint;
    } catch (error) {
        return false;
    }
}

/**
 * Generates a fingerprint (SHA256) of a public key
 * Can be used to track key changes across device registrations
 */
export function generatePublicKeyFingerprint(publicKeyPEM: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256')
        .update(publicKeyPEM)
        .digest('hex');
}

/**
 * Extracts the key size in bits from a validated public key
 */
function getKeySizeInBits(validatedKey: ValidatedPublicKey): number {
    const keyType = validatedKey.type;
    const details = validatedKey.asymmetricKeyDetails || {};

    // For RSA keys, modulusLength is already in bits
    if (keyType === 'rsa' || keyType === 'rsa-pss') {
        return details.modulusLength || 0;
    }

    // For EC keys, size depends on the named curve
    if (keyType === 'ec') {
        const curve = details.namedCurve;
        const curveSizes: Record<string, number> = {
            'prime256v1': 256,
            'P-256': 256,
            'secp256r1': 256,
            'secp384r1': 384,
            'P-384': 384,
            'secp521r1': 521,
            'P-521': 521,
            'secp256k1': 256
        };
        return curveSizes[curve] || 256;
    }

    // For EdDSA keys
    if (keyType === 'ed25519') return 256;
    if (keyType === 'ed448') return 456;
    if (keyType === 'x25519') return 256;
    if (keyType === 'x448') return 448;

    return 0;
}

/**
 * Validates that a key is appropriate for the platform
 */
export function validateKeyForPlatform(
    validatedKey: ValidatedPublicKey,
    platform: string
): { valid: boolean; reason?: string } {
    const keyType = validatedKey.type;

    // Recommended key types by platform
    const recommendedKeysPerPlatform: Record<string, string[]> = {
        ios: ['ec', 'rsa', 'rsa-pss'],
        android: ['ec', 'rsa', 'rsa-pss'],
        web: ['ec', 'rsa', 'rsa-pss'],
        desktop: ['ec', 'rsa', 'rsa-pss']
    };

    const recommended = recommendedKeysPerPlatform[platform.toLowerCase()] || [];

    if (recommended.length > 0 && !recommended.includes(keyType)) {
        return {
            valid: false,
            reason: `${platform} devices should use ${recommended.join(' or ')} keys, got ${keyType}`
        };
    }

    // Validate key size (minimum requirements)
    const keySizeBits = getKeySizeInBits(validatedKey);
    const minSizes: Record<string, number> = {
        'rsa': 2048,
        'rsa-pss': 2048,
        'ec': 256,
        'ed25519': 256,
        'ed448': 456,
        'x25519': 256,
        'x448': 448
    };

    const minSize = minSizes[keyType] || 256;
    if (keySizeBits < minSize) {
        return {
            valid: false,
            reason: `Key size ${keySizeBits} bits is too small for ${keyType}. Minimum: ${minSize} bits`
        };
    }

    return { valid: true };
}

/**
 * Checks if a string is valid base64
 */
function isValidBase64(str: string): boolean {
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
        return false;
    }
}

/**
 * Get human-readable key information
 */
export function getPublicKeyInfo(validatedKey: ValidatedPublicKey): {
    type: string;
    size: number; // in bits
    sizeBits: string;
    curve?: string; // for EC keys
    details: string;
} {
    const keyType = validatedKey.type;
    const keySizeBits = getKeySizeInBits(validatedKey);

    let curve = undefined;
    let details = `${keyType.toUpperCase()} - ${keySizeBits} bits`;

    if (keyType === 'ec') {
        curve = validatedKey.asymmetricKeyDetails?.namedCurve;
        details = `EC (${curve}) - ${keySizeBits} bits`;
    } else if (keyType.includes('rsa')) {
        details = `${keyType.toUpperCase()} - ${keySizeBits} bits`;
    } else if (keyType.includes('ed')) {
        details = `${keyType.toUpperCase()} - ${keySizeBits} bits`;
    }

    return {
        type: keyType,
        size: keySizeBits,
        sizeBits: `${keySizeBits} bits`,
        curve,
        details
    };
}
