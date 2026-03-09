import * as vscode from 'vscode';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { registerAgentCommands } from './agentCommands';
import { registerClusterCommands } from './clusterCommands';
import { registerPanelCommands } from './panelCommands';
import { registerTaskCommands } from './taskCommands';

export function registerCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    registerPanelCommands(context, runtime);
    registerAgentCommands(context, runtime);
    registerClusterCommands(context, runtime);
    registerTaskCommands(context, runtime);
}
