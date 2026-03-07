import * as vscode from 'vscode';
import { t } from '../i18n';
import { AgentManager } from '../managers/agentManager';
import { Agent } from '../services/openclawService';

export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly agent: Agent,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(agent.name, collapsibleState);
        
        this.tooltip = `${agent.name} (${agent.model})`;
        this.description = agent.model;
        
        // 根据状态设置图标
        switch (agent.status) {
            case 'active':
                this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
                break;
            case 'idle':
                this.iconPath = new vscode.ThemeIcon('circle-outline');
                break;
            case 'offline':
                this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('errorForeground'));
                break;
        }

        this.contextValue = 'agent';
        
        this.command = {
            command: 'openclaw.chat',
            title: t('provider.chatWithAgent'),
            arguments: [agent.id]
        };
    }
}

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | undefined | null | void> = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private agentManager: AgentManager;

    constructor(agentManager: AgentManager) {
        this.agentManager = agentManager;
        
        // 监听 Agent 变化
        this.agentManager.on('agentCreated', () => this.refresh());
        this.agentManager.on('agentUpdated', () => this.refresh());
        this.agentManager.on('agentDeleted', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
        if (element) {
            // Agent 没有子项
            return [];
        }

        const agents = await this.agentManager.getAgents();
        
        if (agents.length === 0) {
            return [];
        }

        // 按状态分组排序
        const sortedAgents = agents.sort((a, b) => {
            const statusOrder = { active: 0, idle: 1, offline: 2 };
            return statusOrder[a.status] - statusOrder[b.status];
        });

        return sortedAgents.map(agent => 
            new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None)
        );
    }

    getParent(element: AgentTreeItem): vscode.ProviderResult<AgentTreeItem> {
        return null;
    }
}
