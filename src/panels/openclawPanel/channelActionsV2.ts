import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { ChannelManagerV2 } from '../../managers/channelManagerV2';
import type { ChannelSourceService } from '../../services/channelSourceService';
import type { ChannelAggregateService } from '../../services/channelAggregateService';
import type {
  ChannelConfig,
  ChannelTree,
  CreateChannelParams,
  UpdateChannelParams,
  MoveChannelParams,
  ChannelSourceConfig,
  ChannelAggregateConfig,
  SourceCredentials,
} from '../../types/channel';

interface ChannelActionContext {
  channelManager: ChannelManagerV2;
  channelSourceService: ChannelSourceService;
  channelAggregateService: ChannelAggregateService;
  postMessage(message: Record<string, unknown>): void;
  getCurrentChannelId(): string | null;
  setCurrentChannelId(channelId: string | null): void;
  getCurrentChannelSessionId(): string | null;
  setCurrentChannelSessionId(sessionId: string | null): void;
  isPanelVisible(): boolean;
}

// ===== Channel Tree Operations =====

export async function loadChannelTree(context: ChannelActionContext, selectedChannelId?: string): Promise<void> {
  try {
    const [channels, tree] = await Promise.all([
      context.channelManager.getChannels(),
      context.channelManager.getChannelTree(),
    ]);

    const currentChannelId = context.getCurrentChannelId();
    const resolvedSelectedId = selectedChannelId && findChannelInTree(tree, selectedChannelId)
      ? selectedChannelId
      : currentChannelId && findChannelInTree(tree, currentChannelId)
        ? currentChannelId
        : tree.roots[0]?.id || null;

    context.postMessage({
      type: 'channelsLoadedV2',
      channels,
      tree: serializeTree(tree),
      selectedChannelId: resolvedSelectedId,
    });

    if (resolvedSelectedId) {
      await activateChannel(context, resolvedSelectedId);
    } else {
      clearChannelSelection(context);
    }
  } catch (error) {
    context.postMessage({
      type: 'error',
      message: t('channel.loadFailed', { error: String(error) }),
    });
  }
}

export async function expandChannel(
  context: ChannelActionContext,
  channelId: string,
  expanded: boolean
): Promise<void> {
  context.postMessage({
    type: 'channelExpanded',
    channelId,
    expanded,
  });
}

// ===== CRUD Operations =====

export async function handleCreateChannel(
  context: ChannelActionContext,
  data: CreateChannelParams
): Promise<void> {
  try {
    const channel = await context.channelManager.createChannel(data);
    vscode.window.showInformationMessage(t('channel.created', { name: channel.name }));
    await loadChannelTree(context, channel.id);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.saveFailed', { error: String(error) }));
  }
}

export async function handleUpdateChannel(
  context: ChannelActionContext,
  channelId: string,
  data: UpdateChannelParams
): Promise<void> {
  try {
    const channel = await context.channelManager.updateChannel(channelId, data);
    vscode.window.showInformationMessage(t('channel.saved'));
    await loadChannelTree(context, channel.id);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.saveFailed', { error: String(error) }));
  }
}

export async function handleMoveChannel(
  context: ChannelActionContext,
  channelId: string,
  direction?: 'up' | 'down',
  newParentId?: string
): Promise<void> {
  try {
    if (direction) {
      // Swap order with sibling
      const channels = await context.channelManager.getChannels();
      const channel = channels.find(c => c.id === channelId);
      if (!channel) return;

      const siblings = channels.filter(c => c.parentId === channel.parentId);
      const currentIndex = siblings.findIndex(c => c.id === channelId);
      
      if (direction === 'up' && currentIndex > 0) {
        await context.channelManager.swapOrder(channelId, siblings[currentIndex - 1].id);
      } else if (direction === 'down' && currentIndex < siblings.length - 1) {
        await context.channelManager.swapOrder(channelId, siblings[currentIndex + 1].id);
      }
    } else if (newParentId !== undefined) {
      // Move to new parent
      await context.channelManager.moveChannel({
        channelId,
        newParentId: newParentId || undefined,
      });
    }

    await loadChannelTree(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.moveFailed', { error: String(error) }));
  }
}

export async function handleDeleteChannel(
  context: ChannelActionContext,
  channelId: string,
  options?: { recursive?: boolean; moveChildrenToParent?: boolean }
): Promise<void> {
  try {
    const result = await context.channelManager.deleteChannel(channelId, options);
    
    vscode.window.showInformationMessage(
      t('channel.deleted', { 
        count: result.deletedIds.length,
        moved: result.movedIds.length 
      })
    );

    // Clean up external source if exists
    await context.channelSourceService.deleteCredentials(channelId);
    context.channelSourceService.stopAutoSync(channelId);

    if (context.getCurrentChannelId() === channelId) {
      context.setCurrentChannelId(null);
      context.setCurrentChannelSessionId(null);
    }

    await loadChannelTree(context);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.deleteFailed', { error: String(error) }));
  }
}

export async function handleArchiveChannel(
  context: ChannelActionContext,
  channelId: string,
  archive: boolean
): Promise<void> {
  try {
    if (archive) {
      await context.channelManager.archiveChannel(channelId);
      vscode.window.showInformationMessage(t('channel.archived'));
    } else {
      await context.channelManager.unarchiveChannel(channelId);
      vscode.window.showInformationMessage(t('channel.unarchived'));
    }
    await loadChannelTree(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.archiveFailed', { error: String(error) }));
  }
}

// ===== External Source Operations =====

export async function handleConfigureExternalSource(
  context: ChannelActionContext,
  channelId: string,
  config: {
    provider: string;
    name: string;
    apiKey?: string;
    syncInterval: number;
    rssUrl?: string;
    youtubeChannelId?: string;
    githubRepos?: string[];
  }
): Promise<void> {
  try {
    // Build provider-specific config
    let providerConfig: ChannelSourceConfig['config'];
    
    switch (config.provider) {
      case 'rss':
        providerConfig = {
          type: 'rss',
          url: config.rssUrl!,
          fetchFullContent: false,
        };
        break;
      case 'youtube':
        providerConfig = {
          type: 'youtube',
          channelId: config.youtubeChannelId,
          includeComments: false,
        };
        break;
      case 'github':
        providerConfig = {
          type: 'github',
          repos: config.githubRepos,
          events: ['release'],
        };
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    const sourceConfig: ChannelSourceConfig = {
      provider: config.provider as ChannelSourceConfig['provider'],
      name: config.name,
      enabled: true,
      credentials: {}, // Will be stored separately
      config: providerConfig,
      sync: {
        interval: config.syncInterval,
        status: 'idle',
      },
      processing: {
        deduplicate: true,
        summarize: false,
      },
    };

    // Save credentials securely if provided
    if (config.apiKey) {
      await context.channelSourceService.saveCredentials(channelId, {
        apiKey: config.apiKey,
      });
    }

    // Update channel
    await context.channelManager.setExternalConfig(channelId, sourceConfig);
    
    // Start auto-sync
    const channel = await context.channelManager.getChannel(channelId);
    if (channel) {
      context.channelSourceService.startAutoSync(channel);
    }

    vscode.window.showInformationMessage(t('channel.externalSource.configured'));
    await loadChannelTree(context, channelId);

    // Trigger initial sync
    await handleSyncExternalChannel(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.externalSource.configFailed', { error: String(error) }));
  }
}

export async function handleSyncExternalChannel(
  context: ChannelActionContext,
  channelId: string
): Promise<void> {
  try {
    const channel = await context.channelManager.getChannel(channelId);
    if (!channel || channel.type !== 'external') {
      return;
    }

    // Show sync started
    context.postMessage({
      type: 'channelSyncStarted',
      channelId,
    });

    const result = await context.channelSourceService.syncChannel(channel);

    if (result.errors.length === 0) {
      vscode.window.showInformationMessage(
        t('channel.externalSource.syncSuccess', { count: result.itemsAdded })
      );
    } else {
      vscode.window.showWarningMessage(
        t('channel.externalSource.syncPartial', { 
          added: result.itemsAdded,
          errors: result.errors.length 
        })
      );
    }

    // Refresh channel to show updated sync status
    await loadChannelTree(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.externalSource.syncFailed', { error: String(error) }));
    await loadChannelTree(context, channelId);
  }
}

// ===== Aggregate Operations =====

export async function handleSetAggregateConfig(
  context: ChannelActionContext,
  channelId: string,
  config: {
    sourceIds: string[];
    transform?: ChannelAggregateConfig['transform'];
    schedule?: ChannelAggregateConfig['schedule'];
  }
): Promise<void> {
  try {
    const aggregateConfig: ChannelAggregateConfig = {
      sourceIds: config.sourceIds,
      transform: config.transform || 'none',
      schedule: config.schedule || 'hourly',
      maxItems: 50,
    };

    await context.channelManager.setAggregateConfig(channelId, aggregateConfig);

    // Start auto-aggregation
    const channel = await context.channelManager.getChannel(channelId);
    if (channel) {
      context.channelAggregateService.startAutoAggregation(channel);
    }

    vscode.window.showInformationMessage(t('channel.aggregate.configured'));
    await loadChannelTree(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.aggregate.configFailed', { error: String(error) }));
  }
}

export async function handleRunAggregation(
  context: ChannelActionContext,
  channelId: string
): Promise<void> {
  try {
    const channel = await context.channelManager.getChannel(channelId);
    if (!channel || channel.type !== 'aggregate') {
      return;
    }

    const tree = await context.channelManager.getChannelTree();
    const sourceChannels = Array.from(tree.all.values())
      .map(n => n as unknown as ChannelConfig);

    const result = await context.channelAggregateService.aggregateChannel(
      channel,
      sourceChannels,
      { force: true }
    );

    vscode.window.showInformationMessage(
      t('channel.aggregate.completed', { 
        processed: result.itemsProcessed,
        created: result.messagesCreated 
      })
    );

    await loadChannelTree(context, channelId);
  } catch (error) {
    vscode.window.showErrorMessage(t('channel.aggregate.failed', { error: String(error) }));
  }
}

// ===== Chat Operations (Adapted from V1) =====

export async function activateChannel(
  context: ChannelActionContext,
  channelId: string | null | undefined
): Promise<void> {
  if (!channelId) {
    clearChannelSelection(context);
    return;
  }

  context.setCurrentChannelId(channelId);
  context.postMessage({
    type: 'setActiveChannel',
    channelId,
  });
  context.postMessage({
    type: 'setChannelContextLoading',
    channelId,
    loading: true,
  });

  try {
    const channel = await context.channelManager.getChannel(channelId);
    if (!channel) {
      clearChannelSelection(context);
      return;
    }

    // Resolve effective agent (inheritance)
    const effectiveAgentId = context.channelManager.getEffectiveAgentId(channelId);
    
    context.setCurrentChannelSessionId(channel.sessionId || null);
    
    // Load messages if session exists
    if (channel.sessionId) {
      // This would integrate with chat service to load messages
      // For now, just mark as loaded
    }

    context.postMessage({
      type: 'channelActivated',
      channel: serializeChannel(channel, effectiveAgentId),
    });
  } catch (error) {
    context.postMessage({
      type: 'error',
      message: t('channel.loadFailed', { error: String(error) }),
    });
  } finally {
    context.postMessage({
      type: 'setChannelContextLoading',
      channelId,
      loading: false,
    });
  }
}

export function clearChannelSelection(context: ChannelActionContext): void {
  context.setCurrentChannelId(null);
  context.setCurrentChannelSessionId(null);
  context.postMessage({
    type: 'setActiveChannel',
    channelId: null,
  });
  context.postMessage({
    type: 'replaceChannelMessages',
    channelId: null,
    messages: [],
  });
}

// ===== Helper Functions =====

function findChannelInTree(tree: ChannelTree, channelId: string): boolean {
  return tree.all.has(channelId);
}

function serializeTree(tree: ChannelTree): object {
  return {
    roots: tree.roots.map(serializeTreeNode),
  };
}

function serializeTreeNode(node: import('../../types/channel').ChannelTreeNode): object {
  return {
    ...node,
    children: node.children.map(serializeTreeNode),
  };
}

function serializeChannel(channel: ChannelConfig, effectiveAgentId?: string): object {
  return {
    ...channel,
    effectiveAgentId,
  };
}

// ===== Legacy Migration =====

export async function migrateFromLegacyChannelManager(
  context: ChannelActionContext,
  legacyStoragePath: string
): Promise<void> {
  try {
    const fs = await import('fs/promises');
    
    // Check if legacy file exists
    try {
      await fs.access(legacyStoragePath);
    } catch {
      return; // No legacy data to migrate
    }

    const content = await fs.readFile(legacyStoragePath, 'utf8');
    const data = JSON.parse(content);
    
    if (data.version === 1 && Array.isArray(data.channels)) {
      // Migration will happen automatically on load
      vscode.window.showInformationMessage(t('channel.migration.started'));
      await loadChannelTree(context);
    }
  } catch (error) {
    console.error('Channel migration failed:', error);
  }
}
