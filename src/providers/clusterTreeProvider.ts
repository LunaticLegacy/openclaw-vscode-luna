import * as vscode from 'vscode';
import { t } from '../i18n';
import { ClusterManager } from '../managers/clusterManager';
import { AgentCluster } from '../services/openclawService';

export class ClusterTreeItem extends vscode.TreeItem {
    constructor(
        public readonly cluster: AgentCluster,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(cluster.name, collapsibleState);
        
        const countLabel = t('clusterTree.agentsCount', { count: cluster.agentIds.length });
        this.tooltip = t('clusterTree.tooltip', { name: cluster.name, count: countLabel });
        this.description = countLabel;
        
        // 根据状态设置图标
        if (cluster.status === 'active') {
            this.iconPath = new vscode.ThemeIcon('server', new vscode.ThemeColor('testing.iconPassed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('server', new vscode.ThemeColor('disabledForeground'));
        }

        this.contextValue = 'cluster';
        this.command = {
            command: 'openclaw.viewClusters',
            title: t('sidebar.clusters'),
            arguments: [cluster.id]
        };
    }
}

export class ClusterTreeProvider implements vscode.TreeDataProvider<ClusterTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ClusterTreeItem | undefined | null | void> = new vscode.EventEmitter<ClusterTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ClusterTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private clusterManager: ClusterManager;

    constructor(clusterManager: ClusterManager) {
        this.clusterManager = clusterManager;
        
        // 监听 Cluster 变化
        this.clusterManager.on('clusterCreated', () => this.refresh());
        this.clusterManager.on('clusterUpdated', () => this.refresh());
        this.clusterManager.on('clusterDeleted', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ClusterTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ClusterTreeItem): Promise<ClusterTreeItem[]> {
        if (element) {
            // Cluster 的子项（可以显示集群中的 agents）
            return [];
        }

        const clusters = await this.clusterManager.getClusters();
        
        if (clusters.length === 0) {
            return [];
        }

        // 按状态排序
        const sortedClusters = clusters.sort((a, b) => {
            if (a.status === b.status) return 0;
            return a.status === 'active' ? -1 : 1;
        });

        return sortedClusters.map(cluster => 
            new ClusterTreeItem(cluster, vscode.TreeItemCollapsibleState.None)
        );
    }

    getParent(element: ClusterTreeItem): vscode.ProviderResult<ClusterTreeItem> {
        return null;
    }
}
