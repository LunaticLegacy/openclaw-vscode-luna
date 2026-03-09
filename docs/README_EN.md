# OpenClaw Luna for VSCode

<div align="center">
  <img src="../resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

  ### Use OpenClaw Agents, AI Swarms, and cron tasks directly inside VS Code

  **A VS Code extension for agent management, AI Swarm workspaces, OpenClaw cron tasks, 7/30-day usage monitoring, and multi-mode connections**

  [中文](../README.md) | [English](README_EN.md)
</div>

---

## Current Capabilities

### Agent Management

- Create, edit, delete, and refresh agents from the main webview or the sidebar
- Configure custom models and system prompts
- Create agents from built-in presets
- Persist chat history automatically

### AI Swarm Workspace

- Switch between `Broadcast / Collaborate / Member Chat` inside one workspace
- Pick cluster members from the top target bar and keep chatting without leaving the cluster page
- Add or remove agents from a cluster directly in the swarm workspace
- Open a cluster directly from the sidebar

### Scheduled Tasks

- Read OpenClaw cron jobs and run history directly from the task view
- Support `every / at / cron` schedules
- Create, edit, enable, disable, run now, and delete tasks
- Available only in `OpenClaw CLI` mode

### API Usage

- Toggle between 7-day and 30-day windows
- Show requests, tokens, and estimated cost
- Break usage down by day and by model

### Connection Modes

- `Auto Detect`
- `Gateway`
- `OpenClaw CLI`
- `Local Models`

The main console includes connection setup and install guidance, so switching and retrying can stay inside Luna.

---

## Quick Start

### Install

```bash
git clone https://github.com/openclaw/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### Development Mode

```bash
npm run watch
```

Then press `F5` to launch the Extension Development Host.

### Common Settings

| Setting | Description | Default |
| --- | --- | --- |
| `openclaw.configMode` | Connection mode | `auto` |
| `openclaw.gatewayUrl` | Gateway URL | `http://127.0.0.1:18789` |
| `openclaw.gatewayToken` | Gateway token | `""` |
| `openclaw.defaultAgent` | Default agent ID | `default` |
| `openclaw.cliPath` | OpenClaw CLI path | `""` |
| `openclaw.nodePath` | Node path | `""` |
| `openclaw.stateDir` | OpenClaw state directory | `""` |

---

## UI Overview

### Main Views

- `Chat`: talk to the active agent
- `Tasks`: manage OpenClaw cron jobs
- `Usage`: inspect 7/30-day API usage
- Left sidebar: combined `Agents` and `Clusters`

### New Agent Flow

- `New Agent`: blank form
- `Use Preset Agent`: card-based preset gallery

Built-in presets currently include:

- `algorithm-helper`
- `quantative-recorder`
- `code-review-guard`
- `bug-hunter`
- `refactor-planner`
- `api-contract-writer`

---

## Project Structure

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

## Status

- [x] Main webview chat workspace
- [x] AI Swarm cluster workspace
- [x] OpenClaw cron task management
- [x] 7-day / 30-day API usage dashboard
- [x] Preset-based agent creation flow
- [ ] More end-to-end UI tests
- [ ] More scenario-specific presets
- [ ] Continuous README and screenshot updates

---

## License

[MIT](../LICENSE) © 2026 OpenClaw
