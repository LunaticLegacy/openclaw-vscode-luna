# OpenClaw Luna for VSCode

<div align="center">
  <img src="../resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

  ### The OpenClaw console for VS Code

  **Keep agents, AI Swarms, OpenClaw cron jobs, and 7/30-day usage in one console instead of scattering them across separate entry points.**

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

### Capability Matrix

| Capability | Gateway | OpenClaw CLI | Local Models |
| --- | --- | --- | --- |
| Agent chat | Native | Native | Native |
| Agent settings editing | Yes | No | Yes |
| Swarm workspace | Remote cluster transport | Luna-managed workspace | Luna-managed workspace |
| Cluster persistence | Gateway storage | Luna storage | Luna storage |
| Scheduled tasks | No | Yes | No |
| Live session sync | No | Yes | No |
| Usage dashboard | Yes | Yes | Yes |

This is not just documentation. The extension now routes service, command, and panel guards through the same capability matrix, instead of scattering `if mode` checks across the UI.

---

## Quick Start

### Install

```bash
git clone https://github.com/LunaticLegacy/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### Development Mode

```bash
npm run watch
```

Then press `F5` to launch the Extension Development Host.

### Tests

```bash
npm test
```

The current smoke integration test covers:

- extension activation and command registration
- creating an agent, sending a message, and reading usage in `Local Models` mode
- switching to `OpenClaw CLI` mode and creating, editing, toggling, running, and deleting a task

To exercise the real VS Code extension host activation path, run:

```bash
npm run test:host
```

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

Built-in presets now carry actual guidance, not just labels:

| Preset | Use when | Recommended model | Output standard |
| --- | --- | --- | --- |
| `algorithm-helper` | algorithm problems, complexity analysis, edge cases | long-context reasoning or coding model | constraints first, approaches second, implementation last |
| `quantative-recorder` | ledgers, PnL breakdowns, fee and accounting checks | numerically stable reasoning model | balances/PnL/fees/anomalies before conclusions |
| `code-review-guard` | bugs, regressions, security, performance, test gaps | model that handles diffs and behavior well | findings first, with evidence and impact |
| `bug-hunter` | triage, minimal repro, debugging plans | log/trace-friendly debugging model | hypotheses, fastest repro, next probe |
| `refactor-planner` | staged refactors and migrations | long-context migration planning model | phased plan with rollback points and validation |
| `api-contract-writer` | schemas, error models, versioning, examples | schema- and compatibility-disciplined reasoning model | request/response/error/example set delivered together |

---

## Project Structure

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

## Status

- [x] Main webview chat workspace
- [x] AI Swarm cluster workspace
- [x] OpenClaw cron task management
- [x] 7-day / 30-day API usage dashboard
- [x] Preset-based agent creation flow
- [x] Primary smoke integration test
- [ ] More scenario-specific presets
- [ ] Continuous README and screenshot updates

---

## License

[MIT](../LICENSE) © 2026 OpenClaw
