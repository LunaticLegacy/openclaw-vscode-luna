# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.8.2] - 2026-03-26

### Added
- SWARM: Added live swarm-session reconstruction for `collaborate/frontend`, so the view can rebuild the visible result flow from agent swarm sessions instead of relying only on aggregate swarm snapshots.
- SWARM: Added per-agent collaborate session rendering for both inputs and outputs inside agent subviews.
- SWARM & UI/UX: Added a hard refresh action for swarm workspace views, forcing a full swarm reload path instead of only repainting the current panel.
- SWARM & UI/UX: Added tool-call duration badges in live swarm/chat rendering.
- SWARM & UI/UX: Added an empty-state `Import Swarm JSON` entry point, so a new swarm can be created directly from exported swarm JSON even when no swarm is currently open.

### Changed
- SWARM & UI/UX: Updated collaborate run labels to show clearer run metadata instead of ambiguous `Run 1 / Run 2 / Run 3` style labels.
- CHAT & UI/UX: Changed the chat toolbar default state to collapsed.

### Fixed
- SWARM: Fixed swarm export so it respects the selected run instead of exporting every run indiscriminately.
- SWARM: Fixed missing source attribution in collaborate/frontend for swarm messages and trace segments.
- SWARM: Fixed collaborate rendering so tool calls and tool results can reconcile in place during live updates instead of staying stuck in a pending state after interleaved agent messages.
- SWARM: Fixed collaborate/frontend rendering so assistant output, tool calls, and tool results all participate in the reconstructed session flow.
- SWARM: Fixed collapse/expand stutter in the swarm workspace header.
- SWARM: Fixed several TypeScript compile blockers in cluster commands, agent tree sorting, RSS parsing, and outbound type imports; `npm run compile` now passes again.

## [0.8.1] - 2026-03-20

THIS IS AN EMERGENCY FIX FOR [0.8.0](#080---2026-03-19), WHICH IS LITERALLY AN UNTESTED VERSION. SORRY FOR THIS FAULT.

### Added
- UI/UX:
    - Collapse and expand the Agent Swarm table.
    - Skill market now has a simple animation while loading.
- CHAT: Added the ability of exploring Subagent in Chat.
- SWARM: Now the record is separable. The new topic will NOT use the older topic's information.
    - Which meant the swarm's record will be more clear, and you should let those agents remember information MANUALLY.

### Changed
- SWARM: Changed the basic logic of Agent Swarm.
- MARKET: Changed the Skill Market's downloading location, which will use OpenClaw's local folders for skills.
    - Which meant this plugin can modify AI Skill in it.

### Fixed
- SWARM: Fixed the issue of the agent swarm not working properly at: https://github.com/LunaticLegacy/openclaw-vscode-luna/issues/24
    - This issue is REALLY, LITERALLY annoying and making user experience in Swarm extremely bad.

## [0.8.0] - 2026-03-19

### Added
- File-based swarm presets and identity presets with bundled + user preset loading support.
- Per-member “Use Preset Identity” selector in the cluster editor, with preset application behavior.
- Export Swarm JSON for saving the current swarm structure.
- Import Swarm JSON to restore a previously exported swarm configuration into the editor.
- Agent folder support in the sidebar, including ungrouped bucket and folder expand/collapse persistence.
- Cluster agent creation queue to allow batch creation without blocking the New Agent button.
- Topology view improvements (tree layout, SVG connectors, and scroll support).
- Swarm-aware outbound send reliability layer with queueing, retries, delivery state tracking, and orchestration events.

### Changed
- Cluster creation from presets now loads preset definitions from JSON files instead of hardcoded lists.
- Cluster refresh flow now also refreshes clusters when agents are refreshed.
- Cluster editor modal layout refresh with unified header shell styling.
- New Agent modal and Skill Market modal redesigned to match the Swarm editor visual language.
- Skill Market now pulls listings from SkillsLLM and Tencent SkillHub APIs with hub-aware normalization and generic hub copy.

### Fixed
- Swarm stop handling now properly aborts all agent runs and swarm sessions.
- Swarm progress refresh and context streaming reliability in the collaborate view.
    - Sidebar i18n keys and view titles rendering issues.
    - Main panel loading stall during agent/cluster view initialization.
- Cluster member picker UX now uses a single, coherent selection model.
- Cluster editor “Unlimited rounds” control alignment and layout consistency.

## [0.7.2] - 2026.3.15

### Added
- Support the unlimited round for Agent Swarm (with the stop condition).

### Fixed
- Fixed the problem of `ERRCOMMANDTOOLONG` directly via `Node.js` in Windows.

## [0.7.1] - 2026-03-14

### Added
- Support custom Swarm workflows.
- Added `Replay` and time tracking for swarm conversation.

### Fixed
- Fixed the issue of chat record lost when using Swarm.

### Unfixed
- Unfixed the issue that there's NO ISSUE in the GitHub Repo.

## [0.7.0] - 2026-03-14

### Added
- Added cluster conversation export for both swarm-level and per-agent views, with readable Markdown and raw JSON bundles.
- Added runtime log export with recursive log collection, cron capture, and automatic secret redaction for release diagnostics.
- Added richer cluster and agent management flows, including inline agent creation inside cluster setup, batch agent creation, and agent add/remove actions for existing clusters.

### Fixed
- Fixed swarm progress rendering so broadcast/collaborate runs stream intermediate agent outputs into the panel instead of updating only after completion.
- Fixed cluster agent chat persistence so dedicated swarm conversations survive view switches, and `/new` plus `/clear` reset the right session state.
- Fixed cluster execution robustness with member activation filters, configured coordinator support, and timeout handling for stalled agent replies.

## [0.6.1] - 2026-03-11

This version was the pre-release milestone on the way to v0.7.0.

### Added
- Skill Market enabled.
- Agent Folder enabled.
- Agent Swarm's chat record is exportable now.

### Fixed
- Fixed the light bulb's function at sidebar.
- Fixed the issue of chat record lost when using Swarm.

## [0.6.0] - 2026-03-11

### Added
- UI/UX behaviour improment. Now all the time-costing behaviour will have a tip.
- Enable agent editing in OpenClaw mode.
- Wire real run abort across runtimes, make imported channels writable/chat-capable.
- 2 more preset agents: docs-editor and test-author.

### Fixed
- Patched malfunctioning of **Stop** button.
    - **Stop** button will finally REALLY work.
- UI/UX rendering error in Agent scene.
- Rearranged codes' structure.

## [0.5.2] - 2026-03-10

### Added
- **Stop** button in chat.

### Fixed
- Optimize the frontend behaviour to have a better experience for using.
    - Added some notice while the Agent using the tool.

## [0.5.1] - 2026-03-10

### Added
- Optimize (some of) preset agents' behaviour. Their performance will be better... maybe. (this still wip 'cause `0.5.1` is an emergency fix)
- Optimize behaviour of Swarm.

## [0.5.0] - 2026-03-09

### Added
- Added the documented OpenClaw auth-provider catalog to the setup panel, including built-in provider choices and support for custom entries.
- Added provider-aware default model suggestions for OpenClaw setup, so the `Default Model` field updates with the selected `Auth Provider` while still allowing custom models.

### Fixed
- Fixed the OpenClaw `Auth Provider` control by replacing the fragile datalist flow with stable select-based inputs in the settings panel.

## [0.4.0] - 2026-03-09

### Added
- Added an in-panel OpenClaw setup flow with runtime diagnostics, one-click gateway startup, and an editor for key `openclaw.json` fields.
- Added an explicit capability matrix for `Auto Detect`, `Gateway`, `OpenClaw CLI`, and `Local Models`, so the UI can explain what is available in each mode.
- Added shared usage helpers and new smoke coverage for manifest alignment, local/OpenClaw chat flows, scheduled tasks, and config merge behavior.
- Added host-test scaffolding, refreshed README content, and new screenshots for the 0.4.0 control-panel workflow.

### Changed
- Reworked Luna into a more complete OpenClaw control console for agents, clusters, scheduled tasks, connection switching, and usage inspection.
- Refactored the extension runtime and service layer by splitting commands, mode runtimes, transport, usage mapping, and local session persistence into dedicated modules.
- Improved the first-run experience with clearer setup guidance and a clearer boundary between `OpenClaw Config` and `Local Models`.
- Expanded the usage experience with 7-day / 30-day windows, model-level breakdowns, and a shared refresh path across the panel, sidebar, and services.

### Fixed
- Fixed OpenClaw config saves so unrelated fields are preserved and optional values can be cleared safely.
- Fixed mode-aware actions so unsupported operations are blocked consistently instead of failing later inside the workflow.
- Fixed stale usage and task state after configuration or mode changes by invalidating caches and reloading the main views together.
- Fixed usage attribution when session data omits the resolved model name.

## [0.3.0] - 2026-03-09

### Added
- NEW FEAT: Added preset agents.

### Fixed
- Let refreshing can be used in main panel.
- Let refreshing can be used in scheduled mission in the side-panel.

## [0.2.2] - 2026-03-09

### Fixed
- Added the guiding method to user, optimize first-using experience.

## [0.2.1] - 2026-03-09

### Fixed
- Optimize frontend behaviour.

## [0.2.0] - 2026-03-08

### Added
- Added feature of scheduled mission for Agents.
- Remade the frontend behaviour of cluster.

## [0.1.1] - 2026-03-07

### Fixed
- Optimize frontend behaviour.


## [0.1.0] - 2026-03-07

### Added
- Initial VS Code extension release for OpenClaw Luna.
- Agent sidebar, main panel, cluster/swarm, i18n, and Markdown rendering support.

### Fixed
- Webview loading and initialization issues.
- User message rendering, metadata stripping, and streaming behavior.
- Cluster actions consistency across sidebar and main panel.
