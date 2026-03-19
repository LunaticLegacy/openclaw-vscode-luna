# OpenClaw 逻辑图（图论维护入口）

本文件是代码逻辑的“图论化入口说明”，对应的图文件为 `docs/logic-graph.dot`。

## 读图说明
- **节点（Node）**：代表一个功能模块或子系统。
- **边（Edge）**：代表模块间的调用、数据流、消息流或 IO 流。
- **边的标签**：用于区分 `HTTP`、`WebSocket`、`execFile`、`read/write`、`postMessage` 等流向。

## 覆盖范围（主模块）
- 扩展激活与运行时核心：`src/extension.ts`, `src/extension/runtime.ts`
- 面板与 Webview：`src/panels/openclawPanel.ts`, `src/panels/openclawPanel/*`, `media/js/*.js`
- 管理器层：`src/managers/*`
- 服务层：`src/services/*`
- IO 端点：HTTP/WS、文件系统、子进程、剪贴板

## 快速定位（关键数据流）
1. **激活流**：VS Code → `activate()` → `OpenClawExtensionRuntime` → providers/commands/statusbar
2. **UI 数据流**：Webview `postMessage` → `messageRouter` → `*Actions.ts` → managers/service → `postMessage` 回写
3. **网络 IO**：
   - Gateway 模式：`OpenClawService` → `GatewayTransport` → HTTP REST/stream
   - OpenClaw 模式：`OpenClawModeRuntime` → `OpenClawGatewayClient` → WebSocket
   - Local 模式：`LocalModeRuntime` → Provider HTTP
   - Channel/Skill Market：`ChannelSourceService` / `SkillMarketService` → 外部 API
4. **磁盘 IO**：
   - globalStorage：channels/agent-folders/clusters/tasks JSON
   - StateDir：`openclaw.json`、auth profiles、models、runtime logs
   - Workspace：`SYSTEM.md`、`IDENTITY.md`、agent settings
   - Export：runtime logs / cluster export

## 维护约定
- 当新增模块或改动 IO 路径时，需在 `docs/logic-graph.dot` 中新增节点/边。
- 当新增跨层数据流（例如 webview → service 新消息类型）时，需更新 `messageRouter` 对应边标签。

如需生成 SVG/PNG，可用 Graphviz：

```bash
# 生成 SVG
# dot -Tsvg docs/logic-graph.dot -o docs/logic-graph.svg
```
