# OpenClaw Luna for VS Code

<div align="center">

<br />

<img src="resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

# OpenClaw Luna

(Public Alpha)

### OpenClaw 的 VS Code 控制台

**把 Agent、AI Swarm、OpenClaw cron、连接切换和 7/30 日用量收进一个面板，而不是散落在一堆命令里。**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-0.4.0-111111)](package.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[快速开始](#5-分钟上手) · [连接模式](#连接模式) · [能力矩阵](#能力矩阵) · [测试](#测试) · [English](docs/README_EN.md)

<br />

<img src="resources/screenshot-01.png" width="88%" alt="OpenClaw Luna screenshot 1" />

<p>
  <img src="resources/screenshot-02.png" width="43.5%" alt="OpenClaw Luna screenshot 2" />
  <img src="resources/screenshot-03.png" width="43.5%" alt="OpenClaw Luna screenshot 3" />
</p>

</div>

---

## 为什么是 Luna

> *"Luna 不是另一个聊天框，而是 OpenClaw 在 VS Code 里的主控台。"*

当你的工作流同时涉及 Agent 对话、Swarm 协同、定时任务、连接切换和用量排查时，问题从来不是“入口不够多”，而是上下文被切碎了。Luna 的目标是把这些核心操作收敛到一个稳定的主路径里：

- 在同一个面板里完成 Agent 创建、对话、切换模型和查看上下文。
- 在同一个工作区里管理 Swarm、成员广播、协同和集群入口。
- 在不离开 VS Code 的前提下查看 OpenClaw cron、立即运行、编辑和排错。
- 直接看到 7 日 / 30 日请求量、Token、成本和模型分布，而不是再开一层 CLI 或网页。
- 把连接模式差异显式化，避免“这个按钮为什么这次能用、下次不能用”的隐性行为。

---

## 5 分钟上手

### 1. 安装仓库

```bash
git clone https://github.com/LunaticLegacy/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
```

### 2. 编译并启动扩展宿主

```bash
npm run compile
npm run watch
```

然后在 VS Code 里按 `F5` 打开 `Extension Development Host`。

### 3. 打开 Luna

你有三种进入方式：

- 侧边栏 `OpenClaw` Activity Bar
- 命令面板 `OpenClaw: Open Panel`
- 右下角状态栏 `OpenClaw`

首次进入时，左上角 `OpenClaw Luna` 会回到初始设置界面。这里可以：

- 检查本地 OpenClaw 是否已安装
- 一键启动本地 `OpenClaw gateway`
- 直接编辑 `OpenClaw Config`
- 切换 `Auto Detect / Gateway / OpenClaw CLI / Local Models`

---

## 核心能力

### Agent 控制台

- 创建、编辑、删除、刷新 Agent
- 支持预设智能体工作流
- 支持自定义模型、System Prompt、工作区
- 会话历史自动持久化，支持流式回复和实时同步

### Swarm 工作区

- 在同一个工作区中切换 `Broadcast / Collaborate / 成员直连`
- 从侧边栏直接进入某个集群
- 支持集群成员增删和协作上下文切换

### OpenClaw cron 面板

- 读取 OpenClaw cron jobs 与运行记录
- 支持 `every / at / cron` 三种调度方式
- 支持创建、编辑、启停、立即执行、删除
- 任务能力只在 `OpenClaw CLI` 模式下开放

### 用量与诊断

- 7 日 / 30 日窗口切换
- 按天查看请求数、Token、成本
- 按模型查看分布与成本占比
- 每日用量柱状图支持 hover 提示
- UI、侧边栏和 service 现在共用同一套用量失效机制，减少“这里是旧的、那里是新的”

---

## 连接模式

Luna 支持四种入口模式：

| 模式 | 适合场景 | 数据来源 |
| --- | --- | --- |
| `Auto Detect` | 让 Luna 自动判定本地可用链路 | 按本机环境解析 |
| `Gateway` | 团队远端部署、共享 Agent/Cluster | OpenClaw Gateway |
| `OpenClaw CLI` | 本地完整 OpenClaw 能力，含 cron 和会话同步 | 本地 CLI + Gateway |
| `Local Models` | 只想在本地 provider 上跑模型 | `models.json` / `auth-profiles.json` |

### OpenClaw Config 与 Local Models 的边界

- `OpenClaw Config` 卡片编辑的是 `openclaw.json`
- `Local Models` 模式使用的是 `models.json` 和可选的 `auth-profiles.json`
- 这两个配置面不是一回事，Luna 已在 UI 和代码里按 capability boundary 收口

---

## 能力矩阵

| 能力 | Gateway | OpenClaw CLI | Local Models |
| --- | --- | --- | --- |
| Agent 对话 | 原生支持 | 原生支持 | 原生支持 |
| Agent 设置编辑 | 支持 | 不支持 | 支持 |
| Swarm 工作区 | 远端集群 | Luna 本地集群 | Luna 本地集群 |
| 集群持久化 | Gateway | 工作区 | 工作区 |
| 定时任务 | 不支持 | 支持 | 不支持 |
| 实时会话同步 | 不支持 | 支持 | 不支持 |
| 用量面板 | 支持 | 支持 | 支持 |

这张表不是文档装饰。命令、panel 和 service 现在共享同一份 capability matrix，避免在 UI 层散落大量 `if mode`。

---

## OpenClaw 工作流

```text
VS Code
  |
  +-- Activity Bar / Tree Views / Status Bar
  |
  +-- OpenClaw Luna Panel
        |
        +-- Chat / Tasks / Usage / Config
        |
        +-- OpenClawService
              |
              +-- GatewayTransport
              +-- LocalModeRuntime
              +-- OpenClawModeRuntime
                    |
                    +-- Usage Service
                    +-- Agent / Session Repository
                    +-- Task Runtime
```

这次重构后，`OpenClawService` 已经从 God Object 降成 facade，模式运行时、usage 映射、local repository 和 transport 已拆开。

---

## 常用配置

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `openclaw.configMode` | 连接模式 | `auto` |
| `openclaw.gatewayUrl` | Gateway 地址 | `http://127.0.0.1:18789` |
| `openclaw.gatewayToken` | Gateway Token | `""` |
| `openclaw.defaultAgent` | 默认 Agent ID | `default` |
| `openclaw.cliPath` | OpenClaw CLI 路径 | `""` |
| `openclaw.nodePath` | Node 路径 | `""` |
| `openclaw.stateDir` | OpenClaw 状态目录 | `""` |
| `openclaw.modelsPath` | Local Models 配置路径 | `""` |
| `openclaw.authProfilesPath` | Auth Profiles 路径 | `""` |

---

## 测试

```bash
npm test
```

当前主路径 smoke 覆盖：

- 扩展激活与主要命令贡献
- `Local Models` 模式下创建 Agent、发送消息、读取 usage
- 切换到 `OpenClaw CLI` 模式后创建 Agent、发送消息、读取 usage
- OpenClaw task 的创建、编辑、启停、立即运行、删除
- OpenClaw config 合并与字段保留
- usage 模型回填与模式切换后的缓存失效

如果你要跑真实 VS Code 宿主链路：

```bash
npm run test:host
```

---

## 项目结构

```text
openclaw-vscode-luna/
├── src/
│   ├── commands/          # 命令注册与 handler
│   ├── extension/         # 组合根与运行时装配
│   ├── managers/          # Agent / Cluster / Usage / Task 管理层
│   ├── panels/            # Webview panel 入口与消息桥
│   ├── providers/         # Sidebar / Usage / Task tree providers
│   ├── services/          # Transport / Runtime / Config / CLI
│   ├── config/            # Agent presets
│   ├── test/              # Fixtures 与 smoke tests
│   └── utils/             # capability / status / date helpers
├── media/                 # panel.html / panel.js / CSS / UI helpers
├── i18n/                  # 中英文消息
├── docs/                  # 英文 README
├── resources/             # 图标等资源
└── package.json
```

---

## 当前状态

- [x] OpenClaw 主面板与侧边栏入口
- [x] Agent 管理与预设创建
- [x] Swarm 工作区
- [x] OpenClaw cron 面板
- [x] OpenClaw Config UI
- [x] 7 日 / 30 日用量面板
- [x] 主路径 smoke 测试
- [ ] 更多真实宿主级 UI 回归
- [ ] 持续补齐文档截图与场景手册

---

## 贡献

欢迎 issue 和 PR。

```bash
git checkout -b feature/your-change
npm test
git commit -m "Describe your change"
```

在提交前，至少保证主路径 smoke 不回归。

---

## License

[MIT](LICENSE) © 2026 OpenClaw
