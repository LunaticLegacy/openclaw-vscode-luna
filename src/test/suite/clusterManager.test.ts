import * as assert from 'assert/strict';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClusterManager } from '../../managers/clusterManager';
import type { OpenClawService } from '../../services/openclawService';
import type { Agent, ChatMessage, ChatSession } from '../../services/openclawService';
import type { CollaborationFailure, DebateStage, FakeCollaborationServiceOptions, SentMessageEntry } from '../../types/test';

suite('clusterManager', () => {
    test('runs collaborate mode as a multi-round debate with peer review', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Review Swarm',
                agentIds: ['alpha', 'beta']
            });
            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Design a safe service boundary.' });

            assert.deepEqual(
                result.rounds.map((round: any) => round.kind),
                ['opening', 'critique-1', 'revision-1', 'critique-2', 'revision-2']
            );
            assert.deepEqual(
                result.rounds.map((round: any) => round.descriptor.fallbackLabel),
                [
                    'Opening Positions',
                    'Review Round 1: Critique',
                    'Review Round 1: Revision',
                    'Review Round 2: Critique',
                    'Review Round 2: Revision'
                ]
            );
            assert.equal(result.coordinatorAgentId, 'alpha');
            assert.match(result.contributions.alpha.message?.content || '', /revision-2/i);
            assert.match(result.contributions.beta.message?.content || '', /revision-2/i);
            assert.match(result.synthesis?.message?.content || '', /final synthesis by alpha/i);

            const alphaDebateSessions = new Set(
                service.sentMessages
                    .filter((entry: any) => entry.agentId === 'alpha' && entry.stage !== 'synthesis')
                    .map((entry: any) => entry.sessionId)
            );
            const betaDebateSessions = new Set(
                service.sentMessages
                    .filter((entry: any) => entry.agentId === 'beta' && entry.stage !== 'synthesis')
                    .map((entry: any) => entry.sessionId)
            );

            assert.equal(alphaDebateSessions.size, 1, 'alpha should reuse one debate session across rounds');
            assert.equal(betaDebateSessions.size, 1, 'beta should reuse one debate session across rounds');

            const alphaCritiqueRoundOnePrompt = service.findPrompt('alpha', 'critique-1');
            const alphaRevisionRoundTwoPrompt = service.findPrompt('alpha', 'revision-2');
            const synthesisPrompt = service.findPrompt('alpha', 'synthesis');

            assert.match(alphaCritiqueRoundOnePrompt, /Opening from beta/i);
            assert.match(alphaRevisionRoundTwoPrompt, /Critique 2 from beta/i);
            assert.match(synthesisPrompt, /Final revision 2 from beta/i);
            assert.match(synthesisPrompt, /Peer review round 2/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('keeps the latest successful position when a later debate round fails', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-fallback-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService([{
            agentId: 'beta',
            stage: 'revision-2'
        }]);
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Fallback Swarm',
                agentIds: ['alpha', 'beta']
            });
            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Plan a staged migration.' });
            const finalRevisionRound = result.rounds.find((round: any) => round.kind === 'revision-2');

            assert.ok(finalRevisionRound, 'expected the second revision round to run');
            assert.equal(finalRevisionRound?.entries.beta.ok, false);
            assert.equal(result.contributions.beta.ok, true);
            assert.match(result.contributions.beta.message?.content || '', /revision-1/i);
            assert.match(service.findPrompt('alpha', 'synthesis'), /Revision 1 from beta/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('persists cluster workspace config with the cluster definition', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-config-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Config Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'red-team-audit',
                    collaborationStyle: 'review-board',
                    deliveryStyle: 'deep',
                    critiqueLevel: 'aggressive',
                    rounds: 3,
                    briefing: 'Stress test the design before release.'
                }
            });

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                const reloadedCluster = await reloadedManager.getCluster(cluster.id);
                assert.ok(reloadedCluster, 'expected persisted cluster to reload');
                assert.equal(reloadedCluster?.workspaceConfig?.presetId, 'red-team-audit');
                assert.equal(reloadedCluster?.workspaceConfig?.collaborationStyle, 'review-board');
                assert.equal(reloadedCluster?.workspaceConfig?.deliveryStyle, 'deep');
                assert.equal(reloadedCluster?.workspaceConfig?.critiqueLevel, 'aggressive');
                assert.equal(reloadedCluster?.workspaceConfig?.rounds, 3);
                assert.equal(reloadedCluster?.workspaceConfig?.runUntilConditionMet, false);
                assert.equal(reloadedCluster?.workspaceConfig?.briefing, 'Stress test the design before release.');
                assert.equal(reloadedCluster?.workspaceConfig?.coordinatorAgentId, undefined);
            } finally {
                reloadedManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('keeps collaborating in unlimited mode until the stop condition is met', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-unlimited-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService([], {
            stopAfterReviewRound: 3
        });
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Unlimited Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 2,
                    runUntilConditionMet: true,
                    stopCondition: 'Stop when the swarm has converged on one implementation-ready answer.'
                }
            });
            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Plan the rollout.' });

            assert.deepEqual(
                result.rounds.map((round: any) => round.kind),
                ['opening', 'critique-1', 'revision-1', 'critique-2', 'revision-2', 'critique-3', 'revision-3']
            );
            assert.deepEqual(
                result.rounds.map((round: any) => round.descriptor.displayOrder),
                [1, 2, 3, 4, 5, 6, 7]
            );
            assert.equal(service.sentMessages.filter((entry: any) => entry.stage === 'stop-check-1').length, 1);
            assert.equal(service.sentMessages.filter((entry: any) => entry.stage === 'stop-check-2').length, 1);
            assert.equal(service.sentMessages.filter((entry: any) => entry.stage === 'stop-check-3').length, 1);
            assert.equal(service.sentMessages.some((entry: any) => entry.stage === 'critique-4'), false);
            assert.match(result.synthesis?.message?.content || '', /final synthesis by alpha/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('stops an unlimited collaborate run after STOP cancels the swarm run', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-cancel-unlimited-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService([], {
            stopAfterReviewRound: 5
        });
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Cancellable Unlimited Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 2,
                    runUntilConditionMet: true,
                    stopCondition: 'Stop when a single implementation-ready answer is stable.'
                }
            });
            let cancelled = false;
            service.onMessageSent = async (entry: any) => {
                if (!cancelled && entry.stage === 'revision-1') {
                    cancelled = true;
                    await manager.abortClusterSwarmRun({ clusterId: cluster.id, mode: 'collaborate' });
                }
            };

            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Plan the rollout.' });
            const runState = (manager as any).swarmRunStates.get(result.swarmRunId);

            assert.deepEqual(result.rounds.map((round: any) => round.kind), ['opening', 'critique-1', 'revision-1']);
            assert.equal(service.sentMessages.some((entry: any) => entry.stage === 'critique-2'), false);
            assert.equal(service.sentMessages.some((entry: any) => entry.stage === 'stop-check-1'), false);
            assert.equal(service.sentMessages.some((entry: any) => entry.stage === 'synthesis'), false);
            assert.equal(service.cancelledSwarmRuns.length, 1);
            assert.equal(runState?.status, 'stopped');
            assert.equal(runState?.cancellationRequested, true);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('prefers the last non-empty assistant message when trace ends with an empty placeholder', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-final-trace-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService([], {
            appendTrailingEmptyAssistant: true
        });
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Trace Swarm',
                agentIds: ['alpha', 'beta']
            });
            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Synthesize a release recommendation.' });

            assert.match(result.contributions.alpha.message?.content || '', /revision-2/i);
            assert.match(result.contributions.beta.message?.content || '', /revision-2/i);
            assert.match(result.synthesis?.message?.content || '', /final synthesis by alpha/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('persists and rotates cluster-agent session ids independently', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-session-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Session Swarm',
                agentIds: ['alpha', 'beta']
            });

            const alphaSessionId = await manager.ensureClusterAgentSessionId({ clusterId: cluster.id, agentId: 'alpha' });
            const sameAlphaSessionId = await manager.ensureClusterAgentSessionId({ clusterId: cluster.id, agentId: 'alpha' });
            const resetAlphaSessionId = await manager.resetClusterAgentSessionId({ clusterId: cluster.id, agentId: 'alpha' });

            assert.equal(alphaSessionId, sameAlphaSessionId);
            assert.notEqual(alphaSessionId, resetAlphaSessionId);

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                const persistedAlphaSessionId = await reloadedManager.ensureClusterAgentSessionId({ clusterId: cluster.id, agentId: 'alpha' });
                assert.equal(persistedAlphaSessionId, resetAlphaSessionId);
            } finally {
                reloadedManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('persists cluster-agent chat history and clears it independently', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-history-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        const messages: ChatMessage[] = [
            {
                id: 'msg-1',
                role: 'user',
                content: 'hello swarm',
                timestamp: '2026-03-12T00:00:00.000Z',
                agentId: 'alpha'
            },
            {
                id: 'msg-2',
                role: 'assistant',
                content: 'hello back',
                timestamp: '2026-03-12T00:00:01.000Z',
                agentId: 'alpha'
            }
        ];

        try {
            const cluster = await manager.createCluster({
                name: 'History Swarm',
                agentIds: ['alpha', 'beta']
            });

            await manager.replaceClusterAgentMessages({ clusterId: cluster.id, agentId: 'alpha', messages: messages });
            assert.deepEqual(
                (await manager.getClusterAgentMessages({ clusterId: cluster.id, agentId: 'alpha' })).map(toComparableMessage),
                messages.map(toComparableMessage)
            );

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                assert.deepEqual(
                    (await reloadedManager.getClusterAgentMessages({ clusterId: cluster.id, agentId: 'alpha' })).map(toComparableMessage),
                    messages.map(toComparableMessage)
                );
                await reloadedManager.clearClusterAgentMessages({ clusterId: cluster.id, agentId: 'alpha' });
                assert.deepEqual(await reloadedManager.getClusterAgentMessages({ clusterId: cluster.id, agentId: 'alpha' }), []);
            } finally {
                reloadedManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('persists swarm session ids and swarm chat history for reload', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-swarm-history-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        const swarmMessages: ChatMessage[] = [
            {
                id: 'swarm-user-1',
                role: 'user',
                content: 'coordinate a release',
                timestamp: '2026-03-12T00:00:00.000Z',
                contextLabel: 'Collaborate'
            },
            {
                id: 'swarm-assistant-1',
                role: 'assistant',
                content: 'release plan',
                timestamp: '2026-03-12T00:00:01.000Z',
                displayName: 'ALPHA (fake-model)',
                contextLabel: 'Opening positions'
            }
        ];

        try {
            const cluster = await manager.createCluster({
                name: 'Persistent Swarm',
                agentIds: ['alpha', 'beta']
            });

            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Coordinate a release.' });
            await manager.replaceClusterSwarmMessages({ clusterId: cluster.id, mode: 'collaborate', messages: swarmMessages, swarmRunId: result.swarmRunId });

            const persistedFile = JSON.parse(await fs.readFile(storagePath, 'utf8')) as {
                swarmSessions?: Record<string, string>;
            };
            assert.ok(
                Object.keys(persistedFile.swarmSessions || {}).some((key: any) => key.includes(`${cluster.id}:swarm:collaborate:run:${result.swarmRunId}:agent:alpha`)),
                'expected persisted swarm session ids to include the collaborate lane'
            );

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                assert.deepEqual(
                    (await reloadedManager.getClusterSwarmMessages({ clusterId: cluster.id, mode: 'collaborate' })).map(toComparableMessage),
                    swarmMessages.map(toComparableMessage)
                );
            } finally {
                reloadedManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('reads internal swarm logs for a specific cluster agent', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-agent-swarm-log-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Inspectable Swarm',
                agentIds: ['alpha', 'beta']
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Inspect the internal debate.' });

            const alphaMessages = await manager.getClusterAgentSwarmMessages({ clusterId: cluster.id, agentId: 'alpha', mode: 'collaborate' });
            assert.ok(alphaMessages.some((message: any) => message.role === 'user'));
            assert.ok(alphaMessages.some((message: any) => /alpha/i.test(message.content)));
            assert.ok(alphaMessages.some((message: any) => /beta/i.test(message.content)));
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('persists cluster-agent swarm logs independently from mutable swarm sessions', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-agent-swarm-persist-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Persistent Agent Swarm Log',
                agentIds: ['alpha', 'beta']
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Inspect the internal debate.' });

            const persistedFile = JSON.parse(await fs.readFile(storagePath, 'utf8')) as {
                clusterAgentSwarmMessages?: Record<string, ChatMessage[]>;
            };
            assert.ok(
                Object.keys(persistedFile.clusterAgentSwarmMessages || {}).some((key: any) => key.includes(`${cluster.id}::agent::alpha::collaborate`)),
                'expected persisted cluster-agent swarm logs to include alpha collaborate messages'
            );

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                const alphaMessages = await reloadedManager.getClusterAgentSwarmMessages({ clusterId: cluster.id, agentId: 'alpha', mode: 'collaborate' });
                assert.ok(alphaMessages.some((message: any) => message.role === 'user'));
                assert.ok(alphaMessages.some((message: any) => /beta/i.test(message.content)));
            } finally {
                reloadedManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('uses the configured coordinator and injects member profiles into prompts', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-member-profiles-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Profiled Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    briefing: 'Keep positions distinct.',
                    coordinatorAgentId: 'beta',
                    memberProfiles: {
                        alpha: {
                            identity: 'Skeptical architect',
                            stance: 'Push for explicit tradeoffs and long-term maintainability.'
                        },
                        beta: {
                            identity: 'Delivery lead',
                            stance: 'Bias toward shippable synthesis and practical sequencing.'
                        }
                    }
                }
            });

            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Design the swarm policy.' });

            assert.equal(result.coordinatorAgentId, 'beta');
            assert.equal(service.findPrompt('alpha', 'opening').includes('Assigned identity: Skeptical architect'), true);
            assert.equal(service.findPrompt('alpha', 'opening').includes('Assigned stance: Push for explicit tradeoffs and long-term maintainability.'), true);
            assert.equal(service.findPrompt('beta', 'synthesis').includes('Assigned identity: Delivery lead'), true);
            assert.equal(service.findPrompt('beta', 'synthesis').includes('Assigned stance: Bias toward shippable synthesis and practical sequencing.'), true);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('applies member wake rules before swarm debate and still allows a separate coordinator', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-wake-rules-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Conditional Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'leader-draft',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    briefing: 'Wake only the right specialists.',
                    coordinatorAgentId: 'beta',
                    memberProfiles: {
                        alpha: {
                            identity: 'Risk analyst',
                            activation: {
                                swarmModes: ['collaborate'],
                                keywords: ['risk']
                            }
                        },
                        beta: {
                            identity: 'Synthesis lead',
                            activation: {
                                swarmModes: []
                            }
                        }
                    }
                }
            });

            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Review the release risk before rollout.' });

            assert.equal(result.coordinatorAgentId, 'beta');
            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => entry.agentId),
                ['alpha']
            );
            assert.equal(
                service.sentMessages.some((entry: any) => entry.agentId === 'beta' && entry.stage === 'opening'),
                false
            );
            assert.equal(
                service.sentMessages.some((entry: any) => entry.agentId === 'beta' && entry.stage === 'synthesis'),
                true
            );
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('delegates broadcast prompts through the configured parent-child chain', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-broadcast-topology-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Hierarchical Broadcast',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'leader-draft',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    memberProfiles: {
                        beta: {
                            parentAgentId: 'alpha',
                            activation: {
                                swarmModes: ['broadcast']
                            }
                        }
                    }
                }
            });

            const result = await manager.broadcastToCluster({ clusterId: cluster.id, message: 'Review deployment blast radius.' });

            assert.deepEqual(Object.keys(result), ['alpha', 'beta']);
            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'broadcast')
                    .map((entry: any) => entry.agentId),
                ['alpha', 'beta']
            );
            assert.equal(service.findPrompt('alpha', 'broadcast'), 'Review deployment blast radius.');
            assert.match(service.findPrompt('beta', 'broadcast'), /awakened by parent agent "alpha"/i);
            assert.match(service.findPrompt('beta', 'broadcast'), /Broadcast from alpha/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('does not wake broadcast children after the swarm run is cancelled', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-broadcast-cancel-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Cancelled Broadcast',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'leader-draft',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    memberProfiles: {
                        beta: {
                            parentAgentId: 'alpha',
                            activation: {
                                swarmModes: ['broadcast']
                            }
                        }
                    }
                }
            });
            let cancelled = false;
            service.onMessageSent = async (entry: any) => {
                if (!cancelled && entry.stage === 'broadcast' && entry.agentId === 'alpha') {
                    cancelled = true;
                    await manager.abortClusterSwarmRun({ clusterId: cluster.id, mode: 'broadcast' });
                }
            };

            const result = await manager.broadcastToCluster({ clusterId: cluster.id, message: 'Review deployment blast radius.' });

            assert.deepEqual(Object.keys(result), ['alpha']);
            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'broadcast')
                    .map((entry: any) => entry.agentId),
                ['alpha']
            );
            assert.equal(service.cancelledSwarmRuns.length, 1);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('only wakes descendants when their parent branch is covered', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-topology-coverage-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Hierarchical Collaborate',
                agentIds: ['alpha', 'beta', 'gamma'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    memberProfiles: {
                        alpha: {
                            activation: {
                                swarmModes: []
                            }
                        },
                        beta: {
                            parentAgentId: 'alpha',
                            activation: {
                                swarmModes: ['collaborate']
                            }
                        },
                        gamma: {
                            activation: {
                                swarmModes: ['collaborate']
                            }
                        }
                    }
                }
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Review the rollout risk.' });

            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => entry.agentId),
                ['gamma']
            );
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('passes parent context down nested collaborate branches', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-topology-context-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Nested Collaborate',
                agentIds: ['alpha', 'beta', 'gamma'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    memberProfiles: {
                        beta: {
                            parentAgentId: 'alpha',
                            activation: {
                                swarmModes: ['collaborate']
                            }
                        },
                        gamma: {
                            parentAgentId: 'beta',
                            activation: {
                                swarmModes: ['collaborate']
                            }
                        }
                    }
                }
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Design the release topology.' });

            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => entry.agentId),
                ['alpha', 'beta', 'gamma']
            );
            assert.match(service.findPrompt('beta', 'opening'), /Wake route: swarm -> alpha/i);
            assert.match(service.findPrompt('beta', 'opening'), /Opening from alpha/i);
            assert.match(service.findPrompt('gamma', 'opening'), /Wake route: swarm -> alpha -> beta/i);
            assert.match(service.findPrompt('gamma', 'opening'), /Opening from beta/i);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('does not wake collaborate children after the swarm run is cancelled', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-collaborate-cancel-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Cancelled Collaborate',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1,
                    memberProfiles: {
                        beta: {
                            parentAgentId: 'alpha',
                            activation: {
                                swarmModes: ['collaborate']
                            }
                        }
                    }
                }
            });
            let cancelled = false;
            service.onMessageSent = async (entry: any) => {
                if (!cancelled && entry.stage === 'opening' && entry.agentId === 'alpha') {
                    cancelled = true;
                    await manager.abortClusterSwarmRun({ clusterId: cluster.id, mode: 'collaborate' });
                }
            };

            const result = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Design the release topology.' });

            assert.deepEqual(result.rounds.map((round: any) => round.kind), ['opening']);
            assert.deepEqual(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => entry.agentId),
                ['alpha']
            );
            assert.equal(service.sentMessages.some((entry: any) => entry.stage === 'critique-1'), false);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('starts each swarm run with fresh swarm sessions', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-fresh-swarm-sessions-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Fresh Session Swarm',
                agentIds: ['alpha', 'beta']
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run one.' });
            const firstRunOpeningSessions = new Map(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => [entry.agentId, entry.sessionId] as const)
            );

            service.sentMessages.length = 0;

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run two.' });
            const secondRunOpeningSessions = new Map(
                service.sentMessages
                    .filter((entry: any) => entry.stage === 'opening')
                    .map((entry: any) => [entry.agentId, entry.sessionId] as const)
            );

            assert.notEqual(firstRunOpeningSessions.get('alpha'), secondRunOpeningSessions.get('alpha'));
            assert.notEqual(firstRunOpeningSessions.get('beta'), secondRunOpeningSessions.get('beta'));
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('starts each agent swarm log from a clean run transcript', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-fresh-agent-swarm-log-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Fresh Agent Swarm Log',
                agentIds: ['alpha', 'beta']
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run one.' });
            const firstRunMessages = await manager.getClusterAgentSwarmMessages({ clusterId: cluster.id, agentId: 'alpha', mode: 'collaborate' });
            assert.ok(firstRunMessages.some((message: any) => message.content.includes('Run one.')));

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run two.' });
            const secondRunMessages = await manager.getClusterAgentSwarmMessages({ clusterId: cluster.id, agentId: 'alpha', mode: 'collaborate' });

            assert.ok(secondRunMessages.some((message: any) => message.content.includes('Run two.')));
            assert.equal(secondRunMessages.some((message: any) => message.content.includes('Run one.')), false);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('stores swarm aggregate messages per run and shows only the latest run by default', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-run-scoped-swarm-log-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Run Scoped Aggregate',
                agentIds: ['alpha', 'beta']
            });

            const firstRun = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run one.' });
            await manager.replaceClusterSwarmMessages({
                clusterId: cluster.id,
                mode: 'collaborate',
                messages: [
                    createContextMessage('swarm-run-1', 'Run one aggregate')
                ],
                swarmRunId: firstRun.swarmRunId
            });

            const secondRun = await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Run two.' });
            await manager.replaceClusterSwarmMessages({
                clusterId: cluster.id,
                mode: 'collaborate',
                messages: [
                    createContextMessage('swarm-run-2', 'Run two aggregate')
                ],
                swarmRunId: secondRun.swarmRunId
            });

            const latestMessages = await manager.getClusterSwarmMessages({ clusterId: cluster.id, mode: 'collaborate' });
            const firstRunMessages = await manager.getClusterSwarmMessages({
                clusterId: cluster.id,
                mode: 'collaborate',
                swarmRunId: firstRun.swarmRunId
            });

            assert.deepEqual(latestMessages.map((message: any) => message.content), ['Run two aggregate']);
            assert.deepEqual(firstRunMessages.map((message: any) => message.content), ['Run one aggregate']);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('forbids workers from finalizing during critique and reserves finalization for synthesis coordinator', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-cluster-manager-phase-guards-'));
        const storagePath = path.join(root, 'clusters.json');
        const service = new FakeCollaborationService();
        const manager = new ClusterManager(service as unknown as OpenClawService, storagePath);

        try {
            const cluster = await manager.createCluster({
                name: 'Phase Guard Swarm',
                agentIds: ['alpha', 'beta'],
                workspaceConfig: {
                    presetId: 'implementation-squad',
                    collaborationStyle: 'debate',
                    deliveryStyle: 'balanced',
                    critiqueLevel: 'standard',
                    rounds: 1
                }
            });

            await manager.collaborateOnCluster({ clusterId: cluster.id, message: 'Draft the implementation report and let the final summarizer write it to disk.' });

            assert.match(service.findPrompt('beta', 'critique-1'), /Do not write files, export artifacts, or act as the final summarizer during critique/i);
            assert.match(service.findPrompt('alpha', 'opening'), /Do not write files, export artifacts, or perform final consolidation in opening/i);
            assert.match(service.findPrompt('alpha', 'synthesis'), /only role in this run authorized to finalize, export, or write the merged result/i);
            assert.equal(service.sentMessages.some((entry: any) => entry.agentId === 'beta' && entry.stage === 'synthesis'), false);
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});

class FakeCollaborationService extends EventEmitter {
    public readonly sentMessages: SentMessageEntry[] = [];
    public readonly cancelledSwarmRuns: Array<{ swarmRunId: string; reason: string }> = [];
    public readonly abortedSessions: string[] = [];
    public onMessageSent?: (entry: SentMessageEntry) => Promise<void> | void;

    private readonly agents = new Map<string, Agent>();
    private readonly sessionAgentIds = new Map<string, string>();
    private readonly sessionMessages = new Map<string, ChatMessage[]>();
    private sessionCounter = 0;

    constructor(
        private readonly failures: CollaborationFailure[] = [],
        private readonly options: FakeCollaborationServiceOptions = {}
    ) {
        super();

        for (const agentId of ['alpha', 'beta', 'gamma', 'delta']) {
            this.agents.set(agentId, {
                id: agentId,
                name: agentId.toUpperCase(),
                model: 'fake-model',
                status: 'active',
                createdAt: '2026-03-10T00:00:00.000Z'
            });
        }
    }

    public supportsRemoteClusters(): boolean {
        return false;
    }

    public async createChatSession(agentId: string): Promise<ChatSession> {
        const sessionId = `session-${++this.sessionCounter}`;
        const timestamp = new Date().toISOString();
        this.sessionAgentIds.set(sessionId, agentId);
        this.sessionMessages.set(sessionId, []);

        return {
            id: sessionId,
            agentId,
            messages: [],
            createdAt: timestamp,
            updatedAt: timestamp
        };
    }

    public async sendMessage(sessionId: string, prompt: string): Promise<ChatMessage> {
        const agentId = this.sessionAgentIds.get(sessionId);
        if (!agentId) {
            throw new Error(`Missing agent for session ${sessionId}`);
        }

        const stage = detectDebateStage(prompt);
        this.sentMessages.push({
            agentId,
            sessionId,
            stage,
            prompt
        });
        await this.onMessageSent?.({
            agentId,
            sessionId,
            stage,
            prompt
        });

        if (this.failures.some((rule: any) => rule.agentId === agentId && rule.stage === stage)) {
            throw new Error(`${agentId} failed during ${stage}`);
        }

        const response: ChatMessage = {
            id: `message-${this.sentMessages.length}`,
            role: 'assistant',
            content: buildFakeResponse(agentId, stage, this.options),
            timestamp: new Date().toISOString()
        };
        const history = this.sessionMessages.get(sessionId) || [];
        history.push({
            id: `user-${this.sentMessages.length}`,
            role: 'user',
            content: prompt,
            timestamp: new Date().toISOString()
        } satisfies ChatMessage);
        history.push(response);
        if (this.options.appendTrailingEmptyAssistant) {
            history.push({
                id: `placeholder-${this.sentMessages.length}`,
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString()
            });
        }
        this.sessionMessages.set(sessionId, history);
        return response;
    }

    public async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return [...(this.sessionMessages.get(sessionId) || [])];
    }

    public async abortSessionRun(sessionId: string): Promise<void> {
        this.abortedSessions.push(sessionId);
    }

    public cancelSwarmRun(swarmRunId: string, reason: string = 'Swarm run cancelled'): number {
        this.cancelledSwarmRuns.push({ swarmRunId, reason });
        return 1;
    }

    public async getAgent(agentId: string): Promise<Agent | undefined> {
        return this.agents.get(agentId) || undefined;
    }

    public findPrompt(agentId: string, stage: DebateStage): string {
        const entry = this.sentMessages.find((message: any) => message.agentId === agentId && message.stage === stage);
        assert.ok(entry, `Expected a ${stage} prompt for ${agentId}`);
        return entry?.prompt || '';
    }
}

function detectDebateStage(prompt: string): DebateStage {
    if (!prompt.includes('Debate stage:') && !prompt.includes('You are coordinating the agent swarm')) {
        const stopMatch = prompt.match(/Current review round:\s*(\d+)/i);
        if (stopMatch) {
            return `stop-check-${Number(stopMatch[1] || '1')}`;
        }
        return 'broadcast';
    }

    if (prompt.includes('Debate stage: opening')) {
        return 'opening';
    }

    const critiqueMatch = prompt.match(/Debate stage:\s*critique round\s+(\d+)/i);
    if (critiqueMatch) {
        return `critique-${Number(critiqueMatch[1] || '1')}`;
    }

    const revisionMatch = prompt.match(/Debate stage:\s*revision round\s+(\d+)/i);
    if (revisionMatch) {
        return `revision-${Number(revisionMatch[1] || '1')}`;
    }

    return 'synthesis';
}

function buildFakeResponse(
    agentId: string,
    stage: DebateStage,
    options: {
        stopAfterReviewRound?: number;
    } = {}
): string {
    switch (stage) {
        case 'broadcast':
            return `Broadcast from ${agentId}`;
        case 'opening':
            return `Opening from ${agentId}\nPosition: ${agentId} opening.`;
        case 'synthesis':
            return `Final synthesis by ${agentId}`;
        default:
            if (stage.startsWith('critique-')) {
                const round = Number(stage.slice('critique-'.length) || '1');
                return `Critique ${round} from ${agentId}\nReview verdict: ${agentId} critique round ${round}.`;
            }

            if (stage.startsWith('revision-')) {
                const round = Number(stage.slice('revision-'.length) || '1');
                const prefix = round >= 2 ? 'Final revision' : 'Revision';
                return `${prefix} ${round} from ${agentId}\nRevised position: ${agentId} revision-${round}.`;
            }

            if (stage.startsWith('stop-check-')) {
                const round = Number(stage.slice('stop-check-'.length) || '1');
                const shouldStop = Number.isFinite(options.stopAfterReviewRound)
                    ? round >= Number(options.stopAfterReviewRound)
                    : false;
                return shouldStop
                    ? `Decision: STOP\nReason: Review round ${round} meets the stop condition.`
                    : `Decision: CONTINUE\nReason: Review round ${round} has not met the stop condition yet.`;
            }

            return `${agentId} response`;
    }
}

function toComparableMessage(message: ChatMessage) {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        agentId: message.agentId,
        displayName: message.displayName,
        contextLabel: message.contextLabel
    };
}

function createContextMessage(id: string, content: string): ChatMessage {
    return {
        id,
        role: 'assistant',
        content,
        timestamp: '2026-03-19T00:00:00.000Z'
    };
}
