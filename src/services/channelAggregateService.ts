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

export class ChannelAggregateService extends EventEmitter {
  private openclawService: OpenClawService;
  private aggregateIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(openclawService: OpenClawService) {
    super();
    this.openclawService = openclawService;
  }

  // ===== Aggregation Operations =====

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

  public stopAutoAggregation(channelId: string): void {
    const interval = this.aggregateIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.aggregateIntervals.delete(channelId);
    }
  }

  public stopAllAutoAggregation(): void {
    for (const interval of this.aggregateIntervals.values()) {
      clearInterval(interval);
    }
    this.aggregateIntervals.clear();
  }

  // ===== Utility Methods =====

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

  private createSimpleSummary(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) return content;
    
    // Try to end at a sentence
    const truncated = content.slice(0, maxLength);
    const lastSentence = truncated.match(/^.+[.!?]/);
    
    return lastSentence ? lastSentence[0] : truncated + '...';
  }

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

  private collectDescendants(node: ChannelTreeNode): string[] {
    const ids: string[] = [];
    
    for (const child of node.children) {
      ids.push(child.id);
      ids.push(...this.collectDescendants(child));
    }

    return ids;
  }

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
