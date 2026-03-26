import { t } from '../../i18n';
import { buildSkillPromptAppendix, normalizeEnabledSkills } from '../../config/aiSkills';
import { LocalProviderConfig } from '../openclawConfig';
import {
    Agent,
    ChatMessage,
    ChatSession,
    CreateAgentParams,
    LocalAgent,
    UpdateAgentParams
} from './types';

/**
 * Repository for managing local agent and chat session data.
 * Handles agent CRUD operations and chat session management in memory.
 */
export class LocalAgentSessionRepository {
    private agents: Map<string, LocalAgent> = new Map();
    private sessions: Map<string, ChatSession> = new Map();

    /**
     * Initializes the repository with provider configurations.
     * Creates agents for each model in the providers.
     * @param providers - Array of local provider configurations
     */
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
                    status: 'idle',
                    createdAt: now,
                    providerId: provider.id,
                    baseUrl: provider.baseUrl.replace(/\/$/, ''),
                    api: provider.api,
                    apiKey: provider.apiKey,
                    systemPrompt: 'You are OpenClaw inside VS Code. Help with coding tasks concisely.',
                    enabledSkills: []
                });
            }
        }
    }

    /**
     * Gets the count of registered agents.
     * @returns The number of agents
     */
    public getAgentCount(): number {
        return this.agents.size;
    }

    /**
     * Gets the count of active chat sessions.
     * @returns The number of sessions
     */
    public getSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * Gets the ID of the first available agent.
     * @returns The preferred agent ID or undefined if no agents exist
     */
    public getPreferredAgentId(): string | undefined {
        return this.agents.values().next().value?.id ?? undefined;
    }

    /**
     * Gets all registered agents.
     * @returns Array of agents
     */
    public getAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Gets a specific agent by ID.
     * @param agentId - The agent ID to look up
     * @returns The agent or undefined if not found
     */
    public getAgent(agentId: string): Agent | undefined {
        return this.agents.get(agentId) || undefined;
    }

    /**
     * Creates a new custom agent.
     * @param params - Agent creation parameters
     * @returns The created agent
     * @throws Error if no local provider exists
     */
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
            status: 'idle',
            systemPrompt: params.systemPrompt || templateAgent.systemPrompt,
            enabledSkills: normalizeEnabledSkills(params.enabledSkills),
            createdAt: new Date().toISOString()
        };

        this.agents.set(agent.id, agent);
        return agent;
    }

    /**
     * Updates an existing agent.
     * @param agentId - The ID of the agent to update
     * @param params - Update parameters
     * @returns The updated agent
     * @throws Error if agent not found
     */
    public updateAgent(agentId: string, params: UpdateAgentParams): LocalAgent {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(t('service.agentNotFound'));
        }

        const updatedAgent: LocalAgent = {
            ...agent,
            ...params,
            enabledSkills: params.enabledSkills !== undefined
                ? normalizeEnabledSkills(params.enabledSkills)
                : agent.enabledSkills
        };

        this.agents.set(agentId, updatedAgent);
        return updatedAgent;
    }

    /**
     * Deletes an agent and its associated sessions.
     * @param agentId - The ID of the agent to delete
     */
    public deleteAgent(agentId: string): void {
        this.agents.delete(agentId);
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.agentId === agentId) {
                this.sessions.delete(sessionId);
            }
        }
    }

    /**
     * Creates or retrieves a chat session for an agent.
     * @param agentId - The agent ID for the session
     * @param sessionId - Optional session ID to use
     * @returns The chat session
     * @throws Error if agent not found
     */
    public createChatSession(agentId: string, sessionId?: string): ChatSession {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(t('service.localAgentNotFound'));
        }

        const normalizedSessionId = String(sessionId || '').trim();
        if (normalizedSessionId) {
            const existingById = this.sessions.get(normalizedSessionId);
            if (existingById) {
                return existingById;
            }
        }

        for (const session of this.sessions.values()) {
            if (!normalizedSessionId && session.agentId === agentId) {
                return session;
            }
        }

        const now = new Date().toISOString();
        const session: ChatSession = {
            id: normalizedSessionId || `session:${Date.now()}`,
            agentId,
            messages: [],
            createdAt: now,
            updatedAt: now
        };

        this.sessions.set(session.id, session);
        return session;
    }

    /**
     * Gets the chat history for a session.
     * @param sessionId - The session ID
     * @returns Array of chat messages
     */
    public getChatHistory(sessionId: string): ChatMessage[] {
        return this.sessions.get(sessionId)?.messages || [];
    }

    /**
     * Clears all messages from a chat session.
     * @param sessionId - The session ID to clear
     */
    public clearChatHistory(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.messages = [];
            session.updatedAt = new Date().toISOString();
        }
    }

    /**
     * Gets a session or throws if not found.
     * @param sessionId - The session ID to look up
     * @returns The chat session
     * @throws Error if session not found
     */
    public requireSession(sessionId: string): ChatSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(t('service.chatSessionNotFound'));
        }

        return session;
    }

    /**
     * Gets a local agent or throws if not found or unsupported.
     * @param agentId - The agent ID to look up
     * @returns The local agent
     * @throws Error if agent not found or API unsupported
     */
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

    /**
     * Converts session and agent data to provider message format.
     * @param session - The chat session
     * @param agent - The local agent
     * @returns Array of provider-formatted messages
     */
    public toProviderMessages(
        session: ChatSession,
        agent: LocalAgent
    ): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [];

        const systemPrompt = `${agent.systemPrompt || ''}${buildSkillPromptAppendix(agent.enabledSkills)}`.trim();
        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt
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

    /**
     * Adds a message to a session and updates its timestamp.
     * @param session - The chat session
     * @param message - The message to add
     */
    public pushMessage(session: ChatSession, message: ChatMessage): void {
        session.messages.push(message);
        session.updatedAt = new Date().toISOString();
    }

    /**
     * Clears all agents and sessions.
     */
    public reset(): void {
        this.agents.clear();
        this.sessions.clear();
    }
}
