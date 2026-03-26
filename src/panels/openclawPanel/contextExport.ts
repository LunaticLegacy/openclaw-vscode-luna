import * as path from 'path';
import type { ChatMessage } from '../../services/openclawService';
import type {
    ClusterAgentContextExportBody,
    ClusterContextExportBody,
    ClusterContextExportBundle,
    ClusterContextExportKind,
    ClusterSwarmContextExportBody,
    ClusterSwarmReplayImport,
    ClusterSwarmStructureExportBody,
    ClusterSwarmStructureImport
} from '../../types/contextExport';

export type {
    ClusterAgentContextExportBody,
    ClusterContextExportBody,
    ClusterContextExportBundle,
    ClusterContextExportKind,
    ClusterSwarmContextExportBody,
    ClusterSwarmReplayImport,
    ClusterSwarmStructureExportBody,
    ClusterSwarmStructureImport
} from '../../types/contextExport';

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
            swarmRunId: typeof body.swarmRunId === 'string' && body.swarmRunId.trim()
                ? body.swarmRunId.trim()
                : undefined,
            messageCount: normalizedMessages.length,
            messages: normalizedMessages
        }
    };
}

/**
 * Parses a swarm structure import from JSON content
 * @param sourcePath - The source file path
 * @param rawContent - The raw JSON content
 * @returns The parsed swarm structure import data
 * @throws Error if the JSON is invalid or missing required fields
 */
export function parseClusterSwarmStructureImport(
    sourcePath: string,
    rawContent: string
): ClusterSwarmStructureImport {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        throw new Error('Swarm JSON is invalid.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Swarm JSON must be an object.');
    }

    const body = parsed as Partial<ClusterSwarmStructureExportBody>;
    if (body.kind !== 'swarm-structure') {
        throw new Error('Only swarm structure JSON exports can be imported.');
    }

    if (!body.swarm || typeof body.swarm !== 'object') {
        throw new Error('Swarm JSON is missing swarm information.');
    }

    const swarm = body.swarm as ClusterSwarmStructureExportBody['swarm'];
    if (!swarm.id || !swarm.name || !Array.isArray(swarm.members)) {
        throw new Error('Swarm JSON is missing required swarm fields.');
    }

    const normalizedMembers = swarm.members
        .filter((member: any) => member && typeof member === 'object')
        .map((member: any) => ({
            id: String(member.id || '').trim(),
            name: typeof member.name === 'string' ? member.name.trim() : '',
            model: typeof member.model === 'string' ? member.model.trim() : '',
            systemPrompt: typeof member.systemPrompt === 'string' ? member.systemPrompt : undefined,
            presetId: typeof member.presetId === 'string' ? member.presetId.trim() : undefined,
            enabledSkills: Array.isArray(member.enabledSkills)
                ? member.enabledSkills.map((skill: any) => String(skill || '').trim()).filter(Boolean)
                : undefined
        }))
        .filter((member: any) => member.id);

    if (normalizedMembers.length === 0) {
        throw new Error('Swarm JSON contains no valid members.');
    }

    return {
        sourcePath,
        importedAt: new Date().toISOString(),
        body: {
            kind: 'swarm-structure',
            exportedAt: typeof body.exportedAt === 'string' && body.exportedAt.trim()
                ? body.exportedAt
                : new Date().toISOString(),
            swarm: {
                id: swarm.id,
                name: swarm.name,
                createdAt: typeof swarm.createdAt === 'string' ? swarm.createdAt : undefined,
                workspaceConfig: typeof swarm.workspaceConfig === 'object' && swarm.workspaceConfig && !Array.isArray(swarm.workspaceConfig)
                    ? swarm.workspaceConfig
                    : undefined,
                members: normalizedMembers
            }
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
        if (body.swarmRunId) {
            lines.push(`- Run ID: ${body.swarmRunId}`);
        }
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
            .map((message: any, index: any) => renderMessageBlock(message, index + 1))
            .filter((block: any) => block.length > 0)
        : [];

    if (renderedMessages.length === 0) {
        lines.push('_No messages captured._');
        return lines;
    }

    renderedMessages.forEach((block: any, index: any) => {
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
