import * as vscode from 'vscode';
import { t } from '../i18n';
import { AgentManager } from '../managers/agentManager';
import { ClusterManager } from '../managers/clusterManager';
import { AgentTreeItem } from './agentTreeProvider';
import { ClusterTreeItem } from './clusterTreeProvider';

type SidebarNode = SidebarSectionTreeItem | SidebarInfoTreeItem | AgentTreeItem | ClusterTreeItem;

class SidebarSectionTreeItem extends vscode.TreeItem {
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

class SidebarInfoTreeItem extends vscode.TreeItem {
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'sidebarInfo';
        this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('descriptionForeground'));
    }
}

export class OpenClawSidebarProvider implements vscode.TreeDataProvider<SidebarNode> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SidebarNode | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

    constructor(
        private readonly agentManager: AgentManager,
        private readonly clusterManager: ClusterManager
    ) {
        this.agentManager.on('agentCreated', () => this.refresh());
        this.agentManager.on('agentUpdated', () => this.refresh());
        this.agentManager.on('agentDeleted', () => this.refresh());

        this.clusterManager.on('clusterCreated', () => this.refresh());
        this.clusterManager.on('clusterUpdated', () => this.refresh());
        this.clusterManager.on('clusterDeleted', () => this.refresh());
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: SidebarNode): vscode.TreeItem {
        return element;
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

        return [];
    }

    public getParent(_element: SidebarNode): vscode.ProviderResult<SidebarNode> {
        return null;
    }

    private async getAgentItems(): Promise<SidebarNode[]> {
        const agents = await this.agentManager.getAgents();
        if (agents.length === 0) {
            return [new SidebarInfoTreeItem(t('sidebar.noAgents'))];
        }

        const sortedAgents = [...agents].sort((a, b) => {
            const statusOrder: Record<string, number> = { active: 0, idle: 1, offline: 2 };
            return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
        });

        return sortedAgents.map(agent => new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None));
    }

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
}
