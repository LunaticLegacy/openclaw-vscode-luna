import { EventEmitter } from 'events';
import { t } from '../i18n';
import {
    OpenClawCliServiceConfig,
    ResolvedServiceConfig
} from './openclawConfig';
import { GatewayTransport } from './openclaw/gatewayTransport';
import { LocalModeRuntime } from './openclaw/localModeRuntime';
import {
    getModeCapabilities,
    getModeCapabilityMatrix,
    isCapabilitySupported
} from './openclaw/modeCapabilities';
import type { OpenClawBooleanCapabilityId } from './openclaw/modeCapabilities';
import { OpenClawModeRuntime } from './openclaw/openclawModeRuntime';
import { uniqueModelNames } from './openclaw/usageService';
import type {
    Agent,
    AgentCluster,
    APIUsage,
    ChatMessage,
    DiscoveredChannel,
    ChatSession,
    ClusterMemberProfile,
    ClusterWorkspaceConfig,
    CreateAgentParams,
    CreateClusterParams,
    RealtimeUsageSnapshot,
    RuntimeNotice,
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
    DiscoveredChannel,
    ChatMessagePart,
    ChatSession,
    ClusterMemberProfile,
    CreateChatSessionOptions,
    ClusterWorkspaceConfig,
    CreateAgentParams,
    CreateClusterParams,
    LocalAgent,
    RealtimeUsageSnapshot,
    RuntimeNotice,
    SendMessageOptions,
    StreamChunk,
    StreamMessageOptions,
    UpdateAgentParams,
    UpdateClusterParams
} from './openclaw/types';
export type {
    OpenClawBooleanCapabilityId,
    OpenClawCapabilityId,
    OpenClawCapabilityMatrixRow,
    OpenClawModeCapabilities
} from './openclaw/modeCapabilities';

export class OpenClawService extends EventEmitter {
    private transport: GatewayTransport | null = null;
    private localRuntime: LocalModeRuntime | null = null;
    private openClawRuntime: OpenClawModeRuntime | null = null;
    private activeGatewayRequests: Map<string, Set<AbortController>> = new Map();
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
        const hasChanged = connected !== this.connected;
        this.connected = connected;
        if (hasChanged) {
            this.emit('connectionChange', connected);
        }
        return connected;
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public supportsRemoteClusters(): boolean {
        return this.getModeCapabilities().clusterTransport === 'remote';
    }

    public getModeCapabilities() {
        return getModeCapabilities(this.mode);
    }

    public getModeCapabilityMatrix() {
        return getModeCapabilityMatrix();
    }

    public supportsCapability(capabilityId: OpenClawBooleanCapabilityId): boolean {
        return isCapabilitySupported(this.mode, capabilityId);
    }

    public providesAgentActivityStatus(): boolean {
        return this.mode === 'openclaw';
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

    public async createChatSession(
        agentId: string,
        options: import('./openclaw/types').CreateChatSessionOptions = {}
    ): Promise<ChatSession> {
        if (this.localRuntime) {
            return this.localRuntime.createChatSession(agentId, options);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.createChatSession(agentId, options);
        }

        return this.requireTransport().post<ChatSession>('/api/sessions', { agentId });
    }

    public async sendMessage(
        sessionId: string,
        message: string,
        options?: SendMessageOptions
    ): Promise<ChatMessage> {
        if (this.localRuntime) {
            const response = await this.localRuntime.sendMessage(sessionId, message, options);
            this.emit('usageChanged');
            return response;
        }

        if (this.openClawRuntime) {
            const response = await this.openClawRuntime.sendMessage(sessionId, message, options);
            this.emit('usageChanged');
            return response;
        }

        const abortController = new AbortController();
        this.trackGatewayRequest(sessionId, abortController);

        try {
            const response = await this.requireTransport().post<ChatMessage>(`/api/sessions/${sessionId}/messages`, {
                content: message,
                ...options
            }, {
                signal: abortController.signal
            });
            this.emit('usageChanged');
            return response;
        } finally {
            this.untrackGatewayRequest(sessionId, abortController);
        }
    }

    public async *streamMessage(
        sessionId: string,
        message: string,
        options?: StreamMessageOptions
    ): AsyncGenerator<StreamChunk, void, unknown> {
        if (this.localRuntime) {
            try {
                yield* this.localRuntime.streamMessage(sessionId, message, options);
            } finally {
                this.emit('usageChanged');
            }
            return;
        }

        if (this.openClawRuntime) {
            try {
                yield* this.openClawRuntime.streamMessage(sessionId, message);
            } finally {
                this.emit('usageChanged');
            }
            return;
        }

        const abortController = new AbortController();
        this.trackGatewayRequest(sessionId, abortController);

        try {
            const stream = await this.requireTransport().postStream(
                `/api/sessions/${sessionId}/messages/stream`,
                {
                    content: message,
                    ...options
                },
                {
                    signal: abortController.signal
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
        } finally {
            this.untrackGatewayRequest(sessionId, abortController);
            this.emit('usageChanged');
        }
    }

    public async abortSessionRun(sessionId: string): Promise<void> {
        if (this.localRuntime) {
            await this.localRuntime.abortSessionRun(sessionId);
            return;
        }

        if (this.openClawRuntime) {
            await this.openClawRuntime.abortSessionRun(sessionId);
            return;
        }

        this.abortTrackedGatewayRequests(sessionId);

        try {
            await this.requireTransport().post(`/api/sessions/${sessionId}/abort`);
        } catch (error) {
            const status = (error as { status?: number }).status;
            if (status === 404 || status === 405 || status === 501) {
                return;
            }
            throw error;
        }
    }

    public hasActiveSessionRun(sessionId: string | null | undefined): boolean {
        const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
        if (!normalizedSessionId) {
            return false;
        }

        if (this.localRuntime) {
            return this.localRuntime.hasActiveRun(normalizedSessionId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.hasActiveRun(normalizedSessionId);
        }

        return this.activeGatewayRequests.has(normalizedSessionId);
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
        return this.supportsCapability('liveSessionSync');
    }

    public getMode(): ResolvedServiceConfig['mode'] {
        return this.mode;
    }

    public getSourceDescription(): string {
        return this.sourceDescription;
    }

    public supportsScheduledTasks(): boolean {
        return this.supportsCapability('scheduledTasks');
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
        if (!this.supportsRemoteClusters()) {
            return [];
        }

        const response = await this.requireRemoteClusterTransport().get<{ clusters?: AgentCluster[] }>('/api/clusters');
        return response.clusters || [];
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        if (!this.supportsRemoteClusters()) {
            return null;
        }

        try {
            return await this.requireRemoteClusterTransport().get<AgentCluster>(`/api/clusters/${clusterId}`);
        } catch (error) {
            if ((error as { status?: number }).status === 404) {
                return null;
            }
            throw error;
        }
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        const response = await this.requireRemoteClusterTransport('service.clustersUnavailable')
            .post<AgentCluster>('/api/clusters', params);
        this.emit('clusterCreated', response);
        return response;
    }

    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        const response = await this.requireRemoteClusterTransport('service.clustersUnavailable')
            .patch<AgentCluster>(`/api/clusters/${clusterId}`, params);
        this.emit('clusterUpdated', response);
        return response;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        await this.requireRemoteClusterTransport('service.clustersUnavailable').delete(`/api/clusters/${clusterId}`);
        this.emit('clusterDeleted', clusterId);
    }

    public async sendToCluster(clusterId: string, message: string): Promise<Record<string, ChatMessage>> {
        const response = await this.requireRemoteClusterTransport('service.clusterBroadcastUnavailable').post<{ responses?: Record<string, ChatMessage> }>(
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
        for (const sessionId of this.activeGatewayRequests.keys()) {
            this.abortTrackedGatewayRequests(sessionId);
        }
        this.resetState();
    }

    public async getDiscoveredChannels(): Promise<DiscoveredChannel[]> {
        if (this.openClawRuntime) {
            return this.openClawRuntime.getDiscoveredChannels();
        }

        return [];
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

    private requireRemoteClusterTransport(
        errorKey: 'service.clustersUnavailable' | 'service.clusterBroadcastUnavailable' = 'service.clustersUnavailable'
    ): GatewayTransport {
        if (!this.supportsRemoteClusters()) {
            throw new Error(t(errorKey));
        }

        return this.requireTransport();
    }

    private trackGatewayRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeGatewayRequests.get(normalizedSessionId) || new Set<AbortController>();
        controllers.add(controller);
        this.activeGatewayRequests.set(normalizedSessionId, controllers);
    }

    private untrackGatewayRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeGatewayRequests.get(normalizedSessionId);
        if (!controllers) {
            return;
        }

        controllers.delete(controller);
        if (controllers.size === 0) {
            this.activeGatewayRequests.delete(normalizedSessionId);
        }
    }

    private abortTrackedGatewayRequests(sessionId: string): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeGatewayRequests.get(normalizedSessionId);
        if (!controllers) {
            return;
        }

        this.activeGatewayRequests.delete(normalizedSessionId);
        for (const controller of controllers) {
            controller.abort();
        }
    }
}
