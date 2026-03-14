# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.7.0] - 2026-03-14

### Added
- 
- 

### Fixed
- 
- 

## [0.6.1] - 2026-03-11

This version is a pre-release for v0.7.0, I think.

### Added
- Attempting to implement everything that mentioned in [P0.md](./P0.md).
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
