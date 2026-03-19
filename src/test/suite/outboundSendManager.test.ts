import * as assert from 'assert/strict';
import { OutboundDeliveryError, OutboundSendManager } from '../../services/outbound';

suite('outboundSendManager', () => {
    test('cancelBySwarmRun cancels pending deliveries that belong to the same swarm run', async () => {
        const manager = new OutboundSendManager();
        const gate = createDeferred<void>();

        const first = manager.enqueue({
            laneKey: 'lane-1',
            swarm: {
                swarmRunId: 'other-run',
                clusterId: 'cluster-1',
                mode: 'collaborate'
            },
            dispatch: async () => {
                await gate.promise;
                return 'first';
            }
        });
        const second = manager.enqueue({
            laneKey: 'lane-1',
            swarm: {
                swarmRunId: 'run-1',
                clusterId: 'cluster-1',
                mode: 'collaborate'
            },
            dispatch: async () => 'second'
        });

        await waitFor(() => {
            const targetEntries = manager.listEntries({ swarmRunId: 'run-1' });
            const blockerEntries = manager.listEntries({ swarmRunId: 'other-run' });
            return blockerEntries.some(entry => entry.status === 'sending') && targetEntries.some(entry => entry.status === 'pending');
        });

        const cancelled = manager.cancelBySwarmRun('run-1', 'Stopped by test');
        gate.resolve();

        await first;
        await assert.rejects(second, isCancelledDeliveryError);
        assert.equal(cancelled, 1);
        assert.equal(manager.listEntries({ swarmRunId: 'run-1' })[0]?.status, 'cancelled');
    });

    test('cancelBySwarmRun cancels retrying deliveries that belong to the same swarm run', async () => {
        const manager = new OutboundSendManager();

        const promise = manager.enqueue({
            laneKey: 'lane-2',
            maxAttempts: 3,
            swarm: {
                swarmRunId: 'run-2',
                clusterId: 'cluster-1',
                mode: 'collaborate'
            },
            dispatch: async () => {
                throw new Error('connection interrupted');
            }
        });

        await waitFor(() => manager.listEntries({ swarmRunId: 'run-2' }).some(entry => entry.status === 'retrying'));

        const cancelled = manager.cancelBySwarmRun('run-2', 'Stopped by test');

        await assert.rejects(promise, isCancelledDeliveryError);
        assert.equal(cancelled, 1);
        assert.equal(manager.listEntries({ swarmRunId: 'run-2' })[0]?.status, 'cancelled');
    });
});

function isCancelledDeliveryError(error: unknown): boolean {
    return error instanceof OutboundDeliveryError && error.status === 'cancelled';
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
