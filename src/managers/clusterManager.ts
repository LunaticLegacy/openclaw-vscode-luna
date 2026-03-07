import { OpenClawService, AgentCluster } from '../services/openclawService';
import { EventEmitter } from 'events';
import { t } from '../i18n';

export interface CreateClusterParams {
    name: string;
    agentIds: string[];
}

export interface UpdateClusterParams {
    name?: string;
    agentIds?: string[];
}

export interface ClusterStats {
    totalClusters: number;
    activeClusters: number;
    totalAgents: number;
    avgAgentsPerCluster: number;
}

export class ClusterManager extends EventEmitter {
    private service: OpenClawService;
    private clusters: Map<string, AgentCluster> = new Map();

    constructor(service: OpenClawService) {
        super();
        this.service = service;
        this.setupListeners();
    }

    private setupListeners() {
        this.service.on('clusterCreated', (cluster: AgentCluster) => {
            this.clusters.set(cluster.id, cluster);
            this.emit('clusterCreated', cluster);
        });

        this.service.on('clusterUpdated', (cluster: AgentCluster) => {
            this.clusters.set(cluster.id, cluster);
            this.emit('clusterUpdated', cluster);
        });

        this.service.on('clusterDeleted', (clusterId: string) => {
            this.clusters.delete(clusterId);
            this.emit('clusterDeleted', clusterId);
        });
    }

    public async getClusters(refresh: boolean = false): Promise<AgentCluster[]> {
        if (refresh || this.clusters.size === 0) {
            const clusters = await this.service.getClusters();
            this.clusters.clear();
            clusters.forEach(cluster => this.clusters.set(cluster.id, cluster));
        }
        return Array.from(this.clusters.values());
    }

    public async getCluster(clusterId: string): Promise<AgentCluster | null> {
        if (this.clusters.has(clusterId)) {
            return this.clusters.get(clusterId)!;
        }
        
        const cluster = await this.service.getCluster(clusterId);
        if (cluster) {
            this.clusters.set(clusterId, cluster);
        }
        return cluster;
    }

    public async createCluster(params: CreateClusterParams): Promise<AgentCluster> {
        const cluster = await this.service.createCluster(params);
        this.clusters.set(cluster.id, cluster);
        return cluster;
    }

    public async updateCluster(clusterId: string, params: UpdateClusterParams): Promise<AgentCluster> {
        const cluster = await this.service.updateCluster(clusterId, params);
        this.clusters.set(clusterId, cluster);
        return cluster;
    }

    public async deleteCluster(clusterId: string): Promise<void> {
        await this.service.deleteCluster(clusterId);
        this.clusters.delete(clusterId);
    }

    public async broadcastToCluster(clusterId: string, message: string): Promise<Record<string, any>> {
        return this.service.sendToCluster(clusterId, message);
    }

    public getClusterStats(): ClusterStats {
        const clusters = Array.from(this.clusters.values());
        const totalAgents = clusters.reduce((sum, c) => sum + c.agentIds.length, 0);
        
        return {
            totalClusters: clusters.length,
            activeClusters: clusters.filter(c => c.status === 'active').length,
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
    }
}
