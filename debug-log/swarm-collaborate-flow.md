# LunaClaw Swarm Collaborate Flow (Frontend + Backend)

This note summarizes how the **cluster swarm `collaborate` mode** is displayed in the panel UI and how messages flow between the webview and the extension backend.

## 1) Frontend UI + display (webview)

**Entry points / layout**
- The cluster workspace is in `media/panel.html` under `#cluster-workspace`, with message list `#cluster-messages`, mode tabs, and input `#cluster-message-input`.
- Layout/styling for swarm workspace is in `media/styleWorkspace.css` (`.cluster-*`).

**State + routing helpers**
- `media/js/panelClusterConversation.js` owns cluster selection state and routing keys:
  - `getCurrentClusterTargetInfo()` defines swarm vs agent view, selected run id, and output mode.
  - `getClusterConversationKey()` encodes `clusterId + mode + run + outputMode` into a cache key.
  - `ensureClusterConversation()` maintains per-view message cache, loading/pending flags.

**Workspace rendering**
- `media/js/panelClusterWorkspace.js` renders the swarm workspace:
  - `renderClusterWorkspace()` updates headers, tabs, topology and calls `ensureCurrentClusterConversationLoaded()` + `renderCurrentClusterConversation()`.
  - `ensureCurrentClusterConversationLoaded()` posts `loadClusterSwarmMessages` when target is swarm.
  - `renderCurrentClusterConversation()` decides **frontend** vs **raw** view.

**Frontend vs Raw view**
- Frontend view (default) groups messages into trace blocks:
  - `buildClusterConversationEntries()` groups by `displayName`, `contextLabel`, and `metadata.swarmBatchId`.
  - `shouldAppendToClusterTrace()` decides if assistant/tool messages belong in trace blocks.
- Raw view (collaborate only):
  - `isRawClusterSwarmView()` requires `target.kind === 'swarm'`, `mode === 'collaborate'`, `outputMode === 'raw'`.
  - `buildRawClusterConversationEntries()` shows each message as-is.

**User send (collaborate)**
- `media/js/panelChat.js` → `sendClusterMessage()`:
  - Adds local user message + `pending` state in the conversation cache.
  - Posts to backend:
    - `type: 'collaborateCluster'` when `target.kind === 'swarm' && target.mode === 'collaborate'`
    - `type: 'broadcastToCluster'` for broadcast.

**Incoming results → render**
- `media/js/panel.js` handles backend postMessage events:
  - `replaceSwarmMessages` → `replaceSwarmConversationMessages(...)` and re-render.
  - `setClusterSwarmContextLoading` toggles loading UI.
  - `clusterRunFailed` clears pending state.

## 2) Backend routing (extension)

**Webview message router**
- `src/panels/openclawPanel/messageRouter.ts`:
  - `collaborateCluster` → `context.handleCollaborate(clusterId, message)`
  - `loadClusterSwarmMessages` → `context.loadClusterSwarmMessages(...)`

**Panel orchestration**
- `src/panels/openclawPanel.ts`:
  - `_handleCollaborate()` calls `clusterActions.handleCollaborate()` and auto-saves swarm transcript.

## 3) Cluster actions (progress + UI message shaping)

**Start collaboration run**
- `src/panels/openclawPanel/clusterActions.ts` → `handleCollaborate(...)`:
  - Creates `swarmRunId` + token.
  - `initializeClusterSwarmProgress()`:
    - Builds a user message (with `metadata.swarmBatchId`) and persists via `clusterManager.replaceClusterSwarmMessages(...)`.
    - Posts `replaceSwarmMessages` with `keepPending: true`.
  - Calls `clusterManager.collaborateOnCluster(...)` with `onProgress` callback.

**Progress updates**
- `appendClusterSwarmProgressMessages(...)`:
  - Merges progress entries, dedupes by trace identity + content signature.
  - Persists via `replaceClusterSwarmMessages(...)` and re-posts `replaceSwarmMessages` (pending remains true).

**Final result**
- `finalizeClusterSwarmProgress(...)`:
  - Clears pending, persists and posts final `replaceSwarmMessages`.
- Errors:
  - Posts `clusterRunFailed` and `error` message to UI.

**Message shaping**
- `buildCollaborationConversationMessages(...)`:
  - Each round entry is converted to `PresentedChatMessage` with `displayName` (agent label) and `contextLabel` (round label).
  - Final synthesis is appended with `displayName = Final Answer` and `contextLabel = Coordinator: <agent>`.

**Raw log view**
- `loadClusterSwarmMessages(..., outputMode='raw')` (only for collaborate) calls:
  - `buildClusterSwarmRawLogMessages()` → merges per-agent swarm logs and decorates each message with phase/log kind (`Raw Log · <phase> · <kind>`).

## 4) ClusterManager (core swarm logic + send/receive)

**Collaboration execution** (`src/managers/clusterManager.ts`)
- `collaborateOnCluster(...)`:
  - `prepareCollaborationContext()` validates cluster, normalizes workspace config, builds activation plan, resolves coordinator, registers swarm run.
  - Runs `opening` → `critique/revision` loops (fixed rounds or unlimited w/ stop condition) → optional `synthesis`.
  - Emits `onProgress` events (round entries + synthesis) consumed by `clusterActions.handleCollaborate()`.

**Activation / eligibility**
- `resolveSwarmActivationPlan(...)` builds a hierarchical route using member profiles and parent agents.
- `isClusterAgentEligibleForSwarm(...)` filters by `activation.swarmModes` and optional keyword matching against `userMessage`.

**Send path (per agent)**
- `sendMessageToAgents()` / `sendHierarchicalMessages()` → `sendMessageToAgent()`:
  - Ensures session (`ensureDebateSession` / `ensureSwarmSession`) keyed by `clusterId + mode + swarmRunId + agentId`.
  - Builds `SwarmDeliveryContext` (phase, round, source/target agents, messageKind).
  - Uses `sendMessageWithTrace()` to send and collect trace from chat history diff.
  - Appends per-agent swarm logs with `appendClusterAgentSwarmMessages()`.

**Cluster-level swarm transcript**
- `replaceClusterSwarmMessages()` and `getClusterSwarmMessages()` store/read the **UI-ready** swarm transcript (managed by `clusterActions`).

**Run state**
- `registerSwarmRun`, `setSwarmRunPhase`, `finishSwarmRun`, `isSwarmRunActive` track swarm run lifecycle.

## 5) End-to-end message flow (collaborate)

1. User types in cluster input → `sendClusterMessage()` (webview).
2. Webview posts `{ type: 'collaborateCluster', clusterId, message }`.
3. `messageRouter` → `_handleCollaborate()` → `clusterActions.handleCollaborate()`.
4. `handleCollaborate()` initializes progress and posts `replaceSwarmMessages` (pending).
5. `clusterManager.collaborateOnCluster()` runs rounds and triggers `onProgress`.
6. Each progress update → `replaceSwarmMessages` (pending true).
7. Final synthesis → `replaceSwarmMessages` (pending cleared).
8. Frontend receives `replaceSwarmMessages` and `renderCurrentClusterConversation()` renders it.

---

Key files (fast reference):
- Frontend: `media/panel.html`, `media/js/panelChat.js`, `media/js/panelClusterWorkspace.js`, `media/js/panelClusterConversation.js`, `media/js/panel.js`
- Backend: `src/panels/openclawPanel/messageRouter.ts`, `src/panels/openclawPanel.ts`, `src/panels/openclawPanel/clusterActions.ts`, `src/managers/clusterManager.ts`
