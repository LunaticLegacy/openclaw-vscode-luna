import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { OpenClawExtensionRuntime } from './extension/runtime';

let runtime: OpenClawExtensionRuntime | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 OpenClaw extension is now active!');

    runtime = await OpenClawExtensionRuntime.create(context);
    runtime.registerProviders();
    runtime.registerLifecycle();
    registerCommands(context, runtime);
    await runtime.initialize();
}

export function deactivate() {
    console.log('👋 OpenClaw Luna extension is now deactivated');
    runtime?.dispose();
    runtime = null;
}
