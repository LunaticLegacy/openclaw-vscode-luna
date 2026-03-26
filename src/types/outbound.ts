import type { SwarmDeliveryContext } from './openclaw';

export type OutboundDeliveryStatus =
    | 'pending'
    | 'sending'
    | 'sent'
    | 'retrying'
    | 'failed'
    | 'dead-letter'
    | 'cancelled'
    | 'expired';

export type FailureClass = 'transient' | 'permanent' | 'unknown';

export type OutboundDeliveryEventType =
    | 'delivery_enqueued'
    | 'delivery_sending'
    | 'delivery_succeeded'
    | 'delivery_retry_scheduled'
    | 'delivery_failed'
    | 'delivery_dead_letter'
    | 'delivery_expired'
    | 'delivery_cancelled'
    | 'dependency_unavailable'
    | 'group_updated';

export interface OutboundQueueEntry<T = unknown> {
    id: string;
    laneKey: string;
    sessionKey?: string;
    payloadSummary?: string;
    payload?: unknown;
    idempotencyKey: string;
    createdAt: string;
    updatedAt: string;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt?: string;
    lastAttemptAt?: string;
    status: OutboundDeliveryStatus;
    lastError?: string;
    failureClass?: FailureClass;
    expiresAt?: string;
    timeoutMs?: number;
    swarm?: SwarmDeliveryContext;
    requiresDeliveryForProgress?: boolean;
    transactionGroupId?: string;
    expectedGroupSize?: number;
    groupCompletionPolicy?: 'all' | 'any';
    response?: T;
}

export interface OutboundDeliveryEvent<T = unknown> {
    type: OutboundDeliveryEventType;
    timestamp: string;
    entry: OutboundQueueEntry<T>;
    error?: string;
    failureClass?: FailureClass;
    nextAttemptAt?: string;
    group?: OutboundDeliveryGroup;
}

export interface OutboundDeliveryGroup {
    id: string;
    entryIds: string[];
    delivered: number;
    failed: number;
    pending: number;
    status: 'pending' | 'partial' | 'delivered' | 'failed';
    expectedCount?: number;
    completionPolicy?: 'all' | 'any';
}

export interface OutboundSendRequest<T = unknown> {
    laneKey: string;
    sessionKey?: string;
    payloadSummary?: string;
    payload?: unknown;
    idempotencyKey?: string;
    timeoutMs?: number;
    ttlMs?: number;
    maxAttempts?: number;
    swarm?: SwarmDeliveryContext;
    requiresDeliveryForProgress?: boolean;
    transactionGroupId?: string;
    expectedGroupSize?: number;
    groupCompletionPolicy?: 'all' | 'any';
    dispatch: (context: OutboundDispatchContext) => Promise<T>;
}

export interface OutboundDispatchContext {
    idempotencyKey: string;
    abortController: AbortController;
}

export interface OutboundQueueFilter {
    swarmRunId?: string;
    clusterId?: string;
    round?: number;
    phase?: string;
    sourceAgentId?: string;
    targetAgentId?: string;
    status?: OutboundDeliveryStatus;
    transactionGroupId?: string;
}

export class OutboundDeliveryError extends Error {
    public readonly entryId: string;
    public readonly status: OutboundDeliveryStatus;
    public readonly failureClass?: FailureClass;

    constructor(message: string, entry: OutboundQueueEntry) {
        super(message);
        this.name = 'OutboundDeliveryError';
        this.entryId = entry.id;
        this.status = entry.status;
        this.failureClass = entry.failureClass;
    }
}
