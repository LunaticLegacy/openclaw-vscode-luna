import * as vscode from 'vscode';
import { t } from '../i18n';
import { UsageManager } from '../managers/usageManager';

export class UsageTreeItem extends vscode.TreeItem {
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

export class UsageTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UsageTreeItem | undefined | null | void> = new vscode.EventEmitter<UsageTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UsageTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private usageManager: UsageManager;

    constructor(usageManager: UsageManager) {
        this.usageManager = usageManager;
        this.usageManager.on('usageUpdated', () => this.refresh());
        this.usageManager.on('usageInvalidated', () => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UsageTreeItem): vscode.TreeItem {
        return element;
    }

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

    getParent(element: UsageTreeItem): vscode.ProviderResult<UsageTreeItem> {
        return null;
    }
}
