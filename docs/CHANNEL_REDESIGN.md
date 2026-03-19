# OpenClaw Luna - 频道重新设计文档

## 1. 设计目标

- **父子层级结构**: 支持频道嵌套，类似 Discord Threads
- **跨频道内容聚合**: 子频道内容可自动汇总到父频道
- **外部数据源集成**: 通过 API Key 接入外部服务（RSS、社交媒体等）
- **灵活的编辑和删除**: 支持频道移动、合并、归档

## 2. 核心概念

### 2.1 频道类型

```typescript
type ChannelType = 
  | 'root'      // 根频道，作为容器，不可直接聊天
  | 'standard'  // 标准频道，可聊天，可作为父频道
  | 'thread'    // 子频道/线程，继承父频道配置，可独立聊天
  | 'aggregate' // 聚合频道，自动汇总多个子频道内容
  | 'external'; // 外部数据源频道（YouTube、Twitter、RSS等）
```

### 2.2 频道层级结构

```
Workspace (工作区)
├── 📁 产品团队 (root)
│   ├── 💬 需求讨论 (standard)
│   ├── 💬 技术方案 (standard)
│   │   └── 📎 后端架构 (thread)
│   │   └── 📎 前端实现 (thread)
│   └── 📊 周报汇总 (aggregate) ← 自动汇总所有子频道关键内容
├── 📁 外部监控 (root)
│   ├── 📡 GitHub Releases (external)
│   ├── 📡 Hacker News (external)
│   └── 📡 Twitter mentions (external)
└── 💬 随机聊天 (standard)
```

### 2.3 内容聚合机制

- **聚合频道** (`aggregate`) 可以配置聚合规则：
  - `sources`: 来源频道列表
  - `filter`: 过滤条件（关键词、时间范围、作者等）
  - `transform`: 转换方式（摘要、全文、AI 总结）
  - `schedule`: 聚合频率（实时、每小时、每日）

## 3. 数据结构

### 3.1 ChannelConfig (扩展)

```typescript
interface ChannelConfig {
  // === 基础字段 ===
  id: string;
  type: ChannelType;
  name: string;
  description?: string;
  
  // === 层级关系 ===
  parentId?: string;           // 父频道ID，null 表示根级
  childrenIds: string[];       // 子频道ID列表
  order: number;               // 同级排序
  
  // === 聊天配置 ===
  agentId?: string;            // 绑定的 Agent（thread 可继承父频道）
  sessionId?: string;          // 当前会话ID
  inheritAgent: boolean;       // 是否继承父频道 Agent
  
  // === 聚合配置 (仅 aggregate 类型) ===
  aggregateConfig?: {
    sourceIds: string[];       // 聚合来源频道
    filter?: {
      keywords?: string[];
      authors?: string[];
      since?: string;          // ISO date
      until?: string;
    };
    transform: 'none' | 'summary' | 'ai-summarize';
    schedule: 'realtime' | 'hourly' | 'daily';
    maxItems: number;
  };
  
  // === 外部数据源配置 (仅 external 类型) ===
  externalConfig?: ChannelSourceConfig;
  
  // === 元数据 ===
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;         // 归档时间
  settings: ChannelSettings;
}
```

### 3.2 外部数据源配置

```typescript
interface ChannelSourceConfig {
  provider: 'rss' | 'youtube' | 'twitter' | 'github' | 'webhook' | 'custom';
  
  // === 通用配置 ===
  name: string;
  enabled: boolean;
  
  // === 认证配置 (加密存储) ===
  credentials: {
    apiKey?: string;           // 通用 API Key
    apiSecret?: string;        // 部分服务需要
    accessToken?: string;      // OAuth Token
    refreshToken?: string;     // OAuth Refresh
    expiresAt?: string;        // Token 过期时间
  };
  
  // === 数据源特定配置 ===
  config: 
    | RSSConfig
    | YouTubeConfig 
    | TwitterConfig
    | GitHubConfig
    | WebhookConfig
    | CustomAPIConfig;
  
  // === 同步配置 ===
  sync: {
    interval: number;          // 同步间隔（分钟）
    lastSyncAt?: string;       // 最后同步时间
    lastError?: string;        // 最后错误信息
    status: 'idle' | 'syncing' | 'error';
  };
  
  // === 内容处理 ===
  processing: {
    deduplicate: boolean;      // 去重
    summarize: boolean;        // AI 摘要
    translate?: string;        // 翻译目标语言
    maxLength?: number;        // 最大长度限制
  };
}

// 各平台具体配置
interface RSSConfig {
  type: 'rss';
  url: string;
  fetchFullContent: boolean;   // 是否抓取全文
}

interface YouTubeConfig {
  type: 'youtube';
  channelId?: string;
  playlistId?: string;
  searchQuery?: string;
  includeComments: boolean;
}

interface TwitterConfig {
  type: 'twitter';
  searchQuery?: string;
  userHandles?: string[];
  includeReplies: boolean;
  includeRetweets: boolean;
}

interface GitHubConfig {
  type: 'github';
  repos?: string[];            // ["owner/repo", ...]
  events?: ('release' | 'issue' | 'pr' | 'commit')[];
}

interface WebhookConfig {
  type: 'webhook';
  secret?: string;             // 验证签名
}

interface CustomAPIConfig {
  type: 'custom';
  endpoint: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  jqFilter?: string;           // 用 jq 语法提取内容
}
```

### 3.3 聚合内容项

```typescript
interface AggregatedItem {
  id: string;
  channelId: string;           // 来源频道ID
  sourceType: 'internal' | 'external';
  
  // === 原始内容 ===
  original: {
    title?: string;
    content: string;
    author?: string;
    url?: string;
    publishedAt: string;
    metadata?: Record<string, unknown>;
  };
  
  // === 处理后的内容 ===
  processed?: {
    summary?: string;
    translated?: string;
    tags?: string[];
  };
  
  // === 关联 ===
  messageId?: string;          // 如果已转为频道消息
  
  createdAt: string;
}
```

## 4. 功能规格

### 4.1 频道管理

| 功能 | 说明 |
|------|------|
| 创建 | 可选择父频道，指定类型 |
| 移动 | 拖拽或选择新父频道，保持子树结构 |
| 归档 | 软删除，保留历史但不可新增内容 |
| 删除 | 级联删除或转移到默认父频道 |
| 合并 | 将A频道内容合并到B频道，A变为归档 |

### 4.2 聚合频道

- 自动收集子频道或指定频道的新消息
- 支持 AI 总结（使用指定 Agent）
- 可配置聚合频率
- 聚合内容以特殊消息形式展示

### 4.3 外部数据源

- 支持 RSS、YouTube、Twitter、GitHub、Webhook
- API Key 加密存储（VS Code SecretStorage）
- 手动同步 + 自动定时同步
- 同步状态显示

## 5. UI/UX 设计

### 5.1 频道树形列表

```
📁 产品团队                  [⋯] 菜单
├── 💬 需求讨论              [⋯]
├── 💬 技术方案 ▾            [⋯]
│   ├── 📎 后端架构          [⋯]
│   └── 📎 前端实现          [⋯]
├── 📊 周报汇总 ★            [⋯]  ★=聚合频道
└── 📡 GitHub Releases ↻     [⋯]  ↻=外部源
```

### 5.2 操作菜单

- 新建子频道
- 设为聚合频道
- 添加外部数据源
- 移动到其他频道
- 归档/删除

### 5.3 配置界面

- 树形拖拽排序
- 频道详情面板
- 外部源配置向导
- 聚合规则配置

## 6. 安全考虑

- API Key 使用 VS Code SecretStorage 加密
- 外部请求带超时和重试机制
- Webhook 验证签名
- 内容长度限制防止滥用

## 7. 迁移策略

现有频道自动升级为 `type: 'standard'`，`parentId: null`，保持向后兼容。
