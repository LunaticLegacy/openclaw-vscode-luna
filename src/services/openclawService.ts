import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import {
    LocalProviderConfig,
    OpenClawCliServiceConfig,
    ResolvedServiceConfig
} from './openclawConfig';
import {
    OpenClawAgentRecord,
    OpenClawChatHistoryMessage,
    OpenClawCliRunner,
    OpenClawGatewayAgentsResult,
    OpenClawSessionsListEntry,
    OpenClawSessionsListResult,
    OpenClawSessionsUsageResult,
    OpenClawUsageCostResult
} from './openclawCli';
import {
    GatewayEventFrame,
    OpenClawGatewayClient
} from './openclawGatewayClient';

export interface Agent {
    id: string;
    name: string;
    model: string;
    systemPrompt?: string;
    status: 'active' | 'idle' | 'offline';
    createdAt: string;
    lastActive?: string;
    isDefault?: boolean;
    providerId?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    workspacePath?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface AgentCluster {
    id: string;
    name: string;
    agentIds: string[];
    status: 'active' | 'inactive';
    createdAt: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string;
    agentId?: string;
    tokenCount?: number;
    parts?: ChatMessagePart[];
    toolCallId?: string;
    toolName?: string;
    toolArguments?: unknown;
    toolDetails?: unknown;
    isError?: boolean;
    metadata?: Record<string, unknown>;
}

export type ChatMessagePart =
    | {
        type: 'text';
        text: string;
    }
    | {
        type: 'thinking';
        thinking: string;
        thinkingSignature?: string;
    }
    | {
        type: 'toolCall';
        id?: string;
        name: string;
        arguments?: unknown;
    }
    | {
        type: 'toolResult';
        toolCallId?: string;
        name: string;
        arguments?: unknown;
        result: string;
        details?: unknown;
        isError?: boolean;
    };

export interface ChatSession {
    id: string;
    agentId: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
}

export interface APIUsage {
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    currency?: string;
    currencySymbol?: string;
    byModel: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
    }>;
    byModelByDay?: Record<string, Record<string, {
        requests: number;
        tokens: number;
        cost: number;
    }>>;
    byDay: Record<string, {
        requests: number;
        tokens: number;
        cost?: number;
    }>;
}

export interface StreamChunk {
    content: string;
    done: boolean;
    tokenCount?: number;
    message?: ChatMessage;
}

interface LocalAgent extends Agent {
    providerId: string;
    baseUrl: string;
    api: string;
    apiKey: string;
}

interface OpenClawAgentsSnapshot {
    agents: Agent[];
    defaultAgentId: string | null;
    mainKey: string | null;
    sessionKeysByAgent: Map<string, string>;
}

interface OpenClawToolCallInfo {
    name: string;
    arguments?: unknown;
}

interface OpenClawSessionLogEntry {
    type?: string;
    id?: string;
    timestamp?: string | number;
    message?: OpenClawChatHistoryMessage;
}

interface CachedOpenClawAgentsSnapshot {
    expiresAt: number;
    value: OpenClawAgentsSnapshot;
}

export class OpenClawService extends EventEmitter {
    private client: AxiosInstance | null = null;
    private mode: ResolvedServiceConfig['mode'] = 'gateway';
    private gatewayUrl = '';
    private gatewayToken = '';
    private connected = false;
    private localAgents: Map<string, LocalAgent> = new Map();
    private localSessions: Map<string, ChatSession> = new Map();
    private localUsage: APIUsage = createEmptyUsage();
    private localUsageByAgent: Map<string, APIUsage> = new Map();
    private requestTimestamps: number[] = [];
    private openClawRunner: OpenClawCliRunner | null = null;
    private openClawConfig: OpenClawCliServiceConfig | null = null;
    private openClawDefaultAgentId: string | null = null;
    private openClawMainKey: string | null = null;
    private openClawSessionKeysByAgent: Map<string, string> = new Map();
    private openClawSessionEntriesByKey: Map<string, OpenClawSessionsListEntry> = new Map();
    private openClawAgentsSnapshotCache: CachedOpenClawAgentsSnapshot | null = null;
    private openClawAgentsSnapshotPromise: Promise<OpenClawAgentsSnapshot> | null = null;

    constructor(config: ResolvedServiceConfig) {
        super();
        this.applyConfig(config);
    }

    private setupInterceptors() {
        if (!this.client) {
            return;
        }

        this.client.interceptors.request.use(
            requestConfig => {
                this.emit('request', requestConfig);
                return requestConfig;
            },
            error => {
                this.emit('error', error);
                return Promise.reject(error);
            }
        );

        this.client.interceptors.response.use(
            response => {
                this.emit('response', response);
                return response;
            },
            (error: unknown) => {
                this.emit('error', error);
                return Promise.reject(this.handleError(error));
            }
        );
    }

    private handleError(error: unknown): Error {
        const maybeError = error as {
            response?: {
                status?: number;
                data?: { message?: string };
            };
            request?: unknown;
            message?: string;
        };

        if (maybeError.response) {
            const status = maybeError.response.status;
            const data = maybeError.response.data;

            switch (status) {
                case 401:
                    return new Error(t('service.authFailed'));
                case 403:
                    return new Error(t('service.accessDenied'));
                case 404:
                    return new Error(data?.message || t('service.resourceNotFound'));
                case 429:
                    return new Error(t('service.rateLimit'));
                case 500:
                    return new Error(t('service.remoteError'));
                default:
                    return new Error(data?.message || t('service.httpError', {
                        status: status || 0,
                        message: maybeError.message || t('service.requestFailed')
                    }));
            }
        }

        if (maybeError.request) {
            return new Error(t('service.connectFailed'));
        }

        if (error instanceof Error) {
            return error;
        }

        return new Error(String(error));
    }

    private applyConfig(config: ResolvedServiceConfig) {
        this.resetState();
        this.mode = config.mode;

        switch (config.mode) {
            case 'gateway':
                this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
                this.gatewayToken = config.gatewayToken;
                this.client = axios.create({
                    baseURL: this.gatewayUrl,
                    timeout: 60000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.gatewayToken}`
                    }
                });
                this.setupInterceptors();
                break;
            case 'local':
                this.client = null;
                this.initializeLocalAgents(config.providers);
                break;
            case 'openclaw':
                this.client = null;
                this.openClawConfig = config;
                this.openClawRunner = new OpenClawCliRunner(config);
                break;
        }

        void this.checkConnection();
    }

    private resetState() {
        this.client = null;
        this.openClawRunner = null;
        this.openClawConfig = null;
        this.openClawDefaultAgentId = null;
        this.openClawMainKey = null;
        this.openClawSessionKeysByAgent.clear();
        this.openClawSessionEntriesByKey.clear();
        this.invalidateOpenClawAgentsSnapshotCache();
        this.localAgents.clear();
        this.localSessions.clear();
        this.localUsage = createEmptyUsage();
        this.localUsageByAgent.clear();
        this.requestTimestamps = [];
    }

    private invalidateOpenClawAgentsSnapshotCache() {
        this.openClawAgentsSnapshotCache = null;
        this.openClawAgentsSnapshotPromise = null;
    }

    private initializeLocalAgents(providers: LocalProviderConfig[]) {
        const now = new Date().toISOString();

        for (const provider of providers) {
            for (const model of provider.models) {
                const agentId = `local:${provider.id}:${model.id}`;
                const agent: LocalAgent = {
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
                };

                this.localAgents.set(agentId, agent);
                this.localUsageByAgent.set(agentId, createEmptyUsage(inferCurrencyFromHints([provider.id, model.id])));
            }
        }

        this.localUsage = createEmptyUsage(
            inferCurrencyFromHints(
                providers.flatMap(provider => [provider.id, ...provider.models.map(model => model.id)])
            )
        );
    }

    public updateConfig(config: ResolvedServiceConfig): void {
        this.applyConfig(config);
    }

    public async checkConnection(): Promise<boolean> {
        if (this.mode === 'local') {
            this.connected = this.localAgents.size > 0;
            this.emit('connectionChange', this.connected);
            return this.connected;
        }

        if (this.mode === 'openclaw') {
            try {
                await this.requireOpenClawRunner().health();
                this.connected = true;
                this.emit('connectionChange', true);
                return true;
            } catch {
                this.connected = false;
                this.emit('connectionChange', false);
                return false;
            }
        }

        try {
            const response = await this.client!.get('/api/status', { timeout: 5000 });
            this.connected = response.status === 200;
            this.emit('connectionChange', this.connected);
            return this.connected;
        } catch {
            this.connected = false;
            this.emit('connectionChange', false);
            return false;
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public supportsRemoteClusters(): boolean {
        return this.mode === 'gateway';
    }

    public async getPreferredAgentId(): Promise<string | null> {
        if (this.mode === 'local') {
            return this.localAgents.values().next().value?.id ?? null;
        }

        if (this.mode === 'openclaw') {
            const snapshot = await this.loadOpenClawAgentsSnapshot();
            return snapshot.defaultAgentId;
        }

        const agents = await this.getAgents();
        return agents[0]?.id ?? null;
    }

    public async getAgents(): Promise<Agent[]> {
        if (this.mode === 'local') {
            return Array.from(this.localAgents.values());
        }

        if (this.mode === 'openclaw') {
            const snapshot = await this.loadOpenClawAgentsSnapshot();
            return snapshot.agents;
        }

        const response = await this.client!.get('/api/agents');
        return response.data.agents || [];
    }

    public async getAvailableModels(agents?: Agent[]): Promise<string[]> {
        if (this.mode === 'local') {
            const sourceAgents = agents || Array.from(this.localAgents.values());
            return uniqueModelNames(sourceAgents.map(agent => agent.model));
        }

        if (this.mode === 'openclaw') {
            const sourceAgents = agents || (await this.loadOpenClawAgentsSnapshot()).agents;
            return uniqueModelNames([
                this.openClawConfig?.defaultModel,
                ...sourceAgents.map(agent => agent.model)
            ]);
        }

        const sourceAgents = agents || await this.getAgents();
        return uniqueModelNames(sourceAgents.map(agent => agent.model));
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        if (this.mode === 'local') {
            return this.localAgents.get(agentId) || null;
        }

        if (this.mode === 'openclaw') {
            const agents = await this.getAgents();
            return agents.find(agent => agent.id === agentId) || null;
        }

        try {
            const response = await this.client!.get(`/api/agents/${agentId}`);
            return response.data;
        } catch (error) {
            const maybeError = error as { response?: { status?: number } };
            if (maybeError.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    public async resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        const agent = typeof agentOrId === 'string'
            ? await this.getAgent(agentOrId)
            : agentOrId;

        if (!agent) {
            return undefined;
        }

        const explicitPath = normalizeOptionalPath(agent.workspacePath);
        if (explicitPath) {
            return explicitPath;
        }

        if (this.mode === 'openclaw') {
            return inferOpenClawWorkspacePath(agent.id, this.openClawConfig);
        }

        return undefined;
    }

    public async createAgent(params: {
        name: string;
        model: string;
        systemPrompt?: string;
    }): Promise<Agent> {
        if (this.mode === 'local') {
            const templateAgent = Array.from(this.localAgents.values())[0];
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

            this.localAgents.set(agent.id, agent);
            this.localUsageByAgent.set(agent.id, createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model])));
            this.emit('agentCreated', agent);
            return agent;
        }

        if (this.mode === 'openclaw') {
            const created = await this.requireOpenClawRunner().createAgent(params.name, params.model);
            this.invalidateOpenClawAgentsSnapshotCache();
            const createdAgentId = extractString(created, ['id', 'agentId']);
            const agents = await this.getAgents();
            const agent = agents.find(item => item.id === createdAgentId)
                || agents.find(item => item.name === params.name)
                || {
                    id: createdAgentId || sanitizeAgentName(params.name),
                    name: params.name,
                    model: params.model,
                    status: 'idle' as const,
                    createdAt: new Date().toISOString(),
                    workspacePath: inferOpenClawWorkspacePath(createdAgentId || params.name, this.openClawConfig)
                };

            this.emit('agentCreated', agent);
            return agent;
        }

        const response = await this.client!.post('/api/agents', params);
        this.emit('agentCreated', response.data);
        return response.data;
    }

    public async updateAgent(agentId: string, params: {
        name?: string;
        systemPrompt?: string;
        model?: string;
    }): Promise<Agent> {
        if (this.mode === 'local') {
            const agent = this.localAgents.get(agentId);
            if (!agent) {
                throw new Error(t('service.agentNotFound'));
            }

            const updatedAgent: LocalAgent = {
                ...agent,
                ...params
            };

            this.localAgents.set(agentId, updatedAgent);
            this.emit('agentUpdated', updatedAgent);
            return updatedAgent;
        }

        if (this.mode === 'openclaw') {
            throw new Error(t('service.updateAgentNotSupported'));
        }

        const response = await this.client!.patch(`/api/agents/${agentId}`, params);
        this.emit('agentUpdated', response.data);
        return response.data;
    }

    public async deleteAgent(agentId: string): Promise<void> {
        if (this.mode === 'local') {
            this.localAgents.delete(agentId);
            this.localUsageByAgent.delete(agentId);
            this.emit('agentDeleted', agentId);
            return;
        }

        if (this.mode === 'openclaw') {
            await this.requireOpenClawRunner().deleteAgent(agentId);
            this.invalidateOpenClawAgentsSnapshotCache();
            this.openClawSessionKeysByAgent.delete(agentId);
            if (this.openClawDefaultAgentId === agentId) {
                this.openClawDefaultAgentId = null;
            }
            this.emit('agentDeleted', agentId);
            return;
        }

        await this.client!.delete(`/api/agents/${agentId}`);
        this.emit('agentDeleted', agentId);
    }

    public async createChatSession(agentId: string): Promise<ChatSession> {
        if (this.mode === 'local') {
            const agent = this.localAgents.get(agentId);
            if (!agent) {
                throw new Error(t('service.localAgentNotFound'));
            }

            for (const session of this.localSessions.values()) {
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

            this.localSessions.set(session.id, session);
            return session;
        }

        if (this.mode === 'openclaw') {
            const sessionKey = await this.resolveOpenClawSessionKey(agentId);
            const history = await this.getChatHistory(sessionKey).catch(() => []);
            const now = new Date().toISOString();
            return {
                id: sessionKey,
                agentId,
                messages: history,
                createdAt: history[0]?.timestamp || now,
                updatedAt: history[history.length - 1]?.timestamp || now
            };
        }

        const response = await this.client!.post('/api/sessions', { agentId });
        return response.data;
    }

    public async sendMessage(sessionId: string, message: string, options?: {
        stream?: boolean;
        temperature?: number;
        maxTokens?: number;
    }): Promise<ChatMessage> {
        if (this.mode === 'local') {
            return this.sendLocalMessage(sessionId, message, options);
        }

        if (this.mode === 'openclaw') {
            const runner = this.requireOpenClawRunner();
            const historyBefore = await this.readOpenClawSessionMessages(sessionId).catch(() => []);
            const knownIds = new Set(historyBefore.map(item => item.id));
            const result = await runner.sendChat(sessionId, message);
            const latestAssistant = await this.waitForOpenClawAssistantMessage(sessionId, knownIds, 4000);
            return latestAssistant
                || extractAssistantMessageFromPayload(result, sessionId)
                || {
                    id: `${sessionId}:${Date.now()}`,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date().toISOString(),
                    agentId: parseAgentIdFromSessionKey(sessionId) || undefined
                };
        }

        const response = await this.client!.post(`/api/sessions/${sessionId}/messages`, {
            content: message,
            ...options
        });
        return response.data;
    }

    public async *streamMessage(
        sessionId: string,
        message: string,
        options?: {
            temperature?: number;
            maxTokens?: number;
        }
    ): AsyncGenerator<StreamChunk, void, unknown> {
        if (this.mode === 'local') {
            yield* this.streamLocalMessage(sessionId, message, options);
            return;
        }

        if (this.mode === 'openclaw') {
            yield* this.streamOpenClawMessage(sessionId, message);
            return;
        }

        const response = await this.client!.post(
            `/api/sessions/${sessionId}/messages/stream`,
            {
                content: message,
                ...options
            },
            {
                responseType: 'stream'
            }
        );

        const stream = response.data as AsyncIterable<Buffer>;
        for await (const chunk of stream) {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: ')) {
                    continue;
                }

                yield JSON.parse(line.slice(6)) as StreamChunk;
            }
        }
    }

    public async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        if (this.mode === 'local') {
            return this.localSessions.get(sessionId)?.messages || [];
        }

        if (this.mode === 'openclaw') {
            const fileMessages = await this.readOpenClawSessionMessages(sessionId);
            if (fileMessages.length > 0) {
                return fileMessages;
            }

            const response = await this.requireOpenClawRunner().getChatHistory(sessionId, 200);
            return normalizeOpenClawChatHistory(response.messages || [], sessionId);
        }

        const response = await this.client!.get(`/api/sessions/${sessionId}/messages`);
        return response.data.messages || [];
    }

    public supportsLiveSessionSync(): boolean {
        return this.mode === 'openclaw';
    }

    public getMode(): ResolvedServiceConfig['mode'] {
        return this.mode;
    }

    public getOpenClawConfig(): OpenClawCliServiceConfig | null {
        return this.openClawConfig;
    }

    public async getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        if (this.mode !== 'openclaw') {
            return this.getChatHistory(sessionId);
        }

        return this.readOpenClawSessionMessages(sessionId).catch(() => []);
    }

    public async clearChatHistory(sessionId: string): Promise<void> {
        if (this.mode === 'local') {
            const session = this.localSessions.get(sessionId);
            if (session) {
                session.messages = [];
                session.updatedAt = new Date().toISOString();
            }
            return;
        }

        if (this.mode === 'openclaw') {
            return;
        }

        await this.client!.delete(`/api/sessions/${sessionId}/messages`);
    }

    public async getClusters(): Promise<AgentCluster[]> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            return [];
        }

        const response = await this.client!.get('/api/clusters');
        return response.data.clusters || [];
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            return null;
        }

        try {
            const response = await this.client!.get(`/api/clusters/${clusterId}`);
            return response.data;
        } catch (error) {
            const maybeError = error as { response?: { status?: number } };
            if (maybeError.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    public async createCluster(params: {
        name: string;
        agentIds: string[];
    }): Promise<AgentCluster> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            throw new Error(t('service.clustersUnavailable'));
        }

        const response = await this.client!.post('/api/clusters', params);
        this.emit('clusterCreated', response.data);
        return response.data;
    }

    public async updateCluster(clusterId: string, params: {
        name?: string;
        agentIds?: string[];
    }): Promise<AgentCluster> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            throw new Error(t('service.clustersUnavailable'));
        }

        const response = await this.client!.patch(`/api/clusters/${clusterId}`, params);
        this.emit('clusterUpdated', response.data);
        return response.data;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            throw new Error(t('service.clustersUnavailable'));
        }

        await this.client!.delete(`/api/clusters/${clusterId}`);
        this.emit('clusterDeleted', clusterId);
    }

    public async sendToCluster(clusterId: string, message: string): Promise<Record<string, ChatMessage>> {
        if (this.mode === 'local' || this.mode === 'openclaw') {
            throw new Error(t('service.clusterBroadcastUnavailable'));
        }

        const response = await this.client!.post(`/api/clusters/${clusterId}/broadcast`, {
            content: message
        });
        return response.data.responses || {};
    }

    public async getUsage(): Promise<APIUsage> {
        if (this.mode === 'local') {
            return cloneUsage(this.localUsage);
        }

        if (this.mode === 'openclaw') {
            return this.getOpenClawUsage();
        }

        const response = await this.client!.get('/api/usage');
        return response.data;
    }

    public async getRealtimeUsage(): Promise<{
        activeSessions: number;
        requestsPerMinute: number;
        tokensPerMinute: number;
    }> {
        if (this.mode === 'local') {
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 60000);
            return {
                activeSessions: this.localSessions.size,
                requestsPerMinute: this.requestTimestamps.length,
                tokensPerMinute: Math.round(this.localUsage.totalTokens)
            };
        }

        if (this.mode === 'openclaw') {
            const sessions = (await this.requireOpenClawRunner().listSessions()).sessions || [];
            const now = Date.now();
            const recentSessions = sessions.filter(session => {
                const updatedAt = session.updatedAt || 0;
                return updatedAt > 0 && now - updatedAt < 60000;
            });

            return {
                activeSessions: sessions.length,
                requestsPerMinute: recentSessions.length,
                tokensPerMinute: recentSessions.reduce((sum, session) => sum + (session.totalTokens || 0), 0)
            };
        }

        const response = await this.client!.get('/api/usage/realtime');
        return response.data;
    }

    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        if (this.mode === 'local') {
            return cloneUsage(this.localUsageByAgent.get(agentId) || createEmptyUsage());
        }

        if (this.mode === 'openclaw') {
            return this.getOpenClawUsage(agentId);
        }

        const response = await this.client!.get(`/api/agents/${agentId}/usage`);
        return response.data;
    }

    private async loadOpenClawAgentsSnapshot(
        options: { forceRefresh?: boolean; metadataTimeoutMs?: number } = {}
    ): Promise<OpenClawAgentsSnapshot> {
        const { forceRefresh = false, metadataTimeoutMs = 2500 } = options;

        if (!forceRefresh) {
            const cached = this.openClawAgentsSnapshotCache;
            if (cached && cached.expiresAt > Date.now()) {
                return cached.value;
            }

            if (this.openClawAgentsSnapshotPromise) {
                return this.openClawAgentsSnapshotPromise;
            }
        }

        const loadPromise = this.loadOpenClawAgentsSnapshotUncached(metadataTimeoutMs)
            .finally(() => {
                if (this.openClawAgentsSnapshotPromise === loadPromise) {
                    this.openClawAgentsSnapshotPromise = null;
                }
            });

        this.openClawAgentsSnapshotPromise = loadPromise;
        return loadPromise;
    }

    private async loadOpenClawAgentsSnapshotUncached(metadataTimeoutMs: number): Promise<OpenClawAgentsSnapshot> {
        const runner = this.requireOpenClawRunner();
        const [records, gatewayAgents, sessionsResult] = await Promise.all([
            runner.listAgents(),
            withTimeout<OpenClawGatewayAgentsResult>(
                runner.listGatewayAgents().catch((): OpenClawGatewayAgentsResult => ({})),
                metadataTimeoutMs,
                {}
            ),
            withTimeout<OpenClawSessionsListResult>(
                runner.listSessions().catch(() => ({ sessions: [] as OpenClawSessionsListEntry[] })),
                metadataTimeoutMs,
                { sessions: [] as OpenClawSessionsListEntry[] }
            )
        ]);

        this.openClawSessionEntriesByKey = new Map(
            (sessionsResult.sessions || [])
                .filter(session => session.key)
                .map(session => [session.key, session] as const)
        );
        const sessionKeysByAgent = buildSessionKeyMap(sessionsResult.sessions || []);
        const defaultAgentId = resolvePreferredAgentId(records, gatewayAgents, sessionKeysByAgent);
        const gatewayNames = new Map(
            (gatewayAgents.agents || [])
                .filter(item => item.id)
                .map(item => [item.id!, item.name?.trim() || item.id!])
        );
        const now = new Date().toISOString();
        const agents: Agent[] = [];
        const seen = new Set<string>();

        for (const record of records) {
            if (!record.id) {
                continue;
            }

            seen.add(record.id);
            agents.push({
                id: record.id,
                name: record.name?.trim() || gatewayNames.get(record.id) || record.id,
                model: record.model?.trim() || this.openClawConfig?.defaultModel || 'openclaw',
                status: record.id === defaultAgentId ? 'active' : 'idle',
                createdAt: now,
                lastActive: sessionKeysByAgent.has(record.id) ? now : undefined,
                isDefault: Boolean(record.isDefault || record.id === defaultAgentId),
                workspacePath: resolveOpenClawRecordWorkspacePath(record, this.openClawConfig)
            });
        }

        for (const [id, name] of gatewayNames.entries()) {
            if (seen.has(id)) {
                continue;
            }

            agents.push({
                id,
                name,
                model: this.openClawConfig?.defaultModel || 'openclaw',
                status: id === defaultAgentId ? 'active' : 'idle',
                createdAt: now,
                lastActive: sessionKeysByAgent.has(id) ? now : undefined,
                isDefault: id === defaultAgentId,
                workspacePath: inferOpenClawWorkspacePath(id, this.openClawConfig)
            });
        }

        this.openClawDefaultAgentId = defaultAgentId;
        this.openClawMainKey = gatewayAgents.mainKey?.trim() || this.openClawMainKey || 'main';
        this.openClawSessionKeysByAgent = sessionKeysByAgent;

        const snapshot = {
            agents: agents.sort((left, right) => {
                if (left.status !== right.status) {
                    return left.status === 'active' ? -1 : 1;
                }
                return left.name.localeCompare(right.name);
            }),
            defaultAgentId,
            mainKey: this.openClawMainKey,
            sessionKeysByAgent
        };

        this.openClawAgentsSnapshotCache = {
            value: snapshot,
            expiresAt: Date.now() + 5000
        };

        return snapshot;
    }

    private async resolveOpenClawSessionKey(agentId: string): Promise<string> {
        const cached = this.openClawSessionKeysByAgent.get(agentId);
        if (cached) {
            return cached;
        }

        const snapshot = await this.loadOpenClawAgentsSnapshot();
        const resolved = snapshot.sessionKeysByAgent.get(agentId);
        if (resolved) {
            return resolved;
        }

        const sessionKey = `agent:${agentId}:${snapshot.mainKey?.trim() || this.openClawMainKey || 'main'}`;
        this.openClawSessionKeysByAgent.set(agentId, sessionKey);
        return sessionKey;
    }

    private async readOpenClawSessionMessages(sessionKey: string, limit: number = 200): Promise<ChatMessage[]> {
        const sessionEntry = await this.resolveOpenClawSessionEntry(sessionKey);
        if (!sessionEntry?.sessionId) {
            return [];
        }

        const agentId = sessionEntry.agentId || parseAgentIdFromSessionKey(sessionKey) || undefined;
        if (!agentId || !this.openClawConfig) {
            return [];
        }

        const sessionFilePath = path.join(
            this.openClawConfig.stateDir,
            'agents',
            sanitizeAgentName(agentId),
            'sessions',
            `${sessionEntry.sessionId}.jsonl`
        );

        try {
            const content = await fs.readFile(sessionFilePath, 'utf8');
            return normalizeOpenClawSessionLog(content, sessionKey, agentId, limit);
        } catch (error) {
            const maybeNodeError = error as NodeJS.ErrnoException;
            if (maybeNodeError.code === 'ENOENT') {
                return [];
            }

            throw error;
        }
    }

    private async resolveOpenClawSessionEntry(sessionKey: string): Promise<OpenClawSessionsListEntry | null> {
        const cached = this.openClawSessionEntriesByKey.get(sessionKey);
        if (cached) {
            return cached;
        }

        await this.loadOpenClawAgentsSnapshot();
        const fromSnapshot = this.openClawSessionEntriesByKey.get(sessionKey);
        if (fromSnapshot) {
            return fromSnapshot;
        }

        const sessionsResult = await this.requireOpenClawRunner().listSessions().catch(() => ({ sessions: [] as OpenClawSessionsListEntry[] }));
        this.openClawSessionEntriesByKey = new Map(
            (sessionsResult.sessions || [])
                .filter(session => session.key)
                .map(session => [session.key, session] as const)
        );

        return this.openClawSessionEntriesByKey.get(sessionKey) || null;
    }

    private async waitForOpenClawAssistantMessage(
        sessionKey: string,
        knownIds: Set<string>,
        timeoutMs: number
    ): Promise<ChatMessage | null> {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const messages = await this.readOpenClawSessionMessages(sessionKey).catch(() => []);
            const assistant = [...messages]
                .reverse()
                .find(message => !knownIds.has(message.id) && isFinalOpenClawAssistantMessage(message));

            if (assistant) {
                return assistant;
            }

            await delay(150);
        }

        return null;
    }

    private async *streamOpenClawMessage(
        sessionKey: string,
        message: string
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const historyBefore = await this.readOpenClawSessionMessages(sessionKey).catch(() => []);
        const knownIds = new Set(historyBefore.map(item => item.id));

        try {
            yield* this.streamOpenClawMessageViaGateway(sessionKey, message, knownIds);
            return;
        } catch {
            yield* this.streamOpenClawMessageFromSessionLog(sessionKey, message, knownIds);
        }
    }

    private async *streamOpenClawMessageViaGateway(
        sessionKey: string,
        message: string,
        knownIds: Set<string>
    ): AsyncGenerator<StreamChunk, void, unknown> {
        if (!this.openClawConfig?.gatewayUrl) {
            throw new Error('OpenClaw gateway URL is not configured');
        }

        const gatewayClient = new OpenClawGatewayClient({
            url: this.openClawConfig.gatewayUrl,
            token: this.openClawConfig.gatewayToken,
            timeoutMs: 30000,
            caps: ['tool-events'],
            clientId: 'gateway-client',
            clientDisplayName: 'OpenClaw VS Code',
            clientVersion: 'vscode-plugin'
        });

        const events: GatewayEventFrame[] = [];
        let wakeNextEvent: (() => void) | null = null;
        let streamError: Error | null = null;
        let dispatched = false;
        let runId = '';
        let assistantText = '';
        let thinkingText = '';
        let thinkingOpen = false;

        const queueEvent = (event: GatewayEventFrame) => {
            events.push(event);
            const wake = wakeNextEvent;
            wakeNextEvent = null;
            wake?.();
        };

        const onEvent = (event: GatewayEventFrame) => {
            if (event.event !== 'chat' && event.event !== 'agent') {
                return;
            }

            queueEvent(event);
        };

        const onError = (error: unknown) => {
            streamError = error instanceof Error ? error : new Error(String(error));
            const wake = wakeNextEvent;
            wakeNextEvent = null;
            wake?.();
        };

        const nextEvent = async (): Promise<GatewayEventFrame> => {
            while (events.length === 0) {
                if (streamError) {
                    throw streamError;
                }

                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        if (wakeNextEvent === wake) {
                            wakeNextEvent = null;
                        }
                        reject(new Error('Timed out waiting for gateway stream event'));
                    }, 30000);

                    const wake = () => {
                        clearTimeout(timer);
                        resolve();
                    };

                    wakeNextEvent = wake;
                });
            }

            return events.shift()!;
        };

        gatewayClient.on('event', onEvent);
        gatewayClient.on('error', onError);

        try {
            await gatewayClient.connect();

            const started = await gatewayClient.request<{
                runId?: string;
                status?: string;
            }>('chat.send', {
                sessionKey,
                message,
                deliver: false,
                idempotencyKey: crypto.randomUUID()
            }, {
                timeoutMs: 30000
            });

            dispatched = true;
            runId = typeof started.runId === 'string' && started.runId.trim()
                ? started.runId.trim()
                : '';

            if (!runId) {
                throw new Error('Gateway chat.send did not return a runId');
            }

            while (true) {
                const event = await nextEvent();
                const payload = event.payload && typeof event.payload === 'object'
                    ? event.payload as Record<string, unknown>
                    : null;

                if (!payload || payload.runId !== runId) {
                    continue;
                }

                if (event.event === 'agent') {
                    const stream = typeof payload.stream === 'string' ? payload.stream : '';

                    if (stream === 'thinking') {
                        const data = payload.data && typeof payload.data === 'object'
                            ? payload.data as Record<string, unknown>
                            : {};
                        const fullThinking = typeof data.text === 'string' ? data.text : '';
                        const deltaThinking = typeof data.delta === 'string'
                            ? data.delta
                            : fullThinking.startsWith(thinkingText)
                                ? fullThinking.slice(thinkingText.length)
                                : fullThinking;

                        thinkingText = fullThinking || thinkingText;
                        if (!deltaThinking) {
                            continue;
                        }

                        yield {
                            content: thinkingOpen ? deltaThinking : `<thinking>${deltaThinking}`,
                            done: false
                        };
                        thinkingOpen = true;
                        continue;
                    }

                    if (thinkingOpen && (stream === 'assistant' || stream === 'tool' || stream === 'lifecycle')) {
                        thinkingOpen = false;
                        thinkingText = '';
                        yield {
                            content: '</thinking>',
                            done: false
                        };
                    }

                    if (stream === 'tool') {
                        const transientMessage = normalizeOpenClawGatewayToolEvent(sessionKey, payload);
                        if (transientMessage) {
                            yield {
                                content: '',
                                done: false,
                                message: transientMessage
                            };
                        }
                        continue;
                    }

                    if (stream === 'lifecycle') {
                        const data = payload.data && typeof payload.data === 'object'
                            ? payload.data as Record<string, unknown>
                            : {};
                        if (data.phase === 'error') {
                            throw new Error(typeof data.error === 'string' ? data.error : 'OpenClaw agent run failed');
                        }
                    }

                    continue;
                }

                if (thinkingOpen) {
                    thinkingOpen = false;
                    thinkingText = '';
                    yield {
                        content: '</thinking>',
                        done: false
                    };
                }

                const state = typeof payload.state === 'string' ? payload.state : '';
                const messageText = extractTextContent((payload.message as { content?: unknown } | undefined)?.content);
                const deltaText = messageText
                    ? messageText.startsWith(assistantText)
                        ? messageText.slice(assistantText.length)
                        : messageText
                    : '';

                if (messageText) {
                    assistantText = messageText;
                }

                if (deltaText) {
                    yield {
                        content: deltaText,
                        done: false
                    };
                }

                if (state === 'error') {
                    throw new Error(typeof payload.errorMessage === 'string' ? payload.errorMessage : 'OpenClaw chat stream failed');
                }

                if (state === 'aborted') {
                    throw new Error('OpenClaw chat stream aborted');
                }

                if (state === 'final') {
                    yield {
                        content: '',
                        done: true
                    };
                    return;
                }
            }
        } catch (error) {
            if (!dispatched) {
                throw error;
            }

            const streamFailure = error instanceof Error ? error : new Error(String(error));
            if (thinkingOpen) {
                thinkingOpen = false;
                thinkingText = '';
                yield {
                    content: '</thinking>',
                    done: false
                };
            }

            const fallbackAssistant = await this.waitForOpenClawAssistantMessage(sessionKey, knownIds, 120000);
            if (!fallbackAssistant && !assistantText) {
                throw streamFailure;
            }

            if (fallbackAssistant?.content) {
                const deltaText = fallbackAssistant.content.startsWith(assistantText)
                    ? fallbackAssistant.content.slice(assistantText.length)
                    : fallbackAssistant.content;

                if (deltaText) {
                    yield {
                        content: deltaText,
                        done: false
                    };
                }
            }

            yield {
                content: '',
                done: true
            };
        } finally {
            gatewayClient.off('event', onEvent);
            gatewayClient.off('error', onError);
            gatewayClient.dispose();
        }
    }

    private async *streamOpenClawMessageFromSessionLog(
        sessionKey: string,
        message: string,
        knownIds: Set<string>
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const runner = this.requireOpenClawRunner();
        let responsePayload: Record<string, unknown> | null = null;
        let requestError: unknown = null;
        let requestCompleted = false;
        let requestCompletedAt = 0;
        let finalAssistantSeen = false;

        const requestPromise = runner.sendChat(sessionKey, message)
            .then(result => {
                responsePayload = result;
                requestCompleted = true;
                requestCompletedAt = Date.now();
                return result;
            })
            .catch(error => {
                requestError = error;
                requestCompleted = true;
                requestCompletedAt = Date.now();
                throw error;
            });

        while (!requestCompleted || Date.now() - requestCompletedAt < 2500) {
            const currentMessages = await this.readOpenClawSessionMessages(sessionKey).catch(() => []);
            const newMessages = currentMessages.filter(item => !knownIds.has(item.id));

            for (const newMessage of newMessages) {
                knownIds.add(newMessage.id);
                if (isFinalOpenClawAssistantMessage(newMessage)) {
                    finalAssistantSeen = true;
                }

                yield {
                    content: newMessage.role === 'assistant' ? newMessage.content : '',
                    done: false,
                    tokenCount: newMessage.tokenCount,
                    message: newMessage
                };
            }

            if (requestCompleted) {
                if (requestError) {
                    break;
                }

                if (finalAssistantSeen) {
                    break;
                }
            }

            await delay(200);
        }

        try {
            await requestPromise;
        } catch {
            throw requestError;
        }

        if (!finalAssistantSeen && responsePayload) {
            const fallbackAssistant = extractAssistantMessageFromPayload(responsePayload, sessionKey);
            if (fallbackAssistant && !knownIds.has(fallbackAssistant.id)) {
                yield {
                    content: fallbackAssistant.content,
                    done: false,
                    tokenCount: fallbackAssistant.tokenCount,
                    message: fallbackAssistant
                };
            }
        }

        yield {
            content: '',
            done: true
        };
    }

    private requireOpenClawRunner(): OpenClawCliRunner {
        if (!this.openClawRunner) {
            throw new Error(t('service.cliNotConfigured'));
        }

        return this.openClawRunner;
    }

    private async getOpenClawUsage(agentId?: string): Promise<APIUsage> {
        const sessionsUsagePromise = this.requireOpenClawRunner().getSessionsUsage({
            limit: 1000,
            includeContextWeight: true
        });
        const costPromise = agentId
            ? Promise.resolve<OpenClawUsageCostResult | null>(null)
            : this.requireOpenClawRunner().getUsageCost({}).then(result => result).catch(() => null);
        const [sessionsUsage, usageCost] = await Promise.all([sessionsUsagePromise, costPromise]);
        return mapOpenClawUsage(sessionsUsage, usageCost, agentId);
    }

    private async sendLocalMessage(
        sessionId: string,
        content: string,
        options?: {
            stream?: boolean;
            temperature?: number;
            maxTokens?: number;
        }
    ): Promise<ChatMessage> {
        const session = this.requireLocalSession(sessionId);
        const agent = this.requireLocalAgent(session.agentId);

        this.pushMessage(session, {
            id: `msg:${Date.now()}`,
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            agentId: session.agentId
        });

        const response = await axios.post(
            `${agent.baseUrl}/chat/completions`,
            {
                model: agent.model,
                messages: this.toProviderMessages(session, agent),
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                stream: false
            },
            {
                timeout: 60000,
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

        this.pushMessage(session, assistantMessage);
        this.recordUsage(agent, usage);
        return assistantMessage;
    }

    private async *streamLocalMessage(
        sessionId: string,
        content: string,
        options?: {
            temperature?: number;
            maxTokens?: number;
        }
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const session = this.requireLocalSession(sessionId);
        const agent = this.requireLocalAgent(session.agentId);

        this.pushMessage(session, {
            id: `msg:${Date.now()}`,
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            agentId: session.agentId
        });

        const response = await axios.post(
            `${agent.baseUrl}/chat/completions`,
            {
                model: agent.model,
                messages: this.toProviderMessages(session, agent),
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                stream: true
            },
            {
                timeout: 60000,
                responseType: 'stream',
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
                    const assistantMessage: ChatMessage = {
                        id: `msg:${Date.now() + 1}`,
                        role: 'assistant',
                        content: fullContent,
                        timestamp: new Date().toISOString(),
                        agentId: session.agentId
                    };

                    this.pushMessage(session, assistantMessage);
                    this.recordUsage(agent);
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

        const assistantMessage: ChatMessage = {
            id: `msg:${Date.now() + 1}`,
            role: 'assistant',
            content: fullContent,
            timestamp: new Date().toISOString(),
            agentId: session.agentId
        };

        this.pushMessage(session, assistantMessage);
        this.recordUsage(agent);
        yield { content: '', done: true };
    }

    private requireLocalSession(sessionId: string): ChatSession {
        const session = this.localSessions.get(sessionId);
        if (!session) {
            throw new Error(t('service.chatSessionNotFound'));
        }

        return session;
    }

    private requireLocalAgent(agentId: string): LocalAgent {
        const agent = this.localAgents.get(agentId);
        if (!agent) {
            throw new Error(t('service.agentNotFound'));
        }

        if (agent.api !== 'openai-completions') {
            throw new Error(t('service.providerApiUnsupported', { api: agent.api }));
        }

        return agent;
    }

    private toProviderMessages(session: ChatSession, agent: LocalAgent): Array<{ role: string; content: string }> {
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

    private pushMessage(session: ChatSession, message: ChatMessage) {
        session.messages.push(message);
        session.updatedAt = new Date().toISOString();
    }

    private recordUsage(
        agent: LocalAgent,
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
        }
    ) {
        const promptTokens = usage?.prompt_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const totalTokens = usage?.total_tokens || promptTokens + completionTokens;
        const cost = estimateFallbackCost(promptTokens, completionTokens);
        const today = new Date().toISOString().split('T')[0];

        this.localUsage.totalRequests += 1;
        this.localUsage.promptTokens += promptTokens;
        this.localUsage.completionTokens += completionTokens;
        this.localUsage.totalTokens += totalTokens;
        this.localUsage.cost += cost;
        this.localUsage.byDay[today] = {
            requests: (this.localUsage.byDay[today]?.requests || 0) + 1,
            tokens: (this.localUsage.byDay[today]?.tokens || 0) + totalTokens,
            cost: (this.localUsage.byDay[today]?.cost || 0) + cost
        };
        this.localUsage.byModel[agent.model] = {
            requests: (this.localUsage.byModel[agent.model]?.requests || 0) + 1,
            tokens: (this.localUsage.byModel[agent.model]?.tokens || 0) + totalTokens,
            cost: (this.localUsage.byModel[agent.model]?.cost || 0) + cost
        };
        const localUsageModelDay = this.localUsage.byModelByDay ||= {};
        localUsageModelDay[today] ||= {};
        localUsageModelDay[today][agent.model] = {
            requests: (localUsageModelDay[today][agent.model]?.requests || 0) + 1,
            tokens: (localUsageModelDay[today][agent.model]?.tokens || 0) + totalTokens,
            cost: (localUsageModelDay[today][agent.model]?.cost || 0) + cost
        };

        const agentUsage = this.localUsageByAgent.get(agent.id)
            || createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model]));
        agentUsage.totalRequests += 1;
        agentUsage.promptTokens += promptTokens;
        agentUsage.completionTokens += completionTokens;
        agentUsage.totalTokens += totalTokens;
        agentUsage.cost += cost;
        agentUsage.byDay[today] = {
            requests: (agentUsage.byDay[today]?.requests || 0) + 1,
            tokens: (agentUsage.byDay[today]?.tokens || 0) + totalTokens,
            cost: (agentUsage.byDay[today]?.cost || 0) + cost
        };
        agentUsage.byModel[agent.model] = {
            requests: (agentUsage.byModel[agent.model]?.requests || 0) + 1,
            tokens: (agentUsage.byModel[agent.model]?.tokens || 0) + totalTokens,
            cost: (agentUsage.byModel[agent.model]?.cost || 0) + cost
        };
        const agentUsageModelDay = agentUsage.byModelByDay ||= {};
        agentUsageModelDay[today] ||= {};
        agentUsageModelDay[today][agent.model] = {
            requests: (agentUsageModelDay[today][agent.model]?.requests || 0) + 1,
            tokens: (agentUsageModelDay[today][agent.model]?.tokens || 0) + totalTokens,
            cost: (agentUsageModelDay[today][agent.model]?.cost || 0) + cost
        };

        this.localUsageByAgent.set(agent.id, agentUsage);
        this.requestTimestamps.push(Date.now());
    }

    public dispose(): void {
        this.removeAllListeners();
        this.connected = false;
        this.resetState();
    }
}

function createEmptyUsage(currency?: { code: string; symbol: string }): APIUsage {
    return {
        totalRequests: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        currency: currency?.code,
        currencySymbol: currency?.symbol,
        byModel: {},
        byModelByDay: {},
        byDay: {}
    };
}

function cloneUsage(usage: APIUsage): APIUsage {
    return {
        totalRequests: usage.totalRequests,
        totalTokens: usage.totalTokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cost: usage.cost,
        currency: usage.currency,
        currencySymbol: usage.currencySymbol,
        byModel: JSON.parse(JSON.stringify(usage.byModel)),
        byModelByDay: JSON.parse(JSON.stringify(usage.byModelByDay || {})),
        byDay: JSON.parse(JSON.stringify(usage.byDay))
    };
}

function estimateFallbackCost(promptTokens: number, completionTokens: number): number {
    return ((promptTokens + completionTokens) / 1000) * 0.002;
}

function extractAssistantText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const data = payload as {
        choices?: Array<{
            message?: {
                content?: unknown;
            };
        }>;
    };
    return extractTextContent(data.choices?.[0]?.message?.content);
}

function extractTextContent(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(item => extractTextContent(item)).join('');
    }

    if (!value || typeof value !== 'object') {
        return '';
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
        return record.text;
    }

    if (typeof record.content === 'string') {
        return record.content;
    }

    if (Array.isArray(record.content)) {
        return record.content.map(item => extractTextContent(item)).join('');
    }

    return '';
}

function normalizeOpenClawGatewayToolEvent(
    sessionKey: string,
    payload: Record<string, unknown>
): ChatMessage | null {
    const data = payload.data && typeof payload.data === 'object'
        ? payload.data as Record<string, unknown>
        : null;
    if (!data) {
        return null;
    }

    const phase = typeof data.phase === 'string' ? data.phase : '';
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
    const toolName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'tool';
    const runId = typeof payload.runId === 'string' && payload.runId.trim()
        ? payload.runId.trim()
        : sessionKey;
    const seq = typeof payload.seq === 'number' && Number.isFinite(payload.seq)
        ? payload.seq
        : Date.now();
    const timestamp = typeof payload.ts === 'number' && Number.isFinite(payload.ts)
        ? new Date(payload.ts).toISOString()
        : new Date().toISOString();
    const agentId = parseAgentIdFromSessionKey(sessionKey) || undefined;
    const metadata: Record<string, unknown> = {
        transient: true,
        runId,
        seq,
        stream: 'tool',
        phase
    };

    if (phase === 'start') {
        return {
            id: `${runId}:tool:start:${toolCallId || toolName}:${seq}`,
            role: 'assistant',
            content: '',
            timestamp,
            agentId,
            parts: [{
                type: 'toolCall',
                id: toolCallId,
                name: toolName,
                arguments: data.args
            }],
            metadata: {
                ...metadata,
                stopReason: 'toolUse'
            }
        };
    }

    if (phase === 'result') {
        const resultText = extractTextContent(data.result);
        const isError = Boolean(data.isError);
        return {
            id: `${runId}:tool:result:${toolCallId || toolName}:${seq}`,
            role: 'tool',
            content: resultText,
            timestamp,
            agentId,
            parts: [{
                type: 'toolResult',
                toolCallId,
                name: toolName,
                arguments: data.args,
                result: resultText,
                details: data.result,
                isError
            }],
            toolCallId,
            toolName,
            toolArguments: data.args,
            toolDetails: data.result,
            isError,
            metadata
        };
    }

    return null;
}

function buildSessionKeyMap(sessions: OpenClawSessionsListEntry[]): Map<string, string> {
    const map = new Map<string, string>();

    for (const session of [...sessions].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))) {
        const agentId = session.agentId || parseAgentIdFromSessionKey(session.key);
        if (!agentId || map.has(agentId)) {
            continue;
        }

        map.set(agentId, session.key);
    }

    return map;
}

function resolvePreferredAgentId(
    records: OpenClawAgentRecord[],
    gatewayAgents: OpenClawGatewayAgentsResult,
    sessionKeysByAgent: Map<string, string>
): string | null {
    for (const agentId of sessionKeysByAgent.keys()) {
        return agentId;
    }

    const defaultId = gatewayAgents.defaultId?.trim();
    if (defaultId) {
        return defaultId;
    }

    const explicitDefault = records.find(record => record.isDefault)?.id?.trim();
    if (explicitDefault) {
        return explicitDefault;
    }

    return records[0]?.id || null;
}

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
    const normalized = sessionKey.trim();
    if (!normalized) {
        return null;
    }

    const parts = normalized.split(':').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'agent') {
        return null;
    }

    const agentId = parts[1]?.trim();
    return agentId || null;
}

function normalizeOpenClawChatHistory(messages: OpenClawChatHistoryMessage[], sessionKey: string): ChatMessage[] {
    const agentId = parseAgentIdFromSessionKey(sessionKey) || undefined;
    const toolCalls = new Map<string, OpenClawToolCallInfo>();

    return messages
        .map((message, index) => normalizeOpenClawChatMessage(message, `${sessionKey}:${index}`, agentId, toolCalls))
        .filter((message): message is ChatMessage => Boolean(message));
}

function normalizeOpenClawChatMessage(
    message: OpenClawChatHistoryMessage,
    fallbackId: string,
    agentId?: string,
    toolCalls: Map<string, OpenClawToolCallInfo> = new Map()
): ChatMessage | null {
    const role = normalizeRole(message.role);
    if (!role) {
        return null;
    }

    if (role === 'tool') {
        const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
        const storedToolCall = toolCallId ? toolCalls.get(toolCallId) : undefined;
        const toolName = typeof message.toolName === 'string'
            ? message.toolName
            : storedToolCall?.name || 'tool';
        const resultText = extractTextContent(message.content) || (typeof message.text === 'string' ? message.text : '');

        return {
            id: fallbackId,
            role: 'tool',
            content: resultText,
            timestamp: normalizeTimestamp(message.timestamp),
            agentId,
            parts: [{
                type: 'toolResult',
                toolCallId,
                name: toolName,
                arguments: storedToolCall?.arguments,
                result: resultText,
                details: message.details,
                isError: Boolean(message.isError)
            }],
            toolCallId,
            toolName,
            toolArguments: storedToolCall?.arguments,
            toolDetails: message.details,
            isError: Boolean(message.isError),
            metadata: extractMessageMetadata(message)
        };
    }

    const parts = normalizeOpenClawMessageParts(message.content);
    for (const part of parts) {
        if (part.type === 'toolCall' && part.id) {
            toolCalls.set(part.id, {
                name: part.name,
                arguments: part.arguments
            });
        }
    }

    return {
        id: fallbackId,
        role,
        content: buildDisplayContentFromParts(parts, message),
        timestamp: normalizeTimestamp(message.timestamp),
        agentId,
        parts,
        metadata: extractMessageMetadata(message)
    };
}

function normalizeRole(value: unknown): ChatMessage['role'] | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.toLowerCase();
    if (normalized === 'user' || normalized === 'assistant' || normalized === 'system') {
        return normalized;
    }

    if (normalized === 'toolresult') {
        return 'tool';
    }

    return null;
}

function normalizeTimestamp(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }

    if (typeof value === 'string' && value.trim()) {
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }

    return new Date().toISOString();
}

function extractAssistantMessageFromPayload(payload: unknown, sessionKey: string): ChatMessage | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const record = payload as Record<string, unknown>;
    const toolCalls = new Map<string, OpenClawToolCallInfo>();
    if (Array.isArray(record.messages)) {
        const candidate = [...record.messages]
            .reverse()
            .map((message, index) => {
                if (!message || typeof message !== 'object') {
                    return null;
                }

                return normalizeOpenClawChatMessage(
                    message as OpenClawChatHistoryMessage,
                    `${sessionKey}:payload:${index}`,
                    parseAgentIdFromSessionKey(sessionKey) || undefined,
                    toolCalls
                );
            })
            .find((message): message is ChatMessage => {
                return message !== null && message.role === 'assistant';
            });

        if (candidate) {
            return candidate;
        }
    }

    if (record.message && typeof record.message === 'object') {
        const candidate = normalizeOpenClawChatMessage(
            record.message as OpenClawChatHistoryMessage,
            `${sessionKey}:payload`,
            parseAgentIdFromSessionKey(sessionKey) || undefined,
            toolCalls
        );
        if (candidate?.role === 'assistant') {
            return candidate;
        }
    }

    const role = normalizeRole(record.role);
    if (role === 'assistant') {
        const parts = normalizeOpenClawMessageParts(record.content);
        return {
            id: `${sessionKey}:payload`,
            role,
            content: buildDisplayContentFromParts(parts, record),
            timestamp: normalizeTimestamp(record.timestamp),
            agentId: parseAgentIdFromSessionKey(sessionKey) || undefined,
            parts,
            metadata: extractRecordMetadata(record)
        };
    }

    if (record.final && typeof record.final === 'object') {
        return extractAssistantMessageFromPayload(record.final, sessionKey);
    }

    return null;
}

function normalizeOpenClawSessionLog(
    content: string,
    sessionKey: string,
    agentId?: string,
    limit: number = 200
): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const toolCalls = new Map<string, OpenClawToolCallInfo>();
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) {
            continue;
        }

        let entry: OpenClawSessionLogEntry | null = null;
        try {
            entry = JSON.parse(line) as OpenClawSessionLogEntry;
        } catch {
            continue;
        }

        if (entry?.type !== 'message' || !entry.message) {
            continue;
        }

        const normalized = normalizeOpenClawChatMessage(
            {
                ...entry.message,
                timestamp: entry.message.timestamp ?? entry.timestamp
            },
            entry.id || `${sessionKey}:log:${index}`,
            agentId,
            toolCalls
        );

        if (normalized) {
            messages.push(normalized);
        }
    }

    if (limit <= 0 || messages.length <= limit) {
        return messages;
    }

    return messages.slice(-limit);
}

function normalizeOpenClawMessageParts(content: unknown): ChatMessagePart[] {
    const values = Array.isArray(content) ? content : [content];
    const parts: ChatMessagePart[] = [];

    for (const value of values) {
        if (typeof value === 'string') {
            if (value) {
                parts.push({ type: 'text', text: value });
            }
            continue;
        }

        if (!value || typeof value !== 'object') {
            continue;
        }

        const record = value as Record<string, unknown>;
        const type = typeof record.type === 'string' ? record.type : '';

        if (type === 'text' && typeof record.text === 'string') {
            parts.push({
                type: 'text',
                text: record.text
            });
            continue;
        }

        if (type === 'thinking' && typeof record.thinking === 'string') {
            parts.push({
                type: 'thinking',
                thinking: record.thinking,
                thinkingSignature: typeof record.thinkingSignature === 'string' ? record.thinkingSignature : undefined
            });
            continue;
        }

        if (type === 'toolCall') {
            parts.push({
                type: 'toolCall',
                id: typeof record.id === 'string' ? record.id : undefined,
                name: typeof record.name === 'string' ? record.name : 'tool',
                arguments: record.arguments
            });
            continue;
        }

        const text = extractTextContent(record);
        if (text) {
            parts.push({
                type: 'text',
                text
            });
        }
    }

    return parts;
}

function buildDisplayContentFromParts(parts: ChatMessagePart[], message: Record<string, unknown>): string {
    const text = parts
        .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
        .map(part => part.text)
        .join('');
    if (text) {
        return text;
    }

    const thinking = parts
        .filter((part): part is Extract<ChatMessagePart, { type: 'thinking' }> => part.type === 'thinking')
        .map(part => part.thinking)
        .join('\n\n');
    if (thinking) {
        return thinking;
    }

    return extractTextContent(message.content) || (typeof message.text === 'string' ? message.text : '');
}

function extractMessageMetadata(message: OpenClawChatHistoryMessage): Record<string, unknown> | undefined {
    const metadata = extractRecordMetadata(message as Record<string, unknown>);
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractRecordMetadata(record: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    for (const key of ['api', 'provider', 'model', 'usage', 'stopReason', 'thinkingLevel']) {
        if (record[key] !== undefined) {
            metadata[key] = record[key];
        }
    }

    return metadata;
}

function isFinalOpenClawAssistantMessage(message: ChatMessage): boolean {
    if (message.role !== 'assistant') {
        return false;
    }

    if (message.metadata?.stopReason === 'toolUse') {
        return false;
    }

    return true;
}

function mapOpenClawUsage(
    sessionsUsage: OpenClawSessionsUsageResult,
    usageCost: OpenClawUsageCostResult | null,
    agentId?: string
): APIUsage {
    const sessions = (sessionsUsage.sessions || []).filter(session => !agentId || session.agentId === agentId);
    const currency = inferCurrencyFromHints(
        sessions.flatMap(session => [session.modelProvider || '', session.model || ''])
    );
    const usage = createEmptyUsage(currency);

    for (const session of sessions) {
        const sessionUsage = session.usage;
        const promptTokens = sessionUsage?.input || 0;
        const completionTokens = sessionUsage?.output || 0;
        const totalTokens = sessionUsage?.totalTokens || promptTokens + completionTokens;
        const totalCost = sessionUsage?.totalCost || 0;
        const requestCount = sessionUsage?.messageCounts?.user
            || sessionUsage?.messageCounts?.total
            || 0;
        const modelKey = session.model || session.modelProvider || 'unknown';

        usage.totalRequests += requestCount;
        usage.promptTokens += promptTokens;
        usage.completionTokens += completionTokens;
        usage.totalTokens += totalTokens;
        usage.cost += totalCost;

        const modelStats = usage.byModel[modelKey] || { requests: 0, tokens: 0, cost: 0 };
        modelStats.requests += requestCount;
        modelStats.tokens += totalTokens;
        modelStats.cost += totalCost;
        usage.byModel[modelKey] = modelStats;

        const requestsByDay = new Map<string, number>();
        for (const messageCounts of sessionUsage?.dailyMessageCounts || []) {
            const date = messageCounts.date?.trim();
            if (!date) {
                continue;
            }

            requestsByDay.set(date, (requestsByDay.get(date) || 0) + (messageCounts.user || messageCounts.total || 0));
        }

        for (const daily of sessionUsage?.dailyBreakdown || []) {
            const date = daily.date?.trim();
            if (!date) {
                continue;
            }

            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            dayStats.tokens += daily.tokens || 0;
            dayStats.cost = (dayStats.cost || 0) + (daily.cost || 0);
            dayStats.requests += requestsByDay.get(date) || 0;
            usage.byDay[date] = dayStats;

            const modelByDay = usage.byModelByDay ||= {};
            modelByDay[date] ||= {};
            const dayModelStats = modelByDay[date][modelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayModelStats.tokens += daily.tokens || 0;
            dayModelStats.cost += daily.cost || 0;
            dayModelStats.requests += requestsByDay.get(date) || 0;
            modelByDay[date][modelKey] = dayModelStats;
            requestsByDay.delete(date);
        }

        for (const [date, requests] of requestsByDay.entries()) {
            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            dayStats.requests += requests;
            usage.byDay[date] = dayStats;

            const modelByDay = usage.byModelByDay ||= {};
            modelByDay[date] ||= {};
            const dayModelStats = modelByDay[date][modelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayModelStats.requests += requests;
            modelByDay[date][modelKey] = dayModelStats;
        }
    }

    if (!agentId) {
        const totals = usageCost?.totals;
        if (typeof totals?.input === 'number') {
            usage.promptTokens = totals.input;
        }
        if (typeof totals?.output === 'number') {
            usage.completionTokens = totals.output;
        }
        if (typeof totals?.totalTokens === 'number') {
            usage.totalTokens = totals.totalTokens;
        }
        if (typeof totals?.totalCost === 'number') {
            usage.cost = totals.totalCost;
        }

        for (const day of usageCost?.daily || []) {
            const date = day.date?.trim();
            if (!date) {
                continue;
            }

            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            if (typeof day.totalTokens === 'number') {
                dayStats.tokens = day.totalTokens;
            }
            if (typeof day.totalCost === 'number') {
                dayStats.cost = day.totalCost;
            }
            usage.byDay[date] = dayStats;
        }
    }

    if (usage.totalRequests === 0) {
        usage.totalRequests = sessionsUsage.aggregates?.messages?.user
            || sessionsUsage.aggregates?.messages?.total
            || 0;
    }

    return usage;
}

function inferCurrencyFromHints(hints: string[]): { code: string; symbol: string } | undefined {
    const normalized = hints
        .map(hint => hint.trim().toLowerCase())
        .filter(Boolean);

    if (normalized.length > 0 && normalized.every(hint => hint.includes('moonshot') || hint.includes('kimi'))) {
        return { code: 'CNY', symbol: '¥' };
    }

    return undefined;
}

function uniqueModelNames(values: Array<string | undefined | null>): string[] {
    const models: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const model = value?.trim();
        if (!model || seen.has(model)) {
            continue;
        }

        seen.add(model);
        models.push(model);
    }

    return models;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    if (timeoutMs <= 0) {
        return Promise.resolve(fallback);
    }

    return new Promise<T>(resolve => {
        const timer = setTimeout(() => resolve(fallback), timeoutMs);

        promise
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve(fallback);
            });
    });
}

function delay(timeoutMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

function sanitizeAgentName(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    return normalized.replace(/^-|-$/g, '') || 'agent';
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function resolveOpenClawRecordWorkspacePath(
    record: OpenClawAgentRecord,
    config: OpenClawCliServiceConfig | null
): string | undefined {
    return normalizeOptionalPath(record.workspace)
        || normalizeOptionalPath(record.agentDir)
        || inferOpenClawWorkspacePath(record.id, config);
}

function inferOpenClawWorkspacePath(
    agentId: string | undefined,
    config: OpenClawCliServiceConfig | null
): string | undefined {
    const normalizedAgentId = normalizeOptionalPath(agentId);
    if (!normalizedAgentId || !config) {
        return undefined;
    }

    const safeAgentId = sanitizeAgentName(normalizedAgentId);
    if (!config.defaultWorkspacePath) {
        return path.join(config.stateDir, 'workspace', safeAgentId);
    }

    return path.join(path.dirname(config.defaultWorkspacePath), 'agents', safeAgentId);
}

function extractString(payload: unknown, keys: string[]): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const record = payload as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}
