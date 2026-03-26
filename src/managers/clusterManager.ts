import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    createDefaultClusterWorkspaceConfig,
    MAX_CLUSTER_WORK_MODE_ROUNDS,
    normalizeClusterWorkspaceConfig
} from '../config/clusterWorkModes';
import { t } from '../i18n';
import {
    Agent,
    AgentCluster,
    ChatMessage,
    ClusterWorkspaceConfig,
    OpenClawService,
    SwarmMode,
    SwarmRoundSnapshot,
    SwarmRunPhase,
    SwarmRunState,
    SwarmDeliveryContext
} from '../services/openclawService';
import { OutboundDeliveryError, type FailureClass, type OutboundDeliveryStatus } from '../services/outbound';

/**
 * 创建集群参数
 */
export interface CreateClusterParams {
    name: string;
    agentIds: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

function buildCancelledClusterResult({
    agentId,
    startedAtMs,
    startedAt,
    trace = [],
    deliveryId,
    failureClass
}: {
    agentId: string;
    startedAtMs: number;
    startedAt: string;
    trace?: ChatMessage[];
    deliveryId?: string;
    failureClass?: FailureClass;
}): ClusterBroadcastResult {
    return {
        agentId,
        ok: false,
        trace,
        error: 'Swarm run cancelled',
        deliveryStatus: 'cancelled',
        failureClass,
        deliveryId,
        timing: buildClusterResultTiming({ startedAtMs, startedAt })
    };
}

/**
 * 更新集群参数
 */
export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
    status?: AgentCluster['status'];
    workspaceConfig?: ClusterWorkspaceConfig;
}

/**
 * 集群统计信息
 */
export interface ClusterStats {
    totalClusters: number;
    activeClusters: number;
    totalAgents: number;
    avgAgentsPerCluster: number;
}

/**
 * 集群广播结果
 */
export interface ClusterBroadcastResult {
    agentId: string;
    ok: boolean;
    message?: ChatMessage;
    trace?: ChatMessage[];
    error?: string;
    deliveryStatus?: OutboundDeliveryStatus;
    failureClass?: FailureClass;
    deliveryId?: string;
    timing?: {
        startedAt: string;
        completedAt: string;
        elapsedMs: number;
    };
}

/**
 * 广播集群选项
 */
export interface BroadcastClusterOptions {
    onAgentResult?: (agentId: string, result: ClusterBroadcastResult) => Promise<void> | void;
    swarmRunId?: string;
}

export interface UpdateClusterRequest extends UpdateClusterParams {
    clusterId: string;
}

export interface BroadcastClusterRequest {
    clusterId: string;
    message: string;
    options?: BroadcastClusterOptions;
}

export interface CollaborateClusterRequest {
    clusterId: string;
    message: string;
    options?: CollaborateClusterOptions;
}

export interface ClusterAgentRequest {
    clusterId: string;
    agentId: string;
}

export interface ClusterAgentMessagesRequest extends ClusterAgentRequest {
    messages: ChatMessage[];
}

export interface ClusterAgentSwarmRequest extends ClusterAgentRequest {
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
}

export interface ClusterAgentSwarmMessagesRequest extends ClusterAgentSwarmRequest {
    messages: ChatMessage[];
}

export interface ClusterSwarmRequest {
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
}

export interface ClusterSwarmMessagesRequest extends ClusterSwarmRequest {
    messages: ChatMessage[];
}

interface SwarmSendContext {
    swarmRunId: string;
    phase: string;
    round?: number;
    sourceAgentId?: string;
    targetAgentId?: string;
    transactionGroupId?: string;
    expectedGroupSize?: number;
    groupCompletionPolicy?: 'all' | 'any';
    requiresDeliveryForProgress?: boolean;
    messageKind?: string;
}

interface SwarmSendOptions {
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
    debateSessionIds?: Map<string, string>;
    swarm?: SwarmSendContext;
}

interface SwarmSendResultOptions extends SwarmSendOptions {
    onAgentResult?: (agentId: string, result: ClusterBroadcastResult) => Promise<void> | void;
}

interface SendMessageToAgentsRequest {
    agentIds: string[];
    message: string | ((agentId: string) => string | Promise<string>);
    options: SwarmSendResultOptions;
}

interface SendHierarchicalMessagesRequest {
    plan: SwarmActivationPlan;
    message: (node: SwarmActivationNode, routing: SwarmRoutingContext) => string | Promise<string>;
    options: SwarmSendResultOptions;
}

interface SendMessageToAgentRequest {
    agentId: string;
    message: string;
    options: SwarmSendOptions;
}

interface EnsureDebateSessionRequest {
    agentId: string;
    debateSessionIds: Map<string, string>;
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
}

interface EnsureSwarmSessionRequest {
    agentId: string;
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
}

interface BuildSwarmSessionKeyRequest {
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId: string;
    agentId: string;
}

interface BuildSwarmRunRegistryKeyRequest {
    clusterId: string;
    mode: SwarmMode;
}

interface RegisterSwarmRunRequest {
    clusterId: string;
    mode: SwarmMode;
    swarmRunId: string;
    coordinatorAgentId: string | undefined;
}

interface SetSwarmRunPhaseRequest {
    swarmRunId: string;
    phase: SwarmRunPhase;
    currentRound: number;
    coordinatorAgentId?: string;
}

interface RecordRoundSnapshotRequest {
    swarmRunId: string;
    round: number;
    phase: 'opening' | 'critique' | 'revision';
    entries: Record<string, ClusterBroadcastResult>;
}

interface ClusterAgentSwarmStorageKeyRequest {
    clusterId: string;
    agentId: string;
    mode: SwarmMode;
    swarmRunId: string;
}

interface AppendClusterAgentSwarmMessagesRequest {
    clusterId: string;
    agentId: string;
    mode: SwarmMode;
    messages: ChatMessage[];
    swarmRunId?: string;
}

interface BuildClusterSwarmStorageKeyRequest {
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
    swarmRunId: string;
}

interface BuildClusterAgentSessionStorageKeyRequest {
    clusterId: string;
    agentId: string;
}

interface ReconcileClusterAgentSessionsRequest {
    clusterId: string;
    agentIds: string[];
}

interface SendMessageWithTraceRequest {
    sessionId: string;
    message: string;
    timeoutMs: number;
    delivery?: SwarmDeliveryContext;
}

interface BuildSynthesisPromptRequest {
    cluster: AgentCluster;
    userMessage: string;
    workspaceConfig: ClusterWorkspaceConfig;
    coordinatorAgentId: string;
    successfulAgentIds: string[];
    contributions: Record<string, ClusterBroadcastResult>;
    rounds: ClusterCollaborationRound[];
    stopConditionSummary?: string;
}

interface EvaluateStopConditionRequest {
    cluster: AgentCluster;
    userMessage: string;
    workspaceConfig: ClusterWorkspaceConfig;
    judgeAgentId: string;
    successfulAgentIds: string[];
    contributions: Record<string, ClusterBroadcastResult>;
    rounds: ClusterCollaborationRound[];
    swarmRunId: string;
    reviewRound: number;
    stopConditionSessionIds: Map<string, string>;
}

interface BuildStopConditionPromptRequest {
    cluster: AgentCluster;
    userMessage: string;
    workspaceConfig: ClusterWorkspaceConfig;
    judgeAgentId: string;
    successfulAgentIds: string[];
    contributions: Record<string, ClusterBroadcastResult>;
    rounds: ClusterCollaborationRound[];
    reviewRound: number;
}

/**
 * 集群协作进度事件
 */
export type ClusterCollaborationProgressEvent =
    | {
        kind: 'round-entry';
        swarmRunId: string;
        roundKind: ClusterCollaborationRoundKind;
        round: ClusterCollaborationRoundDescriptor;
        agentId: string;
        entry: ClusterBroadcastResult;
    }
    | {
        kind: 'synthesis';
        swarmRunId: string;
        coordinatorAgentId: string | undefined;
        entry: ClusterBroadcastResult | undefined;
    };

/**
 * 协作集群选项
 */
export interface CollaborateClusterOptions {
    coordinatorAgentId?: string;        // 合作智能体ID
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;    // 检查是否在过程中的函数？
    swarmRunId?: string;                // 集群ID
}

/**
 * 集群协作轮次类型
 */
export type ClusterCollaborationRoundKind =
    | 'opening'
    | `critique-${number}`
    | `revision-${number}`;

/**
 * 集群轮次述符
 */
export interface ClusterCollaborationRoundDescriptor {
    kind: ClusterCollaborationRoundKind;            // 类型文本
    phase: 'opening' | 'critique' | 'revision';     // 开幕，评审，或修正
    reviewRound: number;                            // ？
    phaseIndex: number;                             // ？
    displayOrder: number;                           // ？
    labelKey: string;                               // ？
    fallbackLabel: string;                          // ？
}

/**
 * 集群协作轮次
 */
export interface ClusterCollaborationRound {
    kind: ClusterCollaborationRoundKind;
    descriptor: ClusterCollaborationRoundDescriptor;
    entries: Record<string, ClusterBroadcastResult>;
}

/**
 * 集群协作结果
 */
export interface ClusterCollaborationResult {
    swarmRunId: string;
    clusterId: string;
    clusterName: string;
    userMessage: string;
    coordinatorAgentId: string | undefined;
    rounds: ClusterCollaborationRound[];
    contributions: Record<string, ClusterBroadcastResult>;
    synthesis: ClusterBroadcastResult | undefined;
}

/**
 * 集群智能体上下文快照
 */
export interface ClusterAgentContextSnapshot {
    directMessages: ChatMessage[];
    broadcastMessages: ChatMessage[];
    collaborateMessages: ChatMessage[];
}

/**
 * 持久化集群文件结构
 */
interface PersistedClustersFile {
    version: number;
    clusters: AgentCluster[];
    workspaceConfigs?: Record<string, ClusterWorkspaceConfig>;
    clusterAgentSessions?: Record<string, string>;
    clusterAgentMessages?: Record<string, ChatMessage[]>;
    clusterAgentSwarmMessages?: Record<string, ChatMessage[]>;
    swarmSessions?: Record<string, string>;
    clusterSwarmMessages?: Record<string, ChatMessage[]>;
    swarmRunStates?: Record<string, SwarmRunState>;
    activeSwarmRunsByKey?: Record<string, string>;
    latestSwarmRunsByKey?: Record<string, string>;
}

/**
 * Swarm 激活节点
 */
interface SwarmActivationNode {
    agentId: string;
    parentAgentId: string | undefined;
    depth: number;
    children: SwarmActivationNode[];
}

/**
 * Swarm 激活计划
 */
interface SwarmActivationPlan {
    rootNodes: SwarmActivationNode[];
    orderedAgentIds: string[];
}

/**
 * Swarm 路由上下文
 */
interface SwarmRoutingContext {
    ancestorAgentIds: string[];
    parentNode: SwarmActivationNode | undefined;
    parentResult: ClusterBroadcastResult | undefined;
}

/**
 * 集群停止条件评估
 */
interface ClusterStopConditionEvaluation {
    shouldStop: boolean;            // 是否应结束
    judgeAgentId: string | undefined;    // 评价结束原因的智能体是谁？
    reviewRound: number;            // 当前review轮次
    reason: string;                 // 结束原因
    safetyCapReached?: boolean;     //是否已达到安全线？（存疑）
}

interface CollaborationContext {
    cluster: AgentCluster;
    workspaceConfig: ClusterWorkspaceConfig;
    activationPlan: SwarmActivationPlan;
    initialParticipantAgentIds: string[];
    coordinatorAgentId: string | undefined;
    swarmRunId: string;
}

interface RunOpeningRoundParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    activationPlan: SwarmActivationPlan;
    swarmRunId: string;
    coordinatorAgentId?: string;
    debateSessionIds: Map<string, string>;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

interface RunUnlimitedDebateRoundsParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    initialParticipantAgentIds: string[];
    successfulAgentIds: string[];
    latestUsableContributions: Record<string, ClusterBroadcastResult>;
    coordinatorAgentId?: string;
    swarmRunId: string;
    debateSessionIds: Map<string, string>;
    rounds: ClusterCollaborationRound[];
    requestedCoordinatorAgentId?: string;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

interface RunFixedDebateRoundsParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    initialParticipantAgentIds: string[];
    successfulAgentIds: string[];
    latestUsableContributions: Record<string, ClusterBroadcastResult>;
    coordinatorAgentId?: string;
    swarmRunId: string;
    debateSessionIds: Map<string, string>;
    rounds: ClusterCollaborationRound[];
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

interface RunCritiqueRoundParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    debateRound: ReturnType<typeof buildCollaborationDebateRound>;
    successfulAgentIds: string[];
    latestUsableContributions: Record<string, ClusterBroadcastResult>;
    coordinatorAgentId?: string;
    swarmRunId: string;
    debateSessionIds: Map<string, string>;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

interface RunRevisionRoundParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    debateRound: ReturnType<typeof buildCollaborationDebateRound>;
    successfulAgentIds: string[];
    latestUsableContributions: Record<string, ClusterBroadcastResult>;
    critiqueEntries: Record<string, ClusterBroadcastResult>;
    coordinatorAgentId?: string;
    swarmRunId: string;
    debateSessionIds: Map<string, string>;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

interface RunSynthesisIfNeededParams {
    cluster: AgentCluster;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    coordinatorAgentId?: string;
    successfulAgentIds: string[];
    latestUsableContributions: Record<string, ClusterBroadcastResult>;
    rounds: ClusterCollaborationRound[];
    swarmRunId: string;
    debateSessionIds: Map<string, string>;
    lastStopConditionEvaluation?: ClusterStopConditionEvaluation;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

const CLUSTER_AGENT_RESPONSE_TIMEOUT_MS = 180000;
const MAX_UNLIMITED_CLUSTER_REVIEW_ROUNDS = 10000;      // 我真不相信还有10000轮迭代也解决不动的问题（汗）

/**
 * 集群管理器，负责管理智能体集群的创建、广播、协作和状态持久化
 * 
 * @emits clusterCreated - 当集群被创建时触发
 * @emits clusterUpdated - 当集群被更新时触发
 * @emits clusterDeleted - 当集群被删除时触发
 * 
 * @example
 * ```typescript
 * const manager = new ClusterManager(service, storageFilePath);
 * const cluster = await manager.createCluster({ name: 'Dev Team', agentIds: ['agent-1', 'agent-2'] });
 * const results = await manager.broadcastToCluster({ clusterId: cluster.id, message: 'Hello team!' });
 * ```
 */
export class ClusterManager extends EventEmitter {
    private service: OpenClawService;                                                   // 服务本身
    private clusters: Map<string, AgentCluster> = new Map();                            // 集群列表
    private workspaceConfigs: Map<string, ClusterWorkspaceConfig> = new Map();          // 工作空间配置列表
    private clusterAgentSessionIds: Map<string, string> = new Map();                    // 集群智能体会话id
    private clusterAgentMessages: Map<string, ChatMessage[]> = new Map();               // 集群智能体消息
    private clusterAgentSwarmMessages: Map<string, ChatMessage[]> = new Map();          // 集群智能体群消息
    private clusterSwarmMessages: Map<string, ChatMessage[]> = new Map();               // 集群消息
    private storageFilePath: string;                                                    // 存储文件地址
    private persistedStateLoaded = false;                                               // 持久化
    private persistedStateLoadPromise: Promise<void> | undefined = undefined;                     // async持久化
    private swarmSessionIds: Map<string, string> = new Map();                           // swarm
    private activeSwarmRunsByKey: Map<string, string> = new Map();                      // 所有
    private latestSwarmRunsByKey: Map<string, string> = new Map();                      // 最后一次swarm运行？？
    private swarmRunStates: Map<string, SwarmRunState> = new Map();                     // swarm运行状态

    /**
     * 创建 ClusterManager 实例
     * @param service - OpenClaw 服务实例
     * @param storageFilePath - 存储文件路径
     */
    constructor(service: OpenClawService, storageFilePath: string) {
        super();
        this.service = service;
        this.storageFilePath = storageFilePath;
        this.setupListeners();
    }

    private clearClusterAgentSwarmMessagesForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::agent::`;
        for (const key of this.clusterAgentSwarmMessages.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterAgentSwarmMessages.delete(key);
            }
        }
    }

    /**
     * 设置服务事件监听器
     */
    private setupListeners() {
        // 绑定集群创建事件。
        // 对于每一个事件，如果不支持远程集群则直接退。
        this.service.on('clusterCreated', (cluster: AgentCluster) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.set(cluster.id, cluster);
            this.emit('clusterCreated', cluster);
        });

        this.service.on('clusterUpdated', (cluster: AgentCluster) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.set(cluster.id, cluster);
            this.emit('clusterUpdated', cluster);
        });

        this.service.on('clusterDeleted', (clusterId: string) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.delete(clusterId);
            this.emit('clusterDeleted', clusterId);
        });

        this.service.on('deliveryEvent', (event: any) => {
            if (event?.entry?.swarm?.clusterId) {
                this.emit('deliveryEvent', event);
            }
        });
    }

    /**
     * 获取所有集群
     * 
     * @param refresh - 是否强制刷新
     * @returns 集群列表
     */
    public async getClusters(refresh: boolean = false): Promise<AgentCluster[]> {
        await this.ensurePersistedStateLoaded(refresh);

        if (this.service.supportsRemoteClusters()) {
            if (refresh || this.clusters.size === 0) {
                const clusters = await this.service.getClusters();
                this.clusters.clear();
                clusters.forEach((cluster: any) => this.clusters.set(cluster.id, this.applyWorkspaceConfig(cluster)));
            }
            return Array.from(this.clusters.values()).map((cluster: any) => this.applyWorkspaceConfig(cluster));
        }

        return Array.from(this.clusters.values()).map((cluster: any) => this.applyWorkspaceConfig(cluster));
    }

    /**
     * 获取指定集群
     * 
     * @param clusterId - 集群ID
     * @returns 集群对象或 undefined
     */
    public async getCluster(clusterId: string): Promise<AgentCluster | undefined> {
        await this.ensurePersistedStateLoaded();

        if (this.service.supportsRemoteClusters()) {
            if (this.clusters.has(clusterId)) {
                return this.applyWorkspaceConfig(this.clusters.get(clusterId)!);
            }

            const cluster = await this.service.getCluster(clusterId);
            if (cluster) {
                this.clusters.set(clusterId, this.applyWorkspaceConfig(cluster));
            }
            return cluster ? this.applyWorkspaceConfig(cluster) : undefined;
        }

        const cluster = this.clusters.get(clusterId) || undefined;
        return cluster ? this.applyWorkspaceConfig(cluster) : undefined;
    }

    /**
     * 创建新集群
     * 
     * @param params - 创建集群参数
     * @returns 创建的集群
     */
    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        await this.ensurePersistedStateLoaded();
        const workspaceConfig = normalizeClusterWorkspaceConfig(params.workspaceConfig);

        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.createCluster({
                name: params.name,
                agentIds: params.agentIds
            });
            this.workspaceConfigs.set(cluster.id, workspaceConfig);
            await this.persistState();
            const resolvedCluster = this.applyWorkspaceConfig(cluster);
            this.clusters.set(cluster.id, resolvedCluster);
            this.reconcileClusterAgentSessions({ clusterId: cluster.id, agentIds: resolvedCluster.agentIds });
            return resolvedCluster;
        }

        const cluster: AgentCluster = {
            id: buildClusterId(params.name),
            name: params.name.trim(),
            agentIds: uniqueAgentIds(params.agentIds),
            status: 'active',
            createdAt: new Date().toISOString(),
            workspaceConfig
        };

        const resolvedCluster = this.applyWorkspaceConfig(cluster);
        this.clusters.set(cluster.id, resolvedCluster);
        this.reconcileClusterAgentSessions({ clusterId: cluster.id, agentIds: resolvedCluster.agentIds });
        await this.persistState();
        this.emit('clusterCreated', resolvedCluster);
        return resolvedCluster;
    }

    /**
     * 更新集群（列表？）
     * 
     * @param clusterId - 集群ID
     * @param params - 更新参数
     * @returns 更新后的集群
     * @throws Error - 当集群不存在时抛出
     */
    public async updateCluster({ clusterId, ...params }: UpdateClusterRequest): Promise<AgentCluster> {
        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.updateCluster(clusterId, {
                name: params.name,
                agentIds: params.agentIds
            });
            if (params.workspaceConfig !== undefined) {
                this.workspaceConfigs.set(clusterId, normalizeClusterWorkspaceConfig(params.workspaceConfig));
                await this.persistState();
            }
            const resolvedCluster = this.applyWorkspaceConfig({
                ...cluster,
                ...(params.status !== undefined ? { status: params.status } : {})
            });
            this.clusters.set(clusterId, resolvedCluster);
            this.reconcileClusterAgentSessions({ clusterId, agentIds: resolvedCluster.agentIds });
            return resolvedCluster;
        }

        await this.ensurePersistedStateLoaded(false);
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        const updatedCluster: AgentCluster = {
            ...cluster,
            ...(params.name !== undefined ? { name: params.name.trim() } : {}),
            ...(params.agentIds !== undefined ? { agentIds: uniqueAgentIds(params.agentIds) } : {}),
            ...(params.status !== undefined ? { status: params.status } : {}),
            ...(params.workspaceConfig !== undefined
                ? { workspaceConfig: normalizeClusterWorkspaceConfig(params.workspaceConfig) }
                : {})
        };
        // i should update workspace config
        const resolvedCluster = this.applyWorkspaceConfig(updatedCluster);
        this.clusters.set(clusterId, updatedCluster);
        this.reconcileClusterAgentSessions({ clusterId, agentIds: resolvedCluster.agentIds });
        await this.persistState();
        this.emit('clusterUpdated', updatedCluster);
        return updatedCluster;
    }

    /**
     * 删除集群
     * 
     * @param clusterId - 集群ID
     * @returns Promise<void>
     */
    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.service.supportsRemoteClusters()) {
            await this.service.deleteCluster(clusterId);
            this.clusters.delete(clusterId);
            this.workspaceConfigs.delete(clusterId);
            this.clearClusterAgentSessionsForCluster(clusterId);
            this.clearClusterAgentMessagesForCluster(clusterId);
            this.clearClusterAgentSwarmMessagesForCluster(clusterId);
            this.clearClusterSwarmMessagesForCluster(clusterId);
            this.clearSwarmSessionsForCluster(clusterId);
            this.clearSwarmRunStateForCluster(clusterId);
            await this.persistState();
            return;
        }

        await this.ensurePersistedStateLoaded();
        this.clusters.delete(clusterId);
        this.workspaceConfigs.delete(clusterId);
        this.clearClusterAgentSessionsForCluster(clusterId);
        this.clearClusterAgentMessagesForCluster(clusterId);
        this.clearClusterAgentSwarmMessagesForCluster(clusterId);
        this.clearClusterSwarmMessagesForCluster(clusterId);
        this.clearSwarmSessionsForCluster(clusterId);
        this.clearSwarmRunStateForCluster(clusterId);
        await this.persistState();
        this.emit('clusterDeleted', clusterId);
    }

    /**
     * 向集群广播消息
     * 
     * @param clusterId - 集群ID
     * @param message - 消息内容
     * @param options - 广播选项
     * @returns 各智能体的响应结果
     * @throws Error - 当集群不存在或没有可用智能体时抛出
     */
    public async broadcastToCluster({
        clusterId,
        message,
        options = {}
    }: BroadcastClusterRequest): Promise<Record<string, ClusterBroadcastResult>> {
        if (this.service.supportsRemoteClusters()) {
            // 在支持远程集群的情况下，发送到集群
            const responses = await this.service.sendToCluster(clusterId, message);
            return Object.fromEntries(
                Object.entries(responses).map(([agentId, response]: any) => [
                    agentId,
                    {
                        agentId,
                        ok: true,
                        message: response
                    } satisfies ClusterBroadcastResult
                ])
            );
        }

        // 获得集群
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        // 激活方式是什么？
        const activationPlan = resolveSwarmActivationPlan({
            agentIds: cluster.agentIds,
            workspaceConfig: workspaceConfigOrDefault(cluster.workspaceConfig),
            mode: 'broadcast',
            userMessage: message
        });
        if (activationPlan.orderedAgentIds.length === 0) {
            throw new Error(t('clusterManager.noEligibleAgents'));
        }

        const swarmRunId = options.swarmRunId || buildSwarmRunId({ clusterId: cluster.id, mode: 'broadcast' });
        this.registerSwarmRun({
            clusterId: cluster.id,
            mode: 'broadcast',
            swarmRunId,
            coordinatorAgentId: undefined
        });
        await this.persistState();

        try {
            this.setSwarmRunPhase({
                swarmRunId,
                phase: 'broadcast',
                currentRound: 1
            });
            const broadcastGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: 'broadcast' });
            const results = await this.sendHierarchicalMessages({
                plan: activationPlan,
                message: async (node: any, routing: any) => routing.parentNode
                    ? buildDelegatedBroadcastPrompt({
                        clusterName: cluster.name,
                        message,
                        delegatedContext: {
                            delegatedByAgentId: routing.parentNode.agentId,
                            routeAgentIds: [...routing.ancestorAgentIds, routing.parentNode.agentId],
                            parentContext: extractSwarmResultContext({ result: routing.parentResult })
                        }
                    })
                    : message,
                options: {
                    clusterId,
                    mode: 'broadcast',
                    swarm: {
                        swarmRunId,
                        phase: 'broadcast',
                        round: 1,
                        transactionGroupId: broadcastGroupId,
                        expectedGroupSize: activationPlan.orderedAgentIds.length,
                        groupCompletionPolicy: 'all',
                        requiresDeliveryForProgress: true,
                        messageKind: 'broadcast'
                    },
                    onAgentResult: options.onAgentResult
                }
            });

            if (this.isSwarmRunActive(swarmRunId)) {
                await this.updateCluster({ clusterId, status: 'active' });
            }
            return results;
        } finally {
            this.finishSwarmRun(swarmRunId);
            await this.persistState().catch(() => undefined);
        }
    }

    /**
     * 在集群上进行协作
     * 
     * @param clusterId - 集群ID
     * @param message - 用户消息
     * @param options - 协作选项
     * @returns 协作结果
     * @throws Error - 当集群不存在或没有可用智能体时抛出
     */
    public async collaborateOnCluster({
        clusterId,
        message,
        options = {}
    }: CollaborateClusterRequest): Promise<ClusterCollaborationResult> {
        const {
            cluster,
            workspaceConfig,
            activationPlan,
            initialParticipantAgentIds,
            coordinatorAgentId,
            swarmRunId
        } = await this.prepareCollaborationContext({ clusterId, message, options });

        // 保存一个ID内容，以及轮次内容。
        const debateSessionIds = new Map<string, string>();
        const rounds: ClusterCollaborationRound[] = [];

        // try
        try {
            // 开门红，在推完开幕之后进入正式的讨论。
            const { descriptor: openingDescriptor, entries: openingEntries } = await this.runOpeningRound({
                cluster,
                message,
                workspaceConfig,
                activationPlan,
                swarmRunId,
                coordinatorAgentId,
                debateSessionIds,
                onProgress: options.onProgress
            });
            // 推入新的轮次内容
            rounds.push({
                kind: 'opening',
                descriptor: openingDescriptor,
                entries: openingEntries
            });
            this.recordRoundSnapshot({
                swarmRunId,
                round: 1,
                phase: 'opening',
                entries: openingEntries
            });

            let latestUsableContributions = openingEntries;
            let successfulAgentIds = getSuccessfulAgentIds({
                agentIds: initialParticipantAgentIds,
                entries: latestUsableContributions
            });
            
            // 判断是否进入无限轮回，并通过通用接口解析结束条件
            const runUntilConditionMet = Boolean(workspaceConfig.runUntilConditionMet && workspaceConfig.stopCondition?.trim());
            let lastStopConditionEvaluation: ClusterStopConditionEvaluation | undefined = undefined;

            if (runUntilConditionMet) {
                // 无限轮回模式
                const result = await this.runUnlimitedDebateRounds({
                    cluster,
                    message,
                    workspaceConfig,
                    initialParticipantAgentIds,
                    successfulAgentIds,
                    latestUsableContributions,
                    coordinatorAgentId,
                    swarmRunId,
                    debateSessionIds,
                    rounds,
                    requestedCoordinatorAgentId: options.coordinatorAgentId,
                    onProgress: options.onProgress
                });
                latestUsableContributions = result.latestUsableContributions;
                successfulAgentIds = result.successfulAgentIds;
                lastStopConditionEvaluation = result.lastStopConditionEvaluation;
            } else {
                const result = await this.runFixedDebateRounds({
                    cluster,
                    message,
                    workspaceConfig,
                    initialParticipantAgentIds,
                    successfulAgentIds,
                    latestUsableContributions,
                    coordinatorAgentId,
                    swarmRunId,
                    debateSessionIds,
                    rounds,
                    onProgress: options.onProgress
                });
                latestUsableContributions = result.latestUsableContributions;
                successfulAgentIds = result.successfulAgentIds;
            }

            const synthesis = await this.runSynthesisIfNeeded({
                cluster,
                message,
                workspaceConfig,
                coordinatorAgentId,
                successfulAgentIds,
                latestUsableContributions,
                rounds,
                swarmRunId,
                debateSessionIds,
                lastStopConditionEvaluation,
                onProgress: options.onProgress
            });

            if (this.isSwarmRunActive(swarmRunId)) {
                await this.updateCluster({ clusterId, status: 'active' });
            }

            return {
                swarmRunId,
                clusterId: cluster.id,
                clusterName: cluster.name,
                userMessage: message,
                coordinatorAgentId,
                rounds,
                contributions: latestUsableContributions,
                synthesis
            };
        } finally {
            this.finishSwarmRun(swarmRunId);
            await this.persistState().catch(() => undefined);
        }
    }

    /**
     * 准备合作上下文内容
     * 
     * @param clusterId 
     * @param message 
     * @param options 
     * @returns await一个 cluster上下文内容。
     */
    private async prepareCollaborationContext({
        clusterId,
        message,
        options
    }: {
        clusterId: string;
        message: string;
        options: CollaborateClusterOptions;
    }): Promise<CollaborationContext> {
        // 获取当前cluster信息
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        // 获取clulster的工作空间信息
        const workspaceConfig = normalizeClusterWorkspaceConfig(cluster.workspaceConfig);

        // 创建激活swarm的计划
        const activationPlan = resolveSwarmActivationPlan({
            agentIds: cluster.agentIds,
            workspaceConfig,
            mode: 'collaborate',
            userMessage: message
        });
        if (activationPlan.orderedAgentIds.length === 0) {
            throw new Error(t('clusterManager.noEligibleAgents'));
        }

        // 初始化参与到swarm的内容ID，并解析协调者的ID
        const initialParticipantAgentIds = [...activationPlan.orderedAgentIds];
        const coordinatorAgentId = resolveCoordinatorAgentId({
            clusterAgentIds: cluster.agentIds,
            successfulAgentIds: initialParticipantAgentIds,
            configuredAgentId: workspaceConfig.coordinatorAgentId,
            preferredAgentId: options.coordinatorAgentId
        });
        const swarmRunId = options.swarmRunId || buildSwarmRunId({ clusterId: cluster.id, mode: 'collaborate' });

        // 注册swarm run的内容，并等待持久化当前情况
        this.registerSwarmRun({
            clusterId: cluster.id,
            mode: 'collaborate',
            swarmRunId,
            coordinatorAgentId
        });
        await this.persistState();

        return {
            cluster,
            workspaceConfig,
            activationPlan,
            initialParticipantAgentIds,
            coordinatorAgentId,
            swarmRunId
        };
    }

    private async runOpeningRound(params: RunOpeningRoundParams): Promise<{
        descriptor: ClusterCollaborationRoundDescriptor;
        entries: Record<string, ClusterBroadcastResult>;
    }> {
        const {
            cluster,
            message,
            workspaceConfig,
            activationPlan,
            swarmRunId,
            coordinatorAgentId,
            debateSessionIds,
            onProgress
        } = params;
        this.setSwarmRunPhase({
            swarmRunId,
            phase: 'opening',
            currentRound: 1,
            coordinatorAgentId
        });
        const openingGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: 'opening' });
        const openingDescriptor = buildCollaborationRoundDescriptor('opening');
        const openingEntries = await this.sendHierarchicalMessages({
            plan: activationPlan,
            message: async (node: any, routing: any) => buildOpeningContributionPrompt({
                clusterName: cluster.name,
                message,
                workspaceConfig,
                agentId: node.agentId,
                delegatedContext: routing.parentNode
                    ? {
                        delegatedByAgentId: routing.parentNode.agentId,
                        routeAgentIds: [...routing.ancestorAgentIds, routing.parentNode.agentId],
                        parentContext: extractSwarmResultContext({ result: routing.parentResult })
                    }
                    : undefined
            }),
            options: {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                swarmRunId,
                swarm: {
                    swarmRunId,
                    phase: 'opening',
                    round: 1,
                    transactionGroupId: openingGroupId,
                    expectedGroupSize: activationPlan.orderedAgentIds.length,
                    groupCompletionPolicy: 'all',
                    requiresDeliveryForProgress: true,
                    messageKind: 'opening'
                },
                onAgentResult: (agentId: any, entry: any) => onProgress?.({
                    kind: 'round-entry',
                    swarmRunId,
                    roundKind: 'opening',
                    round: openingDescriptor,
                    agentId,
                    entry
                })
            }
        });

        return { descriptor: openingDescriptor, entries: openingEntries };
    }

    /**
     * 无限轮回。
     * @param params 
     * @returns 
     */
    private async runUnlimitedDebateRounds(params: RunUnlimitedDebateRoundsParams): Promise<{
        latestUsableContributions: Record<string, ClusterBroadcastResult>;
        successfulAgentIds: string[];
        lastStopConditionEvaluation?: ClusterStopConditionEvaluation;
    }> {
        const {
            cluster,
            message,
            workspaceConfig,
            initialParticipantAgentIds,
            coordinatorAgentId,
            swarmRunId,
            debateSessionIds,
            rounds,
            requestedCoordinatorAgentId,
            onProgress
        } = params;
        let { successfulAgentIds, latestUsableContributions } = params;

        // 结束条件，以及结束轮的ID
        let lastStopConditionEvaluation: ClusterStopConditionEvaluation | undefined = undefined;
        const stopConditionSessionIds = new Map<string, string>();

        // 轮回本体
        for (let reviewRound = 1; reviewRound <= MAX_UNLIMITED_CLUSTER_REVIEW_ROUNDS; reviewRound += 1) {
            // 如果swarm不活跃，或没有任何智能体进行有效回复，则退出轮回
            if (!this.isSwarmRunActive(swarmRunId) || successfulAgentIds.length === 0) {
                break;
            }

            // 辩论轮
            const debateRound = buildCollaborationDebateRound(reviewRound);
            const critique = await this.runCritiqueRound({
                cluster,
                message,
                workspaceConfig,
                debateRound,
                successfulAgentIds,
                latestUsableContributions,
                coordinatorAgentId,
                swarmRunId,
                debateSessionIds,
                onProgress
            });
            rounds.push({
                kind: debateRound.critiqueKind,
                descriptor: critique.descriptor,
                entries: critique.entries
            });
            this.recordRoundSnapshot({
                swarmRunId,
                round: debateRound.reviewRound,
                phase: 'critique',
                entries: critique.entries
            });

            // 确保swarm活跃
            if (!this.isSwarmRunActive(swarmRunId)) {
                break;
            }

            const revision = await this.runRevisionRound({
                cluster,
                message,
                workspaceConfig,
                debateRound,
                successfulAgentIds,
                latestUsableContributions,
                critiqueEntries: critique.entries,
                coordinatorAgentId,
                swarmRunId,
                debateSessionIds,
                onProgress
            });
            rounds.push({
                kind: debateRound.revisionKind,
                descriptor: revision.descriptor,
                entries: revision.entries
            });
            this.recordRoundSnapshot({
                swarmRunId,
                round: debateRound.reviewRound,
                phase: 'revision',
                entries: revision.entries
            });

            latestUsableContributions = mergeLatestSuccessfulEntries({
                agentIds: initialParticipantAgentIds,
                nextEntries: revision.entries,
                fallbackEntries: latestUsableContributions
            });
            successfulAgentIds = getSuccessfulAgentIds({
                agentIds: initialParticipantAgentIds,
                entries: latestUsableContributions
            });

            if (!this.isSwarmRunActive(swarmRunId) || successfulAgentIds.length === 0) {
                break;
            }

            const stopJudgeAgentId = resolveCoordinatorAgentId({
                clusterAgentIds: cluster.agentIds,
                successfulAgentIds,
                configuredAgentId: workspaceConfig.coordinatorAgentId,
                preferredAgentId: requestedCoordinatorAgentId
            });
            if (!stopJudgeAgentId) {
                continue;
            }

            this.setSwarmRunPhase({
                swarmRunId,
                phase: 'stop-condition',
                currentRound: reviewRound,
                coordinatorAgentId
            });
            lastStopConditionEvaluation = await this.evaluateStopCondition({
                cluster,
                userMessage: message,
                workspaceConfig,
                judgeAgentId: stopJudgeAgentId,
                successfulAgentIds,
                contributions: latestUsableContributions,
                rounds,
                swarmRunId,
                reviewRound,
                stopConditionSessionIds
            });
            if (!this.isSwarmRunActive(swarmRunId) || lastStopConditionEvaluation.shouldStop) {
                break;
            }

            if (reviewRound === MAX_UNLIMITED_CLUSTER_REVIEW_ROUNDS) {
                lastStopConditionEvaluation = {
                    shouldStop: false,
                    judgeAgentId: stopJudgeAgentId,
                    reviewRound,
                    reason: `Safety cap reached after ${reviewRound} review rounds.`,
                    safetyCapReached: true
                };
            }
        }

        return {
            latestUsableContributions,
            successfulAgentIds,
            lastStopConditionEvaluation
        };
    }

    private async runFixedDebateRounds(params: RunFixedDebateRoundsParams): Promise<{
        latestUsableContributions: Record<string, ClusterBroadcastResult>;
        successfulAgentIds: string[];
    }> {
        const {
            cluster,
            message,
            workspaceConfig,
            initialParticipantAgentIds,
            coordinatorAgentId,
            swarmRunId,
            debateSessionIds,
            rounds,
            onProgress
        } = params;
        let { successfulAgentIds, latestUsableContributions } = params;

        for (const debateRound of buildCollaborationDebateRounds(workspaceConfig.rounds)) {
            if (!this.isSwarmRunActive(swarmRunId) || successfulAgentIds.length === 0) {
                break;
            }

            const critique = await this.runCritiqueRound({
                cluster,
                message,
                workspaceConfig,
                debateRound,
                successfulAgentIds,
                latestUsableContributions,
                coordinatorAgentId,
                swarmRunId,
                debateSessionIds,
                onProgress
            });
            rounds.push({
                kind: debateRound.critiqueKind,
                descriptor: critique.descriptor,
                entries: critique.entries
            });
            this.recordRoundSnapshot({
                swarmRunId,
                round: debateRound.reviewRound,
                phase: 'critique',
                entries: critique.entries
            });

            if (!this.isSwarmRunActive(swarmRunId)) {
                break;
            }

            const revision = await this.runRevisionRound({
                cluster,
                message,
                workspaceConfig,
                debateRound,
                successfulAgentIds,
                latestUsableContributions,
                critiqueEntries: critique.entries,
                coordinatorAgentId,
                swarmRunId,
                debateSessionIds,
                onProgress
            });
            rounds.push({
                kind: debateRound.revisionKind,
                descriptor: revision.descriptor,
                entries: revision.entries
            });
            this.recordRoundSnapshot({
                swarmRunId,
                round: debateRound.reviewRound,
                phase: 'revision',
                entries: revision.entries
            });

            latestUsableContributions = mergeLatestSuccessfulEntries({
                agentIds: initialParticipantAgentIds,
                nextEntries: revision.entries,
                fallbackEntries: latestUsableContributions
            });
            successfulAgentIds = getSuccessfulAgentIds({
                agentIds: initialParticipantAgentIds,
                entries: latestUsableContributions
            });
        }

        return { latestUsableContributions, successfulAgentIds };
    }

    /**
     * 运行一个评审轮。
     * 
     * @param params 
     * @returns await，得到一个
     */
    private async runCritiqueRound(params: RunCritiqueRoundParams): Promise<{
        descriptor: ClusterCollaborationRoundDescriptor;
        entries: Record<string, ClusterBroadcastResult>;
    }> {
        const {
            cluster,
            message,
            workspaceConfig,
            debateRound,
            successfulAgentIds,
            latestUsableContributions,
            coordinatorAgentId,
            swarmRunId,
            debateSessionIds,
            onProgress
        } = params;
        const critiqueDescriptor = buildCollaborationRoundDescriptor(debateRound.critiqueKind);
        this.setSwarmRunPhase({
            swarmRunId,
            phase: 'critique',
            currentRound: debateRound.reviewRound,
            coordinatorAgentId
        });
        const critiqueGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: debateRound.critiqueKind });

        // 将所有信息发送到agent。注意：出问题的地方有可能是这一块。
        const critiqueEntries = await this.sendMessageToAgents({
            agentIds: successfulAgentIds,
            message: (agentId: any) => buildPeerReviewPrompt({
                clusterName: cluster.name,
                message,
                workspaceConfig,
                agentId,
                successfulAgentIds,
                contributions: latestUsableContributions,
                reviewRound: debateRound.reviewRound
            }),
            options: {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                swarmRunId,
                swarm: {
                    swarmRunId,
                    phase: debateRound.critiqueKind,
                    round: debateRound.reviewRound,
                    transactionGroupId: critiqueGroupId,
                    expectedGroupSize: successfulAgentIds.length,
                    groupCompletionPolicy: 'all',
                    requiresDeliveryForProgress: true,
                    messageKind: 'critique'
                },
                onAgentResult: (agentId: any, entry: any) => onProgress?.({
                    kind: 'round-entry',
                    swarmRunId,
                    roundKind: debateRound.critiqueKind,
                    round: critiqueDescriptor,
                    agentId,
                    entry
                })
            }
        });

        return { descriptor: critiqueDescriptor, entries: critiqueEntries };
    }

    private async runRevisionRound(params: RunRevisionRoundParams): Promise<{
        descriptor: ClusterCollaborationRoundDescriptor;
        entries: Record<string, ClusterBroadcastResult>;
    }> {
        const {
            cluster,
            message,
            workspaceConfig,
            debateRound,
            successfulAgentIds,
            latestUsableContributions,
            critiqueEntries,
            coordinatorAgentId,
            swarmRunId,
            debateSessionIds,
            onProgress
        } = params;
        const revisionDescriptor = buildCollaborationRoundDescriptor(debateRound.revisionKind);
        this.setSwarmRunPhase({
            swarmRunId,
            phase: 'revision',
            currentRound: debateRound.reviewRound,
            coordinatorAgentId
        });
        const revisionGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: debateRound.revisionKind });
        const revisionEntries = await this.sendMessageToAgents({
            agentIds: successfulAgentIds,
            message: (agentId: any) => buildRevisionPrompt({
                clusterName: cluster.name,
                message,
                workspaceConfig,
                agentId,
                successfulAgentIds,
                contributions: latestUsableContributions,
                critiqueEntries,
                reviewRound: debateRound.reviewRound
            }),
            options: {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                swarmRunId,
                swarm: {
                    swarmRunId,
                    phase: debateRound.revisionKind,
                    round: debateRound.reviewRound,
                    transactionGroupId: revisionGroupId,
                    expectedGroupSize: successfulAgentIds.length,
                    groupCompletionPolicy: 'all',
                    requiresDeliveryForProgress: true,
                    messageKind: 'revision'
                },
                onAgentResult: (agentId: any, entry: any) => onProgress?.({
                    kind: 'round-entry',
                    swarmRunId,
                    roundKind: debateRound.revisionKind,
                    round: revisionDescriptor,
                    agentId,
                    entry
                })
            }
        });

        return { descriptor: revisionDescriptor, entries: revisionEntries };
    }

    private async runSynthesisIfNeeded(params: RunSynthesisIfNeededParams): Promise<ClusterBroadcastResult | undefined> {
        const {
            cluster,
            message,
            workspaceConfig,
            coordinatorAgentId,
            successfulAgentIds,
            latestUsableContributions,
            rounds,
            swarmRunId,
            debateSessionIds,
            lastStopConditionEvaluation,
            onProgress
        } = params;
        if (!this.isSwarmRunActive(swarmRunId) || !coordinatorAgentId || successfulAgentIds.length === 0) {
            return undefined;
        }

        this.setSwarmRunPhase({
            swarmRunId,
            phase: 'synthesis',
            currentRound: rounds.length + 1,
            coordinatorAgentId
        });
        const synthesisPrompt = await this.buildSynthesisPrompt({
            cluster,
            userMessage: message,
            workspaceConfig,
            coordinatorAgentId,
            successfulAgentIds,
            contributions: latestUsableContributions,
            rounds,
            stopConditionSummary: buildStopConditionSummary({
                workspaceConfig,
                lastStopConditionEvaluation
            })
        });
        const synthesisGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: 'synthesis' });
        const synthesis = await this.sendMessageToAgent({
            agentId: coordinatorAgentId,
            message: synthesisPrompt,
            options: {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                swarmRunId,
                swarm: {
                    swarmRunId,
                    phase: 'synthesis',
                    round: rounds.length + 1,
                    transactionGroupId: synthesisGroupId,
                    expectedGroupSize: 1,
                    groupCompletionPolicy: 'all',
                    requiresDeliveryForProgress: true,
                    messageKind: 'synthesis',
                    sourceAgentId: coordinatorAgentId,
                    targetAgentId: coordinatorAgentId
                }
            }
        });
        if (this.isSwarmRunActive(swarmRunId)) {
            await onProgress?.({
                kind: 'synthesis',
                swarmRunId,
                coordinatorAgentId,
                entry: synthesis
            });
        }
        return synthesis;
    }

    /**
     * 获取集群统计信息
     * 
     * @returns 集群统计信息
     */
    public getClusterStats(): ClusterStats {
        const clusters = Array.from(this.clusters.values());
        const totalAgents = clusters.reduce((sum: any, cluster: any) => sum + cluster.agentIds.length, 0);

        return {
            totalClusters: clusters.length,
            activeClusters: clusters.filter((cluster: any) => cluster.status === 'active').length,
            totalAgents,
            avgAgentsPerCluster: clusters.length > 0 ? totalAgents / clusters.length : 0
        };
    }

    /**
     * 获取包含指定智能体的所有集群
     * 
     * @param agentId - 智能体ID
     * @returns 集群列表
     */
    public getClustersByAgent(agentId: string): AgentCluster[] {
        return Array.from(this.clusters.values()).filter((cluster: any) =>
            cluster.agentIds.includes(agentId)
        );
    }

    /**
     * 向集群添加智能体
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns Promise<void>
     * @throws Error - 当集群不存在时抛出
     */
    public async addAgentToCluster({ clusterId, agentId }: ClusterAgentRequest): Promise<void> {
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        if (!cluster.agentIds.includes(agentId)) {
            await this.updateCluster({ clusterId, agentIds: [...cluster.agentIds, agentId] });
        }
    }

    /**
     * 从集群移除智能体
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns Promise<void>
     * @throws Error - 当集群不存在时抛出
     */
    public async removeAgentFromCluster({ clusterId, agentId }: ClusterAgentRequest): Promise<void> {
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        await this.updateCluster({ clusterId, agentIds: cluster.agentIds.filter((id: any) => id !== agentId) });
    }

    /**
     * 确保集群智能体会话ID存在
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns 会话ID
     */
    public async ensureClusterAgentSessionId({ clusterId, agentId }: ClusterAgentRequest): Promise<string> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey({ clusterId, agentId });
        const existing = this.clusterAgentSessionIds.get(key);
        if (existing) {
            return existing;
        }

        const sessionId = buildClusterAgentSessionId({ clusterId, agentId });
        this.clusterAgentSessionIds.set(key, sessionId);
        await this.persistState();
        return sessionId;
    }

    /**
     * 重置集群智能体会话ID
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns 新的会话ID
     */
    public async resetClusterAgentSessionId({ clusterId, agentId }: ClusterAgentRequest): Promise<string> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey({ clusterId, agentId });
        const sessionId = buildClusterAgentSessionId({ clusterId, agentId });
        this.clusterAgentSessionIds.set(key, sessionId);
        await this.persistState();
        return sessionId;
    }

    /**
     * 获取集群智能体的消息
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns 消息列表
     */
    public async getClusterAgentMessages({ clusterId, agentId }: ClusterAgentRequest): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        return cloneChatMessages(
            this.clusterAgentMessages.get(this.buildClusterAgentSessionStorageKey({ clusterId, agentId })) || []
        );
    }

    /**
     * 替换集群智能体的消息
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @param messages - 新消息列表
     * @returns Promise<void>
     */
    public async replaceClusterAgentMessages({ clusterId, agentId, messages }: ClusterAgentMessagesRequest): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey({ clusterId, agentId });
        const normalizedMessages = normalizePersistedChatMessages(messages);

        if (normalizedMessages.length > 0) {
            this.clusterAgentMessages.set(key, normalizedMessages);
        } else {
            this.clusterAgentMessages.delete(key);
        }

        await this.persistState();
    }

    /**
     * 清除集群智能体的消息
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns Promise<void>
     */
    public async clearClusterAgentMessages({ clusterId, agentId }: ClusterAgentRequest): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey({ clusterId, agentId });
        if (!this.clusterAgentMessages.delete(key)) {
            return;
        }

        await this.persistState();
    }

    /**
     * 获取集群智能体的 Swarm 消息
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @param mode - 模式（广播或协作）
     * @returns 消息列表
     */
    public async getClusterAgentSwarmMessages({
        clusterId,
        agentId,
        mode,
        swarmRunId
    }: ClusterAgentSwarmRequest): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        const resolvedRunId = swarmRunId || this.resolveLatestSwarmRunId({ clusterId, mode });
        if (!resolvedRunId) {
            return [];
        }
        return cloneChatMessages(
            this.clusterAgentSwarmMessages.get(this.buildClusterAgentSwarmStorageKey({
                clusterId,
                agentId,
                mode,
                swarmRunId: resolvedRunId
            })) || []
        );
    }

    public async replaceClusterAgentSwarmMessages({
        clusterId,
        agentId,
        mode,
        messages,
        swarmRunId
    }: ClusterAgentSwarmMessagesRequest): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const resolvedRunId = swarmRunId || this.resolveLatestSwarmRunId({ clusterId, mode });
        if (!resolvedRunId) {
            return;
        }
        const key = this.buildClusterAgentSwarmStorageKey({
            clusterId,
            agentId,
            mode,
            swarmRunId: resolvedRunId
        });
        const normalizedMessages = normalizePersistedChatMessages(messages);
        if (normalizedMessages.length > 0) {
            this.clusterAgentSwarmMessages.set(key, normalizedMessages);
        } else {
            this.clusterAgentSwarmMessages.delete(key);
        }
        await this.persistState();
    }

    /**
     * 获取集群智能体上下文快照
     * 
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns 上下文快照
     */
    public async getClusterAgentContextSnapshot({
        clusterId,
        agentId
    }: ClusterAgentRequest): Promise<ClusterAgentContextSnapshot> {
        const [directMessages, broadcastMessages, collaborateMessages] = await Promise.all([
            this.getClusterAgentMessages({ clusterId, agentId }),
            this.getClusterAgentSwarmMessages({ clusterId, agentId, mode: 'broadcast' }),
            this.getClusterAgentSwarmMessages({ clusterId, agentId, mode: 'collaborate' })
        ]);

        return {
            directMessages,
            broadcastMessages,
            collaborateMessages
        };
    }

    /**
     * 获取集群 Swarm 消息
     * 
     * @param clusterId - 集群ID
     * @param mode - 模式（广播或协作）
     * @returns 消息列表
     */
    public async getClusterSwarmMessages({
        clusterId,
        mode,
        swarmRunId
    }: ClusterSwarmRequest): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        const resolvedRunId = swarmRunId || this.resolveLatestSwarmRunId({ clusterId, mode });
        if (!resolvedRunId) {
            return [];
        }
        return cloneChatMessages(
            this.clusterSwarmMessages.get(this.buildClusterSwarmStorageKey({
                clusterId,
                mode,
                swarmRunId: resolvedRunId
            })) || []
        );
    }

    public async listClusterSwarmRunIds({
        clusterId,
        mode
    }: ClusterSwarmRequest): Promise<string[]> {
        await this.ensurePersistedStateLoaded();

        const clusterPrefix = `${clusterId.trim()}::swarm::${mode}::`;
        const candidates = new Set<string>();
        const latestRunId = this.resolveLatestSwarmRunId({ clusterId, mode });
        const activeRunId = this.getActiveSwarmRunId({ clusterId, mode });

        if (latestRunId) {
            candidates.add(latestRunId);
        }
        if (activeRunId) {
            candidates.add(activeRunId);
        }

        for (const key of this.clusterSwarmMessages.keys()) {
            if (!key.startsWith(clusterPrefix)) {
                continue;
            }
            const runId = key.slice(clusterPrefix.length).trim();
            if (runId) {
                candidates.add(runId);
            }
        }

        for (const [runId, state] of this.swarmRunStates.entries()) {
            if (state.clusterId === clusterId && state.mode === mode) {
                candidates.add(runId);
            }
        }

        return Array.from(candidates.values())
            .sort((left: any, right: any) => {
                if (left === activeRunId) {
                    return -1;
                }
                if (right === activeRunId) {
                    return 1;
                }
                if (left === latestRunId) {
                    return -1;
                }
                if (right === latestRunId) {
                    return 1;
                }

                const leftState = this.swarmRunStates.get(left);
                const rightState = this.swarmRunStates.get(right);
                const leftTime = Date.parse(leftState?.startedAt || leftState?.stoppedAt || '') || 0;
                const rightTime = Date.parse(rightState?.startedAt || rightState?.stoppedAt || '') || 0;
                return rightTime - leftTime;
            });
    }

    /**
     * 中止集群 Swarm 运行（对该集群指定模式的所有会话发起 abort）
     *
     * @param clusterId - 集群ID
     * @param mode - 模式（广播或协作）
     * @returns Promise<void>
     */
    public async abortClusterSwarmRun({ clusterId, mode }: ClusterSwarmRequest): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const activeSwarmRunId = this.getActiveSwarmRunId({ clusterId, mode });
        if (activeSwarmRunId) {
            this.cancelSwarmRunState(activeSwarmRunId);
            const state = this.swarmRunStates.get(activeSwarmRunId);
            if (state) {
                state.stopReason = 'Swarm run cancelled by user';
            }
            this.service.cancelSwarmRun(activeSwarmRunId, 'Swarm run cancelled by user');
            await this.persistState().catch(() => undefined);
        }
        const prefix = activeSwarmRunId
            ? `cluster:${clusterId}:swarm:${mode}:run:${activeSwarmRunId}:agent:`
            : `cluster:${clusterId}:swarm:${mode}:run:`;
        const sessionIds = new Set<string>();
        for (const [key, sessionId] of this.swarmSessionIds.entries()) {
            if (key.startsWith(prefix) && sessionId) {
                sessionIds.add(sessionId);
            }
        }

        await Promise.allSettled(
            Array.from(sessionIds.values()).map((sessionId: any) =>
                this.service.abortSessionRun(sessionId).catch(() => undefined)
            )
        );
    }

    /**
     * 替换集群 Swarm 消息
     * 
     * @param clusterId - 集群ID
     * @param mode - 模式（广播或协作）
     * @param messages - 新消息列表
     * @returns Promise<void>
     */
    public async replaceClusterSwarmMessages({
        clusterId,
        mode,
        messages,
        swarmRunId
    }: ClusterSwarmMessagesRequest): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const resolvedRunId = swarmRunId || this.resolveLatestSwarmRunId({ clusterId, mode });
        if (!resolvedRunId) {
            return;
        }
        const key = this.buildClusterSwarmStorageKey({
            clusterId,
            mode,
            swarmRunId: resolvedRunId
        });
        const normalizedMessages = normalizePersistedChatMessages(messages);

        if (normalizedMessages.length > 0) {
            this.clusterSwarmMessages.set(key, normalizedMessages);
        } else {
            this.clusterSwarmMessages.delete(key);
        }

        await this.persistState();
    }

    /**
     * 刷新集群列表
     * 
     * @returns 刷新后的集群列表
     */
    public async refresh(): Promise<AgentCluster[]> {
        return this.getClusters(true);
    }

    /**
     * 释放资源
     */
    public dispose() {
        this.removeAllListeners();
        this.clusters.clear();
        this.workspaceConfigs.clear();
        this.clusterAgentSessionIds.clear();
        this.clusterAgentMessages.clear();
        this.clusterAgentSwarmMessages.clear();
        this.clusterSwarmMessages.clear();
        this.persistedStateLoaded = false;
        this.persistedStateLoadPromise = undefined;
        this.swarmSessionIds.clear();
        this.activeSwarmRunsByKey.clear();
        this.latestSwarmRunsByKey.clear();
        this.swarmRunStates.clear();
    }

    /**
     * 确保持久化状态已加载
     * @param forceRefresh - 是否强制刷新
     */
    private async ensurePersistedStateLoaded(forceRefresh: boolean = false): Promise<void> {
        if (forceRefresh) {
            this.persistedStateLoaded = false;
        }

        if (this.persistedStateLoaded) {
            return;
        }

        if (this.persistedStateLoadPromise) {
            await this.persistedStateLoadPromise;
            return;
        }

        this.persistedStateLoadPromise = (async () => {
            if (!this.service.supportsRemoteClusters()) {
                this.clusters.clear();
            }
            this.workspaceConfigs.clear();
            this.clusterAgentSessionIds.clear();
            this.clusterAgentMessages.clear();
            this.clusterAgentSwarmMessages.clear();
            this.clusterSwarmMessages.clear();
            this.swarmSessionIds.clear();
            this.activeSwarmRunsByKey.clear();
            this.latestSwarmRunsByKey.clear();
            this.swarmRunStates.clear();

            try {
                const content = await fs.readFile(this.storageFilePath, 'utf8');
                const data = JSON.parse(content) as PersistedClustersFile;
                if (!this.service.supportsRemoteClusters()) {
                    for (const cluster of data.clusters || []) {
                        if (!cluster?.id || !cluster?.name) {
                            continue;
                        }

                        this.clusters.set(cluster.id, this.applyWorkspaceConfig({
                            ...cluster,
                            agentIds: uniqueAgentIds(cluster.agentIds || []),
                            status: cluster.status === 'inactive' ? 'inactive' : 'active'
                        }));
                    }
                }

                for (const cluster of data.clusters || []) {
                    if (!cluster?.id) {
                        continue;
                    }
                    this.workspaceConfigs.set(
                        cluster.id,
                        normalizeClusterWorkspaceConfig(cluster.workspaceConfig)
                    );
                }

                for (const [clusterId, workspaceConfig] of Object.entries(data.workspaceConfigs || {})) {
                    this.workspaceConfigs.set(clusterId, normalizeClusterWorkspaceConfig(workspaceConfig));
                }

                for (const [sessionKey, sessionId] of Object.entries(data.clusterAgentSessions || {})) {
                    const normalizedSessionKey = String(sessionKey || '').trim();
                    const normalizedSessionId = String(sessionId || '').trim();
                    if (!normalizedSessionKey || !normalizedSessionId) {
                        continue;
                    }

                    this.clusterAgentSessionIds.set(normalizedSessionKey, normalizedSessionId);
                }

                for (const [messageKey, messages] of Object.entries(data.clusterAgentMessages || {})) {
                    const normalizedMessageKey = String(messageKey || '').trim();
                    if (!normalizedMessageKey) {
                        continue;
                    }

                    const normalizedMessages = normalizePersistedChatMessages(messages);
                    if (normalizedMessages.length === 0) {
                        continue;
                    }

                    this.clusterAgentMessages.set(normalizedMessageKey, normalizedMessages);
                }

                for (const [messageKey, messages] of Object.entries(data.clusterAgentSwarmMessages || {})) {
                    const normalizedMessageKey = String(messageKey || '').trim();
                    if (!normalizedMessageKey) {
                        continue;
                    }

                    const normalizedMessages = normalizePersistedChatMessages(messages);
                    if (normalizedMessages.length === 0) {
                        continue;
                    }

                    this.clusterAgentSwarmMessages.set(normalizedMessageKey, normalizedMessages);
                }

                for (const [sessionKey, sessionId] of Object.entries(data.swarmSessions || {})) {
                    const normalizedSessionKey = String(sessionKey || '').trim();
                    const normalizedSessionId = String(sessionId || '').trim();
                    if (!normalizedSessionKey || !normalizedSessionId) {
                        continue;
                    }

                    this.swarmSessionIds.set(normalizedSessionKey, normalizedSessionId);
                }

                for (const [registryKey, swarmRunId] of Object.entries(data.activeSwarmRunsByKey || {})) {
                    const normalizedRegistryKey = String(registryKey || '').trim();
                    const normalizedSwarmRunId = String(swarmRunId || '').trim();
                    if (normalizedRegistryKey && normalizedSwarmRunId) {
                        this.activeSwarmRunsByKey.set(normalizedRegistryKey, normalizedSwarmRunId);
                    }
                }

                for (const [registryKey, swarmRunId] of Object.entries(data.latestSwarmRunsByKey || {})) {
                    const normalizedRegistryKey = String(registryKey || '').trim();
                    const normalizedSwarmRunId = String(swarmRunId || '').trim();
                    if (normalizedRegistryKey && normalizedSwarmRunId) {
                        this.latestSwarmRunsByKey.set(normalizedRegistryKey, normalizedSwarmRunId);
                    }
                }

                for (const [swarmRunId, swarmRunState] of Object.entries(data.swarmRunStates || {})) {
                    const normalizedSwarmRunId = String(swarmRunId || '').trim();
                    if (!normalizedSwarmRunId || !swarmRunState?.clusterId) {
                        continue;
                    }
                    this.swarmRunStates.set(normalizedSwarmRunId, {
                        ...swarmRunState,
                        runId: normalizedSwarmRunId,
                        clusterId: String(swarmRunState.clusterId || '').trim(),
                        mode: swarmRunState.mode === 'broadcast' ? 'broadcast' : 'collaborate',
                        status: swarmRunState.status || 'completed',
                        phase: swarmRunState.phase || 'synthesis',
                        currentRound: Number.isFinite(swarmRunState.currentRound) ? swarmRunState.currentRound : 1,
                        coordinatorAgentId: typeof swarmRunState.coordinatorAgentId === 'string' ? swarmRunState.coordinatorAgentId : undefined,
                        startedAt: typeof swarmRunState.startedAt === 'string' ? swarmRunState.startedAt : new Date().toISOString(),
                        stoppedAt: typeof swarmRunState.stoppedAt === 'string' ? swarmRunState.stoppedAt : undefined,
                        stopReason: typeof swarmRunState.stopReason === 'string' ? swarmRunState.stopReason : undefined,
                        cancellationRequested: Boolean(swarmRunState.cancellationRequested),
                        snapshots: Array.isArray(swarmRunState.snapshots) ? swarmRunState.snapshots : []
                    });
                }

                for (const [messageKey, messages] of Object.entries(data.clusterSwarmMessages || {})) {
                    const normalizedMessageKey = String(messageKey || '').trim();
                    if (!normalizedMessageKey) {
                        continue;
                    }

                    const normalizedMessages = normalizePersistedChatMessages(messages);
                    if (normalizedMessages.length === 0) {
                        continue;
                    }

                    this.clusterSwarmMessages.set(normalizedMessageKey, normalizedMessages);
                }
            } catch (error) {
                const maybeNodeError = error as NodeJS.ErrnoException;
                if (maybeNodeError.code !== 'ENOENT') {
                    throw error;
                }
            }

            this.persistedStateLoaded = true;
        })();

        try {
            await this.persistedStateLoadPromise;
        } finally {
            this.persistedStateLoadPromise = undefined;
        }
    }

    /**
     * 持久化状态到磁盘
     */
    private async persistState(): Promise<void> {
        const payload: PersistedClustersFile = {
            version: 7,
            clusters: Array.from(this.clusters.values()).map((cluster: any) => this.applyWorkspaceConfig(cluster)),
            workspaceConfigs: Object.fromEntries(this.workspaceConfigs.entries()),
            clusterAgentSessions: Object.fromEntries(this.clusterAgentSessionIds.entries()),
            clusterAgentMessages: Object.fromEntries(
                Array.from(this.clusterAgentMessages.entries()).map(([key, messages]: any) => [
                    key,
                    cloneChatMessages(messages)
                ])
            ),
            clusterAgentSwarmMessages: Object.fromEntries(
                Array.from(this.clusterAgentSwarmMessages.entries()).map(([key, messages]: any) => [
                    key,
                    cloneChatMessages(messages)
                ])
            ),
            swarmSessions: Object.fromEntries(this.swarmSessionIds.entries()),
            swarmRunStates: Object.fromEntries(
                Array.from(this.swarmRunStates.entries()).map(([runId, state]: any) => [
                    runId,
                    {
                        ...state,
                        snapshots: Array.isArray(state.snapshots) ? [...state.snapshots] : []
                    }
                ])
            ),
            activeSwarmRunsByKey: Object.fromEntries(this.activeSwarmRunsByKey.entries()),
            latestSwarmRunsByKey: Object.fromEntries(this.latestSwarmRunsByKey.entries()),
            clusterSwarmMessages: Object.fromEntries(
                Array.from(this.clusterSwarmMessages.entries()).map(([key, messages]: any) => [
                    key,
                    cloneChatMessages(messages)
                ])
            )
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, undefined, 2), 'utf8');
    }

    /**
     * 向多个智能体发送消息
     * @param agentIds - 智能体ID列表（目标智能体？）
     * @param message - 消息内容或消息生成函数
     * @param options - 发送选项
     * @returns 各智能体的响应结果
     */
    private async sendMessageToAgents({
        agentIds,
        message,
        options
    }: SendMessageToAgentsRequest): Promise<Record<string, ClusterBroadcastResult>> {
        const entries: Array<readonly [string, ClusterBroadcastResult]> = [];
        for (const agentId of agentIds) {
            if (!this.isSwarmSendContextActive(options.swarm)) {
                break;
            }
            const resolvedMessage = typeof message === 'function'
                ? await message(agentId)
                : message;
            if (!this.isSwarmSendContextActive(options.swarm)) {
                break;
            }
            const result = await this.sendMessageToAgent({ agentId, message: resolvedMessage, options });
            entries.push([agentId, result] as const);
            if (this.isSwarmSendContextActive(options.swarm)) {
                await options.onAgentResult?.(agentId, result);
            }
            if (!this.isSwarmSendContextActive(options.swarm)) {
                break;
            }
        }
        return Object.fromEntries(entries);
    }

    /**
     * 发送层级消息
     * @param plan - Swarm 激活计划
     * @param message - 消息生成函数
     * @param options - 发送选项
     * @returns 各智能体的响应结果
     */
    private async sendHierarchicalMessages({
        plan,
        message,
        options
    }: SendHierarchicalMessagesRequest): Promise<Record<string, ClusterBroadcastResult>> {
        const results: Record<string, ClusterBroadcastResult> = {};

        /**
         * 
         * @param node      当前节点
         * @param routing   当前swarm上下文？？
         * @returns 不返回任何东西，可以await到生命周期结束
         */
        const visitNode = async (
            node: SwarmActivationNode,
            routing: SwarmRoutingContext
        ): Promise<void> => {
            if (!this.isSwarmSendContextActive(options.swarm)) {
                return;
            }
            const resolvedMessage = await message(node, routing);
            if (!this.isSwarmSendContextActive(options.swarm)) {
                return;
            }
            const swarmContext = options.swarm
                ? {
                    ...options.swarm,
                    sourceAgentId: routing.parentNode?.agentId || options.swarm.sourceAgentId
                }
                : undefined;
            const result = await this.sendMessageToAgent({
                agentId: node.agentId,
                message: resolvedMessage,
                options: {
                    ...options,
                    swarm: swarmContext
                }
            });
            results[node.agentId] = result;
            if (this.isSwarmSendContextActive(options.swarm)) {
                await options.onAgentResult?.(node.agentId, result);
            }

            if (!result.ok || !this.isSwarmSendContextActive(options.swarm)) {
                return;
            }

            for (const child of node.children) {
                if (!this.isSwarmSendContextActive(options.swarm)) {
                    return;
                }
                await visitNode(child, {
                    ancestorAgentIds: [...routing.ancestorAgentIds, node.agentId],
                    parentNode: node,
                    parentResult: result
                });
            }
        };

        for (const rootNode of plan.rootNodes) {
            await visitNode(rootNode, {
                ancestorAgentIds: [],
                parentNode: undefined,
                parentResult: undefined
            });
        }

        return results;
    }

    /**
     * 向单个智能体发送消息
     * @param agentId - 智能体ID
     * @param message - 消息内容
     * @param options - 发送选项
     * @returns 发送结果
     */
    private async sendMessageToAgent({
        agentId,
        message,
        options
    }: SendMessageToAgentRequest): Promise<ClusterBroadcastResult> {
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        try {
            if (!this.isSwarmSendContextActive(options.swarm)) {
                return buildCancelledClusterResult({ agentId, startedAtMs, startedAt });
            }
            const sessionId = options.debateSessionIds
                ? await this.ensureDebateSession({
                    agentId,
                    debateSessionIds: options.debateSessionIds,
                    clusterId: options.clusterId,
                    mode: options.mode,
                    swarmRunId: options.swarmRunId || options.swarm?.swarmRunId
                })
                : await this.ensureSwarmSession({
                    agentId,
                    clusterId: options.clusterId,
                    mode: options.mode,
                    swarmRunId: options.swarmRunId || options.swarm?.swarmRunId
                });
            if (!this.isSwarmSendContextActive(options.swarm)) {
                return buildCancelledClusterResult({ agentId, startedAtMs, startedAt });
            }
            const swarmDelivery = buildSwarmDeliveryContext({ options, agentId });
            const traceResult = await this.sendMessageWithTrace({
                sessionId,
                message,
                timeoutMs: CLUSTER_AGENT_RESPONSE_TIMEOUT_MS,
                delivery: swarmDelivery
            });
            await this.appendClusterAgentSwarmMessages({
                clusterId: options.clusterId,
                agentId,
                mode: options.mode,
                messages: buildClusterAgentSwarmLogMessages({
                    agentId,
                    message,
                    traceResult,
                    delivery: swarmDelivery,
                    startedAt
                }),
                swarmRunId: options.swarmRunId || options.swarm?.swarmRunId
            });
            if (!this.isSwarmSendContextActive(options.swarm) || traceResult.deliveryStatus === 'cancelled') {
                return buildCancelledClusterResult({
                    agentId,
                    startedAtMs,
                    startedAt,
                    trace: traceResult.trace,
                    deliveryId: traceResult.deliveryId,
                    failureClass: traceResult.failureClass
                });
            }
            const timing = buildClusterResultTiming({ startedAtMs, startedAt });
            if (traceResult.errorMessage || traceResult.timedOut) {
                return {
                    agentId,
                    ok: false,
                    message: traceResult.message || undefined,
                    trace: traceResult.trace,
                    error: traceResult.errorMessage || `Timed out after ${Math.round(CLUSTER_AGENT_RESPONSE_TIMEOUT_MS / 1000)}s`,
                    deliveryStatus: traceResult.deliveryStatus,
                    failureClass: traceResult.failureClass,
                    deliveryId: traceResult.deliveryId,
                    timing
                };
            }

            return {
                agentId,
                ok: true,
                message: traceResult.message || undefined,
                trace: traceResult.trace,
                deliveryStatus: traceResult.deliveryStatus,
                failureClass: traceResult.failureClass,
                deliveryId: traceResult.deliveryId,
                timing
            };
        } catch (error) {
            return {
                agentId,
                ok: false,
                error: String(error),
                deliveryStatus: error instanceof OutboundDeliveryError ? error.status : undefined,
                failureClass: error instanceof OutboundDeliveryError ? error.failureClass : undefined,
                deliveryId: error instanceof OutboundDeliveryError ? error.entryId : undefined,
                timing: buildClusterResultTiming({ startedAtMs, startedAt })
            };
        }
    }

    /**
     * 确保辩论会话存在
     * @param agentId - 智能体ID
     * @param debateSessionIds - 辩论会话ID映射
     * @param clusterId - 集群ID
     * @param mode - 模式
     * @returns 会话ID
     */
    private async ensureDebateSession({
        agentId,
        debateSessionIds,
        clusterId,
        mode,
        swarmRunId
    }: EnsureDebateSessionRequest): Promise<string> {
        const existingSessionId = debateSessionIds.get(agentId);
        if (existingSessionId) {
            return existingSessionId;
        }

        const sessionId = await this.ensureSwarmSession({ agentId, clusterId, mode, swarmRunId });
        debateSessionIds.set(agentId, sessionId);
        return sessionId;
    }

    /**
     * 确保 Swarm 会话存在
     * @param agentId - 智能体ID
     * @param clusterId - 集群ID
     * @param mode - 模式
     * @returns 会话ID
     */
    private async ensureSwarmSession({
        agentId,
        clusterId,
        mode,
        swarmRunId
    }: EnsureSwarmSessionRequest): Promise<string> {
        const resolvedRunId = typeof swarmRunId === 'string' && swarmRunId.trim()
            ? swarmRunId.trim()
            : this.resolveLatestSwarmRunId({ clusterId, mode }) || buildSwarmRunId({ clusterId, mode });
        const key = this.buildSwarmSessionKey({ clusterId, mode, swarmRunId: resolvedRunId, agentId });
        const existingSessionId = this.swarmSessionIds.get(key);
        if (existingSessionId) {
            return existingSessionId;
        }

        const session = await this.service.createChatSession(agentId);
        this.swarmSessionIds.set(key, session.id);
        await this.persistState();
        return session.id;
    }

    /**
     * 构建 Swarm 会话键
     * @param clusterId - 集群ID
     * @param mode - 模式
     * @param agentId - 智能体ID
     * @returns 会话键
     */
    private buildSwarmSessionKey({
        clusterId,
        mode,
        swarmRunId,
        agentId
    }: BuildSwarmSessionKeyRequest): string {
        return `cluster:${clusterId}:swarm:${mode}:run:${swarmRunId}:agent:${agentId}`;
    }

    /**
     * 清除集群的所有 Swarm 会话
     * @param clusterId - 集群ID
     */
    private buildSwarmRunRegistryKey({ clusterId, mode }: BuildSwarmRunRegistryKeyRequest): string {
        return `${clusterId.trim()}::${mode}`;
    }

    private registerSwarmRun({ clusterId, mode, swarmRunId, coordinatorAgentId }: RegisterSwarmRunRequest): void {
        const key = this.buildSwarmRunRegistryKey({ clusterId, mode });
        this.activeSwarmRunsByKey.set(key, swarmRunId);
        this.latestSwarmRunsByKey.set(key, swarmRunId);
        this.swarmRunStates.set(swarmRunId, {
            runId: swarmRunId,
            clusterId,
            mode,
            status: 'running',
            phase: mode === 'broadcast' ? 'broadcast' : 'opening',
            currentRound: 1,
            coordinatorAgentId,
            startedAt: new Date().toISOString(),
            cancellationRequested: false,
            snapshots: []
        });
    }

    private getActiveSwarmRunId({ clusterId, mode }: BuildSwarmRunRegistryKeyRequest): string | undefined {
        return this.activeSwarmRunsByKey.get(this.buildSwarmRunRegistryKey({ clusterId, mode })) || undefined;
    }

    private resolveLatestSwarmRunId({ clusterId, mode }: BuildSwarmRunRegistryKeyRequest): string | undefined {
        const key = this.buildSwarmRunRegistryKey({ clusterId, mode });
        return this.activeSwarmRunsByKey.get(key) || this.latestSwarmRunsByKey.get(key) || undefined;
    }

    private setSwarmRunPhase({
        swarmRunId,
        phase,
        currentRound,
        coordinatorAgentId
    }: SetSwarmRunPhaseRequest): void {
        const state = this.swarmRunStates.get(swarmRunId);
        if (!state || state.status !== 'running') {
            return;
        }
        state.phase = phase;
        state.currentRound = currentRound;
        if (coordinatorAgentId !== undefined) {
            state.coordinatorAgentId = coordinatorAgentId;
        }
    }

    private recordRoundSnapshot({
        swarmRunId,
        round,
        phase,
        entries
    }: RecordRoundSnapshotRequest): SwarmRoundSnapshot {
        const snapshot: SwarmRoundSnapshot = {
            runId: swarmRunId,
            round,
            phase,
            entries: Object.fromEntries(
                Object.entries(entries).map(([agentId, entry]: any) => [
                    agentId,
                    {
                        agentId,
                        ok: Boolean(entry?.ok),
                        content: entry?.message?.content,
                        error: entry?.error
                    }
                ])
            ),
            createdAt: new Date().toISOString()
        };
        const state = this.swarmRunStates.get(swarmRunId);
        if (state) {
            state.snapshots = [...(state.snapshots || []), snapshot];
        }
        return snapshot;
    }

    private cancelSwarmRunState(swarmRunId: string): boolean {
        const state = this.swarmRunStates.get(swarmRunId);
        if (!state || state.cancellationRequested) {
            return false;
        }
        state.cancellationRequested = true;
        state.status = 'stopping';
        state.stoppedAt = new Date().toISOString();
        state.stopReason = state.stopReason || 'Swarm run cancelled';
        return true;
    }

    private finishSwarmRun(swarmRunId: string): void {
        const state = this.swarmRunStates.get(swarmRunId);
        if (!state || state.status === 'completed' || state.status === 'failed' || state.status === 'stopped') {
            return;
        }
        if (state.status === 'stopping') {
            state.status = 'stopped';
            state.stoppedAt = state.stoppedAt || new Date().toISOString();
        } else {
            state.status = 'completed';
        }
        const key = this.buildSwarmRunRegistryKey({ clusterId: state.clusterId, mode: state.mode });
        if (this.activeSwarmRunsByKey.get(key) === swarmRunId) {
            this.activeSwarmRunsByKey.delete(key);
        }
    }

    /**
     * 保证当前swarm正在运行
     * @param swarmRunId swarm id
     * @returns 
     */
    private isSwarmRunActive(swarmRunId: string | undefined): boolean {
        const normalizedSwarmRunId = typeof swarmRunId === 'string' ? swarmRunId.trim() : '';
        if (!normalizedSwarmRunId) {
            return true;
        }
        const state = this.swarmRunStates.get(normalizedSwarmRunId);
        if (!state || state.status !== 'running' || state.cancellationRequested) {
            return false;
        }
        return this.activeSwarmRunsByKey.get(this.buildSwarmRunRegistryKey({
            clusterId: state.clusterId,
            mode: state.mode
        })) === normalizedSwarmRunId;
    }

    /**
     * 检查swarm发送上下文活跃性
     * @param swarm 
     * @returns 
     */
    private isSwarmSendContextActive(swarm?: SwarmSendContext): boolean {
        if (!swarm?.swarmRunId) {
            return true;
        }
        return this.isSwarmRunActive(swarm.swarmRunId);
    }

    private buildClusterAgentSwarmStorageKey({
        clusterId,
        agentId,
        mode,
        swarmRunId
    }: ClusterAgentSwarmStorageKeyRequest): string {
        return `${clusterId.trim()}::agent::${agentId.trim()}::${mode}::${swarmRunId.trim()}`;
    }

    /**
     * Reset the visible swarm log for a cluster/mode before a new run starts so the
     * collaborate menu always shows a coherent single-run transcript.
     */
    private async appendClusterAgentSwarmMessages({
        clusterId,
        agentId,
        mode,
        messages,
        swarmRunId
    }: AppendClusterAgentSwarmMessagesRequest): Promise<void> {
        const resolvedRunId = swarmRunId || this.resolveLatestSwarmRunId({ clusterId, mode });
        if (!resolvedRunId) {
            return;
        }
        const key = this.buildClusterAgentSwarmStorageKey({
            clusterId,
            agentId,
            mode,
            swarmRunId: resolvedRunId
        });
        const existing = this.clusterAgentSwarmMessages.get(key) || [];
        const merged = [...existing, ...normalizePersistedChatMessages(messages)];
        if (merged.length > 0) {
            this.clusterAgentSwarmMessages.set(key, merged);
        } else {
            this.clusterAgentSwarmMessages.delete(key);
        }
        await this.persistState();
    }

    private clearSwarmSessionsForCluster(clusterId: string): void {
        const prefix = `cluster:${clusterId}:`;
        for (const key of this.swarmSessionIds.keys()) {
            if (key.startsWith(prefix)) {
                this.swarmSessionIds.delete(key);
            }
        }
    }

    private clearSwarmRunStateForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.activeSwarmRunsByKey.keys()) {
            if (key.startsWith(prefix)) {
                this.activeSwarmRunsByKey.delete(key);
            }
        }
        for (const key of this.latestSwarmRunsByKey.keys()) {
            if (key.startsWith(prefix)) {
                this.latestSwarmRunsByKey.delete(key);
            }
        }
        for (const [runId, state] of this.swarmRunStates.entries()) {
            if (state.clusterId === clusterId) {
                this.swarmRunStates.delete(runId);
            }
        }
    }

    /**
     * 构建集群 Swarm 存储键
     * @param clusterId - 集群ID
     * @param mode - 模式
     * @returns 存储键
     */
    private buildClusterSwarmStorageKey({
        clusterId,
        mode,
        swarmRunId
    }: BuildClusterSwarmStorageKeyRequest): string {
        return `${clusterId.trim()}::swarm::${mode}::${swarmRunId.trim()}`;
    }

    /**
     * 构建集群智能体会话存储键
     * @param clusterId - 集群ID
     * @param agentId - 智能体ID
     * @returns 存储键
     */
    private buildClusterAgentSessionStorageKey({
        clusterId,
        agentId
    }: BuildClusterAgentSessionStorageKeyRequest): string {
        return `${clusterId.trim()}::${agentId.trim()}`;
    }

    /**
     * 清除集群的所有智能体会话
     * @param clusterId - 集群ID
     */
    private clearClusterAgentSessionsForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentSessionIds.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterAgentSessionIds.delete(key);
            }
        }
    }

    /**
     * 清除集群的所有智能体消息
     * @param clusterId - 集群ID
     */
    private clearClusterAgentMessagesForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentMessages.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterAgentMessages.delete(key);
            }
        }
    }

    /**
     * 清除集群的所有 Swarm 消息
     * @param clusterId - 集群ID
     */
    private clearClusterSwarmMessagesForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::swarm::`;
        for (const key of this.clusterSwarmMessages.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterSwarmMessages.delete(key);
            }
        }
    }

    /**
     * 协调集群智能体会话
     * @param clusterId - 集群ID
     * @param agentIds - 智能体ID列表
     */
    private reconcileClusterAgentSessions({ clusterId, agentIds }: ReconcileClusterAgentSessionsRequest): void {
        const allowed = new Set(agentIds.map((agentId: any) => this.buildClusterAgentSessionStorageKey({ clusterId, agentId })));
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentSessionIds.keys()) {
            if (key.startsWith(prefix) && !allowed.has(key)) {
                this.clusterAgentSessionIds.delete(key);
            }
        }

        for (const key of this.clusterAgentMessages.keys()) {
            if (key.startsWith(prefix) && !allowed.has(key)) {
                this.clusterAgentMessages.delete(key);
            }
        }

        const swarmSessionPrefix = `cluster:${clusterId}:`;
        const allowedAgentSuffixes = new Set(
            agentIds.flatMap((agentId: any) => [
                `:agent:${agentId}`,
                `:agent:${agentId.trim()}`
            ])
        );
        for (const key of this.swarmSessionIds.keys()) {
            const belongsToAllowedAgent = Array.from(allowedAgentSuffixes.values()).some((suffix: any) => key.endsWith(suffix));
            if (key.startsWith(swarmSessionPrefix) && !belongsToAllowedAgent) {
                this.swarmSessionIds.delete(key);
            }
        }
    }

    /**
     * 发送带追踪的消息
     * @param sessionId - 会话ID
     * @param message - 消息内容
     * @param timeoutMs - 超时毫秒
     * @returns 发送结果
     */
    private async sendMessageWithTrace({
        sessionId,
        message,
        timeoutMs,
        delivery
    }: SendMessageWithTraceRequest): Promise<{
        message: ChatMessage | undefined;
        trace: ChatMessage[];
        timedOut: boolean;
        errorMessage?: string;
        deliveryStatus?: OutboundDeliveryStatus;
        failureClass?: FailureClass;
        deliveryId?: string;
    }> {
        const before = await this.service.getChatHistory(sessionId).catch(() => []);
        const knownIds = new Set(before.map((item: any) => item.id));

        let response: ChatMessage | undefined = undefined;
        try {
            response = await this.service.sendMessage(sessionId, message, {
                delivery,
                timeoutMs
            });
        } catch (error) {
            if (error instanceof OutboundDeliveryError) {
                return {
                    message: undefined,
                    trace: [],
                    timedOut: error.status === 'expired',
                    errorMessage: error.message,
                    deliveryStatus: error.status,
                    failureClass: error.failureClass,
                    deliveryId: error.entryId
                };
            }

            return {
                message: undefined,
                trace: [],
                timedOut: false,
                errorMessage: String(error)
            };
        }

        const after = await this.service.getChatHistory(sessionId).catch(() => []);
        const trace = this.normalizeTraceMessages(
            after.filter((item: any) => !knownIds.has(item.id))
        );
        const finalTraceMessage = findLastAssistantMessage(trace);

        if (trace.length === 0) {
            return {
                message: response,
                trace: response ? [response] : [],
                timedOut: false,
                deliveryStatus: 'sent'
            };
        }

        return {
            message: finalTraceMessage || response,
            trace,
            timedOut: false,
            deliveryStatus: 'sent'
        };
    }

    /**
     * 规范化追踪消息
     * @param messages - 消息列表
     * @returns 规范化后的消息列表
     */
    private normalizeTraceMessages(messages: ChatMessage[]): ChatMessage[] {
        const deduped = new Map<string, ChatMessage>();
        for (const message of messages) {
            if (!message || message.role === 'user') {
                continue;
            }

            if (message.id) {
                deduped.set(message.id, message);
                continue;
            }

            const fallbackId = `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
            deduped.set(fallbackId, message);
        }

        return Array.from(deduped.values());
    }

    /**
     * 构建合成提示词
     * @param cluster - 集群
     * @param userMessage - 用户消息
     * @param workspaceConfig - 工作区配置
     * @param coordinatorAgentId - 协调者智能体ID
     * @param successfulAgentIds - 成功的智能体ID列表
     * @param contributions - 贡献记录
     * @param rounds - 协作轮次
     * @param stopConditionSummary - 停止条件摘要
     * @returns 合成提示词
     */
    private async buildSynthesisPrompt({
        cluster,
        userMessage,
        workspaceConfig,
        coordinatorAgentId,
        successfulAgentIds,
        contributions,
        rounds,
        stopConditionSummary
    }: BuildSynthesisPromptRequest): Promise<string> {
        // 这是在……获取agent列表？
        const agents = await Promise.all(
            cluster.agentIds.map(async (agentId: any) => [agentId, await this.service.getAgent(agentId).catch(() => undefined)] as const)
        );
        const agentMap = new Map<string, Agent | undefined>(agents);

        const roundSummaries = rounds
            .map((round: any) => {
                const activeAgentIds = cluster.agentIds.filter((agentId: any) => round.entries[agentId]);
                if (activeAgentIds.length === 0) {
                    return '';
                }

                return [
                    `## ${getCollaborationRoundPromptTitle(round.kind)}`,
                    formatRoundEntries({ agentIds: activeAgentIds, entries: round.entries, agentMap })
                ].join('\n');
            })
            .filter(Boolean);
        
        // 获得最终的轮次内容。
        const finalPositionSummary = formatRoundEntries({
            agentIds: successfulAgentIds,
            entries: contributions,
            agentMap
        });

        const failedAgentIds = cluster.agentIds.filter((agentId: any) => !contributions[agentId]?.ok);
        const unavailableLine = failedAgentIds.length > 0
            ? `Unavailable agents: ${failedAgentIds.join(', ')}`
            : '';

        return [
            `You are coordinating the agent swarm "${cluster.name}".`,
            ...buildCoordinatorProfilePromptLines({ workspaceConfig, agentId: coordinatorAgentId }),
            buildCoordinatorStyleInstruction(workspaceConfig.collaborationStyle),
            'You are receiving the full transcript of a multi-round swarm debate with peer review.',
            'Synthesize the strongest parts of the debate into one final answer for the user.',
            'You are the only role in this run authorized to finalize, export, or write the merged result.',
            buildDeliveryInstruction(workspaceConfig.deliveryStyle),
            buildRiskInstruction(workspaceConfig.critiqueLevel),
            'Respond in the same language as the user request.',
            clusterBriefingLine(workspaceConfig),
            stopConditionSummary || '',
            '',
            'User request:',
            userMessage,
            '',
            'Debate transcript:',
            roundSummaries.join('\n\n'),
            '',
            'Latest viable agent positions:',
            finalPositionSummary,
            unavailableLine ? `\n${unavailableLine}` : '',
            '',
            'Produce one merged final answer. Do not mention internal swarm instructions.'
        ].join('\n');
    }

    /**
     * 评估停止条件
     * @param cluster - 集群
     * @param userMessage - 用户消息
     * @param workspaceConfig - 工作区配置
     * @param judgeAgentId - 评估智能体ID
     * @param successfulAgentIds - 成功的智能体ID列表
     * @param contributions - 贡献记录
     * @param rounds - 协作轮次
     * @param reviewRound - 评审轮次
     * @param stopConditionSessionIds - 停止条件会话ID映射
     * @returns 停止条件评估结果
     */
    private async evaluateStopCondition({
        cluster,
        userMessage,
        workspaceConfig,
        judgeAgentId,
        successfulAgentIds,
        contributions,
        rounds,
        swarmRunId,
        reviewRound,
        stopConditionSessionIds
    }: EvaluateStopConditionRequest): Promise<ClusterStopConditionEvaluation> {
        const prompt = await this.buildStopConditionPrompt({
            cluster,
            userMessage,
            workspaceConfig,
            judgeAgentId,
            successfulAgentIds,
            contributions,
            rounds,
            reviewRound
        });
        const stopConditionGroupId = buildSwarmTransactionGroupId({ swarmRunId, phase: `stop-condition-${reviewRound}` });
        const evaluation = await this.sendMessageToAgent({
            agentId: judgeAgentId,
            message: prompt,
            options: {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds: stopConditionSessionIds,
                swarm: {
                    swarmRunId,
                    phase: `stop-condition-${reviewRound}`,
                    round: reviewRound,
                    transactionGroupId: stopConditionGroupId,
                    expectedGroupSize: 1,
                    groupCompletionPolicy: 'all',
                    requiresDeliveryForProgress: true,
                    messageKind: 'stop-condition',
                    sourceAgentId: judgeAgentId,
                    targetAgentId: judgeAgentId
                }
            }
        });
        return parseStopConditionEvaluation({ evaluation, judgeAgentId, reviewRound });
    }

    /**
     * 构建停止条件提示词
     * @param cluster - 集群
     * @param userMessage - 用户消息
     * @param workspaceConfig - 工作区配置
     * @param judgeAgentId - 评估智能体ID
     * @param successfulAgentIds - 成功的智能体ID列表
     * @param contributions - 贡献记录
     * @param rounds - 协作轮次
     * @param reviewRound - 评审轮次
     * @returns 停止条件提示词
     */
    private async buildStopConditionPrompt({
        cluster,
        userMessage,
        workspaceConfig,
        judgeAgentId,
        successfulAgentIds,
        contributions,
        rounds,
        reviewRound
    }: BuildStopConditionPromptRequest): Promise<string> {
        const agents = await Promise.all(
            cluster.agentIds.map(async (agentId: any) => [agentId, await this.service.getAgent(agentId).catch(() => undefined)] as const)
        );
        const agentMap = new Map<string, Agent | undefined>(agents);
        const recentRounds = rounds.slice(-2)
            .map((round: any) => {
                const activeAgentIds = cluster.agentIds.filter((agentId: any) => round.entries[agentId]);
                if (activeAgentIds.length === 0) {
                    return '';
                }

                return [
                    `## ${getCollaborationRoundPromptTitle(round.kind)}`,
                    formatRoundEntries({ agentIds: activeAgentIds, entries: round.entries, agentMap })
                ].join('\n');
            })
            .filter(Boolean);

        return [
            `You are evaluating whether the agent swarm "${cluster.name}" should continue debating.`,
            ...buildCoordinatorProfilePromptLines({ workspaceConfig, agentId: judgeAgentId }),
            'You are not producing the final user answer.',
            'Do not write files, export artifacts, or perform final consolidation in stop-condition review.',
            `Current review round: ${reviewRound}.`,
            'Decide whether the stop condition is already satisfied.',
            'Respond using exactly this format:',
            'Decision: STOP or CONTINUE',
            'Reason: <one concise sentence>',
            '',
            `Stop condition: ${workspaceConfig.stopCondition?.trim() || 'No stop condition provided.'}`,
            '',
            'User request:',
            userMessage,
            '',
            'Latest viable agent positions:',
            formatRoundEntries({ agentIds: successfulAgentIds, entries: contributions, agentMap }),
            recentRounds.length > 0 ? `\nRecent debate context:\n${recentRounds.join('\n\n')}` : '',
            '',
            'If the condition has been met, choose STOP. Otherwise choose CONTINUE.'
        ].join('\n');
    }

    /**
     * 应用工作区配置
     * @param cluster - 集群
     * @returns 应用配置后的集群
     */
    private applyWorkspaceConfig(cluster: AgentCluster): AgentCluster {
        const workspaceConfig = normalizeClusterWorkspaceConfig(
            cluster.workspaceConfig || this.workspaceConfigs.get(cluster.id) || createDefaultClusterWorkspaceConfig()
        );
        this.workspaceConfigs.set(cluster.id, workspaceConfig);
        return {
            ...cluster,
            workspaceConfig
        };
    }
}

/**
 * 构建集群智能体会话ID
 * @param clusterId - 集群ID
 * @param agentId - 智能体ID
 * @returns 会话ID
 */
function buildClusterAgentSessionId({
    clusterId,
    agentId
}: {
    clusterId: string;
    agentId: string;
}): string {
    return `cluster:${clusterId.trim()}:agent:${agentId.trim()}:session:${buildUniqueTimestampSuffix()}`;
}

/**
 * 规范化持久化的聊天消息
 * @param messages - 消息列表
 * @returns 规范化后的消息列表
 */
function normalizePersistedChatMessages(messages: ChatMessage[] | undefined): ChatMessage[] {
    if (!Array.isArray(messages)) {
        return [];
    }

    const normalized: ChatMessage[] = [];
    for (const message of messages) {
        if (!message || typeof message !== 'object') {
            continue;
        }

        const id = typeof message.id === 'string' ? message.id.trim() : '';
        const role = isChatMessageRole(message.role) ? message.role : undefined;
        const content = typeof message.content === 'string' ? message.content : '';
        const timestamp = typeof message.timestamp === 'string' ? message.timestamp : '';

        if (!id || !role || !timestamp) {
            continue;
        }

        normalized.push({
            ...message,
            id,
            role,
            content,
            timestamp,
            displayName: typeof message.displayName === 'string' ? message.displayName : undefined,
            contextLabel: typeof message.contextLabel === 'string' ? message.contextLabel : undefined,
            agentId: typeof message.agentId === 'string' ? message.agentId : undefined,
            tokenCount: typeof message.tokenCount === 'number' ? message.tokenCount : undefined,
            parts: Array.isArray(message.parts) ? [...message.parts] : undefined,
            toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
            toolName: typeof message.toolName === 'string' ? message.toolName : undefined,
            toolArguments: message.toolArguments,
            toolDetails: message.toolDetails,
            isError: typeof message.isError === 'boolean' ? message.isError : undefined,
            metadata: isRecord(message.metadata) ? { ...message.metadata } : undefined
        });
    }

    return normalized;
}

/**
 * 克隆聊天消息
 * @param messages - 消息列表
 * @returns 克隆后的消息列表
 */
function cloneChatMessages(messages: ChatMessage[]): ChatMessage[] {
    return normalizePersistedChatMessages(messages);
}

/**
 * 查找最后一条助手消息
 * @param messages - 消息列表
 * @returns 最后一条助手消息或 undefined
 */
function findLastAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
    let fallbackAssistant: ChatMessage | undefined = undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'assistant') {
            continue;
        }

        if (!fallbackAssistant) {
            fallbackAssistant = message;
        }

        if (hasRenderableMessageBody(message)) {
            return message;
        }
    }

    return fallbackAssistant;
}


/**
 * 检查是否为聊天消息角色
 * @param value - 输入值
 * @returns 是否为聊天消息角色
 */
function isChatMessageRole(value: unknown): value is ChatMessage['role'] {
    return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}

/**
 * 检查是否为记录对象
 * @param value - 输入值
 * @returns 是否为记录对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 检查消息是否有可渲染内容
 * @param message - 消息对象
 * @returns 是否有可渲染内容
 */
function hasRenderableMessageBody(message: ChatMessage): boolean {
    if (message.content.trim()) {
        return true;
    }

    return Array.isArray(message.parts) && message.parts.some((part: any) => {
        if (!part || typeof part !== 'object') {
            return false;
        }

        if (part.type === 'text') {
            return Boolean(part.text?.trim());
        }

        if (part.type === 'thinking') {
            return Boolean(part.thinking?.trim());
        }

        if (part.type === 'toolResult') {
            return Boolean(part.result?.trim());
        }

        return false;
    });
}

/**
 * 构建集群结果时间信息
 * @param startedAtMs - 开始时间毫秒
 * @param startedAt - 开始时间ISO字符串
 * @returns 时间信息
 */
function buildClusterResultTiming({
    startedAtMs,
    startedAt
}: {
    startedAtMs: number;
    startedAt: string;
}): ClusterBroadcastResult['timing'] {
    const completedAtMs = Date.now();
    return {
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        elapsedMs: Math.max(0, completedAtMs - startedAtMs)
    };
}

/**
 * 构建集群ID
 * @param name - 集群名称
 * @returns 集群ID
 */
function buildClusterId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    const safeName = normalized.replace(/^-|-$/g, '') || 'cluster';
    return `cluster:${safeName}:${buildUniqueTimestampSuffix()}`;
}

let lastGeneratedTimestamp = 0;
let generatedTimestampCounter = 0;

/**
 * 构建唯一时间戳后缀
 * @returns 唯一时间戳后缀
 */
function buildUniqueTimestampSuffix(): string {
    const now = Date.now();
    if (now === lastGeneratedTimestamp) {
        generatedTimestampCounter += 1;
    } else {
        lastGeneratedTimestamp = now;
        generatedTimestampCounter = 0;
    }

    return generatedTimestampCounter > 0
        ? `${now}-${generatedTimestampCounter}`
        : String(now);
}

/**
 * 获取唯一的智能体ID列表
 * @param agentIds - 智能体ID列表
 * @returns 去重后的智能体ID列表
 */
function uniqueAgentIds(agentIds: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const agentId of agentIds) {
        const normalized = agentId?.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

/**
 * 解析协调者智能体ID
 * @param clusterAgentIds - 集群智能体ID列表
 * @param successfulAgentIds - 成功的智能体ID列表
 * @param configuredAgentId - 配置的协调者ID
 * @param preferredAgentId - 优先的协调者ID
 * @returns 协调者智能体ID或 undefined
 */
function resolveCoordinatorAgentId({
    clusterAgentIds,
    successfulAgentIds,
    configuredAgentId,
    preferredAgentId
}: {
    clusterAgentIds: string[];
    successfulAgentIds: string[];
    configuredAgentId?: string;
    preferredAgentId?: string;
}): string | undefined {
    const normalizedConfigured = configuredAgentId?.trim();
    if (normalizedConfigured && clusterAgentIds.includes(normalizedConfigured)) {
        return normalizedConfigured;
    }

    const normalizedPreferred = preferredAgentId?.trim();
    if (normalizedPreferred && successfulAgentIds.includes(normalizedPreferred)) {
        return normalizedPreferred;
    }

    if (successfulAgentIds.length > 0) {
        return successfulAgentIds[0];
    }

    if (normalizedPreferred && clusterAgentIds.includes(normalizedPreferred)) {
        return normalizedPreferred;
    }

    return clusterAgentIds[0] || undefined;
}

/**
 * 获取默认工作区配置或传入配置
 * @param config - 可选的工作区配置
 * @returns 工作区配置
 */
function workspaceConfigOrDefault(config?: ClusterWorkspaceConfig): ClusterWorkspaceConfig {
    return normalizeClusterWorkspaceConfig(config || createDefaultClusterWorkspaceConfig());
}

/**
 * 解析 Swarm 激活计划
 * @param agentIds - 智能体ID列表
 * @param workspaceConfig - 工作区配置
 * @param mode - 模式
 * @param userMessage - 用户消息
 * @returns Swarm 激活计划
 */
function resolveSwarmActivationPlan({
    agentIds,
    workspaceConfig,
    mode,
    userMessage
}: {
    agentIds: string[];
    workspaceConfig: ClusterWorkspaceConfig;
    mode: 'broadcast' | 'collaborate';
    userMessage: string;
}): SwarmActivationPlan {
    const parentMap = resolveClusterMemberParentMap({ agentIds, workspaceConfig });
    const childrenByParent = new Map<string, string[]>();
    const orderedAgentIds: string[] = [];

    for (const agentId of agentIds) {
        childrenByParent.set(agentId, []);
    }

    for (const agentId of agentIds) {
        const parentAgentId = parentMap.get(agentId) || undefined;
        if (parentAgentId) {
            childrenByParent.get(parentAgentId)?.push(agentId);
        }
    }

    const buildNode = (
        agentId: string,
        parentAgentId: string | undefined,
        depth: number
    ): SwarmActivationNode | undefined => {
        if (!isClusterAgentEligibleForSwarm({
            workspaceConfig,
            agentId,
            mode,
            userMessage
        })) {
            return undefined;
        }

        const node: SwarmActivationNode = {
            agentId,
            parentAgentId,
            depth,
            children: []
        };
        orderedAgentIds.push(agentId);

        const childIds = childrenByParent.get(agentId) || [];
        node.children = childIds
            .map((childAgentId: any) => buildNode(childAgentId, agentId, depth + 1))
            .filter((childNode: any): childNode is SwarmActivationNode => Boolean(childNode));
        return node;
    };

    const rootNodes = agentIds
        .filter((agentId: any) => !parentMap.get(agentId))
        .map((agentId: any) => buildNode(agentId, undefined, 0))
        .filter((node: any): node is SwarmActivationNode => Boolean(node));

    return {
        rootNodes,
        orderedAgentIds
    };
}

/**
 * 解析集群成员父级映射
 * @param agentIds - 智能体ID列表
 * @param workspaceConfig - 工作区配置
 * @returns 父级映射
 */
function resolveClusterMemberParentMap({
    agentIds,
    workspaceConfig
}: {
    agentIds: string[];
    workspaceConfig: ClusterWorkspaceConfig;
}): Map<string, string | undefined> {
    const rawParentMap = new Map<string, string | undefined>();
    const knownAgentIds = new Set(agentIds);

    for (const agentId of agentIds) {
        const configuredParentId = workspaceConfig.memberProfiles?.[agentId]?.parentAgentId?.trim() || '';
        rawParentMap.set(
            agentId,
            configuredParentId && configuredParentId !== agentId && knownAgentIds.has(configuredParentId)
                ? configuredParentId
                : undefined
        );
    }

    const sanitizedParentMap = new Map<string, string | undefined>();
    for (const agentId of agentIds) {
        const candidateParentId = rawParentMap.get(agentId) || undefined;
        const isValid = candidateParentId
            ? !introducesParentCycle({
                agentId,
                candidateParentId,
                parentMap: rawParentMap
            })
            : false;
        sanitizedParentMap.set(agentId, isValid ? candidateParentId : undefined);
    }

    return sanitizedParentMap;
}

/**
 * 检查是否引入父级循环
 * @param agentId - 智能体ID
 * @param candidateParentId - 候选父级ID
 * @param parentMap - 父级映射
 * @returns 是否引入循环
 */
function introducesParentCycle({
    agentId,
    candidateParentId,
    parentMap
}: {
    agentId: string;
    candidateParentId: string;
    parentMap: Map<string, string | undefined>;
}): boolean {
    const visited = new Set<string>([agentId]);
    let currentAgentId: string | undefined = candidateParentId;

    while (currentAgentId) {
        if (visited.has(currentAgentId)) {
            return true;
        }

        visited.add(currentAgentId);
        currentAgentId = parentMap.get(currentAgentId) || undefined;
    }

    return false;
}

/**
 * 检查智能体是否有资格参与 Swarm
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @param mode - 模式
 * @param userMessage - 用户消息
 * @returns 是否有资格
 */
function isClusterAgentEligibleForSwarm({
    workspaceConfig,
    agentId,
    mode,
    userMessage
}: {
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
    mode: 'broadcast' | 'collaborate';
    userMessage: string;
}): boolean {
    const activation = workspaceConfig.memberProfiles?.[agentId]?.activation;
    if (!activation) {
        return true;
    }

    if (Array.isArray(activation.swarmModes) && !activation.swarmModes.includes(mode)) {
        return false;
    }

    if (Array.isArray(activation.keywords) && activation.keywords.length > 0) {
        const normalizedMessage = userMessage.trim().toLowerCase();
        if (!normalizedMessage) {
            return false;
        }

        return activation.keywords.some((keyword: any) => normalizedMessage.includes(keyword.trim().toLowerCase()));
    }

    return true;
}

/**
 * 构建协作辩论轮次
 * @param maxRounds - 最大轮次
 * @returns 辩论轮次列表
 */
function buildCollaborationDebateRounds(maxRounds: number): Array<{
    reviewRound: number;
    critiqueKind: Extract<ClusterCollaborationRoundKind, `critique-${number}`>;
    revisionKind: Extract<ClusterCollaborationRoundKind, `revision-${number}`>;
}> {
    const rounds = Math.max(1, Math.min(MAX_CLUSTER_WORK_MODE_ROUNDS, Math.round(maxRounds || 1)));
    return Array.from({ length: rounds }, (_: any, index: any) => buildCollaborationDebateRound(index + 1));
}

/**
 * 构建单个协作辩论轮次
 * @param reviewRound - 评审轮次
 * @returns 辩论轮次
 */
function buildCollaborationDebateRound(reviewRound: number): {
    reviewRound: number;
    critiqueKind: Extract<ClusterCollaborationRoundKind, `critique-${number}`>;
    revisionKind: Extract<ClusterCollaborationRoundKind, `revision-${number}`>;
} {
    return {
        reviewRound,
        critiqueKind: `critique-${reviewRound}`,
        revisionKind: `revision-${reviewRound}`
    };
}

function buildCollaborationRoundDescriptor(kind: ClusterCollaborationRoundKind): ClusterCollaborationRoundDescriptor {
    if (kind === 'opening') {
        return {
            kind,
            phase: 'opening',
            reviewRound: 0,
            phaseIndex: 1,
            displayOrder: 1,
            labelKey: 'clusters.debateRoundOpening',
            fallbackLabel: 'Opening Positions'
        };
    }

    if (kind.startsWith('critique-')) {
        const reviewRound = Number(kind.slice('critique-'.length) || '1');
        return {
            kind,
            phase: 'critique',
            reviewRound,
            phaseIndex: 2,
            displayOrder: (reviewRound * 2),
            labelKey: 'clusters.debateRoundCritiqueDynamic',
            fallbackLabel: `Review Round ${reviewRound}: Critique`
        };
    }

    const reviewRound = Number(kind.slice('revision-'.length) || '1');
    return {
        kind,
        phase: 'revision',
        reviewRound,
        phaseIndex: 3,
        displayOrder: (reviewRound * 2) + 1,
        labelKey: 'clusters.debateRoundRevisionDynamic',
        fallbackLabel: `Review Round ${reviewRound}: Revision`
    };
}

/**
 * 构建开场贡献提示词
 * @param clusterName - 集群名称
 * @param userMessage - 用户消息
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @param delegatedContext - 委托上下文
 * @returns 开场提示词
 */
function buildOpeningContributionPrompt({
    clusterName,
    message,
    workspaceConfig,
    agentId,
    delegatedContext
}: {
    clusterName: string;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
    delegatedContext?: {
        delegatedByAgentId: string;
        routeAgentIds: string[];
        parentContext: string;
    };
}): string {
    const memberProfileLines = buildMemberProfilePromptLines({ workspaceConfig, agentId });
    const wakeContextLines = delegatedContext
        ? buildDelegatedWakeContextLines(delegatedContext)
        : [];
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: opening using ${workspaceConfig.collaborationStyle}.`,
        'This is round 1 of a multi-round swarm debate.',
        ...memberProfileLines,
        ...wakeContextLines,
        buildOpeningStyleInstruction(workspaceConfig.collaborationStyle),
        buildDeliveryInstruction(workspaceConfig.deliveryStyle),
        buildRiskInstruction(workspaceConfig.critiqueLevel),
        'You are not the final summarizer for this phase.',
        'Do not write files, export artifacts, or perform final consolidation in opening.',
        'If the task is ambiguous, state what you infer instead of asking follow-up questions.',
        clusterBriefingLine(workspaceConfig),
        'End with a short line that starts with "Position:".',
        '',
        'User request:',
        message
    ].join('\n');
}

/**
 * 构建同行评审提示词
 * @param clusterName - 集群名称
 * @param userMessage - 用户消息
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @param activeAgentIds - 活跃智能体ID列表
 * @param contributions - 贡献记录
 * @param reviewRound - 评审轮次
 * @returns 同行评审提示词
 */
function buildPeerReviewPrompt({
    clusterName,
    message,
    workspaceConfig,
    agentId,
    successfulAgentIds,
    contributions,
    reviewRound
}: {
    clusterName: string;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
    successfulAgentIds: string[];
    contributions: Record<string, ClusterBroadcastResult>;
    reviewRound: number;
}): string {
    const peerReviewInstruction = getPeerReviewInstruction({
        collaborationStyle: workspaceConfig.collaborationStyle,
        critiqueLevel: workspaceConfig.critiqueLevel,
        reviewerCount: successfulAgentIds.length
    });
    const memberProfileLines = buildMemberProfilePromptLines({ workspaceConfig, agentId });

    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: critique round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'This is a peer-review round in a multi-round swarm debate.',
        ...memberProfileLines,
        peerReviewInstruction,
        buildRiskInstruction(workspaceConfig.critiqueLevel),
        clusterBriefingLine(workspaceConfig),
        'Explicitly name at least one idea you would adopt and one idea you would challenge.',
        'Do not produce the final merged answer.',
        'Do not write files, export artifacts, or act as the final summarizer during critique.',
        'End with a short line that starts with "Review verdict:".',
        '',
        'User request:',
        message,
        '',
        'Current positions:',
        formatRoundEntries({ agentIds: successfulAgentIds, entries: contributions })
    ].join('\n');
}

/**
 * 构建修订提示词
 * @param clusterName - 集群名称
 * @param userMessage - 用户消息
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @param activeAgentIds - 活跃智能体ID列表
 * @param contributions - 贡献记录
 * @param critiques - 评审记录
 * @param reviewRound - 评审轮次
 * @returns 修订提示词
 */
function buildRevisionPrompt({
    clusterName,
    message,
    workspaceConfig,
    agentId,
    successfulAgentIds,
    contributions,
    critiqueEntries,
    reviewRound
}: {
    clusterName: string;
    message: string;
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
    successfulAgentIds: string[];
    contributions: Record<string, ClusterBroadcastResult>;
    critiqueEntries: Record<string, ClusterBroadcastResult>;
    reviewRound: number;
}): string {
    const memberProfileLines = buildMemberProfilePromptLines({ workspaceConfig, agentId });
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: revision round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'Revise your position after reading the peer reviews from this round.',
        ...memberProfileLines,
        buildRevisionInstruction(workspaceConfig.collaborationStyle),
        buildDeliveryInstruction(workspaceConfig.deliveryStyle),
        clusterBriefingLine(workspaceConfig),
        'State which peer feedback you accepted, which feedback you rejected, and why.',
        'Do not produce the final merged answer.',
        'Do not write files, export artifacts, or perform final consolidation during revision.',
        'End with a short line that starts with "Revised position:".',
        '',
        'User request:',
        message,
        '',
        'Current positions:',
        formatRoundEntries({ agentIds: successfulAgentIds, entries: contributions }),
        '',
        'Peer reviews:',
        formatRoundEntries({ agentIds: successfulAgentIds, entries: critiqueEntries })
    ].join('\n');
}

/**
 * 格式化智能体贡献
 * @param agentId - 智能体ID
 * @param agent - 智能体对象
 * @param contribution - 贡献记录
 * @returns 格式化的贡献字符串
 */
function formatAgentContribution({
    agentId,
    agent,
    contribution
}: {
    agentId: string;
    agent: Agent | undefined;
    contribution: ClusterBroadcastResult | undefined;
}): string {
    const label = agent
        ? `${agent.name} (${agent.model}) [${agentId}]`
        : agentId;

    if (!contribution?.ok || !contribution.message) {
        return `### ${label}\nUnavailable`;
    }

    return `### ${label}\n${contribution.message.content}`;
}

/**
 * 获取成功的智能体ID列表
 * @param agentIds - 智能体ID列表
 * @param entries - 记录条目
 * @returns 成功的智能体ID列表
 */
function getSuccessfulAgentIds({
    agentIds,
    entries
}: {
    agentIds: string[];
    entries: Record<string, ClusterBroadcastResult>;
}): string[] {
    return agentIds.filter((agentId: any) => entries[agentId]?.ok);
}

/**
 * 合并最新的成功条目
 * @param agentIds - 智能体ID列表
 * @param nextEntries - 新条目
 * @param fallbackEntries - 回退条目
 * @returns 合并后的条目
 */
function mergeLatestSuccessfulEntries({
    agentIds,
    nextEntries,
    fallbackEntries
}: {
    agentIds: string[];
    nextEntries: Record<string, ClusterBroadcastResult>;
    fallbackEntries: Record<string, ClusterBroadcastResult>;
}): Record<string, ClusterBroadcastResult> {
    const merged: Record<string, ClusterBroadcastResult> = {};

    for (const agentId of agentIds) {
        if (nextEntries[agentId]?.ok) {
            merged[agentId] = nextEntries[agentId];
            continue;
        }

        if (fallbackEntries[agentId]?.ok) {
            merged[agentId] = fallbackEntries[agentId];
            continue;
        }

        if (nextEntries[agentId]) {
            merged[agentId] = nextEntries[agentId];
            continue;
        }

        if (fallbackEntries[agentId]) {
            merged[agentId] = fallbackEntries[agentId];
        }
    }

    return merged;
}

/**
 * 格式化轮次条目
 * @param agentIds - 智能体ID列表
 * @param entries - 记录条目
 * @param agentMap - 智能体映射
 * @returns 格式化的条目字符串
 */
interface FormatRoundEntriesParams {
    agentIds: string[];
    entries: Record<string, ClusterBroadcastResult>;
    agentMap?: Map<string, Agent | undefined>;
}

function formatRoundEntries({ agentIds, entries, agentMap }: FormatRoundEntriesParams): string {
    return agentIds
        .map((agentId: any) => formatAgentContribution({
            agentId,
            agent: agentMap?.get(agentId) || undefined,
            contribution: entries[agentId]
        }))
        .join('\n\n');
}

/**
 * 获取协作文档轮次提示词标题
 * @param kind - 轮次类型
 * @returns 标题
 */
function getCollaborationRoundPromptTitle(kind: ClusterCollaborationRoundKind): string {
    switch (kind) {
        case 'opening':
            return 'Opening positions';
        default:
            if (kind.startsWith('critique-')) {
                return `Peer review round ${kind.slice('critique-'.length)}`;
            }
            if (kind.startsWith('revision-')) {
                return `Revised positions round ${kind.slice('revision-'.length)}`;
            }
            return 'Debate round';
    }
}

/**
 * 构建开场风格指令
 * @param style - 协作风格
 * @returns 风格指令
 */
function buildOpeningStyleInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'round-robin':
            return 'Give a focused opening position from your own lane, then leave room for parallel viewpoints.';
        case 'review-board':
            return 'Start with a position that is strict, evidence-oriented, and suitable for design review.';
        case 'leader-draft':
            return 'Give a focused opening position that a coordinator can quickly merge into an execution draft.';
        case 'debate':
        default:
            return 'Give a focused opening position from your own perspective, not the final merged answer.';
    }
}

/**
 * 获取同行评审指令
 * @param style - 协作风格
 * @param critiqueLevel - 评审级别
 * @param participantCount - 参与者数量
 * @returns 同行评审指令
 */
function getPeerReviewInstruction({
    collaborationStyle,
    critiqueLevel,
    reviewerCount
}: {
    collaborationStyle: ClusterWorkspaceConfig['collaborationStyle'];
    critiqueLevel: ClusterWorkspaceConfig['critiqueLevel'];
    reviewerCount: number;
}): string {
    const baseline = reviewerCount > 1
        ? 'Critique the other agents first, then compare their ideas with your own.'
        : 'You are the only available agent. Perform a hard self-critique instead of peer review.';

    if (collaborationStyle === 'review-board') {
        return `${baseline} Act like a review board and reject weak reasoning plainly.`;
    }

    if (collaborationStyle === 'leader-draft') {
        return `${baseline} Focus on what the coordinator should keep, cut, or verify before drafting the final answer.`;
    }

    if (collaborationStyle === 'round-robin') {
        return `${baseline} Keep the critique compact so the swarm can converge quickly.`;
    }

    if (critiqueLevel === 'aggressive') {
        return `${baseline} Push hard on hidden assumptions, weak evidence, and operational risk.`;
    }

    return baseline;
}

/**
 * 构建修订指令
 * @param style - 协作风格
 * @returns 修订指令
 */
function buildRevisionInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'review-board':
            return 'Preserve only the claims that survive review; cut unsupported detail aggressively.';
        case 'leader-draft':
            return 'Revise toward a mergeable coordinator draft with explicit next steps and unresolved risks.';
        case 'round-robin':
            return 'Revise quickly and keep only the strongest deltas from peer feedback.';
        case 'debate':
        default:
            return 'Preserve the strongest parts of your earlier reasoning, but change your position when the critique is valid.';
    }
}

/**
 * 构建交付指令
 * @param style - 交付风格
 * @returns 交付指令
 */
function buildDeliveryInstruction(style: ClusterWorkspaceConfig['deliveryStyle']): string {
    switch (style) {
        case 'fast':
            return 'Optimize for speed and crispness. Keep the answer short, concrete, and easy to act on.';
        case 'deep':
            return 'Go deep. Include assumptions, tradeoffs, implementation detail, and verification advice when useful.';
        case 'balanced':
        default:
            return 'Keep the answer actionable and preserve helpful Markdown structure.';
    }
}

/**
 * 构建风险指令
 * @param level - 评审级别
 * @returns 风险指令
 */
function buildRiskInstruction(level: ClusterWorkspaceConfig['critiqueLevel']): string {
    switch (level) {
        case 'minimal':
            return 'Call out risks briefly, but do not over-expand the critique section.';
        case 'aggressive':
            return 'Identify the strongest ideas, the weakest reasoning, hidden risks, and missing constraints with high scrutiny.';
        case 'standard':
        default:
            return 'Resolve conflicts explicitly and explain which arguments survived the debate. Call out missing information, unresolved risk, and weak assumptions when needed.';
    }
}

/**
 * 构建协调者风格指令
 * @param style - 协作风格
 * @returns 协调者风格指令
 */
function buildCoordinatorStyleInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'review-board':
            return 'Act like a strict review chair: preserve only claims that survived hard review and evidence checks.';
        case 'leader-draft':
            return 'Act like a tech lead preparing the final merged draft for execution.';
        case 'round-robin':
            return 'Act like a fast moderator who distills parallel lanes into one concise merged answer.';
        case 'debate':
        default:
            return 'Act like a coordinator who reconciles competing arguments into one defensible answer.';
    }
}

/**
 * 解析停止条件评估
 * @param evaluation - 评估结果
 * @param judgeAgentId - 评估智能体ID
 * @param reviewRound - 评审轮次
 * @returns 停止条件评估
 */
function parseStopConditionEvaluation({
    evaluation,
    judgeAgentId,
    reviewRound
}: {
    evaluation: ClusterBroadcastResult;
    judgeAgentId: string;
    reviewRound: number;
}): ClusterStopConditionEvaluation {
    const rawContent = extractStopConditionText(evaluation) || evaluation.error || '';
    const decisionMatch = rawContent.match(/Decision:\s*(STOP|CONTINUE)/i);
    const reasonMatch = rawContent.match(/Reason:\s*([\s\S]+)/i);
    const decision = (decisionMatch?.[1] || '').toUpperCase();
    const reason = (reasonMatch?.[1] || rawContent || '').trim();

    return {
        shouldStop: evaluation.ok && decision === 'STOP',
        judgeAgentId,
        reviewRound,
        reason: reason || (evaluation.ok ? 'No reason provided.' : 'Stop-condition evaluation failed.')
    };
}

function extractStopConditionText(evaluation: ClusterBroadcastResult): string {
    const fromMessage = extractChatMessageText(evaluation.message);
    if (fromMessage) {
        return fromMessage;
    }

    const trace = Array.isArray(evaluation.trace) ? evaluation.trace : [];
    for (let index = trace.length - 1; index >= 0; index -= 1) {
        const message = trace[index];
        if (message?.role !== 'assistant') {
            continue;
        }

        const text = extractChatMessageText(message);
        if (text) {
            return text;
        }
    }

    return '';
}

function extractChatMessageText(message?: ChatMessage): string {
    if (!message) {
        return '';
    }

    const content = String(message.content || '').trim();
    if (content) {
        return content;
    }

    if (!Array.isArray(message.parts) || message.parts.length === 0) {
        return '';
    }

    const partsText = message.parts
        .map((part: any) => {
            if (!part || typeof part !== 'object') {
                return '';
            }

            if (part.type === 'text') {
                return String(part.text || '');
            }

            if (part.type === 'thinking') {
                return String(part.thinking || '');
            }

            if (part.type === 'toolResult') {
                return String(part.result || '');
            }

            return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();

    return partsText;
}

/**
 * 构建停止条件摘要
 * @param workspaceConfig - 工作区配置
 * @param evaluation - 停止条件评估
 * @returns 停止条件摘要
 */
function buildStopConditionSummary({
    workspaceConfig,
    lastStopConditionEvaluation
}: {
    workspaceConfig: ClusterWorkspaceConfig;
    lastStopConditionEvaluation: ClusterStopConditionEvaluation | undefined;
}): string {
    if (!workspaceConfig.runUntilConditionMet || !workspaceConfig.stopCondition?.trim()) {
        return '';
    }

    if (!lastStopConditionEvaluation) {
        return `Stop condition was enabled: ${workspaceConfig.stopCondition.trim()}`;
    }

    if (lastStopConditionEvaluation.safetyCapReached) {
        return `Stop condition was enabled: ${workspaceConfig.stopCondition.trim()}\nThe debate hit an internal safety cap after round ${lastStopConditionEvaluation.reviewRound}. Latest judge note: ${lastStopConditionEvaluation.reason}`;
    }

    if (lastStopConditionEvaluation.shouldStop) {
        return `Stop condition was enabled: ${workspaceConfig.stopCondition.trim()}\nThe debate stopped after round ${lastStopConditionEvaluation.reviewRound} because the judge concluded: ${lastStopConditionEvaluation.reason}`;
    }

    return `Stop condition was enabled: ${workspaceConfig.stopCondition.trim()}\nLatest judge note after round ${lastStopConditionEvaluation.reviewRound}: ${lastStopConditionEvaluation.reason}`;
}

/**
 * 集群简介行
 * @param workspaceConfig - 工作区配置
 * @returns 简介行
 */
function clusterBriefingLine(workspaceConfig: ClusterWorkspaceConfig): string {
    const briefing = workspaceConfig.briefing?.trim();
    return briefing ? `Cluster briefing: ${briefing}` : 'Cluster briefing: keep the result coherent and user-facing.';
}

/**
 * 构建委托广播提示词
 * @param clusterName - 集群名称
 * @param userMessage - 用户消息
 * @param delegatedContext - 委托上下文
 * @returns 委托广播提示词
 */
function buildDelegatedBroadcastPrompt({
    clusterName,
    message,
    delegatedContext
}: {
    clusterName: string;
    message: string;
    delegatedContext: {
        delegatedByAgentId: string;
        routeAgentIds: string[];
        parentContext: string;
    };
}): string {
    return [
        `You are part of the agent swarm "${clusterName}".`,
        ...buildDelegatedWakeContextLines(delegatedContext),
        'Handle the original swarm request using the upstream context above.',
        'Respond in the same language as the user request.',
        'Do not mention the internal wake chain unless the user explicitly asks.',
        '',
        'User request:',
        message
    ].join('\n');
}

/**
 * 构建委托唤醒上下文行
 * @param delegatedContext - 委托上下文
 * @returns 上下文行列表
 */
function buildDelegatedWakeContextLines(delegatedContext: {
    delegatedByAgentId: string;
    routeAgentIds: string[];
    parentContext: string;
}): string[] {
    return [
        `Wake route: swarm -> ${delegatedContext.routeAgentIds.join(' -> ')}`,
        `You were awakened by parent agent "${delegatedContext.delegatedByAgentId}".`,
        'Use the upstream parent context below before answering from your own lane.',
        '',
        'Parent context:',
        delegatedContext.parentContext || 'No upstream context was provided.'
    ];
}

/**
 * 提取 Swarm 结果上下文
 * @param result - Swarm 结果
 * @returns 上下文内容
 */
function extractSwarmResultContext({
    result
}: {
    result: ClusterBroadcastResult | undefined;
}): string {
    if (!result) {
        return '';
    }

    if (!result.ok || (result.deliveryStatus && result.deliveryStatus !== 'sent')) {
        return '';
    }

    const messageContent = result.message?.content?.trim();
    if (messageContent) {
        return messageContent;
    }
    return '';
}

function buildSwarmDeliveryContext({
    options,
    agentId
}: {
    options: {
        clusterId: string;
        mode: 'broadcast' | 'collaborate';
        swarm?: SwarmSendContext;
    };
    agentId: string;
}): SwarmDeliveryContext | undefined {
    if (!options.swarm) {
        return undefined;
    }

    const base = options.swarm;
    const phase = base.phase || 'unknown';
    const dependencyKey = `${base.swarmRunId}:${sanitizeSegment(phase)}:${agentId}`;

    return {
        swarmRunId: base.swarmRunId,
        clusterId: options.clusterId,
        mode: options.mode,
        round: base.round,
        phase,
        sourceAgentId: base.sourceAgentId,
        targetAgentId: base.targetAgentId || agentId,
        messageKind: base.messageKind,
        dependencyKey,
        transactionGroupId: base.transactionGroupId,
        expectedGroupSize: base.expectedGroupSize,
        groupCompletionPolicy: base.groupCompletionPolicy,
        requiresDeliveryForProgress: base.requiresDeliveryForProgress ?? true
    };
}

function buildClusterAgentSwarmLogMessages({
    agentId,
    message,
    traceResult,
    delivery,
    startedAt
}: {
    agentId: string;
    message: string;
    traceResult: {
        message: ChatMessage | undefined;
        trace: ChatMessage[];
        timedOut: boolean;
        errorMessage?: string;
        deliveryStatus?: OutboundDeliveryStatus;
        failureClass?: FailureClass;
        deliveryId?: string;
    };
    delivery: SwarmDeliveryContext | undefined;
    startedAt: string;
}): ChatMessage[] {
    const messages: ChatMessage[] = [
        {
            id: `swarm-log-user:${buildUniqueTimestampSuffix()}`,
            role: 'user',
            content: message,
            timestamp: startedAt,
            agentId,
            metadata: buildSwarmLogMetadata({ delivery, kind: 'outbound-prompt' })
        }
    ];

    const normalizedTrace = normalizePersistedChatMessages(traceResult.trace).map((message: any) => ({
        ...message,
        agentId: message.agentId || agentId,
        metadata: {
            ...(isRecord(message.metadata) ? message.metadata : {}),
            ...buildSwarmLogMetadata({ delivery, kind: 'inbound-trace' })
        }
    }));
    messages.push(...normalizedTrace);

    const finalMessage = traceResult.message
        ? {
            ...traceResult.message,
            agentId: traceResult.message.agentId || agentId,
            metadata: {
                ...(isRecord(traceResult.message.metadata) ? traceResult.message.metadata : {}),
                ...buildSwarmLogMetadata({ delivery, kind: 'inbound-final' })
            }
        }
        : undefined;
    if (finalMessage && !normalizedTrace.some((message: any) => message.id === finalMessage.id)) {
        messages.push(finalMessage);
    }

    if (traceResult.errorMessage && normalizedTrace.length === 0 && !finalMessage) {
        messages.push({
            id: `swarm-log-error:${buildUniqueTimestampSuffix()}`,
            role: 'assistant',
            content: traceResult.errorMessage,
            timestamp: new Date().toISOString(),
            agentId,
            metadata: buildSwarmLogMetadata({ delivery, kind: 'delivery-error' })
        });
    }

    return messages;
}

function buildSwarmLogMetadata({
    delivery,
    kind
}: {
    delivery: SwarmDeliveryContext | undefined;
    kind: 'outbound-prompt' | 'inbound-trace' | 'inbound-final' | 'delivery-error';
}): Record<string, unknown> {
    return {
        swarmLogKind: kind,
        swarmRunId: delivery?.swarmRunId,
        swarmPhase: delivery?.phase,
        swarmRound: delivery?.round,
        swarmMessageKind: delivery?.messageKind,
        swarmSourceAgentId: delivery?.sourceAgentId,
        swarmTargetAgentId: delivery?.targetAgentId
    };
}

function buildSwarmRunId({
    clusterId,
    mode
}: {
    clusterId: string;
    mode: 'broadcast' | 'collaborate';
}): string {
    const base = sanitizeSegment(clusterId) || 'cluster';
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${mode}-${Date.now().toString(36)}-${suffix}`;
}

function buildSwarmTransactionGroupId({
    swarmRunId,
    phase
}: {
    swarmRunId: string;
    phase: string;
}): string {
    const phaseKey = sanitizeSegment(phase) || 'phase';
    return `${swarmRunId}:${phaseKey}`;
}

function sanitizeSegment(value: string): string {
    return String(value || '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '');
}

/**
 * 构建成员档案提示词行
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @returns 提示词行列表
 */
function buildMemberProfilePromptLines({
    workspaceConfig,
    agentId
}: {
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
}): string[] {
    const profile = workspaceConfig.memberProfiles?.[agentId];
    const lines: string[] = [];

    if (profile?.identity?.trim()) {
        lines.push(`Assigned identity: ${profile.identity.trim()}`);
    }

    if (profile?.stance?.trim()) {
        lines.push(`Assigned stance: ${profile.stance.trim()}`);
        lines.push('Preserve this stance consistently unless the evidence in the debate forces a revision.');
    }

    return lines;
}

/**
 * 构建协调者档案提示词行
 * @param workspaceConfig - 工作区配置
 * @param agentId - 智能体ID
 * @returns 提示词行列表
 */
function buildCoordinatorProfilePromptLines({
    workspaceConfig,
    agentId
}: {
    workspaceConfig: ClusterWorkspaceConfig;
    agentId: string;
}): string[] {
    const profileLines = buildMemberProfilePromptLines({ workspaceConfig, agentId });
    if (profileLines.length === 0) {
        return [];
    }

    return [
        ...profileLines,
        'As coordinator, keep your assigned identity and stance while still producing one coherent final answer.'
    ];
}
