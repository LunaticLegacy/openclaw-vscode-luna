import { EventEmitter } from 'events';
import { t } from '../i18n';
import {
    OpenClawCliServiceConfig,
    ResolvedServiceConfig
} from './openclawConfig';
import {
    OutboundSendManager,
    type OutboundQueueFilter,
    type OutboundDeliveryEvent
} from './outbound';
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
    SwarmDeliveryContext,
    SwarmMode,
    SwarmRoundSnapshot,
    SwarmRunLifecycleStatus,
    SwarmRunPhase,
    SwarmRunState,
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
    SwarmDeliveryContext,
    SwarmMode,
    SwarmRoundSnapshot,
    SwarmRunLifecycleStatus,
    SwarmRunPhase,
    SwarmRunState,
    UpdateAgentParams,
    UpdateClusterParams
} from './openclaw/types';
export type {
    OpenClawBooleanCapabilityId,
    OpenClawCapabilityId,
    OpenClawCapabilityMatrixRow,
    OpenClawModeCapabilities
} from './openclaw/modeCapabilities';

/**
 * OpenClaw 核心服务类，负责与 OpenClaw 运行时（Gateway、Local、OpenClaw 模式）通信
 * 
 * 提供统一的 API 接口，包括智能体管理、会话管理、消息发送、集群管理等功能
 * 
 * @example
 * ```typescript
 * const service = new OpenClawService(config);
 * const agents = await service.getAgents();
 * ```
 */
export class OpenClawService extends EventEmitter {
    private transport: GatewayTransport | undefined = undefined;
    private localRuntime: LocalModeRuntime | undefined = undefined;
    private openClawRuntime: OpenClawModeRuntime | undefined = undefined;
    private activeGatewayRequests: Map<string, Set<AbortController>> = new Map();
    private mode: ResolvedServiceConfig['mode'] = 'gateway';
    private sourceDescription = '';
    private connected = false;
    private outboundManager: OutboundSendManager;

    /**
     * 创建 OpenClaw 服务实例
     * @param config - 已解析的服务配置
     */
    constructor(config: ResolvedServiceConfig) {
        super();
        this.outboundManager = new OutboundSendManager();
        this.outboundManager.on('deliveryEvent', (event: OutboundDeliveryEvent) => {
            this.emit('deliveryEvent', event);
        });
        this.applyConfig(config);
    }

    /**
     * 更新服务配置
     * @param config - 新的服务配置
     */
    public updateConfig(config: ResolvedServiceConfig): void {
        this.applyConfig(config);
    }

    /**
     * 检查与后端的连接状态
     * @returns 连接是否可用
     */
    public async checkConnection(): Promise<boolean> {
        const connected = await this.getConnectionProbe();
        const hasChanged = connected !== this.connected;
        this.connected = connected;
        if (hasChanged) {
            this.emit('connectionChange', connected);
        }
        return connected;
    }

    /**
     * 获取当前连接状态
     * @returns 是否已连接
     */
    public isConnected(): boolean {
        return this.connected;
    }

    /**
     * 检查是否支持远程集群功能
     * @returns 是否支持远程集群
     */
    public supportsRemoteClusters(): boolean {
        return this.getModeCapabilities().clusterTransport === 'remote';
    }

    /**
     * 获取当前运行模式的能力列表
     * @returns 模式能力配置对象
     */
    public getModeCapabilities() {
        return getModeCapabilities(this.mode);
    }

    /**
     * 获取所有运行模式的能力矩阵
     * @returns 各模式能力矩阵
     */
    public getModeCapabilityMatrix() {
        return getModeCapabilityMatrix();
    }

    /**
     * 检查当前模式是否支持特定能力
     * @param capabilityId - 能力标识符
     * @returns 是否支持该能力
     */
    public supportsCapability(capabilityId: OpenClawBooleanCapabilityId): boolean {
        return isCapabilitySupported(this.mode, capabilityId);
    }

    /**
     * 检查是否提供智能体活动状态
     * @returns 是否支持活动状态报告
     */
    public providesAgentActivityStatus(): boolean {
        return this.mode === 'openclaw';
    }

    /**
     * 获取首选智能体 ID
     * @returns 首选智能体 ID，如果没有则返回 undefined
     */
    public async getPreferredAgentId(): Promise<string | undefined> {
        if (this.localRuntime) {
            return this.localRuntime.getPreferredAgentId();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getPreferredAgentId();
        }

        const agents = await this.getAgents();
        return agents[0]?.id ?? undefined;
    }

    /**
     * 获取所有智能体列表
     * @returns 智能体数组
     */
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

    /**
     * 获取可用的模型列表
     * @param agents - 可选的智能体列表，用于从中提取模型
     * @returns 唯一的模型名称数组
     */
    public async getAvailableModels(agents?: Agent[]): Promise<string[]> {
        if (this.localRuntime) {
            return this.localRuntime.getAvailableModels(agents);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getAvailableModels(agents);
        }

        const sourceAgents = agents || await this.getAgents();
        return uniqueModelNames(sourceAgents.map((agent: any) => agent.model));
    }

    /**
     * 获取指定智能体信息
     * @param agentId - 智能体 ID
     * @returns 智能体对象，如果不存在则返回 undefined
     */
    public async getAgent(agentId: string): Promise<Agent | undefined> {
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
                return undefined;
            }
            throw error;
        }
    }

    /**
     * 解析智能体工作目录路径
     * @param agentOrId - 智能体 ID 或智能体对象
     * @returns 工作目录路径
     */
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

    /**
     * 创建新智能体
     * @param params - 创建智能体参数
     * @returns 创建的智能体对象
     * @throws Error - 创建失败时抛出
     */
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

    /**
     * 更新智能体配置
     * @param agentId - 智能体 ID
     * @param params - 更新参数
     * @returns 更新后的智能体对象
     * @throws Error - 更新失败时抛出
     */
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

    /**
     * 删除智能体
     * @param agentId - 智能体 ID
     * @throws Error - 删除失败时抛出
     */
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

    /**
     * 创建聊天会话
     * @param agentId - 关联的智能体 ID
     * @param options - 会话创建选项
     * @returns 创建的会话对象
     */
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

    /**
     * 发送消息到会话
     * @param sessionId - 会话 ID
     * @param message - 消息内容
     * @param options - 发送选项
     * @returns 发送的消息对象
     * @throws Error - 发送失败时抛出
     */
    public async sendMessage(
        sessionId: string,
        message: string,
        options?: SendMessageOptions
    ): Promise<ChatMessage> {
        const normalizedSessionId = String(sessionId || '').trim();
        const normalizedMessage = String(message ?? '');
        const delivery = options?.delivery;
        const timeoutMs = options?.timeoutMs;
        const ttlMs = options?.ttlMs;
        const idempotencyKey = options?.idempotencyKey;
        const laneKey = options?.laneKey || normalizedSessionId || 'chat';

        const transportOptions: SendMessageOptions = {
            temperature: options?.temperature,
            maxTokens: options?.maxTokens
        };

        const response = await this.outboundManager.enqueue<ChatMessage>({
            laneKey,
            sessionKey: normalizedSessionId || undefined,
            payloadSummary: `chat:${normalizedSessionId || 'unknown'}`,
            payload: { sessionId: normalizedSessionId, content: normalizedMessage },
            idempotencyKey,
            timeoutMs,
            ttlMs,
            swarm: delivery,
            requiresDeliveryForProgress: delivery?.requiresDeliveryForProgress,
            transactionGroupId: delivery?.transactionGroupId,
            expectedGroupSize: delivery?.expectedGroupSize,
            groupCompletionPolicy: delivery?.groupCompletionPolicy,
            dispatch: async ({ idempotencyKey: resolvedKey, abortController }: any) => {
                if (this.localRuntime) {
                    const response = await this.localRuntime.sendMessage(normalizedSessionId, normalizedMessage, transportOptions);
                    this.emit('usageChanged');
                    return response;
                }

                if (this.openClawRuntime) {
                    const response = await this.openClawRuntime.sendMessage(normalizedSessionId, normalizedMessage, transportOptions);
                    this.emit('usageChanged');
                    return response;
                }

                this.trackGatewayRequest(normalizedSessionId, abortController);
                try {
                    const response = await this.requireTransport().post<ChatMessage>(
                        `/api/sessions/${normalizedSessionId}/messages`,
                        {
                            content: normalizedMessage,
                            ...transportOptions
                        },
                        {
                            signal: abortController.signal,
                            headers: {
                                'Idempotency-Key': resolvedKey
                            }
                        }
                    );
                    this.emit('usageChanged');
                    return response;
                } finally {
                    this.untrackGatewayRequest(normalizedSessionId, abortController);
                }
            }
        });

        return response;
    }

    /**
     * 流式发送消息到会话
     * @param sessionId - 会话 ID
     * @param message - 消息内容
     * @param options - 流式发送选项
     * @yields 流式响应块
     */
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

    /**
     * 中止会话运行
     * @param sessionId - 会话 ID
     * @throws Error - 中止失败时抛出
     */
    public async abortSessionRun(sessionId: string): Promise<void> {
        this.outboundManager.cancelBySession(sessionId, 'Abort requested');
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

    /**
     * 检查会话是否有活跃的运行
     * @param sessionId - 会话 ID
     * @returns 是否有活跃运行
     */
    /**
     * Cancels every queued or retrying delivery for a swarm run.
     */
    public cancelSwarmRun(swarmRunId: string, reason: string = 'Swarm run cancelled'): number {
        return this.outboundManager.cancelBySwarmRun(swarmRunId, reason);
    }

    public hasActiveSessionRun(sessionId: string | undefined): boolean {
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

    /**
     * Lists outbound delivery entries for observability.
     * @param filter - Optional delivery filter
     */
    public getOutboundDeliveries(filter: OutboundQueueFilter = {}): ReturnType<OutboundSendManager['listEntries']> {
        return this.outboundManager.listEntries(filter);
    }

    /**
     * 获取会话的聊天历史
     * @param sessionId - 会话 ID
     * @returns 消息数组
     */
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

    /**
     * 检查是否支持实时会话同步
     * @returns 是否支持实时同步
     */
    public supportsLiveSessionSync(): boolean {
        return this.supportsCapability('liveSessionSync');
    }

    /**
     * 获取当前运行模式
     * @returns 运行模式标识
     */
    public getMode(): ResolvedServiceConfig['mode'] {
        return this.mode;
    }

    /**
     * 获取服务源描述
     * @returns 源描述字符串
     */
    public getSourceDescription(): string {
        return this.sourceDescription;
    }

    /**
     * 检查是否支持定时任务
     * @returns 是否支持定时任务
     */
    public supportsScheduledTasks(): boolean {
        return this.supportsCapability('scheduledTasks');
    }

    /**
     * 获取 OpenClaw 配置
     * @returns OpenClaw CLI 服务配置，如果不适用则返回 undefined
     */
    public getOpenClawConfig(): OpenClawCliServiceConfig | undefined {
        return this.openClawRuntime?.getConfig() || undefined;
    }

    /**
     * 获取实时聊天历史
     * @param sessionId - 会话 ID
     * @returns 消息数组
     */
    public async getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        if (this.openClawRuntime) {
            return this.openClawRuntime.getLiveChatHistory(sessionId);
        }

        if (this.localRuntime) {
            return this.localRuntime.getLiveChatHistory(sessionId);
        }

        return this.getChatHistory(sessionId);
    }

    /**
     * 清空会话聊天历史
     * @param sessionId - 会话 ID
     */
    public async clearChatHistory(sessionId: string): Promise<void> {
        if (this.localRuntime) {
            return this.localRuntime.clearChatHistory(sessionId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.clearChatHistory();
        }

        await this.requireTransport().delete(`/api/sessions/${sessionId}/messages`);
    }

    /**
     * 获取所有集群列表
     * @returns 集群数组
     * @throws Error - 集群功能不可用时抛出
     */
    public async getClusters(): Promise<AgentCluster[]> {
        if (!this.supportsRemoteClusters()) {
            return [];
        }

        const response = await this.requireRemoteClusterTransport().get<{ clusters?: AgentCluster[] }>('/api/clusters');
        return response.clusters || [];
    }

    /**
     * 获取指定集群信息
     * @param clusterId - 集群 ID
     * @returns 集群对象，如果不存在则返回 undefined
     * @throws Error - 集群功能不可用时抛出
     */
    public async getCluster(clusterId: string): Promise<AgentCluster | undefined> {
        if (!this.supportsRemoteClusters()) {
            return undefined;
        }

        try {
            return await this.requireRemoteClusterTransport().get<AgentCluster>(`/api/clusters/${clusterId}`);
        } catch (error) {
            if ((error as { status?: number }).status === 404) {
                return undefined;
            }
            throw error;
        }
    }

    /**
     * 创建新集群
     * @param params - 创建集群参数
     * @returns 创建的集群对象
     * @throws Error - 创建失败时抛出
     */
    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        const response = await this.requireRemoteClusterTransport('service.clustersUnavailable')
            .post<AgentCluster>('/api/clusters', params);
        this.emit('clusterCreated', response);
        return response;
    }

    /**
     * 更新集群配置
     * @param clusterId - 集群 ID
     * @param params - 更新参数
     * @returns 更新后的集群对象
     * @throws Error - 更新失败时抛出
     */
    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        const response = await this.requireRemoteClusterTransport('service.clustersUnavailable')
            .patch<AgentCluster>(`/api/clusters/${clusterId}`, params);
        this.emit('clusterUpdated', response);
        return response;
    }

    /**
     * 删除集群
     * @param clusterId - 集群 ID
     * @throws Error - 删除失败时抛出
     */
    public async deleteCluster(clusterId: string): Promise<void> {
        await this.requireRemoteClusterTransport('service.clustersUnavailable').delete(`/api/clusters/${clusterId}`);
        this.emit('clusterDeleted', clusterId);
    }

    /**
     * 向集群广播消息
     * @param clusterId - 集群 ID
     * @param message - 消息内容
     * @returns 各成员响应映射
     * @throws Error - 广播失败时抛出
     */
    public async sendToCluster(
        clusterId: string,
        message: string,
        options: {
            delivery?: SendMessageOptions['delivery'];
            timeoutMs?: number;
            ttlMs?: number;
            idempotencyKey?: string;
            laneKey?: string;
        } = {}
    ): Promise<Record<string, ChatMessage>> {
        const normalizedClusterId = String(clusterId || '').trim();
        const normalizedMessage = String(message ?? '');
        const response = await this.outboundManager.enqueue<{ responses?: Record<string, ChatMessage> }>({
            laneKey: options.laneKey || `cluster:${normalizedClusterId || 'unknown'}`,
            payloadSummary: `cluster:${normalizedClusterId || 'unknown'}:broadcast`,
            payload: { clusterId: normalizedClusterId, content: normalizedMessage },
            idempotencyKey: options.idempotencyKey,
            timeoutMs: options.timeoutMs,
            ttlMs: options.ttlMs,
            swarm: options.delivery,
            requiresDeliveryForProgress: options.delivery?.requiresDeliveryForProgress,
            transactionGroupId: options.delivery?.transactionGroupId,
            expectedGroupSize: options.delivery?.expectedGroupSize,
            groupCompletionPolicy: options.delivery?.groupCompletionPolicy,
            dispatch: async ({ idempotencyKey, abortController }: any) => {
                return this.requireRemoteClusterTransport('service.clusterBroadcastUnavailable').post<{ responses?: Record<string, ChatMessage> }>(
                    `/api/clusters/${normalizedClusterId}/broadcast`,
                    { content: normalizedMessage },
                    {
                        signal: abortController.signal,
                        headers: {
                            'Idempotency-Key': idempotencyKey
                        }
                    }
                );
            }
        });
        return response.responses || {};
    }

    /**
     * 获取 API 使用量统计
     * @returns API 使用量数据
     */
    public async getUsage(): Promise<APIUsage> {
        if (this.localRuntime) {
            return this.localRuntime.getUsage();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getUsage();
        }

        return this.requireTransport().get<APIUsage>('/api/usage');
    }

    /**
     * 获取实时使用量快照
     * @returns 实时使用量数据
     */
    public async getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        if (this.localRuntime) {
            return this.localRuntime.getRealtimeUsage();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getRealtimeUsage();
        }

        return this.requireTransport().get<RealtimeUsageSnapshot>('/api/usage/realtime');
    }

    /**
     * 获取指定智能体的使用量统计
     * @param agentId - 智能体 ID
     * @returns 该智能体的 API 使用量
     */
    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        if (this.localRuntime) {
            return this.localRuntime.getUsageByAgent(agentId);
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.getUsageByAgent(agentId);
        }

        return this.requireTransport().get<APIUsage>(`/api/agents/${agentId}/usage`);
    }

    /**
     * 释放服务资源
     */
    public dispose(): void {
        this.removeAllListeners();
        this.connected = false;
        for (const sessionId of this.activeGatewayRequests.keys()) {
            this.abortTrackedGatewayRequests(sessionId);
        }
        this.resetState();
    }

    /**
     * 获取已发现的频道列表
     * @returns 发现的频道数组
     */
    public async getDiscoveredChannels(): Promise<DiscoveredChannel[]> {
        if (this.openClawRuntime) {
            return this.openClawRuntime.getDiscoveredChannels();
        }

        return [];
    }

    /**
     * 应用服务配置
     * @param config - 已解析的服务配置
     */
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

    /**
     * 重置服务状态
     */
    private resetState(): void {
        this.transport = undefined;
        this.localRuntime?.dispose();
        this.openClawRuntime?.dispose();
        this.localRuntime = undefined;
        this.openClawRuntime = undefined;
        this.sourceDescription = '';
    }

    /**
     * 执行连接探测
     * @returns 连接是否可用
     */
    private async getConnectionProbe(): Promise<boolean> {
        if (this.localRuntime) {
            return this.localRuntime.checkConnection();
        }

        if (this.openClawRuntime) {
            return this.openClawRuntime.checkConnection();
        }

        return this.requireTransport().checkConnection();
    }

    /**
     * 获取 Gateway 传输层实例
     * @returns GatewayTransport 实例
     * @throws Error - 传输层未初始化时抛出
     */
    private requireTransport(): GatewayTransport {
        if (!this.transport) {
            throw new Error(t('service.connectFailed'));
        }

        return this.transport;
    }

    /**
     * 获取远程集群传输层实例
     * @param errorKey - 错误消息国际化键
     * @returns GatewayTransport 实例
     * @throws Error - 集群功能不可用时抛出
     */
    private requireRemoteClusterTransport(
        errorKey: 'service.clustersUnavailable' | 'service.clusterBroadcastUnavailable' = 'service.clustersUnavailable'
    ): GatewayTransport {
        if (!this.supportsRemoteClusters()) {
            throw new Error(t(errorKey));
        }

        return this.requireTransport();
    }

    /**
     * 跟踪 Gateway 请求
     * @param sessionId - 会话 ID
     * @param controller - 中止控制器
     */
    private trackGatewayRequest(sessionId: string, controller: AbortController): void {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const controllers = this.activeGatewayRequests.get(normalizedSessionId) || new Set<AbortController>();
        controllers.add(controller);
        this.activeGatewayRequests.set(normalizedSessionId, controllers);
    }

    /**
     * 取消跟踪 Gateway 请求
     * @param sessionId - 会话 ID
     * @param controller - 中止控制器
     */
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

    /**
     * 中止所有跟踪的 Gateway 请求
     * @param sessionId - 会话 ID
     */
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
