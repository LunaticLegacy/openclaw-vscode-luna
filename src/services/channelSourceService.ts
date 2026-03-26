import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type {
  ChannelConfig,
  ChannelSourceConfig,
  SourceCredentials,
  RSSConfig,
  YouTubeConfig,
  TwitterConfig,
  GitHubConfig,
  AggregatedItem,
  ChannelSyncResult,
} from '../types/channel';
import type { ChannelSyncOptions, ProcessItemsConfig } from '../types/serviceParams';

// Storage keys for VS Code SecretStorage
const CREDENTIAL_PREFIX = 'openclaw:channel:cred:';

export interface SourceProviderAdapter {
  name: string;
  validateConfig(config: unknown): boolean;
  fetchItems(
    config: unknown,
    credentials: SourceCredentials,
    since?: Date
  ): Promise<AggregatedItem[]>;
}

/**
 * 频道源服务类
 * 
 * 管理外部数据源（RSS、YouTube、Twitter、GitHub）的适配器注册、凭证存储和同步操作
 * 
 * @example
 * ```typescript
 * const service = new ChannelSourceService(secretStorage);
 * const result = await service.syncChannel(channel);
 * ```
 */
export class ChannelSourceService extends EventEmitter {
  private secretStorage: vscode.SecretStorage;
  private adapters: Map<string, SourceProviderAdapter> = new Map();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * 创建频道源服务实例
   * @param secretStorage - VS Code 安全存储实例
   */
  constructor(secretStorage: vscode.SecretStorage) {
    super();
    this.secretStorage = secretStorage;
    this.registerBuiltInAdapters();
  }

  // ===== Adapter Registration =====

  /**
   * 注册内置适配器
   */
  private registerBuiltInAdapters(): void {
    this.registerAdapter('rss', new RSSAdapter());
    this.registerAdapter('youtube', new YouTubeAdapter());
    this.registerAdapter('twitter', new TwitterAdapter());
    this.registerAdapter('github', new GitHubAdapter());
  }

  /**
   * 注册数据源适配器
   * @param provider - 提供者名称
   * @param adapter - 适配器实例
   */
  public registerAdapter(provider: string, adapter: SourceProviderAdapter): void {
    this.adapters.set(provider, adapter);
  }

  /**
   * 获取指定提供者的适配器
   * @param provider - 提供者名称
   * @returns 适配器实例或 undefined
   */
  public getAdapter(provider: string): SourceProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  // ===== Credential Management (Secure) =====

  /**
   * 保存频道的凭证（加密存储）
   * @param channelId - 频道 ID
   * @param credentials - 凭证对象
   */
  public async saveCredentials(
    channelId: string,
    credentials: SourceCredentials
  ): Promise<void> {
    const key = `${CREDENTIAL_PREFIX}${channelId}`;
    const encrypted = JSON.stringify(credentials);
    await this.secretStorage.store(key, encrypted);
  }

  /**
   * 获取频道的凭证
   * @param channelId - 频道 ID
   * @returns 凭证对象或 undefined
   */
  public async getCredentials(channelId: string): Promise<SourceCredentials | undefined> {
    const key = `${CREDENTIAL_PREFIX}${channelId}`;
    const encrypted = await this.secretStorage.get(key);
    if (!encrypted) return undefined;
    
    try {
      return JSON.parse(encrypted) as SourceCredentials;
    } catch {
      return undefined;
    }
  }

  /**
   * 删除频道的凭证
   * @param channelId - 频道 ID
   */
  public async deleteCredentials(channelId: string): Promise<void> {
    const key = `${CREDENTIAL_PREFIX}${channelId}`;
    await this.secretStorage.delete(key);
  }

  // ===== Source Configuration =====

  /**
   * 配置外部数据源
   * @param channelId - 频道 ID
   * @param config - 源配置
   */
  public async configureExternalSource(
    channelId: string,
    config: ChannelSourceConfig
  ): Promise<void> {
    // Save credentials securely
    if (config.credentials) {
      await this.saveCredentials(channelId, config.credentials);
      // Don't store credentials in the config object that's persisted to disk
      config = { ...config, credentials: {} };
    }

    this.emit('sourceConfigured', { channelId, config });
  }

  /**
   * 验证源配置
   * @param provider - 提供者名称
   * @param config - 配置对象
   * @returns 验证结果
   */
  public async validateSourceConfig(
    provider: string,
    config: unknown
  ): Promise<{ valid: boolean; errors: string[] }> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      return { valid: false, errors: [`Unknown provider: ${provider}`] };
    }

    const errors: string[] = [];
    const valid = adapter.validateConfig(config);
    
    if (!valid) {
      errors.push('Configuration validation failed');
    }

    return { valid, errors };
  }

  // ===== Sync Operations =====

  /**
   * 同步频道数据
   * @param channel - 频道配置
   * @param options - 同步选项
   * @returns 同步结果
   */
  public async syncChannel(
    channel: ChannelConfig,
    options?: ChannelSyncOptions
  ): Promise<ChannelSyncResult> {
    if (channel.type !== 'external' || !channel.externalConfig) {
      return {
        channelId: channel.id,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsFailed: 0,
        errors: ['Not an external channel'],
      };
    }

    const config = channel.externalConfig;
    const adapter = this.adapters.get(config.provider);
    
    if (!adapter) {
      return {
        channelId: channel.id,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsFailed: 0,
        errors: [`No adapter for provider: ${config.provider}`],
      };
    }

    // Update sync status
    config.sync.status = 'syncing';
    config.sync.lastError = undefined;
    this.emit('syncStarted', channel.id);

    try {
      // Get credentials from secure storage
      const credentials = await this.getCredentials(channel.id) || {};
      
      // Calculate sync window
      const since = options?.since || (
        config.sync.lastSyncAt ? new Date(config.sync.lastSyncAt) : undefined
      );

      // Fetch items
      const items = await adapter.fetchItems(config.config, credentials, since);

      // Process items
      const processed = await this.processItems(items, config.processing);

      // Update sync status
      config.sync.status = 'idle';
      config.sync.lastSyncAt = new Date().toISOString();
      
      // Schedule next sync
      this.scheduleNextSync(channel);

      this.emit('syncCompleted', { channelId: channel.id, items: processed });

      return {
        channelId: channel.id,
        itemsAdded: processed.length,
        itemsUpdated: 0,
        itemsFailed: 0,
        errors: [],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      config.sync.status = 'error';
      config.sync.lastError = errorMsg;
      
      this.emit('syncFailed', { channelId: channel.id, error: errorMsg });

      return {
        channelId: channel.id,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsFailed: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * 启动频道的自动同步
   * @param channel - 频道配置
   */
  public startAutoSync(channel: ChannelConfig): void {
    if (channel.type !== 'external' || !channel.externalConfig) {
      return;
    }

    this.stopAutoSync(channel.id);
    this.scheduleNextSync(channel);
  }

  /**
   * 停止频道的自动同步
   * @param channelId - 频道 ID
   */
  public stopAutoSync(channelId: string): void {
    const interval = this.syncIntervals.get(channelId);
    if (interval) {
      clearTimeout(interval);
      this.syncIntervals.delete(channelId);
    }
  }

  /**
   * 停止所有频道的自动同步
   */
  public stopAllAutoSync(): void {
    for (const [channelId, interval] of this.syncIntervals) {
      clearTimeout(interval);
    }
    this.syncIntervals.clear();
  }

  /**
   * 调度下一次同步
   * @param channel - 频道配置
   */
  private scheduleNextSync(channel: ChannelConfig): void {
    if (!channel.externalConfig) return;

    const intervalMinutes = channel.externalConfig.sync.interval;
    if (intervalMinutes <= 0) return;

    const interval = setTimeout(() => {
      void this.syncChannel(channel);
    }, intervalMinutes * 60 * 1000);

    this.syncIntervals.set(channel.id, interval);
    
    const nextSyncAt = new Date(Date.now() + intervalMinutes * 60 * 1000);
    channel.externalConfig.sync.nextSyncAt = nextSyncAt.toISOString();
  }

  // ===== Item Processing =====

  /**
   * 处理聚合项
   * @param items - 聚合项数组
   * @param processing - 处理选项
   * @returns 处理后的数组
   */
  private async processItems(items: AggregatedItem[], processing: ProcessItemsConfig): Promise<AggregatedItem[]> {
    let result = items;

    // Deduplicate by URL or content hash
    if (processing.deduplicate) {
      const seen = new Set<string>();
      result = result.filter((item: any) => {
        const key = item.original.url || item.original.content.slice(0, 100);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Truncate long content
    if (processing.maxLength) {
      result = result.map((item: any) => ({
        ...item,
        original: {
          ...item.original,
          content: item.original.content.slice(0, processing.maxLength) + 
                   (item.original.content.length > processing.maxLength! ? '...' : ''),
        },
      }));
    }

    // Note: summarize and translate would require AI service integration
    // These are placeholders for future implementation

    return result;
  }

  /**
   * 释放服务资源
   */
  public dispose(): void {
    this.stopAllAutoSync();
    this.removeAllListeners();
  }
}

// ===== Built-in Adapters =====

/**
 * RSS 源适配器
 */
class RSSAdapter implements SourceProviderAdapter {
  name = 'RSS Feed';

  /**
   * 验证 RSS 配置
   * @param config - 配置对象
   * @returns 是否有效
   */
  validateConfig(config: unknown): boolean {
    if (!config || typeof config !== 'object') return false;
    const c = config as RSSConfig;
    return Boolean(c.url && typeof c.url === 'string' && c.url.startsWith('http'));
  }

  /**
   * 获取 RSS 项
   * @param config - 配置对象
   * @param _credentials - 凭证（RSS 通常不需要）
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  async fetchItems(
    config: unknown,
    _credentials: SourceCredentials,
    since?: Date
  ): Promise<AggregatedItem[]> {
    const c = config as RSSConfig;
    
    try {
      // Use VS Code's fetch or node-fetch
      const response = await fetch(c.url, {
        headers: {
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          'User-Agent': 'OpenClaw-Luna/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      return this.parseRSS(xml, c, since);
    } catch (error) {
      throw new Error(`Failed to fetch RSS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解析 RSS XML
   * @param xml - XML 内容
   * @param config - RSS 配置
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  private parseRSS(xml: string, config: RSSConfig, since?: Date): AggregatedItem[] {
    const items: AggregatedItem[] = [];
    
    // Simple regex-based parsing (for production, use a proper XML parser)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    
    const processMatch = (content: string): AggregatedItem | undefined => {
      const title = this.extractTag(content, 'title');
      const link = this.extractTag(content, 'link');
      const description = this.extractTag(content, 'description') || 
                         this.extractTag(content, 'content') || 
                         this.extractTag(content, 'summary');
      const pubDate = this.extractTag(content, 'pubDate') || 
                     this.extractTag(content, 'published') || 
                     this.extractTag(content, 'updated');
      const author = this.extractTag(content, 'author') || 
                    this.extractTag(content, 'creator');

      if (!title && !description) return undefined;

      const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
      
      if (since && new Date(publishedAt) < since) {
        return undefined;
      }

      return {
        id: `rss:${link || Date.now()}:${Math.random().toString(36).slice(2)}`,
        channelId: '', // Will be set by caller
        sourceType: 'external',
        original: {
          title: this.decodeHtmlEntities(title || 'Untitled'),
          content: this.decodeHtmlEntities(description || ''),
          author: this.decodeHtmlEntities(author),
          url: link,
          publishedAt,
          metadata: { feedUrl: config.url },
        },
        createdAt: new Date().toISOString(),
      };
    };

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = processMatch(match[1]);
      if (item) items.push(item);
    }
    while ((match = entryRegex.exec(xml)) !== null) {
      const item = processMatch(match[1]);
      if (item) items.push(item);
    }

    return items;
  }

  /**
   * 从 XML 中提取标签内容
   * @param xml - XML 内容
   * @param tagName - 标签名
   * @returns 标签内容或 undefined
   */
  private extractTag(xml: string, tagName: string): string | undefined {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match?.[1].trim();
  }

  /**
   * 解码 HTML 实体
   * @param text - 原始文本
   * @returns 解码后的文本
   */
  private decodeHtmlEntities(text: string | undefined): string {
    if (!text) return '';
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  }
}

/**
 * YouTube 源适配器
 */
class YouTubeAdapter implements SourceProviderAdapter {
  name = 'YouTube';

  /**
   * 验证 YouTube 配置
   * @param config - 配置对象
   * @returns 是否有效
   */
  validateConfig(config: unknown): boolean {
    if (!config || typeof config !== 'object') return false;
    const c = config as YouTubeConfig;
    return Boolean(c.channelId || c.playlistId || c.searchQuery);
  }

  /**
   * 获取 YouTube 视频
   * @param config - 配置对象
   * @param credentials - 包含 API key 的凭证
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  /**
   * 获取 GitHub 事件
   * @param config - 配置对象
   * @param credentials - 包含 token 的凭证
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  async fetchItems(
    config: unknown,
    credentials: SourceCredentials,
    since?: Date
  ): Promise<AggregatedItem[]> {
    const c = config as YouTubeConfig;
    const apiKey = credentials.apiKey;

    if (!apiKey) {
      throw new Error('YouTube API key required');
    }

    const items: AggregatedItem[] = [];
    const baseUrl = 'https://www.googleapis.com/youtube/v3';

    try {
      if (c.channelId) {
        // Fetch channel uploads
        const channelUrl = `${baseUrl}/channels?part=contentDetails&id=${c.channelId}&key=${apiKey}`;
        const channelRes = await fetch(channelUrl);
        const channelData = await channelRes.json() as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
        
        const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPlaylistId) {
          const videos = await this.fetchPlaylistItems(uploadsPlaylistId, apiKey, since);
          items.push(...videos);
        }
      }

      if (c.playlistId) {
        const videos = await this.fetchPlaylistItems(c.playlistId, apiKey, since);
        items.push(...videos);
      }

      // TODO: searchQuery support requires search endpoint

    } catch (error) {
      throw new Error(`YouTube API error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return items;
  }

  /**
   * 获取播放列表项
   * @param playlistId - 播放列表 ID
   * @param apiKey - API 密钥
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  private async fetchPlaylistItems(
    playlistId: string, 
    apiKey: string, 
    since?: Date
  ): Promise<AggregatedItem[]> {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json() as { error?: { message: string }; items?: unknown[] };

    if (data.error) {
      throw new Error(data.error.message);
    }

    return (data.items || [])
      .filter((item: unknown) => {
        if (!since) return true;
        const publishedAt = (item as { snippet?: { publishedAt?: string } }).snippet?.publishedAt;
        return publishedAt ? new Date(publishedAt) >= since : true;
      })
      .map((item: unknown): AggregatedItem => {
        const snippet = (item as { snippet?: {
          title?: string;
          description?: string;
          channelTitle?: string;
          publishedAt?: string;
          resourceId?: { videoId?: string };
        } }).snippet;
        
        return {
          id: `youtube:${snippet?.resourceId?.videoId}`,
          channelId: '', // Will be set by caller
          sourceType: 'external',
          original: {
            title: snippet?.title || 'Untitled',
            content: snippet?.description || '',
            author: snippet?.channelTitle,
            url: `https://youtube.com/watch?v=${snippet?.resourceId?.videoId}`,
            publishedAt: snippet?.publishedAt || new Date().toISOString(),
            metadata: { platform: 'youtube' },
          },
          createdAt: new Date().toISOString(),
        };
      });
  }
}

/**
 * Twitter/X 源适配器（占位实现）
 */
class TwitterAdapter implements SourceProviderAdapter {
  name = 'Twitter/X';

  /**
   * 验证 Twitter 配置
   * @param config - 配置对象
   * @returns 是否有效
   */
  validateConfig(config: unknown): boolean {
    if (!config || typeof config !== 'object') return false;
    const c = config as TwitterConfig;
    return Boolean(c.searchQuery || (c.userHandles && c.userHandles.length > 0));
  }

  /**
   * 获取 Twitter 内容（未实现）
   * @param _config - 配置对象
   * @param _credentials - 凭证
   * @param _since - 起始日期
   * @throws Error - 始终抛出未实现错误
   */
  async fetchItems(
    _config: unknown,
    _credentials: SourceCredentials,
    _since?: Date
  ): Promise<AggregatedItem[]> {
    // Twitter API v2 requires bearer token and has complex rate limits
    // This is a placeholder - full implementation would use the Twitter API client
    throw new Error('Twitter adapter not yet implemented. Use RSS feeds as an alternative.');
  }
}

/**
 * GitHub 源适配器
 */
class GitHubAdapter implements SourceProviderAdapter {
  name = 'GitHub';

  /**
   * 验证 GitHub 配置
   * @param config - 配置对象
   * @returns 是否有效
   */
  validateConfig(config: unknown): boolean {
    if (!config || typeof config !== 'object') return false;
    const c = config as GitHubConfig;
    return Boolean(c.repos && c.repos.length > 0);
  }

  async fetchItems(
    config: unknown,
    credentials: SourceCredentials,
    since?: Date
  ): Promise<AggregatedItem[]> {
    const c = config as GitHubConfig;
    const token = credentials.apiKey || credentials.accessToken;
    const items: AggregatedItem[] = [];

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OpenClaw-Luna/1.0',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    for (const repo of c.repos || []) {
      try {
        const [owner, name] = repo.split('/');
        if (!owner || !name) continue;

        const events = c.events || ['release'];

        if (events.includes('release')) {
          const releases = await this.fetchReleases(owner, name, headers, since);
          items.push(...releases);
        }

        // TODO: issues, PRs, commits

      } catch (error) {
        console.error(`Failed to fetch GitHub repo ${repo}:`, error);
      }
    }

    return items;
  }

  /**
   * 获取仓库发布
   * @param owner - 仓库所有者
   * @param repo - 仓库名
   * @param headers - 请求头
   * @param since - 起始日期
   * @returns 聚合项数组
   */
  private async fetchReleases(
    owner: string,
    repo: string,
    headers: Record<string, string>,
    since?: Date
  ): Promise<AggregatedItem[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
    
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const releases = await response.json() as Array<{
      name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
      author?: { login?: string };
      tag_name?: string;
    }>;

    return releases
      .filter((release: any) => {
        if (!since || !release.published_at) return true;
        return new Date(release.published_at) >= since;
      })
      .map((release: any) => ({
        id: `github:release:${owner}/${repo}:${release.tag_name}`,
        channelId: '', // Will be set by caller
        sourceType: 'external',
        original: {
          title: `Release: ${release.name || release.tag_name}`,
          content: release.body || '',
          author: release.author?.login,
          url: release.html_url,
          publishedAt: release.published_at || new Date().toISOString(),
          metadata: { platform: 'github', type: 'release', repo: `${owner}/${repo}` },
        },
        createdAt: new Date().toISOString(),
      }));
  }
}
