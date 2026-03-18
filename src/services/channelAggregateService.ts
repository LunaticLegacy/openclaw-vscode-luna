import { EventEmitter } from 'events';
import type {
  ChannelConfig,
  ChannelAggregateConfig,
  AggregatedItem,
  ChannelTreeNode,
} from '../types/channel';
import type { ChatMessage } from './openclaw/types';
import type { OpenClawService } from './openclawService';

export interface AggregateResult {
  channelId: string;
  itemsProcessed: number;
  messagesCreated: number;
  summary?: string;
}

/**
 * 频道聚合服务类
 * 
 * 管理聚合频道的数据收集、处理和消息创建，支持从多个源频道聚合内容
 * 
 * @example
 * ```typescript
 * const service = new ChannelAggregateService(openclawService);
 * const result = await service.aggregateChannel(channel, sourceChannels);
 * ```
 */
export class ChannelAggregateService extends EventEmitter {
  private openclawService: OpenClawService;
  private aggregateIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * 创建频道聚合服务实例
   * @param openclawService - OpenClaw 服务实例
   */
  constructor(openclawService: OpenClawService) {
    super();
    this.openclawService = openclawService;
  }

  // ===== Aggregation Operations =====

  /**
   * 聚合单个频道
   * @param channel - 目标聚合频道配置
   * @param sourceChannels - 源频道配置数组
   * @param options - 聚合选项
   * @returns 聚合结果
   */
  public async aggregateChannel(
    channel: ChannelConfig,
    sourceChannels: ChannelConfig[],
    options?: { force?: boolean }
  ): Promise<AggregateResult> {
    if (channel.type !== 'aggregate' || !channel.aggregateConfig) {
      return {
        channelId: channel.id,
        itemsProcessed: 0,
        messagesCreated: 0,
      };
    }

    const config = channel.aggregateConfig;
    
    // Collect items from sources
    const allItems: AggregatedItem[] = [];
    
    for (const sourceId of config.sourceIds) {
      const source = sourceChannels.find(c => c.id === sourceId);
      if (!source || source.archivedAt) continue;

      // Get source messages
      if (source.sessionId) {
        const messages = await this.fetchSourceMessages(source, config);
        const items = this.messagesToAggregatedItems(messages, source.id);
        allItems.push(...items);
      }
    }

    // Apply filters
    const filtered = this.applyFilters(allItems, config.filter);

    // Sort by date
    filtered.sort((a, b) => 
      new Date(b.original.publishedAt).getTime() - new Date(a.original.publishedAt).getTime()
    );

    // Limit items
    const limited = filtered.slice(0, config.maxItems);

    // Transform
    const transformed = await this.transformItems(limited, config.transform, channel.agentId);

    // Create messages in aggregate channel
    const messagesCreated = await this.createAggregateMessages(channel, transformed);

    this.emit('aggregationCompleted', {
      channelId: channel.id,
      itemsProcessed: limited.length,
      messagesCreated,
    });

    return {
      channelId: channel.id,
      itemsProcessed: limited.length,
      messagesCreated,
    };
  }

  /**
   * 递归聚合子树
   * @param rootNode - 根节点
   * @param allChannels - 所有频道的映射
   * @param options - 聚合选项
   * @returns 聚合结果数组
   */
  public async aggregateSubtree(
    rootNode: ChannelTreeNode,
    allChannels: Map<string, ChannelTreeNode>,
    options?: { recursive?: boolean }
  ): Promise<AggregateResult[]> {
    const results: AggregateResult[] = [];

    // Process this node if it's an aggregate channel
    if (rootNode.type === 'aggregate' && rootNode.aggregateConfig) {
      // Collect all descendant channels as potential sources
      const descendants = this.collectDescendants(rootNode);
      const sourceChannels = descendants
        .map(id => allChannels.get(id))
        .filter((c): c is ChannelTreeNode => c !== undefined);

      const result = await this.aggregateChannel(rootNode, sourceChannels);
      results.push(result);
    }

    // Process children recursively
    if (options?.recursive !== false) {
      for (const child of rootNode.children) {
        const childResults = await this.aggregateSubtree(child, allChannels, options);
        results.push(...childResults);
      }
    }

    return results;
  }

  // ===== Auto Aggregation =====

  /**
   * 启动频道的自动聚合
   * @param channel - 频道配置
   */
  public startAutoAggregation(channel: ChannelConfig): void {
    if (channel.type !== 'aggregate' || !channel.aggregateConfig) {
      return;
    }

    this.stopAutoAggregation(channel.id);

    const schedule = channel.aggregateConfig.schedule;
    let intervalMs: number;

    switch (schedule) {
      case 'realtime':
        intervalMs = 5 * 60 * 1000; // 5 minutes
        break;
      case 'hourly':
        intervalMs = 60 * 60 * 1000;
        break;
      case 'daily':
        intervalMs = 24 * 60 * 60 * 1000;
        break;
      default:
        return;
    }

    const interval = setInterval(() => {
      this.emit('autoAggregationTriggered', channel.id);
    }, intervalMs);

    this.aggregateIntervals.set(channel.id, interval);
  }

  /**
   * 停止频道的自动聚合
   * @param channelId - 频道 ID
   */
  public stopAutoAggregation(channelId: string): void {
    const interval = this.aggregateIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.aggregateIntervals.delete(channelId);
    }
  }

  /**
   * 停止所有频道的自动聚合
   */
  public stopAllAutoAggregation(): void {
    for (const interval of this.aggregateIntervals.values()) {
      clearInterval(interval);
    }
    this.aggregateIntervals.clear();
  }

  // ===== Utility Methods =====

  /**
   * 预览聚合结果（不创建消息）
   * @param config - 聚合配置
   * @param sourceChannels - 源频道数组
   * @returns 预览统计信息
   */
  public async previewAggregation(
    config: ChannelAggregateConfig,
    sourceChannels: ChannelConfig[]
  ): Promise<{
    totalSources: number;
    totalItems: number;
    filteredItems: number;
    sampleItems: AggregatedItem[];
  }> {
    // Collect items without creating messages
    const allItems: AggregatedItem[] = [];

    for (const sourceId of config.sourceIds) {
      const source = sourceChannels.find(c => c.id === sourceId);
      if (!source || source.archivedAt || !source.sessionId) continue;

      const messages = await this.fetchSourceMessages(source, config);
      const items = this.messagesToAggregatedItems(messages, source.id);
      allItems.push(...items);
    }

    const filtered = this.applyFilters(allItems, config.filter);
    const limited = filtered.slice(0, config.maxItems);

    return {
      totalSources: config.sourceIds.length,
      totalItems: allItems.length,
      filteredItems: limited.length,
      sampleItems: limited.slice(0, 5),
    };
  }

  // ===== Private Methods =====

  /**
   * 获取源频道的消息
   * @param source - 源频道配置
   * @param config - 聚合配置
   * @returns 消息数组
   */
  private async fetchSourceMessages(
    source: ChannelConfig,
    config: ChannelAggregateConfig
  ): Promise<ChatMessage[]> {
    if (!source.sessionId) return [];

    try {
      // Use OpenClaw service to get chat history
      return await this.openclawService.getChatHistory(source.sessionId);
    } catch (error) {
      console.error(`Failed to fetch messages from ${source.id}:`, error);
      return [];
    }
  }

  /**
   * 将消息转换为聚合项
   * @param messages - 消息数组
   * @param sourceChannelId - 源频道 ID
   * @returns 聚合项数组
   */
  private messagesToAggregatedItems(messages: ChatMessage[], sourceChannelId: string): AggregatedItem[] {
    return messages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        id: `msg:${msg.id}`,
        channelId: sourceChannelId,
        sourceType: 'internal',
        original: {
          title: msg.role === 'user' ? 'User Message' : 'Assistant Response',
          content: msg.content,
          author: msg.displayName || msg.role,
          publishedAt: msg.timestamp,
          metadata: {
            messageId: msg.id,
            role: msg.role,
            tokenCount: msg.tokenCount,
          },
        },
        createdAt: msg.timestamp,
      }));
  }

  /**
   * 应用过滤器到聚合项
   * @param items - 聚合项数组
   * @param filter - 过滤器配置
   * @returns 过滤后的数组
   */
  private applyFilters(items: AggregatedItem[], filter?: ChannelAggregateConfig['filter']): AggregatedItem[] {
    if (!filter) return items;

    return items.filter(item => {
      // Filter by keywords
      if (filter.keywords && filter.keywords.length > 0) {
        const content = `${item.original.title || ''} ${item.original.content}`.toLowerCase();
        const hasKeyword = filter.keywords.some(kw => 
          content.includes(kw.toLowerCase())
        );
        if (!hasKeyword) return false;
      }

      // Filter by authors
      if (filter.authors && filter.authors.length > 0) {
        if (!item.original.author) return false;
        const authorMatch = filter.authors.some(a => 
          item.original.author?.toLowerCase() === a.toLowerCase()
        );
        if (!authorMatch) return false;
      }

      // Filter by date range
      if (filter.since) {
        if (new Date(item.original.publishedAt) < new Date(filter.since)) {
          return false;
        }
      }
      if (filter.until) {
        if (new Date(item.original.publishedAt) > new Date(filter.until)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * 转换聚合项
   * @param items - 聚合项数组
   * @param transform - 转换类型
   * @param agentId - 可选的智能体 ID（用于 AI 转换）
   * @returns 转换后的数组
   */
  private async transformItems(
    items: AggregatedItem[],
    transform: ChannelAggregateConfig['transform'],
    agentId?: string
  ): Promise<AggregatedItem[]> {
    switch (transform) {
      case 'none':
        return items;

      case 'summary':
        // Simple text truncation summary
        return items.map(item => ({
          ...item,
          processed: {
            summary: this.createSimpleSummary(item.original.content),
          },
        }));

      case 'ai-summarize':
        // AI-powered summarization (requires agent)
        if (agentId) {
          return await this.aiSummarizeItems(items, agentId);
        }
        return items;

      default:
        return items;
    }
  }

  /**
   * 创建简单摘要
   * @param content - 原始内容
   * @param maxLength - 最大长度
   * @returns 摘要文本
   */
  private createSimpleSummary(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) return content;
    
    // Try to end at a sentence
    const truncated = content.slice(0, maxLength);
    const lastSentence = truncated.match(/^.+[.!?]/);
    
    return lastSentence ? lastSentence[0] : truncated + '...';
  }

  /**
   * 使用 AI 对聚合项进行摘要
   * @param items - 聚合项数组
   * @param agentId - 智能体 ID
   * @returns 带摘要的聚合项数组
   */
  private async aiSummarizeItems(
    items: AggregatedItem[],
    agentId: string
  ): Promise<AggregatedItem[]> {
    // This would integrate with the AI service to generate summaries
    // For now, return items with placeholder processing
    
    const batchContent = items.map((item, i) => 
      `[${i + 1}] ${item.original.title || 'Item'}: ${item.original.content.slice(0, 500)}`
    ).join('\n\n');

    try {
      // Create a temporary session for summarization
      const session = await this.openclawService.createChatSession(agentId);
      
      const prompt = `Please summarize the following ${items.length} items into concise summaries:\n\n${batchContent}\n\nProvide a one-sentence summary for each item numbered [1], [2], etc.`;

      const response = await this.openclawService.sendMessage(session.id, prompt);
      
      // Parse summaries from response
      // This is simplified - real implementation would need better parsing
      const summaries = response.content.split('\n').filter(s => s.trim());

      return items.map((item, i) => ({
        ...item,
        processed: {
          summary: summaries[i] || this.createSimpleSummary(item.original.content),
        },
      }));

    } catch (error) {
      console.error('AI summarization failed:', error);
      // Fallback to simple summary
      return items.map(item => ({
        ...item,
        processed: {
          summary: this.createSimpleSummary(item.original.content),
        },
      }));
    }
  }

  /**
   * 在聚合频道中创建消息
   * @param channel - 聚合频道配置
   * @param items - 聚合项数组
   * @returns 创建的消息数量
   */
  private async createAggregateMessages(
    channel: ChannelConfig,
    items: AggregatedItem[]
  ): Promise<number> {
    if (!channel.sessionId || items.length === 0) return 0;

    let created = 0;

    for (const item of items) {
      try {
        const content = this.formatAggregatedItem(item);
        
        await this.openclawService.sendMessage(channel.sessionId, content, {
          metadata: {
            aggregatedFrom: item.channelId,
            originalUrl: item.original.url,
            sourceType: item.sourceType,
          },
        });

        created++;
      } catch (error) {
        console.error(`Failed to create aggregate message for ${item.id}:`, error);
      }
    }

    return created;
  }

  /**
   * 格式化聚合项为消息内容
   * @param item - 聚合项
   * @returns 格式化后的文本
   */
  private formatAggregatedItem(item: AggregatedItem): string {
    const parts: string[] = [];

    if (item.original.title) {
      parts.push(`**${item.original.title}**`);
    }

    if (item.processed?.summary) {
      parts.push(item.processed.summary);
    } else {
      parts.push(item.original.content.slice(0, 1000));
    }

    if (item.original.author) {
      parts.push(`— *${item.original.author}*`);
    }

    if (item.original.url) {
      parts.push(`[Source](${item.original.url})`);
    }

    return parts.join('\n\n');
  }

  /**
   * 收集节点的所有后代节点 ID
   * @param node - 频道树节点
   * @returns 后代节点 ID 数组
   */
  private collectDescendants(node: ChannelTreeNode): string[] {
    const ids: string[] = [];
    
    for (const child of node.children) {
      ids.push(child.id);
      ids.push(...this.collectDescendants(child));
    }

    return ids;
  }

  /**
   * 释放服务资源
   */
  public dispose(): void {
    this.stopAllAutoAggregation();
    this.removeAllListeners();
  }
}

// Extend OpenClawService types for aggregation metadata
declare module './openclawService' {
  interface SendMessageOptions {
    metadata?: Record<string, unknown>;
  }
}
