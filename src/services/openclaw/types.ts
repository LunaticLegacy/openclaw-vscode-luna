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

export interface RealtimeUsageSnapshot {
    activeSessions: number;
    requestsPerMinute: number;
    tokensPerMinute: number;
}

export interface CreateAgentParams {
    name: string;
    model: string;
    systemPrompt?: string;
}

export interface UpdateAgentParams {
    name?: string;
    systemPrompt?: string;
    model?: string;
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
}

export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
}

export interface LocalAgent extends Agent {
    providerId: string;
    baseUrl: string;
    api: string;
    apiKey: string;
}

export type ServiceEventSink = (eventName: string, ...args: unknown[]) => unknown;
