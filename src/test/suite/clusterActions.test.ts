import * as assert from 'assert/strict';
import {
    handleCollaborate,
    handleClusterAgentMessage,
    handleClusterAgentSessionCommand,
    loadClusterAgentMessages,
    loadClusterAgentSwarmMessages,
    loadClusterSwarmMessages
} from '../../panels/openclawPanel/clusterActions';
import type { Agent, AgentCluster, ChatMessage, ChatSession } from '../../services/openclawService';
import type { ClusterCollaborationProgressEvent } from '../../managers/clusterManager';

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
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
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
            roundKind: 'opening',
            agentId: 'alpha',
            entry: {
                agentId: 'alpha',
                ok: true,
                message: createMessage('alpha-opening', 'assistant', 'opening reply')
            }
        }];
        clusterManager.collaborationResult = {
            clusterId: 'cluster-1',
            clusterName: 'Swarm',
            userMessage: 'plan this',
            coordinatorAgentId: 'alpha',
            rounds: [{
                kind: 'opening',
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
});

class FakeClusterManager {
    public sessionId = 'session-1';
    public replaceCalls: Array<{ clusterId: string; agentId: string; messages: ChatMessage[] }> = [];
    public clearCalls: Array<{ clusterId: string; agentId: string }> = [];
    public replaceSwarmCalls: Array<{ clusterId: string; mode: 'broadcast' | 'collaborate'; messages: ChatMessage[] }> = [];
    public replaceAgentSwarmCalls: Array<{ clusterId: string; agentId: string; mode: 'broadcast' | 'collaborate'; messages: ChatMessage[] }> = [];
    public cluster: AgentCluster = {
        id: 'cluster-1',
        name: 'Cluster 1',
        agentIds: ['alpha'],
        status: 'active',
        createdAt: '2026-03-12T00:00:00.000Z'
    };
    public collaborationResult: any = null;
    public progressEvents: ClusterCollaborationProgressEvent[] = [];
    private readonly messagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmMessagesByKey = new Map<string, ChatMessage[]>();
    private readonly swarmAgentMessagesByKey = new Map<string, ChatMessage[]>();
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

    public async getClusterSwarmMessages(clusterId: string, mode: 'broadcast' | 'collaborate'): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmMessagesByKey.get(this.swarmKey(clusterId, mode)) || []);
    }

    public async getClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate'
    ): Promise<ChatMessage[]> {
        return cloneMessages(this.swarmAgentMessagesByKey.get(this.swarmAgentKey(clusterId, agentId, mode)) || []);
    }

    public async replaceClusterSwarmMessages(
        clusterId: string,
        mode: 'broadcast' | 'collaborate',
        messages: ChatMessage[]
    ): Promise<void> {
        this.replaceSwarmCalls.push({
            clusterId,
            mode,
            messages: cloneMessages(messages)
        });

        if (messages.length > 0) {
            this.swarmMessagesByKey.set(this.swarmKey(clusterId, mode), cloneMessages(messages));
        } else {
            this.swarmMessagesByKey.delete(this.swarmKey(clusterId, mode));
        }
    }

    public async replaceClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate',
        messages: ChatMessage[]
    ): Promise<void> {
        this.replaceAgentSwarmCalls.push({
            clusterId,
            agentId,
            mode,
            messages: cloneMessages(messages)
        });

        if (messages.length > 0) {
            this.swarmAgentMessagesByKey.set(this.swarmAgentKey(clusterId, agentId, mode), cloneMessages(messages));
        } else {
            this.swarmAgentMessagesByKey.delete(this.swarmAgentKey(clusterId, agentId, mode));
        }
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        return this.cluster?.id === clusterId ? { ...this.cluster } : null;
    }

    public async collaborateOnCluster(_clusterId?: string, _message?: string, options?: {
        onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
    }): Promise<any> {
        for (const event of this.progressEvents) {
            await options?.onProgress?.(event);
        }
        return this.collaborationResult;
    }

    private key(clusterId: string, agentId: string): string {
        return `${clusterId}::${agentId}`;
    }

    private swarmKey(clusterId: string, mode: 'broadcast' | 'collaborate'): string {
        return `${clusterId}::swarm::${mode}`;
    }

    private swarmAgentKey(clusterId: string, agentId: string, mode: 'broadcast' | 'collaborate'): string {
        return `${clusterId}::agent::${agentId}::${mode}`;
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
    let clusterAgentRunToken = 0;

    return {
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
            ]
        } as never,
        clusterSessionManager,
        postMessage: (message: Record<string, unknown>) => {
            posted.push(message);
        },
        loadClusters: async () => undefined,
        showClusterView: () => undefined,
        getCurrentAgentId: () => null,
        beginAgentRun: () => true,
        endAgentRun: () => true,
        nextClusterSwarmRunToken: () => 1,
        getClusterSwarmRunToken: () => 1,
        nextClusterAgentRunToken: () => {
            clusterAgentRunToken += 1;
            return clusterAgentRunToken;
        },
        getClusterAgentRunToken: () => clusterAgentRunToken
    } as unknown as Parameters<typeof loadClusterAgentMessages>[0];
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

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(message => ({ ...message }));
}
