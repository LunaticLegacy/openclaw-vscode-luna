# OpenClaw 斜杠命令树

## 会话管理
- **`/new` 或 `/reset [model]`**  
  启动新会话，清空历史（可指定模型）。
- **`/compact [instructions]`**  
  压缩上下文为摘要，释放空间（可附加指令）。
- **`/sessions list`**  
  列出所有会话。

## 状态与信息
- **`/status`**  
  查看当前模型、Token 用量及成本。
- **`/context [list/detail/json]`**  
  显示上下文详情及各部分 Token 占用。
- **`/whoami` 或 `/id`**  
  显示当前发送者 ID。
- **`/usage [off/tokens/full/cost]`**  
  控制或打印用量/成本信息。

## 模型与控制
- **`/model [name/list/status]`**  
  查看、切换或列出可用模型。
- **`/think [off/low/medium/high/xhigh]`**  
  设置思考强度。
- **`/verbose [on/off]`**  
  开启/关闭详细调试输出。
- **`/reasoning [on/off/stream]`**  
  控制模型推理过程是否显示。

## 权限与执行
- **`/elevated [on/off/ask/full]`**  
  切换提权模式（`full` 跳过审批）。
- **`/exec [host=...] [security=...] [ask=...]`**  
  精细控制执行环境、安全级别及询问策略。
- **`/approve <id> [allow-once/allow-always/deny]`**  
  批准或拒绝操作请求。
- **`/allowlist [add/remove]`**  
  管理命令执行白名单。

## 子代理管理
- **`/subagents [list/stop/log/info/send]`**  
  列出、停止、查看日志或向子 Agent 发送指令。

## 工具与技能
- **`/skill <name> [input]`**  
  运行指定技能。
- **`/bash <command>` 或 `! <command>`**  
  在主机上执行 Shell 命令（需启用 `commands.bash`）。

## 媒体与其他
- **`/tts [off/always/inbound/tagged/status]`**  
  控制文本转语音功能。
- **`/stop`**  
  立即停止当前任务。
- **`/help` 或 `/commands`**  
  显示所有斜杠命令。
- **`/config [show/get/set/unset]`**  
  读取或修改持久化配置（需启用 `commands.config`）。

## 通道切换（Docks）
- **`/dock-telegram` 或 `/dock_telegram`**  
  切换回复到 Telegram。
- **`/dock-discord` 或 `/dock_discord`**  
  切换回复到 Discord。
- **`/dock-slack` 或 `/dock_slack`**  
  切换回复到 Slack。