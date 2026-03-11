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

export interface CollaborateClusterOptions {
    coordinatorAgentId?: string;
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

interface PersistedClustersFile {
    version: number;
    clusters: AgentCluster[];
    workspaceConfigs?: Record<string, ClusterWorkspaceConfig>;
}

export class ClusterManager extends EventEmitter {
    private service: OpenClawService;
    private clusters: Map<string, AgentCluster> = new Map();
    private workspaceConfigs: Map<string, ClusterWorkspaceConfig> = new Map();
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
        await this.persistState();
        this.emit('clusterUpdated', updatedCluster);
        return updatedCluster;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.service.supportsRemoteClusters()) {
            await this.service.deleteCluster(clusterId);
            this.clusters.delete(clusterId);
            this.workspaceConfigs.delete(clusterId);
            this.clearSwarmSessionsForCluster(clusterId);
            await this.persistState();
            return;
        }

        await this.ensurePersistedStateLoaded();
        this.clusters.delete(clusterId);
        this.workspaceConfigs.delete(clusterId);
        this.clearSwarmSessionsForCluster(clusterId);
        await this.persistState();
        this.emit('clusterDeleted', clusterId);
    }

    public async broadcastToCluster(clusterId: string, message: string): Promise<Record<string, ClusterBroadcastResult>> {
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

        const results = await Promise.all(
            cluster.agentIds.map(async agentId => {
                try {
                    const result = await this.sendMessageToAgent(agentId, message, {
                        clusterId,
                        mode: 'broadcast'
                    });
                    return [
                        agentId,
                        {
                            ...result
                        } satisfies ClusterBroadcastResult
                    ] as const;
                } catch (error) {
                    return [
                        agentId,
                        {
                            agentId,
                            ok: false,
                            error: String(error)
                        } satisfies ClusterBroadcastResult
                    ] as const;
                }
            })
        );

        await this.updateCluster(clusterId, { status: 'active' });
        return Object.fromEntries(results);
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

        const debateSessionIds = new Map<string, string>();
        const rounds: ClusterCollaborationRound[] = [];

        const openingPrompt = buildOpeningContributionPrompt(cluster.name, message, workspaceConfig);
        const openingEntries = await this.sendMessageToAgents(cluster.agentIds, openingPrompt, {
            clusterId: cluster.id,
            mode: 'collaborate',
            debateSessionIds
        });
        rounds.push({
            kind: 'opening',
            entries: openingEntries
        });

        let latestUsableContributions = openingEntries;
        let successfulAgentIds = getSuccessfulAgentIds(cluster.agentIds, latestUsableContributions);

        for (const debateRound of buildCollaborationDebateRounds(workspaceConfig.rounds)) {
            if (successfulAgentIds.length === 0) {
                break;
            }

            const critiquePrompt = buildPeerReviewPrompt(
                cluster.name,
                message,
                workspaceConfig,
                successfulAgentIds,
                latestUsableContributions,
                debateRound.reviewRound
            );
            const critiqueEntries = await this.sendMessageToAgents(successfulAgentIds, critiquePrompt, {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds
            });
            rounds.push({
                kind: debateRound.critiqueKind,
                entries: critiqueEntries
            });

            const revisionPrompt = buildRevisionPrompt(
                cluster.name,
                message,
                workspaceConfig,
                successfulAgentIds,
                latestUsableContributions,
                critiqueEntries,
                debateRound.reviewRound
            );
            const revisionEntries = await this.sendMessageToAgents(successfulAgentIds, revisionPrompt, {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds
            });
            rounds.push({
                kind: debateRound.revisionKind,
                entries: revisionEntries
            });

            latestUsableContributions = mergeLatestSuccessfulEntries(
                cluster.agentIds,
                revisionEntries,
                latestUsableContributions
            );
            successfulAgentIds = getSuccessfulAgentIds(cluster.agentIds, latestUsableContributions);
        }

        const coordinatorAgentId = resolveCoordinatorAgentId(cluster.agentIds, successfulAgentIds, options.coordinatorAgentId);

        let synthesis: ClusterBroadcastResult | null = null;
        if (coordinatorAgentId && successfulAgentIds.length > 0) {
            const synthesisPrompt = await this.buildSynthesisPrompt(
                cluster,
                message,
                workspaceConfig,
                successfulAgentIds,
                latestUsableContributions,
                rounds
            );
            synthesis = await this.sendMessageToAgent(coordinatorAgentId, synthesisPrompt, {
                clusterId: cluster.id,
                mode: 'collaborate',
                debateSessionIds
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

    public async refresh(): Promise<AgentCluster[]> {
        return this.getClusters(true);
    }

    public dispose() {
        this.removeAllListeners();
        this.clusters.clear();
        this.workspaceConfigs.clear();
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
            version: 2,
            clusters: Array.from(this.clusters.values()).map(cluster => this.applyWorkspaceConfig(cluster)),
            workspaceConfigs: Object.fromEntries(this.workspaceConfigs.entries())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }

    private async sendMessageToAgents(
        agentIds: string[],
        message: string,
        options: {
            clusterId: string;
            mode: 'broadcast' | 'collaborate';
            debateSessionIds?: Map<string, string>;
        }
    ): Promise<Record<string, ClusterBroadcastResult>> {
        const results = await Promise.all(
            agentIds.map(async agentId => [
                agentId,
                await this.sendMessageToAgent(agentId, message, options)
            ] as const)
        );

        return Object.fromEntries(results);
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
            const traceResult = await this.sendMessageWithTrace(sessionId, message);
            return {
                agentId,
                ok: true,
                message: traceResult.message,
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

    private async sendMessageWithTrace(
        sessionId: string,
        message: string
    ): Promise<{ message: ChatMessage; trace: ChatMessage[] }> {
        const before = await this.service.getChatHistory(sessionId).catch(() => []);
        const knownIds = new Set(before.map(item => item.id));
        const response = await this.service.sendMessage(sessionId, message);
        const after = await this.service.getChatHistory(sessionId).catch(() => []);

        const trace = this.normalizeTraceMessages(
            after.filter(item => !knownIds.has(item.id))
        );

        if (trace.length === 0) {
            return {
                message: response,
                trace: response ? [response] : []
            };
        }

        let finalMessage = response;
        for (let i = trace.length - 1; i >= 0; i--) {
            if (trace[i].role === 'assistant') {
                finalMessage = trace[i];
                break;
            }
        }
        return {
            message: finalMessage,
            trace
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

function buildClusterId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    const safeName = normalized.replace(/^-|-$/g, '') || 'cluster';
    return `cluster:${safeName}:${Date.now()}`;
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
    preferredAgentId?: string
): string | null {
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
    workspaceConfig: ClusterWorkspaceConfig
): string {
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: opening using ${workspaceConfig.collaborationStyle}.`,
        'This is round 1 of a multi-round swarm debate.',
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
    activeAgentIds: string[],
    contributions: Record<string, ClusterBroadcastResult>,
    reviewRound: number
): string {
    const peerReviewInstruction = getPeerReviewInstruction(
        workspaceConfig.collaborationStyle,
        workspaceConfig.critiqueLevel,
        activeAgentIds.length
    );

    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: critique round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'This is a peer-review round in a multi-round swarm debate.',
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
    activeAgentIds: string[],
    contributions: Record<string, ClusterBroadcastResult>,
    critiques: Record<string, ClusterBroadcastResult>,
    reviewRound: number
): string {
    return [
        `You are part of the agent swarm "${clusterName}".`,
        `Debate stage: revision round ${reviewRound} using ${workspaceConfig.collaborationStyle}.`,
        'Revise your position after reading the peer reviews from this round.',
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
