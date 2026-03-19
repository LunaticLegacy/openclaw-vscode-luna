import * as vscode from 'vscode';
import { t } from '../i18n';
import { AgentFolderManager, type AgentFolder } from '../managers/agentFolderManager';
import { AgentManager } from '../managers/agentManager';
import { ClusterManager } from '../managers/clusterManager';
import type { Agent } from '../services/openclawService';
import { AgentTreeItem } from './agentTreeProvider';
import { ClusterTreeItem } from './clusterTreeProvider';

type SidebarNode = SidebarSectionTreeItem | SidebarInfoTreeItem | AgentFolderTreeItem | AgentTreeItem | ClusterTreeItem;

/**
 * 侧边栏分区节点
 * 表示 Agents 或 Clusters 分区标题
 */
class SidebarSectionTreeItem extends vscode.TreeItem {
    /**
     * 创建 SidebarSectionTreeItem 实例
     * @param section - 分区类型（agents 或 clusters）
     * @param label - 显示标签
     * @param count - 项目数量
     */
    constructor(
        public readonly section: 'agents' | 'clusters',
        label: string,
        count: number
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);

        this.description = String(count);
        this.contextValue = `sidebarSection:${section}`;
        this.iconPath = new vscode.ThemeIcon(section === 'agents' ? 'account' : 'server');
    }
}

/**
 * 侧边栏信息节点
 * 用于显示空状态或提示信息
 */
class SidebarInfoTreeItem extends vscode.TreeItem {
    /**
     * 创建 SidebarInfoTreeItem 实例
     * @param message - 显示的信息文本
     */
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'sidebarInfo';
        this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('descriptionForeground'));
    }
}

class AgentFolderTreeItem extends vscode.TreeItem {
    constructor(
        public readonly folderId: string | null,
        public readonly labelText: string,
        public readonly agentIds: string[],
        public readonly collapsed: boolean
    ) {
        super(labelText, collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);

        const isUngrouped = !folderId;
        this.description = String(agentIds.length);
        this.contextValue = isUngrouped ? 'agentFolder:ungrouped' : 'agentFolder';
        this.iconPath = new vscode.ThemeIcon('folder');
        if (isUngrouped) {
            this.tooltip = t('sidebar.ungroupedHint');
        }
    }
}

/**
 * OpenClaw 侧边栏主提供器
 * 实现 VSCode TreeDataProvider 接口，整合 Agent 和集群数据
 */
export class OpenClawSidebarProvider implements vscode.TreeDataProvider<SidebarNode> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SidebarNode | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

    /**
     * 创建 OpenClawSidebarProvider 实例
     * @param agentManager - Agent 管理器实例
     * @param clusterManager - 集群管理器实例
     */
    constructor(
        private readonly agentManager: AgentManager,
        private readonly agentFolderManager: AgentFolderManager,
        private readonly clusterManager: ClusterManager
    ) {
        this.agentManager.on('agentCreated', () => this.refresh());
        this.agentManager.on('agentUpdated', () => this.refresh());
        this.agentManager.on('agentDeleted', () => this.refresh());
        this.agentManager.on('activeAgentChanged', () => this.refresh());
        this.agentFolderManager.on('foldersChanged', () => this.refresh());

        this.clusterManager.on('clusterCreated', () => this.refresh());
        this.clusterManager.on('clusterUpdated', () => this.refresh());
        this.clusterManager.on('clusterDeleted', () => this.refresh());
    }

    /**
     * 刷新树视图
     * 触发 onDidChangeTreeData 事件重新加载数据
     */
    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    /**
     * 获取树节点项
     * @param element - 树节点元素
     * @returns VSCode TreeItem 对象
     */
    public getTreeItem(element: SidebarNode): vscode.TreeItem {
        return element;
    }

    /**
     * 获取父节点
     * @param _element - 当前节点元素
     * @returns 父节点（根节点返回 null）
     */
    public getParent(_element: SidebarNode): vscode.ProviderResult<SidebarNode> {
        return null;
    }

    /**
     * 获取 Agent 列表节点
     * @returns Agent 相关节点数组
     */
    private async getAgentItems(): Promise<SidebarNode[]> {
        const agents = await this.agentManager.getAgents();
        if (agents.length === 0) {
            return [new SidebarInfoTreeItem(t('sidebar.noAgents'))];
        }

        const folders = await this.agentFolderManager.getFolders();
        const sortedAgents = this.sortAgents(agents);
        const agentMap = new Map(sortedAgents.map(agent => [agent.id, agent]));
        const assignedAgentIds = new Set<string>();

        const folderItems = folders.map(folder => {
            const folderAgentIds = folder.agentIds.filter(agentId => agentMap.has(agentId));
            folderAgentIds.forEach(agentId => assignedAgentIds.add(agentId));
            return new AgentFolderTreeItem(folder.id, folder.name, folderAgentIds, folder.collapsed);
        });

        const ungroupedAgentIds = sortedAgents
            .map(agent => agent.id)
            .filter(agentId => !assignedAgentIds.has(agentId));

        const ungroupedItem = new AgentFolderTreeItem(
            null,
            t('sidebar.ungrouped'),
            ungroupedAgentIds,
            false
        );

        return [...folderItems, ungroupedItem];
    }

    /**
     * 获取集群列表节点
     * @returns 集群相关节点数组
     */
    private async getClusterItems(): Promise<SidebarNode[]> {
        const clusters = await this.clusterManager.getClusters();
        if (clusters.length === 0) {
            return [new SidebarInfoTreeItem(t('sidebar.noClusters'))];
        }

        const sortedClusters = [...clusters].sort((a, b) => {
            if (a.status === b.status) {
                return a.name.localeCompare(b.name);
            }

            return a.status === 'active' ? -1 : 1;
        });

        return sortedClusters.map(cluster => new ClusterTreeItem(cluster, vscode.TreeItemCollapsibleState.None));
    }

    private sortAgents(agents: Agent[]) {
        const statusOrder: Record<string, number> = { active: 0, idle: 1, offline: 2 };
        return [...agents].sort((a, b) => {
            const statusDelta = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
            if (statusDelta !== 0) {
                return statusDelta;
            }
            return a.name.localeCompare(b.name);
        });
    }

    public async getChildren(element?: SidebarNode): Promise<SidebarNode[]> {
        if (!element) {
            const [agents, clusters] = await Promise.all([
                this.agentManager.getAgents(),
                this.clusterManager.getClusters()
            ]);

            return [
                new SidebarSectionTreeItem('agents', t('sidebar.agents'), agents.length),
                new SidebarSectionTreeItem('clusters', t('sidebar.clusters'), clusters.length)
            ];
        }

        if (element instanceof SidebarSectionTreeItem) {
            if (element.section === 'agents') {
                return this.getAgentItems();
            }

            return this.getClusterItems();
        }

        if (element instanceof AgentFolderTreeItem) {
            const agents = await this.agentManager.getAgents();
            const agentMap = new Map(agents.map(agent => [agent.id, agent]));
            const sortedAgents = this.sortAgents(
                element.agentIds
                    .map(agentId => agentMap.get(agentId))
                    .filter((agent): agent is Agent => Boolean(agent))
            );

            if (sortedAgents.length === 0) {
                return [new SidebarInfoTreeItem(t('sidebar.folderEmpty'))];
            }

            return sortedAgents.map(agent => new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None));
        }

        return [];
    }
}
