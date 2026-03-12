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

        if (agent.status === 'active') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (agent.status === 'offline') {
            this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
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

        this.agentManager.on('agentCreated', () => this.refresh());
        this.agentManager.on('agentUpdated', () => this.refresh());
        this.agentManager.on('agentDeleted', () => this.refresh());
        this.agentManager.on('activeAgentChanged', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
        if (element) {
            return [];
        }

        const agents = await this.agentManager.getAgents();
        if (agents.length === 0) {
            return [];
        }

        const sortedAgents = agents.sort((a, b) => {
            const statusOrder = { active: 0, idle: 1, offline: 2 };
            return statusOrder[a.status] - statusOrder[b.status];
        });

        return sortedAgents.map(agent =>
            new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None)
        );
    }

    getParent(_element: AgentTreeItem): vscode.ProviderResult<AgentTreeItem> {
        return null;
    }
}
