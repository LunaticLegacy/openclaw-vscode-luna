/**
 * Represents an AI agent with its configuration and state.
 */
export interface Agent {
    id: string;
    name: string;
    model: string;
    systemPrompt?: string;
    enabledSkills?: string[];
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

/**
 * Represents a cluster of agents working together.
 */
export interface AgentCluster {
    id: string;
    name: string;
    agentIds: string[];
    status: 'active' | 'inactive';
    createdAt: string;
    workspaceConfig?: ClusterWorkspaceConfig;
}

/**
 * Profile configuration for a cluster member.
 */
export interface ClusterMemberProfile {
    identity?: string;
    stance?: string;
    parentAgentId?: string;
    presetIdentityId?: string;
    activation?: {
        swarmModes?: Array<'broadcast' | 'collaborate'>;
        keywords?: string[];
    };
}

/**
 * Workspace configuration for a cluster.
 */
export interface ClusterWorkspaceConfig {
    presetId: string;
    collaborationStyle: 'debate' | 'round-robin' | 'review-board' | 'leader-draft';
    deliveryStyle: 'fast' | 'balanced' | 'deep';
    critiqueLevel: 'minimal' | 'standard' | 'aggressive';
    rounds: number;
    runUntilConditionMet?: boolean;
    stopCondition?: string;
    briefing?: string;
    coordinatorAgentId?: string;
    memberProfiles?: Record<string, ClusterMemberProfile>;
}

/**
 * Represents a chat message in a conversation.
 */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string;
    displayName?: string;
    contextLabel?: string;
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

/**
 * Represents a runtime notice for model fallback or compression.
 */
export interface RuntimeNotice {
    kind: 'fallback' | 'compression';
    message: string;
    agentId?: string;
    sessionId?: string;
    phase?: string;
}

/**
 * Union type for chat message parts.
 */
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

/**
 * Represents a chat session.
 */
export interface ChatSession {
    id: string;
    agentId: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
}

/**
 * Options for creating a chat session.
 */
export interface CreateChatSessionOptions {
    sessionId?: string;
}

/**
 * Represents a discovered external channel.
 */
export interface DiscoveredChannel {
    id: string;
    name: string;
    source: 'openclaw';
    providerId: string;
    accountId: string;
    description?: string;
}

/**
 * API usage statistics.
 */
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
    byChannel?: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
    }>;
    byChannelByDay?: Record<string, Record<string, {
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

/**
 * Chunk of a streaming response.
 */
export interface StreamChunk {
    content: string;
    done: boolean;
    tokenCount?: number;
    message?: ChatMessage;
}

/**
 * Real-time usage snapshot.
 */
export interface RealtimeUsageSnapshot {
    activeSessions: number;
    requestsPerMinute: number;
    tokensPerMinute: number;
}

/**
 * Parameters for creating an agent.
 */
export interface CreateAgentParams {
    name: string;
    model: string;
    systemPrompt?: string;
    enabledSkills?: string[];
}

/**
 * Parameters for updating an agent.
 */
export interface UpdateAgentParams {
    name?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    enabledSkills?: string[];
}

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    delivery?: SwarmDeliveryContext;
    timeoutMs?: number;
    ttlMs?: number;
    idempotencyKey?: string;
    laneKey?: string;
}

/**
 * Swarm-aware delivery context for outbound messages.
 */
export interface SwarmDeliveryContext {
    swarmRunId: string;
    clusterId: string;
    mode: 'broadcast' | 'collaborate' | 'agent';
    round?: number;
    phase?: string;
    sourceAgentId?: string;
    targetAgentId?: string;
    messageKind?: string;
    dependencyKey?: string;
    transactionGroupId?: string;
    expectedGroupSize?: number;
    groupCompletionPolicy?: 'all' | 'any';
    requiresDeliveryForProgress?: boolean;
}

export type SwarmMode = 'broadcast' | 'collaborate';

export type SwarmRunLifecycleStatus =
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed';

export type SwarmRunPhase =
    | 'broadcast'
    | 'opening'
    | 'critique'
    | 'revision'
    | 'stop-condition'
    | 'synthesis';

export interface SwarmRoundSnapshotEntry {
    agentId: string;
    ok: boolean;
    content?: string;
    error?: string;
}

export interface SwarmRoundSnapshot {
    runId: string;
    round: number;
    phase: 'opening' | 'critique' | 'revision';
    entries: Record<string, SwarmRoundSnapshotEntry>;
    createdAt: string;
}

export interface SwarmRunState {
    runId: string;                      // 运行时ID
    clusterId: string;                  // 集群ID
    mode: SwarmMode;                    // 集群运行模式
    status: SwarmRunLifecycleStatus;
    phase: SwarmRunPhase;
    currentRound: number;               // 当前轮次
    coordinatorAgentId?: string;  // 调度者ID
    startedAt: string;                  // 启动时间（或轮次，不确定）
    stoppedAt?: string;                 // 停止时间（同上）
    stopReason?: string;                // 停止原因
    cancellationRequested: boolean;     // 
    snapshots?: SwarmRoundSnapshot[];   // 本轮快照
}

/**
 * Options for streaming a message.
 */
export interface StreamMessageOptions {
    temperature?: number;
    maxTokens?: number;
}

/**
 * Parameters for creating a cluster.
 */
export interface CreateClusterParams {
    name: string;
    agentIds: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

/**
 * Parameters for updating a cluster.
 */
export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

/**
 * Local agent with provider-specific configuration.
 */
export interface LocalAgent extends Agent {
    providerId: string;
    baseUrl: string;
    api: string;
    apiKey: string;
}

/**
 * Event sink function type for service events.
 */
export type ServiceEventSink = (eventName: string, ...args: unknown[]) => unknown;
