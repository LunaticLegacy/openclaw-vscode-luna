import * as vscode from 'vscode';

import { getClusterWorkModePresets, normalizeClusterWorkspaceConfig } from '../../config/clusterWorkModes';
import {
    buildClusterNameFromTemplate,
    getClusterMemberPresets,
    type ClusterMemberPreset
} from '../../config/clusterMemberPresets';
import { loadIdentityPresets } from '../../presets/loader';
import { t } from '../../i18n';
import type { AgentCluster } from '../../services/openclawService';
import type { AgentManager } from '../../managers/agentManager';
import type { AgentFolderManager } from '../../managers/agentFolderManager';
import type { ChatSessionManager } from '../../managers/chatSessionManager';
import type {
    ClusterBroadcastResult,
    ClusterCollaborationRoundDescriptor,
    ClusterCollaborationProgressEvent,
    ClusterCollaborationResult,
    ClusterSwarmRunSummary,
    ClusterManager
} from '../../managers/clusterManager';
import type { Agent, ChatMessage } from '../../services/openclawService';
import { showSuccessStatus } from '../../utils/statusFeedback';
import { buildMessageSyncSignature, normalizeOutgoingMessageContent } from './helpers';
import type { ClusterCreateFromMemberPresetParams, ClusterSaveData } from '../../types/panel';

/**
 * Context interface for cluster action operations
 */
interface ClusterActionContext {
    clusterManager: ClusterManager;
    agentManager: AgentManager;
    agentFolderManager: AgentFolderManager;
    clusterSessionManager: ChatSessionManager;
    extensionPath: string;
    postMessage(message: Record<string, unknown>): void;
    loadAgents(): Promise<void>;
    loadClusters(selectedClusterId?: string): Promise<void>;
    showClusterView(clusters: AgentCluster[], selectedClusterId?: string): void;
    getCurrentAgentId(): string | undefined;
    beginAgentRun(agentId: string): boolean;
    endAgentRun(agentId: string): boolean;
    nextClusterSwarmRunToken(): number;
    getClusterSwarmRunToken(): number;
    nextClusterAgentRunToken(): number;
    getClusterAgentRunToken(): number;
}

/**
 * Type for swarm operation modes
 */
type SwarmMode = 'broadcast' | 'collaborate';
type SwarmConversationOutputMode = 'frontend' | 'raw';
const COLLABORATE_AGENT_SWARM_LIVE_SYNC_INTERVAL_MS = 900;

/**
 * Type alias for presented chat messages
 */
type PresentedChatMessage = ChatMessage;

/**
 * Loads the list of clusters
 * @param context - The cluster action context
 * @param selectedClusterId - Optional cluster ID to select
 */
export async function loadClusters(context: ClusterActionContext, selectedClusterId?: string): Promise<void> {
    try {
        const clusters = await context.clusterManager.getClusters(true);
        const memberPresets = await getClusterMemberPresets(context.extensionPath);
        const identityPresets = await loadIdentityPresets(context.extensionPath);
        context.postMessage({
            type: 'clustersLoaded',
            clusters,
            selectedClusterId,
            workModePresets: getClusterWorkModePresets(),
            memberPresets,
            identityPresets
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadClusters', { error: String(error) })
        });
    }
}

/**
 * Handles broadcasting a message to all agents in a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the target cluster
 * @param message - The message to broadcast
 * @returns True if the broadcast succeeded
 */
export async function handleBroadcast(context: ClusterActionContext, clusterId: string, message: string): Promise<boolean> {
    const swarmRunToken = context.nextClusterSwarmRunToken();
    const swarmRunId = buildPanelSwarmRunId(clusterId, 'broadcast');
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    try {
        const agents = await context.agentManager.getAgents();
        const progress = await initializeClusterSwarmProgress(context, clusterId, 'broadcast', message, swarmRunId);
        const responses = await context.clusterManager.broadcastToCluster({
            clusterId,
            message,
            options: {
                swarmRunId,
                onAgentResult: async (_agentId: any, entry: any) => {
                    if (context.getClusterSwarmRunToken() !== swarmRunToken) {
                        return;
                    }
                    throwIfSwarmPermissionError(entry.error);

                    await appendClusterSwarmProgressMessages(
                        context,
                        progress,
                        buildConversationMessagesForEntry(
                            entry,
                            resolveAgentLabel(agents, entry.agentId),
                            t('clusters.broadcast')
                        )
                    );
                }
            }
        });
        throwIfSwarmPermissionError(findSwarmPermissionErrorFromEntries(Object.values(responses || {})) || undefined);

        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            await finalizeClusterSwarmProgress(
                context,
                progress,
                buildBroadcastConversationMessages(
                    responses,
                    agents
                )
            );
            return true;
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

    return false;
}

/**
 * Prompts the user to broadcast a message to a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the target cluster
 */
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

/**
 * Handles collaboration mode for a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the target cluster
 * @param message - The collaboration message
 * @returns True if the collaboration succeeded
 */
export async function handleCollaborate(context: ClusterActionContext, clusterId: string, message: string): Promise<boolean> {
    const swarmRunToken = context.nextClusterSwarmRunToken();
    const swarmRunId = buildPanelSwarmRunId(clusterId, 'collaborate');
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    let stopLiveAgentSwarmSync: (() => Promise<void>) | undefined;
    try {
        const [agents, cluster] = await Promise.all([
            context.agentManager.getAgents(),
            context.clusterManager.getCluster(clusterId)
        ]);
        const progress = await initializeClusterSwarmProgress(context, clusterId, 'collaborate', message, swarmRunId);
        stopLiveAgentSwarmSync = startCollaborateAgentSwarmLiveSync(context, {
            clusterId,
            swarmRunId,
            swarmRunToken,
            agentIds: cluster?.agentIds || [],
            agents
        });
        const result = await context.clusterManager.collaborateOnCluster({
            clusterId,
            message: normalizeOutgoingMessageContent(message),
            options: {
                swarmRunId,
                coordinatorAgentId: context.getCurrentAgentId() || undefined,
                onProgress: async (event: ClusterCollaborationProgressEvent) => {
                    if (context.getClusterSwarmRunToken() !== swarmRunToken || event.swarmRunId !== swarmRunId) {
                        return;
                    }
                    if (event.kind === 'round-entry') {
                        throwIfSwarmPermissionError(event.entry?.error);
                    } else {
                        throwIfSwarmPermissionError(event.entry?.error);
                    }

                    await appendClusterSwarmProgressMessages(
                        context,
                        progress,
                        buildConversationMessagesForProgressEvent(event, agents)
                    );
                    await refreshClusterSwarmRawLog(context, clusterId, event.swarmRunId);
                }
            }
        });
        throwIfSwarmPermissionError(findSwarmPermissionErrorFromCollaborationResult(result) || undefined);

        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            await finalizeClusterSwarmProgress(
                context,
                progress,
                buildCollaborationCompletionMessages(result, agents, cluster?.agentIds || [])
            );
            await refreshClusterSwarmRawLog(context, clusterId, result.swarmRunId);
            return true;
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
        await stopLiveAgentSwarmSync?.().catch(() => undefined);
        endClusterAgentRuns(context, runningAgentIds);
    }

    return false;
}

/**
 * Prompts the user to start a cluster collaboration
 * @param context - The cluster action context
 * @param clusterId - The ID of the target cluster
 */
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

/**
 * Loads swarm messages for a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param mode - The swarm mode (broadcast or collaborate)
 */
export async function loadClusterSwarmMessages(
    context: ClusterActionContext,
    clusterId: string,
    mode: SwarmMode,
    outputMode: SwarmConversationOutputMode = 'frontend',
    swarmRunId?: string
): Promise<void> {
    if (!clusterId || (mode !== 'broadcast' && mode !== 'collaborate')) {
        return;
    }

    try {
        if (!(mode === 'collaborate' && outputMode === 'frontend')) {
            await context.clusterManager.rehydrateClusterSwarmMessages({ clusterId, mode, swarmRunId });
        }

        context.postMessage({
            type: 'setClusterSwarmContextLoading',
            clusterId,
            mode,
            loading: true,
            outputMode,
            swarmRunId
        });

        const [messages, runSummaries, agents] = await Promise.all([
            outputMode === 'raw' && mode === 'collaborate'
                ? buildClusterSwarmRawLogMessages(context, clusterId, mode, swarmRunId)
                : mode === 'collaborate' && outputMode === 'frontend'
                    ? context.clusterManager.getClusterSwarmSessionMessages({ clusterId, mode, swarmRunId })
                    : context.clusterManager.getClusterSwarmMessages({ clusterId, mode, swarmRunId }),
            context.clusterManager.listClusterSwarmRuns({ clusterId, mode }),
            outputMode === 'frontend'
                ? context.agentManager.getAgents()
                : Promise.resolve([])
        ]);
        context.postMessage({
            type: 'replaceSwarmMessages',
            clusterId,
            mode,
            messages: outputMode === 'frontend'
                ? decorateLoadedSwarmConversationMessages(messages, agents, mode)
                : messages,
            outputMode,
            swarmRunId,
            knownRunIds: runSummaries.map((summary: any) => summary.runId),
            knownRuns: runSummaries
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadContext', { error: String(error) })
        });
    } finally {
        context.postMessage({
            type: 'setClusterSwarmContextLoading',
            clusterId,
            mode,
            loading: false,
            outputMode,
            swarmRunId
        });
    }
}

export async function hardRefreshClusterWorkspace(
    context: ClusterActionContext,
    {
        clusterId,
        targetKind = 'swarm',
        mode = 'broadcast',
        outputMode = 'frontend',
        agentId,
        agentViewMode = 'chat',
        swarmRunId
    }: {
        clusterId: string;
        targetKind?: 'swarm' | 'agent';
        mode?: SwarmMode;
        outputMode?: SwarmConversationOutputMode;
        agentId?: string;
        agentViewMode?: 'chat' | 'broadcast' | 'collaborate';
        swarmRunId?: string;
    }
): Promise<void> {
    if (!clusterId) {
        return;
    }

    await Promise.all([
        context.loadAgents(),
        context.loadClusters(clusterId)
    ]);

    if (targetKind === 'agent' && agentId) {
        if (agentViewMode === 'broadcast' || agentViewMode === 'collaborate') {
            await loadClusterAgentSwarmMessages(context, clusterId, agentId, agentViewMode, swarmRunId);
            return;
        }

        await loadClusterAgentMessages(context, clusterId, agentId);
        return;
    }

    await loadClusterSwarmMessages(context, clusterId, mode, outputMode, swarmRunId);
}

/**
 * Loads messages for a specific agent in a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param agentId - The ID of the agent
 */
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

        const sessionId = await context.clusterManager.ensureClusterAgentSessionId({ clusterId, agentId });
        const persistedMessages = await context.clusterManager.getClusterAgentMessages({ clusterId, agentId });
        if (persistedMessages.length > 0) {
            context.postMessage({
                type: 'replaceClusterMessages',
                clusterId,
                agentId,
                messages: persistedMessages
            });
        }

        const session = await context.clusterSessionManager.getOrCreateSession(agentId, {
            refreshHistory: true,
            sessionId
        });
        context.clusterSessionManager.setCurrentSession(session.id);
        const resolvedMessages = session.messages.length > 0 ? session.messages : persistedMessages;
        session.messages = resolvedMessages;
        const persistedSignature = buildMessageSyncSignature(persistedMessages);
        const resolvedSignature = buildMessageSyncSignature(resolvedMessages);

        if (resolvedMessages.length > 0 && resolvedSignature !== persistedSignature) {
            await context.clusterManager.replaceClusterAgentMessages({
                clusterId,
                agentId,
                messages: resolvedMessages
            });
        }

        if (resolvedSignature !== persistedSignature || persistedMessages.length === 0) {
            context.postMessage({
                type: 'replaceClusterMessages',
                clusterId,
                agentId,
                messages: resolvedMessages
            });
        }
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

/**
 * Handles sending a message to a specific agent in a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param agentId - The ID of the target agent
 * @param content - The message content
 * @returns True if the message was sent successfully
 */
export async function handleClusterAgentMessage(
    context: ClusterActionContext,
    clusterId: string,
    agentId: string,
    content: string
): Promise<boolean> {
    const normalizedContent = normalizeOutgoingMessageContent(content);
    if (!clusterId || !agentId || !normalizedContent.trim()) {
        return false;
    }

    const clusterAgentRunToken = context.nextClusterAgentRunToken();
    context.beginAgentRun(agentId);

    try {
        const sessionId = await context.clusterManager.ensureClusterAgentSessionId({ clusterId, agentId });
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
            await context.clusterManager.replaceClusterAgentMessages({
                clusterId,
                agentId,
                messages
            });
            context.postMessage({
                type: 'replaceClusterMessages',
                clusterId,
                agentId,
                messages
            });
            return true;
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

    return false;
}

/**
 * Loads swarm messages for a specific agent in a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param agentId - The ID of the agent
 * @param mode - The swarm mode (broadcast or collaborate)
 */
export async function loadClusterAgentSwarmMessages(
    context: ClusterActionContext,
    clusterId: string,
    agentId: string,
    mode: SwarmMode,
    swarmRunId?: string
): Promise<void> {
    if (!clusterId || !agentId || (mode !== 'broadcast' && mode !== 'collaborate')) {
        return;
    }

    try {
        context.postMessage({
            type: 'setClusterAgentSwarmContextLoading',
            clusterId,
            agentId,
            mode,
            loading: true,
            swarmRunId
        });

        const messages = mode === 'collaborate'
            ? await context.clusterManager.getClusterAgentSwarmSessionMessages({
                clusterId,
                agentId,
                mode,
                swarmRunId
            })
            : await context.clusterManager.getClusterAgentSwarmMessages({
                clusterId,
                agentId,
                mode,
                swarmRunId
            });
        context.postMessage({
            type: 'replaceClusterAgentSwarmMessages',
            clusterId,
            agentId,
            mode,
            messages: decorateClusterAgentLogMessages(messages, mode),
            swarmRunId
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadContext', { error: String(error) })
        });
    } finally {
        context.postMessage({
            type: 'setClusterAgentSwarmContextLoading',
            clusterId,
            agentId,
            mode,
            loading: false,
            swarmRunId
        });
    }
}

function startCollaborateAgentSwarmLiveSync(
    context: ClusterActionContext,
    {
        clusterId,
        swarmRunId,
        swarmRunToken,
        agentIds,
        agents
    }: {
        clusterId: string;
        swarmRunId: string;
        swarmRunToken: number;
        agentIds: string[];
        agents: Agent[];
    }
): () => Promise<void> {
    let active = true;
    const loop = (async () => {
        while (active && context.getClusterSwarmRunToken() === swarmRunToken) {
            await syncCollaborateAgentSwarmLiveState(context, {
                clusterId,
                swarmRunId,
                agentIds,
                agents,
                keepPending: true
            }).catch(() => undefined);

            await delay(COLLABORATE_AGENT_SWARM_LIVE_SYNC_INTERVAL_MS);
        }
    })();

    return async () => {
        active = false;
        await loop.catch(() => undefined);
        await syncCollaborateAgentSwarmLiveState(context, {
            clusterId,
            swarmRunId,
            agentIds,
            agents,
            keepPending: false
        }).catch(() => undefined);
    };
}

async function syncCollaborateAgentSwarmLiveState(
    context: ClusterActionContext,
    {
        clusterId,
        swarmRunId,
        agentIds,
        agents,
        keepPending = true
    }: {
        clusterId: string;
        swarmRunId: string;
        agentIds: string[];
        agents: Agent[];
        keepPending?: boolean;
    }
): Promise<void> {
    if (!clusterId || !swarmRunId || !Array.isArray(agentIds) || agentIds.length === 0) {
        return;
    }

    await Promise.all(agentIds.map(async (agentId: any) => {
        const messages = await context.clusterManager.getClusterAgentSwarmSessionMessages({
            clusterId,
            agentId,
            mode: 'collaborate',
            swarmRunId,
            preferLiveState: true
        });

        context.postMessage({
            type: 'replaceClusterAgentSwarmMessages',
            clusterId,
            agentId,
            mode: 'collaborate',
            messages: decorateClusterAgentLogMessages(messages, 'collaborate'),
            swarmRunId
        });
    }));

    const runSummaries = await buildKnownSwarmRunSummaries(context, {
        clusterId,
        mode: 'collaborate',
        swarmRunId
    });
    const swarmMessages = await context.clusterManager.getClusterSwarmSessionMessages({
        clusterId,
        mode: 'collaborate',
        swarmRunId,
        preferLiveState: true
    });
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId,
        mode: 'collaborate',
        outputMode: 'frontend',
        messages: decorateLoadedSwarmConversationMessages(swarmMessages, agents, 'collaborate'),
        swarmRunId,
        knownRunIds: runSummaries.map((summary: any) => summary.runId),
        knownRuns: runSummaries,
        keepPending
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Begins agent runs for all agents in a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @returns Array of agent IDs that were started
 */
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

/**
 * Ends agent runs for the specified agents
 * @param context - The cluster action context
 * @param agentIds - Array of agent IDs to stop
 */
function endClusterAgentRuns(context: ClusterActionContext, agentIds: string[]): void {
    for (const agentId of agentIds) {
        context.endAgentRun(agentId);
    }
}

/**
 * Handles cluster agent session commands (new or clear)
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param agentId - The ID of the agent
 * @param command - The command to execute ('new' or 'clear')
 */
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

        let sessionId = await context.clusterManager.ensureClusterAgentSessionId({ clusterId, agentId });
        if (command === 'new') {
            sessionId = await context.clusterManager.resetClusterAgentSessionId({ clusterId, agentId });
        }
        await context.clusterManager.clearClusterAgentMessages({ clusterId, agentId });

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
                sessionId = await context.clusterManager.resetClusterAgentSessionId({ clusterId, agentId });
                await context.clusterManager.clearClusterAgentMessages({ clusterId, agentId });
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

/**
 * Handles saving a cluster (create or update)
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster to update, or undefined to create new
 * @param data - The cluster data
 */
export async function handleSaveCluster(
    context: ClusterActionContext,
    clusterId: string | undefined,
    data: ClusterSaveData
): Promise<void> {
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const existingAgentIds = Array.isArray(data?.agentIds)
        ? data.agentIds.map((agentId: any) => String(agentId || '').trim()).filter(Boolean)
        : [];
    const createAgents = Array.isArray(data?.createAgents)
        ? data.createAgents
            .map((agent: any) => ({
                name: typeof agent?.name === 'string' ? agent.name.trim() : '',
                model: typeof agent?.model === 'string' ? agent.model.trim() : '',
                systemPrompt: typeof agent?.systemPrompt === 'string' ? agent.systemPrompt.trim() : '',
                presetId: typeof agent?.presetId === 'string' ? agent.presetId.trim() : undefined,
                enabledSkills: Array.isArray(agent?.enabledSkills) ? agent.enabledSkills.filter(Boolean) : undefined
            }))
            .filter((agent: any) => agent.name)
        : [];

    if (!name) {
        vscode.window.showErrorMessage(t('clusters.validationName'));
        return;
    }

    if (existingAgentIds.length === 0 && createAgents.length === 0) {
        vscode.window.showErrorMessage(t('clusters.validationAgents'));
        return;
    }

    const workspaceConfig = data.workspaceConfig as Record<string, unknown> | undefined;
    if (workspaceConfig?.runUntilConditionMet === true && !String(workspaceConfig.stopCondition || '').trim()) {
        vscode.window.showErrorMessage(t('clusters.validationStopCondition'));
        return;
    }

    const createdAgentIds: string[] = [];
    const totalSteps = createAgents.length
        + 1
        + (createAgents.length > 0 ? 1 : 0)
        + 1;
    const progressTitle = t(clusterId ? 'progress.savingCluster' : 'progress.creatingCluster');

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: false
        },
        async (progress: any) => {
            const reporter = createStepProgressReporter(progress, totalSteps);

            try {
                for (const [index, agent] of createAgents.entries()) {
                    if (!agent.model) {
                        throw new Error(t('agentBatch.validationModel'));
                    }

                    reporter.start(t('progress.creatingClusterAgent', {
                        current: index + 1,
                        total: createAgents.length,
                        name: agent.name
                    }));
                    const createdAgent = await context.agentManager.createAgent(agent);
                    createdAgentIds.push(createdAgent.id);
                    reporter.complete();
                }

                const agentIds = Array.from(new Set([...existingAgentIds, ...createdAgentIds]));
                reporter.start(t(clusterId ? 'progress.updatingClusterRecord' : 'progress.creatingClusterRecord'));
                const cluster = clusterId
                    ? await context.clusterManager.updateCluster({
                        clusterId,
                        name,
                        agentIds,
                        workspaceConfig: workspaceConfig as any
                    })
                    : await context.clusterManager.createCluster({
                        name,
                        agentIds,
                        workspaceConfig: workspaceConfig as any
                    });
                reporter.complete();

                if (createdAgentIds.length > 0) {
                    reporter.start(t('progress.refreshingAgents'));
                    await context.loadAgents();
                    reporter.complete();
                }

                if (!clusterId) {
                    await ensureClusterFolderForUngroupedAgents(context, cluster.name, agentIds);
                }

                context.postMessage({
                    type: 'clusterSaved',
                    cluster
                });

                reporter.start(t('progress.refreshingClusters'));
                await context.loadClusters(cluster.id);
                reporter.complete();

                showSuccessStatus(clusterId
                    ? t('clusters.updated', { name: cluster.name })
                    : t('clusters.created', { name: cluster.name }));
            } catch (error) {
                if (createdAgentIds.length > 0) {
                    reporter.start(t('progress.rollingBackClusterAgents'));
                    await Promise.allSettled(createdAgentIds.map((agentId: any) => context.agentManager.deleteAgent(agentId)));
                    await context.loadAgents();
                }
                vscode.window.showErrorMessage(t(clusterId ? 'clusters.updateFailed' : 'clusters.createFailed', { error: String(error) }));
            }
        }
    );
}

/**
 * Handles creating a cluster from a member preset
 * @param context - The cluster action context
 * @param params - The creation parameters
 */
export async function handleCreateClusterFromMemberPreset(
    context: ClusterActionContext,
    params: ClusterCreateFromMemberPresetParams
): Promise<void> {
    const { memberPresetId, customName, model } = params;
    
    const memberPresets = await getClusterMemberPresets(context.extensionPath);
    const preset = memberPresets.find((p: any) => p.id === memberPresetId);
    
    if (!preset) {
        vscode.window.showErrorMessage(t('clusters.memberPresetNotFound', { presetId: memberPresetId }));
        return;
    }

    const clusterName = customName?.trim() || buildClusterNameFromTemplate(preset.nameTemplate);
    const identityPresets = await loadIdentityPresets(context.extensionPath);
    const identityPresetMap = new Map(identityPresets.map((item: any) => [item.id, item]));
    
    const createdAgentIds: string[] = [];
    const agentIdMap = new Map<string, string>();
    
    const totalSteps = preset.memberBlueprints.length + 2;
    const progressTitle = t('progress.creatingClusterFromPreset', { presetName: preset.description });

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: false
        },
        async (progress: any) => {
            const reporter = createStepProgressReporter(progress, totalSteps);

            try {
                const agents = await context.agentManager.getAgents();
                const defaultModel = model?.trim() || agents[0]?.model || 'moonshot/kimi-k2.5';

                for (const [index, blueprint] of preset.memberBlueprints.entries()) {
                    reporter.start(t('progress.creatingClusterAgent', {
                        current: index + 1,
                        total: preset.memberBlueprints.length,
                        name: blueprint.nameTemplate
                    }));

                    const agentName = `${blueprint.nameTemplate}`;
                    
                    const existingAgent = agents.find((a: any) => a.name === agentName);
                    if (existingAgent) {
                        agentIdMap.set(blueprint.id, existingAgent.id);
                        createdAgentIds.push(existingAgent.id);
                        reporter.complete();
                        continue;
                    }

                    const createParams: {
                        name: string;
                        model: string;
                        systemPrompt?: string;
                        presetId?: string;
                    } = {
                        name: agentName,
                        model: blueprint.model || defaultModel,
                        presetId: blueprint.presetId,
                        systemPrompt: blueprint.systemPromptAppend
                    };

                    const createdAgent = await context.agentManager.createAgent(createParams);
                    agentIdMap.set(blueprint.id, createdAgent.id);
                    createdAgentIds.push(createdAgent.id);
                    reporter.complete();
                }

                const rootBlueprint = preset.memberBlueprints.find((b: any) => b.isCoordinator) || preset.memberBlueprints[0];
                const coordinatorAgentId = rootBlueprint ? agentIdMap.get(rootBlueprint.id) : undefined;

                const memberProfiles: Record<string, {
                    parentAgentId?: string;
                    activation?: { keywords?: string[]; swarmModes?: ('broadcast' | 'collaborate')[] };
                    identity?: string;
                    stance?: string;
                    presetIdentityId?: string;
                }> = {};
                
                for (const blueprint of preset.memberBlueprints) {
                    const agentId = agentIdMap.get(blueprint.id);
                    if (!agentId) continue;

                    const profile: {
                        parentAgentId?: string;
                        activation?: { keywords?: string[]; swarmModes?: ('broadcast' | 'collaborate')[] };
                        identity?: string;
                        stance?: string;
                        presetIdentityId?: string;
                    } = {};
                    
                    if (blueprint.parentId) {
                        const parentAgentId = agentIdMap.get(blueprint.parentId);
                        if (parentAgentId) {
                            profile.parentAgentId = parentAgentId;
                        }
                    }
                    
                    if (blueprint.activation) {
                        profile.activation = blueprint.activation;
                    }

                    if (blueprint.profile?.identity) {
                        profile.identity = blueprint.profile.identity;
                    }
                    if (blueprint.profile?.stance) {
                        profile.stance = blueprint.profile.stance;
                    }
                    if (blueprint.profile?.presetIdentityId) {
                        profile.presetIdentityId = blueprint.profile.presetIdentityId;
                        const presetIdentity = identityPresetMap.get(blueprint.profile.presetIdentityId);
                        if (presetIdentity) {
                            if (!profile.identity && presetIdentity.identity) {
                                profile.identity = presetIdentity.identity;
                            }
                            if (!profile.stance && presetIdentity.stance) {
                                profile.stance = presetIdentity.stance;
                            }
                            if (presetIdentity.wakeKeywords && presetIdentity.wakeKeywords.length > 0) {
                                profile.activation = {
                                    ...(profile.activation ? profile.activation : {}),
                                    keywords: [...presetIdentity.wakeKeywords]
                                };
                            }
                        }
                    }
                    
                    if (Object.keys(profile).length > 0) {
                        memberProfiles[agentId] = profile;
                    }
                }

                reporter.start(t('progress.creatingClusterRecord'));
                const workspaceConfig = normalizeClusterWorkspaceConfig({
                    ...preset.workspaceConfig,
                    coordinatorAgentId,
                    memberProfiles
                });

                const cluster = await context.clusterManager.createCluster({
                    name: clusterName,
                    agentIds: createdAgentIds,
                    workspaceConfig
                });
                reporter.complete();

                reporter.start(t('progress.refreshingAgents'));
                await context.loadAgents();
                reporter.complete();

                await ensureClusterFolderForUngroupedAgents(
                    context,
                    cluster.name,
                    cluster.agentIds
                );

                context.postMessage({
                    type: 'clusterSaved',
                    cluster
                });

                reporter.start(t('progress.refreshingClusters'));
                await context.loadClusters(cluster.id);
                reporter.complete();

                showSuccessStatus(t('clusters.createdFromPreset', { 
                    name: cluster.name, 
                    presetName: preset.description 
                }));

                if (preset.onboardingMessageTemplate) {
                    vscode.window.showInformationMessage(preset.onboardingMessageTemplate);
                }
            } catch (error) {
                if (createdAgentIds.length > 0) {
                    reporter.start(t('progress.rollingBackClusterAgents'));
                    await Promise.allSettled(createdAgentIds.map((agentId: any) => context.agentManager.deleteAgent(agentId)));
                    await context.loadAgents();
                }
                vscode.window.showErrorMessage(t('clusters.createFromPresetFailed', { error: String(error) }));
            }
        }
    );
}

/**
 * Handles adding agents to a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 */
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

        const availableAgents = agents.filter((agent: any) => !cluster.agentIds.includes(agent.id));
        if (availableAgents.length === 0) {
            showSuccessStatus(t('clusters.noAvailableAgentsToAdd'));
            return;
        }

        const selectedAgents = await vscode.window.showQuickPick(
            availableAgents.map((agent: any) => ({
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

        await context.clusterManager.updateCluster({
            clusterId,
            agentIds: [...cluster.agentIds, ...selectedAgents.map((agent: any) => agent.agentId)]
        });
        await context.loadClusters(clusterId);
        showSuccessStatus(t('clusters.agentsAdded', { count: selectedAgents.length }));
    } catch (error) {
        vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
    }
}

/**
 * Handles removing agents from a cluster
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 */
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
        const agentNames = new Map(agents.map((agent: any) => [agent.id, agent.name]));

        if (cluster.agentIds.length <= 1) {
            vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
            return;
        }

        const selectedAgents = await vscode.window.showQuickPick(
            cluster.agentIds.map((agentId: any) => ({
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

        const remainingAgentIds = cluster.agentIds.filter((agentId: any) =>
            !selectedAgents.some((selected: any) => selected.agentId === agentId)
        );

        if (remainingAgentIds.length === 0) {
            vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
            return;
        }

        await context.clusterManager.updateCluster({
            clusterId,
            agentIds: remainingAgentIds
        });
        await context.loadClusters(clusterId);
        showSuccessStatus(t('clusters.agentsRemoved', { count: selectedAgents.length }));
    } catch (error) {
        vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
    }
}

/**
 * Initializes progress tracking for a cluster swarm operation
 * @param context - The cluster action context
 * @param clusterId - The ID of the cluster
 * @param mode - The swarm mode
 * @param userMessage - The user's message
 * @returns The progress tracking object
 */
async function initializeClusterSwarmProgress(
    context: ClusterActionContext,
    clusterId: string,
    mode: SwarmMode,
    userMessage: string,
    swarmRunId: string
): Promise<{
    clusterId: string;
    mode: SwarmMode;
    swarmRunId: string;
    batchId: string;
    messages: PresentedChatMessage[];
    seenKeys: Set<string>;
}> {
    const batchId = buildSwarmBatchId(mode);
    const runSummaries = await buildKnownSwarmRunSummaries(context, {
        clusterId,
        mode,
        swarmRunId
    });
    const messages = [
        buildSwarmUserMessage(userMessage, mode, batchId)
    ];
    await context.clusterManager.replaceClusterSwarmMessages({
        clusterId,
        mode,
        messages,
        swarmRunId
    });
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId,
        mode,
        messages,
        swarmRunId,
        knownRunIds: runSummaries.map((summary: any) => summary.runId),
        knownRuns: runSummaries,
        keepPending: true
    });

    return {
        clusterId,
        mode,
        swarmRunId,
        batchId,
        messages,
        seenKeys: new Set(messages.map(buildSwarmProgressMessageKey))
    };
}

/**
 * Appends messages to the cluster swarm progress
 * @param context - The cluster action context
 * @param progress - The progress tracking object
 * @param messages - The messages to append
 */
async function appendClusterSwarmProgressMessages(
    context: ClusterActionContext,
    progress: {
        clusterId: string;
        mode: SwarmMode;
        swarmRunId: string;
        batchId: string;
        messages: PresentedChatMessage[];
        seenKeys: Set<string>;
    },
    messages: PresentedChatMessage[]
): Promise<void> {
    const nextMessages = messages
        .map((message: any) => normalizeSwarmProgressMessage(attachSwarmBatchMetadata(message, progress.batchId)));

    let changed = false;
    const appended: PresentedChatMessage[] = [];
    const patched: PresentedChatMessage[] = [];
    for (const message of nextMessages) {
        const identityKey = buildSwarmProgressMessageIdentityKey(message);
        const existingIndex = progress.messages.findIndex((existing: any) =>
            buildSwarmProgressMessageIdentityKey(existing) === identityKey
        );

        if (existingIndex >= 0) {
            const existing = progress.messages[existingIndex];
            if (shouldReplaceSwarmProgressMessage(existing, message)) {
                progress.messages[existingIndex] = message;
                patched.push(message);
                changed = true;
            }
            continue;
        }

        const dedupeKey = buildSwarmProgressMessageKey(message);
        if (progress.seenKeys.has(dedupeKey)) {
            continue;
        }

        progress.seenKeys.add(dedupeKey);
        progress.messages.push(message);
        appended.push(message);
        changed = true;
    }

    if (!changed) {
        return;
    }

    await context.clusterManager.replaceClusterSwarmMessages({
        clusterId: progress.clusterId,
        mode: progress.mode,
        messages: progress.messages,
        swarmRunId: progress.swarmRunId
    });
    if (appended.length > 0) {
        context.postMessage({
            type: 'appendSwarmMessages',
            clusterId: progress.clusterId,
            mode: progress.mode,
            messages: appended,
            swarmRunId: progress.swarmRunId,
            keepPending: true
        });
    }
    if (patched.length > 0) {
        context.postMessage({
            type: 'patchSwarmMessages',
            clusterId: progress.clusterId,
            mode: progress.mode,
            messages: patched,
            swarmRunId: progress.swarmRunId,
            keepPending: true
        });
    }
}

/**
 * Finalizes the cluster swarm progress
 * @param context - The cluster action context
 * @param progress - The progress tracking object
 * @param assistantMessages - The assistant messages to finalize with
 * @returns The complete message list
 */
async function finalizeClusterSwarmProgress(
    context: ClusterActionContext,
    progress: {
        clusterId: string;
        mode: SwarmMode;
        swarmRunId: string;
        batchId: string;
        messages: PresentedChatMessage[];
        seenKeys: Set<string>;
    },
    assistantMessages: PresentedChatMessage[]
): Promise<PresentedChatMessage[]> {
    await appendClusterSwarmProgressMessages(context, progress, assistantMessages);
    const runSummaries = await buildKnownSwarmRunSummaries(context, {
        clusterId: progress.clusterId,
        mode: progress.mode,
        swarmRunId: progress.swarmRunId
    });
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId: progress.clusterId,
        mode: progress.mode,
        messages: progress.messages,
        swarmRunId: progress.swarmRunId,
        knownRunIds: runSummaries.map((summary: any) => summary.runId),
        knownRuns: runSummaries,
        keepPending: false
    });
    return progress.messages;
}

function buildPanelSwarmRunId(clusterId: string, mode: SwarmMode): string {
    return `${clusterId.trim()}:${mode}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Builds conversation messages for a broadcast response
 * @param responses - The broadcast responses
 * @param agents - The list of agents
 * @returns The conversation messages
 */
function buildBroadcastConversationMessages(
    responses: Record<string, ClusterBroadcastResult>,
    agents: Agent[]
): PresentedChatMessage[] {
    const messages: PresentedChatMessage[] = [];
    for (const entry of Object.values(responses || {})) {
        messages.push(...buildConversationMessagesForEntry(
            entry,
            resolveAgentLabel(agents, entry.agentId),
            t('clusters.broadcast')
        ));
    }

    return messages;
}

/**
 * Builds conversation messages for a collaboration result
 * @param result - The collaboration result
 * @param agents - The list of agents
 * @returns The conversation messages
 */
function buildCollaborationCompletionMessages(
    result: ClusterCollaborationResult,
    agents: Agent[],
    clusterAgentIds: string[] = []
): PresentedChatMessage[] {
    const messages: PresentedChatMessage[] = [];
    const coordinatorLabel = result.coordinatorAgentId
        ? resolveAgentLabel(agents, result.coordinatorAgentId)
        : t('clusters.targetSwarm');
    const rounds = Array.isArray(result.rounds) ? result.rounds : [];

    const surfacedAgentIds = new Set<string>();
    for (const round of rounds) {
        for (const agentId of Object.keys(round.entries || {})) {
            surfacedAgentIds.add(agentId);
        }
    }

    if (result.synthesis?.agentId) {
        surfacedAgentIds.add(result.synthesis.agentId);
    }

    for (const agentId of clusterAgentIds) {
        if (surfacedAgentIds.has(agentId)) {
            continue;
        }

        messages.push({
            id: `swarm-missing:${result.swarmRunId}:${agentId}`,
            role: 'assistant',
            content: t('clusters.collaborateNoAgentOutput'),
            timestamp: new Date().toISOString(),
            agentId,
            displayName: resolveAgentLabel(agents, agentId),
            contextLabel: t('clusters.collaborate'),
            metadata: {
                swarmMissingOutput: true,
                swarmRunId: result.swarmRunId
            }
        });
    }

    if (result.synthesis) {
        messages.push(result.synthesis.ok && result.synthesis.message
            ? {
                ...decorateSwarmResultMessage(result.synthesis.message, result.synthesis),
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            }
            : buildErrorTraceMessage(
                t('clusters.finalAnswer'),
                `${t('clusters.coordinator')}: ${coordinatorLabel}`,
                result.synthesis?.error || t('clusters.noSuccessfulAgents'),
                result.coordinatorAgentId || undefined,
                result.synthesis || undefined
            ));
    }

    return messages;
}

/**
 * Builds conversation messages for a progress event
 * @param event - The collaboration progress event
 * @param agents - The list of agents
 * @returns The conversation messages
 */
function buildConversationMessagesForProgressEvent(
    event: ClusterCollaborationProgressEvent,
    agents: Agent[]
): PresentedChatMessage[] {
    if (event.kind === 'synthesis') {
        const coordinatorLabel = event.coordinatorAgentId
            ? resolveAgentLabel(agents, event.coordinatorAgentId)
            : t('clusters.targetSwarm');
        return event.entry?.ok && event.entry.message
            ? [{
                ...decorateSwarmResultMessage(event.entry.message, event.entry),
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            }]
            : [buildErrorTraceMessage(
                t('clusters.finalAnswer'),
                `${t('clusters.coordinator')}: ${coordinatorLabel}`,
                event.entry?.error || t('clusters.noSuccessfulAgents'),
                event.coordinatorAgentId || undefined,
                event.entry || undefined
            )];
    }

    return buildConversationMessagesForEntry(
        event.entry,
        resolveAgentLabel(agents, event.agentId),
        getCollaborationRoundLabel(event.round)
    );
}

/**
 * Builds conversation messages for a broadcast entry
 * @param entry - The broadcast result entry
 * @param displayName - The display name for the agent
 * @param contextLabel - The context label
 * @returns The conversation messages
 */
function buildConversationMessagesForEntry(
    entry: ClusterBroadcastResult,
    displayName: string,
    contextLabel: string
): PresentedChatMessage[] {
    if (isSwarmPermissionScopeError(entry.error)) {
        return [];
    }

    const traceMessages = buildAgentTraceMessages(entry, displayName, contextLabel);
    if (entry.ok) {
        return traceMessages;
    }

    return traceMessages.length > 0
        ? [...traceMessages, buildErrorTraceMessage(displayName, contextLabel, entry.error, entry.agentId, entry)]
        : [buildErrorTraceMessage(displayName, contextLabel, entry.error, entry.agentId, entry)];
}

/**
 * Builds trace messages for an agent's execution
 * @param entry - The broadcast result entry
 * @param displayName - The display name for the agent
 * @param contextLabel - The context label
 * @returns The trace messages
 */
function buildAgentTraceMessages(
    entry: ClusterBroadcastResult,
    displayName: string,
    contextLabel: string
): PresentedChatMessage[] {
    const trace = Array.isArray(entry.trace) ? entry.trace : [];
    const source = mergeTraceWithFinalMessage(trace, entry.message);
    const deduped: PresentedChatMessage[] = [];
    const byKey = new Map<string, number>();

    for (const message of source) {
        if (!message) {
            continue;
        }

        const id = message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
        const existingIndex = byKey.get(id);
        if (existingIndex !== undefined) {
            if (shouldPreferSwarmTraceMessage(message, deduped[existingIndex])) {
                deduped[existingIndex] = {
                    ...decorateSwarmResultMessage(message, entry),
                    displayName,
                    contextLabel
                };
            }
            continue;
        }
        byKey.set(id, deduped.length);

        deduped.push({
            ...decorateSwarmResultMessage(message, entry),
            displayName,
            contextLabel
        });
    }

    return deduped;
}

function shouldPreferSwarmTraceMessage(candidate: PresentedChatMessage, existing: PresentedChatMessage): boolean {
    return computeSwarmProgressMessageRichness(candidate) >= computeSwarmProgressMessageRichness(existing);
}

/**
 * Merges trace messages with the final message
 * @param trace - The trace messages
 * @param finalMessage - The final message
 * @returns The merged messages
 */
function mergeTraceWithFinalMessage(
    trace: ChatMessage[],
    finalMessage?: ChatMessage
): ChatMessage[] {
    if (!finalMessage) {
        return trace;
    }

    if (trace.length === 0) {
        return [finalMessage];
    }

    const finalKey = buildTraceDeduplicationKey(finalMessage);
    const hasFinalMessage = trace.some((message: any) => buildTraceDeduplicationKey(message) === finalKey);
    if (hasFinalMessage) {
        return trace;
    }

    const hasAssistantResult = trace.some((message: any) => message?.role === 'assistant');
    return hasAssistantResult ? trace : [...trace, finalMessage];
}

/**
 * Builds a deduplication key for a trace message
 * @param message - The chat message
 * @returns The deduplication key
 */
function buildTraceDeduplicationKey(message: ChatMessage): string {
    return message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
}

/**
 * Builds a progress message key for swarm operations
 * @param message - The presented chat message
 * @returns The progress message key
 */
function buildSwarmProgressMessageKey(message: PresentedChatMessage): string {
    return `${buildSwarmProgressMessageIdentityKey(message)}:${buildSwarmProgressMessageContentSignature(message)}`;
}

function buildSwarmProgressMessageIdentityKey(message: PresentedChatMessage): string {
    return `${buildTraceDeduplicationKey(message)}:${message.displayName || ''}:${message.contextLabel || ''}`;
}

function buildSwarmProgressMessageContentSignature(message: PresentedChatMessage): string {
    return [
        message.content || '',
        message.toolCallId || '',
        message.toolName || '',
        Array.isArray(message.parts) ? JSON.stringify(message.parts) : '',
        JSON.stringify(message.metadata || {})
    ].join('|');
}

function shouldReplaceSwarmProgressMessage(
    existing: PresentedChatMessage,
    incoming: PresentedChatMessage
): boolean {
    const existingSignature = buildSwarmProgressMessageContentSignature(existing);
    const incomingSignature = buildSwarmProgressMessageContentSignature(incoming);
    if (existingSignature === incomingSignature) {
        return false;
    }

    return computeSwarmProgressMessageRichness(incoming) >= computeSwarmProgressMessageRichness(existing);
}

function computeSwarmProgressMessageRichness(message: PresentedChatMessage): number {
    const contentLength = typeof message.content === 'string' ? message.content.length : 0;
    const partsLength = Array.isArray(message.parts)
        ? JSON.stringify(message.parts).length
        : 0;
    const metadataLength = message.metadata ? JSON.stringify(message.metadata).length : 0;
    return contentLength + partsLength + metadataLength;
}

function normalizeSwarmProgressMessage(message: PresentedChatMessage): PresentedChatMessage {
    const normalized: PresentedChatMessage = {
        ...message
    };

    if (!normalized.id) {
        normalized.id = `swarm-progress:${Date.now()}:${++swarmProgressMessageCounter}`;
    }

    if (!normalized.timestamp) {
        normalized.timestamp = new Date().toISOString();
    }

    return normalized;
}

/**
 * Builds a user message for swarm operations
 * @param content - The message content
 * @param mode - The swarm mode
 * @param batchId - The batch ID
 * @returns The user message
 */
function buildSwarmUserMessage(content: string, mode: SwarmMode, batchId: string): PresentedChatMessage {
    return {
        id: `swarm-user:${Date.now()}:${++swarmMessageCounter}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        contextLabel: mode === 'broadcast'
            ? t('clusters.broadcast')
            : t('clusters.collaborate'),
        metadata: {
            swarmBatchId: batchId
        }
    };
}

/**
 * Decorates cluster agent log messages with context labels
 * @param messages - The messages to decorate
 * @param mode - The swarm mode
 * @returns The decorated messages
 */
function decorateClusterAgentLogMessages(
    messages: PresentedChatMessage[],
    mode: SwarmMode
): PresentedChatMessage[] {
    const contextLabel = mode === 'broadcast'
        ? t('clusters.agentViewBroadcast')
        : t('clusters.agentViewCollaborate');
    return messages.map((message: any) => ({
        ...message,
        contextLabel: message.contextLabel || contextLabel
    }));
}

function decorateLoadedSwarmConversationMessages(
    messages: PresentedChatMessage[],
    agents: Agent[],
    mode: SwarmMode
): PresentedChatMessage[] {
    const defaultContextLabel = mode === 'broadcast'
        ? t('clusters.broadcast')
        : t('clusters.collaborate');

    return messages.map((message: any) => {
        const resolvedAgentId = resolveSwarmMessageAgentId(message);
        return {
            ...message,
            agentId: message.agentId || resolvedAgentId || undefined,
            displayName: message.displayName || (resolvedAgentId ? resolveAgentLabel(agents, resolvedAgentId) : undefined),
            contextLabel: message.contextLabel || defaultContextLabel
        };
    });
}

/**
 * Builds an error trace message
 * @param displayName - The display name
 * @param contextLabel - The context label
 * @param error - The error message
 * @param agentId - Optional agent ID
 * @param entry - Optional broadcast result entry
 * @returns The error trace message
 */
function buildErrorTraceMessage(
    displayName: string,
    contextLabel: string,
    error?: string,
    agentId?: string,
    entry?: ClusterBroadcastResult
): PresentedChatMessage {
    return {
        id: `swarm-error:${Date.now()}:${++swarmMessageCounter}`,
        role: 'assistant',
        content: error || t('clusters.resultUnknownError'),
        timestamp: new Date().toISOString(),
        agentId,
        displayName,
        contextLabel,
        metadata: buildSwarmResultMetadata(entry)
    };
}

function isSwarmPermissionScopeError(error?: string): boolean {
    const normalized = String(error || '').toLowerCase();
    return normalized.includes('missing scope: operator.write')
        || normalized.includes('missing scope: operator.admin');
}

function buildSwarmPermissionScopeErrorMessage(error?: string): string {
    const details = String(error || '').trim() || 'missing scope: operator.write';
    return `Gateway permission error: ${details}. Update the configured gateway token to include the required operator scopes.`;
}

function throwIfSwarmPermissionError(error?: string): void {
    if (isSwarmPermissionScopeError(error)) {
        throw new Error(buildSwarmPermissionScopeErrorMessage(error));
    }
}

function findSwarmPermissionErrorFromEntries(entries: ClusterBroadcastResult[]): string | undefined {
    for (const entry of entries) {
        if (isSwarmPermissionScopeError(entry?.error)) {
            return entry.error || undefined;
        }
    }

    return undefined;
}

function findSwarmPermissionErrorFromCollaborationResult(result: ClusterCollaborationResult): string | undefined {
    for (const round of result.rounds || []) {
        for (const entry of Object.values(round.entries || {})) {
            if (isSwarmPermissionScopeError(entry?.error)) {
                return entry.error || undefined;
            }
        }
    }

    if (isSwarmPermissionScopeError(result.synthesis?.error)) {
        return result.synthesis?.error || undefined;
    }

    return undefined;
}

/**
 * Decorates a swarm result message with metadata
 * @param message - The chat message
 * @param entry - The broadcast result entry
 * @returns The decorated message
 */
function decorateSwarmResultMessage(message: PresentedChatMessage, entry: ClusterBroadcastResult): PresentedChatMessage {
    const swarmMetadata = buildSwarmResultMetadata(entry);
    return {
        ...message,
        metadata: {
            ...(message.metadata || {}),
            ...(swarmMetadata || {})
        }
    };
}

/**
 * Builds metadata for a swarm result
 * @param entry - The broadcast result entry
 * @returns The metadata object or undefined
 */
function buildSwarmResultMetadata(entry?: ClusterBroadcastResult): Record<string, unknown> | undefined {
    const elapsedMs = Number(entry?.timing?.elapsedMs);
    const metadata: Record<string, unknown> = {};

    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
        metadata.swarmLatencyMs = elapsedMs;
        metadata.swarmStartedAt = entry?.timing?.startedAt;
        metadata.swarmCompletedAt = entry?.timing?.completedAt;
    }
    if (entry?.agentId) {
        metadata.swarmSourceAgentId = entry.agentId;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Resolves the display label for an agent
 * @param agents - The list of agents
 * @param agentId - The agent ID
 * @returns The agent label
 */
function resolveAgentLabel(agents: Agent[], agentId: string): string {
    const agent = agents.find((item: any) => item.id === agentId);
    if (!agent) {
        return agentId;
    }

    return `${agent.name} (${agent.model})`;
}

function resolveSwarmMessageAgentId(message: PresentedChatMessage): string {
    if (typeof message.agentId === 'string' && message.agentId.trim()) {
        return message.agentId.trim();
    }

    const sourceAgentId = message.metadata?.swarmSourceAgentId;
    return typeof sourceAgentId === 'string' && sourceAgentId.trim()
        ? sourceAgentId.trim()
        : '';
}

/**
 * Gets the label for a collaboration round
 * @param kind - The round kind
 * @returns The round label
 */
function getCollaborationRoundLabel(descriptor: ClusterCollaborationRoundDescriptor): string {
    const translated = t(descriptor.labelKey, { round: descriptor.reviewRound });
    return translated && translated !== descriptor.labelKey
        ? translated
        : descriptor.fallbackLabel;
}

function buildFallbackRoundDescriptor(kind: ClusterCollaborationResult['rounds'][number]['kind']): ClusterCollaborationRoundDescriptor {
    if (kind === 'opening') {
        return {
            kind,
            phase: 'opening',
            reviewRound: 0,
            phaseIndex: 1,
            displayOrder: 1,
            labelKey: 'clusters.debateRoundOpening',
            fallbackLabel: 'Opening Positions'
        };
    }

    if (kind.startsWith('critique-')) {
        const reviewRound = Number(kind.slice('critique-'.length) || '1');
        return {
            kind,
            phase: 'critique',
            reviewRound,
            phaseIndex: 2,
            displayOrder: reviewRound * 2,
            labelKey: 'clusters.debateRoundCritiqueDynamic',
            fallbackLabel: `Review Round ${reviewRound}: Critique`
        };
    }

    const reviewRound = Number(kind.slice('revision-'.length) || '1');
    return {
        kind,
        phase: 'revision',
        reviewRound,
        phaseIndex: 3,
        displayOrder: (reviewRound * 2) + 1,
        labelKey: 'clusters.debateRoundRevisionDynamic',
        fallbackLabel: `Review Round ${reviewRound}: Revision`
    };
}

async function buildClusterSwarmRawLogMessages(
    context: ClusterActionContext,
    clusterId: string,
    mode: SwarmMode,
    swarmRunId?: string
): Promise<PresentedChatMessage[]> {
    const cluster = await context.clusterManager.getCluster(clusterId);
    if (!cluster) {
        return [];
    }

    const agents = await context.agentManager.getAgents();
    const merged = (
        await Promise.all(
            cluster.agentIds.map(async (agentId: any) => {
                const messages = await context.clusterManager.getClusterAgentSwarmMessages({
                    clusterId,
                    agentId,
                    mode,
                    swarmRunId
                });
                return messages.map((message: any) => decorateRawSwarmLogMessage(message, agents));
            })
        )
    ).flat();

    return merged.sort(compareRawSwarmMessages);
}

async function refreshClusterSwarmRawLog(
    context: ClusterActionContext,
    clusterId: string,
    swarmRunId?: string
): Promise<void> {
    const messages = await buildClusterSwarmRawLogMessages(context, clusterId, 'collaborate', swarmRunId);
    const runSummaries = await buildKnownSwarmRunSummaries(context, {
        clusterId,
        mode: 'collaborate',
        swarmRunId
    });
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId,
        mode: 'collaborate',
        outputMode: 'raw',
        messages,
        swarmRunId,
        knownRunIds: runSummaries.map((summary: any) => summary.runId),
        knownRuns: runSummaries
    });
}

async function buildKnownSwarmRunSummaries(
    context: ClusterActionContext,
    {
        clusterId,
        mode,
        swarmRunId
    }: {
        clusterId: string;
        mode: SwarmMode;
        swarmRunId?: string;
    }
): Promise<ClusterSwarmRunSummary[]> {
    const summaries = await context.clusterManager.listClusterSwarmRuns({ clusterId, mode });
    const normalizedRunId = String(swarmRunId || '').trim();
    if (!normalizedRunId) {
        return summaries;
    }

    if (summaries.some((summary: any) => summary.runId === normalizedRunId)) {
        return summaries;
    }

    return [{
        runId: normalizedRunId,
        clusterId,
        mode,
        status: 'running',
        phase: mode === 'broadcast' ? 'broadcast' : 'opening',
        currentRound: 1,
        startedAt: new Date().toISOString(),
        isActive: true
    }, ...summaries];
}

function decorateRawSwarmLogMessage(
    message: PresentedChatMessage,
    agents: Agent[]
): PresentedChatMessage {
    const agentId = typeof message.agentId === 'string' && message.agentId.trim()
        ? message.agentId.trim()
        : '';
    return {
        ...message,
        displayName: agentId ? resolveAgentLabel(agents, agentId) : message.displayName,
        contextLabel: buildRawSwarmContextLabel(message)
    };
}

function buildRawSwarmContextLabel(message: PresentedChatMessage): string {
    const metadata = message.metadata || {};
    const phase = typeof metadata.swarmPhase === 'string' ? metadata.swarmPhase.trim() : '';
    const logKind = typeof metadata.swarmLogKind === 'string' ? metadata.swarmLogKind.trim() : '';
    const fragments = ['Raw Log'];

    if (phase) {
        fragments.push(phase);
    }
    if (logKind) {
        fragments.push(logKind);
    }

    return fragments.join(' · ');
}

function compareRawSwarmMessages(left: PresentedChatMessage, right: PresentedChatMessage): number {
    const leftTime = Date.parse(String(left.timestamp || ''));
    const rightTime = Date.parse(String(right.timestamp || ''));
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    return String(left.id || '').localeCompare(String(right.id || ''));
}

/**
 * Attaches swarm batch metadata to a message
 * @param message - The chat message
 * @param batchId - The batch ID
 * @returns The message with batch metadata
 */
function attachSwarmBatchMetadata(message: PresentedChatMessage, batchId: string): PresentedChatMessage {
    return {
        ...message,
        metadata: {
            ...(message.metadata || {}),
            swarmBatchId: batchId
        }
    };
}

/**
 * Builds a unique batch ID for swarm operations
 * @param mode - The swarm mode
 * @returns The batch ID
 */
function buildSwarmBatchId(mode: SwarmMode): string {
    return `swarm-batch:${mode}:${Date.now()}:${++swarmBatchCounter}`;
}

/**
 * Counter for swarm messages
 */
let swarmMessageCounter = 0;
let swarmProgressMessageCounter = 0;

async function ensureClusterFolderForUngroupedAgents(
    context: ClusterActionContext,
    folderName: string,
    agentIds: string[]
): Promise<void> {
    const normalizedIds = agentIds.map((agentId: any) => String(agentId || '').trim()).filter(Boolean);
    if (normalizedIds.length === 0) {
        return;
    }

    const folders = await context.agentFolderManager.getFolders();
    const groupedAgentIds = new Set(folders.flatMap((folder: any) => folder.agentIds));
    const anyGrouped = normalizedIds.some((agentId: any) => groupedAgentIds.has(agentId));
    if (anyGrouped) {
        return;
    }

    const folder = await context.agentFolderManager.createFolder(folderName);
    for (const agentId of normalizedIds) {
        await context.agentFolderManager.moveAgentToFolder(agentId, folder.id);
    }
}

/**
 * Counter for swarm batches
 */
let swarmBatchCounter = 0;

/**
 * Creates a step progress reporter for long-running operations
 * @param progress - The VS Code progress object
 * @param totalSteps - The total number of steps
 * @returns The progress reporter with start and complete methods
 */
function createStepProgressReporter(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    totalSteps: number
): {
    start(message: string): void;
    complete(): void;
} {
    let completedSteps = 0;
    let reportedIncrement = 0;

    return {
        start(message: string) {
            progress.report({ message });
        },
        complete() {
            completedSteps += 1;
            const targetIncrement = Math.round((completedSteps / Math.max(1, totalSteps)) * 100);
            const increment = Math.max(0, targetIncrement - reportedIncrement);
            reportedIncrement = targetIncrement;
            progress.report({ increment });
        }
    };
}
