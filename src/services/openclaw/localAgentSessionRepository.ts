import { t } from '../../i18n';
import { LocalProviderConfig } from '../openclawConfig';
import {
    Agent,
    ChatMessage,
    ChatSession,
    CreateAgentParams,
    LocalAgent,
    UpdateAgentParams
} from './types';

export class LocalAgentSessionRepository {
    private agents: Map<string, LocalAgent> = new Map();
    private sessions: Map<string, ChatSession> = new Map();

    public initialize(providers: LocalProviderConfig[]): void {
        this.agents.clear();
        this.sessions.clear();

        const now = new Date().toISOString();
        for (const provider of providers) {
            for (const model of provider.models) {
                const agentId = `local:${provider.id}:${model.id}`;
                this.agents.set(agentId, {
                    id: agentId,
                    name: model.name,
                    model: model.id,
                    status: 'active',
                    createdAt: now,
                    providerId: provider.id,
                    baseUrl: provider.baseUrl.replace(/\/$/, ''),
                    api: provider.api,
                    apiKey: provider.apiKey,
                    systemPrompt: 'You are OpenClaw inside VS Code. Help with coding tasks concisely.'
                });
            }
        }
    }

    public getAgentCount(): number {
        return this.agents.size;
    }

    public getSessionCount(): number {
        return this.sessions.size;
    }

    public getPreferredAgentId(): string | null {
        return this.agents.values().next().value?.id ?? null;
    }

    public getAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    public getAgent(agentId: string): Agent | null {
        return this.agents.get(agentId) || null;
    }

    public createAgent(params: CreateAgentParams): LocalAgent {
        const templateAgent = Array.from(this.agents.values())[0];
        if (!templateAgent) {
            throw new Error(t('service.noLocalProvider'));
        }

        const agent: LocalAgent = {
            ...templateAgent,
            id: `local:custom:${Date.now()}`,
            name: params.name,
            model: params.model,
            systemPrompt: params.systemPrompt || templateAgent.systemPrompt,
            createdAt: new Date().toISOString()
        };

        this.agents.set(agent.id, agent);
        return agent;
    }

    public updateAgent(agentId: string, params: UpdateAgentParams): LocalAgent {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(t('service.agentNotFound'));
        }

        const updatedAgent: LocalAgent = {
            ...agent,
            ...params
        };

        this.agents.set(agentId, updatedAgent);
        return updatedAgent;
    }

    public deleteAgent(agentId: string): void {
        this.agents.delete(agentId);
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.agentId === agentId) {
                this.sessions.delete(sessionId);
            }
        }
    }

    public createChatSession(agentId: string): ChatSession {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(t('service.localAgentNotFound'));
        }

        for (const session of this.sessions.values()) {
            if (session.agentId === agentId) {
                return session;
            }
        }

        const now = new Date().toISOString();
        const session: ChatSession = {
            id: `session:${Date.now()}`,
            agentId,
            messages: [],
            createdAt: now,
            updatedAt: now
        };

        this.sessions.set(session.id, session);
        return session;
    }

    public getChatHistory(sessionId: string): ChatMessage[] {
        return this.sessions.get(sessionId)?.messages || [];
    }

    public clearChatHistory(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.messages = [];
            session.updatedAt = new Date().toISOString();
        }
    }

    public requireSession(sessionId: string): ChatSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(t('service.chatSessionNotFound'));
        }

        return session;
    }

    public requireAgent(agentId: string): LocalAgent {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(t('service.agentNotFound'));
        }

        if (agent.api !== 'openai-completions') {
            throw new Error(t('service.providerApiUnsupported', { api: agent.api }));
        }

        return agent;
    }

    public toProviderMessages(
        session: ChatSession,
        agent: LocalAgent
    ): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [];

        if (agent.systemPrompt) {
            messages.push({
                role: 'system',
                content: agent.systemPrompt
            });
        }

        for (const message of session.messages) {
            if (message.role === 'tool') {
                continue;
            }

            messages.push({
                role: message.role,
                content: message.content
            });
        }

        return messages;
    }

    public pushMessage(session: ChatSession, message: ChatMessage): void {
        session.messages.push(message);
        session.updatedAt = new Date().toISOString();
    }

    public reset(): void {
        this.agents.clear();
        this.sessions.clear();
    }
}
