import type { FailureClass } from './types';

const TRANSIENT_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETUNREACH',
    'ETIMEDOUT',
    'EAI_AGAIN'
]);

export function classifySendFailure(error: unknown): { failureClass: FailureClass; retryable: boolean; reason: string } {
    if (!error) {
        return { failureClass: 'unknown', retryable: true, reason: 'Unknown error' };
    }

    const anyError = error as {
        status?: number;
        code?: string;
        message?: string;
    };

    if (anyError.code && TRANSIENT_CODES.has(anyError.code)) {
        return { failureClass: 'transient', retryable: true, reason: anyError.code };
    }

    const status = typeof anyError.status === 'number' ? anyError.status : undefined;
    if (status) {
        if (status === 408 || status === 409 || status === 429 || status >= 500) {
            return { failureClass: 'transient', retryable: true, reason: `HTTP ${status}` };
        }
        if (status >= 400 && status < 500) {
            return { failureClass: 'permanent', retryable: false, reason: `HTTP ${status}` };
        }
    }

    const message = String(anyError.message || '').toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) {
        return { failureClass: 'transient', retryable: true, reason: 'timeout' };
    }
    if (message.includes('connect') || message.includes('connection') || message.includes('socket')) {
        return { failureClass: 'transient', retryable: true, reason: 'connection' };
    }
    if (message.includes('unauthorized') || message.includes('forbidden')) {
        return { failureClass: 'permanent', retryable: false, reason: 'auth' };
    }
    if (message.includes('missing scope')) {
        return { failureClass: 'permanent', retryable: false, reason: 'auth-scope' };
    }
    if (message.includes('not found') || message.includes('invalid')) {
        return { failureClass: 'permanent', retryable: false, reason: 'invalid' };
    }

    return { failureClass: 'unknown', retryable: true, reason: 'unknown' };
}
