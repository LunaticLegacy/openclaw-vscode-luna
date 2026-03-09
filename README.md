# OpenClaw Luna for VSCode

<div align="center">
  <img src="resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

  ### OpenClaw 的 VS Code 控制台

  **把 Agent、AI Swarm、OpenClaw cron 和 7/30 日用量收进一个控制台，而不是分散在多个入口里。**

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

### 模式能力矩阵

| 能力 | Gateway | OpenClaw CLI | Local Models |
| --- | --- | --- | --- |
| Agent 对话 | 原生支持 | 原生支持 | 原生支持 |
| Agent 设置编辑 | 支持 | 不支持 | 支持 |
| Swarm 工作区 | 远端集群 | Luna 本地工作区 | Luna 本地工作区 |
| 集群持久化 | Gateway 存储 | Luna 存储 | Luna 存储 |
| 定时任务 | 不支持 | 支持 | 不支持 |
| 实时会话同步 | 不支持 | 支持 | 不支持 |
| 用量面板 | 支持 | 支持 | 支持 |

这张表不是文档装饰，代码里已经按这组约束集中收口：命令、panel 和 service 都通过同一份 capability matrix 判断可用性，不再散落 `if mode`。

---

## 快速开始

### 安装

```bash
git clone https://github.com/LunaticLegacy/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### 开发模式

```bash
npm run watch
```

然后按 `F5` 启动 Extension Development Host。

### 测试

```bash
npm test
```

当前会运行一条主路径 smoke 集成测试，覆盖：

- 扩展激活与命令注册
- `Local Models` 模式下创建 Agent、发送消息、读取 usage
- 切换到 `OpenClaw CLI` 模式后创建、编辑、启停、执行、删除任务

如需跑真实 VS Code 宿主激活链路，可执行：

```bash
npm run test:host
```

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

当前内置预设不再只是名字列表，每个预设都补了适用场景、推荐模型、失败信号和输出标准：

| 预设 | 适用场景 | 推荐模型 | 输出标准 |
| --- | --- | --- | --- |
| `algorithm-helper` | 算法题、复杂度分析、边界条件推导 | 长上下文推理 / 代码模型 | 先讲约束与方案，再给可实现解法 |
| `quantative-recorder` | 交易账本、PnL 拆分、费用与口径检查 | 对数字和表格稳定的推理模型 | 先拆余额/PnL/费用/异常，再下结论 |
| `code-review-guard` | 缺陷、回归、安全、性能和测试缺口审查 | 擅长 diff 与行为回归的推理模型 | Findings first，附证据和影响 |
| `bug-hunter` | 最小复现、假设收敛、调试方案设计 | 擅长日志和 trace 的调试模型 | 给出假设、最快复现和下一步探针 |
| `refactor-planner` | 存量系统重构、迁移拆分、验证规划 | 长上下文迁移规划模型 | 分阶段、含回滚点和验证标准 |
| `api-contract-writer` | 接口契约、错误模型、版本策略、示例 | 对 schema/兼容性稳定的推理模型 | 请求/响应/错误/示例一起交付 |

---

## 项目结构

```text
openclaw-vscode-luna/
├── src/
│   ├── extension.ts
│   ├── i18n.ts
│   ├── commands/
│   ├── extension/
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
│   │   ├── openclaw/
│   │   ├── openclawCli.ts
│   │   ├── openclawConfig.ts
│   │   ├── openclawGatewayClient.ts
│   │   └── openclawService.ts
│   ├── test/
│   │   ├── fixtures/
│   │   └── suite/
│   └── types/
│       └── ws.d.ts
├── media/
│   ├── panel.html
│   ├── panelCommon.js
│   ├── panelFeedback.js
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
- [x] 主路径 smoke 集成测试
- [ ] 更多场景化预设
- [ ] 文档截图持续更新

---

## License

[MIT](LICENSE) © 2026 OpenClaw
