# OpenClaw Luna for VS Code

<div align="center">

<br />

<img src="../resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

# OpenClaw Luna

Early Access for OpenClaw Users

### The OpenClaw console for VS Code

**Use VS Code to complete the smallest OpenClaw loop first: connect, create an agent, send the first message, then decide whether you need Swarms, cron, and usage diagnostics.**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-0.5.2-111111)](../package.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)

[60-Second Setup](#60-second-setup) · [Feedback Path](#if-it-breaks-start-here) · [Connection Modes](#connection-modes) · [Tests](#tests) · [中文](../README.md)

<br />

<img src="../resources/screenshot-01.png" width="88%" alt="OpenClaw Luna screenshot 1" />

<p>
  <img src="../resources/screenshot-02.png" width="43.5%" alt="OpenClaw Luna screenshot 2" />
  <img src="../resources/screenshot-03.png" width="43.5%" alt="OpenClaw Luna screenshot 3" />
</p>

</div>

---

## Why Luna

> *"Luna is not another chat box. It is the OpenClaw control surface inside VS Code."*

If you already use OpenClaw and do not want to bounce between a CLI, browser, and scattered commands, Luna is the missing control surface. It keeps first-run setup, first chat success, and follow-up workflows like agents, Swarms, cron, and usage inside one VS Code panel.

It is built for two cases:

- You already use OpenClaw and want your daily control path back inside VS Code.
- You are new to OpenClaw and want one small success in under a minute before learning the full config model.

Once your workflow spans agent chat, Swarm collaboration, scheduled tasks, connection switching, and usage inspection, the problem is not a lack of entry points. The problem is fragmented context. Luna is built to compress those actions into one stable main path:

- Create agents, chat, switch models, and inspect context from one panel.
- Manage Swarms, broadcasts, collaboration, and cluster entry points inside one workspace.
- Inspect OpenClaw cron jobs, run them immediately, edit them, and debug them without leaving VS Code.
- See 7-day / 30-day requests, tokens, costs, and model distribution without jumping back to a CLI or browser.
- Make mode differences explicit so the UI does not degrade into hidden "works here but not there" behavior.

---

## 60-Second Setup

### 1. Install the extension from the marketplace

The extension has been published to the marketplace.

### 2. Open the Luna panel

You have three ways to access it:

- Command palette: `OpenClaw Luna: Open OpenClaw Luna`
- Status bar item in the bottom-right corner: `OpenClaw`
- Activity Bar sidebar: `OpenClaw`

### 3. Finish the first success before learning every mode

On first entry, the top-left `OpenClaw Luna` brand takes you back to the initial setup screen. Follow this shortest path first:

- Check whether local OpenClaw is installed
- Start the local `OpenClaw gateway`, or enter your remote Gateway
- Keep the default mode for now instead of optimizing `Auto Detect / Gateway / OpenClaw CLI / Local Models`
- Create your first agent
- Send your first message and confirm that Luna returns a result

### 4. Expand only after the first message works

After the first successful reply, go deeper only if you need it:

- Open `Swarm` if you want multi-agent collaboration
- Switch to `OpenClaw CLI` if you need scheduled tasks
- Open `Usage` if you want request, token, and cost inspection
- Edit `OpenClaw Config` or local model files if you need tighter control

For a first trial, "it connects, creates an agent, and sends one message" is enough.

---

## If It Breaks, Start Here

If Luna fails on the first run, the most useful feedback is not "it doesn't work". Send these three things instead:

- Which connection mode you used: `Auto Detect`, `Gateway`, `OpenClaw CLI`, or `Local Models`
- Which step failed: install, connect, create agent, send message, open tasks, or open usage
- The actual error text from the VS Code developer tools, output panel, or in-product message

Feedback links:

- Issues: <https://github.com/LunaticLegacy/openclaw-vscode-luna/issues>
- Repository: <https://github.com/LunaticLegacy/openclaw-vscode-luna>

That is enough to reproduce real failures and turn setup friction into actionable feedback.

---

## Core Features

### Agent Console

- Create, edit, delete, and refresh agents
- Create agents from built-in presets
- Configure custom models, system prompts, and workspaces
- Persist chat history automatically with streaming replies and live sync support where available

### Swarm Workspace

- Switch between `Broadcast / Collaborate / Member Chat` in one workspace
- Open clusters directly from the sidebar
- Add or remove agents from a cluster without leaving the workspace

### OpenClaw Cron

- Read OpenClaw cron jobs and run history directly from the task view
- Support `every / at / cron` schedules
- Create, edit, enable, disable, run now, and delete tasks
- Task support is only available in `OpenClaw CLI` mode

### Usage and Diagnostics

- Toggle between 7-day and 30-day windows
- Break usage down by day, tokens, requests, and cost
- Inspect model distribution and cost share
- Hover daily usage bars to see exact values
- Panel, sidebar, and service now share the same usage invalidation path, reducing stale-view drift

---

## Connection Modes

Luna supports four connection modes:

| Mode | Best for | Data source |
| --- | --- | --- |
| `Auto Detect` | Let Luna resolve the best local path automatically | Local environment probing |
| `Gateway` | Shared remote deployment for teams | OpenClaw Gateway |
| `OpenClaw CLI` | Full local OpenClaw workflow, including cron and live session sync | Local CLI + Gateway |
| `Local Models` | Run only against local model providers | `models.json` / `auth-profiles.json` |

### OpenClaw Config vs Local Models

- The `OpenClaw Config` card edits `openclaw.json`
- `Local Models` mode uses `models.json` and optional `auth-profiles.json`
- These are intentionally separate configuration surfaces, and Luna now enforces that capability boundary in both UI and runtime logic

---

## Capability Matrix

| Capability | Gateway | OpenClaw CLI | Local Models |
| --- | --- | --- | --- |
| Agent chat | Native | Native | Native |
| Agent settings editing | Yes | No | Yes |
| Swarm workspace | Remote clusters | Luna-managed workspace | Luna-managed workspace |
| Cluster persistence | Gateway | Workspace | Workspace |
| Scheduled tasks | No | Yes | No |
| Live session sync | No | Yes | No |
| Usage dashboard | Yes | Yes | Yes |

This table is not decorative. Commands, panel guards, and service behavior now all go through the same capability matrix instead of scattering `if mode` checks across the codebase.

---

## OpenClaw Flow

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

After the recent refactor, `OpenClawService` is now a facade instead of a God Object. Mode runtimes, usage mapping, local repositories, and transport are split out.

---

## Common Settings

| Setting | Description | Default |
| --- | --- | --- |
| `openclaw.configMode` | Connection mode | `auto` |
| `openclaw.gatewayUrl` | Gateway URL | `http://127.0.0.1:18789` |
| `openclaw.gatewayToken` | Gateway token | `""` |
| `openclaw.defaultAgent` | Default agent ID | `default` |
| `openclaw.cliPath` | OpenClaw CLI path | `""` |
| `openclaw.nodePath` | Node path | `""` |
| `openclaw.stateDir` | OpenClaw state directory | `""` |
| `openclaw.modelsPath` | Local Models config path | `""` |
| `openclaw.authProfilesPath` | Auth Profiles path | `""` |

---

## Tests

```bash
npm test
```

The current main-path smoke coverage includes:

- Extension activation and core command contributions
- Creating an agent, sending a message, and reading usage in `Local Models` mode
- Switching to `OpenClaw CLI` mode and creating an agent, sending a message, and reading usage
- Creating, editing, toggling, running, and deleting OpenClaw tasks
- OpenClaw config merge behavior and field preservation
- Usage model fallback and cache invalidation after mode/config changes

To run the real VS Code host path:

```bash
npm run test:host
```

---

## Project Structure

```text
openclaw-vscode-luna/
├── src/
│   ├── commands/          # Command registration and handlers
│   ├── extension/         # Composition root and runtime wiring
│   ├── managers/          # Agent / Cluster / Usage / Task managers
│   ├── panels/            # Webview panel and message bridge
│   ├── providers/         # Sidebar / Usage / Task tree providers
│   ├── services/          # Transport / Runtime / Config / CLI
│   ├── config/            # Agent presets
│   ├── test/              # Fixtures and smoke tests
│   └── utils/             # Capability / status / date helpers
├── media/                 # panel.html / panel.js / CSS / UI helpers
├── i18n/                  # Localized messages
├── docs/                  # English README
├── resources/             # Icons and other assets
└── package.json
```

---

## Status

- [x] OpenClaw panel and sidebar entry points
- [x] Agent management and preset-based creation
- [x] Swarm workspace
- [x] OpenClaw cron panel
- [x] OpenClaw Config UI
- [x] 7-day / 30-day usage dashboard
- [x] Main-path smoke tests
- [ ] More real extension-host UI regression coverage
- [ ] Ongoing screenshot and scenario documentation updates

---

## Contributing

Issues and PRs are welcome.

```bash
git checkout -b feature/your-change
npm test
git commit -m "Describe your change"
```

At minimum, keep the main-path smoke tests green before sending changes.

---

## License

[MIT](../LICENSE) © 2026 OpenClaw
