import * as path from 'path';
import type { ChatMessage } from '../../services/openclawService';

/**
 * Information about a cluster for export
 */
interface ExportClusterInfo {
    id: string;
    name: string;
    agentIds: string[];
}

/**
 * Information about an agent for export
 */
interface ExportAgentInfo {
    id: string;
    name: string;
    model: string | null;
}

/**
 * Body of a cluster swarm context export
 */
export interface ClusterSwarmContextExportBody {
    exportedAt: string;
    kind: 'cluster-swarm-context';
    cluster: ExportClusterInfo;
    mode: 'broadcast' | 'collaborate';
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
 * Builds a cluster context export bundle
 * @param baseName - The base file name
 * @param body - The export body data
 * @returns The complete export bundle
 */
export function buildClusterContextExportBundle(
    baseName: string,
    body: ClusterContextExportBody
): ClusterContextExportBundle {
    return {
        baseName,
        readableFileName: `${baseName}.md`,
        rawFileName: `${baseName}.json`,
        body,
        readableMarkdown: renderReadableClusterContextMarkdown(body)
    };
}

/**
 * Resolves the export path based on the selected path and export kind
 * @param selectedPath - The user-selected path
 * @param kind - The export kind (readable or raw)
 * @returns The resolved export path
 */
export function resolveContextExportPath(selectedPath: string, kind: ClusterContextExportKind): string {
    const parsed = path.parse(selectedPath);
    const normalizedBasePath = parsed.ext.toLowerCase() === '.md' || parsed.ext.toLowerCase() === '.json'
        ? path.join(parsed.dir, parsed.name)
        : selectedPath;
    return `${normalizedBasePath}.${kind === 'readable' ? 'md' : 'json'}`;
}

/**
 * Parses a cluster swarm replay import from JSON content
 * @param sourcePath - The source file path
 * @param rawContent - The raw JSON content
 * @returns The parsed replay import data
 * @throws Error if the JSON is invalid or missing required fields
 */
export function parseClusterSwarmReplayImport(
    sourcePath: string,
    rawContent: string
): ClusterSwarmReplayImport {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        throw new Error('Replay JSON is invalid.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Replay JSON must be an object.');
    }

    const body = parsed as Partial<ClusterSwarmContextExportBody>;
    if (body.kind !== 'cluster-swarm-context') {
        throw new Error('Only swarm context JSON exports can be replayed.');
    }

    if (!body.cluster?.id || !body.cluster?.name || !Array.isArray(body.cluster?.agentIds)) {
        throw new Error('Replay JSON is missing cluster information.');
    }

    if (body.mode !== 'broadcast' && body.mode !== 'collaborate') {
        throw new Error('Replay JSON is missing a valid swarm mode.');
    }

    const normalizedMessages = normalizeReplayMessages(body.messages);

    return {
        sourcePath,
        importedAt: new Date().toISOString(),
        body: {
            exportedAt: typeof body.exportedAt === 'string' && body.exportedAt.trim()
                ? body.exportedAt
                : new Date().toISOString(),
            kind: 'cluster-swarm-context',
            cluster: {
                id: body.cluster.id,
                name: body.cluster.name,
                agentIds: [...body.cluster.agentIds]
            },
            mode: body.mode,
            messageCount: normalizedMessages.length,
            messages: normalizedMessages
        }
    };
}

/**
 * Renders the cluster context as readable markdown
 * @param body - The export body data
 * @returns The rendered markdown string
 */
function renderReadableClusterContextMarkdown(body: ClusterContextExportBody): string {
    const lines: string[] = [];

    lines.push(`# ${body.kind === 'cluster-agent-context' ? 'Agent Conversation Export' : 'Swarm Conversation Export'}`);
    lines.push('');
    lines.push(`- Exported At: ${body.exportedAt}`);
    lines.push(`- Cluster: ${body.cluster.name} (${body.cluster.id})`);
    lines.push(`- Agents: ${body.cluster.agentIds.join(', ') || 'None'}`);
    if (body.kind === 'cluster-agent-context') {
        lines.push(`- Agent: ${body.agent.name} (${body.agent.id})`);
        lines.push(`- Model: ${body.agent.model || 'Unknown'}`);
        lines.push(`- Current View: ${body.currentView}`);
        lines.push(`- Message Counts: direct=${body.messageCounts.direct}, broadcast=${body.messageCounts.broadcast}, collaborate=${body.messageCounts.collaborate}`);
    } else {
        lines.push(`- Mode: ${body.mode}`);
        lines.push(`- Message Count: ${body.messageCount}`);
    }
    lines.push('');
    lines.push(...renderHumanReadableSections(body));

    return lines.join('\n').trimEnd() + '\n';
}

/**
 * Renders human-readable sections for the export
 * @param body - The export body data
 * @returns Array of section lines
 */
function renderHumanReadableSections(body: ClusterContextExportBody): string[] {
    if (body.kind === 'cluster-agent-context') {
        return [
            ...renderMessageSection('Direct Conversation', body.conversations.direct),
            '',
            ...renderMessageSection('Broadcast Debate Log', body.conversations.broadcast),
            '',
            ...renderMessageSection('Collaborate Debate Log', body.conversations.collaborate)
        ];
    }

    return renderMessageSection(
        body.mode === 'broadcast' ? 'Broadcast Timeline' : 'Collaboration Timeline',
        body.messages
    );
}

/**
 * Renders a message section
 * @param title - The section title
 * @param messages - The messages to render
 * @returns Array of rendered lines
 */
function renderMessageSection(title: string, messages: ChatMessage[]): string[] {
    const lines: string[] = [];
    lines.push(`### ${title}`);
    lines.push('');

    const renderedMessages = Array.isArray(messages)
        ? messages
            .map((message, index) => renderMessageBlock(message, index + 1))
            .filter(block => block.length > 0)
        : [];

    if (renderedMessages.length === 0) {
        lines.push('_No messages captured._');
        return lines;
    }

    renderedMessages.forEach((block, index) => {
        if (index > 0) {
            lines.push('');
        }
        lines.push(...block);
    });

    return lines;
}

/**
 * Renders a single message block
 * @param message - The chat message
 * @param index - The message index
 * @returns Array of rendered lines
 */
function renderMessageBlock(message: ChatMessage, index: number): string[] {
    const lines: string[] = [];
    if (!shouldIncludeInReadableExport(message)) {
        return lines;
    }

    const title = [
        message.displayName || '',
        message.contextLabel ? `[${message.contextLabel}]` : '',
        message.role ? `(${message.role})` : ''
    ].filter(Boolean).join(' ').trim() || `Message ${index}`;

    lines.push(`#### ${index}. ${title}`);
    if (message.timestamp) {
        lines.push(`- Time: ${message.timestamp}`);
    }
    if (message.agentId) {
        lines.push(`- Agent ID: ${message.agentId}`);
    }

    const content = String(message.content || '').trim();
    if (content) {
        lines.push('');
        lines.push(content);
    }

    return lines;
}

/**
 * Determines if a message should be included in readable export
 * @param message - The chat message
 * @returns True if the message should be included
 */
function shouldIncludeInReadableExport(message: ChatMessage): boolean {
    if (!message) {
        return false;
    }
    if (message.role === 'tool') {
        return false;
    }
    if (message.metadata?.noticeType === 'lifecycle') {
        return false;
    }
    return Boolean(String(message.content || '').trim());
}

/**
 * Normalizes replay messages from imported data
 * @param messages - The raw messages array
 * @returns The normalized chat messages
 */
function normalizeReplayMessages(messages: unknown): ChatMessage[] {
    if (!Array.isArray(messages)) {
        return [];
    }

    const normalized: ChatMessage[] = [];
    for (const message of messages) {
        if (!message || typeof message !== 'object') {
            continue;
        }

        const record = message as Partial<ChatMessage>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const role = record.role;
        const timestamp = typeof record.timestamp === 'string' ? record.timestamp.trim() : '';
        if (!id || !timestamp || (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool')) {
            continue;
        }

        normalized.push({
            ...record,
            id,
            role,
            content: typeof record.content === 'string' ? record.content : '',
            timestamp,
            displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
            contextLabel: typeof record.contextLabel === 'string' ? record.contextLabel : undefined,
            agentId: typeof record.agentId === 'string' ? record.agentId : undefined,
            tokenCount: typeof record.tokenCount === 'number' ? record.tokenCount : undefined,
            toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
            toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
            toolArguments: record.toolArguments,
            toolDetails: record.toolDetails,
            isError: typeof record.isError === 'boolean' ? record.isError : undefined,
            parts: Array.isArray(record.parts) ? [...record.parts] : undefined,
            metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
                ? { ...record.metadata }
                : undefined
        });
    }

    return normalized;
}
