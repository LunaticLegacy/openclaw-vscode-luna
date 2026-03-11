import * as vscode from 'vscode';

import { t } from '../../i18n';
import { runWithNotificationProgress } from '../../utils/statusFeedback';

type PanelViewMode = 'chat' | 'clusters' | 'usage' | 'channel' | 'tasks';

interface MessageRouterContext {
    issueTrackerUrl: string;
    setWebviewReady(ready: boolean): void;
    flushPendingMessages(): void;
    postRuntimeState(): void;
    refreshRuntimeState(): Promise<void>;
    isInitialDataLoaded(): boolean;
    setInitialDataLoaded(value: boolean): void;
    loadAgents(): Promise<void>;
    loadChannels(selectedChannelId?: string): Promise<void>;
    loadClusters(selectedClusterId?: string): Promise<void>;
    loadTasks(): Promise<void>;
    loadUsage(): Promise<void>;
    handleSendMessage(content: string, agentId?: string, options?: { optimisticEcho?: boolean }): Promise<void>;
    handleStopActiveRun(scope: unknown): void;
    activateAgent(agentId: string): Promise<void>;
    loadClusterAgentMessages(clusterId: string, agentId: string): Promise<void>;
    clearChat(): void;
    refreshAgents(force?: boolean): Promise<void>;
    handleCreateAgent(data: any): Promise<void>;
    showClusterEditor(clusterId?: string): void;
    handleSaveCluster(clusterId: string | undefined, data: any): Promise<void>;
    activateChannel(channelId: string | null | undefined): Promise<void>;
    refreshActiveChannelMessages(channelId?: string): Promise<void>;
    handleCreateChannel(data: any): Promise<void>;
    handleUpdateChannel(channelId: string, data: any): Promise<void>;
    handleDeleteChannel(channelId: string): Promise<void>;
    handleSendChannelMessage(channelId: string, content: string): Promise<void>;
    handleAddAgentsToCluster(clusterId: string): Promise<void>;
    handleRemoveAgentsFromCluster(clusterId: string): Promise<void>;
    handleDeleteAgent(agentId: string): Promise<void>;
    handleCreateTask(data: any): Promise<void>;
    handleUpdateTask(taskId: string, data: any): Promise<void>;
    handleDeleteTask(taskId: string): Promise<void>;
    handleToggleTask(taskId: string, enabled?: boolean): Promise<void>;
    handleRunTask(taskId: string): Promise<void>;
    setViewMode(view: PanelViewMode): void;
    getCurrentChannelId(): string | null;
    handleBroadcast(clusterId: string, message: string): Promise<void>;
    promptBroadcastToCluster(clusterId: string): Promise<void>;
    handleCollaborate(clusterId: string, message: string): Promise<void>;
    handleClusterAgentMessage(clusterId: string, agentId: string, content: string): Promise<void>;
    promptCollaborateCluster(clusterId: string): Promise<void>;
    handleSaveAgentSettings(agentId: string, settings: any): Promise<void>;
    handleRetryConnection(): Promise<void>;
    handleStartOpenClaw(): Promise<void>;
    handleSaveConnectionSettings(settings: any): Promise<void>;
    handleSaveOpenClawConfig(settings: any): Promise<void>;
}

export async function handlePanelMessage(context: MessageRouterContext, message: any): Promise<void> {
    switch (message.type) {
        case 'webviewReady':
            context.setWebviewReady(true);
            context.flushPendingMessages();
            context.postRuntimeState();
            void context.refreshRuntimeState();
            if (!context.isInitialDataLoaded()) {
                context.setInitialDataLoaded(true);
                await Promise.all([
                    context.loadAgents(),
                    context.loadChannels(),
                    context.loadClusters(),
                    context.loadTasks()
                ]);
            }
            break;

        case 'sendMessage':
            await context.handleSendMessage(message.content, message.agentId, {
                optimisticEcho: Boolean(message.optimistic)
            });
            break;

        case 'stopActiveRun':
            context.handleStopActiveRun(message.scope);
            break;

        case 'selectAgent':
            await context.activateAgent(message.agentId);
            break;

        case 'loadClusterAgentMessages':
            await context.loadClusterAgentMessages(message.clusterId, message.agentId);
            break;

        case 'clearChat':
            context.clearChat();
            break;

        case 'getClusters':
            await runWithNotificationProgress(t('progress.loadingClusters'), async () => {
                await context.loadClusters();
            });
            break;

        case 'getUsage':
            await runWithNotificationProgress(t('progress.loadingUsage'), async () => {
                await context.loadUsage();
            });
            break;

        case 'getChannels':
            await runWithNotificationProgress(t('progress.loadingChannels'), async () => {
                await context.loadChannels(context.getCurrentChannelId() || undefined);
            });
            break;

        case 'getTasks':
            await runWithNotificationProgress(t('progress.loadingTasks'), async () => {
                await context.loadTasks();
            });
            break;

        case 'getAgents':
            await runWithNotificationProgress(t('progress.loadingAgents'), async () => {
                await context.refreshAgents(true);
            });
            break;

        case 'createAgent':
            await context.handleCreateAgent(message.data);
            break;

        case 'createCluster':
            context.showClusterEditor(message.clusterId);
            break;

        case 'saveCluster':
            await context.handleSaveCluster(message.clusterId, message.data);
            break;

        case 'selectChannel':
            await context.activateChannel(message.channelId);
            break;

        case 'refreshChannelMessages':
            await context.refreshActiveChannelMessages(message.channelId);
            break;

        case 'createChannel':
            await context.handleCreateChannel(message.data);
            break;

        case 'updateChannel':
            await context.handleUpdateChannel(message.channelId, message.data);
            break;

        case 'deleteChannel':
            await context.handleDeleteChannel(message.channelId);
            break;

        case 'sendChannelMessage':
            await context.handleSendChannelMessage(message.channelId, message.content);
            break;

        case 'addAgentsToCluster':
            await context.handleAddAgentsToCluster(message.clusterId);
            break;

        case 'removeAgentsFromCluster':
            await context.handleRemoveAgentsFromCluster(message.clusterId);
            break;

        case 'deleteAgent':
            await context.handleDeleteAgent(message.agentId);
            break;

        case 'createTask':
            await context.handleCreateTask(message.data);
            break;

        case 'updateTask':
            await context.handleUpdateTask(message.taskId, message.data);
            break;

        case 'deleteTask':
            await context.handleDeleteTask(message.taskId);
            break;

        case 'toggleTask':
            await context.handleToggleTask(message.taskId, message.enabled);
            break;

        case 'runTask':
            await context.handleRunTask(message.taskId);
            break;

        case 'switchView':
            context.setViewMode(message.view);
            if (message.view === 'clusters') {
                await context.loadClusters(message.clusterId);
            } else if (message.view === 'usage') {
                await context.loadUsage();
            } else if (message.view === 'channel') {
                await context.loadChannels(context.getCurrentChannelId() || undefined);
            } else if (message.view === 'tasks') {
                await context.loadTasks();
            }
            break;

        case 'broadcastToCluster':
            await context.handleBroadcast(message.clusterId, message.message);
            break;

        case 'promptBroadcastToCluster':
            await context.promptBroadcastToCluster(message.clusterId);
            break;

        case 'collaborateCluster':
            await context.handleCollaborate(message.clusterId, message.message);
            break;

        case 'sendClusterAgentMessage':
            await context.handleClusterAgentMessage(message.clusterId, message.agentId, message.content);
            break;

        case 'promptCollaborateCluster':
            await context.promptCollaborateCluster(message.clusterId);
            break;

        case 'deleteCluster':
            await vscode.commands.executeCommand('openclaw.deleteCluster', message.clusterId);
            await context.loadClusters();
            break;

        case 'saveAgentSettings':
            await context.handleSaveAgentSettings(message.agentId, message.settings);
            break;

        case 'openAgentSettings':
            await vscode.commands.executeCommand('openclaw.openAgentSettings', message.agentId);
            break;

        case 'openAgentFolder':
            await vscode.commands.executeCommand('openclaw.openAgentFolder', message.agentId);
            break;

        case 'openSettings':
            await vscode.commands.executeCommand('openclaw.settings');
            break;

        case 'openIssueTracker':
            await vscode.env.openExternal(vscode.Uri.parse(context.issueTrackerUrl));
            break;

        case 'openSkillUrl':
            if (typeof message.url === 'string' && message.url.trim()) {
                await vscode.env.openExternal(vscode.Uri.parse(message.url.trim()));
            }
            break;

        case 'retryConnection':
            await context.handleRetryConnection();
            break;

        case 'startOpenClaw':
            await context.handleStartOpenClaw();
            break;

        case 'refreshOpenClawConfig':
            await runWithNotificationProgress(t('progress.loadingConfig'), async () => {
                await context.refreshRuntimeState();
            });
            break;

        case 'saveConnectionSettings':
            await context.handleSaveConnectionSettings(message.settings);
            break;

        case 'saveOpenClawConfig':
            await context.handleSaveOpenClawConfig(message.settings);
            break;
    }
}
