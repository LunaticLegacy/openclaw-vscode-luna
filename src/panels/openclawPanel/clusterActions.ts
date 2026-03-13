import * as vscode from 'vscode';

import { getClusterWorkModePresets } from '../../config/clusterWorkModes';
import { t } from '../../i18n';
import type { AgentCluster } from '../../services/openclawService';
import type { AgentManager } from '../../managers/agentManager';
import type { ChatSessionManager } from '../../managers/chatSessionManager';
import type {
    ClusterBroadcastResult,
    ClusterCollaborationResult,
    ClusterManager
} from '../../managers/clusterManager';
import type { Agent, ChatMessage } from '../../services/openclawService';
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

type SwarmMode = 'broadcast' | 'collaborate';
type PresentedChatMessage = ChatMessage;

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
            const conversationMessages = await appendClusterSwarmMessages(
                context,
                clusterId,
                'broadcast',
                message,
                buildBroadcastConversationMessages(
                    responses,
                    await context.agentManager.getAgents()
                )
            );
            context.postMessage({
                type: 'replaceSwarmMessages',
                clusterId,
                mode: 'broadcast',
                messages: conversationMessages
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
            const conversationMessages = await appendClusterSwarmMessages(
                context,
                clusterId,
                'collaborate',
                message,
                buildCollaborationConversationMessages(
                    result,
                    await context.agentManager.getAgents()
                )
            );
            context.postMessage({
                type: 'replaceSwarmMessages',
                clusterId,
                mode: 'collaborate',
                messages: conversationMessages
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
            await context.clusterManager.replaceClusterAgentMessages(clusterId, agentId, messages);
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

async function appendClusterSwarmMessages(
    context: ClusterActionContext,
    clusterId: string,
    mode: SwarmMode,
    userMessage: string,
    assistantMessages: PresentedChatMessage[]
): Promise<PresentedChatMessage[]> {
    const persistedMessages = await context.clusterManager.getClusterSwarmMessages(clusterId, mode);
    const batchId = buildSwarmBatchId(mode);
    const nextMessages = [
        ...persistedMessages,
        buildSwarmUserMessage(userMessage, mode, batchId),
        ...assistantMessages.map(message => attachSwarmBatchMetadata(message, batchId))
    ];
    await context.clusterManager.replaceClusterSwarmMessages(clusterId, mode, nextMessages);
    return nextMessages;
}

function buildBroadcastConversationMessages(
    responses: Record<string, ClusterBroadcastResult>,
    agents: Agent[]
): PresentedChatMessage[] {
    const messages: PresentedChatMessage[] = [];
    for (const entry of Object.values(responses || {})) {
        const displayName = resolveAgentLabel(agents, entry.agentId);
        const contextLabel = t('clusters.broadcast');
        if (entry.ok) {
            messages.push(...buildAgentTraceMessages(entry, displayName, contextLabel));
            continue;
        }

        messages.push(buildErrorTraceMessage(displayName, contextLabel, entry.error));
    }

    return messages;
}

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
            if (entry.ok) {
                messages.push(...buildAgentTraceMessages(
                    entry,
                    resolveAgentLabel(agents, agentId),
                    roundLabel
                ));
                continue;
            }

            messages.push(buildErrorTraceMessage(
                resolveAgentLabel(agents, agentId),
                roundLabel,
                entry.error
            ));
        }
    }

    messages.push(result.synthesis?.ok && result.synthesis.message
        ? {
            ...result.synthesis.message,
            displayName: t('clusters.finalAnswer'),
            contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
        }
        : buildErrorTraceMessage(
            t('clusters.finalAnswer'),
            `${t('clusters.coordinator')}: ${coordinatorLabel}`,
            result.synthesis?.error || t('clusters.noSuccessfulAgents')
        ));

    return messages;
}

function buildAgentTraceMessages(
    entry: ClusterBroadcastResult,
    displayName: string,
    contextLabel: string
): PresentedChatMessage[] {
    const trace = Array.isArray(entry.trace) ? entry.trace : [];
    const source = trace.length > 0
        ? trace
        : (entry.message ? [entry.message] : []);
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
            ...message,
            displayName,
            contextLabel
        });
    }

    return deduped;
}

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

function buildErrorTraceMessage(displayName: string, contextLabel: string, error?: string): PresentedChatMessage {
    return {
        id: `swarm-error:${Date.now()}:${++swarmMessageCounter}`,
        role: 'assistant',
        content: error || t('clusters.resultUnknownError'),
        timestamp: new Date().toISOString(),
        displayName,
        contextLabel
    };
}

function resolveAgentLabel(agents: Agent[], agentId: string): string {
    const agent = agents.find(item => item.id === agentId);
    if (!agent) {
        return agentId;
    }

    return `${agent.name} (${agent.model})`;
}

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

function attachSwarmBatchMetadata(message: PresentedChatMessage, batchId: string): PresentedChatMessage {
    return {
        ...message,
        metadata: {
            ...(message.metadata || {}),
            swarmBatchId: batchId
        }
    };
}

function buildSwarmBatchId(mode: SwarmMode): string {
    return `swarm-batch:${mode}:${Date.now()}:${++swarmBatchCounter}`;
}

let swarmMessageCounter = 0;
let swarmBatchCounter = 0;
