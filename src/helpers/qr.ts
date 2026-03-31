import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { QR_TTL_SECONDS } from './constants.js';

export function parseQrPayload(rawQr: string): { sessionId: string; exp: number; sig: string } | null {
    try {
        const parsed = JSON.parse(rawQr);
        if (parsed && parsed.sessionId && parsed.exp && parsed.sig) {
            return {
                sessionId: String(parsed.sessionId),
                exp: Number(parsed.exp),
                sig: String(parsed.sig)
            };
        }
    } catch {
        // Continue to URL format parsing
    }

    try {
        const url = new URL(rawQr);
        const sessionId = url.searchParams.get('sessionId');
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');
        if (!sessionId || !exp || !sig) {
            return null;
        }
        return { sessionId, exp: Number(exp), sig };
    } catch {
        return null;
    }
}

export function signQrPayload(sessionId: string, exp: number, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${sessionId}.${exp}`)
        .digest('hex');
}

export function secureEqualsHex(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a, 'hex');
        const right = Buffer.from(b, 'hex');
        if (left.length !== right.length || left.length === 0) {
            return false;
        }
        return timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

export function buildQrPayload(sessionId: string, secret: string, expiresAt: Date): string {
    const baseUrl = process.env.FRONTEND_URL!;
    const exp = expiresAt.getTime();
    const sig = signQrPayload(sessionId, exp, secret);
    return `${baseUrl}/checkin?sessionId=${sessionId}&exp=${exp}&sig=${sig}`;
}

export function generateQrSecretAndExpiry() {
    const qrSecret = randomBytes(24).toString('hex');
    const qrCodeExpiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);

    return {
        qrSecret,
        qrCodeExpiresAt
    }
}