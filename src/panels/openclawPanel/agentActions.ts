import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { AgentManager } from '../../managers/agentManager';
import { isDuplicateAgentNameError } from '../../managers/agentManager';
import type { OpenClawBooleanCapabilityId } from '../../services/openclawService';
import { getCapabilityUnavailableMessage } from '../../utils/capabilitySupport';
import { runWithNotificationProgress, showSuccessStatus } from '../../utils/statusFeedback';

/**
 * Context interface for agent action operations
 */
interface AgentActionContext {
    agentManager: AgentManager;
    postMessage(message: Record<string, unknown>): void;
    ensureCapability(capabilityId: OpenClawBooleanCapabilityId): boolean;
    loadAgents(): Promise<void>;
    getCurrentAgentId(): string | null;
    setCurrentAgentId(agentId: string | null): void;
    setCurrentSessionId(sessionId: string | null): void;
}

/**
 * Handles creating a new agent
 * @param context - The agent action context
 * @param data - The agent creation data
 */
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

/**
 * Handles creating multiple agents in batch
 * @param context - The agent action context
 * @param data - The batch creation data containing agent configurations
 */
export async function handleCreateAgentsBatch(
    context: AgentActionContext,
    data: { agents?: Array<{ name?: string; model?: string; systemPrompt?: string; presetId?: string; enabledSkills?: string[] }> }
): Promise<void> {
    const requestedAgents = Array.isArray(data?.agents) ? data.agents : [];
    const normalizedAgents = requestedAgents
        .map(agent => ({
            name: typeof agent?.name === 'string' ? agent.name.trim() : '',
            model: typeof agent?.model === 'string' ? agent.model.trim() : '',
            systemPrompt: typeof agent?.systemPrompt === 'string' ? agent.systemPrompt.trim() : '',
            presetId: typeof agent?.presetId === 'string' ? agent.presetId.trim() : undefined,
            enabledSkills: Array.isArray(agent?.enabledSkills) ? agent.enabledSkills.filter(Boolean) : undefined
        }))
        .filter(agent => agent.name && agent.model);

    if (normalizedAgents.length === 0) {
        context.postMessage({
            type: 'agentsBatchCreateFailed',
            message: t('agentBatch.validationNames')
        });
        return;
    }

    const failures: string[] = [];
    let createdCount = 0;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: t('agentBatch.pending'),
            cancellable: false
        },
        async progress => {
            for (let index = 0; index < normalizedAgents.length; index += 1) {
                const agent = normalizedAgents[index];
                progress.report({
                    message: `${agent.name} (${index + 1}/${normalizedAgents.length})`,
                    increment: 100 / normalizedAgents.length
                });

                try {
                    await context.agentManager.createAgent(agent);
                    createdCount += 1;
                } catch (error) {
                    failures.push(`${agent.name}: ${isDuplicateAgentNameError(error) ? error.message : String(error)}`);
                }
            }
        }
    );

    await context.loadAgents();

    if (failures.length > 0) {
        context.postMessage({
            type: 'agentsBatchCreateFailed',
            message: t('agentBatch.partialFailure', {
                created: String(createdCount),
                failed: String(failures.length),
                details: failures.join(' | ')
            })
        });
        return;
    }

    showSuccessStatus(t('agentBatch.created', { count: String(createdCount) }));
    context.postMessage({
        type: 'agentsBatchCreated',
        count: createdCount
    });
}

/**
 * Handles deleting an agent
 * @param context - The agent action context
 * @param agentId - The ID of the agent to delete
 */
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

/**
 * Prompts the user to select and delete multiple agents in batch
 * @param context - The agent action context
 */
export async function promptDeleteAgentsBatch(context: AgentActionContext): Promise<void> {
    const agents = await context.agentManager.getAgents(true);
    if (agents.length === 0) {
        vscode.window.showInformationMessage(t('clusters.createAgentFirst'));
        return;
    }

    const selections = await vscode.window.showQuickPick(
        agents.map(agent => ({
            label: agent.name,
            description: agent.model,
            agentId: agent.id
        })),
        {
            placeHolder: t('agentBatch.selectDelete'),
            canPickMany: true
        }
    );

    if (!selections || selections.length === 0) {
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        t('agentBatch.deleteConfirm', { count: String(selections.length) }),
        { modal: true },
        t('common.delete')
    );
    if (confirmed !== t('common.delete')) {
        return;
    }

    const failures: string[] = [];
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: t('agentBatch.deleting'),
            cancellable: false
        },
        async progress => {
            for (let index = 0; index < selections.length; index += 1) {
                const selection = selections[index];
                progress.report({
                    message: `${selection.label} (${index + 1}/${selections.length})`,
                    increment: 100 / selections.length
                });
                try {
                    await context.agentManager.deleteAgent(selection.agentId);
                    if (context.getCurrentAgentId() === selection.agentId) {
                        context.setCurrentAgentId(null);
                        context.setCurrentSessionId(null);
                    }
                } catch (error) {
                    failures.push(`${selection.label}: ${String(error)}`);
                }
            }
        }
    );

    if (context.getCurrentAgentId() === null) {
        context.postMessage({ type: 'clearChat' });
        context.postMessage({ type: 'setActiveAgent', agentId: null });
    }

    await context.loadAgents();

    if (failures.length > 0) {
        vscode.window.showErrorMessage(t('agentBatch.deleteFailed', { error: failures.join(' | ') }));
        return;
    }

    showSuccessStatus(t('agentBatch.deleted', { count: String(selections.length) }));
}

/**
 * Handles saving agent settings
 * @param context - The agent action context
 * @param agentId - The ID of the agent to update
 * @param settings - The new agent settings
 */
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
        context.postMessage({
            type: 'agentSaveFailed',
            agentId,
            message: t('agentSettings.saveFailed', { error: String(error) })
        });
        vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
    }
}

/**
 * Handles opening agent settings in the panel
 * @param context - The agent action context
 * @param agentId - The ID of the agent to open settings for
 */
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

/**
 * Handles opening an agent's folder in VS Code
 * @param context - The agent action context
 * @param agentId - The ID of the agent whose folder to open
 */
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
