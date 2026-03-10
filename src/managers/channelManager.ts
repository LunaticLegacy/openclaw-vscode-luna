import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';

export interface ChannelConfig {
    id: string;
    name: string;
    agentId: string;
    description?: string;
    sessionId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateChannelParams {
    name: string;
    agentId: string;
    description?: string;
}

export interface UpdateChannelParams {
    name?: string;
    agentId?: string;
    description?: string;
    sessionId?: string | null;
}

interface PersistedChannelsFile {
    version: number;
    channels: ChannelConfig[];
}

export class ChannelManager extends EventEmitter {
    private readonly storageFilePath: string;
    private readonly channels: Map<string, ChannelConfig> = new Map();
    private loaded = false;
    private loadPromise: Promise<void> | null = null;

    constructor(storageFilePath: string) {
        super();
        this.storageFilePath = storageFilePath;
    }

    public async getChannels(refresh: boolean = false): Promise<ChannelConfig[]> {
        await this.ensureLoaded(refresh);
        return Array.from(this.channels.values()).sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
        );
    }

    public async getChannel(channelId: string): Promise<ChannelConfig | null> {
        await this.ensureLoaded();
        return this.channels.get(channelId) || null;
    }

    public async createChannel(params: CreateChannelParams): Promise<ChannelConfig> {
        await this.ensureLoaded();

        const now = new Date().toISOString();
        const channel: ChannelConfig = {
            id: buildChannelId(params.name),
            name: requireNonEmpty(params.name, 'channel.validationName'),
            agentId: requireNonEmpty(params.agentId, 'channel.validationAgent'),
            description: normalizeOptionalText(params.description),
            createdAt: now,
            updatedAt: now
        };

        this.channels.set(channel.id, channel);
        await this.persist();
        this.emit('channelCreated', channel);
        return channel;
    }

    public async updateChannel(channelId: string, params: UpdateChannelParams): Promise<ChannelConfig> {
        await this.ensureLoaded();

        const existing = this.channels.get(channelId);
        if (!existing) {
            throw new Error(t('channel.notFound'));
        }

        const nextAgentId = params.agentId !== undefined
            ? requireNonEmpty(params.agentId, 'channel.validationAgent')
            : existing.agentId;
        const agentChanged = nextAgentId !== existing.agentId;

        const updated: ChannelConfig = {
            ...existing,
            ...(params.name !== undefined ? { name: requireNonEmpty(params.name, 'channel.validationName') } : {}),
            ...(params.description !== undefined ? { description: normalizeOptionalText(params.description) } : {}),
            ...(params.agentId !== undefined ? { agentId: nextAgentId } : {}),
            updatedAt: new Date().toISOString()
        };

        if (params.sessionId !== undefined) {
            updated.sessionId = normalizeOptionalText(params.sessionId) || undefined;
        } else if (agentChanged) {
            updated.sessionId = undefined;
        }

        this.channels.set(channelId, updated);
        await this.persist();
        this.emit('channelUpdated', updated);
        return updated;
    }

    public async setChannelSessionId(channelId: string, sessionId: string): Promise<ChannelConfig> {
        return this.updateChannel(channelId, { sessionId });
    }

    public async clearChannelSessionId(channelId: string): Promise<ChannelConfig> {
        return this.updateChannel(channelId, { sessionId: null });
    }

    public async deleteChannel(channelId: string): Promise<void> {
        await this.ensureLoaded();
        this.channels.delete(channelId);
        await this.persist();
        this.emit('channelDeleted', channelId);
    }

    public async refresh(): Promise<ChannelConfig[]> {
        return this.getChannels(true);
    }

    public dispose(): void {
        this.removeAllListeners();
        this.channels.clear();
        this.loaded = false;
        this.loadPromise = null;
    }

    private async ensureLoaded(forceRefresh: boolean = false): Promise<void> {
        if (forceRefresh) {
            this.loaded = false;
        }

        if (this.loaded) {
            return;
        }

        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }

        this.loadPromise = (async () => {
            this.channels.clear();

            try {
                const content = await fs.readFile(this.storageFilePath, 'utf8');
                const data = JSON.parse(content) as PersistedChannelsFile;

                for (const channel of data.channels || []) {
                    if (!channel?.id || !channel?.name || !channel?.agentId) {
                        continue;
                    }

                    this.channels.set(channel.id, {
                        id: channel.id,
                        name: channel.name.trim(),
                        agentId: channel.agentId.trim(),
                        description: normalizeOptionalText(channel.description),
                        sessionId: normalizeOptionalText(channel.sessionId),
                        createdAt: channel.createdAt || new Date().toISOString(),
                        updatedAt: channel.updatedAt || channel.createdAt || new Date().toISOString()
                    });
                }
            } catch (error) {
                const maybeNodeError = error as NodeJS.ErrnoException;
                if (maybeNodeError.code !== 'ENOENT') {
                    throw error;
                }
            }

            this.loaded = true;
        })();

        try {
            await this.loadPromise;
        } finally {
            this.loadPromise = null;
        }
    }

    private async persist(): Promise<void> {
        const payload: PersistedChannelsFile = {
            version: 1,
            channels: Array.from(this.channels.values())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }
}

function buildChannelId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    const safeName = normalized.replace(/^-|-$/g, '') || 'channel';
    return `channel:${safeName}:${Date.now()}`;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalized = String(value || '').trim();
    return normalized ? normalized : undefined;
}

function requireNonEmpty(value: string, key: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(t(key));
    }

    return normalized;
}
