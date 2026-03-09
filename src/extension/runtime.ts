import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { AgentManager } from '../managers/agentManager';
import { ClusterManager } from '../managers/clusterManager';
import { ScheduledTaskManager } from '../managers/scheduledTaskManager';
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
    public readonly clusterManager: ClusterManager;
    public readonly usageManager: UsageManager;
    public readonly taskManager: ScheduledTaskManager;
    public readonly sidebarTreeProvider: OpenClawSidebarProvider;
    public readonly usageTreeProvider: UsageTreeProvider;
    public readonly taskTreeProvider: TaskTreeProvider;

    private readonly statusBarItem: vscode.StatusBarItem;

    private constructor(
        public readonly context: vscode.ExtensionContext,
        service: OpenClawService,
        agentManager: AgentManager,
        clusterManager: ClusterManager,
        usageManager: UsageManager,
        taskManager: ScheduledTaskManager
    ) {
        this.service = service;
        this.agentManager = agentManager;
        this.clusterManager = clusterManager;
        this.usageManager = usageManager;
        this.taskManager = taskManager;
        this.sidebarTreeProvider = new OpenClawSidebarProvider(agentManager, clusterManager);
        this.usageTreeProvider = new UsageTreeProvider(usageManager);
        this.taskTreeProvider = new TaskTreeProvider(taskManager);

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.text = '$(rocket) OpenClaw';
        this.statusBarItem.tooltip = t('statusBar.tooltip');
        this.statusBarItem.command = 'openclaw.openPanel';
        this.statusBarItem.show();
    }

    public static async create(context: vscode.ExtensionContext): Promise<OpenClawExtensionRuntime> {
        const serviceConfig = await resolveOpenClawServiceConfig(context.extensionPath);
        const service = new OpenClawService(serviceConfig);
        const agentManager = new AgentManager(
            service,
            new AgentPresetScaffolder(context.extensionPath, service)
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
            clusterManager,
            usageManager,
            taskManager
        );
    }

    public registerProviders(): void {
        this.context.subscriptions.push(
            this.statusBarItem,
            vscode.window.registerTreeDataProvider('openclawSidebar', this.sidebarTreeProvider),
            vscode.window.registerTreeDataProvider('openclawUsage', this.usageTreeProvider),
            vscode.window.registerTreeDataProvider('openclawTasks', this.taskTreeProvider)
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
        void this.taskManager.refresh().catch(error => {
            console.error('Failed to initialize scheduled tasks.', error);
        });
    }

    public showPanel(): OpenClawPanel {
        return OpenClawPanel.createOrShow(
            this.context.extensionUri,
            this.service,
            this.agentManager,
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
    }

    public dispose(): void {
        OpenClawPanel.disposePanel();
        this.agentManager.dispose();
        this.clusterManager.dispose();
        this.usageManager.dispose();
        this.taskManager.dispose();
        this.service.dispose();
        this.statusBarItem.dispose();
    }
}
