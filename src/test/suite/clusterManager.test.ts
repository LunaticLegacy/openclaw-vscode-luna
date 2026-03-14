import * as assert from 'assert/strict';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClusterManager } from '../../managers/clusterManager';
import type { OpenClawService } from '../../services/openclawService';
import type { Agent, ChatMessage, ChatSession } from '../../services/openclawService';

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
            const result = await manager.collaborateOnCluster(cluster.id, 'Design a safe service boundary.');

            assert.deepEqual(
                result.rounds.map(round => round.kind),
                ['opening', 'critique-1', 'revision-1', 'critique-2', 'revision-2']
            );
            assert.equal(result.coordinatorAgentId, 'alpha');
            assert.match(result.contributions.alpha.message?.content || '', /revision-2/i);
            assert.match(result.contributions.beta.message?.content || '', /revision-2/i);
            assert.match(result.synthesis?.message?.content || '', /final synthesis by alpha/i);

            const alphaDebateSessions = new Set(
                service.sentMessages
                    .filter(entry => entry.agentId === 'alpha' && entry.stage !== 'synthesis')
                    .map(entry => entry.sessionId)
            );
            const betaDebateSessions = new Set(
                service.sentMessages
                    .filter(entry => entry.agentId === 'beta' && entry.stage !== 'synthesis')
                    .map(entry => entry.sessionId)
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
            const result = await manager.collaborateOnCluster(cluster.id, 'Plan a staged migration.');
            const finalRevisionRound = result.rounds.find(round => round.kind === 'revision-2');

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

            const alphaSessionId = await manager.ensureClusterAgentSessionId(cluster.id, 'alpha');
            const sameAlphaSessionId = await manager.ensureClusterAgentSessionId(cluster.id, 'alpha');
            const resetAlphaSessionId = await manager.resetClusterAgentSessionId(cluster.id, 'alpha');

            assert.equal(alphaSessionId, sameAlphaSessionId);
            assert.notEqual(alphaSessionId, resetAlphaSessionId);

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                const persistedAlphaSessionId = await reloadedManager.ensureClusterAgentSessionId(cluster.id, 'alpha');
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

            await manager.replaceClusterAgentMessages(cluster.id, 'alpha', messages);
            assert.deepEqual(
                (await manager.getClusterAgentMessages(cluster.id, 'alpha')).map(toComparableMessage),
                messages.map(toComparableMessage)
            );

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                assert.deepEqual(
                    (await reloadedManager.getClusterAgentMessages(cluster.id, 'alpha')).map(toComparableMessage),
                    messages.map(toComparableMessage)
                );
                await reloadedManager.clearClusterAgentMessages(cluster.id, 'alpha');
                assert.deepEqual(await reloadedManager.getClusterAgentMessages(cluster.id, 'alpha'), []);
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

            await manager.collaborateOnCluster(cluster.id, 'Coordinate a release.');
            await manager.replaceClusterSwarmMessages(cluster.id, 'collaborate', swarmMessages);

            const persistedFile = JSON.parse(await fs.readFile(storagePath, 'utf8')) as {
                swarmSessions?: Record<string, string>;
            };
            assert.ok(
                Object.keys(persistedFile.swarmSessions || {}).some(key => key.includes(`${cluster.id}:swarm:collaborate:agent:alpha`)),
                'expected persisted swarm session ids to include the collaborate lane'
            );

            const reloadedManager = new ClusterManager(service as unknown as OpenClawService, storagePath);
            try {
                assert.deepEqual(
                    (await reloadedManager.getClusterSwarmMessages(cluster.id, 'collaborate')).map(toComparableMessage),
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

            await manager.collaborateOnCluster(cluster.id, 'Inspect the internal debate.');

            const alphaMessages = await manager.getClusterAgentSwarmMessages(cluster.id, 'alpha', 'collaborate');
            assert.ok(alphaMessages.some(message => message.role === 'user'));
            assert.ok(alphaMessages.some(message => /alpha/i.test(message.content)));
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

            const result = await manager.collaborateOnCluster(cluster.id, 'Design the swarm policy.');

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

            const result = await manager.collaborateOnCluster(cluster.id, 'Review the release risk before rollout.');

            assert.equal(result.coordinatorAgentId, 'beta');
            assert.deepEqual(
                service.sentMessages
                    .filter(entry => entry.stage === 'opening')
                    .map(entry => entry.agentId),
                ['alpha']
            );
            assert.equal(
                service.sentMessages.some(entry => entry.agentId === 'beta' && entry.stage === 'opening'),
                false
            );
            assert.equal(
                service.sentMessages.some(entry => entry.agentId === 'beta' && entry.stage === 'synthesis'),
                true
            );
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});

type DebateStage =
    | 'opening'
    | 'critique-1'
    | 'revision-1'
    | 'critique-2'
    | 'revision-2'
    | 'synthesis';

class FakeCollaborationService extends EventEmitter {
    public readonly sentMessages: Array<{
        agentId: string;
        sessionId: string;
        stage: DebateStage;
        prompt: string;
    }> = [];

    private readonly agents = new Map<string, Agent>();
    private readonly sessionAgentIds = new Map<string, string>();
    private readonly sessionMessages = new Map<string, ChatMessage[]>();
    private sessionCounter = 0;

    constructor(
        private readonly failures: Array<{
            agentId: string;
            stage: DebateStage;
        }> = []
    ) {
        super();

        for (const agentId of ['alpha', 'beta']) {
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

        if (this.failures.some(rule => rule.agentId === agentId && rule.stage === stage)) {
            throw new Error(`${agentId} failed during ${stage}`);
        }

        const response: ChatMessage = {
            id: `message-${this.sentMessages.length}`,
            role: 'assistant',
            content: buildFakeResponse(agentId, stage),
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
        this.sessionMessages.set(sessionId, history);
        return response;
    }

    public async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return [...(this.sessionMessages.get(sessionId) || [])];
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        return this.agents.get(agentId) || null;
    }

    public findPrompt(agentId: string, stage: DebateStage): string {
        const entry = this.sentMessages.find(message => message.agentId === agentId && message.stage === stage);
        assert.ok(entry, `Expected a ${stage} prompt for ${agentId}`);
        return entry?.prompt || '';
    }
}

function detectDebateStage(prompt: string): DebateStage {
    if (prompt.includes('Debate stage: opening')) {
        return 'opening';
    }

    if (prompt.includes('Debate stage: critique round 1')) {
        return 'critique-1';
    }

    if (prompt.includes('Debate stage: revision round 1')) {
        return 'revision-1';
    }

    if (prompt.includes('Debate stage: critique round 2')) {
        return 'critique-2';
    }

    if (prompt.includes('Debate stage: revision round 2')) {
        return 'revision-2';
    }

    return 'synthesis';
}

function buildFakeResponse(agentId: string, stage: DebateStage): string {
    switch (stage) {
        case 'opening':
            return `Opening from ${agentId}\nPosition: ${agentId} opening.`;
        case 'critique-1':
            return `Critique 1 from ${agentId}\nReview verdict: ${agentId} critique round 1.`;
        case 'revision-1':
            return `Revision 1 from ${agentId}\nRevised position: ${agentId} revision-1.`;
        case 'critique-2':
            return `Critique 2 from ${agentId}\nReview verdict: ${agentId} critique round 2.`;
        case 'revision-2':
            return `Final revision 2 from ${agentId}\nRevised position: ${agentId} revision-2.`;
        case 'synthesis':
            return `Final synthesis by ${agentId}`;
        default:
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
