# LunaClaw

<div align="center">

<br />

<img src="../resources/openclaw_luna_animated_1to1.webp" width="120" alt="LunaClaw Logo" />

# LunaClaw

### A frontend/control surface for OpenClaw workflows (this repo ships the VS Code implementation)

**Connect OpenClaw, finish your first chat, then pull swarms, presets, import/export, skill hubs, and diagnostics into your main path.**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-0.8.0-111111)](../package.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)

[2-Minute Start](#2-minute-start) · [Workflow Features](#workflow-features) · [Current Scope](#current-scope) · [Troubleshooting](#common-problems--troubleshooting) · [中文](../README.md)

<br />

<img src="../resources/screenshot-01.png" width="88%" alt="LunaClaw screenshot 1" />

<p>
  <img src="../resources/screenshot-02.png" width="43.5%" alt="LunaClaw screenshot 2" />
  <img src="../resources/screenshot-03.png" width="43.5%" alt="LunaClaw screenshot 3" />
</p>

</div>

---

## What It Is

LunaClaw is a **frontend/control surface for OpenClaw workflows**. This repository provides the **VS Code implementation**.

> Naming note: the product is now officially **LunaClaw**, while the legacy name **OpenClaw Luna** remains for compatibility in docs, commands, and the ecosystem.

This is not another generic chat extension. It is a control surface that collapses OpenClaw into a single operational path:

- Finish your first chat
- Move into swarm collaboration and presets
- Bring import/export, skill hubs, diagnostics, and long-term memory into one stable workflow

If you only want a lightweight chat box, LunaClaw is not the intended solution.

---

## 2-Minute Start

### First Chat (shortest success path)

1. Install the `LunaClaw` VS Code extension.
2. Open the panel via `LunaClaw: Open LunaClaw` or the `OpenClaw` (legacy) sidebar icon.
3. Start a local `OpenClaw gateway` or enter a remote Gateway URL.
4. Create your first agent.
5. Send your first message.

The first win is simple: connect, create an agent, receive a reply.

### First Swarm (shortest collaboration path)

1. Open the Swarm workspace.
2. Create from a preset or add members manually.
3. Choose Broadcast or Collaborate.
4. Run a full collaboration round.

### Import / Export (shortest migration path)

1. Export the current Swarm structure as JSON.
2. Import a previously exported Swarm config.
3. Use a Swarm preset to spin up a new blueprint.

---

## Workflow Features

### Agents

- Create, edit, delete, and refresh agents
- Agent presets and batch creation
- Custom models, system prompts, and workspaces

### Swarms

- Switch between `Broadcast / Collaborate / Member Chat` in one workspace
- Member management, parent topology, and collaboration context
- Topology view and collaboration/broadcast switching

### Presets

- Swarm presets for fast blueprint creation
- Identity presets for member profiles

### Import / Export

- Swarm structure export as JSON
- Swarm config import and restore

### Skills

- Skill Market via remote hubs
- Separate Installed and Enabled views

### Memory / Persistence

- Target: a durable memory layer across machines and storage backends
- Currently in progress

---

## Current Scope

- VS Code frontend: available
- Swarm presets and import/export: available
- Skill Market remote hubs: available (continuing improvements)
- Persistent memory layer: in progress
- Onboarding / Doctor: in progress
- Tauri / desktop app: planned

---

## Common Problems / Troubleshooting

- `missing scope: operator.write`: ensure your Gateway token or auth profile includes `operator.write`.
- `gateway closed (1000)`: verify the Gateway process/port and restart with a matching version.
- Swarm import fails: confirm the JSON was exported from LunaClaw, not a preset file.
- Preset invalid: check JSON integrity and required fields.
- Skill Market not loading: check network/proxy settings or hub availability.
- Local models unavailable: verify `models.json` and `auth-profiles.json` paths.

When reporting issues, include the mode, the step that failed, and the raw error text.

---

## Connection Modes

| Mode | Best for | Data source |
| --- | --- | --- |
| `Auto Detect` | Let LunaClaw pick the best local path | Local environment probing |
| `Gateway` | Remote deployments and collaboration | OpenClaw Gateway |
| `OpenClaw CLI` | Full local OpenClaw workflow | Local CLI + Gateway |
| `Local Models` | Running only local model providers | `models.json` / `auth-profiles.json` |

### Config Boundaries

- `OpenClaw Config` edits `openclaw.json`
- `Local Models` mode uses `models.json` and optional `auth-profiles.json`
- These configuration surfaces remain separate

---

## Common Settings

| Setting | Description | Default |
| --- | --- | --- |
| `openclaw.configMode` | Connection mode | `openclaw` |
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

Main-path smoke coverage includes:

- Extension activation and core command contributions
- Creating an agent, sending a message, and reading usage in `Local Models` mode
- Switching to `OpenClaw CLI` mode and creating an agent, sending a message, and reading usage
- Creating, editing, toggling, running, and deleting OpenClaw tasks
- OpenClaw config merge behavior and field preservation
- Usage model fallback and cache invalidation after mode/config changes

For the full VS Code host path:

```bash
npm run test:host
```

---

## Project Structure

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

## Contributing

Issues and PRs are welcome.

```bash
git checkout -b feature/your-change
npm test
git commit -m "Describe your change"
```

---

## License

[MIT](../LICENSE) © 2026 OpenClaw
