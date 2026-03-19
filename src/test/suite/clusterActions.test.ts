import * as assert from 'assert/strict';
import * as vscode from 'vscode';
import {
    handleBroadcast,
    handleCollaborate,
    handleClusterAgentMessage,
    handleClusterAgentSessionCommand,
    handleSaveCluster,
    loadClusterAgentMessages,
    loadClusterAgentSwarmMessages,
    loadClusterSwarmMessages
} from '../../panels/openclawPanel/clusterActions';
import type { Agent, AgentCluster, ChatMessage, ChatSession } from '../../services/openclawService';
import type {
    ClusterCollaborationProgressEvent,
    ClusterCollaborationRoundDescriptor
} from '../../managers/clusterManager';

suite('clusterActions', () => {
    test('loads persisted swarm messages when entering swarm mode', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('persisted-swarm-1', 'assistant', 'persisted swarm reply')
        ];
        await clusterManager.replaceClusterSwarmMessages('cluster-1', 'collaborate', persistedMessages);

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate');

        const replaceMessage = posted.find(message => message.type === 'replaceSwarmMessages');
        assert.deepEqual(replaceMessage?.messages, persistedMessages);
    });

    test('loads raw collaborate swarm logs by aggregating per-agent swarm transcripts', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha', 'beta'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z'
        };
        await clusterManager.replaceClusterAgentSwarmMessages('cluster-1', 'alpha', 'collaborate', [{
            ...createMessage('alpha-raw', 'user', 'alpha raw prompt'),
            timestamp: '2026-03-12T00:00:01.000Z',
            agentId: 'alpha',
            metadata: {
                swarmPhase: 'opening',
                swarmLogKind: 'outbound-prompt'
            }
        }]);
        await clusterManager.replaceClusterAgentSwarmMessages('cluster-1', 'beta', 'collaborate', [{
            ...createMessage('beta-raw', 'assistant', 'beta raw reply'),
            timestamp: '2026-03-12T00:00:02.000Z',
            agentId: 'beta',
            metadata: {
                swarmPhase: 'opening',
                swarmLogKind: 'inbound-final'
            }
        }]);

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate', 'raw');

        const replaceMessage = posted.find(message =>
            message.type === 'replaceSwarmMessages'
            && message.outputMode === 'raw'
        );
        assert.ok(replaceMessage);
        assert.deepEqual(
            (replaceMessage?.messages as ChatMessage[]).map(message => message.content),
            ['alpha raw prompt', 'beta raw reply']
        );
    });

    test('loads a specific prior swarm run without replacing it with the latest run', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterSwarmMessages(
            'cluster-1',
            'collaborate',
            [createMessage('run-1-msg', 'assistant', 'older swarm run')],
            'run-1'
        );
        await clusterManager.replaceClusterSwarmMessages(
            'cluster-1',
            'collaborate',
            [createMessage('run-2-msg', 'assistant', 'latest swarm run')],
            'run-2'
        );

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate', 'frontend', 'run-1');

        const replaceMessage = posted.find(message =>
            message.type === 'replaceSwarmMessages'
            && message.swarmRunId === 'run-1'
            && message.outputMode === 'frontend'
        );
        assert.ok(replaceMessage);
        assert.deepEqual(
            (replaceMessage?.messages as ChatMessage[]).map(message => message.content),
            ['older swarm run']
        );
    });

    test('loads persisted cluster-agent messages when runtime history is empty', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('persisted-1', 'assistant', 'persisted reply')
        ];
        await clusterManager.replaceClusterAgentMessages('cluster-1', 'alpha', persistedMessages);
        sessionManager.refreshResults.set('session-1', []);

        await loadClusterAgentMessages(context, 'cluster-1', 'alpha');

        const replaceMessage = posted.find(message => message.type === 'replaceClusterMessages');
        assert.deepEqual(replaceMessage?.messages, persistedMessages);
        assert.deepEqual(clusterManager.replaceCalls[clusterManager.replaceCalls.length - 1]?.messages, persistedMessages);
    });

    test('loads swarm log messages for a specific cluster agent', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('swarm-1', 'user', 'opening prompt'),
            createMessage('swarm-2', 'assistant', 'opening reply')
        ];
        await clusterManager.replaceClusterAgentSwarmMessages('cluster-1', 'alpha', 'collaborate', persistedMessages);

        await loadClusterAgentSwarmMessages(context, 'cluster-1', 'alpha', 'collaborate');

        const replaceMessage = posted.find(message => message.type === 'replaceClusterAgentSwarmMessages');
        assert.deepEqual(replaceMessage?.messages, [
            { ...persistedMessages[0], contextLabel: 'Collaborate Log' },
            { ...persistedMessages[1], contextLabel: 'Collaborate Log' }
        ]);
    });

    test('persists refreshed cluster-agent messages after send completes', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const streamedAssistant = createMessage('stream-1', 'assistant', 'streamed reply');
        const finalMessages: ChatMessage[] = [
            createMessage('user-1', 'user', 'hello'),
            createMessage('assistant-1', 'assistant', 'final reply')
        ];

        sessionManager.streamChunks = [{
            content: '',
            done: false,
            message: streamedAssistant
        }];
        sessionManager.refreshResults.set('session-1', finalMessages);

        await handleClusterAgentMessage(context, 'cluster-1', 'alpha', 'hello');

        assert.deepEqual(clusterManager.replaceCalls[clusterManager.replaceCalls.length - 1]?.messages, finalMessages);
        assert.ok(posted.some(message => message.type === 'appendClusterMessage'));
        assert.ok(posted.some(message => message.type === 'replaceClusterMessages'));
    });

    test('clear resets persisted cluster-agent messages and rotates session when runtime clear is unsupported', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterAgentMessages('cluster-1', 'alpha', [
            createMessage('msg-1', 'assistant', 'existing reply')
        ]);
        sessionManager.refreshResults.set('session-1', [
            createMessage('msg-2', 'assistant', 'still present after clear')
        ]);

        await handleClusterAgentSessionCommand(context, 'cluster-1', 'alpha', 'clear');

        assert.equal(clusterManager.sessionId, 'session-2');
        assert.ok(clusterManager.clearCalls.length >= 1);
        assert.deepEqual(await clusterManager.getClusterAgentMessages('cluster-1', 'alpha'), []);
        assert.ok(posted.some(message =>
            message.type === 'replaceClusterMessages'
            && Array.isArray(message.messages)
            && message.messages.length === 0
        ));
    });

    test('new rotates session and clears persisted cluster-agent messages', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterAgentMessages('cluster-1', 'alpha', [
            createMessage('msg-1', 'assistant', 'existing reply')
        ]);

        await handleClusterAgentSessionCommand(context, 'cluster-1', 'alpha', 'new');

        assert.equal(clusterManager.sessionId, 'session-2');
        assert.equal(clusterManager.clearCalls.length, 1);
        assert.deepEqual(await clusterManager.getClusterAgentMessages('cluster-1', 'alpha'), []);
        assert.ok(posted.some(message =>
            message.type === 'replaceClusterMessages'
            && Array.isArray(message.messages)
            && message.messages.length === 0
        ));
    });

    test('persists swarm conversation messages after collaborate completes', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha', 'beta'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z'
        };
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-1',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
                descriptor: createRoundDescriptor('opening'),
                entries: {
                    alpha: {
                        agentId: 'alpha',
                        ok: true,
                        message: createMessage('alpha-1', 'assistant', 'alpha opening')
                    },
                    beta: {
                        agentId: 'beta',
                        ok: true,
                        message: createMessage('beta-1', 'assistant', 'beta opening')
                    }
                }
            }],
            contributions: {},
            synthesis: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-final', 'assistant', 'final synthesis')
            }
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages('cluster-1', 'collaborate');
        assert.equal(persisted[0]?.role, 'user');
        assert.equal(persisted[0]?.content, 'plan this');
        assert.ok(persisted.some(message => message.content === 'final synthesis'));
        const batchIds = new Set(
            persisted
                .map(message => String(message.metadata?.swarmBatchId || ''))
                .filter(Boolean)
        );
        assert.equal(batchIds.size, 1);
        assert.ok(posted.some(message => message.type === 'replaceSwarmMessages'));
    });

    test('posts partial collaboration progress before the full swarm result completes', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z'
        };
        clusterManager.progressEvents = [{
            kind: 'round-entry',
            swarmRunId: 'fake-run-collab-2',
            roundKind: 'opening',
            round: createRoundDescriptor('opening'),
            agentId: 'alpha',
            entry: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-opening', 'assistant', 'opening reply')
            }
        }];
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-2',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
                descriptor: createRoundDescriptor('opening'),
                entries: {
                    alpha: {
                        agentId: 'alpha',
                        ok: true,
                        message: createMessage('alpha-opening', 'assistant', 'opening reply')
                    }
                }
            }],
            contributions: {},
            synthesis: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-final', 'assistant', 'final synthesis')
            }
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        assert.ok(posted.some(message =>
            message.type === 'replaceSwarmMessages'
            && message.keepPending === true
        ));
        assert.ok(posted.some(message =>
            message.type === 'replaceSwarmMessages'
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'opening reply')
        ));
    });

    test('finalize keeps only one canonical synthesis message after progress updates', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.progressEvents = [{
            kind: 'synthesis',
            swarmRunId: 'fake-run-collab-final',
            coordinatorAgentId: 'alpha',
            entry: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-final-progress', 'assistant', 'missing scope: operator.write')
            }
        }];
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-final',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'revision-1',
                descriptor: createRoundDescriptor('revision-1'),
                entries: {
                    alpha: {
                        agentId: 'alpha',
                        ok: true,
                        message: createMessage('alpha-revision-1', 'assistant', 'missing scope: operator.write')
                    }
                }
            }],
            contributions: {},
            synthesis: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-final-result', 'assistant', 'missing scope: operator.write')
            }
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages('cluster-1', 'collaborate');
        assert.equal(
            persisted.filter(message =>
                message.content === 'missing scope: operator.write'
                && message.displayName === 'Final Answer'
            ).length,
            1
        );
    });

    test('treats missing operator.write scope as a swarm configuration error instead of chat content', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.progressEvents = [{
            kind: 'round-entry',
            swarmRunId: 'fake-run-scope-error',
            roundKind: 'opening',
            round: createRoundDescriptor('opening'),
            agentId: 'alpha',
            entry: {
                agentId: 'alpha',
                ok: false,
                error: 'missing scope: operator.write'
            }
        }];
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-scope-error',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
                descriptor: createRoundDescriptor('opening'),
                entries: {
                    alpha: {
                        agentId: 'alpha',
                        ok: false,
                        error: 'missing scope: operator.write'
                    }
                }
            }],
            contributions: {},
            synthesis: null
        };

        const ok = await handleCollaborate(context, 'cluster-1', 'plan this');

        assert.equal(ok, false);
        assert.ok(posted.some(message => message.type === 'clusterRunFailed' && message.mode === 'collaborate'));
        assert.ok(posted.some(message =>
            message.type === 'error'
            && String(message.message || '').includes('Gateway permission error')
        ));
        const persisted = await clusterManager.getClusterSwarmMessages('cluster-1', 'collaborate');
        assert.equal(persisted.some(message => message.content === 'missing scope: operator.write'), false);
    });

    test('keeps the richer collaboration trace variant when the same message id later includes thinking parts', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.progressEvents = [{
            kind: 'round-entry',
            swarmRunId: 'fake-run-thinking-rich',
            roundKind: 'opening',
            round: createRoundDescriptor('opening'),
            agentId: 'alpha',
            entry: {
                agentId: 'alpha',
                ok: true,
                trace: [
                    createMessage('alpha-opening', 'assistant', 'short reply')
                ],
                message: {
                    ...createMessage('alpha-opening', 'assistant', 'short reply'),
                    parts: [
                        {
                            type: 'thinking',
                            thinking: 'full internal reasoning'
                        },
                        {
                            type: 'text',
                            text: 'short reply'
                        }
                    ]
                }
            }
        }];
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-thinking-rich',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
                descriptor: createRoundDescriptor('opening'),
                entries: {
                    alpha: {
                        agentId: 'alpha',
                        ok: true,
                        message: {
                            ...createMessage('alpha-opening', 'assistant', 'short reply'),
                            parts: [
                                {
                                    type: 'thinking',
                                    thinking: 'full internal reasoning'
                                },
                                {
                                    type: 'text',
                                    text: 'short reply'
                                }
                            ]
                        }
                    }
                }
            }],
            contributions: {},
            synthesis: null
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages('cluster-1', 'collaborate');
        const alphaOpening = persisted.find(message => message.id === 'alpha-opening');
        assert.ok(alphaOpening);
        assert.ok(Array.isArray(alphaOpening?.parts));
        assert.equal(alphaOpening?.parts?.some((part: any) => part.type === 'thinking'), true);
    });

    test('starts a new swarm run with a clean progress view instead of prefixing old aggregate messages', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterSwarmMessages('cluster-1', 'collaborate', [
            createMessage('old-1', 'assistant', 'old pending reply')
        ]);
        clusterManager.replaceSwarmCalls.length = 0;
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-3',
            clusterId: 'cluster-1',
            clusterName: 'Cluster 1',
            userMessage: 'fresh plan',
            coordinatorAgentId: 'alpha',
            rounds: [],
            contributions: {},
            synthesis: null
        };

        await handleCollaborate(context, 'cluster-1', 'fresh plan');

        assert.equal(clusterManager.replaceSwarmCalls.length > 0, true);
        assert.deepEqual(
            clusterManager.replaceSwarmCalls[0]?.messages.map(message => message.content),
            ['fresh plan']
        );
        assert.equal(
            clusterManager.replaceSwarmCalls[0]?.messages.some(message => message.content === 'old pending reply'),
            false
        );
    });

    test('ignores late swarm progress callbacks after the run token changes', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha', 'beta'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z'
        };
        clusterManager.progressEvents = [
            {
                kind: 'round-entry',
                swarmRunId: 'late-run-1',
                roundKind: 'opening',
                round: createRoundDescriptor('opening'),
                agentId: 'alpha',
                entry: {
                    agentId: 'alpha',
                    ok: true,
                    message: createMessage('alpha-opening', 'assistant', 'opening reply alpha')
                }
            },
            {
                kind: 'round-entry',
                swarmRunId: 'late-run-1',
                roundKind: 'opening',
                round: createRoundDescriptor('opening'),
                agentId: 'beta',
                entry: {
                    agentId: 'beta',
                    ok: true,
                    message: createMessage('beta-opening', 'assistant', 'opening reply beta')
                }
            }
        ];
        clusterManager.collaborationResult = {
            swarmRunId: 'late-run-1',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [],
            contributions: {},
            synthesis: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-final', 'assistant', 'final synthesis')
            }
        };
        clusterManager.onProgressEmitted = async index => {
            if (index === 0) {
                (context as any).__setClusterSwarmRunToken(2);
            }
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages('cluster-1', 'collaborate');
        assert.deepEqual(
            persisted.map(message => message.content),
            ['plan this', 'opening reply alpha']
        );
        assert.equal(persisted.some(message => message.content === 'opening reply beta'), false);
        assert.equal(persisted.some(message => message.content === 'final synthesis'), false);
    });

    test('appends the final assistant result when swarm trace only contains tool activity', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z'
        };
        clusterManager.broadcastResult = {
            alpha: {
                agentId: 'alpha',
                ok: true,
                trace: [
                    createMessage('tool-1', 'tool', 'Tool still running...')
                ],
                message: createMessage('assistant-final', 'assistant', 'Actual final answer')
            }
        };

        await handleBroadcast(context, 'cluster-1', 'ship it');

        const finalReplace = [...posted]
            .reverse()
            .find(message => message.type === 'replaceSwarmMessages' && message.keepPending !== true);
        assert.ok(finalReplace);
        assert.ok(Array.isArray(finalReplace.messages));
        assert.ok(finalReplace.messages.some((entry: any) => entry.content === 'Actual final answer'));
    });

    test('creates new agents before saving a cluster when quick-create members are provided', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await withCapturedProgress(async progressEvents => {
            await handleSaveCluster(context, undefined, {
                name: 'New Swarm',
                agentIds: ['alpha'],
                createAgents: [{
                    name: 'Gamma',
                    model: 'model-c',
                    systemPrompt: 'shared prompt'
                }]
            });

            assert.deepEqual(
                progressEvents
                    .map(event => event.message)
                    .filter((message): message is string => Boolean(message)),
                [
                    'Creating cluster member 1/1: Gamma...',
                    'Creating cluster record...',
                    'Refreshing agents...',
                    'Refreshing clusters...'
                ]
            );
            assert.ok(progressEvents.some(event => typeof event.increment === 'number' && event.increment > 0));
        });

        assert.deepEqual(context.__createdAgents.map((agent: any) => agent.name), ['Gamma']);
        assert.deepEqual(clusterManager.cluster.agentIds, ['alpha', 'gamma']);
        assert.equal(context.__metrics.loadAgentsCalls, 1);
        assert.deepEqual(context.__metrics.loadClustersCalls, ['cluster-created']);
        assert.ok(posted.some(message => message.type === 'clusterSaved'));
    });

    test('saves unlimited-round swarm settings with the stop condition', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await handleSaveCluster(context, undefined, {
            name: 'Unlimited Swarm',
            agentIds: ['alpha', 'beta'],
            workspaceConfig: {
                presetId: 'implementation-squad',
                collaborationStyle: 'debate',
                deliveryStyle: 'balanced',
                critiqueLevel: 'standard',
                rounds: 2,
                runUntilConditionMet: true,
                stopCondition: 'Stop when the swarm converges on one rollout plan.'
            }
        });

        assert.equal(clusterManager.cluster.workspaceConfig?.runUntilConditionMet, true);
        assert.equal(
            clusterManager.cluster.workspaceConfig?.stopCondition,
            'Stop when the swarm converges on one rollout plan.'
        );
    });
});

class FakeClusterManager {
    public sessionId = 'session-1';
    public replaceCalls: Array<{ clusterId: string; agentId: string; messages: ChatMessage[] }> = [];
    public clearCalls: Array<{ clusterId: string; agentId: string }> = [];
    public replaceSwarmCalls: Array<{ clusterId: string; mode: 'broadcast' | 'collaborate'; messages: ChatMessage[]; swarmRunId?: string }> = [];
    public replaceAgentSwarmCalls: Array<{ clusterId: string; agentId: string; mode: 'broadcast' | 'collaborate'; messages: ChatMessage[]; swarmRunId?: string }> = [];
    public cluster: AgentCluster = {
        id: 'cluster-1',
        name: 'Cluster 1',
        agentIds: ['alpha'],
        status: 'active',
        createdAt: '2026-03-12T00:00:00.000Z'
    };
    public collaborationResult: any = null;
    public broadcastResult: Record<string, any> = {};
    public progressEvents: ClusterCollaborationProgressEvent[] = [];
    public onProgressEmitted?: (index: number, event: ClusterCollaborationProgressEvent) => Promise<void> | void;
    public clusterList: AgentCluster[] = [];
    private readonly messagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmMessagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmAgentMessagesByKey = new Map<string, ChatMessage[]>();
    private readonly latestSwarmRunByKey = new Map<string, string>();
    private sessionCounter = 1;

    public async ensureClusterAgentSessionId(): Promise<string> {
        return this.sessionId;
    }

    public async resetClusterAgentSessionId(): Promise<string> {
        this.sessionCounter += 1;
        this.sessionId = `session-${this.sessionCounter}`;
        return this.sessionId;
    }

    public async getClusterAgentMessages(clusterId: string, agentId: string): Promise<ChatMessage[]> {
        return cloneMessages(this.messagesByKey.get(this.key(clusterId, agentId)) || []);
    }

    public async replaceClusterAgentMessages(clusterId: string, agentId: string, messages: ChatMessage[]): Promise<void> {
        this.replaceCalls.push({
            clusterId,
            agentId,
            messages: cloneMessages(messages)
        });

        if (messages.length > 0) {
            this.messagesByKey.set(this.key(clusterId, agentId), cloneMessages(messages));
        } else {
            this.messagesByKey.delete(this.key(clusterId, agentId));
        }
    }

    public async clearClusterAgentMessages(clusterId: string, agentId: string): Promise<void> {
        this.clearCalls.push({ clusterId, agentId });
        this.messagesByKey.delete(this.key(clusterId, agentId));
    }

    public async getClusterSwarmMessages(clusterId: string, mode: 'broadcast' | 'collaborate', swarmRunId?: string): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmMessagesByKey.get(this.swarmKey(clusterId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId))) || []);
    }

    public async getClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate',
        swarmRunId?: string
    ): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmAgentMessagesByKey.get(this.swarmAgentKey(clusterId, agentId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId))) || []);
    }

    public async replaceClusterSwarmMessages(
        clusterId: string,
        mode: 'broadcast' | 'collaborate',
        messages: ChatMessage[],
        swarmRunId?: string
    ): Promise<void> {
        this.replaceSwarmCalls.push({
            clusterId,
            mode,
            messages: cloneMessages(messages),
            swarmRunId
        });

        if (swarmRunId) {
            this.latestSwarmRunByKey.set(this.swarmRunRegistryKey(clusterId, mode), swarmRunId);
        }

        if (messages.length > 0) {
            this.swarmMessagesByKey.set(this.swarmKey(clusterId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId)), cloneMessages(messages));
        } else {
            this.swarmMessagesByKey.delete(this.swarmKey(clusterId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId)));
        }
    }

    public async replaceClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate',
        messages: ChatMessage[],
        swarmRunId?: string
    ): Promise<void> {
        this.replaceAgentSwarmCalls.push({
            clusterId,
            agentId,
            mode,
            messages: cloneMessages(messages),
            swarmRunId
        });

        if (swarmRunId) {
            this.latestSwarmRunByKey.set(this.swarmRunRegistryKey(clusterId, mode), swarmRunId);
        }

        if (messages.length > 0) {
            this.swarmAgentMessagesByKey.set(this.swarmAgentKey(clusterId, agentId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId)), cloneMessages(messages));
        } else {
            this.swarmAgentMessagesByKey.delete(this.swarmAgentKey(clusterId, agentId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId)));
        }
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        return this.cluster?.id === clusterId ? { ...this.cluster } : null;
    }

    public async createCluster(params: { name: string; agentIds: string[]; workspaceConfig?: Record<string, unknown> }): Promise<AgentCluster> {
        this.cluster = {
            id: 'cluster-created',
            name: params.name,
            agentIds: [...params.agentIds],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z',
            workspaceConfig: params.workspaceConfig as never
        };
        this.clusterList = [this.cluster];
        return { ...this.cluster };
    }

    public async updateCluster(clusterId: string, params: { name?: string; agentIds?: string[]; workspaceConfig?: Record<string, unknown> }): Promise<AgentCluster> {
        this.cluster = {
            ...this.cluster,
            id: clusterId,
            name: params.name || this.cluster.name,
            agentIds: params.agentIds ? [...params.agentIds] : [...this.cluster.agentIds],
            workspaceConfig: (params.workspaceConfig as never) || this.cluster.workspaceConfig
        };
        this.clusterList = [this.cluster];
        return { ...this.cluster };
    }

    public async getClusters(): Promise<AgentCluster[]> {
        return this.clusterList.length > 0 ? this.clusterList.map(cluster => ({ ...cluster })) : [{ ...this.cluster }];
    }

    public async collaborateOnCluster(_clusterId?: string, _message?: string, options?: {
        swarmRunId?: string;
        onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
    }): Promise<any> {
        for (const [index, event] of this.progressEvents.entries()) {
            const resolvedEvent = {
                ...event,
                swarmRunId: options?.swarmRunId || event.swarmRunId
            };
            await options?.onProgress?.(resolvedEvent);
            await this.onProgressEmitted?.(index, resolvedEvent);
        }
        return {
            swarmRunId: options?.swarmRunId || 'fake-run',
            ...this.collaborationResult
        };
    }

    public async broadcastToCluster(): Promise<Record<string, any>> {
        return this.broadcastResult;
    }

    private key(clusterId: string, agentId: string): string {
        return `${clusterId}::${agentId}`;
    }

    private swarmKey(clusterId: string, mode: 'broadcast' | 'collaborate', swarmRunId?: string): string {
        return `${clusterId}::swarm::${mode}::${swarmRunId || 'default'}`;
    }

    private swarmAgentKey(clusterId: string, agentId: string, mode: 'broadcast' | 'collaborate', swarmRunId?: string): string {
        return `${clusterId}::agent::${agentId}::${mode}::${swarmRunId || 'default'}`;
    }

    private swarmRunRegistryKey(clusterId: string, mode: 'broadcast' | 'collaborate'): string {
        return `${clusterId}::${mode}`;
    }

    private resolveSwarmRunId(clusterId: string, mode: 'broadcast' | 'collaborate', swarmRunId?: string): string {
        return swarmRunId || this.latestSwarmRunByKey.get(this.swarmRunRegistryKey(clusterId, mode)) || 'default';
    }
}

class FakeClusterSessionManager {
    public streamChunks: Array<{ content: string; done: boolean; message?: ChatMessage }> = [];
    public refreshResults = new Map<string, ChatMessage[]>();
    private readonly sessions = new Map<string, ChatSession>();
    private currentSessionId: string | null = null;

    public async getOrCreateSession(
        agentId: string,
        options: { refreshHistory?: boolean; sessionId?: string } = {}
    ): Promise<ChatSession> {
        const sessionId = String(options.sessionId || '').trim() || 'session-1';
        let session = this.sessions.get(sessionId);
        if (!session) {
            session = {
                id: sessionId,
                agentId,
                messages: [],
                createdAt: '2026-03-12T00:00:00.000Z',
                updatedAt: '2026-03-12T00:00:00.000Z'
            };
            this.sessions.set(sessionId, session);
        }

        if (options.refreshHistory) {
            session.messages = cloneMessages(this.refreshResults.get(sessionId) || []);
        }

        return session;
    }

    public setCurrentSession(sessionId: string): boolean {
        this.currentSessionId = sessionId;
        return true;
    }

    public async *streamMessage(): AsyncGenerator<{ content: string; done: boolean; message?: ChatMessage }, void, unknown> {
        for (const chunk of this.streamChunks) {
            yield chunk;
        }
    }

    public async refreshSessionHistory(sessionId: string): Promise<ChatMessage[]> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return [];
        }

        const refreshed = cloneMessages(this.refreshResults.get(sessionId) || session.messages);
        session.messages = refreshed;
        return refreshed;
    }

    public async clearHistory(): Promise<void> {
        if (!this.currentSessionId) {
            return;
        }

        const session = this.sessions.get(this.currentSessionId);
        if (session) {
            session.messages = [];
        }
    }
}

function createClusterActionContext(
    clusterManager: FakeClusterManager,
    clusterSessionManager: FakeClusterSessionManager,
    posted: Array<Record<string, unknown>>
) {
    let clusterSwarmRunToken = 0;
    let clusterAgentRunToken = 0;
    const createdAgents: Array<{ id: string; name: string; model: string }> = [];
    const metrics = {
        loadAgentsCalls: 0,
        loadClustersCalls: [] as Array<string | undefined>
    };

    const context = {
        clusterManager,
        agentManager: {
            getAgents: async (): Promise<Agent[]> => [
                {
                    id: 'alpha',
                    name: 'Alpha',
                    model: 'model-a',
                    status: 'idle',
                    createdAt: '2026-03-12T00:00:00.000Z'
                },
                {
                    id: 'beta',
                    name: 'Beta',
                    model: 'model-b',
                    status: 'idle',
                    createdAt: '2026-03-12T00:00:00.000Z'
                }
            ],
            createAgent: async (params: { name: string; model: string }) => {
                const created = {
                    id: params.name.toLowerCase(),
                    name: params.name,
                    model: params.model,
                    status: 'idle' as const,
                    createdAt: '2026-03-12T00:00:00.000Z'
                };
                createdAgents.push(created);
                return created;
            },
            deleteAgent: async (agentId: string) => {
                const index = createdAgents.findIndex(agent => agent.id === agentId);
                if (index >= 0) {
                    createdAgents.splice(index, 1);
                }
            }
        } as never,
        clusterSessionManager,
        postMessage: (message: Record<string, unknown>) => {
            posted.push(message);
        },
        loadAgents: async () => {
            metrics.loadAgentsCalls += 1;
        },
        loadClusters: async (selectedClusterId?: string) => {
            metrics.loadClustersCalls.push(selectedClusterId);
        },
        showClusterView: () => undefined,
        getCurrentAgentId: () => null,
        beginAgentRun: () => true,
        endAgentRun: () => true,
        nextClusterSwarmRunToken: () => {
            clusterSwarmRunToken += 1;
            return clusterSwarmRunToken;
        },
        getClusterSwarmRunToken: () => clusterSwarmRunToken,
        nextClusterAgentRunToken: () => {
            clusterAgentRunToken += 1;
            return clusterAgentRunToken;
        },
        getClusterAgentRunToken: () => clusterAgentRunToken
    } as unknown as Parameters<typeof loadClusterAgentMessages>[0] & {
        __createdAgents: typeof createdAgents;
        __metrics: typeof metrics;
    };

    (context as any).__createdAgents = createdAgents;
    (context as any).__metrics = metrics;
    (context as any).__setClusterSwarmRunToken = (value: number) => {
        clusterSwarmRunToken = value;
    };
    return context;
}

function createMessage(id: string, role: ChatMessage['role'], content: string): ChatMessage {
    return {
        id,
        role,
        content,
        timestamp: '2026-03-12T00:00:00.000Z',
        agentId: 'alpha'
    };
}

function createRoundDescriptor(kind: 'opening' | `critique-${number}` | `revision-${number}`): ClusterCollaborationRoundDescriptor {
    if (kind === 'opening') {
        return {
            kind,
            phase: 'opening',
            reviewRound: 0,
            phaseIndex: 1,
            displayOrder: 1,
            labelKey: 'clusters.debateRoundOpening',
            fallbackLabel: 'Opening Positions'
        };
    }

    if (kind.startsWith('critique-')) {
        const reviewRound = Number(kind.slice('critique-'.length) || '1');
        return {
            kind,
            phase: 'critique',
            reviewRound,
            phaseIndex: 2,
            displayOrder: reviewRound * 2,
            labelKey: 'clusters.debateRoundCritiqueDynamic',
            fallbackLabel: `Review Round ${reviewRound}: Critique`
        };
    }

    const reviewRound = Number(kind.slice('revision-'.length) || '1');
    return {
        kind,
        phase: 'revision',
        reviewRound,
        phaseIndex: 3,
        displayOrder: (reviewRound * 2) + 1,
        labelKey: 'clusters.debateRoundRevisionDynamic',
        fallbackLabel: `Review Round ${reviewRound}: Revision`
    };
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(message => ({ ...message }));
}

async function withCapturedProgress<T>(
    run: (progressEvents: Array<{ message?: string; increment?: number }>) => Promise<T>
): Promise<T> {
    const originalWithProgress = (vscode as any).window.withProgress;
    const progressEvents: Array<{ message?: string; increment?: number }> = [];

    (vscode as any).window.withProgress = async (
        _options: unknown,
        task: (progress: { report(value: { message?: string; increment?: number }): void }) => Promise<T>
    ): Promise<T> => await task({
        report(value: { message?: string; increment?: number }) {
            progressEvents.push({ ...value });
        }
    });

    try {
        return await run(progressEvents);
    } finally {
        (vscode as any).window.withProgress = originalWithProgress;
    }
}
