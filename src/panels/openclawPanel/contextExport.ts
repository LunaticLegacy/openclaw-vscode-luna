import * as path from 'path';
import type { ChatMessage } from '../../services/openclawService';

interface ExportClusterInfo {
    id: string;
    name: string;
    agentIds: string[];
}

interface ExportAgentInfo {
    id: string;
    name: string;
    model: string | null;
}

export interface ClusterSwarmContextExportBody {
    exportedAt: string;
    kind: 'cluster-swarm-context';
    cluster: ExportClusterInfo;
    mode: 'broadcast' | 'collaborate';
    messageCount: number;
    messages: ChatMessage[];
}

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

export type ClusterContextExportBody =
    | ClusterSwarmContextExportBody
    | ClusterAgentContextExportBody;

export interface ClusterContextExportBundle {
    baseName: string;
    readableFileName: string;
    rawFileName: string;
    body: ClusterContextExportBody;
    readableMarkdown: string;
}

export type ClusterContextExportKind = 'readable' | 'raw';

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

export function resolveContextExportPath(selectedPath: string, kind: ClusterContextExportKind): string {
    const parsed = path.parse(selectedPath);
    const normalizedBasePath = parsed.ext.toLowerCase() === '.md' || parsed.ext.toLowerCase() === '.json'
        ? path.join(parsed.dir, parsed.name)
        : selectedPath;
    return `${normalizedBasePath}.${kind === 'readable' ? 'md' : 'json'}`;
}

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
