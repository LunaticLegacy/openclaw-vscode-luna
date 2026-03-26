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
    BroadcastClusterRequest,
    ClusterAgentMessagesRequest,
    ClusterAgentRequest,
    ClusterAgentSwarmMessagesRequest,
    ClusterAgentSwarmRequest,
    ClusterSwarmMessagesRequest,
    ClusterSwarmRequest,
    ClusterCollaborationProgressEvent,
    ClusterCollaborationRoundDescriptor,
    ClusterSwarmRunSummary,
    CollaborateClusterRequest,
    CreateClusterParams,
    UpdateClusterRequest
} from '../../managers/clusterManager';
import type { CreateAgentParams } from '../../services/openclawService';
import type { CapturedProgressRun, GetOrCreateSessionOptions, ProgressReport, ProgressReporter, WithProgressTask } from '../../types/test';

suite('clusterActions', () => {
    test('loads persisted swarm messages when entering swarm mode', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('persisted-swarm-1', 'assistant', 'persisted swarm reply')
        ];
        await clusterManager.replaceClusterSwarmMessages({
            clusterId: 'cluster-1',
            mode: 'collaborate',
            messages: persistedMessages
        });

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate');

        const replaceMessage = posted.find((message: any) => message.type === 'replaceSwarmMessages');
        assert.deepEqual(replaceMessage?.messages, persistedMessages);
        assert.deepEqual(replaceMessage?.knownRunIds, ['default']);
        assert.equal(clusterManager.getClusterSwarmSessionMessagesCalls.length, 1);
        assert.equal(clusterManager.rehydrateClusterSwarmMessagesCalls.length, 0);
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
        await clusterManager.replaceClusterAgentSwarmMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            mode: 'collaborate',
            messages: [{
                ...createMessage('alpha-raw', 'user', 'alpha raw prompt'),
                timestamp: '2026-03-12T00:00:01.000Z',
                agentId: 'alpha',
                metadata: {
                    swarmPhase: 'opening',
                    swarmLogKind: 'outbound-prompt'
                }
            }]
        });
        await clusterManager.replaceClusterAgentSwarmMessages({
            clusterId: 'cluster-1',
            agentId: 'beta',
            mode: 'collaborate',
            messages: [{
                ...createMessage('beta-raw', 'assistant', 'beta raw reply'),
                timestamp: '2026-03-12T00:00:02.000Z',
                agentId: 'beta',
                metadata: {
                    swarmPhase: 'opening',
                    swarmLogKind: 'inbound-final'
                }
            }]
        });

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate', 'raw');

        const replaceMessage = posted.find((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.outputMode === 'raw'
        );
        assert.ok(replaceMessage);
        assert.deepEqual(
            (replaceMessage?.messages as ChatMessage[]).map((message: any) => message.content),
            ['alpha raw prompt', 'beta raw reply']
        );
    });

    test('loads a specific prior swarm run without replacing it with the latest run', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterSwarmMessages({
            clusterId: 'cluster-1',
            mode: 'collaborate',
            messages: [createMessage('run-1-msg', 'assistant', 'older swarm run')],
            swarmRunId: 'run-1'
        });
        await clusterManager.replaceClusterSwarmMessages({
            clusterId: 'cluster-1',
            mode: 'collaborate',
            messages: [createMessage('run-2-msg', 'assistant', 'latest swarm run')],
            swarmRunId: 'run-2'
        });

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate', 'frontend', 'run-1');

        const replaceMessage = posted.find((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.swarmRunId === 'run-1'
            && message.outputMode === 'frontend'
        );
        assert.ok(replaceMessage);
        assert.deepEqual(
            (replaceMessage?.messages as ChatMessage[]).map((message: any) => message.content),
            ['older swarm run']
        );
    });

    test('backfills swarm source labels when persisted frontend messages only retain agent metadata', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterSwarmMessages({
            clusterId: 'cluster-1',
            mode: 'collaborate',
            messages: [{
                ...createMessage('persisted-collab-1', 'assistant', 'reloaded collaborate reply'),
                agentId: 'beta',
                metadata: {
                    swarmSourceAgentId: 'beta'
                }
            }]
        });

        await loadClusterSwarmMessages(context, 'cluster-1', 'collaborate');

        const replaceMessage = posted.find((message: any) => message.type === 'replaceSwarmMessages');
        assert.equal((replaceMessage?.messages as ChatMessage[])[0]?.displayName, 'Beta (model-b)');
        assert.equal((replaceMessage?.messages as ChatMessage[])[0]?.contextLabel, 'Collaborate');
    });

    test('loads persisted cluster-agent messages when runtime history is empty', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('persisted-1', 'assistant', 'persisted reply')
        ];
        await clusterManager.replaceClusterAgentMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            messages: persistedMessages
        });
        sessionManager.refreshResults.set('session-1', []);

        await loadClusterAgentMessages(context, 'cluster-1', 'alpha');

        const replaceMessage = posted.find((message: any) => message.type === 'replaceClusterMessages');
        assert.deepEqual(replaceMessage?.messages, persistedMessages);
        assert.deepEqual(clusterManager.replaceCalls[clusterManager.replaceCalls.length - 1]?.messages, persistedMessages);
    });

    test('does not rewrite persisted cluster-agent messages when refreshed history is unchanged', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        const persistedMessages: ChatMessage[] = [
            createMessage('persisted-1', 'assistant', 'persisted reply')
        ];
        await clusterManager.replaceClusterAgentMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            messages: persistedMessages
        });
        const replaceCountBeforeLoad = clusterManager.replaceCalls.length;
        sessionManager.refreshResults.set('session-1', persistedMessages);

        await loadClusterAgentMessages(context, 'cluster-1', 'alpha');

        assert.equal(clusterManager.replaceCalls.length, replaceCountBeforeLoad);
        assert.ok(posted.some((message: any) =>
            message.type === 'replaceClusterMessages'
            && Array.isArray(message.messages)
            && message.messages[0]?.content === 'persisted reply'
        ));
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
        await clusterManager.replaceClusterAgentSwarmMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            mode: 'collaborate',
            messages: persistedMessages
        });

        await loadClusterAgentSwarmMessages(context, 'cluster-1', 'alpha', 'collaborate');

        const replaceMessage = posted.find((message: any) => message.type === 'replaceClusterAgentSwarmMessages');
        assert.deepEqual(replaceMessage?.messages, [
            { ...persistedMessages[0], contextLabel: 'Collaborate Log' },
            { ...persistedMessages[1], contextLabel: 'Collaborate Log' }
        ]);
        assert.equal(clusterManager.getClusterAgentSwarmSessionMessagesCalls.length, 1);
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
        assert.ok(posted.some((message: any) => message.type === 'appendClusterMessage'));
        assert.ok(posted.some((message: any) => message.type === 'replaceClusterMessages'));
    });

    test('clear resets persisted cluster-agent messages and rotates session when runtime clear is unsupported', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterAgentMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            messages: [createMessage('msg-1', 'assistant', 'existing reply')]
        });
        sessionManager.refreshResults.set('session-1', [
            createMessage('msg-2', 'assistant', 'still present after clear')
        ]);

        await handleClusterAgentSessionCommand(context, 'cluster-1', 'alpha', 'clear');

        assert.equal(clusterManager.sessionId, 'session-2');
        assert.ok(clusterManager.clearCalls.length >= 1);
        assert.deepEqual(await clusterManager.getClusterAgentMessages({ clusterId: 'cluster-1', agentId: 'alpha' }), []);
        assert.ok(posted.some((message: any) =>
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

        await clusterManager.replaceClusterAgentMessages({
            clusterId: 'cluster-1',
            agentId: 'alpha',
            messages: [createMessage('msg-1', 'assistant', 'existing reply')]
        });

        await handleClusterAgentSessionCommand(context, 'cluster-1', 'alpha', 'new');

        assert.equal(clusterManager.sessionId, 'session-2');
        assert.equal(clusterManager.clearCalls.length, 1);
        assert.deepEqual(await clusterManager.getClusterAgentMessages({ clusterId: 'cluster-1', agentId: 'alpha' }), []);
        assert.ok(posted.some((message: any) =>
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

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.equal(persisted[0]?.role, 'user');
        assert.equal(persisted[0]?.content, 'plan this');
        assert.ok(persisted.some((message: any) => message.content === 'final synthesis'));
        const batchIds = new Set(
            persisted
                .map((message: any) => String(message.metadata?.swarmBatchId || ''))
                .filter(Boolean)
        );
        assert.equal(batchIds.size, 1);
        assert.ok(posted.some((message: any) => message.type === 'appendSwarmMessages'));
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

        assert.ok(posted.some((message: any) =>
            message.type === 'appendSwarmMessages'
            && message.keepPending === true
        ));
        assert.ok(posted.some((message: any) =>
            message.type === 'appendSwarmMessages'
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'opening reply')
        ));
        assert.ok(posted.some((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.outputMode === 'raw'
        ));
        assert.ok(posted.some((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.keepPending === false
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'final synthesis')
        ));
    });

    test('posts raw collaborate swarm log updates from agent transcripts during progress', async () => {
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
        clusterManager.beforeProgressEmitted = async (_index: number, event: ClusterCollaborationProgressEvent) => {
            await clusterManager.replaceClusterAgentSwarmMessages({
                clusterId: 'cluster-1',
                agentId: 'alpha',
                mode: 'collaborate',
                swarmRunId: event.swarmRunId,
                messages: [{
                    ...createMessage('alpha-raw-progress', 'assistant', 'alpha raw progress'),
                    timestamp: '2026-03-12T00:00:01.000Z',
                    agentId: 'alpha',
                    metadata: {
                        swarmPhase: 'opening',
                        swarmLogKind: 'inbound-final'
                    }
                }]
            });
        };
        clusterManager.progressEvents = [{
            kind: 'round-entry',
            swarmRunId: 'fake-run-raw-progress',
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
            swarmRunId: 'fake-run-raw-progress',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [],
            contributions: {},
            synthesis: undefined
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        assert.ok(posted.some((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.outputMode === 'raw'
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'alpha raw progress')
        ));
    });

    test('includes nested collaborate member replies in the frontend swarm conversation', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        clusterManager.cluster = {
            id: 'cluster-1',
            name: 'Swarm',
            agentIds: ['alpha', 'beta'],
            status: 'active',
            createdAt: '2026-03-12T00:00:00.000Z',
            workspaceConfig: {
                memberProfiles: {
                    beta: {
                        parentAgentId: 'alpha'
                    }
                }
            } as never
        };
        clusterManager.progressEvents = [{
            kind: 'round-entry',
            swarmRunId: 'fake-run-collab-nested',
            roundKind: 'opening',
            round: createRoundDescriptor('opening'),
            agentId: 'beta',
            entry: {
                agentId: 'beta',
                ok: true,
                message: {
                    ...createMessage('beta-opening', 'assistant', 'beta nested reply'),
                    agentId: 'beta'
                }
            }
        }];
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-nested',
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
                descriptor: createRoundDescriptor('opening'),
                entries: {
                    beta: {
                        agentId: 'beta',
                        ok: true,
                        message: {
                            ...createMessage('beta-opening', 'assistant', 'beta nested reply'),
                            agentId: 'beta'
                        }
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

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.equal(persisted.some((message: any) => message.content === 'beta nested reply'), true);
    });

    test('surfaces cluster members without collaborate output in the frontend swarm conversation', async () => {
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
            swarmRunId: 'fake-run-collab-missing-agent',
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
                        message: createMessage('alpha-opening', 'assistant', 'alpha opening reply')
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

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.equal(
            persisted.some((message: any) =>
                message.displayName === 'Beta (model-b)'
                && message.content === 'No collaborate output was captured for this agent in this run.'
            ),
            true
        );
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

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.equal(
            persisted.filter((message: any) =>
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
            synthesis: undefined
        };

        const ok = await handleCollaborate(context, 'cluster-1', 'plan this');

        assert.equal(ok, false);
        assert.ok(posted.some((message: any) => message.type === 'clusterRunFailed' && message.mode === 'collaborate'));
        assert.ok(posted.some((message: any) =>
            message.type === 'error'
            && String(message.message || '').includes('Gateway permission error')
        ));
        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.equal(persisted.some((message: any) => message.content === 'missing scope: operator.write'), false);
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
            synthesis: undefined
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        const alphaOpening = persisted.find((message: any) => message.id === 'alpha-opening');
        assert.ok(alphaOpening);
        assert.ok(Array.isArray(alphaOpening?.parts));
        assert.equal(alphaOpening?.parts?.some((part: any) => part.type === 'thinking'), true);
    });

    test('starts a new swarm run with a clean progress view instead of prefixing old aggregate messages', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await clusterManager.replaceClusterSwarmMessages({
            clusterId: 'cluster-1',
            mode: 'collaborate',
            messages: [createMessage('old-1', 'assistant', 'old pending reply')]
        });
        clusterManager.replaceSwarmCalls.length = 0;
        clusterManager.collaborationResult = {
            swarmRunId: 'fake-run-collab-3',
            clusterId: 'cluster-1',
            clusterName: 'Cluster 1',
            userMessage: 'fresh plan',
            coordinatorAgentId: 'alpha',
            rounds: [],
            contributions: {},
            synthesis: undefined
        };

        await handleCollaborate(context, 'cluster-1', 'fresh plan');

        assert.equal(clusterManager.replaceSwarmCalls.length > 0, true);
        assert.deepEqual(
            clusterManager.replaceSwarmCalls[0]?.messages.map((message: any) => message.content),
            ['fresh plan']
        );
        assert.equal(
            clusterManager.replaceSwarmCalls[0]?.messages.some((message: any) => message.content === 'old pending reply'),
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
        clusterManager.onProgressEmitted = async (index: any) => {
            if (index === 0) {
                (context as any).__setClusterSwarmRunToken(2);
            }
        };

        await handleCollaborate(context, 'cluster-1', 'plan this');

        const persisted = await clusterManager.getClusterSwarmMessages({ clusterId: 'cluster-1', mode: 'collaborate' });
        assert.deepEqual(
            persisted.map((message: any) => message.content),
            ['plan this', 'opening reply alpha']
        );
        assert.equal(persisted.some((message: any) => message.content === 'opening reply beta'), false);
        assert.equal(persisted.some((message: any) => message.content === 'final synthesis'), false);
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

        assert.ok(posted.some((message: any) =>
            message.type === 'replaceSwarmMessages'
            && message.keepPending === false
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'Actual final answer')
        ));
        assert.ok(posted.some((message: any) =>
            message.type === 'appendSwarmMessages'
            && Array.isArray(message.messages)
            && message.messages.some((entry: any) => entry.content === 'Actual final answer')
        ));
    });

    test('creates new agents before saving a cluster when quick-create members are provided', async () => {
        const clusterManager = new FakeClusterManager();
        const sessionManager = new FakeClusterSessionManager();
        const posted: Array<Record<string, unknown>> = [];
        const context = createClusterActionContext(clusterManager, sessionManager, posted);

        await withCapturedProgress(async (progressEvents: any) => {
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
                    .map((event: any) => event.message)
                    .filter((message: any): message is string => Boolean(message)),
                [
                    'Creating cluster member 1/1: Gamma...',
                    'Creating cluster record...',
                    'Refreshing agents...',
                    'Refreshing clusters...'
                ]
            );
            assert.ok(progressEvents.some((event: any) => typeof event.increment === 'number' && event.increment > 0));
        });

        assert.deepEqual(context.__createdAgents.map((agent: any) => agent.name), ['Gamma']);
        assert.deepEqual(clusterManager.cluster.agentIds, ['alpha', 'gamma']);
        assert.equal(context.__metrics.loadAgentsCalls, 1);
        assert.deepEqual(context.__metrics.loadClustersCalls, ['cluster-created']);
        assert.ok(posted.some((message: any) => message.type === 'clusterSaved'));
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
    public getClusterSwarmSessionMessagesCalls: ClusterSwarmRequest[] = [];
    public getClusterAgentSwarmSessionMessagesCalls: ClusterAgentSwarmRequest[] = [];
    public rehydrateClusterSwarmMessagesCalls: ClusterSwarmRequest[] = [];
    public cluster: AgentCluster = {
        id: 'cluster-1',
        name: 'Cluster 1',
        agentIds: ['alpha'],
        status: 'active',
        createdAt: '2026-03-12T00:00:00.000Z'
    };
    public collaborationResult: any = undefined;
    public broadcastResult: Record<string, any> = {};
    public progressEvents: ClusterCollaborationProgressEvent[] = [];
    public beforeProgressEmitted?: (index: number, event: ClusterCollaborationProgressEvent) => Promise<void> | void;
    public onProgressEmitted?: (index: number, event: ClusterCollaborationProgressEvent) => Promise<void> | void;
    public clusterList: AgentCluster[] = [];
    private readonly messagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmMessagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmAgentMessagesByKey = new Map<string, ChatMessage[]>();
    private readonly latestSwarmRunByKey = new Map<string, string>();
    private sessionCounter = 1;

    public async ensureClusterAgentSessionId(_request: ClusterAgentRequest): Promise<string> {
        return this.sessionId;
    }

    public async resetClusterAgentSessionId(_request: ClusterAgentRequest): Promise<string> {
        this.sessionCounter += 1;
        this.sessionId = `session-${this.sessionCounter}`;
        return this.sessionId;
    }

    public async getClusterAgentMessages({ clusterId, agentId }: ClusterAgentRequest): Promise<ChatMessage[]> {
        return cloneMessages(this.messagesByKey.get(this.key(clusterId, agentId)) || []);
    }

    public async replaceClusterAgentMessages({
        clusterId,
        agentId,
        messages
    }: ClusterAgentMessagesRequest): Promise<void> {
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

    public async clearClusterAgentMessages({ clusterId, agentId }: ClusterAgentRequest): Promise<void> {
        this.clearCalls.push({ clusterId, agentId });
        this.messagesByKey.delete(this.key(clusterId, agentId));
    }

    public async getClusterSwarmMessages({
        clusterId,
        mode,
        swarmRunId
    }: ClusterSwarmRequest): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmMessagesByKey.get(this.swarmKey(clusterId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId))) || []);
    }

    public async getClusterSwarmSessionMessages({
        clusterId,
        mode,
        swarmRunId
    }: ClusterSwarmRequest): Promise<ChatMessage[]> {
        this.getClusterSwarmSessionMessagesCalls.push({ clusterId, mode, swarmRunId });
        return this.getClusterSwarmMessages({ clusterId, mode, swarmRunId });
    }

    public async rehydrateClusterSwarmMessages(request: ClusterSwarmRequest): Promise<void> {
        this.rehydrateClusterSwarmMessagesCalls.push(request);
        return;
    }

    public async listClusterSwarmRunIds({
        clusterId,
        mode
    }: ClusterSwarmRequest): Promise<string[]> {
        return (await this.listClusterSwarmRuns({ clusterId, mode })).map((summary: any) => summary.runId);
    }

    public async listClusterSwarmRuns({
        clusterId,
        mode
    }: ClusterSwarmRequest): Promise<ClusterSwarmRunSummary[]> {
        const registryKey = this.swarmRunRegistryKey(clusterId, mode);
        const known = new Set<string>();
        const latest = this.latestSwarmRunByKey.get(registryKey);
        if (latest) {
            known.add(latest);
        }

        for (const key of this.swarmMessagesByKey.keys()) {
            const prefix = `${clusterId}::swarm::${mode}::`;
            if (!key.startsWith(prefix)) {
                continue;
            }
            known.add(key.slice(prefix.length) || 'default');
        }

        return Array.from(known.values()).map((runId: any, index: number) => ({
            runId,
            clusterId,
            mode,
            status: index === 0 ? 'running' : 'completed',
            phase: mode === 'broadcast' ? 'broadcast' : 'opening',
            currentRound: 1,
            startedAt: `2026-03-26T00:0${index}:00.000Z`,
            isActive: index === 0
        }));
    }

    public async getClusterAgentSwarmMessages(
        {
            clusterId,
            agentId,
            mode,
            swarmRunId
        }: ClusterAgentSwarmRequest
    ): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmAgentMessagesByKey.get(this.swarmAgentKey(clusterId, agentId, mode, this.resolveSwarmRunId(clusterId, mode, swarmRunId))) || []);
    }

    public async getClusterAgentSwarmSessionMessages(
        {
            clusterId,
            agentId,
            mode,
            swarmRunId
        }: ClusterAgentSwarmRequest
    ): Promise<ChatMessage[]> {
        this.getClusterAgentSwarmSessionMessagesCalls.push({ clusterId, agentId, mode, swarmRunId });
        return this.getClusterAgentSwarmMessages({ clusterId, agentId, mode, swarmRunId });
    }

    public async replaceClusterSwarmMessages(
        {
            clusterId,
            mode,
            messages,
            swarmRunId
        }: ClusterSwarmMessagesRequest
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
        {
            clusterId,
            agentId,
            mode,
            messages,
            swarmRunId
        }: ClusterAgentSwarmMessagesRequest
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

    public async getCluster(clusterId: string): Promise<AgentCluster | undefined> {
        return this.cluster?.id === clusterId ? { ...this.cluster } : undefined;
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
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

    public async updateCluster({ clusterId, ...params }: UpdateClusterRequest): Promise<AgentCluster> {
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
        return this.clusterList.length > 0 ? this.clusterList.map((cluster: any) => ({ ...cluster })) : [{ ...this.cluster }];
    }

    public async collaborateOnCluster({ clusterId: _clusterId, message: _message, options }: CollaborateClusterRequest): Promise<any> {
        for (const [index, event] of this.progressEvents.entries()) {
            const resolvedEvent = {
                ...event,
                swarmRunId: options?.swarmRunId || event.swarmRunId
            };
            await this.beforeProgressEmitted?.(index, resolvedEvent);
            await options?.onProgress?.(resolvedEvent);
            await this.onProgressEmitted?.(index, resolvedEvent);
        }
        return {
            swarmRunId: options?.swarmRunId || 'fake-run',
            ...this.collaborationResult
        };
    }

    public async broadcastToCluster(_request: BroadcastClusterRequest): Promise<Record<string, any>> {
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
    private currentSessionId: string | undefined = undefined;

    public async getOrCreateSession(
        agentId: string,
        options: GetOrCreateSessionOptions = {}
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
            createAgent: async (params: CreateAgentParams) => {
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
                const index = createdAgents.findIndex((agent: any) => agent.id === agentId);
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
        getCurrentAgentId: () => undefined,
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
    return messages.map((message: any) => ({ ...message }));
}

async function withCapturedProgress<T>(run: CapturedProgressRun<T>): Promise<T> {
    const originalWithProgress = (vscode as any).window.withProgress;
    const progressEvents: ProgressReport[] = [];

    (vscode as any).window.withProgress = async (
        _options: unknown,
        task: WithProgressTask<T>
    ): Promise<T> => {
        const reporter: ProgressReporter = {
            report(value: ProgressReport) {
                progressEvents.push({ ...value });
            }
        };
        return await task(reporter);
    };

    try {
        return await run(progressEvents);
    } finally {
        (vscode as any).window.withProgress = originalWithProgress;
    }
}
