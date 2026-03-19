import * as vscode from 'vscode';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { registerAgentCommands } from './agentCommands';
import { registerClusterCommands } from './clusterCommands';
import { registerPanelCommands } from './panelCommands';
import { registerTaskCommands } from './taskCommands';

/**
 * 注册所有命令
 * @param context - VSCode 扩展上下文
 * @param runtime - 扩展运行时实例
 * @returns 无返回值
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    registerPanelCommands(context, runtime);
    registerAgentCommands(context, runtime);
    registerClusterCommands(context, runtime);
    registerTaskCommands(context, runtime);
}
