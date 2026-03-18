import * as vscode from 'vscode';

import { getClusterWorkModePresets, normalizeClusterWorkspaceConfig } from '../../config/clusterWorkModes';
import {
    buildClusterNameFromTemplate,
    getClusterMemberPresets,
    type ClusterMemberPreset
} from '../../config/clusterMemberPresets';
import { t } from '../../i18n';
import type { AgentCluster } from '../../services/openclawService';
import type { AgentManager } from '../../managers/agentManager';
import type { ChatSessionManager } from '../../managers/chatSessionManager';
import type {
    ClusterBroadcastResult,
    ClusterCollaborationProgressEvent,
    ClusterCollaborationResult,
    ClusterManager
} from '../../managers/clusterManager';
import type { Agent, ChatMessage } from '../../services/openclawService';
import { showSuccessStatus } from '../../utils/statusFeedback';
import { normalizeOutgoingMessageContent } from './helpers';

/**
 * Context interface for cluster action operations
 */
interface ClusterActionContext {
    clusterManager: ClusterManager;
    agentManager: AgentManager;
    clusterSessionManager: ChatSessionManager;
    postMessage(message: Record<string, unknown>): void;
    loadAgents(): Promise<void>;
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

/**
 * Type for swarm operation modes
 */
type SwarmMode = 'broadcast' | 'collaborate';

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
        context.postMessage({
            type: 'clustersLoaded',
            clusters,
            selectedClusterId,
            workModePresets: getClusterWorkModePresets(),
            memberPresets: getClusterMemberPresets()
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
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    try {
        const agents = await context.agentManager.getAgents();
        const progress = await initializeClusterSwarmProgress(context, clusterId, 'broadcast', message);
        const responses = await context.clusterManager.broadcastToCluster(clusterId, message, {
            onAgentResult: async (_agentId, entry) => {
                if (context.getClusterSwarmRunToken() !== swarmRunToken) {
                    return;
                }

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
        });

        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            const conversationMessages = await finalizeClusterSwarmProgress(
                context,
                progress,
                buildBroadcastConversationMessages(
                    responses,
                    agents
                )
            );
            context.postMessage({
                type: 'replaceSwarmMessages',
                clusterId,
                mode: 'broadcast',
                messages: conversationMessages
            });
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
    const runningAgentIds = await beginClusterAgentRuns(context, clusterId);
    try {
        const agents = await context.agentManager.getAgents();
        const progress = await initializeClusterSwarmProgress(context, clusterId, 'collaborate', message);
        const result = await context.clusterManager.collaborateOnCluster(clusterId, normalizeOutgoingMessageContent(message), {
            coordinatorAgentId: context.getCurrentAgentId() || undefined,
            onProgress: async (event: ClusterCollaborationProgressEvent) => {
                if (context.getClusterSwarmRunToken() !== swarmRunToken) {
                    return;
                }

                await appendClusterSwarmProgressMessages(
                    context,
                    progress,
                    buildConversationMessagesForProgressEvent(event, agents)
                );
            }
        });

        if (context.getClusterSwarmRunToken() === swarmRunToken) {
            const conversationMessages = await finalizeClusterSwarmProgress(
                context,
                progress,
                buildCollaborationConversationMessages(
                    result,
                    agents
                )
            );
            context.postMessage({
                type: 'replaceSwarmMessages',
                clusterId,
                mode: 'collaborate',
                messages: conversationMessages
            });
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
    mode: SwarmMode
): Promise<void> {
    if (!clusterId || (mode !== 'broadcast' && mode !== 'collaborate')) {
        return;
    }

    try {
        context.postMessage({
            type: 'setClusterSwarmContextLoading',
            clusterId,
            mode,
            loading: true
        });

        const messages = await context.clusterManager.getClusterSwarmMessages(clusterId, mode);
        context.postMessage({
            type: 'replaceSwarmMessages',
            clusterId,
            mode,
            messages
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
            loading: false
        });
    }
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

        const sessionId = await context.clusterManager.ensureClusterAgentSessionId(clusterId, agentId);
        const session = await context.clusterSessionManager.getOrCreateSession(agentId, {
            refreshHistory: true,
            sessionId
        });
        context.clusterSessionManager.setCurrentSession(session.id);
        const persistedMessages = await context.clusterManager.getClusterAgentMessages(clusterId, agentId);
        const resolvedMessages = session.messages.length > 0 ? session.messages : persistedMessages;
        session.messages = resolvedMessages;

        if (resolvedMessages.length > 0) {
            await context.clusterManager.replaceClusterAgentMessages(clusterId, agentId, resolvedMessages);
        }

        context.postMessage({
            type: 'replaceClusterMessages',
            clusterId,
            agentId,
            messages: resolvedMessages
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
            await context.clusterManager.replaceClusterAgentMessages(clusterId, agentId, messages);
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
    mode: SwarmMode
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
            loading: true
        });

        const messages = await context.clusterManager.getClusterAgentSwarmMessages(clusterId, agentId, mode);
        context.postMessage({
            type: 'replaceClusterAgentSwarmMessages',
            clusterId,
            agentId,
            mode,
            messages: decorateClusterAgentLogMessages(messages, mode)
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
            loading: false
        });
    }
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

        let sessionId = await context.clusterManager.ensureClusterAgentSessionId(clusterId, agentId);
        if (command === 'new') {
            sessionId = await context.clusterManager.resetClusterAgentSessionId(clusterId, agentId);
        }
        await context.clusterManager.clearClusterAgentMessages(clusterId, agentId);

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
                await context.clusterManager.clearClusterAgentMessages(clusterId, agentId);
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
    data: {
        name?: string;
        agentIds?: string[];
        createAgents?: Array<{
            name?: string;
            model?: string;
            systemPrompt?: string;
            presetId?: string;
            enabledSkills?: string[];
        }>;
        workspaceConfig?: Record<string, unknown>;
    }
): Promise<void> {
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const existingAgentIds = Array.isArray(data?.agentIds)
        ? data.agentIds.map(agentId => String(agentId || '').trim()).filter(Boolean)
        : [];
    const createAgents = Array.isArray(data?.createAgents)
        ? data.createAgents
            .map(agent => ({
                name: typeof agent?.name === 'string' ? agent.name.trim() : '',
                model: typeof agent?.model === 'string' ? agent.model.trim() : '',
                systemPrompt: typeof agent?.systemPrompt === 'string' ? agent.systemPrompt.trim() : '',
                presetId: typeof agent?.presetId === 'string' ? agent.presetId.trim() : undefined,
                enabledSkills: Array.isArray(agent?.enabledSkills) ? agent.enabledSkills.filter(Boolean) : undefined
            }))
            .filter(agent => agent.name)
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
        async progress => {
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
                    ? await context.clusterManager.updateCluster(clusterId, {
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
                    await Promise.allSettled(createdAgentIds.map(agentId => context.agentManager.deleteAgent(agentId)));
                    await context.loadAgents();
                }
                vscode.window.showErrorMessage(t(clusterId ? 'clusters.updateFailed' : 'clusters.createFailed', { error: String(error) }));
            }
        }
    );
}

/**
 * Parameters for creating a cluster from a member preset
 */
export interface CreateClusterFromPresetParams {
    memberPresetId: string;
    customName?: string;
    model?: string;
}

/**
 * Handles creating a cluster from a member preset
 * @param context - The cluster action context
 * @param params - The creation parameters
 */
export async function handleCreateClusterFromMemberPreset(
    context: ClusterActionContext,
    params: CreateClusterFromPresetParams
): Promise<void> {
    const { memberPresetId, customName, model } = params;
    
    const memberPresets = getClusterMemberPresets();
    const preset = memberPresets.find(p => p.id === memberPresetId);
    
    if (!preset) {
        vscode.window.showErrorMessage(t('clusters.memberPresetNotFound', { presetId: memberPresetId }));
        return;
    }

    const clusterName = customName?.trim() || buildClusterNameFromTemplate(preset.nameTemplate);
    
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
        async progress => {
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
                    
                    const existingAgent = agents.find(a => a.name === agentName);
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

                const rootBlueprint = preset.memberBlueprints.find(b => b.isCoordinator) || preset.memberBlueprints[0];
                const coordinatorAgentId = rootBlueprint ? agentIdMap.get(rootBlueprint.id) : undefined;

                const memberProfiles: Record<string, { parentAgentId?: string; activation?: { keywords?: string[]; swarmModes?: ('broadcast' | 'collaborate')[] } }> = {};
                
                for (const blueprint of preset.memberBlueprints) {
                    const agentId = agentIdMap.get(blueprint.id);
                    if (!agentId) continue;

                    const profile: { parentAgentId?: string; activation?: { keywords?: string[]; swarmModes?: ('broadcast' | 'collaborate')[] } } = {};
                    
                    if (blueprint.parentId) {
                        const parentAgentId = agentIdMap.get(blueprint.parentId);
                        if (parentAgentId) {
                            profile.parentAgentId = parentAgentId;
                        }
                    }
                    
                    if (blueprint.activation) {
                        profile.activation = blueprint.activation;
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
                    await Promise.allSettled(createdAgentIds.map(agentId => context.agentManager.deleteAgent(agentId)));
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
    userMessage: string
): Promise<{
    clusterId: string;
    mode: SwarmMode;
    batchId: string;
    messages: PresentedChatMessage[];
    seenKeys: Set<string>;
}> {
    const persistedMessages = await context.clusterManager.getClusterSwarmMessages(clusterId, mode);
    const batchId = buildSwarmBatchId(mode);
    const messages = [
        ...persistedMessages,
        buildSwarmUserMessage(userMessage, mode, batchId)
    ];
    await context.clusterManager.replaceClusterSwarmMessages(clusterId, mode, messages);
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId,
        mode,
        messages,
        keepPending: true
    });

    return {
        clusterId,
        mode,
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
        batchId: string;
        messages: PresentedChatMessage[];
        seenKeys: Set<string>;
    },
    messages: PresentedChatMessage[]
): Promise<void> {
    const nextMessages = messages
        .map(message => attachSwarmBatchMetadata(message, progress.batchId))
        .filter(message => {
            const key = buildSwarmProgressMessageKey(message);
            if (progress.seenKeys.has(key)) {
                return false;
            }
            progress.seenKeys.add(key);
            return true;
        });

    if (nextMessages.length === 0) {
        return;
    }

    progress.messages.push(...nextMessages);
    await context.clusterManager.replaceClusterSwarmMessages(progress.clusterId, progress.mode, progress.messages);
    context.postMessage({
        type: 'replaceSwarmMessages',
        clusterId: progress.clusterId,
        mode: progress.mode,
        messages: progress.messages,
        keepPending: true
    });
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
        batchId: string;
        messages: PresentedChatMessage[];
        seenKeys: Set<string>;
    },
    assistantMessages: PresentedChatMessage[]
): Promise<PresentedChatMessage[]> {
    await appendClusterSwarmProgressMessages(context, progress, assistantMessages);
    await context.clusterManager.replaceClusterSwarmMessages(progress.clusterId, progress.mode, progress.messages);
    return progress.messages;
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
function buildCollaborationConversationMessages(
    result: ClusterCollaborationResult,
    agents: Agent[]
): PresentedChatMessage[] {
    const messages: PresentedChatMessage[] = [];
    const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
        ? result.rounds
        : [{
            kind: 'revision-2' as const,
            entries: result.contributions || {}
        }];
    const coordinatorLabel = result.coordinatorAgentId
        ? resolveAgentLabel(agents, result.coordinatorAgentId)
        : t('clusters.targetSwarm');

    for (const round of rounds) {
        const roundLabel = getCollaborationRoundLabel(round.kind);
        for (const [agentId, entry] of Object.entries(round.entries || {})) {
            messages.push(...buildConversationMessagesForEntry(
                entry,
                resolveAgentLabel(agents, agentId),
                roundLabel
            ));
        }
    }

    messages.push(result.synthesis?.ok && result.synthesis.message
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
        getCollaborationRoundLabel(event.roundKind)
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
    const seen = new Set<string>();

    for (const message of source) {
        if (!message) {
            continue;
        }

        const id = message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);

        deduped.push({
            ...decorateSwarmResultMessage(message, entry),
            displayName,
            contextLabel
        });
    }

    return deduped;
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
    const hasFinalMessage = trace.some(message => buildTraceDeduplicationKey(message) === finalKey);
    if (hasFinalMessage) {
        return trace;
    }

    const hasAssistantResult = trace.some(message => message?.role === 'assistant');
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
    return `${buildTraceDeduplicationKey(message)}:${message.displayName || ''}:${message.contextLabel || ''}`;
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
    return messages.map(message => ({
        ...message,
        contextLabel: message.contextLabel || contextLabel
    }));
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

/**
 * Decorates a swarm result message with metadata
 * @param message - The chat message
 * @param entry - The broadcast result entry
 * @returns The decorated message
 */
function decorateSwarmResultMessage(message: PresentedChatMessage, entry: ClusterBroadcastResult): PresentedChatMessage {
    return {
        ...message,
        metadata: {
            ...(message.metadata || {}),
            ...buildSwarmResultMetadata(entry)
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
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return undefined;
    }

    return {
        swarmLatencyMs: elapsedMs,
        swarmStartedAt: entry?.timing?.startedAt,
        swarmCompletedAt: entry?.timing?.completedAt
    };
}

/**
 * Resolves the display label for an agent
 * @param agents - The list of agents
 * @param agentId - The agent ID
 * @returns The agent label
 */
function resolveAgentLabel(agents: Agent[], agentId: string): string {
    const agent = agents.find(item => item.id === agentId);
    if (!agent) {
        return agentId;
    }

    return `${agent.name} (${agent.model})`;
}

/**
 * Gets the label for a collaboration round
 * @param kind - The round kind
 * @returns The round label
 */
function getCollaborationRoundLabel(kind: ClusterCollaborationResult['rounds'][number]['kind']): string {
    const keyMap: Record<string, string> = {
        opening: 'clusters.debateRoundOpening',
        'critique-1': 'clusters.debateRoundCritique1',
        'revision-1': 'clusters.debateRoundRevision1',
        'critique-2': 'clusters.debateRoundCritique2',
        'revision-2': 'clusters.debateRoundRevision2'
    };

    if (keyMap[kind]) {
        return t(keyMap[kind]);
    }

    if (kind === 'opening') {
        return t('clusters.debateRoundOpening');
    }

    if (kind.startsWith('critique-')) {
        const round = Number(kind.slice('critique-'.length) || '1');
        return t('clusters.debateRoundCritiqueDynamic', { round });
    }

    if (kind.startsWith('revision-')) {
        const round = Number(kind.slice('revision-'.length) || '1');
        return t('clusters.debateRoundRevisionDynamic', { round });
    }

    return t('clusters.contributions');
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
