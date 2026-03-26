import type { SkillInstallProgress } from './skillMarket';

export interface SkillInstallOptions {
    onProgress?: (progress: SkillInstallProgress) => void;
}

export interface AggregateChannelOptions {
    force?: boolean;
}

export interface AggregateSubtreeOptions {
    recursive?: boolean;
}

export interface ChannelSyncOptions {
    force?: boolean;
    since?: Date;
}

export interface ProcessItemsConfig {
    deduplicate: boolean;
    summarize: boolean;
    translate?: string;
    maxLength?: number;
}

export interface UsageCurrencyHint {
    code: string;
    symbol: string;
}

export interface LoadAgentsSnapshotOptions {
    forceRefresh?: boolean;
    metadataTimeoutMs?: number;
}

export interface GatewayClientCloseEvent {
    intentional?: boolean;
}

export interface OpenClawIdentityValues {
    agentId: string;
    name: string;
    model: string;
}

export interface PersistClusterExportOptions {
    baseName: string;
    kind: 'raw' | 'readable';
    content: string;
    clusterId: string;
    mode?: string;
}

export interface RecordSyncOptions {
    event: string;
    summary: string;
}

export interface SetOptionalStringOptions {
    trimAsPath?: boolean;
}
