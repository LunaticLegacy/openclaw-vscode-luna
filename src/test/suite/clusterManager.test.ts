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
            } finally {
                reloadedManager.dispose();
            }
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
