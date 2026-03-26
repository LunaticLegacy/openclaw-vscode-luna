# Swarm Collaborate 显示异常原因分析

目标问题：
P1：协作界面只能输出部分 agent 的输出内容。
P2：已明确指定与主控端通信的 LLM 后，仍有不与主控端直接通信的 agent 信息出现在协作界面。

## 结论速览
P1 的根因不是单一，而是“协作激活过滤 + 层级路由阻断 + 运行中止/停止条件 + UI 过滤”共同决定哪些 agent 会参与并被渲染。
P2 是当前设计行为：协作界面会展示所有参与协作轮次的 agent 贡献，而不是只展示“直接与主控端通信”的 agent。主控端只影响最终 synthesis 的“协调者”标签。

## P1：为何只显示部分 agent 输出

1. 协作激活过滤（成员不一定被唤醒）
`src/managers/clusterManager.ts` → `resolveSwarmActivationPlan(...)` / `isClusterAgentEligibleForSwarm(...)`。
当 `activation.swarmModes` 不包含 `collaborate`，或 `activation.keywords` 未命中 `userMessage` 时，该成员不会进入 `activationPlan.orderedAgentIds`，因此不会发送消息，也不会在协作界面出现。

2. 层级路由阻断（父节点失败会阻断子节点）
`src/managers/clusterManager.ts` → `sendHierarchicalMessages(...)`。
只有当前节点 `result.ok` 才会递归访问子节点。父节点失败或被取消会阻断整个子树，导致部分 agent 无输出。

3. 运行中止或停止条件提前结束
`src/managers/clusterManager.ts` → `isSwarmRunActive(...)`、`runUnlimitedDebateRounds(...)`、`runFixedDebateRounds(...)`。
用户取消、`successfulAgentIds` 为空、或 stop condition 命中，会提前结束后续轮次，导致只看到部分 agent 输出。

4. UI 侧过滤（空内容 / 权限错误）
`src/panels/openclawPanel/clusterActions.ts` → `buildConversationMessagesForEntry(...)`。
权限缺失（`missing scope: operator.*`）会直接丢弃该条记录。
`media/js/panelMessageRender.js` → `shouldHideMessage(...)`。
user/assistant 消息内容为空会被隐藏，导致“执行过”但 UI 不显示。

## P2：为何非直连主控端的 agent 仍会出现在协作界面

1. 协作界面展示的是“所有参与 round 的贡献”
`src/panels/openclawPanel/clusterActions.ts` → `buildCollaborationConversationMessages(...)`。
该函数逐轮遍历 `result.rounds`，将每个 round 的 `entries` 全量转为可视消息。协调者只影响 final answer 的 `displayName/contextLabel`。
因此，即使某些 agent 不是直接与主控端对话，它们仍会作为 round 贡献者出现在协作界面。

2. Raw Log 模式合并全体 agent 的 swarm 日志
`src/panels/openclawPanel/clusterActions.ts` → `buildClusterSwarmRawLogMessages(...)`。
对 `cluster.agentIds` 全量合并 `getClusterAgentSwarmMessages(...)`，不会按“主控端直连”过滤。

## 行为映射（简版）
谁会被“协作唤醒”：`resolveSwarmActivationPlan(...)` + `isClusterAgentEligibleForSwarm(...)`。
谁会被“执行并产出”：`sendHierarchicalMessages(...)` 受到父子链路 ok 状态影响。
谁会被“展示”：`buildCollaborationConversationMessages(...)` 全量展示 round entries；raw view 由 `buildClusterSwarmRawLogMessages(...)` 全量合并。

## 结论建议
若你希望协作界面只展示“直接与主控端通信”的 agent，需要在以下任意层增加过滤：
- 在 `clusterManager` 层只保留 direct 路由节点进入 `rounds.entries`。
- 在 `clusterActions.buildCollaborationConversationMessages(...)` 过滤 entry，例如仅保留 `activation.parentId === null` 的成员。
- 在 raw log 构建处剔除非 direct 成员。
