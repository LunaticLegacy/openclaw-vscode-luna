import * as vscode from 'vscode';
import { t } from '../i18n';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { Agent } from '../services/openclawService';
import { isDuplicateAgentNameError } from '../managers/agentManager';
import { showSuccessStatus } from '../utils/statusFeedback';
import { getCapabilityUnavailableMessage, isServiceCapabilityAvailable } from '../utils/capabilitySupport';
import { pickAgentPreset, resolveAgentId } from './helpers';

export function registerAgentCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.newAgent', async () => {
            const selectedPreset = await pickAgentPreset();
            if (selectedPreset === undefined) {
                return;
            }

            const enteredName = await vscode.window.showInputBox({
                prompt: t('newAgent.promptName'),
                placeHolder: selectedPreset?.defaultName || t('newAgent.placeholderName'),
                value: selectedPreset?.defaultName || ''
            });

            const name = enteredName?.trim();
            if (!name) {
                return;
            }

            const availableModels = await runtime.service.getAvailableModels();
            let model: string | undefined;

            if (availableModels.length > 0) {
                const selectedModel = await vscode.window.showQuickPick(
                    [
                        ...availableModels.map(modelName => ({
                            label: modelName
                        })),
                        {
                            label: t('newAgent.customModelOption'),
                            description: t('newAgent.customModelDescription')
                        }
                    ],
                    {
                        placeHolder: t('newAgent.selectModel')
                    }
                );

                if (selectedModel?.label === t('newAgent.customModelOption')) {
                    model = await vscode.window.showInputBox({
                        prompt: t('newAgent.promptModel'),
                        placeHolder: availableModels[0] || t('newAgent.placeholderModel'),
                        ignoreFocusOut: true
                    });
                } else {
                    model = selectedModel?.label;
                }
            } else {
                model = await vscode.window.showInputBox({
                    prompt: t('newAgent.promptModel'),
                    placeHolder: t('newAgent.placeholderModel'),
                    ignoreFocusOut: true
                });
            }

            model = model?.trim();
            if (!model) {
                return;
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: t('agent.operationCreating', { name }),
                    cancellable: false
                }, async () => {
                    await runtime.agentManager.createAgent({
                        name,
                        model,
                        systemPrompt: selectedPreset?.systemPrompt || t('newAgent.defaultSystemPrompt'),
                        presetId: selectedPreset?.id
                    });
                });

                showSuccessStatus(t('newAgent.created', { name }));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                if (isDuplicateAgentNameError(error)) {
                    vscode.window.showWarningMessage(error.message);
                    return;
                }
                vscode.window.showErrorMessage(t('newAgent.createFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.manageAgents', async () => {
            const agents = await runtime.agentManager.getAgents();
            const items = agents.map(agent => ({
                label: agent.name,
                description: agent.model,
                detail: agent.id,
                agent
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: t('manageAgents.selectAgent')
            });

            if (!selected) {
                return;
            }

            const action = await vscode.window.showQuickPick([
                { label: t('manageAgents.actionChat'), action: 'chat' },
                { label: t('manageAgents.actionEdit'), action: 'edit' },
                { label: t('manageAgents.actionDelete'), action: 'delete' },
                { label: t('manageAgents.actionDetails'), action: 'details' }
            ], {
                placeHolder: t('manageAgents.selectAction')
            });

            if (action) {
                await handleAgentAction(action.action, selected.agent);
            }
        }),
        vscode.commands.registerCommand('openclaw.deleteAgent', async (agentArg: any) => {
            const agentId = resolveAgentId(agentArg);
            if (!agentId) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                t('agent.deleteConfirm', { agentId }),
                { modal: true },
                t('common.delete')
            );

            if (confirm !== t('common.delete')) {
                return;
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: t('agent.operationDeleting', { name: agentId }),
                    cancellable: false
                }, async () => {
                    await runtime.agentManager.deleteAgent(agentId);
                });
                showSuccessStatus(t('agent.deleted'));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('agent.deleteFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.editAgent', async (agentArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'agentEditing')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('agentEditing'));
                return;
            }

            const agentId = resolveAgentId(agentArg);
            if (!agentId) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            try {
                const agent = await runtime.agentManager.getAgent(agentId);
                if (!agent) {
                    vscode.window.showErrorMessage(t('agent.notFound'));
                    return;
                }

                const newName = await vscode.window.showInputBox({
                    prompt: t('agent.editName'),
                    value: agent.name
                });

                if (newName === undefined) {
                    return;
                }

                const newPrompt = await vscode.window.showInputBox({
                    prompt: t('agent.editPrompt'),
                    value: agent.systemPrompt
                });

                if (newPrompt === undefined) {
                    return;
                }

                await runtime.agentManager.updateAgent(agentId, {
                    name: newName,
                    systemPrompt: newPrompt
                });

                showSuccessStatus(t('agent.updated'));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('agent.editFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.openAgentFolder', async (agentArg: any) => {
            const agentId = resolveAgentId(agentArg);
            if (!agentId) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            try {
                const agent = await runtime.agentManager.getAgent(agentId);
                if (!agent) {
                    vscode.window.showErrorMessage(t('agent.notFound'));
                    return;
                }

                const folderPath = await runtime.service.resolveAgentFolderPath(agent);
                if (!folderPath) {
                    vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
                    return;
                }

                const folderUri = vscode.Uri.file(folderPath);
                try {
                    await vscode.workspace.fs.stat(folderUri);
                } catch {
                    vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
                    return;
                }

                await vscode.commands.executeCommand('revealFileInOS', folderUri);
            } catch (error) {
                vscode.window.showErrorMessage(t('agentSettings.openFolderFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.openAgentSettings', async (agentArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'agentEditing')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('agentEditing'));
                return;
            }

            const agentId = resolveAgentId(agentArg);
            if (!agentId) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            try {
                const agent = await runtime.agentManager.getAgent(agentId);
                if (!agent) {
                    vscode.window.showErrorMessage(t('agent.notFound'));
                    return;
                }

                runtime.showPanel().showAgentSettings(agent);
            } catch (error) {
                vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.saveAgentSettings', async (agentId: string, settings: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'agentEditing')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('agentEditing'));
                return;
            }

            try {
                await runtime.agentManager.updateAgent(agentId, settings);
                showSuccessStatus(t('agentSettings.saved'));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
            }
        })
    );
}

async function handleAgentAction(action: string, agent: Agent): Promise<void> {
    switch (action) {
        case 'chat':
            await vscode.commands.executeCommand('openclaw.chat', agent.id);
            break;
        case 'edit':
            await vscode.commands.executeCommand('openclaw.editAgent', agent.id);
            break;
        case 'delete':
            await vscode.commands.executeCommand('openclaw.deleteAgent', agent.id);
            break;
        case 'details':
            vscode.window.showInformationMessage(t('agent.details', {
                name: agent.name,
                id: agent.id,
                model: agent.model,
                status: agent.status,
                created: new Date(agent.createdAt).toLocaleString()
            }));
            break;
    }
}
