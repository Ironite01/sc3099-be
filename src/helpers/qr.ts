import { createHmac, timingSafeEqual } from 'crypto';

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