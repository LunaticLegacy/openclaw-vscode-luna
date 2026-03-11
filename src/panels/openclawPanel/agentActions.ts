import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { AgentManager } from '../../managers/agentManager';
import { isDuplicateAgentNameError } from '../../managers/agentManager';
import type { OpenClawBooleanCapabilityId } from '../../services/openclawService';
import { getCapabilityUnavailableMessage } from '../../utils/capabilitySupport';
import { runWithNotificationProgress, showSuccessStatus } from '../../utils/statusFeedback';

interface AgentActionContext {
    agentManager: AgentManager;
    postMessage(message: Record<string, unknown>): void;
    ensureCapability(capabilityId: OpenClawBooleanCapabilityId): boolean;
    loadAgents(): Promise<void>;
    getCurrentAgentId(): string | null;
    setCurrentAgentId(agentId: string | null): void;
    setCurrentSessionId(sessionId: string | null): void;
}

export async function handleCreateAgent(context: AgentActionContext, data: any): Promise<void> {
    const agentName = typeof data?.name === 'string' ? data.name.trim() : '';
    context.postMessage({
        type: 'agentMutationState',
        action: 'create',
        pending: true,
        agentName
    });

    const progressAgentName = agentName || 'agent';
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: t('agent.operationCreating', { name: progressAgentName }),
            cancellable: false
        },
        async () => {
            try {
                await context.agentManager.createAgent(data);
                await context.loadAgents();
                context.postMessage({
                    type: 'agentMutationState',
                    action: 'create',
                    pending: false,
                    success: true,
                    agentName
                });
            } catch (error) {
                if (isDuplicateAgentNameError(error)) {
                    vscode.window.showWarningMessage(error.message);
                }
                context.postMessage({
                    type: 'agentMutationState',
                    action: 'create',
                    pending: false,
                    success: false,
                    agentName,
                    error: String(error)
                });
                context.postMessage({
                    type: 'error',
                    message: isDuplicateAgentNameError(error)
                        ? error.message
                        : t('newAgent.createFailed', { error: String(error) })
                });
            }
        }
    );
}

export async function handleDeleteAgent(context: AgentActionContext, agentId: string): Promise<void> {
    context.postMessage({
        type: 'agentMutationState',
        action: 'delete',
        pending: true,
        agentId
    });

    try {
        await context.agentManager.deleteAgent(agentId);
        if (context.getCurrentAgentId() === agentId) {
            context.setCurrentAgentId(null);
            context.setCurrentSessionId(null);
            context.postMessage({ type: 'clearChat' });
            context.postMessage({ type: 'setActiveAgent', agentId: null });
        }
        await context.loadAgents();
        context.postMessage({
            type: 'agentMutationState',
            action: 'delete',
            pending: false,
            success: true,
            agentId
        });
    } catch (error) {
        context.postMessage({
            type: 'agentMutationState',
            action: 'delete',
            pending: false,
            success: false,
            agentId,
            error: String(error)
        });
        context.postMessage({
            type: 'error',
            message: t('panel.failedDeleteAgent', { error: String(error) })
        });
    }
}

export async function handleSaveAgentSettings(context: AgentActionContext, agentId: string, settings: any): Promise<void> {
    if (!context.ensureCapability('agentEditing')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('agentEditing'));
        return;
    }

    try {
        await runWithNotificationProgress(t('progress.savingAgentSettings'), async () => {
            const agent = await context.agentManager.updateAgent(agentId, settings);
            context.postMessage({
                type: 'agentSaved',
                agent
            });
            await context.loadAgents();
        });
        showSuccessStatus(t('agentSettings.saved'));
    } catch (error) {
        vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
    }
}

export async function handleOpenAgentSettings(context: AgentActionContext, agentId: string): Promise<void> {
    try {
        const agent = await context.agentManager.getAgent(agentId);
        if (!agent) {
            context.postMessage({
                type: 'error',
                message: t('agent.notFound')
            });
            return;
        }

        context.postMessage({
            type: 'showAgentSettings',
            agent
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('agentSettings.saveFailed', { error: String(error) })
        });
    }
}

export async function handleOpenAgentFolder(context: AgentActionContext, agentId: string): Promise<void> {
    try {
        const agent = await context.agentManager.getAgent(agentId);
        if (!agent) {
            vscode.window.showErrorMessage(t('agent.notFound'));
            return;
        }

        let folderPath: string | undefined;

        if (agent.workspacePath) {
            folderPath = agent.workspacePath;
        } else {
            const config = vscode.workspace.getConfiguration('openclaw');
            const agentsRoot = config.get<string>('agentsRootPath');
            if (agentsRoot) {
                folderPath = `${agentsRoot}/${agentId}`;
            }
        }

        if (!folderPath) {
            vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
            return;
        }

        const folderUri = vscode.Uri.file(folderPath);

        try {
            await vscode.workspace.fs.stat(folderUri);
        } catch {
            await vscode.workspace.fs.createDirectory(folderUri);
        }

        await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
            forceNewWindow: false
        });
    } catch (error) {
        vscode.window.showErrorMessage(t('agentSettings.openFolderFailed', { error: String(error) }));
    }
}
