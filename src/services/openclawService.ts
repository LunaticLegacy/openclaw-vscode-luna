import { EventEmitter } from 'events';
import { t } from '../i18n';
import {
    OpenClawCliServiceConfig,
    ResolvedServiceConfig
} from './openclawConfig';
import { GatewayTransport } from './openclaw/gatewayTransport';
import { LocalModeRuntime } from './openclaw/localModeRuntime';
import { OpenClawModeRuntime } from './openclaw/openclawModeRuntime';
import { uniqueModelNames } from './openclaw/usageService';
import type {
    Agent,
    AgentCluster,
    APIUsage,
    ChatMessage,
    ChatSession,
    CreateAgentParams,
    CreateClusterParams,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    StreamChunk,
    StreamMessageOptions,
    UpdateAgentParams,
    UpdateClusterParams
} from './openclaw/types';

export type {
    Agent,
    AgentCluster,
    APIUsage,
    ChatMessage,
    ChatMessagePart,
    ChatSession,
    CreateAgentParams,
    CreateClusterParams,
    LocalAgent,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    StreamChunk,
    StreamMessageOptions,
    UpdateAgentParams,
    UpdateClusterParams
} from './openclaw/types';

export class OpenClawService extends EventEmitter {
    private transport: GatewayTransport | null = null;
    private localRuntime: LocalModeRuntime | null = null;
    private openClawRuntime: OpenClawModeRuntime | null = null;
    private mode: ResolvedServiceConfig['mode'] = 'gateway';
    private sourceDescription = '';
    private connected = false;

    constructor(config: ResolvedServiceConfig) {
        super();
        this.applyConfig(config);
    }

    public updateConfig(config: ResolvedServiceConfig): void {
        this.applyConfig(config);
    }

    public async checkConnection(): Promise<boolean> {
        const connected = await this.getConnectionProbe();
        this.connected = connected;
        this.emit('connectionChange', connected);
        return connected;
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public supportsRemoteClusters(): boolean {
        return this.mode === 'gateway';
    }

    public async getPreferredAgentId(): Promise<string | null> {
        if (this.localRuntime) {
            return this.localRuntime.getPreferredAgentId();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getPreferredAgentId();
        }

        const agents = await this.getAgents();
        return agents[0]?.id ?? null;
    }

    public async getAgents(): Promise<Agent[]> {
        if (this.localRuntime) {
            return this.localRuntime.getAgents();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getAgents();
        }

        const response = await this.requireTransport().get<{ agents?: Agent[] }>('/api/agents');
        return response.agents || [];
    }

    public async getAvailableModels(agents?: Agent[]): Promise<string[]> {
        if (this.localRuntime) {
            return this.localRuntime.getAvailableModels(agents);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getAvailableModels(agents);
        }

        const sourceAgents = agents || await this.getAgents();
        return uniqueModelNames(sourceAgents.map(agent => agent.model));
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        if (this.localRuntime) {
            return this.localRuntime.getAgent(agentId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getAgent(agentId);
        }

        try {
            return await this.requireTransport().get<Agent>(`/api/agents/${agentId}`);
        } catch (error) {
            if ((error as { status?: number }).status === 404) {
                return null;
            }
            throw error;
        }
    }

    public async resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        if (this.localRuntime) {
            return this.localRuntime.resolveAgentFolderPath(agentOrId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.resolveAgentFolderPath(agentOrId);
        }

        const agent = typeof agentOrId === 'string'
            ? await this.getAgent(agentOrId)
            : agentOrId;
        return agent?.workspacePath?.trim() || undefined;
    }

    public async createAgent(params: CreateAgentParams): Promise<Agent> {
        if (this.localRuntime) {
            return this.localRuntime.createAgent(params);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.createAgent(params);
        }

        const response = await this.requireTransport().post<Agent>('/api/agents', params);
        this.emit('agentCreated', response);
        return response;
    }

    public async updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        if (this.localRuntime) {
            return this.localRuntime.updateAgent(agentId, params);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.updateAgent(agentId, params);
        }

        const response = await this.requireTransport().patch<Agent>(`/api/agents/${agentId}`, params);
        this.emit('agentUpdated', response);
        return response;
    }

    public async deleteAgent(agentId: string): Promise<void> {
        if (this.localRuntime) {
            return this.localRuntime.deleteAgent(agentId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.deleteAgent(agentId);
        }

        await this.requireTransport().delete(`/api/agents/${agentId}`);
        this.emit('agentDeleted', agentId);
    }

    public async createChatSession(agentId: string): Promise<ChatSession> {
        if (this.localRuntime) {
            return this.localRuntime.createChatSession(agentId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.createChatSession(agentId);
        }

        return this.requireTransport().post<ChatSession>('/api/sessions', { agentId });
    }

    public async sendMessage(
        sessionId: string,
        message: string,
        options?: SendMessageOptions
    ): Promise<ChatMessage> {
        if (this.localRuntime) {
            return this.localRuntime.sendMessage(sessionId, message, options);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.sendMessage(sessionId, message, options);
        }

        return this.requireTransport().post<ChatMessage>(`/api/sessions/${sessionId}/messages`, {
            content: message,
            ...options
        });
    }

    public async *streamMessage(
        sessionId: string,
        message: string,
        options?: StreamMessageOptions
    ): AsyncGenerator<StreamChunk, void, unknown> {
        if (this.localRuntime) {
            yield* this.localRuntime.streamMessage(sessionId, message, options);
            return;
        }

        if (this.openClawRuntime) {
            yield* this.openClawRuntime.streamMessage(sessionId, message);
            return;
        }

        const stream = await this.requireTransport().postStream(
            `/api/sessions/${sessionId}/messages/stream`,
            {
                content: message,
                ...options
            }
        );

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
        if (this.localRuntime) {
            return this.localRuntime.getChatHistory(sessionId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getChatHistory(sessionId);
        }

        const response = await this.requireTransport().get<{ messages?: ChatMessage[] }>(`/api/sessions/${sessionId}/messages`);
        return response.messages || [];
    }

    public supportsLiveSessionSync(): boolean {
        return this.openClawRuntime !== null;
    }

    public getMode(): ResolvedServiceConfig['mode'] {
        return this.mode;
    }

    public getSourceDescription(): string {
        return this.sourceDescription;
    }

    public supportsScheduledTasks(): boolean {
        return this.openClawRuntime !== null;
    }

    public getOpenClawConfig(): OpenClawCliServiceConfig | null {
        return this.openClawRuntime?.getConfig() || null;
    }

    public async getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        if (this.openClawRuntime) {
            return this.openClawRuntime.getLiveChatHistory(sessionId);
        }

        if (this.localRuntime) {
            return this.localRuntime.getLiveChatHistory(sessionId);
        }

        return this.getChatHistory(sessionId);
    }

    public async clearChatHistory(sessionId: string): Promise<void> {
        if (this.localRuntime) {
            return this.localRuntime.clearChatHistory(sessionId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.clearChatHistory();
        }

        await this.requireTransport().delete(`/api/sessions/${sessionId}/messages`);
    }

    public async getClusters(): Promise<AgentCluster[]> {
        if (this.mode !== 'gateway') {
            return [];
        }

        const response = await this.requireTransport().get<{ clusters?: AgentCluster[] }>('/api/clusters');
        return response.clusters || [];
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        if (this.mode !== 'gateway') {
            return null;
        }

        try {
            return await this.requireTransport().get<AgentCluster>(`/api/clusters/${clusterId}`);
        } catch (error) {
            if ((error as { status?: number }).status === 404) {
                return null;
            }
            throw error;
        }
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        if (this.mode !== 'gateway') {
            throw new Error(t('service.clustersUnavailable'));
        }

        const response = await this.requireTransport().post<AgentCluster>('/api/clusters', params);
        this.emit('clusterCreated', response);
        return response;
    }

    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        if (this.mode !== 'gateway') {
            throw new Error(t('service.clustersUnavailable'));
        }

        const response = await this.requireTransport().patch<AgentCluster>(`/api/clusters/${clusterId}`, params);
        this.emit('clusterUpdated', response);
        return response;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.mode !== 'gateway') {
            throw new Error(t('service.clustersUnavailable'));
        }

        await this.requireTransport().delete(`/api/clusters/${clusterId}`);
        this.emit('clusterDeleted', clusterId);
    }

    public async sendToCluster(clusterId: string, message: string): Promise<Record<string, ChatMessage>> {
        if (this.mode !== 'gateway') {
            throw new Error(t('service.clusterBroadcastUnavailable'));
        }

        const response = await this.requireTransport().post<{ responses?: Record<string, ChatMessage> }>(
            `/api/clusters/${clusterId}/broadcast`,
            { content: message }
        );
        return response.responses || {};
    }

    public async getUsage(): Promise<APIUsage> {
        if (this.localRuntime) {
            return this.localRuntime.getUsage();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getUsage();
        }

        return this.requireTransport().get<APIUsage>('/api/usage');
    }

    public async getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        if (this.localRuntime) {
            return this.localRuntime.getRealtimeUsage();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getRealtimeUsage();
        }

        return this.requireTransport().get<RealtimeUsageSnapshot>('/api/usage/realtime');
    }

    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        if (this.localRuntime) {
            return this.localRuntime.getUsageByAgent(agentId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getUsageByAgent(agentId);
        }

        return this.requireTransport().get<APIUsage>(`/api/agents/${agentId}/usage`);
    }

    public dispose(): void {
        this.removeAllListeners();
        this.connected = false;
        this.resetState();
    }

    private applyConfig(config: ResolvedServiceConfig): void {
        this.resetState();
        this.mode = config.mode;
        this.sourceDescription = config.sourceDescription;

        switch (config.mode) {
            case 'gateway':
                this.transport = new GatewayTransport(config, this.emit.bind(this));
                break;
            case 'local':
                this.localRuntime = new LocalModeRuntime(config, this.emit.bind(this));
                break;
            case 'openclaw':
                this.openClawRuntime = new OpenClawModeRuntime(config, this.emit.bind(this));
                break;
        }

        void this.checkConnection();
    }

    private resetState(): void {
        this.transport = null;
        this.localRuntime?.dispose();
        this.openClawRuntime?.dispose();
        this.localRuntime = null;
        this.openClawRuntime = null;
        this.sourceDescription = '';
    }

    private async getConnectionProbe(): Promise<boolean> {
        if (this.localRuntime) {
            return this.localRuntime.checkConnection();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.checkConnection();
        }

        return this.requireTransport().checkConnection();
    }

    private requireTransport(): GatewayTransport {
        if (!this.transport) {
            throw new Error(t('service.connectFailed'));
        }

        return this.transport;
    }
}
