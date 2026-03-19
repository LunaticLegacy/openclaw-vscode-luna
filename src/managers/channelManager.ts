import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';

/**
 * 频道配置接口
 */
export interface ChannelConfig {
    id: string;
    name: string;
    agentId: string;
    description?: string;
    sessionId?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * 创建频道参数
 */
export interface CreateChannelParams {
    name: string;
    agentId: string;
    description?: string;
}

/**
 * 更新频道参数
 */
export interface UpdateChannelParams {
    name?: string;
    agentId?: string;
    description?: string;
    sessionId?: string | null;
}

/**
 * 持久化频道文件结构
 */
interface PersistedChannelsFile {
    version: number;
    channels: ChannelConfig[];
}

/**
 * 频道管理器，负责管理频道的创建、更新、删除和持久化
 * 
 * @emits channelCreated - 当频道被创建时触发
 * @emits channelUpdated - 当频道被更新时触发
 * @emits channelDeleted - 当频道被删除时触发
 * 
 * @example
 * ```typescript
 * const manager = new ChannelManager(storageFilePath);
 * const channel = await manager.createChannel({ name: 'General', agentId: 'agent-1' });
 * ```
 */
export class ChannelManager extends EventEmitter {
    private readonly storageFilePath: string;
    private readonly channels: Map<string, ChannelConfig> = new Map();
    private loaded = false;
    private loadPromise: Promise<void> | null = null;

    /**
     * 创建 ChannelManager 实例
     * @param storageFilePath - 存储文件路径
     */
    constructor(storageFilePath: string) {
        super();
        this.storageFilePath = storageFilePath;
    }

    /**
     * 获取所有频道
     * 
     * @param refresh - 是否强制刷新
     * @returns 频道列表
     */
    public async getChannels(refresh: boolean = false): Promise<ChannelConfig[]> {
        await this.ensureLoaded(refresh);
        return Array.from(this.channels.values()).sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
        );
    }

    /**
     * 获取指定频道
     * 
     * @param channelId - 频道ID
     * @returns 频道对象或 null
     */
    public async getChannel(channelId: string): Promise<ChannelConfig | null> {
        await this.ensureLoaded();
        return this.channels.get(channelId) || null;
    }

    /**
     * 创建新频道
     * 
     * @param params - 创建频道参数
     * @returns 创建的频道
     * @throws Error - 当验证失败时抛出
     */
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

    /**
     * 更新频道
     * 
     * @param channelId - 频道ID
     * @param params - 更新参数
     * @returns 更新后的频道
     * @throws Error - 当频道不存在时抛出
     */
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

    /**
     * 设置频道会话ID
     * 
     * @param channelId - 频道ID
     * @param sessionId - 会话ID
     * @returns 更新后的频道
     */
    public async setChannelSessionId(channelId: string, sessionId: string): Promise<ChannelConfig> {
        return this.updateChannel(channelId, { sessionId });
    }

    /**
     * 清除频道会话ID
     * 
     * @param channelId - 频道ID
     * @returns 更新后的频道
     */
    public async clearChannelSessionId(channelId: string): Promise<ChannelConfig> {
        return this.updateChannel(channelId, { sessionId: null });
    }

    /**
     * 删除频道
     * 
     * @param channelId - 频道ID
     * @returns Promise<void>
     */
    public async deleteChannel(channelId: string): Promise<void> {
        await this.ensureLoaded();
        this.channels.delete(channelId);
        await this.persist();
        this.emit('channelDeleted', channelId);
    }

    /**
     * 刷新频道列表
     * 
     * @returns 刷新后的频道列表
     */
    public async refresh(): Promise<ChannelConfig[]> {
        return this.getChannels(true);
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.removeAllListeners();
        this.channels.clear();
        this.loaded = false;
        this.loadPromise = null;
    }

    /**
     * 确保数据已加载
     * @param forceRefresh - 是否强制刷新
     */
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

    /**
     * 持久化数据到磁盘
     */
    private async persist(): Promise<void> {
        const payload: PersistedChannelsFile = {
            version: 1,
            channels: Array.from(this.channels.values())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }
}

/**
 * 根据名称构建频道ID
 * @param name - 频道名称
 * @returns 频道ID
 */
function buildChannelId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    const safeName = normalized.replace(/^-|-$/g, '') || 'channel';
    return `channel:${safeName}:${Date.now()}`;
}

/**
 * 规范化可选文本值
 * @param value - 输入值
 * @returns 规范化后的字符串或 undefined
 */
function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalized = String(value || '').trim();
    return normalized ? normalized : undefined;
}

/**
     * 要求非空值
     * @param value - 输入值
     * @param key - 错误消息键
     * @returns 规范化后的字符串
     * @throws Error - 当值为空时抛出
     */
function requireNonEmpty(value: string, key: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(t(key));
    }

    return normalized;
}
