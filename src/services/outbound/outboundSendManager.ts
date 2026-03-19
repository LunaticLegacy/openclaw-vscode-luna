import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

import { classifySendFailure } from './failureClassifier';
import { computeBackoffDelay, DEFAULT_RETRY_POLICY } from './retryPolicy';
import {
    OutboundDeliveryError,
    OutboundDeliveryEvent,
    OutboundDeliveryGroup,
    OutboundQueueEntry,
    OutboundQueueFilter,
    OutboundSendRequest
} from './types';

interface LaneState {
    active: boolean;
    queue: string[];
    timer?: NodeJS.Timeout;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

export class OutboundSendManager extends EventEmitter {
    private entries = new Map<string, OutboundQueueEntry>();
    private deferred = new Map<string, Deferred<unknown>>();
    private dispatchers = new Map<string, OutboundSendRequest<unknown>['dispatch']>();
    private lanes = new Map<string, LaneState>();
    private groups = new Map<string, OutboundDeliveryGroup>();
    private defaultMaxAttempts = DEFAULT_RETRY_POLICY.maxAttempts;

    public enqueue<T>(request: OutboundSendRequest<T>): Promise<T> {
        const id = randomUUID();
        const now = new Date().toISOString();
        const idempotencyKey = request.idempotencyKey || randomUUID();
        const maxAttempts = Math.max(1, request.maxAttempts ?? this.defaultMaxAttempts);
        const timeoutMs = request.timeoutMs;
        const expiresAt = request.ttlMs
            ? new Date(Date.now() + request.ttlMs).toISOString()
            : timeoutMs
                ? new Date(Date.now() + timeoutMs).toISOString()
                : undefined;

        const entry: OutboundQueueEntry<T> = {
            id,
            laneKey: request.laneKey,
            sessionKey: request.sessionKey,
            payloadSummary: request.payloadSummary,
            payload: request.payload,
            idempotencyKey,
            createdAt: now,
            updatedAt: now,
            attemptCount: 0,
            maxAttempts,
            status: 'pending',
            timeoutMs,
            expiresAt,
            swarm: request.swarm,
            requiresDeliveryForProgress: request.requiresDeliveryForProgress,
            transactionGroupId: request.transactionGroupId,
            expectedGroupSize: request.expectedGroupSize,
            groupCompletionPolicy: request.groupCompletionPolicy
        };

        this.entries.set(id, entry as OutboundQueueEntry);
        this.dispatchers.set(id, request.dispatch as OutboundSendRequest<unknown>['dispatch']);
        this.attachGroup(entry);

        const deferred = createDeferred<T>();
        this.deferred.set(id, deferred as Deferred<unknown>);

        this.enqueueLane(entry.laneKey, id);
        this.emitDeliveryEvent('delivery_enqueued', entry);
        this.pumpLane(entry.laneKey);

        return deferred.promise;
    }

    public getEntry(id: string): OutboundQueueEntry | null {
        return this.entries.get(id) || null;
    }

    public listEntries(filter: OutboundQueueFilter = {}): OutboundQueueEntry[] {
        const entries = Array.from(this.entries.values());
        return entries.filter(entry => {
            if (filter.status && entry.status !== filter.status) return false;
            if (filter.transactionGroupId && entry.transactionGroupId !== filter.transactionGroupId) return false;
            const swarm = entry.swarm;
            if (!swarm) {
                return !(filter.swarmRunId || filter.clusterId || filter.round || filter.phase || filter.sourceAgentId || filter.targetAgentId);
            }
            if (filter.swarmRunId && swarm.swarmRunId !== filter.swarmRunId) return false;
            if (filter.clusterId && swarm.clusterId !== filter.clusterId) return false;
            if (filter.round !== undefined && swarm.round !== filter.round) return false;
            if (filter.phase && swarm.phase !== filter.phase) return false;
            if (filter.sourceAgentId && swarm.sourceAgentId !== filter.sourceAgentId) return false;
            if (filter.targetAgentId && swarm.targetAgentId !== filter.targetAgentId) return false;
            return true;
        });
    }

    public cancelEntry(id: string, reason: string = 'Cancelled'): boolean {
        const entry = this.entries.get(id);
        if (!entry || isTerminalStatus(entry.status)) {
            return false;
        }
        entry.status = 'cancelled';
        entry.updatedAt = new Date().toISOString();
        entry.lastError = reason;
        this.emitDeliveryEvent('delivery_cancelled', entry, { error: reason });
        this.finalizeEntry(entry, new OutboundDeliveryError(reason, entry));
        return true;
    }

    public cancelBySession(sessionKey: string, reason: string = 'Cancelled'): number {
        let count = 0;
        for (const entry of this.entries.values()) {
            if (entry.sessionKey === sessionKey && !isTerminalStatus(entry.status)) {
                this.cancelEntry(entry.id, reason);
                count += 1;
            }
        }
        return count;
    }

    public cancelBySwarmRun(swarmRunId: string, reason: string = 'Cancelled'): number {
        let count = 0;
        for (const entry of this.entries.values()) {
            if (entry.swarm?.swarmRunId === swarmRunId && !isTerminalStatus(entry.status)) {
                this.cancelEntry(entry.id, reason);
                count += 1;
            }
        }
        return count;
    }

    private enqueueLane(laneKey: string, entryId: string) {
        const lane = this.lanes.get(laneKey) || { active: false, queue: [] };
        lane.queue.push(entryId);
        this.lanes.set(laneKey, lane);
    }

    private pumpLane(laneKey: string): void {
        const lane = this.lanes.get(laneKey);
        if (!lane || lane.active) {
            return;
        }

        const now = Date.now();
        while (lane.queue.length > 0) {
            const entryId = lane.queue[0];
            const entry = this.entries.get(entryId);
            if (!entry) {
                lane.queue.shift();
                continue;
            }

            if (isTerminalStatus(entry.status)) {
                lane.queue.shift();
                continue;
            }

            if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) {
                entry.status = 'expired';
                entry.updatedAt = new Date().toISOString();
                entry.lastError = 'Expired';
                this.emitDeliveryEvent('delivery_expired', entry, { error: 'Expired' });
                this.emitDependencyUnavailable(entry);
                this.finalizeEntry(entry, new OutboundDeliveryError('Delivery expired', entry));
                lane.queue.shift();
                continue;
            }

            if (entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > now) {
                this.scheduleLane(laneKey, Date.parse(entry.nextAttemptAt) - now);
                return;
            }

            lane.active = true;
            const dispatcher = this.dispatchers.get(entryId);
            if (!dispatcher) {
                entry.status = 'failed';
                entry.updatedAt = new Date().toISOString();
                entry.lastError = 'Missing dispatcher';
                this.emitDeliveryEvent('delivery_failed', entry, { error: entry.lastError });
                this.emitDependencyUnavailable(entry);
                this.finalizeEntry(entry, new OutboundDeliveryError(entry.lastError, entry));
                lane.queue.shift();
                lane.active = false;
                continue;
            }
            void this.dispatchEntry(entry as OutboundQueueEntry<unknown>, dispatcher, laneKey);
            return;
        }
    }

    private scheduleLane(laneKey: string, delayMs: number) {
        const lane = this.lanes.get(laneKey);
        if (!lane) {
            return;
        }
        if (lane.timer) {
            return;
        }
        lane.timer = setTimeout(() => {
            lane.timer = undefined;
            this.pumpLane(laneKey);
        }, Math.max(0, delayMs));
    }

    private async dispatchEntry<T>(entry: OutboundQueueEntry<T>, dispatch: OutboundSendRequest<T>['dispatch'], laneKey: string): Promise<void> {
        const lane = this.lanes.get(laneKey);
        if (!lane) {
            return;
        }

        entry.attemptCount += 1;
        entry.lastAttemptAt = new Date().toISOString();
        entry.updatedAt = entry.lastAttemptAt;
        entry.status = 'sending';
        this.emitDeliveryEvent('delivery_sending', entry);

        const abortController = new AbortController();
        const timeoutMs = entry.timeoutMs;
        let timeoutHandle: NodeJS.Timeout | undefined;
        if (timeoutMs && timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                abortController.abort();
            }, timeoutMs);
        }

        try {
            const response = await dispatch({ idempotencyKey: entry.idempotencyKey, abortController });
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }

            entry.status = 'sent';
            entry.updatedAt = new Date().toISOString();
            entry.response = response;
            entry.lastError = undefined;
            entry.failureClass = undefined;
            this.emitDeliveryEvent('delivery_succeeded', entry);
            this.finalizeEntry(entry, null, response);
            lane.queue.shift();
        } catch (error) {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }

            const classification = classifySendFailure(error);
            entry.failureClass = classification.failureClass;
            entry.lastError = error instanceof Error ? error.message : String(error);

            const remainingAttempts = entry.maxAttempts - entry.attemptCount;
            const canRetry = remainingAttempts > 0 && classification.retryable;

            if (canRetry) {
                const delay = computeBackoffDelay(entry.attemptCount, DEFAULT_RETRY_POLICY);
                entry.status = 'retrying';
                entry.nextAttemptAt = new Date(Date.now() + delay).toISOString();
                entry.updatedAt = new Date().toISOString();
                this.emitDeliveryEvent('delivery_retry_scheduled', entry, {
                    error: entry.lastError,
                    failureClass: entry.failureClass,
                    nextAttemptAt: entry.nextAttemptAt
                });
            } else {
                entry.status = remainingAttempts <= 0 ? 'dead-letter' : 'failed';
                entry.updatedAt = new Date().toISOString();
                entry.nextAttemptAt = undefined;
                const eventType = entry.status === 'dead-letter' ? 'delivery_dead_letter' : 'delivery_failed';
                this.emitDeliveryEvent(eventType, entry, {
                    error: entry.lastError,
                    failureClass: entry.failureClass
                });
                this.emitDependencyUnavailable(entry);
                this.finalizeEntry(entry, new OutboundDeliveryError(entry.lastError || 'Delivery failed', entry));
                lane.queue.shift();
            }
        } finally {
            lane.active = false;
            if (lane.queue.length === 0) {
                return;
            }
            this.pumpLane(laneKey);
        }
    }

    private emitDeliveryEvent(type: OutboundDeliveryEvent['type'], entry: OutboundQueueEntry, extra: Partial<OutboundDeliveryEvent> = {}) {
        const event: OutboundDeliveryEvent = {
            type,
            timestamp: new Date().toISOString(),
            entry: { ...entry },
            ...extra
        };
        this.emit('deliveryEvent', event);
        if (entry.transactionGroupId) {
            this.emitGroupUpdate(entry.transactionGroupId);
        }
    }

    private emitDependencyUnavailable(entry: OutboundQueueEntry) {
        if (!entry.requiresDeliveryForProgress) {
            return;
        }
        this.emitDeliveryEvent('dependency_unavailable', entry, {
            error: entry.lastError,
            failureClass: entry.failureClass
        });
    }

    private attachGroup(entry: OutboundQueueEntry) {
        if (!entry.transactionGroupId) {
            return;
        }
        const groupId = entry.transactionGroupId;
        const existing = this.groups.get(groupId);
        if (existing) {
            if (!existing.entryIds.includes(entry.id)) {
                existing.entryIds.push(entry.id);
            }
            if (entry.expectedGroupSize && !existing.expectedCount) {
                existing.expectedCount = entry.expectedGroupSize;
            }
            if (entry.groupCompletionPolicy && !existing.completionPolicy) {
                existing.completionPolicy = entry.groupCompletionPolicy;
            }
            return;
        }

        this.groups.set(groupId, {
            id: groupId,
            entryIds: [entry.id],
            delivered: 0,
            failed: 0,
            pending: 1,
            status: 'pending',
            expectedCount: entry.expectedGroupSize,
            completionPolicy: entry.groupCompletionPolicy
        });
    }

    private emitGroupUpdate(groupId: string) {
        const group = this.groups.get(groupId);
        if (!group) {
            return;
        }
        const entries = group.entryIds.map(id => this.entries.get(id)).filter(Boolean) as OutboundQueueEntry[];
        group.delivered = entries.filter(entry => entry.status === 'sent').length;
        group.failed = entries.filter(entry => entry.status === 'failed' || entry.status === 'dead-letter' || entry.status === 'expired').length;
        group.pending = entries.filter(entry => !isTerminalStatus(entry.status)).length;

        const policy = group.completionPolicy || 'all';
        if (policy === 'any' && group.delivered > 0) {
            group.status = 'delivered';
        } else if (group.pending === 0 && group.failed > 0 && group.delivered === 0) {
            group.status = 'failed';
        } else if (group.pending === 0 && group.failed === 0) {
            group.status = 'delivered';
        } else if (group.delivered > 0) {
            group.status = 'partial';
        } else {
            group.status = 'pending';
        }

        this.emit('deliveryEvent', {
            type: 'group_updated',
            timestamp: new Date().toISOString(),
            entry: entries[0] ? { ...entries[0] } : createGroupPlaceholder(group),
            group: { ...group }
        } satisfies OutboundDeliveryEvent);
    }

    private finalizeEntry<T>(entry: OutboundQueueEntry<T>, error: OutboundDeliveryError | null, response?: T) {
        const deferred = this.deferred.get(entry.id);
        if (!deferred) {
            return;
        }
        this.deferred.delete(entry.id);
        this.dispatchers.delete(entry.id);
        if (error) {
            deferred.reject(error);
            return;
        }
        deferred.resolve(response as T);
    }
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, resolve, reject };
}

function isTerminalStatus(status: string): boolean {
    return status === 'sent' || status === 'failed' || status === 'dead-letter' || status === 'cancelled' || status === 'expired';
}

function createGroupPlaceholder(group: OutboundDeliveryGroup): OutboundQueueEntry {
    return {
        id: group.id,
        laneKey: group.id,
        idempotencyKey: group.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attemptCount: 0,
        maxAttempts: 0,
        status: 'pending'
    };
}
