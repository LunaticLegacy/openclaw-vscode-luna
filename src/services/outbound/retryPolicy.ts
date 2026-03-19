export interface RetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 3,
    baseDelayMs: 1200,
    maxDelayMs: 15000,
    jitterRatio: 0.25
};

export function computeBackoffDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
    const exponent = Math.max(attempt - 1, 0);
    const raw = Math.min(policy.baseDelayMs * Math.pow(2, exponent), policy.maxDelayMs);
    const jitter = raw * policy.jitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(raw + jitter));
}
