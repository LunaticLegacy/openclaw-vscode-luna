# OpenClaw Luna for VSCode

<div align="center">
  <img src="resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

  ### 在 VS Code 中直接使用 OpenClaw Agent、AI Swarm 和 cron 任务

  **支持 Agent 管理、AI Swarm 集群、OpenClaw cron 定时任务、7/30 日用量监控与多连接模式的 VS Code 插件**

  [中文](README.md) | [English](docs/README_EN.md)
</div>

---

## 当前能力

### Agent 管理

- 在主界面和侧边栏中创建、编辑、删除、刷新 Agent
- 支持自定义模型和 System Prompt
- 支持预设智能体创建流程
- 聊天记录会自动持久化

### AI Swarm 集群工作区

- 在同一工作区内切换 `Broadcast / Collaborate / 成员直连`
- 顶部菜单可直接选择集群成员继续对话
- 支持在集群内添加或移除智能体
- 支持从侧边栏直接进入某个集群

### 定时任务

- 任务页直接读取 OpenClaw 的 cron 作业和运行记录
- 支持 `every / at / cron` 三种调度方式
- 支持创建、编辑、启用、停用、立即执行和删除
- 仅在 `OpenClaw CLI` 模式下可用

### API 用量

- 支持 7 日 / 30 日窗口切换
- 展示请求数、Token、成本估算
- 支持按日统计和按模型分布

### 连接模式

- `Auto Detect`
- `Gateway`
- `OpenClaw CLI`
- `Local Models`

主界面自带连接设置和安装引导，不需要离开 Luna 处理切换和重试。

---

## 快速开始

### 安装

```bash
git clone https://github.com/openclaw/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### 开发模式

```bash
npm run watch
```

然后按 `F5` 启动 Extension Development Host。

### 常用配置

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `openclaw.configMode` | 连接模式 | `auto` |
| `openclaw.gatewayUrl` | Gateway 地址 | `http://127.0.0.1:18789` |
| `openclaw.gatewayToken` | Gateway Token | `""` |
| `openclaw.defaultAgent` | 默认 Agent ID | `default` |
| `openclaw.cliPath` | OpenClaw CLI 路径 | `""` |
| `openclaw.nodePath` | Node 路径 | `""` |
| `openclaw.stateDir` | OpenClaw 状态目录 | `""` |

---

## 界面说明

### 主界面

- `对话`：与当前 Agent 聊天
- `任务`：管理 OpenClaw cron 作业
- `用量`：查看 7/30 日 API 用量
- 左侧主栏：同时展示 `Agents` 和 `Clusters`

### 新建智能体

- `新建智能体`：空白创建
- `使用预设智能体`：使用卡片式预设模板快速创建

当前内置预设包括：

- `algorithm-helper`
- `quantative-recorder`
- `code-review-guard`
- `bug-hunter`
- `refactor-planner`
- `api-contract-writer`

---

## 项目结构

```text
openclaw-vscode/
├── src/
│   ├── extension.ts
│   ├── i18n.ts
│   ├── config/
│   │   └── agentPresets.ts
│   ├── managers/
│   │   ├── agentManager.ts
│   │   ├── chatSessionManager.ts
│   │   ├── clusterManager.ts
│   │   └── scheduledTaskManager.ts
│   ├── panels/
│   │   └── openclawPanel.ts
│   ├── providers/
│   │   ├── openclawSidebarProvider.ts
│   │   └── taskTreeProvider.ts
│   ├── services/
│   │   ├── openclawCli.ts
│   │   ├── openclawConfig.ts
│   │   ├── openclawGatewayClient.ts
│   │   └── openclawService.ts
│   └── types/
│       └── ws.d.ts
├── media/
│   ├── panel.html
│   ├── panel.js
│   ├── style.css
│   ├── i18n.js
│   └── markdownRenderer.js
├── i18n/
│   ├── en.json
│   └── zh-cn.json
├── docs/
│   └── README_EN.md
├── resources/
├── package.json
├── package.nls.json
└── package.nls.zh-cn.json
```

---

## 当前状态

- [x] 主界面 Webview 聊天工作区
- [x] AI Swarm 集群工作区
- [x] OpenClaw cron 定时任务管理
- [x] 7 日 / 30 日 API 用量面板
- [x] 预设智能体创建流程
- [ ] 更多端到端 UI 测试
- [ ] 更多场景化预设
- [ ] 文档截图持续更新

---

## License

[MIT](LICENSE) © 2026 OpenClaw
