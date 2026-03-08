import * as vscode from 'vscode';
import { t } from '../i18n';
import {
    ScheduledTask,
    ScheduledTaskManager
} from '../managers/scheduledTaskManager';

export class ScheduledTaskTreeItem extends vscode.TreeItem {
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

class TasksInfoTreeItem extends vscode.TreeItem {
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('descriptionForeground'));
        this.contextValue = 'taskInfo';
    }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<ScheduledTaskTreeItem | TasksInfoTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ScheduledTaskTreeItem | TasksInfoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ScheduledTaskTreeItem | TasksInfoTreeItem | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

    constructor(private readonly taskManager: ScheduledTaskManager) {
        this.taskManager.on('taskCreated', () => this.refresh());
        this.taskManager.on('taskUpdated', () => this.refresh());
        this.taskManager.on('taskDeleted', () => this.refresh());
        this.taskManager.on('taskRunStarted', () => this.refresh());
        this.taskManager.on('taskRunCompleted', () => this.refresh());
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: ScheduledTaskTreeItem | TasksInfoTreeItem): vscode.TreeItem {
        return element;
    }

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

        return viewState.tasks.map(task => new ScheduledTaskTreeItem(task, vscode.TreeItemCollapsibleState.None));
    }

    public getParent(_element: ScheduledTaskTreeItem | TasksInfoTreeItem): vscode.ProviderResult<ScheduledTaskTreeItem | TasksInfoTreeItem> {
        return null;
    }
}

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

function formatTaskTime(value: string): string {
    return new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatTaskDateTime(value: string): string {
    return new Date(value).toLocaleString();
}

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

function extractPayloadPreview(task: ScheduledTask): string {
    const content = task.payload.kind === 'systemEvent'
        ? task.payload.text
        : task.payload.message;

    return content.length > 120
        ? `${content.slice(0, 119).trimEnd()}...`
        : content;
}
