import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import type {
  ChannelConfig,
  ChannelTree,
  ChannelTreeNode,
  CreateChannelParams,
  UpdateChannelParams,
  MoveChannelParams,
  ChannelMoveResult,
  ChannelType,
  ChannelSettings,
  LegacyChannelConfig,
} from '../types/channel';

interface PersistedChannelsFile {
  version: number;
  channels: ChannelConfig[];
}

const CURRENT_VERSION = 2;

export class ChannelManagerV2 extends EventEmitter {
  private readonly storageFilePath: string;
  private readonly channels: Map<string, ChannelConfig> = new Map();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(storageFilePath: string) {
    super();
    this.storageFilePath = storageFilePath;
  }

  // ===== Loading & Persistence =====

  public async getChannels(refresh: boolean = false): Promise<ChannelConfig[]> {
    await this.ensureLoaded(refresh);
    return Array.from(this.channels.values())
      .filter(c => !c.archivedAt)
      .sort((a, b) => {
        // Sort by parent, then by order
        if (a.parentId !== b.parentId) {
          return (a.parentId || '').localeCompare(b.parentId || '');
        }
        return a.order - b.order;
      });
  }

  public async getChannel(channelId: string): Promise<ChannelConfig | null> {
    await this.ensureLoaded();
    return this.channels.get(channelId) || null;
  }

  public async getChannelTree(): Promise<ChannelTree> {
    await this.ensureLoaded();
    
    const allNodes = new Map<string, ChannelTreeNode>();
    const roots: ChannelTreeNode[] = [];

    // First pass: create all nodes
    for (const channel of this.channels.values()) {
      if (channel.archivedAt) continue;
      
      allNodes.set(channel.id, {
        ...channel,
        children: [],
        depth: 0,
        isLeaf: channel.childrenIds.length === 0,
      });
    }

    // Second pass: build tree structure
    for (const node of allNodes.values()) {
      if (node.parentId && allNodes.has(node.parentId)) {
        const parent = allNodes.get(node.parentId)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
        parent.isLeaf = false;
      } else {
        roots.push(node);
      }
    }

    // Sort children by order
    const sortChildren = (node: ChannelTreeNode) => {
      node.children.sort((a, b) => a.order - b.order);
      node.children.forEach(sortChildren);
    };
    roots.sort((a, b) => a.order - b.order);
    roots.forEach(sortChildren);

    return { roots, all: allNodes };
  }

  // ===== CRUD Operations =====

  public async createChannel(params: CreateChannelParams): Promise<ChannelConfig> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const parentId = params.parentId?.trim() || undefined;
    
    // Validate parent exists if specified
    if (parentId && !this.channels.has(parentId)) {
      throw new Error(t('channel.parentNotFound'));
    }

    // Calculate order (append to end of siblings)
    const siblings = Array.from(this.channels.values())
      .filter(c => c.parentId === parentId && !c.archivedAt);
    const order = siblings.length;

    const channel: ChannelConfig = {
      id: buildChannelId(params.name),
      type: params.type || 'standard',
      name: requireNonEmpty(params.name, 'channel.validationName'),
      description: normalizeOptionalText(params.description),
      parentId,
      childrenIds: [],
      order,
      agentId: params.agentId,
      sessionId: undefined,
      inheritAgent: params.inheritAgent ?? true,
      createdAt: now,
      updatedAt: now,
      settings: defaultChannelSettings(),
    };

    // Update parent's children list
    if (parentId) {
      const parent = this.channels.get(parentId)!;
      parent.childrenIds.push(channel.id);
      parent.updatedAt = now;
    }

    this.channels.set(channel.id, channel);
    await this.persist();
    this.emit('channelCreated', channel);
    
    return channel;
  }

  public async updateChannel(
    channelId: string,
    params: UpdateChannelParams
  ): Promise<ChannelConfig> {
    await this.ensureLoaded();

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(t('channel.notFound'));
    }

    const now = new Date().toISOString();
    const oldParentId = channel.parentId;
    const newParentId = params.parentId !== undefined 
      ? (params.parentId?.trim() || undefined)
      : oldParentId;

    // Handle parent change
    if (newParentId !== oldParentId) {
      await this.validateNoCircularReference(channelId, newParentId);
      
      // Remove from old parent
      if (oldParentId) {
        const oldParent = this.channels.get(oldParentId);
        if (oldParent) {
          oldParent.childrenIds = oldParent.childrenIds.filter(id => id !== channelId);
          oldParent.updatedAt = now;
        }
      }

      // Add to new parent
      if (newParentId) {
        if (!this.channels.has(newParentId)) {
          throw new Error(t('channel.parentNotFound'));
        }
        const newParent = this.channels.get(newParentId)!;
        newParent.childrenIds.push(channelId);
        newParent.updatedAt = now;
      }

      // Recalculate order in new sibling group
      const siblings = Array.from(this.channels.values())
        .filter(c => c.parentId === newParentId && c.id !== channelId && !c.archivedAt);
      channel.order = params.order ?? siblings.length;
    } else if (params.order !== undefined && params.order !== channel.order) {
      channel.order = params.order;
    }

    // Update agent
    const agentChanged = params.agentId !== undefined && params.agentId !== channel.agentId;
    if (agentChanged && !channel.inheritAgent) {
      channel.sessionId = undefined; // Reset session when agent changes
    }

    // Apply updates
    if (params.name !== undefined) {
      channel.name = requireNonEmpty(params.name, 'channel.validationName');
    }
    if (params.description !== undefined) {
      channel.description = normalizeOptionalText(params.description);
    }
    if (params.agentId !== undefined) {
      channel.agentId = params.agentId.trim() || undefined;
    }
    if (params.inheritAgent !== undefined) {
      channel.inheritAgent = params.inheritAgent;
    }
    if (params.settings) {
      channel.settings = { ...channel.settings, ...params.settings };
    }

    channel.parentId = newParentId;
    channel.updatedAt = now;

    await this.persist();
    this.emit('channelUpdated', channel);
    
    return channel;
  }

  public async moveChannel(params: MoveChannelParams): Promise<ChannelMoveResult> {
    const { channelId, newParentId, newOrder } = params;
    
    const channel = await this.updateChannel(channelId, {
      parentId: newParentId,
      order: newOrder,
    });

    // Reorder siblings if needed
    if (newOrder !== undefined) {
      await this.reorderSiblings(channel.parentId);
    }

    return {
      success: true,
      movedChannel: channel,
      oldParentId: undefined, // We don't track this currently
      newParentId: channel.parentId,
      affectedChannelIds: this.getSubtreeIds(channelId),
    };
  }

  public async deleteChannel(channelId: string, options?: {
    recursive?: boolean;
    moveChildrenToParent?: boolean;
  }): Promise<{ deletedIds: string[]; movedIds: string[] }> {
    await this.ensureLoaded();

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(t('channel.notFound'));
    }

    const deletedIds: string[] = [];
    const movedIds: string[] = [];

    // Handle children
    if (channel.childrenIds.length > 0) {
      if (options?.recursive) {
        // Delete all children recursively
        for (const childId of [...channel.childrenIds]) {
          const result = await this.deleteChannel(childId, { recursive: true });
          deletedIds.push(...result.deletedIds);
        }
      } else if (options?.moveChildrenToParent && channel.parentId) {
        // Move children to grandparent
        for (const childId of channel.childrenIds) {
          const child = this.channels.get(childId);
          if (child) {
            child.parentId = channel.parentId;
            movedIds.push(childId);
          }
        }
        // Update grandparent's children
        const grandparent = this.channels.get(channel.parentId);
        if (grandparent) {
          grandparent.childrenIds = grandparent.childrenIds.filter(id => id !== channelId);
          grandparent.childrenIds.push(...channel.childrenIds);
        }
      } else {
        // Move children to root
        for (const childId of channel.childrenIds) {
          const child = this.channels.get(childId);
          if (child) {
            child.parentId = undefined;
            movedIds.push(childId);
          }
        }
      }
    }

    // Remove from parent's children list
    if (channel.parentId) {
      const parent = this.channels.get(channel.parentId);
      if (parent) {
        parent.childrenIds = parent.childrenIds.filter(id => id !== channelId);
      }
    }

    // Delete the channel
    this.channels.delete(channelId);
    deletedIds.push(channelId);

    await this.persist();
    this.emit('channelsDeleted', deletedIds);

    return { deletedIds, movedIds };
  }

  public async archiveChannel(channelId: string): Promise<ChannelConfig> {
    const channel = await this.updateChannel(channelId, {});
    channel.archivedAt = new Date().toISOString();
    await this.persist();
    this.emit('channelArchived', channel);
    return channel;
  }

  public async unarchiveChannel(channelId: string): Promise<ChannelConfig> {
    const channel = await this.updateChannel(channelId, {});
    channel.archivedAt = undefined;
    await this.persist();
    this.emit('channelUnarchived', channel);
    return channel;
  }

  // ===== Session Management =====

  public async setChannelSessionId(channelId: string, sessionId: string): Promise<ChannelConfig> {
    return this.updateChannel(channelId, { sessionId: sessionId as unknown as string });
  }

  public async clearChannelSessionId(channelId: string): Promise<ChannelConfig> {
    return this.updateChannel(channelId, { sessionId: null as unknown as string });
  }

  public getEffectiveAgentId(channelId: string): string | undefined {
    const channel = this.channels.get(channelId);
    if (!channel) return undefined;

    if (channel.agentId && !channel.inheritAgent) {
      return channel.agentId;
    }

    // Inherit from parent
    if (channel.parentId) {
      return this.getEffectiveAgentId(channel.parentId);
    }

    return channel.agentId;
  }

  // ===== Aggregate & External Config =====

  public async setAggregateConfig(
    channelId: string,
    config: ChannelConfig['aggregateConfig']
  ): Promise<ChannelConfig> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(t('channel.notFound'));
    
    channel.type = 'aggregate';
    channel.aggregateConfig = config;
    channel.updatedAt = new Date().toISOString();
    
    await this.persist();
    this.emit('channelUpdated', channel);
    return channel;
  }

  public async setExternalConfig(
    channelId: string,
    config: ChannelConfig['externalConfig']
  ): Promise<ChannelConfig> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(t('channel.notFound'));
    
    channel.type = 'external';
    channel.externalConfig = config;
    channel.updatedAt = new Date().toISOString();
    
    await this.persist();
    this.emit('channelUpdated', channel);
    return channel;
  }

  // ===== Reordering =====

  public async reorderSiblings(parentId?: string): Promise<void> {
    await this.ensureLoaded();

    const siblings = Array.from(this.channels.values())
      .filter(c => c.parentId === parentId && !c.archivedAt)
      .sort((a, b) => a.order - b.order);

    const now = new Date().toISOString();
    siblings.forEach((channel, index) => {
      if (channel.order !== index) {
        channel.order = index;
        channel.updatedAt = now;
      }
    });

    await this.persist();
    this.emit('channelsReordered', parentId);
  }

  public async swapOrder(channelId1: string, channelId2: string): Promise<void> {
    const c1 = this.channels.get(channelId1);
    const c2 = this.channels.get(channelId2);

    if (!c1 || !c2) {
      throw new Error(t('channel.notFound'));
    }

    if (c1.parentId !== c2.parentId) {
      throw new Error(t('channel.differentParents'));
    }

    const temp = c1.order;
    c1.order = c2.order;
    c2.order = temp;
    c1.updatedAt = c2.updatedAt = new Date().toISOString();

    await this.persist();
    this.emit('channelsReordered', c1.parentId);
  }

  // ===== Utility =====

  public async refresh(): Promise<ChannelConfig[]> {
    return this.getChannels(true);
  }

  public dispose(): void {
    this.removeAllListeners();
    this.channels.clear();
    this.loaded = false;
    this.loadPromise = null;
  }

  // ===== Private Methods =====

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

    this.loadPromise = this.loadFromDisk();

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async loadFromDisk(): Promise<void> {
    this.channels.clear();

    try {
      const content = await fs.readFile(this.storageFilePath, 'utf8');
      const data = JSON.parse(content) as PersistedChannelsFile;

      if (data.version === 1) {
        // Migrate from v1
        this.migrateFromV1(data.channels as unknown as LegacyChannelConfig[]);
      } else {
        // Load v2
        for (const channel of data.channels || []) {
          if (this.isValidChannel(channel)) {
            this.channels.set(channel.id, this.normalizeChannel(channel));
          }
        }
      }
    } catch (error) {
      const maybeNodeError = error as NodeJS.ErrnoException;
      if (maybeNodeError.code !== 'ENOENT') {
        throw error;
      }
    }

    this.loaded = true;
  }

  private migrateFromV1(legacyChannels: LegacyChannelConfig[]): void {
    const now = new Date().toISOString();
    
    for (const legacy of legacyChannels) {
      const channel: ChannelConfig = {
        id: legacy.id,
        type: 'standard',
        name: legacy.name,
        description: legacy.description,
        parentId: undefined,
        childrenIds: [],
        order: 0,
        agentId: legacy.agentId,
        sessionId: legacy.sessionId,
        inheritAgent: false,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        settings: defaultChannelSettings(),
      };
      this.channels.set(channel.id, channel);
    }

    // Save migrated data
    void this.persist();
  }

  private async persist(): Promise<void> {
    const payload: PersistedChannelsFile = {
      version: CURRENT_VERSION,
      channels: Array.from(this.channels.values()),
    };

    await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
    await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private isValidChannel(channel: unknown): channel is ChannelConfig {
    if (!channel || typeof channel !== 'object') return false;
    const c = channel as Partial<ChannelConfig>;
    return Boolean(
      c.id &&
      c.name &&
      c.type &&
      c.childrenIds !== undefined &&
      typeof c.order === 'number' &&
      c.createdAt
    );
  }

  private normalizeChannel(channel: Partial<ChannelConfig>): ChannelConfig {
    return {
      id: channel.id!,
      type: channel.type || 'standard',
      name: channel.name!,
      description: channel.description,
      parentId: channel.parentId,
      childrenIds: channel.childrenIds || [],
      order: channel.order ?? 0,
      agentId: channel.agentId,
      sessionId: channel.sessionId,
      inheritAgent: channel.inheritAgent ?? true,
      aggregateConfig: channel.aggregateConfig,
      externalConfig: channel.externalConfig,
      createdAt: channel.createdAt!,
      updatedAt: channel.updatedAt || channel.createdAt!,
      archivedAt: channel.archivedAt,
      settings: channel.settings || defaultChannelSettings(),
    };
  }

  private async validateNoCircularReference(
    channelId: string,
    newParentId?: string
  ): Promise<void> {
    if (!newParentId) return;
    if (newParentId === channelId) {
      throw new Error(t('channel.circularReference'));
    }

    const parent = this.channels.get(newParentId);
    if (parent?.parentId) {
      await this.validateNoCircularReference(channelId, parent.parentId);
    }
  }

  private getSubtreeIds(rootId: string): string[] {
    const channel = this.channels.get(rootId);
    if (!channel) return [rootId];

    const ids = [rootId];
    for (const childId of channel.childrenIds) {
      ids.push(...this.getSubtreeIds(childId));
    }
    return ids;
  }
}

// ===== Helpers =====

function buildChannelId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-');
  const safeName = normalized.replace(/^-|-$/g, '') || 'channel';
  return `ch:${safeName}:${Date.now()}`;
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

function defaultChannelSettings(): ChannelSettings {
  return {
    notifications: true,
    autoArchive: false,
  };
}
