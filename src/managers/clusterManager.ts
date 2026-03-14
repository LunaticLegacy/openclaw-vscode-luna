import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    createDefaultClusterWorkspaceConfig,
    MAX_CLUSTER_WORK_MODE_ROUNDS,
    normalizeClusterWorkspaceConfig
} from '../config/clusterWorkModes';
import { t } from '../i18n';
import {
    Agent,
    AgentCluster,
    ChatMessage,
    ClusterWorkspaceConfig,
    OpenClawService
} from '../services/openclawService';

export interface CreateClusterParams {
    name: string;
    agentIds: string[];
    workspaceConfig?: ClusterWorkspaceConfig;
}

export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
    status?: AgentCluster['status'];
    workspaceConfig?: ClusterWorkspaceConfig;
}

export interface ClusterStats {
    totalClusters: number;
    activeClusters: number;
    totalAgents: number;
    avgAgentsPerCluster: number;
}

export interface ClusterBroadcastResult {
    agentId: string;
    ok: boolean;
    message?: ChatMessage;
    trace?: ChatMessage[];
    error?: string;
}

export interface BroadcastClusterOptions {
    onAgentResult?: (agentId: string, result: ClusterBroadcastResult) => Promise<void> | void;
}

export type ClusterCollaborationProgressEvent =
    | {
        kind: 'round-entry';
        roundKind: ClusterCollaborationRoundKind;
        agentId: string;
        entry: ClusterBroadcastResult;
    }
    | {
        kind: 'synthesis';
        coordinatorAgentId: string | null;
        entry: ClusterBroadcastResult | null;
    };

export interface CollaborateClusterOptions {
    coordinatorAgentId?: string;
    onProgress?: (event: ClusterCollaborationProgressEvent) => Promise<void> | void;
}

export type ClusterCollaborationRoundKind =
    | 'opening'
    | `critique-${number}`
    | `revision-${number}`;

export interface ClusterCollaborationRound {
    kind: ClusterCollaborationRoundKind;
    entries: Record<string, ClusterBroadcastResult>;
}

export interface ClusterCollaborationResult {
    clusterId: string;
    clusterName: string;
    userMessage: string;
    coordinatorAgentId: string | null;
    rounds: ClusterCollaborationRound[];
    contributions: Record<string, ClusterBroadcastResult>;
    synthesis: ClusterBroadcastResult | null;
}

export interface ClusterAgentContextSnapshot {
    directMessages: ChatMessage[];
    broadcastMessages: ChatMessage[];
    collaborateMessages: ChatMessage[];
}

interface PersistedClustersFile {
    version: number;
    clusters: AgentCluster[];
    workspaceConfigs?: Record<string, ClusterWorkspaceConfig>;
    clusterAgentSessions?: Record<string, string>;
    clusterAgentMessages?: Record<string, ChatMessage[]>;
    swarmSessions?: Record<string, string>;
    clusterSwarmMessages?: Record<string, ChatMessage[]>;
}

const CLUSTER_AGENT_RESPONSE_TIMEOUT_MS = 45000;

export class ClusterManager extends EventEmitter {
    private service: OpenClawService;
    private clusters: Map<string, AgentCluster> = new Map();
    private workspaceConfigs: Map<string, ClusterWorkspaceConfig> = new Map();
    private clusterAgentSessionIds: Map<string, string> = new Map();
    private clusterAgentMessages: Map<string, ChatMessage[]> = new Map();
    private clusterSwarmMessages: Map<string, ChatMessage[]> = new Map();
    private storageFilePath: string;
    private persistedStateLoaded = false;
    private persistedStateLoadPromise: Promise<void> | null = null;
    private swarmSessionIds: Map<string, string> = new Map();

    constructor(service: OpenClawService, storageFilePath: string) {
        super();
        this.service = service;
        this.storageFilePath = storageFilePath;
        this.setupListeners();
    }

    private setupListeners() {
        this.service.on('clusterCreated', (cluster: AgentCluster) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.set(cluster.id, cluster);
            this.emit('clusterCreated', cluster);
        });

        this.service.on('clusterUpdated', (cluster: AgentCluster) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.set(cluster.id, cluster);
            this.emit('clusterUpdated', cluster);
        });

        this.service.on('clusterDeleted', (clusterId: string) => {
            if (!this.service.supportsRemoteClusters()) {
                return;
            }

            this.clusters.delete(clusterId);
            this.emit('clusterDeleted', clusterId);
        });
    }

    public async getClusters(refresh: boolean = false): Promise<AgentCluster[]> {
        await this.ensurePersistedStateLoaded(refresh);

        if (this.service.supportsRemoteClusters()) {
            if (refresh || this.clusters.size === 0) {
                const clusters = await this.service.getClusters();
                this.clusters.clear();
                clusters.forEach(cluster => this.clusters.set(cluster.id, this.applyWorkspaceConfig(cluster)));
            }
            return Array.from(this.clusters.values()).map(cluster => this.applyWorkspaceConfig(cluster));
        }

        return Array.from(this.clusters.values()).map(cluster => this.applyWorkspaceConfig(cluster));
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        await this.ensurePersistedStateLoaded();

        if (this.service.supportsRemoteClusters()) {
            if (this.clusters.has(clusterId)) {
                return this.applyWorkspaceConfig(this.clusters.get(clusterId)!);
            }

            const cluster = await this.service.getCluster(clusterId);
            if (cluster) {
                this.clusters.set(clusterId, this.applyWorkspaceConfig(cluster));
            }
            return cluster ? this.applyWorkspaceConfig(cluster) : null;
        }

        const cluster = this.clusters.get(clusterId) || null;
        return cluster ? this.applyWorkspaceConfig(cluster) : null;
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        await this.ensurePersistedStateLoaded();
        const workspaceConfig = normalizeClusterWorkspaceConfig(params.workspaceConfig);

        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.createCluster({
                name: params.name,
                agentIds: params.agentIds
            });
            this.workspaceConfigs.set(cluster.id, workspaceConfig);
            await this.persistState();
            const resolvedCluster = this.applyWorkspaceConfig(cluster);
            this.clusters.set(cluster.id, resolvedCluster);
            this.reconcileClusterAgentSessions(cluster.id, resolvedCluster.agentIds);
            return resolvedCluster;
        }

        const cluster: AgentCluster = {
            id: buildClusterId(params.name),
            name: params.name.trim(),
            agentIds: uniqueAgentIds(params.agentIds),
            status: 'active',
            createdAt: new Date().toISOString(),
            workspaceConfig
        };

        const resolvedCluster = this.applyWorkspaceConfig(cluster);
        this.clusters.set(cluster.id, resolvedCluster);
        this.reconcileClusterAgentSessions(cluster.id, resolvedCluster.agentIds);
        await this.persistState();
        this.emit('clusterCreated', resolvedCluster);
        return resolvedCluster;
    }

    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.updateCluster(clusterId, {
                name: params.name,
                agentIds: params.agentIds
            });
            if (params.workspaceConfig !== undefined) {
                this.workspaceConfigs.set(clusterId, normalizeClusterWorkspaceConfig(params.workspaceConfig));
                await this.persistState();
            }
            const resolvedCluster = this.applyWorkspaceConfig({
                ...cluster,
                ...(params.status !== undefined ? { status: params.status } : {})
            });
            this.clusters.set(clusterId, resolvedCluster);
            this.reconcileClusterAgentSessions(clusterId, resolvedCluster.agentIds);
            return resolvedCluster;
        }

        await this.ensurePersistedStateLoaded(false);
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        const updatedCluster: AgentCluster = {
            ...cluster,
            ...(params.name !== undefined ? { name: params.name.trim() } : {}),
            ...(params.agentIds !== undefined ? { agentIds: uniqueAgentIds(params.agentIds) } : {}),
            ...(params.status !== undefined ? { status: params.status } : {}),
            ...(params.workspaceConfig !== undefined
                ? { workspaceConfig: normalizeClusterWorkspaceConfig(params.workspaceConfig) }
                : {})
        };
        // i should update workspace config
        const resolvedCluster = this.applyWorkspaceConfig(updatedCluster);
        this.clusters.set(clusterId, updatedCluster);
        this.reconcileClusterAgentSessions(clusterId, resolvedCluster.agentIds);
        await this.persistState();
        this.emit('clusterUpdated', updatedCluster);
        return updatedCluster;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.service.supportsRemoteClusters()) {
            await this.service.deleteCluster(clusterId);
            this.clusters.delete(clusterId);
            this.workspaceConfigs.delete(clusterId);
            this.clearClusterAgentSessionsForCluster(clusterId);
            this.clearClusterAgentMessagesForCluster(clusterId);
            this.clearClusterSwarmMessagesForCluster(clusterId);
            this.clearSwarmSessionsForCluster(clusterId);
            await this.persistState();
            return;
        }

        await this.ensurePersistedStateLoaded();
        this.clusters.delete(clusterId);
        this.workspaceConfigs.delete(clusterId);
        this.clearClusterAgentSessionsForCluster(clusterId);
        this.clearClusterAgentMessagesForCluster(clusterId);
        this.clearClusterSwarmMessagesForCluster(clusterId);
        this.clearSwarmSessionsForCluster(clusterId);
        await this.persistState();
        this.emit('clusterDeleted', clusterId);
    }

    public async broadcastToCluster(
        clusterId: string,
        message: string,
        options: BroadcastClusterOptions = {}
    ): Promise<Record<string, ClusterBroadcastResult>> {
        if (this.service.supportsRemoteClusters()) {
            const responses = await this.service.sendToCluster(clusterId, message);
            return Object.fromEntries(
                Object.entries(responses).map(([agentId, response]) => [
                    agentId,
                    {
                        agentId,
                        ok: true,
                        message: response
                    } satisfies ClusterBroadcastResult
                ])
            );
        }

        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        const participantAgentIds = resolveSwarmParticipantAgentIds(
            cluster.agentIds,
            workspaceConfigOrDefault(cluster.workspaceConfig),
            'broadcast',
            message
        );
        if (participantAgentIds.length === 0) {
            throw new Error(t('clusterManager.noEligibleAgents'));
        }

        const results = await this.sendMessageToAgents(participantAgentIds, message, {
            clusterId,
            mode: 'broadcast',
            onAgentResult: options.onAgentResult
        });

        await this.updateCluster(clusterId, { status: 'active' });
        return results;
    }

    public async collaborateOnCluster(
        clusterId: string,
        message: string,
        options: CollaborateClusterOptions = {}
    ): Promise<ClusterCollaborationResult> {
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }
        const workspaceConfig = normalizeClusterWorkspaceConfig(cluster.workspaceConfig);
        const initialParticipantAgentIds = resolveSwarmParticipantAgentIds(
            cluster.agentIds,
            workspaceConfig,
            'collaborate',
            message
        );
        if (initialParticipantAgentIds.length === 0) {
            throw new Error(t('clusterManager.noEligibleAgents'));
        }

        const debateSessionIds = new Map<string, string>();
        const rounds: ClusterCollaborationRound[] = [];

        const openingEntries = await this.sendMessageToAgents(initialParticipantAgentIds, agentId => buildOpeningContributionPrompt(
            cluster.name,
            message,
            workspaceConfig,
            agentId
        ), {
            clusterId: cluster.id,
            mode: 'collaborate',
            debateSessionIds,
            onAgentResult: (agentId, entry) => options.onProgress?.({
                kind: 'round-entry',
                roundKind: 'opening',
                agentId,
                entry
            })
        });
        rounds.push({
            kind: 'opening',
            entries: openingEntries
        });

        let latestUsableContributions = openingEntries;
        let successfulAgentIds = getSuccessfulAgentIds(initialParticipantAgentIds, latestUsableContributions);

        for (const debateRound of buildCollaborationDebateRounds(workspaceConfig.rounds)) {
            if (successfulAgentIds.length === 0) {
                break;
            }

            const critiqueEntries = await this.sendMessageToAgents(successfulAgentIds, agentId => buildPeerReviewPrompt(
                cluster.name,
                message,
                workspaceConfig,
                agentId,
                successfulAgentIds,
                latestUsableContributions,
                debateRound.reviewRound
            ), {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                onAgentResult: (agentId, entry) => options.onProgress?.({
                    kind: 'round-entry',
                    roundKind: debateRound.critiqueKind,
                    agentId,
                    entry
                })
            });
            rounds.push({
                kind: debateRound.critiqueKind,
                entries: critiqueEntries
            });

            const revisionEntries = await this.sendMessageToAgents(successfulAgentIds, agentId => buildRevisionPrompt(
                cluster.name,
                message,
                workspaceConfig,
                agentId,
                successfulAgentIds,
                latestUsableContributions,
                critiqueEntries,
                debateRound.reviewRound
            ), {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds,
                onAgentResult: (agentId, entry) => options.onProgress?.({
                    kind: 'round-entry',
                    roundKind: debateRound.revisionKind,
                    agentId,
                    entry
                })
            });
            rounds.push({
                kind: debateRound.revisionKind,
                entries: revisionEntries
            });

            latestUsableContributions = mergeLatestSuccessfulEntries(
                initialParticipantAgentIds,
                revisionEntries,
                latestUsableContributions
            );
            successfulAgentIds = getSuccessfulAgentIds(initialParticipantAgentIds, latestUsableContributions);
        }

        const coordinatorAgentId = resolveCoordinatorAgentId(
            cluster.agentIds,
            successfulAgentIds,
            workspaceConfig.coordinatorAgentId,
            options.coordinatorAgentId
        );

        let synthesis: ClusterBroadcastResult | null = null;
        if (coordinatorAgentId && successfulAgentIds.length > 0) {
            const synthesisPrompt = await this.buildSynthesisPrompt(
                cluster,
                message,
                workspaceConfig,
                coordinatorAgentId,
                successfulAgentIds,
                latestUsableContributions,
                rounds
            );
            synthesis = await this.sendMessageToAgent(coordinatorAgentId, synthesisPrompt, {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds
            });
            await options.onProgress?.({
                kind: 'synthesis',
                coordinatorAgentId,
                entry: synthesis
            });
        }

        await this.updateCluster(clusterId, { status: 'active' });

        return {
            clusterId: cluster.id,
            clusterName: cluster.name,
            userMessage: message,
            coordinatorAgentId,
            rounds,
            contributions: latestUsableContributions,
            synthesis
        };
    }

    public getClusterStats(): ClusterStats {
        const clusters = Array.from(this.clusters.values());
        const totalAgents = clusters.reduce((sum, cluster) => sum + cluster.agentIds.length, 0);

        return {
            totalClusters: clusters.length,
            activeClusters: clusters.filter(cluster => cluster.status === 'active').length,
            totalAgents,
            avgAgentsPerCluster: clusters.length > 0 ? totalAgents / clusters.length : 0
        };
    }

    public getClustersByAgent(agentId: string): AgentCluster[] {
        return Array.from(this.clusters.values()).filter(cluster =>
            cluster.agentIds.includes(agentId)
        );
    }

    public async addAgentToCluster(clusterId: string, agentId: string): Promise<void> {
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        if (!cluster.agentIds.includes(agentId)) {
            await this.updateCluster(clusterId, {
                agentIds: [...cluster.agentIds, agentId]
            });
        }
    }

    public async removeAgentFromCluster(clusterId: string, agentId: string): Promise<void> {
        const cluster = await this.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        await this.updateCluster(clusterId, {
            agentIds: cluster.agentIds.filter(id => id !== agentId)
        });
    }

    public async ensureClusterAgentSessionId(clusterId: string, agentId: string): Promise<string> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey(clusterId, agentId);
        const existing = this.clusterAgentSessionIds.get(key);
        if (existing) {
            return existing;
        }

        const sessionId = buildClusterAgentSessionId(clusterId, agentId);
        this.clusterAgentSessionIds.set(key, sessionId);
        await this.persistState();
        return sessionId;
    }

    public async resetClusterAgentSessionId(clusterId: string, agentId: string): Promise<string> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey(clusterId, agentId);
        const sessionId = buildClusterAgentSessionId(clusterId, agentId);
        this.clusterAgentSessionIds.set(key, sessionId);
        await this.persistState();
        return sessionId;
    }

    public async getClusterAgentMessages(clusterId: string, agentId: string): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        return cloneChatMessages(
            this.clusterAgentMessages.get(this.buildClusterAgentSessionStorageKey(clusterId, agentId)) || []
        );
    }

    public async replaceClusterAgentMessages(clusterId: string, agentId: string, messages: ChatMessage[]): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey(clusterId, agentId);
        const normalizedMessages = normalizePersistedChatMessages(messages);

        if (normalizedMessages.length > 0) {
            this.clusterAgentMessages.set(key, normalizedMessages);
        } else {
            this.clusterAgentMessages.delete(key);
        }

        await this.persistState();
    }

    public async clearClusterAgentMessages(clusterId: string, agentId: string): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterAgentSessionStorageKey(clusterId, agentId);
        if (!this.clusterAgentMessages.delete(key)) {
            return;
        }

        await this.persistState();
    }

    public async getClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate'
    ): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        const sessionId = this.swarmSessionIds.get(this.buildSwarmSessionKey(clusterId, mode, agentId));
        if (!sessionId) {
            return [];
        }

        const messages = await this.service.getChatHistory(sessionId).catch(() => []);
        return cloneChatMessages(messages);
    }

    public async getClusterAgentContextSnapshot(
        clusterId: string,
        agentId: string
    ): Promise<ClusterAgentContextSnapshot> {
        const [directMessages, broadcastMessages, collaborateMessages] = await Promise.all([
            this.getClusterAgentMessages(clusterId, agentId),
            this.getClusterAgentSwarmMessages(clusterId, agentId, 'broadcast'),
            this.getClusterAgentSwarmMessages(clusterId, agentId, 'collaborate')
        ]);

        return {
            directMessages,
            broadcastMessages,
            collaborateMessages
        };
    }

    public async getClusterSwarmMessages(
        clusterId: string,
        mode: 'broadcast' | 'collaborate'
    ): Promise<ChatMessage[]> {
        await this.ensurePersistedStateLoaded();
        return cloneChatMessages(
            this.clusterSwarmMessages.get(this.buildClusterSwarmStorageKey(clusterId, mode)) || []
        );
    }

    public async replaceClusterSwarmMessages(
        clusterId: string,
        mode: 'broadcast' | 'collaborate',
        messages: ChatMessage[]
    ): Promise<void> {
        await this.ensurePersistedStateLoaded();
        const key = this.buildClusterSwarmStorageKey(clusterId, mode);
        const normalizedMessages = normalizePersistedChatMessages(messages);

        if (normalizedMessages.length > 0) {
            this.clusterSwarmMessages.set(key, normalizedMessages);
        } else {
            this.clusterSwarmMessages.delete(key);
        }

        await this.persistState();
    }

    public async refresh(): Promise<AgentCluster[]> {
        return this.getClusters(true);
    }

    public dispose() {
        this.removeAllListeners();
        this.clusters.clear();
        this.workspaceConfigs.clear();
        this.clusterAgentSessionIds.clear();
        this.clusterAgentMessages.clear();
        this.clusterSwarmMessages.clear();
        this.persistedStateLoaded = false;
        this.persistedStateLoadPromise = null;
        this.swarmSessionIds.clear();
    }

    private async ensurePersistedStateLoaded(forceRefresh: boolean = false): Promise<void> {
        if (forceRefresh) {
            this.persistedStateLoaded = false;
        }

        if (this.persistedStateLoaded) {
            return;
        }

        if (this.persistedStateLoadPromise) {
            await this.persistedStateLoadPromise;
            return;
        }

        this.persistedStateLoadPromise = (async () => {
            if (!this.service.supportsRemoteClusters()) {
                this.clusters.clear();
            }
            this.workspaceConfigs.clear();
            this.clusterAgentSessionIds.clear();
            this.clusterAgentMessages.clear();
            this.clusterSwarmMessages.clear();
            this.swarmSessionIds.clear();

            try {
                const content = await fs.readFile(this.storageFilePath, 'utf8');
                const data = JSON.parse(content) as PersistedClustersFile;
                if (!this.service.supportsRemoteClusters()) {
                    for (const cluster of data.clusters || []) {
                        if (!cluster?.id || !cluster?.name) {
                            continue;
                        }

                        this.clusters.set(cluster.id, this.applyWorkspaceConfig({
                            ...cluster,
                            agentIds: uniqueAgentIds(cluster.agentIds || []),
                            status: cluster.status === 'inactive' ? 'inactive' : 'active'
                        }));
                    }
                }

                for (const cluster of data.clusters || []) {
                    if (!cluster?.id) {
                        continue;
                    }
                    this.workspaceConfigs.set(
                        cluster.id,
                        normalizeClusterWorkspaceConfig(cluster.workspaceConfig)
                    );
                }

                for (const [clusterId, workspaceConfig] of Object.entries(data.workspaceConfigs || {})) {
                    this.workspaceConfigs.set(clusterId, normalizeClusterWorkspaceConfig(workspaceConfig));
                }

                for (const [sessionKey, sessionId] of Object.entries(data.clusterAgentSessions || {})) {
                    const normalizedSessionKey = String(sessionKey || '').trim();
                    const normalizedSessionId = String(sessionId || '').trim();
                    if (!normalizedSessionKey || !normalizedSessionId) {
                        continue;
                    }

                    this.clusterAgentSessionIds.set(normalizedSessionKey, normalizedSessionId);
                }

                for (const [messageKey, messages] of Object.entries(data.clusterAgentMessages || {})) {
                    const normalizedMessageKey = String(messageKey || '').trim();
                    if (!normalizedMessageKey) {
                        continue;
                    }

                    const normalizedMessages = normalizePersistedChatMessages(messages);
                    if (normalizedMessages.length === 0) {
                        continue;
                    }

                    this.clusterAgentMessages.set(normalizedMessageKey, normalizedMessages);
                }

                for (const [sessionKey, sessionId] of Object.entries(data.swarmSessions || {})) {
                    const normalizedSessionKey = String(sessionKey || '').trim();
                    const normalizedSessionId = String(sessionId || '').trim();
                    if (!normalizedSessionKey || !normalizedSessionId) {
                        continue;
                    }

                    this.swarmSessionIds.set(normalizedSessionKey, normalizedSessionId);
                }

                for (const [messageKey, messages] of Object.entries(data.clusterSwarmMessages || {})) {
                    const normalizedMessageKey = String(messageKey || '').trim();
                    if (!normalizedMessageKey) {
                        continue;
                    }

                    const normalizedMessages = normalizePersistedChatMessages(messages);
                    if (normalizedMessages.length === 0) {
                        continue;
                    }

                    this.clusterSwarmMessages.set(normalizedMessageKey, normalizedMessages);
                }
            } catch (error) {
                const maybeNodeError = error as NodeJS.ErrnoException;
                if (maybeNodeError.code !== 'ENOENT') {
                    throw error;
                }
            }

            this.persistedStateLoaded = true;
        })();

        try {
            await this.persistedStateLoadPromise;
        } finally {
            this.persistedStateLoadPromise = null;
        }
    }

    private async persistState(): Promise<void> {
        const payload: PersistedClustersFile = {
            version: 5,
            clusters: Array.from(this.clusters.values()).map(cluster => this.applyWorkspaceConfig(cluster)),
            workspaceConfigs: Object.fromEntries(this.workspaceConfigs.entries()),
            clusterAgentSessions: Object.fromEntries(this.clusterAgentSessionIds.entries()),
            clusterAgentMessages: Object.fromEntries(
                Array.from(this.clusterAgentMessages.entries()).map(([key, messages]) => [
                    key,
                    cloneChatMessages(messages)
                ])
            ),
            swarmSessions: Object.fromEntries(this.swarmSessionIds.entries()),
            clusterSwarmMessages: Object.fromEntries(
                Array.from(this.clusterSwarmMessages.entries()).map(([key, messages]) => [
                    key,
                    cloneChatMessages(messages)
                ])
            )
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }

    private async sendMessageToAgents(
        agentIds: string[],
        message: string | ((agentId: string) => string | Promise<string>),
        options: {
            clusterId: string;
            mode: 'broadcast' | 'collaborate';
            debateSessionIds?: Map<string, string>;
            onAgentResult?: (agentId: string, result: ClusterBroadcastResult) => Promise<void> | void;
        }
    ): Promise<Record<string, ClusterBroadcastResult>> {
        const entries: Array<readonly [string, ClusterBroadcastResult]> = await Promise.all(
            agentIds.map(async agentId => {
                const resolvedMessage = typeof message === 'function'
                    ? await message(agentId)
                    : message;
                const result = await this.sendMessageToAgent(agentId, resolvedMessage, options);
                await options.onAgentResult?.(agentId, result);
                return [agentId, result] as const;
            })
        );

        return Object.fromEntries(entries);
    }

    private async sendMessageToAgent(
        agentId: string,
        message: string,
        options: {
            clusterId: string;
            mode: 'broadcast' | 'collaborate';
            debateSessionIds?: Map<string, string>;
        }
    ): Promise<ClusterBroadcastResult> {
        try {
            const sessionId = options.debateSessionIds
                ? await this.ensureDebateSession(agentId, options.debateSessionIds, options.clusterId, options.mode)
                : await this.ensureSwarmSession(agentId, options.clusterId, options.mode);
            const traceResult = await this.sendMessageWithTrace(sessionId, message, CLUSTER_AGENT_RESPONSE_TIMEOUT_MS);
            if (traceResult.timedOut) {
                return {
                    agentId,
                    ok: false,
                    message: traceResult.message || undefined,
                    trace: traceResult.trace,
                    error: `Timed out after ${Math.round(CLUSTER_AGENT_RESPONSE_TIMEOUT_MS / 1000)}s`
                };
            }

            return {
                agentId,
                ok: true,
                message: traceResult.message || undefined,
                trace: traceResult.trace
            };
        } catch (error) {
            return {
                agentId,
                ok: false,
                error: String(error)
            };
        }
    }

    private async ensureDebateSession(
        agentId: string,
        debateSessionIds: Map<string, string>,
        clusterId: string,
        mode: 'broadcast' | 'collaborate'
    ): Promise<string> {
        const existingSessionId = debateSessionIds.get(agentId);
        if (existingSessionId) {
            return existingSessionId;
        }

        const sessionId = await this.ensureSwarmSession(agentId, clusterId, mode);
        debateSessionIds.set(agentId, sessionId);
        return sessionId;
    }

    private async ensureSwarmSession(
        agentId: string,
        clusterId: string,
        mode: 'broadcast' | 'collaborate'
    ): Promise<string> {
        const key = this.buildSwarmSessionKey(clusterId, mode, agentId);
        const existingSessionId = this.swarmSessionIds.get(key);
        if (existingSessionId) {
            return existingSessionId;
        }

        const session = await this.service.createChatSession(agentId);
        this.swarmSessionIds.set(key, session.id);
        await this.persistState();
        return session.id;
    }

    private buildSwarmSessionKey(clusterId: string, mode: 'broadcast' | 'collaborate', agentId: string): string {
        return `cluster:${clusterId}:swarm:${mode}:agent:${agentId}`;
    }

    private clearSwarmSessionsForCluster(clusterId: string): void {
        const prefix = `cluster:${clusterId}:`;
        for (const key of this.swarmSessionIds.keys()) {
            if (key.startsWith(prefix)) {
                this.swarmSessionIds.delete(key);
            }
        }
    }

    private buildClusterSwarmStorageKey(clusterId: string, mode: 'broadcast' | 'collaborate'): string {
        return `${clusterId.trim()}::swarm::${mode}`;
    }

    private buildClusterAgentSessionStorageKey(clusterId: string, agentId: string): string {
        return `${clusterId.trim()}::${agentId.trim()}`;
    }

    private clearClusterAgentSessionsForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentSessionIds.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterAgentSessionIds.delete(key);
            }
        }
    }

    private clearClusterAgentMessagesForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentMessages.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterAgentMessages.delete(key);
            }
        }
    }

    private clearClusterSwarmMessagesForCluster(clusterId: string): void {
        const prefix = `${clusterId.trim()}::swarm::`;
        for (const key of this.clusterSwarmMessages.keys()) {
            if (key.startsWith(prefix)) {
                this.clusterSwarmMessages.delete(key);
            }
        }
    }

    private reconcileClusterAgentSessions(clusterId: string, agentIds: string[]): void {
        const allowed = new Set(agentIds.map(agentId => this.buildClusterAgentSessionStorageKey(clusterId, agentId)));
        const prefix = `${clusterId.trim()}::`;
        for (const key of this.clusterAgentSessionIds.keys()) {
            if (key.startsWith(prefix) && !allowed.has(key)) {
                this.clusterAgentSessionIds.delete(key);
            }
        }

        for (const key of this.clusterAgentMessages.keys()) {
            if (key.startsWith(prefix) && !allowed.has(key)) {
                this.clusterAgentMessages.delete(key);
            }
        }

        const swarmSessionPrefix = `cluster:${clusterId}:`;
        const allowedSwarmSessionSuffixes = new Set(
            agentIds.flatMap(agentId => [
                this.buildSwarmSessionKey(clusterId, 'broadcast', agentId),
                this.buildSwarmSessionKey(clusterId, 'collaborate', agentId)
            ])
        );
        for (const key of this.swarmSessionIds.keys()) {
            if (key.startsWith(swarmSessionPrefix) && !allowedSwarmSessionSuffixes.has(key)) {
                this.swarmSessionIds.delete(key);
            }
        }
    }

    private async sendMessageWithTrace(
        sessionId: string,
        message: string,
        timeoutMs: number
    ): Promise<{ message: ChatMessage | null; trace: ChatMessage[]; timedOut: boolean }> {
        const before = await this.service.getChatHistory(sessionId).catch(() => []);
        const knownIds = new Set(before.map(item => item.id));
        const responseResult = await raceWithTimeout(this.service.sendMessage(sessionId, message), timeoutMs);
        const after = await this.service.getChatHistory(sessionId).catch(() => []);

        const trace = this.normalizeTraceMessages(
            after.filter(item => !knownIds.has(item.id))
        );

        const finalTraceMessage = findLastAssistantMessage(trace);

        if (responseResult.timedOut) {
            return {
                message: finalTraceMessage,
                trace,
                timedOut: true
            };
        }

        const response = responseResult.value;

        if (trace.length === 0) {
            return {
                message: response,
                trace: response ? [response] : [],
                timedOut: false
            };
        }

        return {
            message: finalTraceMessage || response,
            trace,
            timedOut: false
        };
    }

    private normalizeTraceMessages(messages: ChatMessage[]): ChatMessage[] {
        const deduped = new Map<string, ChatMessage>();
        for (const message of messages) {
            if (!message || message.role === 'user') {
                continue;
            }

            if (message.id) {
                deduped.set(message.id, message);
                continue;
            }

            const fallbackId = `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
            deduped.set(fallbackId, message);
        }

        return Array.from(deduped.values());
    }

    private async buildSynthesisPrompt(
        cluster: AgentCluster,
        userMessage: string,
        workspaceConfig: ClusterWorkspaceConfig,
        coordinatorAgentId: string,
        successfulAgentIds: string[],
        contributions: Record<string, ClusterBroadcastResult>,
        rounds: ClusterCollaborationRound[]
    ): Promise<string> {
        const agents = await Promise.all(
            cluster.agentIds.map(async agentId => [agentId, await this.service.getAgent(agentId).catch(() => null)] as const)
        );
        const agentMap = new Map<string, Agent | null>(agents);

        const roundSummaries = rounds
            .map(round => {
                const activeAgentIds = cluster.agentIds.filter(agentId => round.entries[agentId]);
                if (activeAgentIds.length === 0) {
                    return '';
                }

                return [
                    `## ${getCollaborationRoundPromptTitle(round.kind)}`,
                    formatRoundEntries(activeAgentIds, round.entries, agentMap)
                ].join('\n');
            })
            .filter(Boolean);

        const finalPositionSummary = formatRoundEntries(successfulAgentIds, contributions, agentMap);

        const failedAgentIds = cluster.agentIds.filter(agentId => !contributions[agentId]?.ok);
        const unavailableLine = failedAgentIds.length > 0
            ? `Unavailable agents: ${failedAgentIds.join(', ')}`
            : '';

        return [
            `You are coordinating the agent swarm "${cluster.name}".`,
            ...buildCoordinatorProfilePromptLines(workspaceConfig, coordinatorAgentId),
            buildCoordinatorStyleInstruction(workspaceConfig.collaborationStyle),
            'You are receiving the full transcript of a multi-round swarm debate with peer review.',
            'Synthesize the strongest parts of the debate into one final answer for the user.',
            buildDeliveryInstruction(workspaceConfig.deliveryStyle),
            buildRiskInstruction(workspaceConfig.critiqueLevel),
            'Respond in the same language as the user request.',
            clusterBriefingLine(workspaceConfig),
            '',
            'User request:',
            userMessage,
            '',
            'Debate transcript:',
            roundSummaries.join('\n\n'),
            '',
            'Latest viable agent positions:',
            finalPositionSummary,
            unavailableLine ? `\n${unavailableLine}` : '',
            '',
            'Produce one merged final answer. Do not mention internal swarm instructions.'
        ].join('\n');
    }

    private applyWorkspaceConfig(cluster: AgentCluster): AgentCluster {
        const workspaceConfig = normalizeClusterWorkspaceConfig(
            cluster.workspaceConfig || this.workspaceConfigs.get(cluster.id) || createDefaultClusterWorkspaceConfig()
        );
        this.workspaceConfigs.set(cluster.id, workspaceConfig);
        return {
            ...cluster,
            workspaceConfig
        };
    }
}

function buildClusterAgentSessionId(clusterId: string, agentId: string): string {
    return `cluster:${clusterId.trim()}:agent:${agentId.trim()}:session:${buildUniqueTimestampSuffix()}`;
}

function normalizePersistedChatMessages(messages: ChatMessage[] | undefined | null): ChatMessage[] {
    if (!Array.isArray(messages)) {
        return [];
    }

    const normalized: ChatMessage[] = [];
    for (const message of messages) {
        if (!message || typeof message !== 'object') {
            continue;
        }

        const id = typeof message.id === 'string' ? message.id.trim() : '';
        const role = isChatMessageRole(message.role) ? message.role : null;
        const content = typeof message.content === 'string' ? message.content : '';
        const timestamp = typeof message.timestamp === 'string' ? message.timestamp : '';

        if (!id || !role || !timestamp) {
            continue;
        }

        normalized.push({
            ...message,
            id,
            role,
            content,
            timestamp,
            agentId: typeof message.agentId === 'string' ? message.agentId : undefined,
            tokenCount: typeof message.tokenCount === 'number' ? message.tokenCount : undefined,
            parts: Array.isArray(message.parts) ? [...message.parts] : undefined,
            metadata: isRecord(message.metadata) ? { ...message.metadata } : undefined
        });
    }

    return normalized;
}

function cloneChatMessages(messages: ChatMessage[]): ChatMessage[] {
    return normalizePersistedChatMessages(messages);
}

function findLastAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'assistant') {
            return messages[index];
        }
    }

    return null;
}

async function raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
    if (timeoutMs <= 0) {
        return {
            timedOut: false,
            value: await promise
        };
    }

    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise.then(value => ({ timedOut: false, value } as const)),
            new Promise<{ timedOut: true }>(resolve => {
                timer = setTimeout(() => resolve({ timedOut: true } as const), timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function isChatMessageRole(value: unknown): value is ChatMessage['role'] {
    return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildClusterId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    const safeName = normalized.replace(/^-|-$/g, '') || 'cluster';
    return `cluster:${safeName}:${buildUniqueTimestampSuffix()}`;
}

let lastGeneratedTimestamp = 0;
let generatedTimestampCounter = 0;

function buildUniqueTimestampSuffix(): string {
    const now = Date.now();
    if (now === lastGeneratedTimestamp) {
        generatedTimestampCounter += 1;
    } else {
        lastGeneratedTimestamp = now;
        generatedTimestampCounter = 0;
    }

    return generatedTimestampCounter > 0
        ? `${now}-${generatedTimestampCounter}`
        : String(now);
}

function uniqueAgentIds(agentIds: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const agentId of agentIds) {
        const normalized = agentId?.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function resolveCoordinatorAgentId(
    clusterAgentIds: string[],
    successfulAgentIds: string[],
    configuredAgentId?: string,
    preferredAgentId?: string
): string | null {
    const normalizedConfigured = configuredAgentId?.trim();
    if (normalizedConfigured && clusterAgentIds.includes(normalizedConfigured)) {
        return normalizedConfigured;
    }

    const normalizedPreferred = preferredAgentId?.trim();
    if (normalizedPreferred && successfulAgentIds.includes(normalizedPreferred)) {
        return normalizedPreferred;
    }

    if (successfulAgentIds.length > 0) {
        return successfulAgentIds[0];
    }

    if (normalizedPreferred && clusterAgentIds.includes(normalizedPreferred)) {
        return normalizedPreferred;
    }

    return clusterAgentIds[0] || null;
}

function workspaceConfigOrDefault(config?: ClusterWorkspaceConfig): ClusterWorkspaceConfig {
    return normalizeClusterWorkspaceConfig(config || createDefaultClusterWorkspaceConfig());
}

function resolveSwarmParticipantAgentIds(
    agentIds: string[],
    workspaceConfig: ClusterWorkspaceConfig,
    mode: 'broadcast' | 'collaborate',
    userMessage: string
): string[] {
    return agentIds.filter(agentId => isClusterAgentEligibleForSwarm(workspaceConfig, agentId, mode, userMessage));
}

function isClusterAgentEligibleForSwarm(
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string,
    mode: 'broadcast' | 'collaborate',
    userMessage: string
): boolean {
    const activation = workspaceConfig.memberProfiles?.[agentId]?.activation;
    if (!activation) {
        return true;
    }

    if (Array.isArray(activation.swarmModes) && !activation.swarmModes.includes(mode)) {
        return false;
    }

    if (Array.isArray(activation.keywords) && activation.keywords.length > 0) {
        const normalizedMessage = userMessage.trim().toLowerCase();
        if (!normalizedMessage) {
            return false;
        }

        return activation.keywords.some(keyword => normalizedMessage.includes(keyword.trim().toLowerCase()));
    }

    return true;
}

function buildCollaborationDebateRounds(maxRounds: number): Array<{
    reviewRound: number;
    critiqueKind: Extract<ClusterCollaborationRoundKind, `critique-${number}`>;
    revisionKind: Extract<ClusterCollaborationRoundKind, `revision-${number}`>;
}> {
    const rounds = Math.max(1, Math.min(MAX_CLUSTER_WORK_MODE_ROUNDS, Math.round(maxRounds || 1)));
    return Array.from({ length: rounds }, (_, index) => {
        const reviewRound = index + 1;
        return {
            reviewRound,
            critiqueKind: `critique-${reviewRound}`,
            revisionKind: `revision-${reviewRound}`
        };
    });
}

function buildOpeningContributionPrompt(
    clusterName: string,
    userMessage: string,
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string
): string {
    const memberProfileLines = buildMemberProfilePromptLines(workspaceConfig, agentId);
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: opening using ${workspaceConfig.collaborationStyle}.`,
        'This is round 1 of a multi-round swarm debate.',
        ...memberProfileLines,
        buildOpeningStyleInstruction(workspaceConfig.collaborationStyle),
        buildDeliveryInstruction(workspaceConfig.deliveryStyle),
        buildRiskInstruction(workspaceConfig.critiqueLevel),
        'If the task is ambiguous, state what you infer instead of asking follow-up questions.',
        clusterBriefingLine(workspaceConfig),
        'End with a short line that starts with "Position:".',
        '',
        'User request:',
        userMessage
    ].join('\n');
}

function buildPeerReviewPrompt(
    clusterName: string,
    userMessage: string,
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string,
    activeAgentIds: string[],
    contributions: Record<string, ClusterBroadcastResult>,
    reviewRound: number
): string {
    const peerReviewInstruction = getPeerReviewInstruction(
        workspaceConfig.collaborationStyle,
        workspaceConfig.critiqueLevel,
        activeAgentIds.length
    );
    const memberProfileLines = buildMemberProfilePromptLines(workspaceConfig, agentId);

    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: critique round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'This is a peer-review round in a multi-round swarm debate.',
        ...memberProfileLines,
        peerReviewInstruction,
        buildRiskInstruction(workspaceConfig.critiqueLevel),
        clusterBriefingLine(workspaceConfig),
        'Explicitly name at least one idea you would adopt and one idea you would challenge.',
        'Do not produce the final merged answer.',
        'End with a short line that starts with "Review verdict:".',
        '',
        'User request:',
        userMessage,
        '',
        'Current positions:',
        formatRoundEntries(activeAgentIds, contributions)
    ].join('\n');
}

function buildRevisionPrompt(
    clusterName: string,
    userMessage: string,
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string,
    activeAgentIds: string[],
    contributions: Record<string, ClusterBroadcastResult>,
    critiques: Record<string, ClusterBroadcastResult>,
    reviewRound: number
): string {
    const memberProfileLines = buildMemberProfilePromptLines(workspaceConfig, agentId);
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: revision round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'Revise your position after reading the peer reviews from this round.',
        ...memberProfileLines,
        buildRevisionInstruction(workspaceConfig.collaborationStyle),
        buildDeliveryInstruction(workspaceConfig.deliveryStyle),
        clusterBriefingLine(workspaceConfig),
        'State which peer feedback you accepted, which feedback you rejected, and why.',
        'Do not produce the final merged answer.',
        'End with a short line that starts with "Revised position:".',
        '',
        'User request:',
        userMessage,
        '',
        'Current positions:',
        formatRoundEntries(activeAgentIds, contributions),
        '',
        'Peer reviews:',
        formatRoundEntries(activeAgentIds, critiques)
    ].join('\n');
}

function formatAgentContribution(
    agentId: string,
    agent: Agent | null,
    contribution: ClusterBroadcastResult | undefined
): string {
    const label = agent
        ? `${agent.name} (${agent.model}) [${agentId}]`
        : agentId;

    if (!contribution?.ok || !contribution.message) {
        return `### ${label}\nUnavailable`;
    }

    return `### ${label}\n${contribution.message.content}`;
}

function getSuccessfulAgentIds(
    agentIds: string[],
    entries: Record<string, ClusterBroadcastResult>
): string[] {
    return agentIds.filter(agentId => entries[agentId]?.ok);
}

function mergeLatestSuccessfulEntries(
    agentIds: string[],
    nextEntries: Record<string, ClusterBroadcastResult>,
    fallbackEntries: Record<string, ClusterBroadcastResult>
): Record<string, ClusterBroadcastResult> {
    const merged: Record<string, ClusterBroadcastResult> = {};

    for (const agentId of agentIds) {
        if (nextEntries[agentId]?.ok) {
            merged[agentId] = nextEntries[agentId];
            continue;
        }

        if (fallbackEntries[agentId]?.ok) {
            merged[agentId] = fallbackEntries[agentId];
            continue;
        }

        if (nextEntries[agentId]) {
            merged[agentId] = nextEntries[agentId];
            continue;
        }

        if (fallbackEntries[agentId]) {
            merged[agentId] = fallbackEntries[agentId];
        }
    }

    return merged;
}

function formatRoundEntries(
    agentIds: string[],
    entries: Record<string, ClusterBroadcastResult>,
    agentMap?: Map<string, Agent | null>
): string {
    return agentIds
        .map(agentId => formatAgentContribution(agentId, agentMap?.get(agentId) || null, entries[agentId]))
        .join('\n\n');
}

function getCollaborationRoundPromptTitle(kind: ClusterCollaborationRoundKind): string {
    switch (kind) {
        case 'opening':
            return 'Opening positions';
        default:
            if (kind.startsWith('critique-')) {
                return `Peer review round ${kind.slice('critique-'.length)}`;
            }
            if (kind.startsWith('revision-')) {
                return `Revised positions round ${kind.slice('revision-'.length)}`;
            }
            return 'Debate round';
    }
}

function buildOpeningStyleInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'round-robin':
            return 'Give a focused opening position from your own lane, then leave room for parallel viewpoints.';
        case 'review-board':
            return 'Start with a position that is strict, evidence-oriented, and suitable for design review.';
        case 'leader-draft':
            return 'Give a focused opening position that a coordinator can quickly merge into an execution draft.';
        case 'debate':
        default:
            return 'Give a focused opening position from your own perspective, not the final merged answer.';
    }
}

function getPeerReviewInstruction(
    style: ClusterWorkspaceConfig['collaborationStyle'],
    critiqueLevel: ClusterWorkspaceConfig['critiqueLevel'],
    participantCount: number
): string {
    const baseline = participantCount > 1
        ? 'Critique the other agents first, then compare their ideas with your own.'
        : 'You are the only available agent. Perform a hard self-critique instead of peer review.';

    if (style === 'review-board') {
        return `${baseline} Act like a review board and reject weak reasoning plainly.`;
    }

    if (style === 'leader-draft') {
        return `${baseline} Focus on what the coordinator should keep, cut, or verify before drafting the final answer.`;
    }

    if (style === 'round-robin') {
        return `${baseline} Keep the critique compact so the swarm can converge quickly.`;
    }

    if (critiqueLevel === 'aggressive') {
        return `${baseline} Push hard on hidden assumptions, weak evidence, and operational risk.`;
    }

    return baseline;
}

function buildRevisionInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'review-board':
            return 'Preserve only the claims that survive review; cut unsupported detail aggressively.';
        case 'leader-draft':
            return 'Revise toward a mergeable coordinator draft with explicit next steps and unresolved risks.';
        case 'round-robin':
            return 'Revise quickly and keep only the strongest deltas from peer feedback.';
        case 'debate':
        default:
            return 'Preserve the strongest parts of your earlier reasoning, but change your position when the critique is valid.';
    }
}

function buildDeliveryInstruction(style: ClusterWorkspaceConfig['deliveryStyle']): string {
    switch (style) {
        case 'fast':
            return 'Optimize for speed and crispness. Keep the answer short, concrete, and easy to act on.';
        case 'deep':
            return 'Go deep. Include assumptions, tradeoffs, implementation detail, and verification advice when useful.';
        case 'balanced':
        default:
            return 'Keep the answer actionable and preserve helpful Markdown structure.';
    }
}

function buildRiskInstruction(level: ClusterWorkspaceConfig['critiqueLevel']): string {
    switch (level) {
        case 'minimal':
            return 'Call out risks briefly, but do not over-expand the critique section.';
        case 'aggressive':
            return 'Identify the strongest ideas, the weakest reasoning, hidden risks, and missing constraints with high scrutiny.';
        case 'standard':
        default:
            return 'Resolve conflicts explicitly and explain which arguments survived the debate. Call out missing information, unresolved risk, and weak assumptions when needed.';
    }
}

function buildCoordinatorStyleInstruction(style: ClusterWorkspaceConfig['collaborationStyle']): string {
    switch (style) {
        case 'review-board':
            return 'Act like a strict review chair: preserve only claims that survived hard review and evidence checks.';
        case 'leader-draft':
            return 'Act like a tech lead preparing the final merged draft for execution.';
        case 'round-robin':
            return 'Act like a fast moderator who distills parallel lanes into one concise merged answer.';
        case 'debate':
        default:
            return 'Act like a coordinator who reconciles competing arguments into one defensible answer.';
    }
}

function clusterBriefingLine(workspaceConfig: ClusterWorkspaceConfig): string {
    const briefing = workspaceConfig.briefing?.trim();
    return briefing ? `Cluster briefing: ${briefing}` : 'Cluster briefing: keep the result coherent and user-facing.';
}

function buildMemberProfilePromptLines(
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string
): string[] {
    const profile = workspaceConfig.memberProfiles?.[agentId];
    const lines: string[] = [];

    if (profile?.identity?.trim()) {
        lines.push(`Assigned identity: ${profile.identity.trim()}`);
    }

    if (profile?.stance?.trim()) {
        lines.push(`Assigned stance: ${profile.stance.trim()}`);
        lines.push('Preserve this stance consistently unless the evidence in the debate forces a revision.');
    }

    return lines;
}

function buildCoordinatorProfilePromptLines(
    workspaceConfig: ClusterWorkspaceConfig,
    agentId: string
): string[] {
    const profileLines = buildMemberProfilePromptLines(workspaceConfig, agentId);
    if (profileLines.length === 0) {
        return [];
    }

    return [
        ...profileLines,
        'As coordinator, keep your assigned identity and stance while still producing one coherent final answer.'
    ];
}
