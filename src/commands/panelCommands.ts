import * as vscode from 'vscode';
import { t } from '../i18n';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { resolveAgentId } from './helpers';

export function registerPanelCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.openPanel', () => {
            runtime.showPanel();
        }),
        vscode.commands.registerCommand('openclaw.quickChat', async () => {
            const agents = await runtime.agentManager.getAgents();

            if (agents.length === 0) {
                const action = await vscode.window.showInformationMessage(
                    t('quickChat.noAgents'),
                    t('quickChat.createAgent'),
                    t('quickChat.openPanel')
                );
                if (action === t('quickChat.createAgent')) {
                    await vscode.commands.executeCommand('openclaw.newAgent');
                } else if (action === t('quickChat.openPanel')) {
                    runtime.showPanel();
                }
                return;
            }

            const agentItems = agents.map(agent => ({
                label: `$(account) ${agent.name}`,
                description: agent.model,
                detail: t('quickChat.status', { status: agent.status }),
                agentId: agent.id
            }));

            const selectedAgent = await vscode.window.showQuickPick(agentItems, {
                placeHolder: t('quickChat.selectAgent')
            });

            if (!selectedAgent) {
                return;
            }

            const input = await vscode.window.showInputBox({
                prompt: t('quickChat.promptSendTo', {
                    name: selectedAgent.label.replace('$(account) ', '')
                }),
                placeHolder: t('quickChat.inputPlaceholder'),
                ignoreFocusOut: true
            });

            if (!input) {
                return;
            }

            try {
                const panel = runtime.showPanel();
                panel.setActiveAgent(selectedAgent.agentId);
                await panel.sendMessage(input, selectedAgent.agentId);
                vscode.window.showInformationMessage(t('quickChat.sent'));
            } catch (error) {
                vscode.window.showErrorMessage(t('quickChat.sendFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.chat', async (agentArg?: any) => {
            const agentId = resolveAgentId(agentArg);
            const panel = runtime.showPanel();

            if (agentId) {
                panel.setActiveAgent(agentId);
            }

            const editor = vscode.window.activeTextEditor;
            if (editor && editor.selection) {
                const selectedText = editor.document.getText(editor.selection);
                if (selectedText) {
                    panel.setInputText(selectedText);
                }
            }
        }),
        vscode.commands.registerCommand('openclaw.apiUsage', async () => {
            runtime.showPanel().showUsageDashboard();
        }),
        vscode.commands.registerCommand('openclaw.settings', () => {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'openclaw');
        }),
        vscode.commands.registerCommand('openclaw.sendMessage', async (message: string, agentId?: string) => {
            await runtime.showPanel().sendMessage(message, agentId);
        }),
        vscode.commands.registerCommand('openclaw.clearChat', async () => {
            const panel = runtime.getPanel();
            if (panel) {
                panel.clearChat();
                vscode.window.showInformationMessage(t('clearChat.cleared'));
            }
        }),
        vscode.commands.registerCommand('openclaw.refreshAgents', async () => {
            try {
                await runtime.agentManager.getAgents(true);
                runtime.sidebarTreeProvider.refresh();
                const panel = runtime.getPanel();
                if (panel) {
                    await panel.refreshAgents(false);
                }
                vscode.window.showInformationMessage(t('agents.refreshed'));
            } catch (error) {
                vscode.window.showErrorMessage(t('agents.refreshFailed', { error: String(error) }));
            }
        })
    );
}
