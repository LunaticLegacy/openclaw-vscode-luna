import * as vscode from 'vscode';
import { t } from '../i18n';
import { UsageManager } from '../managers/usageManager';

/**
 * 使用量树节点项
 * 表示侧边栏中单个使用量指标的可视化节点
 */
export class UsageTreeItem extends vscode.TreeItem {
    /**
     * 创建 UsageTreeItem 实例
     * @param label - 显示标签
     * @param description - 描述文本
     * @param icon - 图标 ID
     * @param color - 图标颜色（可选）
     */
    constructor(
        label: string,
        description: string,
        icon: string,
        color?: vscode.ThemeColor
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `${label}: ${description}`;
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon, color);
        this.contextValue = 'usage';
    }
}

/**
 * 使用量树数据提供器
 * 实现 VSCode TreeDataProvider 接口，管理使用量指标的显示和更新
 */
export class UsageTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UsageTreeItem | undefined | null | void> = new vscode.EventEmitter<UsageTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UsageTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private usageManager: UsageManager;

    /**
     * 创建 UsageTreeProvider 实例
     * @param usageManager - 使用量管理器实例
     */
    constructor(usageManager: UsageManager) {
        this.usageManager = usageManager;
        this.usageManager.on('usageUpdated', () => this.refresh());
        this.usageManager.on('usageInvalidated', () => this.refresh());
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
    getTreeItem(element: UsageTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子节点列表
     * @param element - 父节点元素（根节点时为 undefined）
     * @returns UsageTreeItem 数组
     */
    async getChildren(element?: UsageTreeItem): Promise<UsageTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            await this.usageManager.getUsage();
            const metrics = this.usageManager.getMetrics();

            return [
                new UsageTreeItem(
                    t('usage.totalRequests'),
                    metrics.totalRequests.toLocaleString(),
                    'graph',
                    new vscode.ThemeColor('foreground')
                ),
                new UsageTreeItem(
                    t('usage.totalTokens'),
                    this.usageManager.formatTokenCount(metrics.totalTokens),
                    'symbol-key',
                    new vscode.ThemeColor('foreground')
                ),
                new UsageTreeItem(
                    t('usage.promptTokens'),
                    this.usageManager.formatTokenCount(metrics.promptTokens),
                    'arrow-up',
                    new vscode.ThemeColor('debugIcon.continueForeground')
                ),
                new UsageTreeItem(
                    t('usage.completionTokens'),
                    this.usageManager.formatTokenCount(metrics.completionTokens),
                    'arrow-down',
                    new vscode.ThemeColor('debugIcon.stepBackForeground')
                ),
                new UsageTreeItem(
                    t('usage.estimatedCost'),
                    this.usageManager.formatCost(metrics.estimatedCost),
                    'credit-card',
                    new vscode.ThemeColor('terminal.ansiGreen')
                ),
                new UsageTreeItem(
                    t('usage.todaysRequests'),
                    metrics.requestsToday.toLocaleString(),
                    'calendar',
                    new vscode.ThemeColor('foreground')
                ),
                new UsageTreeItem(
                    t('usage.todaysTokens'),
                    this.usageManager.formatTokenCount(metrics.tokensToday),
                    'symbol-number',
                    new vscode.ThemeColor('foreground')
                )
            ];
        } catch (error) {
            return [
                new UsageTreeItem(
                    t('usage.error'),
                    t('usage.failedLoadData'),
                    'error',
                    new vscode.ThemeColor('errorForeground')
                )
            ];
        }
    }

    /**
     * 获取父节点
     * @param element - 当前节点元素
     * @returns 父节点（根节点返回 null）
     */
    getParent(element: UsageTreeItem): vscode.ProviderResult<UsageTreeItem> {
        return null;
    }
}
