# OpenClaw Luna for VS Code

<div align="center">

<br />

<img src="resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

# OpenClaw Luna

### 把 OpenClaw 的 Agent、Swarm、定时任务和用量统一带回 VS Code

**连上 OpenClaw，创建 Agent，发出第一条消息，然后再决定要不要深入多 Agent 协作、定时任务和诊断。**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-0.7.1-111111)](package.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[60 秒上手](#60-秒上手) · [核心能力](#核心能力) · [连接模式](#连接模式) · [反馈方式](#遇到问题时这样反馈) · [English](docs/README_EN.md)

<br />

<img src="resources/screenshot-01.png" width="88%" alt="OpenClaw Luna screenshot 1" />

<p>
  <img src="resources/screenshot-02.png" width="43.5%" alt="OpenClaw Luna screenshot 2" />
  <img src="resources/screenshot-03.png" width="43.5%" alt="OpenClaw Luna screenshot 3" />
</p>

</div>

---

## 它是什么

OpenClaw Luna 是一个 VS Code 扩展，用来把 OpenClaw 的日常控制路径收进一个面板里。

你不需要在 CLI、浏览器、配置文件和零散命令之间来回跳。Luna 的目标很直接：

- 在 VS Code 里完成第一次连通和第一次对话
- 在同一个入口管理 Agent、Swarm、Tasks 和 Usage
- 把“能不能用、为什么这次能用下次不能用”说清楚，而不是藏在模式差异里

它更适合这两类人：

- 已经在用 OpenClaw，想把主要操作放回 VS Code
- 正准备试 OpenClaw，想先完成一次最小成功，而不是先啃配置体系

如果你要的是“打开插件就直接替代所有 AI 助手”，那不是 Luna 的定位。它服务的是 OpenClaw 工作流，不是另一个通用聊天框。

---

## 60 秒上手

### 1. 安装扩展

从 VS Code Marketplace 安装 `OpenClaw Luna`。

### 2. 打开面板

任选一个入口：

- 命令面板 `OpenClaw Luna: Open OpenClaw Luna`
- 右下角状态栏 `OpenClaw`
- 左侧 Activity Bar `OpenClaw`

### 3. 先跑通第一条主路径

第一次使用时，不要先研究所有模式。直接按这条最短路径走：

- 检查本地 OpenClaw 是否已安装
- 启动本地 `OpenClaw gateway`，或填写远端 Gateway
- 保持默认连接模式
- 创建第一个 Agent
- 发送第一条消息

### 4. 只有在需要时再展开能力

当第一条消息已经成功返回，再看这些能力：

- 需要多 Agent 协作时，进入 `Swarm`
- 需要定时任务时，切到 `OpenClaw CLI`
- 需要查请求量、Token 和成本时，打开 `Usage`
- 需要精细调配置时，再编辑 `OpenClaw Config` 或本地模型配置

第一次成功的标准很简单：能连上、能建 Agent、能发消息。

---

## 核心能力

### Agent 工作台

- 创建、编辑、删除、刷新 Agent
- 支持预设智能体工作流
- 支持自定义模型、System Prompt、工作区
- 会话历史自动持久化，支持流式回复

### Swarm 工作区

- 在一个工作区里切换 `Broadcast / Collaborate / 成员直连`
- 从侧边栏直接进入某个集群
- 支持集群成员增删和协作上下文切换

### 定时任务面板

- 查看 OpenClaw cron jobs 与运行记录
- 支持 `every / at / cron` 三种调度方式
- 支持创建、编辑、启停、立即执行、删除
- 任务能力只在 `OpenClaw CLI` 模式下开放

### 用量与诊断

- 7 日 / 30 日窗口切换
- 按天查看请求数、Token、成本
- 按模型查看分布与成本占比
- 在一个地方排查“为什么今天的调用和昨天不一样”

---

## 为什么有人会用它

Luna 解决的不是“再加一个聊天入口”，而是 OpenClaw 用户已经遇到的这些真实摩擦：

- Agent 对话在一个地方，集群管理在另一个地方
- 定时任务要切回 CLI，排查用量又要切去别处
- 同一个操作在不同模式下表现不同，但界面没有说清楚
- 第一次配置成功前，用户不知道自己到底卡在连接、模式还是权限

如果你的日常路径里本来就包含 Agent、Swarm、cron 或 usage，Luna 的价值就是把这些入口合并成一个稳定主路径。

---

## 连接模式

| 模式 | 适合场景 | 数据来源 |
| --- | --- | --- |
| `Auto Detect` | 先让 Luna 自动判断本地最合适的连接链路 | 按本机环境解析 |
| `Gateway` | 团队远端部署，共享 Agent 和集群 | OpenClaw Gateway |
| `OpenClaw CLI` | 本地完整 OpenClaw 能力，含 cron 和实时会话同步 | 本地 CLI + Gateway |
| `Local Models` | 只想在本地 provider 上跑模型 | `models.json` / `auth-profiles.json` |

### 配置边界

- `OpenClaw Config` 编辑的是 `openclaw.json`
- `Local Models` 模式使用的是 `models.json` 和可选的 `auth-profiles.json`
- 这两套配置不是一回事，Luna 会明确区分可用能力

---

## 什么时候该用 Luna

适合：

- 你已经在用 OpenClaw
- 你希望主要控制入口在 VS Code
- 你需要 Agent、Swarm、任务和用量放在同一个工作流里

不适合：

- 你只是想要一个纯聊天插件
- 你完全不打算接触 OpenClaw 运行时或配置

---

## 遇到问题时这样反馈

最有价值的反馈不是“不能用”，而是下面三项：

- 你当前使用的连接模式：`Auto Detect`、`Gateway`、`OpenClaw CLI` 或 `Local Models`
- 你卡住的步骤：安装、连接、创建 Agent、发送消息、打开 Task、查看 Usage
- VS Code 开发者工具、输出面板或界面提示里的原始错误文本

反馈入口：

- Issue: <https://github.com/LunaticLegacy/openclaw-vscode-luna/issues>
- 仓库主页: <https://github.com/LunaticLegacy/openclaw-vscode-luna>

---

## 常用配置

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `openclaw.configMode` | 连接模式 | `openclaw` |
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

真实 VS Code 宿主链路测试：

```bash
npm run test:host
```

---

## 项目结构

```text
openclaw-vscode-luna/
├── src/
│   ├── commands/
│   ├── extension/
│   ├── managers/
│   ├── panels/
│   ├── providers/
│   ├── services/
│   ├── config/
│   ├── test/
│   └── utils/
├── media/
├── i18n/
├── docs/
├── resources/
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
- [ ] 更多真实宿主链路覆盖
- [ ] 更多场景截图与上手演示

---

## 贡献

欢迎 issue 和 PR。

```bash
git checkout -b feature/your-change
npm test
git commit -m "Describe your change"
```

---

## License

[MIT](LICENSE) © 2026 OpenClaw
