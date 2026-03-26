import * as vscode from 'vscode';
import { t } from '../i18n';
import { ClusterManager } from '../managers/clusterManager';
import { AgentCluster } from '../services/openclawService';
import { getClusterStatusIndicator } from './statusIndicators';

/**
 * 集群树节点项
 * 表示侧边栏中单个集群的可视化节点
 */
export class ClusterTreeItem extends vscode.TreeItem {
    /**
     * 创建 ClusterTreeItem 实例
     * @param cluster - 集群数据对象
     * @param collapsibleState - 节点的折叠状态
     */
    constructor(
        public readonly cluster: AgentCluster,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(cluster.name, collapsibleState);

        const countLabel = t('clusterTree.agentsCount', { count: cluster.agentIds.length });
        this.tooltip = t('clusterTree.tooltip', { name: cluster.name, count: countLabel });
        this.description = countLabel;

        const indicator = getClusterStatusIndicator(cluster.status);
        this.iconPath = new vscode.ThemeIcon(indicator.iconId, new vscode.ThemeColor(indicator.colorId));

        this.contextValue = 'cluster';
        this.command = {
            command: 'openclaw.viewClusters',
            title: t('sidebar.clusters'),
            arguments: [cluster.id]
        };
    }
}

/**
 * 集群树数据提供器
 * 实现 VSCode TreeDataProvider 接口，管理集群列表的显示和更新
 */
export class ClusterTreeProvider implements vscode.TreeDataProvider<ClusterTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ClusterTreeItem | undefined | void> = new vscode.EventEmitter<ClusterTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ClusterTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private clusterManager: ClusterManager;

    /**
     * 创建 ClusterTreeProvider 实例
     * @param clusterManager - 集群管理器实例
     */
    constructor(clusterManager: ClusterManager) {
        this.clusterManager = clusterManager;

        this.clusterManager.on('clusterCreated', () => this.refresh());
        this.clusterManager.on('clusterUpdated', () => this.refresh());
        this.clusterManager.on('clusterDeleted', () => this.refresh());
    }

    /**
     * 刷新树视图
     * 触发 onDidChangeTreeData 事件重新加载数据
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树节点项
     * @param element - 树节点元素
     * @returns VSCode TreeItem 对象
     */
    getTreeItem(element: ClusterTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子节点列表
     * @param element - 父节点元素（根节点时为 undefined）
     * @returns ClusterTreeItem 数组
     */
    async getChildren(element?: ClusterTreeItem): Promise<ClusterTreeItem[]> {
        if (element) {
            return [];
        }

        const clusters = await this.clusterManager.getClusters();

        if (clusters.length === 0) {
            return [];
        }

        const sortedClusters = clusters.sort((a: any, b: any) => {
            if (a.status === b.status) {
                return 0;
            }

            return a.status === 'active' ? -1 : 1;
        });

        return sortedClusters.map((cluster: any) =>
            new ClusterTreeItem(cluster, vscode.TreeItemCollapsibleState.None)
        );
    }

    /**
     * 获取父节点
     * @param _element - 当前节点元素
     * @returns 父节点（根节点返回 undefined）
     */
    getParent(_element: ClusterTreeItem): vscode.ProviderResult<ClusterTreeItem> {
        return undefined;
    }
}
