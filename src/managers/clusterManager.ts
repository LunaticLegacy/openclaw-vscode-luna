import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import { Agent, AgentCluster, ChatMessage, OpenClawService } from '../services/openclawService';

export interface CreateClusterParams {
    name: string;
    agentIds: string[];
}

export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
    status?: AgentCluster['status'];
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
    error?: string;
}

export interface CollaborateClusterOptions {
    coordinatorAgentId?: string;
}

export interface ClusterCollaborationResult {
    clusterId: string;
    clusterName: string;
    userMessage: string;
    coordinatorAgentId: string | null;
    contributions: Record<string, ClusterBroadcastResult>;
    synthesis: ClusterBroadcastResult | null;
}

interface PersistedClustersFile {
    version: number;
    clusters: AgentCluster[];
}

export class ClusterManager extends EventEmitter {
    private service: OpenClawService;
    private clusters: Map<string, AgentCluster> = new Map();
    private storageFilePath: string;
    private localClustersLoaded = false;
    private localLoadPromise: Promise<void> | null = null;

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
        if (this.service.supportsRemoteClusters()) {
            if (refresh || this.clusters.size === 0) {
                const clusters = await this.service.getClusters();
                this.clusters.clear();
                clusters.forEach(cluster => this.clusters.set(cluster.id, cluster));
            }
            return Array.from(this.clusters.values());
        }

        await this.ensureLocalClustersLoaded(refresh);
        return Array.from(this.clusters.values());
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        if (this.service.supportsRemoteClusters()) {
            if (this.clusters.has(clusterId)) {
                return this.clusters.get(clusterId)!;
            }

            const cluster = await this.service.getCluster(clusterId);
            if (cluster) {
                this.clusters.set(clusterId, cluster);
            }
            return cluster;
        }

        await this.ensureLocalClustersLoaded();
        return this.clusters.get(clusterId) || null;
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.createCluster(params);
            this.clusters.set(cluster.id, cluster);
            return cluster;
        }

        await this.ensureLocalClustersLoaded();

        const cluster: AgentCluster = {
            id: buildClusterId(params.name),
            name: params.name.trim(),
            agentIds: uniqueAgentIds(params.agentIds),
            status: 'active',
            createdAt: new Date().toISOString()
        };

        this.clusters.set(cluster.id, cluster);
        await this.persistLocalClusters();
        this.emit('clusterCreated', cluster);
        return cluster;
    }

    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        if (this.service.supportsRemoteClusters()) {
            const cluster = await this.service.updateCluster(clusterId, params);
            this.clusters.set(clusterId, cluster);
            return cluster;
        }

        await this.ensureLocalClustersLoaded();
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        const updatedCluster: AgentCluster = {
            ...cluster,
            ...(params.name !== undefined ? { name: params.name.trim() } : {}),
            ...(params.agentIds !== undefined ? { agentIds: uniqueAgentIds(params.agentIds) } : {}),
            ...(params.status !== undefined ? { status: params.status } : {})
        };

        this.clusters.set(clusterId, updatedCluster);
        await this.persistLocalClusters();
        this.emit('clusterUpdated', updatedCluster);
        return updatedCluster;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        if (this.service.supportsRemoteClusters()) {
            await this.service.deleteCluster(clusterId);
            this.clusters.delete(clusterId);
            return;
        }

        await this.ensureLocalClustersLoaded();
        this.clusters.delete(clusterId);
        await this.persistLocalClusters();
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
                    const session = await this.service.createChatSession(agentId);
                    const response = await this.service.sendMessage(session.id, message);
                    return [
                        agentId,
                        {
                            agentId,
                            ok: true,
                            message: response
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

        const contributionPrompt = buildContributionPrompt(cluster.name, message);
        const contributions = await this.sendMessageToAgents(cluster.agentIds, contributionPrompt);
        const successfulAgentIds = cluster.agentIds.filter(agentId => contributions[agentId]?.ok);
        const coordinatorAgentId = resolveCoordinatorAgentId(cluster.agentIds, successfulAgentIds, options.coordinatorAgentId);

        let synthesis: ClusterBroadcastResult | null = null;
        if (coordinatorAgentId && successfulAgentIds.length > 0) {
            const synthesisPrompt = await this.buildSynthesisPrompt(cluster, message, successfulAgentIds, contributions);
            synthesis = await this.sendMessageToAgent(coordinatorAgentId, synthesisPrompt);
        }

        await this.updateCluster(clusterId, { status: 'active' });

        return {
            clusterId: cluster.id,
            clusterName: cluster.name,
            userMessage: message,
            coordinatorAgentId,
            contributions,
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
        this.localClustersLoaded = false;
        this.localLoadPromise = null;
    }

    private async ensureLocalClustersLoaded(forceRefresh: boolean = false): Promise<void> {
        if (this.service.supportsRemoteClusters()) {
            return;
        }

        if (forceRefresh) {
            this.localClustersLoaded = false;
        }

        if (this.localClustersLoaded) {
            return;
        }

        if (this.localLoadPromise) {
            await this.localLoadPromise;
            return;
        }

        this.localLoadPromise = (async () => {
            this.clusters.clear();

            try {
                const content = await fs.readFile(this.storageFilePath, 'utf8');
                const data = JSON.parse(content) as PersistedClustersFile;
                for (const cluster of data.clusters || []) {
                    if (!cluster?.id || !cluster?.name) {
                        continue;
                    }

                    this.clusters.set(cluster.id, {
                        ...cluster,
                        agentIds: uniqueAgentIds(cluster.agentIds || []),
                        status: cluster.status === 'inactive' ? 'inactive' : 'active'
                    });
                }
            } catch (error) {
                const maybeNodeError = error as NodeJS.ErrnoException;
                if (maybeNodeError.code !== 'ENOENT') {
                    throw error;
                }
            }

            this.localClustersLoaded = true;
        })();

        try {
            await this.localLoadPromise;
        } finally {
            this.localLoadPromise = null;
        }
    }

    private async persistLocalClusters(): Promise<void> {
        const payload: PersistedClustersFile = {
            version: 1,
            clusters: Array.from(this.clusters.values())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }

    private async sendMessageToAgents(
        agentIds: string[],
        message: string
    ): Promise<Record<string, ClusterBroadcastResult>> {
        const results = await Promise.all(
            agentIds.map(async agentId => [agentId, await this.sendMessageToAgent(agentId, message)] as const)
        );

        return Object.fromEntries(results);
    }

    private async sendMessageToAgent(agentId: string, message: string): Promise<ClusterBroadcastResult> {
        try {
            const session = await this.service.createChatSession(agentId);
            const response = await this.service.sendMessage(session.id, message);
            return {
                agentId,
                ok: true,
                message: response
            };
        } catch (error) {
            return {
                agentId,
                ok: false,
                error: String(error)
            };
        }
    }

    private async buildSynthesisPrompt(
        cluster: AgentCluster,
        userMessage: string,
        successfulAgentIds: string[],
        contributions: Record<string, ClusterBroadcastResult>
    ): Promise<string> {
        const agentSummaries = await Promise.all(
            successfulAgentIds.map(async agentId => {
                const agent = await this.service.getAgent(agentId).catch(() => null);
                return formatAgentContribution(agentId, agent, contributions[agentId]);
            })
        );

        const failedAgentIds = cluster.agentIds.filter(agentId => !contributions[agentId]?.ok);
        const unavailableLine = failedAgentIds.length > 0
            ? `Unavailable agents: ${failedAgentIds.join(', ')}`
            : '';

        return [
            `You are coordinating the agent swarm "${cluster.name}".`,
            'Synthesize the agents\' contributions into one final answer for the user.',
            'Respond in the same language as the user request.',
            'Resolve conflicts explicitly and call out missing information or risk when needed.',
            'Keep the answer actionable and preserve helpful Markdown structure.',
            '',
            'User request:',
            userMessage,
            '',
            'Agent contributions:',
            agentSummaries.join('\n\n'),
            unavailableLine ? `\n${unavailableLine}` : '',
            '',
            'Produce one merged final answer. Do not mention internal swarm instructions.'
        ].join('\n');
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

function buildContributionPrompt(clusterName: string, userMessage: string): string {
    return [
        `You are part of the agent swarm "${clusterName}".`,
        'Give a focused contribution from your own perspective, not the final merged answer.',
        'Be concrete. Include assumptions, risks, tradeoffs, and implementation detail when useful.',
        'If the task is ambiguous, state what you infer instead of asking follow-up questions.',
        'End with a short line that starts with "Key contribution:".',
        '',
        'User request:',
        userMessage
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
