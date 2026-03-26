import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { AgentManager } from '../managers/agentManager';
import { AgentFolderManager } from '../managers/agentFolderManager';
import { ChannelManager } from '../managers/channelManager';
import { ClusterManager } from '../managers/clusterManager';
import { ScheduledTaskManager, type ScheduledTask } from '../managers/scheduledTaskManager';
import { UsageManager } from '../managers/usageManager';
import { OpenClawPanel } from '../panels/openclawPanel';
import { OpenClawSidebarProvider } from '../providers/openclawSidebarProvider';
import { TaskTreeProvider } from '../providers/taskTreeProvider';
import { UsageTreeProvider } from '../providers/usageTreeProvider';
import { AgentPresetScaffolder } from '../services/agentPresetScaffolder';
import { resolveOpenClawServiceConfig } from '../services/openclawConfig';
import { OpenClawService, RuntimeNotice } from '../services/openclawService';
import { showWarningNotification, showWarningStatus } from '../utils/statusFeedback';

const RUNTIME_NOTICE_DISPLAY_MS = 10000;

/**
 * OpenClaw VS Code 插件的运行时核心类。
 * 负责管理所有插件组件的生命周期，包括服务、管理器、提供者和视图。
 * 协调各组件之间的交互，处理配置变更、运行时通知和状态栏指示器更新。
 * 
 * @example
 * ```typescript
 * const runtime = await OpenClawExtensionRuntime.create(context);
 * runtime.registerProviders();
 * runtime.registerLifecycle();
 * await runtime.initialize();
 * ```
 */
export class OpenClawExtensionRuntime {
    public readonly service: OpenClawService;
    public readonly agentManager: AgentManager;
    public readonly channelManager: ChannelManager;
    public readonly agentFolderManager: AgentFolderManager;
    public readonly clusterManager: ClusterManager;
    public readonly usageManager: UsageManager;
    public readonly taskManager: ScheduledTaskManager;
    public readonly sidebarTreeProvider: OpenClawSidebarProvider;
    public readonly usageTreeProvider: UsageTreeProvider;
    public readonly taskTreeProvider: TaskTreeProvider;

    private readonly statusBarItem: vscode.StatusBarItem;       // 状态栏
    private sidebarView: vscode.TreeView<vscode.TreeItem> | undefined;
    private sidebarWasVisible = false;
    private statusBarRefreshToken = 0;
    private activeRuntimeNotice: (RuntimeNotice & { expiresAt: number }) | undefined = undefined;
    private runtimeNoticeTimer: NodeJS.Timeout | undefined = undefined;

    private constructor(
        public readonly context: vscode.ExtensionContext,
        service: OpenClawService,
        agentManager: AgentManager,
        agentFolderManager: AgentFolderManager,
        channelManager: ChannelManager,
        clusterManager: ClusterManager,
        usageManager: UsageManager,
        taskManager: ScheduledTaskManager
    ) {
        this.service = service;
        this.agentManager = agentManager;
        this.agentFolderManager = agentFolderManager;
        this.channelManager = channelManager;
        this.clusterManager = clusterManager;
        this.usageManager = usageManager;
        this.taskManager = taskManager;
        this.sidebarTreeProvider = new OpenClawSidebarProvider(agentManager, agentFolderManager, clusterManager);
        this.usageTreeProvider = new UsageTreeProvider(usageManager);
        this.taskTreeProvider = new TaskTreeProvider(taskManager);

        this.service.on('connectionChange', () => {
            this.refreshAllViews();
            void this.refreshStatusBarIndicator();
        });
        this.service.on('runtimeNotice', (notice: RuntimeNotice) => {
            this.handleRuntimeNotice(notice);
        });

        this.agentManager.on('agentCreated', () => {
            void this.refreshStatusBarIndicator();
        });
        this.agentManager.on('agentUpdated', () => {
            void this.refreshStatusBarIndicator();
        });
        this.agentManager.on('agentDeleted', () => {
            void this.refreshStatusBarIndicator();
        });

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.tooltip = t('statusBar.tooltip');
        this.statusBarItem.command = 'openclaw.openPanel';
        this.applyStatusBarIndicatorState('offline');
        this.statusBarItem.show();

        this.taskManager.on('taskRunStarted', (task: ScheduledTask) => {
            if (task.agentId) {
                this.agentManager.beginAgentRun(task.agentId);
            }
        });
        this.taskManager.on('taskRunCompleted', (task: ScheduledTask) => {
            if (task.agentId) {
                this.agentManager.endAgentRun(task.agentId);
            }
        });
    }

    /**
     * 初始化插件实例用的内容。
     * 根据配置解析结果创建OpenClawService实例，并基于此创建AgentManager、ChannelManager等核心组件。
     * 注意：本函数将直接拉起所有管理用实例。
     * @param context vscode上下文
     * @returns 返回本类实例
     */
    public static async create(context: vscode.ExtensionContext): Promise<OpenClawExtensionRuntime> {
        // 解析配置内容，从配置文件中加载配置
        const serviceConfig = await resolveOpenClawServiceConfig(context.extensionPath);    // 等待openclaw服务处理完毕 ResolvedServiceConfig
        // openclaw服务管理器的
        const service = new OpenClawService(serviceConfig);
        // 智能体管理器
        const agentManager = new AgentManager(
            service,
            new AgentPresetScaffolder(context.extensionPath, service)
        );
        // 频道管理器
        const channelManager = new ChannelManager(
            path.join(context.globalStorageUri.fsPath, 'channels.json')
        );
        // 智能体文件夹管理器。
        const agentFolderManager = new AgentFolderManager(
            path.join(context.globalStorageUri.fsPath, 'agent-folders.json')
        );
        // 创建集群管理器。
        const clusterManager = new ClusterManager(
            service,
            path.join(context.globalStorageUri.fsPath, 'clusters.json')
        );
        const usageManager = new UsageManager(service);
        const taskManager = new ScheduledTaskManager(service);

        // 随后开始构造插件主类
        return new OpenClawExtensionRuntime(
            context,
            service,
            agentManager,
            agentFolderManager,
            channelManager,
            clusterManager,
            usageManager,
            taskManager
        );
    }

    /**
     * 注册插件使用的各种提供者（providers）和生命周期事件监听器。
     */
    public registerProviders(): void {
        this.sidebarView = vscode.window.createTreeView('openclawSidebar', {
            treeDataProvider: this.sidebarTreeProvider
        });

        // 给上下文内压入
        this.context.subscriptions.push(
            this.statusBarItem,
            this.sidebarView,
            vscode.window.registerTreeDataProvider('openclawUsage', this.usageTreeProvider),
            vscode.window.registerTreeDataProvider('openclawTasks', this.taskTreeProvider)
        );

        this.context.subscriptions.push(
            this.sidebarView.onDidChangeVisibility((event: any) => {
                const becameVisible = event.visible && !this.sidebarWasVisible;
                this.sidebarWasVisible = event.visible;

                if (!becameVisible || this.getPanel()) {
                    return;
                }

                this.showPanel();
            })
        );

        this.context.subscriptions.push(
            this.sidebarView.onDidCollapseElement(async (event: any) => {
                if (event.element && 'folderId' in event.element) {
                    const folderId = event.element.folderId as string | undefined;
                    if (folderId) {
                        await this.agentFolderManager.setFolderCollapsed(folderId, true).catch(() => undefined);
                    }
                }
            }),
            this.sidebarView.onDidExpandElement(async (event: any) => {
                if (event.element && 'folderId' in event.element) {
                    const folderId = event.element.folderId as string | undefined;
                    if (folderId) {
                        await this.agentFolderManager.setFolderCollapsed(folderId, false).catch(() => undefined);
                    }
                }
            })
        );
    }

    /**
     * 注册插件生命周期相关的事件监听器，例如监听配置变化以刷新视图和状态栏等。
     */
    public registerLifecycle(): void {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event: any) => {
                if (event.affectsConfiguration('openclaw')) {
                    void this.handleConfigurationChange();
                }
            })
        );
    }
    /**
     * 插件初始化函数，设置初始状态并刷新视图和状态栏等。
     */
    public async initialize(): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'openclaw.enabled', true);
        this.refreshAllViews();
        await this.refreshStatusBarIndicator();
        void this.taskManager.refresh().catch((error: any) => {
            console.error('Failed to initialize scheduled tasks.', error);
        });
    }

    /**
     * 创建面板，该函数将调度主界面
     * @returns 
     */
    public showPanel(): OpenClawPanel {
        return OpenClawPanel.createOrShow(
            this.context.extensionUri,
            this.context,
            this.service,
            this.agentManager,
            this.agentFolderManager,
            this.channelManager,
            this.clusterManager,
            this.taskManager
        );
    }

    /**
     * 如果面板已经打开则返回面板实例，否则返回undefined。
     * @returns OpenClawPanel | undefined
     */
    public getPanel(): OpenClawPanel | undefined {
        return OpenClawPanel.getPanel();
    }

    /**
     * 刷新插件的视图和状态栏指示器。
     */
    public refreshAllViews(): void {
        this.sidebarTreeProvider.refresh();
        this.usageTreeProvider.refresh();
        this.taskTreeProvider.refresh();
    }

    /**
     * 处理配置更改并刷新视图和状态栏指示器。
     */
    public async handleConfigurationChange(): Promise<void> {
        const nextConfig = await resolveOpenClawServiceConfig(this.context.extensionPath);
        this.service.updateConfig(nextConfig);
        this.usageManager.invalidate();
        this.refreshAllViews();
        await this.refreshStatusBarIndicator();
    }

    /**
     * 销毁插件实例，释放资源并停止服务。
     */
    public dispose(): void {
        OpenClawPanel.disposePanel();
        this.agentManager.dispose();
        this.channelManager.dispose();
        this.agentFolderManager.dispose();
        this.clusterManager.dispose();
        this.usageManager.dispose();
        this.taskManager.dispose();
        this.service.dispose();
        if (this.runtimeNoticeTimer) {
            clearTimeout(this.runtimeNoticeTimer);
            this.runtimeNoticeTimer = undefined;
        }
        this.statusBarItem.dispose();
    }

    /**
     * 刷新状态栏指示器的状态。
     */
    private async refreshStatusBarIndicator(): Promise<void> {
        const refreshToken = ++this.statusBarRefreshToken;

        // 检查是否连接
        try {
            const connected = this.service.isConnected();
            if (!connected) {
                if (refreshToken === this.statusBarRefreshToken) {
                    this.applyStatusBarIndicatorState('offline');
                }
                return;
            }
            // 获取智能体
            const agents = await this.agentManager.getAgents();
            if (refreshToken !== this.statusBarRefreshToken) {
                return;
            }

            // 筛选内容
            const hasActiveAgent = agents.some((agent: any) => agent.status === 'active');
            this.applyStatusBarIndicatorState(hasActiveAgent ? 'active' : 'idle');
        } catch {
            if (refreshToken === this.statusBarRefreshToken) {
                this.applyStatusBarIndicatorState('offline');
            }
        }
    }

    /**
     * 根据当前运行时状态和可能存在的通知，更新状态栏指示器的显示内容和样式。
     * @param state 运行时状态
     * @returns void
     */
    private applyStatusBarIndicatorState(state: 'active' | 'idle' | 'offline'): void {
        const notice = this.getActiveRuntimeNotice();
        const noticeText = notice ? truncateStatusBarNotice(notice.message) : '';

        if (notice) {
            this.statusBarItem.text = `${notice.kind === 'compression' ? '$(sync~spin)' : '$(warning)'} OpenClaw${noticeText ? `: ${noticeText}` : ''}`;
            this.statusBarItem.tooltip = `${t('statusBar.tooltip')}\n${notice.message}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
            return;
        }

        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = t('statusBar.tooltip');
        this.statusBarItem.color = undefined;
        if (state === 'active') {
            this.statusBarItem.text = '$(sync~spin) OpenClaw';
            return;
        }
        if (state === 'offline') {
            this.statusBarItem.text = '$(circle-slash) OpenClaw';
            return;
        }
        this.statusBarItem.text = '$(rocket) OpenClaw';
    }

    /**
     * 处理来自OpenClaw服务的运行时通知，根据通知内容更新状态栏指示器和显示相关提示。
     * @param notice 运行时通知对象，包含通知类型、消息内容等信息
     */
    private handleRuntimeNotice(notice: RuntimeNotice): void {
        const normalizedMessage = String(notice.message || '').trim();
        if (!normalizedMessage) {
            return;
        }

        this.activeRuntimeNotice = {
            ...notice,
            message: normalizedMessage,
            expiresAt: Date.now() + RUNTIME_NOTICE_DISPLAY_MS
        };
        if (!this.getPanel()?.isVisible()) {
            void showWarningNotification(normalizedMessage);
        }
        showWarningStatus(normalizedMessage, Math.min(RUNTIME_NOTICE_DISPLAY_MS, 8000));
        this.scheduleRuntimeNoticeExpiry();
        void this.refreshStatusBarIndicator();
    }

    /**
     * 获取当前有效的运行时通知，如果通知已过期则返回undefined。
     * @returns 当前有效的运行时通知对象，如果没有有效通知则返回undefined
     */
    private getActiveRuntimeNotice(): (RuntimeNotice & { expiresAt: number }) | undefined {
        if (!this.activeRuntimeNotice) {
            return undefined;
        }

        if (this.activeRuntimeNotice.expiresAt <= Date.now()) {
            this.activeRuntimeNotice = undefined;
            return undefined;
        }

        return this.activeRuntimeNotice;
    }

    /**
     * 安排当前运行时通知的过期时间，过期后会自动清除通知并刷新状态栏指示器。
     */
    private scheduleRuntimeNoticeExpiry(): void {
        if (this.runtimeNoticeTimer) {
            clearTimeout(this.runtimeNoticeTimer);
            this.runtimeNoticeTimer = undefined;
        }

        const notice = this.getActiveRuntimeNotice();
        if (!notice) {
            return;
        }

        this.runtimeNoticeTimer = setTimeout(() => {
            this.runtimeNoticeTimer = undefined;
            if (!this.getActiveRuntimeNotice()) {
                void this.refreshStatusBarIndicator();
            }
        }, Math.max(0, notice.expiresAt - Date.now()));
    }
}

/**
 * 对于状态栏显示的通知消息，如果消息长度超过指定限制，则进行截断并添加省略号，以确保状态栏显示的内容简洁且不占用过多空间。
 * @param message 要显示的通知消息字符串
 * @param maxLength 最大允许的消息长度，默认值为42个字符
 * @returns 经过截断处理的消息字符串，如果原消息长度不超过限制，则返回原消息；如果超过限制，则返回截断后的消息并在末尾添加省略号
 */
function truncateStatusBarNotice(message: string, maxLength: number = 42): string {
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
