<div align="center">

<br />

<img src="resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

# OpenClaw Luna for VSCode

### 在 VSCode 中无缝使用 OpenClaw AI Agent 功能

(Public Alpha)

**支持 Agent 管理、集群操作、API 用量监控的 VSCode 插件**

[🇨🇳 中文](README.md) | [🇺🇸 English](docs/README_EN.md)

[![VSCode](https://img.shields.io/badge/VSCode-%5E1.80.0-blue?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/openclaw/openclaw-vscode-luna?style=social)](https://github.com/openclaw/openclaw-vscode-luna)

[🇨🇳 📖 文档](https://docs.openclaw.ai) · [💬 讨论区](https://github.com/openclaw/openclaw-vscode-luna/discussions) · [🐛 问题反馈](https://github.com/openclaw/openclaw-vscode-luna/issues)

<br />

</div>

---

## ✨ 为什么选择 OpenClaw Luna？

> *"让 AI Agent 成为你开发工作流的自然延伸，而不是额外的负担。"*

在现代开发中，我们每天都在与代码、文档、调试信息打交道。但传统的 AI 工具往往是孤立的，需要切换上下文。**OpenClaw Luna 将 AI 能力深度集成到你的开发环境中**。

OpenClaw Luna 帮助你：

- 🤖 **无缝 Agent 集成** —— 在 VSCode 中直接与多个 AI Agent 对话
- 🖥️ **智能集群管理** —— 创建 Agent 集群，实现多 Agent 协作
- 📊 **实时用量监控** —— 监控 API 调用和 Token 消耗
- ⚡ **零上下文切换** —— 所有功能都在 VSCode 内完成

---

## 🚀 两分钟上手

### 安装

```bash
# 从源码安装（开发模式）
git clone https://github.com/openclaw/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### 配置

1. 打开 VSCode 设置 (`Ctrl+,`)
2. 搜索 "OpenClaw"
3. 配置以下关键设置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `openclaw.gatewayUrl` | OpenClaw Gateway 地址 | `http://localhost:3344` |
| `openclaw.gatewayToken` | Gateway 认证 Token | - |
| `openclaw.defaultAgent` | 默认 Agent ID | `default` |

### 启动

```bash
# 开发模式
npm run watch  # 监听文件变化
# 然后按 F5 启动 Extension Development Host
```

或者直接从 VSCode Marketplace 安装发布版本。

---

## 🎯 核心特性

### 🤖 多 Agent 管理

- **创建/编辑/删除 Agent** —— 支持多种模型 (GPT-4, GPT-3.5, Claude, Kimi)
- **自定义 System Prompt** —— 为每个 Agent 设置专属行为
- **实时状态监控** —— 在线/空闲/离线状态一目了然
- **聊天记录持久化** —— 所有对话历史自动保存

### 🖥️ Agent 集群功能

| 功能 | 说明 | 使用场景 |
|------|------|----------|
| 集群创建 | 将多个 Agent 组织成集群 | 团队协作、多角色模拟 |
| 广播消息 | 向集群中所有 Agent 发送消息 | 并行处理、多角度分析 |
| 状态管理 | 监控集群整体状态 | 负载均衡、故障检测 |

### 📊 API 用量监控

内置用量统计功能：
- ✅ 实时 Token 消耗监控
- ✅ 按模型分类的用量分析
- ✅ 7天趋势图表
- ✅ 成本估算

### ⚡ 无缝集成体验

多种触发方式：
- **状态栏按钮** —— 右下角 🚀 OpenClaw 按钮
- **快捷键** —— `Ctrl+Shift+O` 打开面板
- **命令面板** —— `Ctrl+Shift+P` → "Open OpenClaw Luna"
- **右键菜单** —— 编辑器右键 → "Quick Chat"
- **选中代码** —— 选中文本后按 `Ctrl+Shift+C`

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        VSCode Extension                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Webview UI    │  │  Tree View      │  │ Command     │  │
│  │   (React-like)  │  │  (Side Panel)   │  │ Palette     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Extension Backend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Extension  │  │   Managers  │  │   Tree Providers    │  │
│  │   (Main)    │──│  (Agent,    │──│   (Agent, Cluster,  │  │
│  └─────────────┘  │   Cluster,  │  │    Usage)           │  │
│                   │   Usage)    │  └─────────────────────┘  │
│                   └─────────────┘                           │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              OpenClaw Service Layer                  │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │               HTTP Client (Axios)             │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Agent     │  │   Cluster   │  │   Metrics &         │  │
│  │  Management │  │  Management │  │   Usage Tracking    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 项目结构

```
openclaw-vscode/
├── src/
│   ├── extension.ts                    # 插件入口与命令注册
│   ├── i18n.ts                         # 运行时 i18n 加载
│   ├── managers/                       # 会话 / Agent / 集群 / 用量管理
│   │   ├── agentManager.ts
│   │   ├── chatSessionManager.ts
│   │   ├── clusterManager.ts
│   │   └── usageManager.ts
│   ├── panels/
│   │   └── openclawPanel.ts            # Webview 面板控制器
│   ├── providers/                      # 侧边栏树视图提供者
│   │   ├── agentTreeProvider.ts
│   │   ├── clusterTreeProvider.ts
│   │   └── usageTreeProvider.ts
│   ├── services/                       # OpenClaw 接入层
│   │   ├── openclawCli.ts              # CLI / gateway call 封装
│   │   ├── openclawConfig.ts           # 本地 OpenClaw 配置解析
│   │   ├── openclawGatewayClient.ts    # Gateway WebSocket 事件流客户端
│   │   └── openclawService.ts          # 统一服务接口与消息归一化
│   └── types/
│       └── ws.d.ts                     # `ws` 本地类型声明
├── media/
│   ├── panel.html                      # Webview 模板
│   ├── panel.js                        # 主界面交互逻辑
│   ├── style.css                       # Webview 样式
│   ├── i18n.js                         # 前端 i18n
│   └── markdownRenderer.js             # Markdown 渲染器
├── i18n/
│   ├── en.json                         # 运行时英文文案
│   └── zh-cn.json                      # 运行时中文文案
├── docs/
│   └── README_EN.md                    # 英文说明文档
├── resources/
│   ├── icon.png
│   └── icon.svg
├── package.json                        # 插件清单、命令与配置
├── package.nls.json                    # 英文本地化占位
├── package.nls.zh-cn.json              # 中文本地化占位
└── tsconfig.json                       # TypeScript 配置
```

---

## 🛣️ 路线图

- [x] 基础 Agent 管理功能
- [x] 多 Agent 集群支持
- [x] API 用量监控
- [x] VSCode 深度集成
- [ ] Webview 自定义界面
  - [ ] React-based UI
  - [ ] 主题自适应
  - [ ] 交互式聊天界面
- [ ] 高级功能
  - [ ] Agent 模板库
  - [ ] 代码片段集成
  - [ ] 智能建议系统
- [ ] 性能优化
  - [ ] 缓存机制
  - [ ] 异步加载
  - [ ] 内存优化

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

1. **Fork** 本项目
2. 创建你的功能分支：`git checkout -b feature/amazing-feature`
3. 提交改动：`git commit -m 'Add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 创建 **Pull Request**

查看详细的 [贡献指南](CONTRIBUTING.md) 了解规范。

---

## 📄 许可证

[MIT](LICENSE) © 2026 OpenClaw

---

<div align="center">

**[⬆ 回到顶部](#openclaw-luna-for-vscode)**

Made with ❤️ and 💻 by [月と猫 - LunaNeko](https://github.com/openclaw)

</div>
