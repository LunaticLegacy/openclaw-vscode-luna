import * as vscode from 'vscode';

import { t } from '../i18n';
import { AgentManager } from '../managers/agentManager';
import { Agent } from '../services/openclawService';
import { getAgentStatusIndicator } from './statusIndicators';

/**
 * Agent 树节点项
 * 表示侧边栏中单个 Agent 的可视化节点
 */
export class AgentTreeItem extends vscode.TreeItem {
    /**
     * 创建 AgentTreeItem 实例
     * @param agent - Agent 数据对象
     * @param collapsibleState - 节点的折叠状态
     */
    constructor(
        public readonly agent: Agent,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(agent.name, collapsibleState);

        this.tooltip = `${agent.name} (${agent.model})`;
        this.description = agent.model;

        const indicator = getAgentStatusIndicator(agent.status);
        this.iconPath = new vscode.ThemeIcon(indicator.iconId, new vscode.ThemeColor(indicator.colorId));

        this.contextValue = 'agent';
        this.command = {
            command: 'openclaw.chat',
            title: t('provider.chatWithAgent'),
            arguments: [agent.id]
        };
    }
}

/**
 * Agent 树数据提供器
 * 实现 VSCode TreeDataProvider 接口，管理 Agent 列表的显示和更新
 */
export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | undefined | void> = new vscode.EventEmitter<AgentTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private agentManager: AgentManager;

    /**
     * 创建 AgentTreeProvider 实例
     * @param agentManager - Agent 管理器实例
     */
    constructor(agentManager: AgentManager) {
        this.agentManager = agentManager;

        this.agentManager.on('agentCreated', () => this.refresh());
        this.agentManager.on('agentUpdated', () => this.refresh());
        this.agentManager.on('agentDeleted', () => this.refresh());
        this.agentManager.on('activeAgentChanged', () => this.refresh());
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
    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子节点列表
     * @param element - 父节点元素（根节点时为 undefined）
     * @returns AgentTreeItem 数组
     */
    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
        if (element) {
            return [];
        }

        const agents = await this.agentManager.getAgents();
        if (agents.length === 0) {
            return [];
        }

        const sortedAgents = agents.sort((a: Agent, b: Agent) => {
            const statusOrder: Record<Agent['status'], number> = { active: 0, idle: 1, offline: 2 };
            return statusOrder[a.status] - statusOrder[b.status];
        });

        return sortedAgents.map((agent: Agent) =>
            new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None)
        );
    }

    /**
     * 获取父节点
     * @param _element - 当前节点元素
     * @returns 父节点（根节点返回 undefined）
     */
    getParent(_element: AgentTreeItem): vscode.ProviderResult<AgentTreeItem> {
        return undefined;
    }
}
