# OpenClaw Luna for VS Code

<div align="center">

<br />

<img src="../resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

# OpenClaw Luna

### The OpenClaw console for VS Code

**Keep agents, AI Swarms, OpenClaw cron, connection switching, and 7/30-day usage inside one panel instead of scattering them across commands.**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-0.4.0-111111)](../package.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)

[Quick Start](#5-minute-setup) · [Connection Modes](#connection-modes) · [Capability Matrix](#capability-matrix) · [Tests](#tests) · [中文](../README.md)

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

Once your workflow spans agent chat, Swarm collaboration, scheduled tasks, connection switching, and usage inspection, the problem is not a lack of entry points. The problem is fragmented context. Luna is built to compress those actions into one stable main path:

- Create agents, chat, switch models, and inspect context from one panel.
- Manage Swarms, broadcasts, collaboration, and cluster entry points inside one workspace.
- Inspect OpenClaw cron jobs, run them immediately, edit them, and debug them without leaving VS Code.
- See 7-day / 30-day requests, tokens, costs, and model distribution without jumping back to a CLI or browser.
- Make mode differences explicit so the UI does not degrade into hidden "works here but not there" behavior.

---

## 5-Minute Setup

### 1. Clone and install

```bash
git clone https://github.com/LunaticLegacy/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
```

### 2. Compile and launch the extension host

```bash
npm run compile
npm run watch
```

Then press `F5` in VS Code to open the `Extension Development Host`.

### 3. Open Luna

There are three main entry points:

- The `OpenClaw` activity bar icon
- The command palette entry `OpenClaw: Open Panel`
- The bottom-right `OpenClaw` status bar item

On first entry, the top-left `OpenClaw Luna` brand takes you back to the initial setup screen. From there you can:

- Check whether local OpenClaw is installed
- Start the local `OpenClaw gateway` directly
- Edit `OpenClaw Config` without leaving Luna
- Switch between `Auto Detect / Gateway / OpenClaw CLI / Local Models`

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
