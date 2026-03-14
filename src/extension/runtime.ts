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
import { OpenClawService } from '../services/openclawService';

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

    private readonly statusBarItem: vscode.StatusBarItem;
    private sidebarView: vscode.TreeView<vscode.TreeItem> | undefined;
    private sidebarWasVisible = false;
    private statusBarRefreshToken = 0;

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
        this.sidebarTreeProvider = new OpenClawSidebarProvider(agentManager, clusterManager);
        this.usageTreeProvider = new UsageTreeProvider(usageManager);
        this.taskTreeProvider = new TaskTreeProvider(taskManager);

        this.service.on('connectionChange', () => {
            this.refreshAllViews();
            void this.refreshStatusBarIndicator();
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

    public static async create(context: vscode.ExtensionContext): Promise<OpenClawExtensionRuntime> {
        const serviceConfig = await resolveOpenClawServiceConfig(context.extensionPath);
        const service = new OpenClawService(serviceConfig);
        const agentManager = new AgentManager(
            service,
            new AgentPresetScaffolder(context.extensionPath, service)
        );
        const channelManager = new ChannelManager(
            path.join(context.globalStorageUri.fsPath, 'channels.json')
        );
        const agentFolderManager = new AgentFolderManager(
            path.join(context.globalStorageUri.fsPath, 'agent-folders.json')
        );
        const clusterManager = new ClusterManager(
            service,
            path.join(context.globalStorageUri.fsPath, 'clusters.json')
        );
        const usageManager = new UsageManager(service);
        const taskManager = new ScheduledTaskManager(service);

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

    public registerProviders(): void {
        this.sidebarView = vscode.window.createTreeView('openclawSidebar', {
            treeDataProvider: this.sidebarTreeProvider
        });

        this.context.subscriptions.push(
            this.statusBarItem,
            this.sidebarView,
            vscode.window.registerTreeDataProvider('openclawUsage', this.usageTreeProvider),
            vscode.window.registerTreeDataProvider('openclawTasks', this.taskTreeProvider)
        );

        this.context.subscriptions.push(
            this.sidebarView.onDidChangeVisibility(event => {
                const becameVisible = event.visible && !this.sidebarWasVisible;
                this.sidebarWasVisible = event.visible;

                if (!becameVisible || this.getPanel()) {
                    return;
                }

                this.showPanel();
            })
        );
    }

    public registerLifecycle(): void {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('openclaw')) {
                    void this.handleConfigurationChange();
                }
            })
        );
    }

    public async initialize(): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'openclaw.enabled', true);
        this.refreshAllViews();
        await this.refreshStatusBarIndicator();
        void this.taskManager.refresh().catch(error => {
            console.error('Failed to initialize scheduled tasks.', error);
        });
    }

    public showPanel(): OpenClawPanel {
        return OpenClawPanel.createOrShow(
            this.context.extensionUri,
            this.service,
            this.agentManager,
            this.agentFolderManager,
            this.channelManager,
            this.clusterManager,
            this.taskManager
        );
    }

    public getPanel(): OpenClawPanel | undefined {
        return OpenClawPanel.getPanel();
    }

    public refreshAllViews(): void {
        this.sidebarTreeProvider.refresh();
        this.usageTreeProvider.refresh();
        this.taskTreeProvider.refresh();
    }

    public async handleConfigurationChange(): Promise<void> {
        const nextConfig = await resolveOpenClawServiceConfig(this.context.extensionPath);
        this.service.updateConfig(nextConfig);
        this.usageManager.invalidate();
        this.refreshAllViews();
        await this.refreshStatusBarIndicator();
    }

    public dispose(): void {
        OpenClawPanel.disposePanel();
        this.agentManager.dispose();
        this.channelManager.dispose();
        this.agentFolderManager.dispose();
        this.clusterManager.dispose();
        this.usageManager.dispose();
        this.taskManager.dispose();
        this.service.dispose();
        this.statusBarItem.dispose();
    }

    private async refreshStatusBarIndicator(): Promise<void> {
        const refreshToken = ++this.statusBarRefreshToken;

        try {
            const connected = this.service.isConnected();
            if (!connected) {
                if (refreshToken === this.statusBarRefreshToken) {
                    this.applyStatusBarIndicatorState('offline');
                }
                return;
            }

            const agents = await this.agentManager.getAgents();
            if (refreshToken !== this.statusBarRefreshToken) {
                return;
            }

            const hasActiveAgent = agents.some(agent => agent.status === 'active');
            this.applyStatusBarIndicatorState(hasActiveAgent ? 'active' : 'idle');
        } catch {
            if (refreshToken === this.statusBarRefreshToken) {
                this.applyStatusBarIndicatorState('offline');
            }
        }
    }

    private applyStatusBarIndicatorState(state: 'active' | 'idle' | 'offline'): void {
        void state;
        this.statusBarItem.text = '$(rocket) OpenClaw';
        this.statusBarItem.color = undefined;
    }
}
