import type { DiscoveredChannel, ChatMessage } from '../../services/openclawService';

export type PanelChannelRecord = {
    id: string;
    name: string;
    agentId?: string;
    description?: string;
    sessionId?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: 'local' | 'openclaw';
    providerId?: string;
    accountId?: string;
};

export function normalizeOutgoingMessageContent(content: string): string {
    return String(content ?? '').replace(/\r\n?/g, '\n');
}

export function buildMessageSyncSignature(messages: ChatMessage[]): string {
    return JSON.stringify(messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        tokenCount: message.tokenCount,
        parts: message.parts,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        toolArguments: message.toolArguments,
        toolDetails: message.toolDetails,
        isError: message.isError,
        metadata: message.metadata
    })));
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function mergePanelChannels(
    localChannels: Array<{
        id: string;
        name: string;
        agentId: string;
        description?: string;
        sessionId?: string;
        createdAt: string;
        updatedAt: string;
    }>,
    discoveredChannels: DiscoveredChannel[]
): PanelChannelRecord[] {
    const merged = new Map<string, PanelChannelRecord>();

    for (const channel of localChannels) {
        merged.set(channel.id, {
            ...channel,
            source: 'local'
        });
    }

    for (const channel of discoveredChannels) {
        if (merged.has(channel.id)) {
            continue;
        }

        merged.set(channel.id, {
            ...channel,
            source: 'openclaw',
            agentId: ''
        });
    }

    return Array.from(merged.values()).sort((left, right) => {
        if ((left.source || 'local') !== (right.source || 'local')) {
            return left.source === 'local' ? -1 : 1;
        }

        const leftUpdated = left.updatedAt || '';
        const rightUpdated = right.updatedAt || '';
        if (leftUpdated && rightUpdated && leftUpdated !== rightUpdated) {
            return rightUpdated.localeCompare(leftUpdated);
        }

        return left.name.localeCompare(right.name);
    });
}

export function buildImportedChannelSessionKey(channel: DiscoveredChannel, agentId: string): string {
    const providerId = String(channel.providerId || '').trim();
    const accountId = String(channel.accountId || '').trim();
    return `agent:${agentId}:channel:${providerId}:${accountId}`;
}
