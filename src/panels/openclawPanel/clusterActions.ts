import * as vscode from 'vscode';

import { getClusterWorkModePresets } from '../../config/clusterWorkModes';
import { t } from '../../i18n';
import type { AgentCluster } from '../../services/openclawService';
import type { AgentManager } from '../../managers/agentManager';
import type { ChatSessionManager } from '../../managers/chatSessionManager';
import type { ClusterManager } from '../../managers/clusterManager';
import { showSuccessStatus } from '../../utils/statusFeedback';
import { normalizeOutgoingMessageContent } from './helpers';

interface ClusterActionContext {
    clusterManager: ClusterManager;
    agentManager: AgentManager;
    clusterSessionManager: ChatSessionManager;
    postMessage(message: Record<string, unknown>): void;
    loadClusters(selectedClusterId?: string): Promise<void>;
    showClusterView(clusters: AgentCluster[], selectedClusterId?: string): void;
    getCurrentAgentId(): string | null;
    beginAgentRun(agentId: string): boolean;
    endAgentRun(agentId: string): boolean;
    nextClusterSwarmRunToken(): number;
    getClusterSwarmRunToken(): number;
    nextClusterAgentRunToken(): number;
    getClusterAgentRunToken(): number;
}

export async function loadClusters(context: ClusterActionContext, selectedClusterId?: string): Promise<void> {
    try {
        const clusters = await context.clusterManager.getClusters(true);
        context.postMessage({
            type: 'clustersLoaded',
            clusters,
            selectedClusterId,
            workModePresets: getClusterWorkModePresets()
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadClusters', { error: String(error) })
        });
    }
}

export async function handleBroadcast(context: ClusterActionContext, clusterId: string, message: string): Promise<void> {
    const swarmRunToken = context.nextClusterSwarmRunToken();
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    try {
        const responses = await context.clusterManager.broadcastToCluster(clusterId, message);
        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            context.postMessage({
                type: 'broadcastResults',
                clusterId,
                responses
            });
        }
    } catch (error) {
        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            context.postMessage({
                type: 'clusterRunFailed',
                clusterId,
                mode: 'broadcast'
            });
            context.postMessage({
                type: 'error',
                message: t('panel.failedBroadcast', { error: String(error) })
            });
        }
    } finally {
        endClusterAgentRuns(context, runningAgentIds);
    }
}

export async function promptBroadcastToCluster(context: ClusterActionContext, clusterId: string): Promise<void> {
    const message = await vscode.window.showInputBox({
        prompt: t('clusters.broadcastPrompt'),
        ignoreFocusOut: true
    });

    if (!message?.trim()) {
        return;
    }

    await handleBroadcast(context, clusterId, normalizeOutgoingMessageContent(message));
}

export async function handleCollaborate(context: ClusterActionContext, clusterId: string, message: string): Promise<void> {
    const swarmRunToken = context.nextClusterSwarmRunToken();
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    try {
        const result = await context.clusterManager.collaborateOnCluster(clusterId, normalizeOutgoingMessageContent(message), {
            coordinatorAgentId: context.getCurrentAgentId() || undefined
        });

        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            context.postMessage({
                type: 'collaborationResults',
                result
            });
        }
    } catch (error) {
        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            context.postMessage({
                type: 'clusterRunFailed',
                clusterId,
                mode: 'collaborate'
            });
            context.postMessage({
                type: 'error',
                message: t('panel.failedCollaborate', { error: String(error) })
            });
        }
    } finally {
        endClusterAgentRuns(context, runningAgentIds);
    }
}

export async function promptCollaborateCluster(context: ClusterActionContext, clusterId: string): Promise<void> {
    const message = await vscode.window.showInputBox({
        prompt: t('clusters.collaborationPrompt'),
        ignoreFocusOut: true
    });

    if (!message?.trim()) {
        return;
    }

    await handleCollaborate(context, clusterId, normalizeOutgoingMessageContent(message));
}

export async function loadClusterAgentMessages(
    context: ClusterActionContext,
    clusterId: string,
    agentId: string
): Promise<void> {
    if (!clusterId || !agentId) {
        return;
    }

    try {
        context.postMessage({
            type: 'setClusterContextLoading',
            clusterId,
            agentId,
            loading: true
        });

        const sessionId = await context.clusterManager.ensureClusterAgentSessionId(clusterId, agentId);
        const session = await context.clusterSessionManager.getOrCreateSession(agentId, {
            refreshHistory: true,
            sessionId
        });
        context.clusterSessionManager.setCurrentSession(session.id);

        context.postMessage({
            type: 'replaceClusterMessages',
            clusterId,
            agentId,
            messages: session.messages
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadContext', { error: String(error) })
        });
    } finally {
        context.postMessage({
            type: 'setClusterContextLoading',
            clusterId,
            agentId,
            loading: false
        });
    }
}

export async function handleClusterAgentMessage(
    context: ClusterActionContext,
    clusterId: string,
    agentId: string,
    content: string
): Promise<void> {
    const normalizedContent = normalizeOutgoingMessageContent(content);
    if (!clusterId || !agentId || !normalizedContent.trim()) {
        return;
    }

    const clusterAgentRunToken = context.nextClusterAgentRunToken();
    context.beginAgentRun(agentId);

    try {
        const sessionId = await context.clusterManager.ensureClusterAgentSessionId(clusterId, agentId);
        const session = await context.clusterSessionManager.getOrCreateSession(agentId, {
            sessionId
        });
        context.clusterSessionManager.setCurrentSession(session.id);

        for await (const chunk of context.clusterSessionManager.streamMessage(normalizedContent)) {
            if (context.getClusterAgentRunToken() !== clusterAgentRunToken) {
                break;
            }

            if (!chunk.message) {
                continue;
            }

            context.postMessage({
                type: 'appendClusterMessage',
                clusterId,
                agentId,
                message: chunk.message,
                keepPending: true
            });
        }

        if (context.getClusterAgentRunToken() === clusterAgentRunToken) {
            const messages = await context.clusterSessionManager.refreshSessionHistory(session.id, {
                preferLiveState: true
            });
            context.postMessage({
                type: 'replaceClusterMessages',
                clusterId,
                agentId,
                messages
            });
        }
    } catch (error) {
        if (context.getClusterAgentRunToken() === clusterAgentRunToken) {
            context.postMessage({
                type: 'error',
                message: t('panel.failedSendMessage', { error: String(error) })
            });
        }
    } finally {
        context.endAgentRun(agentId);
    }
}

async function beginClusterAgentRuns(context: ClusterActionContext, clusterId: string): Promise<string[]> {
    const cluster = await context.clusterManager.getCluster(clusterId);
    if (!cluster) {
        return [];
    }

    for (const agentId of cluster.agentIds) {
        context.beginAgentRun(agentId);
    }

    return cluster.agentIds;
}

function endClusterAgentRuns(context: ClusterActionContext, agentIds: string[]): void {
    for (const agentId of agentIds) {
        context.endAgentRun(agentId);
    }
}

export async function handleClusterAgentSessionCommand(
    context: ClusterActionContext,
    clusterId: string,
    agentId: string,
    command: 'new' | 'clear'
): Promise<void> {
    if (!clusterId || !agentId) {
        return;
    }

    try {
        context.postMessage({
            type: 'setClusterContextLoading',
            clusterId,
            agentId,
            loading: true
        });

        let sessionId = await context.clusterManager.ensureClusterAgentSessionId(clusterId, agentId);
        if (command === 'new') {
            sessionId = await context.clusterManager.resetClusterAgentSessionId(clusterId, agentId);
        }

        let session = await context.clusterSessionManager.getOrCreateSession(agentId, {
            refreshHistory: true,
            sessionId
        });
        context.clusterSessionManager.setCurrentSession(session.id);

        if (command === 'clear') {
            await context.clusterSessionManager.clearHistory().catch(() => undefined);
            const clearedMessages = await context.clusterSessionManager.refreshSessionHistory(session.id, {
                preferLiveState: true
            });
            if (clearedMessages.length > 0) {
                sessionId = await context.clusterManager.resetClusterAgentSessionId(clusterId, agentId);
                session = await context.clusterSessionManager.getOrCreateSession(agentId, {
                    refreshHistory: true,
                    sessionId
                });
                context.clusterSessionManager.setCurrentSession(session.id);
            }
        }

        context.postMessage({
            type: 'replaceClusterMessages',
            clusterId,
            agentId,
            messages: []
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadContext', { error: String(error) })
        });
    } finally {
        context.postMessage({
            type: 'setClusterContextLoading',
            clusterId,
            agentId,
            loading: false
        });
    }
}

export async function handleSaveCluster(
    context: ClusterActionContext,
    clusterId: string | undefined,
    data: {
        name?: string;
        agentIds?: string[];
        workspaceConfig?: Record<string, unknown>;
    }
): Promise<void> {
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const agentIds = Array.isArray(data?.agentIds)
        ? data.agentIds.map(agentId => String(agentId || '').trim()).filter(Boolean)
        : [];

    if (!name) {
        vscode.window.showErrorMessage(t('clusters.validationName'));
        return;
    }

    if (agentIds.length === 0) {
        vscode.window.showErrorMessage(t('clusters.validationAgents'));
        return;
    }

    try {
        const cluster = clusterId
            ? await context.clusterManager.updateCluster(clusterId, {
                name,
                agentIds,
                workspaceConfig: data.workspaceConfig as any
            })
            : await context.clusterManager.createCluster({
                name,
                agentIds,
                workspaceConfig: data.workspaceConfig as any
            });

        showSuccessStatus(clusterId
            ? t('clusters.updated', { name: cluster.name })
            : t('clusters.created', { name: cluster.name }));
        context.postMessage({
            type: 'clusterSaved',
            cluster
        });
        const refreshedClusters = await context.clusterManager.getClusters();
        context.showClusterView(
            refreshedClusters.map(item => item.id === cluster.id ? cluster : item),
            cluster.id
        );
    } catch (error) {
        vscode.window.showErrorMessage(t(clusterId ? 'clusters.updateFailed' : 'clusters.createFailed', { error: String(error) }));
    }
}

export async function handleAddAgentsToCluster(context: ClusterActionContext, clusterId: string): Promise<void> {
    if (!clusterId) {
        return;
    }

    try {
        const [cluster, agents] = await Promise.all([
            context.clusterManager.getCluster(clusterId),
            context.agentManager.getAgents()
        ]);

        if (!cluster) {
            vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
            return;
        }

        const availableAgents = agents.filter(agent => !cluster.agentIds.includes(agent.id));
        if (availableAgents.length === 0) {
            showSuccessStatus(t('clusters.noAvailableAgentsToAdd'));
            return;
        }

        const selectedAgents = await vscode.window.showQuickPick(
            availableAgents.map(agent => ({
                label: agent.name,
                description: agent.model,
                agentId: agent.id
            })),
            {
                placeHolder: t('clusters.selectAgentsToAdd'),
                canPickMany: true
            }
        );

        if (!selectedAgents || selectedAgents.length === 0) {
            return;
        }

        await context.clusterManager.updateCluster(clusterId, {
            agentIds: [...cluster.agentIds, ...selectedAgents.map(agent => agent.agentId)]
        });
        await context.loadClusters(clusterId);
        showSuccessStatus(t('clusters.agentsAdded', { count: selectedAgents.length }));
    } catch (error) {
        vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
    }
}

export async function handleRemoveAgentsFromCluster(context: ClusterActionContext, clusterId: string): Promise<void> {
    if (!clusterId) {
        return;
    }

    try {
        const cluster = await context.clusterManager.getCluster(clusterId);
        if (!cluster) {
            vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
            return;
        }

        const agents = await context.agentManager.getAgents();
        const agentNames = new Map(agents.map(agent => [agent.id, agent.name]));

        if (cluster.agentIds.length <= 1) {
            vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
            return;
        }

        const selectedAgents = await vscode.window.showQuickPick(
            cluster.agentIds.map(agentId => ({
                label: agentNames.get(agentId) || agentId,
                description: agentId,
                agentId,
                picked: false
            })),
            {
                placeHolder: t('clusters.selectAgentsToRemove'),
                canPickMany: true
            }
        );

        if (!selectedAgents || selectedAgents.length === 0) {
            return;
        }

        const remainingAgentIds = cluster.agentIds.filter(agentId =>
            !selectedAgents.some(selected => selected.agentId === agentId)
        );

        if (remainingAgentIds.length === 0) {
            vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
            return;
        }

        await context.clusterManager.updateCluster(clusterId, {
            agentIds: remainingAgentIds
        });
        await context.loadClusters(clusterId);
        showSuccessStatus(t('clusters.agentsRemoved', { count: selectedAgents.length }));
    } catch (error) {
        vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
    }
}
