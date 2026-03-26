import type { ClusterContextExportKind } from './contextExport';

export interface ChannelDraftPayload {
    name?: string;
    agentId?: string;
    description?: string;
}

export interface ClusterSwarmExportOptions {
    clusterId: string;
}

export interface ClusterContextExportOptions {
    clusterId: string;
    targetKind: 'swarm' | 'agent';
    mode?: 'broadcast' | 'collaborate';
    swarmRunId?: string;
    agentId?: string;
    agentViewMode?: 'chat' | 'broadcast' | 'collaborate';
}

export interface ClusterConversationExportOptions extends ClusterContextExportOptions {
    exportKind: ClusterContextExportKind;
}

export interface ConnectionSettings {
    configMode?: 'auto' | 'gateway' | 'local' | 'openclaw';
    gatewayUrl?: string;
    gatewayToken?: string;
}

export interface OpenClawConfigSettings {
    gatewayPort?: number | string;
    gatewayToken?: string;
    defaultWorkspace?: string;
    defaultModel?: string;
    authProviderId?: string;
    authApiKey?: string;
}

export interface ClusterCreateAgentDraft {
    name?: string;
    model?: string;
    systemPrompt?: string;
    presetId?: string;
    enabledSkills?: string[];
}

export interface ClusterSaveData {
    name?: string;
    agentIds?: string[];
    createAgents?: ClusterCreateAgentDraft[];
    workspaceConfig?: Record<string, unknown>;
}

export interface ClusterCreateFromMemberPresetParams {
    memberPresetId: string;
    customName?: string;
    model?: string;
}

export interface SkillDownloadProgress {
    downloadedBytes: number;
    totalBytes?: number;
    bytesPerSecond?: number;
    percent?: number;
}

export interface AgentBatchCreateData {
    agents?: ClusterCreateAgentDraft[];
}

export interface SendMessageOptions {
    optimisticEcho?: boolean;
}
