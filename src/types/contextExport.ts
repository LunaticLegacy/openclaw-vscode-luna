import type { ChatMessage } from '../services/openclawService';

/**
 * Information about a cluster for export
 */
export interface ExportClusterInfo {
    id: string;
    name: string;
    agentIds: string[];
}

/**
 * Information about an agent for export
 */
export interface ExportAgentInfo {
    id: string;
    name: string;
    model?: string;
}

/**
 * Body of a cluster swarm context export
 */
export interface ClusterSwarmContextExportBody {
    exportedAt: string;
    kind: 'cluster-swarm-context';
    cluster: ExportClusterInfo;
    mode: 'broadcast' | 'collaborate';
    swarmRunId?: string;
    messageCount: number;
    messages: ChatMessage[];
}

/**
 * Body of a cluster agent context export
 */
export interface ClusterAgentContextExportBody {
    exportedAt: string;
    kind: 'cluster-agent-context';
    cluster: ExportClusterInfo;
    agent: ExportAgentInfo;
    currentView: 'chat' | 'broadcast' | 'collaborate';
    messageCounts: {
        direct: number;
        broadcast: number;
        collaborate: number;
    };
    conversations: {
        direct: ChatMessage[];
        broadcast: ChatMessage[];
        collaborate: ChatMessage[];
    };
}

/**
 * Union type for cluster context export bodies
 */
export type ClusterContextExportBody =
    | ClusterSwarmContextExportBody
    | ClusterAgentContextExportBody;

/**
 * Bundle containing all export data and metadata
 */
export interface ClusterContextExportBundle {
    baseName: string;
    readableFileName: string;
    rawFileName: string;
    body: ClusterContextExportBody;
    readableMarkdown: string;
}

/**
 * Type for export kind (readable markdown or raw JSON)
 */
export type ClusterContextExportKind = 'readable' | 'raw';

/**
 * Import data for cluster swarm replay
 */
export interface ClusterSwarmReplayImport {
    sourcePath: string;
    importedAt: string;
    body: ClusterSwarmContextExportBody;
}

/**
 * Body of a swarm structure export
 */
export interface ClusterSwarmStructureExportBody {
    kind: 'swarm-structure';
    exportedAt: string;
    swarm: {
        id: string;
        name: string;
        createdAt?: string;
        workspaceConfig?: Record<string, unknown>;
        members: Array<{
            id: string;
            name?: string;
            model?: string;
            systemPrompt?: string;
            presetId?: string;
            enabledSkills?: string[];
        }>;
    };
}

/**
 * Import data for swarm structure
 */
export interface ClusterSwarmStructureImport {
    sourcePath: string;
    importedAt: string;
    body: ClusterSwarmStructureExportBody;
}
