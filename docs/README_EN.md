# OpenClaw Luna for VSCode

<div align="center">

<br />

<img src="../resources/icon.png" width="120" alt="OpenClaw Luna Logo" />

### Seamlessly use OpenClaw AI Agent capabilities in VSCode

(Public Alpha)

**VSCode extension supporting Agent management, cluster operations, and API usage monitoring**

[🇨🇳 中文](../../README.md) | [🇺🇸 English](README_EN.md)

[![VSCode](https://img.shields.io/badge/VSCode-%5E1.80.0-blue?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/openclaw/openclaw-vscode-luna?style=social)](https://github.com/openclaw/openclaw-vscode-luna)

[🇺🇸 📖 Documentation](https://docs.openclaw.ai) · [💬 Discussions](https://github.com/openclaw/openclaw-vscode-luna/discussions) · [🐛 Issue Tracker](https://github.com/openclaw/openclaw-vscode-luna/issues)

<br />

</div>

---

## ✨ Why Choose OpenClaw Luna?

> *"Make AI Agents a natural extension of your development workflow, not an additional burden."*

In modern development, we interact with code, documentation, and debugging information daily. However, traditional AI tools are often isolated, requiring context switching. **OpenClaw Luna deeply integrates AI capabilities into your development environment**.

OpenClaw Luna helps you:

- 🤖 **Seamless Agent Integration** — Directly chat with multiple AI Agents within VSCode
- 🖥️ **Intelligent Cluster Management** — Create Agent clusters for multi-Agent collaboration
- 📊 **Real-time Usage Monitoring** — Monitor API calls and token consumption
- ⚡ **Zero Context Switching** — Complete all functions within VSCode

---

## 🚀 Getting Started in 2 Minutes

### Installation

```bash
# Install from source (development mode)
git clone https://github.com/openclaw/openclaw-vscode-luna.git
cd openclaw-vscode-luna
npm install
npm run compile
```

### Configuration

1. Open VSCode Settings (`Ctrl+,`)
2. Search for "OpenClaw"
3. Configure the following key settings:

| Setting | Description | Default Value |
|--------|------|--------|
| `openclaw.gatewayUrl` | OpenClaw Gateway URL | `http://localhost:3344` |
| `openclaw.gatewayToken` | Gateway Authentication Token | - |
| `openclaw.defaultAgent` | Default Agent ID | `default` |

### Launch

```bash
# Development mode
npm run watch  # Watch for file changes
# Then press F5 to launch Extension Development Host
```

Or install the published version directly from VSCode Marketplace.

---

## 🎯 Core Features

### 🤖 Multi-Agent Management

- **Create/Edit/Delete Agents** — Support for multiple models (GPT-4, GPT-3.5, Claude, Kimi)
- **Custom System Prompts** — Set unique behaviors for each Agent
- **Real-time Status Monitoring** — Clear visibility of online/idle/offline status
- **Persistent Chat History** — All conversation history automatically saved

### 🖥️ Agent Cluster Functionality

| Feature | Description | Use Case |
|------|------|----------|
| Cluster Creation | Organize multiple Agents into clusters | Team collaboration, multi-role simulation |
| Broadcast Messages | Send messages to all Agents in a cluster | Parallel processing, multi-perspective analysis |
| Status Management | Monitor overall cluster status | Load balancing, fault detection |

### 📊 API Usage Monitoring

Built-in usage statistics:
- ✅ Real-time token consumption monitoring
- ✅ Usage analysis by model
- ✅ 7-day trend charts
- ✅ Cost estimation

### ⚡ Seamless Integration Experience

Multiple trigger methods:
- **Status Bar Button** — 🚀 OpenClaw button in bottom right corner
- **Keyboard Shortcut** — `Ctrl+Shift+O` to open panel
- **Command Palette** — `Ctrl+Shift+P` → "Open OpenClaw Luna"
- **Context Menu** — Right-click in editor → "Quick Chat"
- **Selected Code** — Select text then press `Ctrl+Shift+C`

---

## 🏗️ Architecture Overview

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

## 📦 Project Structure

```
openclaw-vscode/
├── src/
│   ├── extension.ts            # Extension entry point
│   ├── managers/               # Core managers
│   │   ├── agentManager.ts     # Agent management logic
│   │   ├── clusterManager.ts   # Cluster management logic
│   │   └── usageManager.ts     # Usage management logic
│   ├── providers/              # Tree view providers
│   │   ├── agentTreeProvider.ts # Agent tree view
│   │   ├── clusterTreeProvider.ts # Cluster tree view
│   │   └── usageTreeProvider.ts # Usage tree view
│   └── services/               # Service layer
│       └── openclawService.ts  # OpenClaw API service
├── resources/                  # Resource files
│   ├── icon.png                # Extension icon
│   └── icon.svg                # SVG icon
├── .vscode/                    # VSCode configuration
│   └── launch.json             # Debug configuration
├── package.json                # Extension metadata and scripts
└── tsconfig.json               # TypeScript configuration
```

---

## 🛣️ Roadmap

- [x] Basic Agent management functionality
- [x] Multi-Agent cluster support
- [x] API usage monitoring
- [x] Deep VSCode integration
- [ ] Webview custom interface
  - [ ] React-based UI
  - [ ] Theme adaptation
  - [ ] Interactive chat interface
- [ ] Advanced features
  - [ ] Agent template library
  - [ ] Code snippet integration
  - [ ] Intelligent suggestion system
- [ ] Performance optimization
  - [ ] Caching mechanism
  - [ ] Asynchronous loading
  - [ ] Memory optimization

---

## 🤝 Contribution Guidelines

We welcome all forms of contributions!

1. **Fork** this repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a **Pull Request**

Check the detailed [Contribution Guide](CONTRIBUTING.md) for standards.

---

## 📄 License

[MIT](LICENSE) © 2026 OpenClaw

---

<div align="center">

**[⬆ Back to Top](#openclaw-luna-for-vscode)**

Made with ❤️ and 💻 by [月と猫 - LunaNeko](https://github.com/openclaw)

</div>