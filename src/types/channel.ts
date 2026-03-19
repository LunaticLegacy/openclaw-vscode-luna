// Channel Types - Redesigned hierarchical channel system

export type ChannelType = 
  | 'root'      // Root container, no direct chat
  | 'standard'  // Standard channel with chat
  | 'thread'    // Child thread, inherits config
  | 'aggregate' // Aggregates content from sources
  | 'external'; // External data source

// ===== Channel Configuration =====

export interface ChannelConfig {
  // Base fields
  id: string;
  type: ChannelType;
  name: string;
  description?: string;

  // Hierarchy
  parentId?: string;
  childrenIds: string[];
  order: number;

  // Chat config
  agentId?: string;
  sessionId?: string;
  inheritAgent: boolean;

  // Aggregate config (for aggregate type)
  aggregateConfig?: ChannelAggregateConfig;

  // External source config (for external type)
  externalConfig?: ChannelSourceConfig;

  // Metadata
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  settings: ChannelSettings;
}

export interface ChannelSettings {
  notifications: boolean;
  autoArchive: boolean;
  archiveAfterDays?: number;
  theme?: string;
}

export interface CreateChannelParams {
  name: string;
  type?: ChannelType;
  parentId?: string;
  description?: string;
  agentId?: string;
  inheritAgent?: boolean;
}

export interface UpdateChannelParams {
  name?: string;
  description?: string;
  parentId?: string | null;  // null to move to root
  order?: number;
  agentId?: string;
  sessionId?: string | null;
  inheritAgent?: boolean;
  settings?: Partial<ChannelSettings>;
}

export interface MoveChannelParams {
  channelId: string;
  newParentId?: string | null;
  newOrder?: number;
}

// ===== Aggregate Configuration =====

export interface ChannelAggregateConfig {
  sourceIds: string[];
  filter?: AggregateFilter;
  transform: AggregateTransformType;
  schedule: AggregateSchedule;
  maxItems: number;
  summarizerAgentId?: string;  // Agent for AI summary
}

export type AggregateTransformType = 'none' | 'summary' | 'ai-summarize';
export type AggregateSchedule = 'realtime' | 'hourly' | 'daily';

export interface AggregateFilter {
  keywords?: string[];
  authors?: string[];
  since?: string;
  until?: string;
}

// ===== External Source Configuration =====

export type SourceProvider = 
  | 'rss' 
  | 'youtube' 
  | 'twitter' 
  | 'github' 
  | 'webhook' 
  | 'custom';

export interface ChannelSourceConfig {
  provider: SourceProvider;
  name: string;
  enabled: boolean;
  credentials: SourceCredentials;
  config: SourceProviderConfig;
  sync: SourceSyncConfig;
  processing: SourceProcessingConfig;
}

export interface SourceCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export type SourceProviderConfig =
  | RSSConfig
  | YouTubeConfig
  | TwitterConfig
  | GitHubConfig
  | WebhookConfig
  | CustomAPIConfig;

export interface RSSConfig {
  type: 'rss';
  url: string;
  fetchFullContent: boolean;
}

export interface YouTubeConfig {
  type: 'youtube';
  channelId?: string;
  playlistId?: string;
  searchQuery?: string;
  includeComments: boolean;
}

export interface TwitterConfig {
  type: 'twitter';
  searchQuery?: string;
  userHandles?: string[];
  includeReplies: boolean;
  includeRetweets: boolean;
}

export interface GitHubConfig {
  type: 'github';
  repos?: string[];
  events?: GitHubEventType[];
}

export type GitHubEventType = 'release' | 'issue' | 'pr' | 'commit';

export interface WebhookConfig {
  type: 'webhook';
  secret?: string;
}

export interface CustomAPIConfig {
  type: 'custom';
  endpoint: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  jqFilter?: string;
}

export interface SourceSyncConfig {
  interval: number;  // minutes
  lastSyncAt?: string;
  lastError?: string;
  status: 'idle' | 'syncing' | 'error';
  nextSyncAt?: string;
}

export interface SourceProcessingConfig {
  deduplicate: boolean;
  summarize: boolean;
  translate?: string;
  maxLength?: number;
}

// ===== Aggregated Content =====

export interface AggregatedItem {
  id: string;
  channelId: string;
  sourceType: 'internal' | 'external';
  
  original: {
    title?: string;
    content: string;
    author?: string;
    url?: string;
    publishedAt: string;
    metadata?: Record<string, unknown>;
  };
  
  processed?: {
    summary?: string;
    translated?: string;
    tags?: string[];
  };
  
  messageId?: string;
  createdAt: string;
}

// ===== Channel Tree =====

export interface ChannelTreeNode extends ChannelConfig {
  children: ChannelTreeNode[];
  depth: number;
  isLeaf: boolean;
}

export interface ChannelTree {
  roots: ChannelTreeNode[];
  all: Map<string, ChannelTreeNode>;
}

// ===== API Responses =====

export interface ChannelSyncResult {
  channelId: string;
  itemsAdded: number;
  itemsUpdated: number;
  itemsFailed: number;
  errors: string[];
}

export interface ChannelMoveResult {
  success: boolean;
  movedChannel: ChannelConfig;
  oldParentId?: string;
  newParentId?: string;
  affectedChannelIds: string[];
}

// ===== Migration =====

// Legacy channel (for migration)
export interface LegacyChannelConfig {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}
