import type { DiscoveredChannel, ChatMessage } from '../../services/openclawService';

/**
 * Record type for panel channels
 */
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

/**
 * Normalizes outgoing message content by standardizing line endings
 * @param content - The raw message content
 * @returns The normalized content
 */
export function normalizeOutgoingMessageContent(content: string): string {
    return String(content ?? '').replace(/\r\n?/g, '\n');
}

/**
 * Builds a signature for message sync comparison
 * @param messages - The array of chat messages
 * @returns The JSON stringified signature
 */
export function buildMessageSyncSignature(messages: ChatMessage[]): string {
    return JSON.stringify(messages.map((message: any) => ({
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

/**
 * Creates a delay promise
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve: any) => setTimeout(resolve, ms));
}

/**
 * Merges local and discovered channels into a unified list
 * @param localChannels - The local channels from the channel manager
 * @param discoveredChannels - The discovered channels from the service
 * @returns The merged and sorted channel records
 */
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

    return Array.from(merged.values()).sort((left: any, right: any) => {
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

/**
 * Builds a session key for imported channels
 * @param channel - The discovered channel
 * @param agentId - The agent ID
 * @returns The session key string
 */
export function buildImportedChannelSessionKey(channel: DiscoveredChannel, agentId: string): string {
    const providerId = String(channel.providerId || '').trim();
    const accountId = String(channel.accountId || '').trim();
    return `agent:${agentId}:channel:${providerId}:${accountId}`;
}
