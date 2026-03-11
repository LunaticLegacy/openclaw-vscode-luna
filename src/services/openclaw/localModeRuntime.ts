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
    CreateAgentParams,
    LocalAgent,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    ServiceEventSink,
    StreamChunk,
    StreamMessageOptions,
    UpdateAgentParams
} from './types';

export class LocalModeRuntime {
    private readonly repository = new LocalAgentSessionRepository();
    private readonly usageService = new LocalUsageService();
    private readonly activeRequests = new Map<string, Set<AbortController>>();

    constructor(
        private readonly config: LocalServiceConfig,
        private readonly emitEvent: ServiceEventSink
    ) {
        this.initialize();
    }

    public checkConnection(): Promise<boolean> {
        return Promise.resolve(this.repository.getAgentCount() > 0);
    }

    public getPreferredAgentId(): Promise<string | null> {
        return Promise.resolve(this.repository.getPreferredAgentId());
    }

    public getAgents(): Promise<Agent[]> {
        return Promise.resolve(this.repository.getAgents());
    }

    public getAvailableModels(agents?: Agent[]): Promise<string[]> {
        const sourceAgents = agents || this.repository.getAgents();
        return Promise.resolve(uniqueModelNames(sourceAgents.map(agent => agent.model)));
    }

    public getAgent(agentId: string): Promise<Agent | null> {
        return Promise.resolve(this.repository.getAgent(agentId));
    }

    public resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        const agent = typeof agentOrId === 'string'
            ? this.repository.getAgent(agentOrId)
            : agentOrId;

        return Promise.resolve(agent?.workspacePath?.trim() || undefined);
    }

    public createAgent(params: CreateAgentParams): Promise<Agent> {
        const agent = this.repository.createAgent(params);
        this.usageService.attachAgent(agent);
        this.emitEvent('agentCreated', agent);
        return Promise.resolve(agent);
    }

    public updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = this.repository.updateAgent(agentId, params);
        this.emitEvent('agentUpdated', agent);
        return Promise.resolve(agent);
    }

    public deleteAgent(agentId: string): Promise<void> {
        this.repository.deleteAgent(agentId);
        this.usageService.deleteAgent(agentId);
        this.emitEvent('agentDeleted', agentId);
        return Promise.resolve();
    }

    public createChatSession(agentId: string): Promise<ChatSession> {
        return Promise.resolve(this.repository.createChatSession(agentId));
    }

    public async abortSessionRun(sessionId: string): Promise<void> {
        this.abortTrackedRequests(sessionId);
    }

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

    public getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return Promise.resolve(this.repository.getChatHistory(sessionId));
    }

    public getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return this.getChatHistory(sessionId);
    }

    public clearChatHistory(sessionId: string): Promise<void> {
        this.repository.clearChatHistory(sessionId);
        return Promise.resolve();
    }

    public getUsage(): Promise<APIUsage> {
        return Promise.resolve(this.usageService.getUsage());
    }

    public getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        return Promise.resolve(this.usageService.getRealtimeUsage(this.repository.getSessionCount()));
    }

    public getUsageByAgent(agentId: string): Promise<APIUsage> {
        return Promise.resolve(this.usageService.getUsageByAgent(agentId));
    }

    public dispose(): void {
        for (const sessionId of this.activeRequests.keys()) {
            this.abortTrackedRequests(sessionId);
        }
        this.repository.reset();
        this.usageService.reset();
    }

    private initialize(): void {
        this.repository.initialize(this.config.providers);
        this.usageService.initialize(
            this.repository.getAgents().map(agent => {
                const localAgent = agent as LocalAgent;
                return {
                    agentId: localAgent.id,
                    providerId: localAgent.providerId,
                    model: localAgent.model
                };
            }),
            this.config.providers.flatMap(provider => [provider.id, ...provider.models.map(model => model.id)])
        );
    }

    private trackRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeRequests.get(normalizedSessionId) || new Set<AbortController>();
        controllers.add(controller);
        this.activeRequests.set(normalizedSessionId, controllers);
    }

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

function createUserMessage(content: string, agentId: string): ChatMessage {
    return {
        id: `msg:${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        agentId
    };
}

function createAssistantMessage(content: string, agentId: string): ChatMessage {
    return {
        id: `msg:${Date.now() + 1}`,
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        agentId
    };
}
