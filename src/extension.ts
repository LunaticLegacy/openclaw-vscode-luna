import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { OpenClawExtensionRuntime } from './extension/runtime';

let runtime: OpenClawExtensionRuntime | null = null;

/**
 * 激活 OpenClaw VS Code 插件。
 * 创建 OpenClawExtensionRuntime 实例，注册提供者、生命周期事件和命令，然后初始化插件。
 * 
 * @param context - VS Code 扩展上下文，用于访问扩展资源和注册订阅
 * @returns Promise<void>
 * 
 * @example
 * ```typescript
 * // 由 VS Code 在插件激活时自动调用
 * export function activate(context: vscode.ExtensionContext) {
 *     // 插件激活逻辑
 * }
 * ```
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 OpenClaw extension is now active!');

    runtime = await OpenClawExtensionRuntime.create(context);
    runtime.registerProviders();
    runtime.registerLifecycle();
    registerCommands(context, runtime); // 注册自定义指令
    await runtime.initialize(); // 初始化开始
}

/**
 * 停用 OpenClaw VS Code 插件。
 * 释放所有资源，清理运行时实例，并在控制台记录停用信息。
 * 
 * @returns void
 * 
 * @example
 * ```typescript
 * // 由 VS Code 在插件停用时自动调用
 * export function deactivate() {
 *     // 插件停用逻辑
 * }
 * ```
 */
export function deactivate() {
    console.log('👋 OpenClaw Luna extension is now deactivated');
    runtime?.dispose();
    runtime = null;
}
