import * as assert from 'assert/strict';
import { ChatSessionManager } from '../../managers/chatSessionManager';
import type { ChatMessage, ChatSession, OpenClawService } from '../../services/openclawService';

suite('chatSessionManager', () => {
    test('ignores a requested session id when it belongs to another agent', async () => {
        const service = new FakeOpenClawService();
        const manager = new ChatSessionManager(service as unknown as OpenClawService);

        const alphaSession = await manager.createSession('alpha');
        const betaSession = await manager.getOrCreateSession('beta', {
            sessionId: alphaSession.id
        });

        assert.notEqual(betaSession.id, alphaSession.id);
        assert.equal(betaSession.agentId, 'beta');
    });
});

class FakeOpenClawService {
    private sessionCounter = 0;

    public async createChatSession(agentId: string): Promise<ChatSession> {
        this.sessionCounter += 1;
        return {
            id: `session-${this.sessionCounter}`,
            agentId,
            messages: [],
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T00:00:00.000Z'
        };
    }

    public async getChatHistory(): Promise<ChatMessage[]> {
        return [];
    }
}
