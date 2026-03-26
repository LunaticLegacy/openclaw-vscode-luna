import * as vscode from 'vscode';
import { t } from '../i18n';
import {
    ScheduledTask,
    ScheduledTaskManager
} from '../managers/scheduledTaskManager';

/**
 * 定时任务树节点项
 * 表示侧边栏中单个计划任务的可视化节点
 */
export class ScheduledTaskTreeItem extends vscode.TreeItem {
    /**
     * 创建 ScheduledTaskTreeItem 实例
     * @param task - 计划任务数据对象
     * @param collapsibleState - 节点的折叠状态
     */
    constructor(
        public readonly task: ScheduledTask,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(task.name, collapsibleState);

        this.description = buildTaskDescription(task);
        this.tooltip = buildTaskTooltip(task);
        this.iconPath = buildTaskIcon(task);
        this.contextValue = task.enabled ? 'taskEnabled' : 'taskDisabled';
        this.command = {
            command: 'openclaw.editTask',
            title: t('tasks.edit'),
            arguments: [task.id]
        };
    }
}

/**
 * 任务信息树节点
 * 用于显示空状态或不可用状态
 */
class TasksInfoTreeItem extends vscode.TreeItem {
    /**
     * 创建 TasksInfoTreeItem 实例
     * @param message - 显示的信息文本
     */
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('descriptionForeground'));
        this.contextValue = 'taskInfo';
    }
}

/**
 * 任务树数据提供器
 * 实现 VSCode TreeDataProvider 接口，管理定时任务列表的显示和更新
 */
export class TaskTreeProvider implements vscode.TreeDataProvider<ScheduledTaskTreeItem | TasksInfoTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ScheduledTaskTreeItem | TasksInfoTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ScheduledTaskTreeItem | TasksInfoTreeItem | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    /**
     * 创建 TaskTreeProvider 实例
     * @param taskManager - 定时任务管理器实例
     */
    constructor(private readonly taskManager: ScheduledTaskManager) {
        this.taskManager.on('taskCreated', () => this.refresh());
        this.taskManager.on('taskUpdated', () => this.refresh());
        this.taskManager.on('taskDeleted', () => this.refresh());
        this.taskManager.on('taskRunStarted', () => this.refresh());
        this.taskManager.on('taskRunCompleted', () => this.refresh());
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
    public getTreeItem(element: ScheduledTaskTreeItem | TasksInfoTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子节点列表
     * @param element - 父节点元素（根节点时为 undefined）
     * @returns 任务节点数组
     */
    public async getChildren(element?: ScheduledTaskTreeItem | TasksInfoTreeItem): Promise<Array<ScheduledTaskTreeItem | TasksInfoTreeItem>> {
        if (element) {
            return [];
        }

        const viewState = await this.taskManager.getTaskViewState();
        if (!viewState.available) {
            return [new TasksInfoTreeItem(viewState.message || t('tasks.unavailable'))];
        }

        if (viewState.tasks.length === 0) {
            return [new TasksInfoTreeItem(t('tasks.empty'))];
        }

        return viewState.tasks.map((task: any) => new ScheduledTaskTreeItem(task, vscode.TreeItemCollapsibleState.None));
    }

    /**
     * 获取父节点
     * @param _element - 当前节点元素
     * @returns 父节点（根节点返回 undefined）
     */
    public getParent(_element: ScheduledTaskTreeItem | TasksInfoTreeItem): vscode.ProviderResult<ScheduledTaskTreeItem | TasksInfoTreeItem> {
        return undefined;
    }
}

/**
 * 构建任务描述文本
 * @param task - 计划任务对象
 * @returns 格式化的描述字符串
 */
function buildTaskDescription(task: ScheduledTask): string {
    const parts = [formatTaskSchedule(task)];

    if (!task.enabled) {
        parts.push(t('tasks.status.disabled'));
    } else if (task.lastRunStatus === 'running') {
        parts.push(t('tasks.status.running'));
    } else if (task.nextRunAt) {
        parts.push(t('tasks.nextRunAtShort', {
            time: formatTaskTime(task.nextRunAt)
        }));
    }

    return parts.join(' · ');
}

/**
 * 构建任务提示文本
 * @param task - 计划任务对象
 * @returns 格式化的提示字符串
 */
function buildTaskTooltip(task: ScheduledTask): string {
    const lines = [
        `${task.name}`,
        `${t('tasks.target')}: ${task.agentId || '-'}`,
        `${t('tasks.schedule')}: ${formatTaskSchedule(task)}`,
        `${t('tasks.payloadKind')}: ${t(task.payload.kind === 'systemEvent' ? 'tasks.form.payloadSystemEvent' : 'tasks.form.payloadAgentTurn')}`,
        `${t('tasks.status.label')}: ${t(`tasks.status.${task.enabled ? task.lastRunStatus : 'disabled'}`)}`
    ];

    if (task.description) {
        lines.push(`${t('tasks.description')}: ${task.description}`);
    }

    if (task.nextRunAt && task.enabled) {
        lines.push(t('tasks.nextRunAt', { time: formatTaskDateTime(task.nextRunAt) }));
    }

    if (task.lastRunAt) {
        lines.push(t('tasks.lastRunAt', { time: formatTaskDateTime(task.lastRunAt) }));
    }

    if (task.lastError) {
        lines.push(t('tasks.lastError', { error: task.lastError }));
    } else if (task.lastRunSummary) {
        lines.push(t('tasks.lastResult', { summary: task.lastRunSummary }));
    }

    lines.push(`${t('tasks.form.content')}: ${extractPayloadPreview(task)}`);

    return lines.join('\n');
}

/**
 * 构建任务图标
 * @param task - 计划任务对象
 * @returns VSCode 主题图标
 */
function buildTaskIcon(task: ScheduledTask): vscode.ThemeIcon {
    if (!task.enabled) {
        return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('disabledForeground'));
    }

    switch (task.lastRunStatus) {
        case 'running':
            return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
        case 'failed':
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        case 'success':
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        default:
            return new vscode.ThemeIcon('clock', new vscode.ThemeColor('symbolIcon.variableForeground'));
    }
}

/**
 * 格式化任务时间（仅时间部分）
 * @param value - ISO 格式的时间字符串
 * @returns 格式化后的时间字符串
 */
function formatTaskTime(value: string): string {
    return new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 格式化任务日期时间
 * @param value - ISO 格式的时间字符串
 * @returns 格式化后的日期时间字符串
 */
function formatTaskDateTime(value: string): string {
    return new Date(value).toLocaleString();
}

/**
 * 格式化任务调度计划
 * @param task - 计划任务对象
 * @returns 格式化的调度描述字符串
 */
function formatTaskSchedule(task: ScheduledTask): string {
    switch (task.schedule.kind) {
        case 'at':
            return `${t('tasks.form.scheduleAt')}: ${formatTaskDateTime(task.schedule.at)}`;
        case 'cron':
            return task.schedule.tz
                ? `${task.schedule.expr} (${task.schedule.tz})`
                : task.schedule.expr;
        case 'every':
        default:
            return formatEveryDuration(task.schedule.everyMs);
    }
}

/**
 * 格式化持续时间（毫秒转人类可读格式）
 * @param value - 毫秒数
 * @returns 人类可读的持续时间字符串
 */
function formatEveryDuration(value: number): string {
    if (value % 86_400_000 === 0) {
        return `${value / 86_400_000}d`;
    }

    if (value % 3_600_000 === 0) {
        return `${value / 3_600_000}h`;
    }

    if (value % 60_000 === 0) {
        return `${value / 60_000}m`;
    }

    if (value % 1_000 === 0) {
        return `${value / 1_000}s`;
    }

    return `${value}ms`;
}

/**
 * 提取任务负载内容预览
 * @param task - 计划任务对象
 * @returns 截断后的内容预览字符串
 */
function extractPayloadPreview(task: ScheduledTask): string {
    const content = task.payload.kind === 'systemEvent'
        ? task.payload.text
        : task.payload.message;

    return content.length > 120
        ? `${content.slice(0, 119).trimEnd()}...`
        : content;
}
