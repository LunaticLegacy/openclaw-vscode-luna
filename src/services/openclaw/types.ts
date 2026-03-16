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

export interface AgentCluster {
    id: string;
    name: string;
    agentIds: string[];
    status: 'active' | 'inactive';
    createdAt: string;
    workspaceConfig?: ClusterWorkspaceConfig;
}

export interface ClusterMemberProfile {
    identity?: string;
    stance?: string;
    parentAgentId?: string;
    activation?: {
        swarmModes?: Array<'broadcast' | 'collaborate'>;
        keywords?: string[];
    };
}

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

export interface RuntimeNotice {
    kind: 'fallback' | 'compression';
    message: string;
    agentId?: string;
    sessionId?: string;
    phase?: string;
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

export interface CreateChatSessionOptions {
    sessionId?: string;
}

export interface DiscoveredChannel {
    id: string;
    name: string;
    source: 'openclaw';
    providerId: string;
    accountId: string;
    description?: string;
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

export interface StreamChunk {
    content: string;
    done: boolean;
    tokenCount?: number;
    message?: ChatMessage;
}

export interface RealtimeUsageSnapshot {
    activeSessions: number;
    requestsPerMinute: number;
    tokensPerMinute: number;
}

export interface CreateAgentParams {
    name: string;
    model: string;
    systemPrompt?: string;
    enabledSkills?: string[];
}

export interface UpdateAgentParams {
    name?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    enabledSkills?: string[];
}

export interface SendMessageOptions {
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
}

export interface StreamMessageOptions {
    temperature?: number;
    maxTokens?: number;
}

export interface CreateClusterParams {
    name: string;
    agentIds: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

export interface LocalAgent extends Agent {
    providerId: string;
    baseUrl: string;
    api: string;
    apiKey: string;
}

export type ServiceEventSink = (eventName: string, ...args: unknown[]) => unknown;
