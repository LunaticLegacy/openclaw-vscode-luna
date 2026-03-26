import axios from 'axios';
import { t } from '../../i18n';
import { LocalServiceConfig } from '../openclawConfig';
import { extractAssistantText } from './helpers';
import { LocalAgentSessionRepository } from './localAgentSessionRepository';
import {
    cloneUsage,
    LocalUsageService,
    uniqueModelNames
} from './usageService';
import {
    Agent,
    APIUsage,
    ChatMessage,
    ChatSession,
    CreateChatSessionOptions,
    CreateAgentParams,
    LocalAgent,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    ServiceEventSink,
    StreamChunk,
    StreamMessageOptions,
    UpdateAgentParams
} from './types';

/**
 * Runtime implementation for local mode operation.
 * Manages local agents, chat sessions, and communication with local LLM providers.
 */
export class LocalModeRuntime {
    private readonly repository = new LocalAgentSessionRepository();
    private readonly usageService = new LocalUsageService();
    private readonly activeRequests = new Map<string, Set<AbortController>>();

    /**
     * Creates a new LocalModeRuntime instance.
     * @param config - Local service configuration
     * @param emitEvent - Event sink for service events
     */
    constructor(
        private readonly config: LocalServiceConfig,
        private readonly emitEvent: ServiceEventSink
    ) {
        this.initialize();
    }

    /**
     * Checks if the runtime has available agents.
     * @returns True if agents are available
     */
    public checkConnection(): Promise<boolean> {
        return Promise.resolve(this.repository.getAgentCount() > 0);
    }

    /**
     * Gets the preferred agent ID.
     * @returns The first available agent ID or undefined
     */
    public getPreferredAgentId(): Promise<string | undefined> {
        return Promise.resolve(this.repository.getPreferredAgentId());
    }

    /**
     * Gets all available agents.
     * @returns Array of agents
     */
    public getAgents(): Promise<Agent[]> {
        return Promise.resolve(this.repository.getAgents());
    }

    /**
     * Gets unique model names from agents.
     * @param agents - Optional agent list to extract models from
     * @returns Array of unique model names
     */
    public getAvailableModels(agents?: Agent[]): Promise<string[]> {
        const sourceAgents = agents || this.repository.getAgents();
        return Promise.resolve(uniqueModelNames(sourceAgents.map((agent: any) => agent.model)));
    }

    /**
     * Gets a specific agent by ID.
     * @param agentId - The agent ID to look up
     * @returns The agent or undefined if not found
     */
    public getAgent(agentId: string): Promise<Agent | undefined> {
        return Promise.resolve(this.repository.getAgent(agentId));
    }

    /**
     * Resolves the workspace folder path for an agent.
     * @param agentOrId - Agent ID or agent object
     * @returns The workspace path or undefined
     */
    public resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        const agent = typeof agentOrId === 'string'
            ? this.repository.getAgent(agentOrId)
            : agentOrId;

        return Promise.resolve(agent?.workspacePath?.trim() || undefined);
    }

    /**
     * Creates a new agent.
     * @param params - Agent creation parameters
     * @returns The created agent
     */
    public createAgent(params: CreateAgentParams): Promise<Agent> {
        const agent = this.repository.createAgent(params);
        this.usageService.attachAgent(agent);
        this.emitEvent('agentCreated', agent);
        return Promise.resolve(agent);
    }

    /**
     * Updates an existing agent.
     * @param agentId - The agent ID to update
     * @param params - Update parameters
     * @returns The updated agent
     */
    public updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = this.repository.updateAgent(agentId, params);
        this.emitEvent('agentUpdated', agent);
        return Promise.resolve(agent);
    }

    /**
     * Deletes an agent.
     * @param agentId - The agent ID to delete
     */
    public deleteAgent(agentId: string): Promise<void> {
        this.repository.deleteAgent(agentId);
        this.usageService.deleteAgent(agentId);
        this.emitEvent('agentDeleted', agentId);
        return Promise.resolve();
    }

    /**
     * Creates a new chat session for an agent.
     * @param agentId - The agent ID
     * @param options - Optional session creation options
     * @returns The chat session
     */
    public createChatSession(agentId: string, options: CreateChatSessionOptions = {}): Promise<ChatSession> {
        return Promise.resolve(this.repository.createChatSession(agentId, options.sessionId));
    }

    /**
     * Aborts any active requests for a session.
     * @param sessionId - The session ID to abort
     */
    public async abortSessionRun(sessionId: string): Promise<void> {
        this.abortTrackedRequests(sessionId);
    }

    /**
     * Checks if a session has active running requests.
     * @param sessionId - The session ID to check
     * @returns True if active requests exist
     */
    public hasActiveRun(sessionId: string): boolean {
        const normalizedSessionId = sessionId.trim();
        return normalizedSessionId ? this.activeRequests.has(normalizedSessionId) : false;
    }

    /**
     * Sends a message and returns the complete response.
     * @param sessionId - The session ID
     * @param content - The message content
     * @param options - Optional send options
     * @returns The assistant's response message
     */
    public async sendMessage(
        sessionId: string,
        content: string,
        options?: SendMessageOptions
    ): Promise<ChatMessage> {
        const session = this.repository.requireSession(sessionId);
        const agent = this.repository.requireAgent(session.agentId);

        this.repository.pushMessage(session, createUserMessage(content, session.agentId));
        const abortController = new AbortController();
        this.trackRequest(sessionId, abortController);

        try {
            const response = await axios.post(
                `${agent.baseUrl}/chat/completions`,
                {
                    model: agent.model,
                    messages: this.repository.toProviderMessages(session, agent),
                    temperature: options?.temperature,
                    max_tokens: options?.maxTokens,
                    stream: false
                },
                {
                    timeout: 60000,
                    signal: abortController.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${agent.apiKey}`
                    }
                }
            );

            const usage = response.data?.usage as {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
            } | undefined;
            const assistantMessage: ChatMessage = {
                id: response.data?.id || `msg:${Date.now() + 1}`,
                role: 'assistant',
                content: extractAssistantText(response.data),
                timestamp: new Date().toISOString(),
                agentId: session.agentId,
                tokenCount: usage?.total_tokens
            };

            this.repository.pushMessage(session, assistantMessage);
            this.usageService.recordRequest(agent, usage);
            return assistantMessage;
        } finally {
            this.untrackRequest(sessionId, abortController);
        }
    }

    /**
     * Sends a message and streams the response.
     * @param sessionId - The session ID
     * @param content - The message content
     * @param options - Optional stream options
     * @returns Async generator of stream chunks
     */
    public async *streamMessage(
        sessionId: string,
        content: string,
        options?: StreamMessageOptions
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const session = this.repository.requireSession(sessionId);
        const agent = this.repository.requireAgent(session.agentId);

        this.repository.pushMessage(session, createUserMessage(content, session.agentId));
        const abortController = new AbortController();
        this.trackRequest(sessionId, abortController);

        try {
            const response = await axios.post(
                `${agent.baseUrl}/chat/completions`,
                {
                    model: agent.model,
                    messages: this.repository.toProviderMessages(session, agent),
                    temperature: options?.temperature,
                    max_tokens: options?.maxTokens,
                    stream: true
                },
                {
                    timeout: 60000,
                    responseType: 'stream',
                    signal: abortController.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${agent.apiKey}`
                    }
                }
            );

            const stream = response.data as AsyncIterable<Buffer>;
            let buffer = '';
            let fullContent = '';

            for await (const chunk of stream) {
                buffer += chunk.toString();
                const parts = buffer.split('\n');
                buffer = parts.pop() || '';

                for (const rawLine of parts) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) {
                        continue;
                    }

                    const payload = line.slice(5).trim();
                    if (!payload) {
                        continue;
                    }

                    if (payload === '[DONE]') {
                        const assistantMessage = createAssistantMessage(fullContent, session.agentId);
                        this.repository.pushMessage(session, assistantMessage);
                        this.usageService.recordRequest(agent);
                        yield { content: fullContent, done: true };
                        return;
                    }

                    const parsed = JSON.parse(payload) as {
                        choices?: Array<{
                            delta?: {
                                content?: string;
                            };
                        }>;
                    };
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (!delta) {
                        continue;
                    }

                    fullContent += delta;
                    yield {
                        content: delta,
                        done: false
                    };
                }
            }

            const assistantMessage = createAssistantMessage(fullContent, session.agentId);
            this.repository.pushMessage(session, assistantMessage);
            this.usageService.recordRequest(agent);
            yield { content: '', done: true };
        } finally {
            this.untrackRequest(sessionId, abortController);
        }
    }

    /**
     * Gets the chat history for a session.
     * @param sessionId - The session ID
     * @returns Array of chat messages
     */
    public getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return Promise.resolve(this.repository.getChatHistory(sessionId));
    }

    /**
     * Gets the live chat history for a session.
     * @param sessionId - The session ID
     * @returns Array of chat messages
     */
    public getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return this.getChatHistory(sessionId);
    }

    /**
     * Clears the chat history for a session.
     * @param sessionId - The session ID
     */
    public clearChatHistory(sessionId: string): Promise<void> {
        this.repository.clearChatHistory(sessionId);
        return Promise.resolve();
    }

    /**
     * Gets overall API usage statistics.
     * @returns API usage data
     */
    public getUsage(): Promise<APIUsage> {
        return Promise.resolve(this.usageService.getUsage());
    }

    /**
     * Gets real-time usage snapshot.
     * @returns Realtime usage statistics
     */
    public getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        return Promise.resolve(this.usageService.getRealtimeUsage(this.repository.getSessionCount()));
    }

    /**
     * Gets usage statistics for a specific agent.
     * @param agentId - The agent ID
     * @returns API usage data for the agent
     */
    public getUsageByAgent(agentId: string): Promise<APIUsage> {
        return Promise.resolve(this.usageService.getUsageByAgent(agentId));
    }

    /**
     * Disposes of the runtime and cleans up resources.
     */
    public dispose(): void {
        for (const sessionId of this.activeRequests.keys()) {
            this.abortTrackedRequests(sessionId);
        }
        this.repository.reset();
        this.usageService.reset();
    }

    /**
     * Initializes the runtime with configuration.
     */
    private initialize(): void {
        this.repository.initialize(this.config.providers);
        this.usageService.initialize(
            this.repository.getAgents().map((agent: any) => {
                const localAgent = agent as LocalAgent;
                return {
                    agentId: localAgent.id,
                    providerId: localAgent.providerId,
                    model: localAgent.model
                };
            }),
            this.config.providers.flatMap((provider: any) => [provider.id, ...provider.models.map((model: any) => model.id)])
        );
    }

    /**
     * Tracks an active request for a session.
     * @param sessionId - The session ID
     * @param controller - The abort controller for the request
     */
    private trackRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeRequests.get(normalizedSessionId) || new Set<AbortController>();
        controllers.add(controller);
        this.activeRequests.set(normalizedSessionId, controllers);
    }

    /**
     * Untracks a request for a session.
     * @param sessionId - The session ID
     * @param controller - The abort controller to remove
     */
    private untrackRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeRequests.get(normalizedSessionId);
        if (!controllers) {
            return;
        }

        controllers.delete(controller);
        if (controllers.size === 0) {
            this.activeRequests.delete(normalizedSessionId);
        }
    }

    /**
     * Aborts all tracked requests for a session.
     * @param sessionId - The session ID
     */
    private abortTrackedRequests(sessionId: string): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeRequests.get(normalizedSessionId);
        if (!controllers) {
            return;
        }

        this.activeRequests.delete(normalizedSessionId);
        for (const controller of controllers) {
            controller.abort();
        }
    }
}

/**
 * Creates a user chat message.
 * @param content - The message content
 * @param agentId - The agent ID
 * @returns The user chat message
 */
function createUserMessage(content: string, agentId: string): ChatMessage {
    return {
        id: `msg:${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        agentId
    };
}

/**
 * Creates an assistant chat message.
 * @param content - The message content
 * @param agentId - The agent ID
 * @returns The assistant chat message
 */
function createAssistantMessage(content: string, agentId: string): ChatMessage {
    return {
        id: `msg:${Date.now() + 1}`,
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        agentId
    };
}
