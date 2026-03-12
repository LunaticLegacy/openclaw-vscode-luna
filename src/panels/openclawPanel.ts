import * as fs from 'fs';
import * as vscode from 'vscode';
import { getClusterWorkModePresets } from '../config/clusterWorkModes';
import { getAiSkills } from '../config/aiSkills';
import { getCurrentLocale, t, MESSAGES } from '../i18n';
import { OpenClawService, ChatMessage, ChatSession, AgentCluster, APIUsage } from '../services/openclawService';
import {
    inspectOpenClawEnvironment,
    loadOpenClawConfigEditorState,
    OpenClawConfigEditorState,
    OpenClawRuntimeDiagnostics,
    resolveOpenClawServiceConfig,
    saveOpenClawConfigEditorState,
    startOpenClawGateway
} from '../services/openclawConfig';
import type { DiscoveredChannel, OpenClawBooleanCapabilityId } from '../services/openclawService';
import { runWithNotificationProgress, showSuccessStatus } from '../utils/statusFeedback';
import { getCapabilityUnavailableMessage } from '../utils/capabilitySupport';
import { AgentManager, isDuplicateAgentNameError } from '../managers/agentManager';
import { AgentFolderManager } from '../managers/agentFolderManager';
import { ChatSessionManager } from '../managers/chatSessionManager';
import { ChannelManager } from '../managers/channelManager';
import { ClusterManager } from '../managers/clusterManager';
import { ScheduledTask, ScheduledTaskManager } from '../managers/scheduledTaskManager';
import { getAgentPresets } from '../config/agentPresets';
import { buildOpenClawPanelHtml } from './openclawPanel/webviewHtml';
import {
    buildImportedChannelSessionKey,
    buildMessageSyncSignature,
    delay,
    normalizeOutgoingMessageContent
} from './openclawPanel/helpers';
import {
    handleRetryConnection as retryConnectionAction,
    handleSaveConnectionSettings as saveConnectionSettingsAction,
    handleSaveOpenClawConfig as saveOpenClawConfigAction,
    handleStartOpenClaw as startOpenClawAction,
    postRuntimeState as postRuntimeStateAction,
    refreshRuntimeState as refreshRuntimeStateAction
} from './openclawPanel/runtimeActions';
import {
    handleCreateTask as createTaskAction,
    handleDeleteTask as deleteTaskAction,
    handleRunTask as runTaskAction,
    handleToggleTask as toggleTaskAction,
    handleUpdateTask as updateTaskAction,
    loadTasks as loadTasksAction
} from './openclawPanel/taskActions';
import {
    handleAddAgentsToCluster as addAgentsToClusterAction,
    handleBroadcast as broadcastToClusterAction,
    handleClusterAgentMessage as clusterAgentMessageAction,
    handleClusterAgentSessionCommand as clusterAgentSessionCommandAction,
    handleCollaborate as collaborateClusterAction,
    handleRemoveAgentsFromCluster as removeAgentsFromClusterAction,
    handleSaveCluster as saveClusterAction,
    loadClusterAgentMessages as loadClusterAgentMessagesAction,
    loadClusters as loadClustersAction,
    promptBroadcastToCluster as promptBroadcastToClusterAction,
    promptCollaborateCluster as promptCollaborateClusterAction
} from './openclawPanel/clusterActions';
import {
    activateChannel as activateChannelAction,
    clearChannelSelection as clearChannelSelectionAction,
    handleCreateChannel as createChannelAction,
    handleDeleteChannel as deleteChannelAction,
    handleSendChannelMessage as sendChannelMessageAction,
    handleUpdateChannel as updateChannelAction,
    loadChannels as loadChannelsAction,
    refreshActiveChannelMessages as refreshActiveChannelMessagesAction,
    stopActiveChannelSync as stopActiveChannelSyncAction
} from './openclawPanel/channelActions';
import {
    handleCreateAgent as createAgentAction,
    handleDeleteAgent as deleteAgentAction,
    handleOpenAgentFolder as openAgentFolderAction,
    handleOpenAgentSettings as openAgentSettingsAction,
    handleSaveAgentSettings as saveAgentSettingsAction
} from './openclawPanel/agentActions';
import { handlePanelMessage } from './openclawPanel/messageRouter';

const SESSION_SYNC_INTERVAL_MS = 450;
const CHANNEL_SYNC_INTERVAL_MS = 450;
const OPENCLAW_LUNA_ISSUES_URL = 'https://github.com/LunaticLegacy/openclaw-vscode-luna/issues';

export class OpenClawPanel {
    public static currentPanel: OpenClawPanel | undefined;
    public static readonly viewType = 'openclawPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _service: OpenClawService;
    private _agentManager: AgentManager;
    private _channelManager: ChannelManager;
    private _agentFolderManager: AgentFolderManager;
    private _clusterManager: ClusterManager;
    private _taskManager: ScheduledTaskManager;
    private _sessionManager: ChatSessionManager;
    private _clusterSessionManager: ChatSessionManager;
    private _currentSessionId: string | null = null;
    private _currentAgentId: string | null = null;
    private _currentChannelId: string | null = null;
    private _currentChannelSessionId: string | null = null;
    private _viewMode: 'chat' | 'clusters' | 'usage' | 'channel' | 'tasks' = 'chat';
    private _contextLoadToken: number = 0;
    private _chatRunToken: number = 0;
    private _activeChatStream: AsyncGenerator<{ content: string; done: boolean; message?: ChatMessage }, void, unknown> | null = null;
    private _channelRunToken: number = 0;
    private _clusterSwarmRunToken: number = 0;
    private _clusterAgentRunToken: number = 0;
    private _sessionSyncToken: number = 0;
    private _channelLoadToken: number = 0;
    private _channelSyncToken: number = 0;
    private _importedChannelSessions: Map<string, { agentId: string; sessionId: string }> = new Map();
    private _isWebviewReady = false;
    private _initialDataLoaded = false;
    private _pendingMessages: Array<Record<string, unknown>> = [];
    private _runtimeDiagnostics: OpenClawRuntimeDiagnostics | null = null;
    private _openClawConfigState: OpenClawConfigEditorState | null = null;

    public static createOrShow(
        extensionUri: vscode.Uri,
        service: OpenClawService,
        agentManager: AgentManager,
        agentFolderManager: AgentFolderManager,
        channelManager: ChannelManager,
        clusterManager: ClusterManager,
        taskManager: ScheduledTaskManager
    ): OpenClawPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (OpenClawPanel.currentPanel) {
            OpenClawPanel.currentPanel._panel.reveal(column);
            return OpenClawPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            OpenClawPanel.viewType,
            'OpenClaw',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        OpenClawPanel.currentPanel = new OpenClawPanel(panel, extensionUri, service, agentManager, agentFolderManager, channelManager, clusterManager, taskManager);
        return OpenClawPanel.currentPanel;
    }

    public static getPanel(): OpenClawPanel | undefined {
        return OpenClawPanel.currentPanel;
    }

    public static disposePanel() {
        OpenClawPanel.currentPanel?.dispose();
        OpenClawPanel.currentPanel = undefined;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        service: OpenClawService,
        agentManager: AgentManager,
        agentFolderManager: AgentFolderManager,
        channelManager: ChannelManager,
        clusterManager: ClusterManager,
        taskManager: ScheduledTaskManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._service = service;
        this._agentManager = agentManager;
        this._agentFolderManager = agentFolderManager;
        this._channelManager = channelManager;
        this._clusterManager = clusterManager;
        this._taskManager = taskManager;
        this._sessionManager = new ChatSessionManager(service);
        this._clusterSessionManager = new ChatSessionManager(service);

        this._update();

        const handleConnectionChange = () => {
            void this._refreshRuntimeState();
        };
        this._service.on('connectionChange', handleConnectionChange);
        this._disposables.push(new vscode.Disposable(() => {
            this._service.off('connectionChange', handleConnectionChange);
        }));

        const refreshAgents = () => {
            if (!this._isWebviewReady) {
                return;
            }

            void this._loadAgents();
        };
        for (const eventName of ['agentCreated', 'agentUpdated', 'agentDeleted']) {
            this._agentManager.on(eventName, refreshAgents);
        }
        this._disposables.push(new vscode.Disposable(() => {
            for (const eventName of ['agentCreated', 'agentUpdated', 'agentDeleted']) {
                this._agentManager.off(eventName, refreshAgents);
            }
        }));

        const refreshTasks = () => {
            if (!this._isWebviewReady) {
                return;
            }

            void this._loadTasks();
        };
        for (const eventName of ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskRunStarted', 'taskRunCompleted']) {
            this._taskManager.on(eventName, refreshTasks);
        }
        this._disposables.push(new vscode.Disposable(() => {
            for (const eventName of ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskRunStarted', 'taskRunCompleted']) {
                this._taskManager.off(eventName, refreshTasks);
            }
        }));

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(
            event => this._handlePanelVisibilityChange(event.webviewPanel.visible),
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    private _postMessage(message: Record<string, unknown>) {
        if (!this._isWebviewReady) {
            this._pendingMessages.push(message);
            return;
        }

        void this._panel.webview.postMessage(message);
    }

    private _flushPendingMessages() {
        if (!this._isWebviewReady || this._pendingMessages.length === 0) {
            return;
        }

        const pendingMessages = [...this._pendingMessages];
        this._pendingMessages = [];
        for (const message of pendingMessages) {
            void this._panel.webview.postMessage(message);
        }
    }

    private _handlePanelVisibilityChange(visible: boolean) {
        if (!visible) {
            this._stopActiveSessionSync();
            this._stopActiveChannelSync();
            return;
        }

        if (this._currentAgentId && this._currentSessionId) {
            const session = this._sessionManager.getSession(this._currentSessionId);
            if (session) {
                this._startActiveSessionSync(session, this._currentAgentId, this._contextLoadToken);
            }
        }

        if (this._currentChannelId && this._currentChannelSessionId) {
            void activateChannelAction(this._createChannelActionContext(), this._currentChannelId);
        }
    }

    private async _loadAgents() {
        try {
            const agents = await this._agentManager.getAgents();
            await this._agentFolderManager.pruneMissingAgents(agents.map(agent => agent.id));
            const folders = await this._agentFolderManager.getFolders();
            const models = await this._service.getAvailableModels(agents);
            this._postMessage({
                type: 'agentsLoaded',
                agents: agents.map(a => ({
                    id: a.id,
                    name: a.name,
                    model: a.model,
                    status: a.status,
                    systemPrompt: a.systemPrompt,
                    temperature: a.temperature,
                    maxTokens: a.maxTokens,
                    enabledSkills: a.enabledSkills
                })),
                folders,
                models,
                presets: getAgentPresets(),
                aiSkills: getAiSkills()
            });

            const currentAgentStillExists = this._currentAgentId
                ? agents.some(agent => agent.id === this._currentAgentId)
                : false;

            if (this._currentAgentId && !currentAgentStillExists) {
                this._stopActiveSessionSync();
                this._currentAgentId = null;
                this._currentSessionId = null;
                this._postMessage({ type: 'clearChat' });
                this._postMessage({ type: 'setActiveAgent', agentId: null });
            }

            const preferredAgentId = this._currentAgentId
                || this._agentManager.getActiveAgentId()
                || agents.find(agent => agent.isDefault || agent.status === 'active')?.id
                || agents[0]?.id
                || null;

            if (preferredAgentId && (!this._currentAgentId || this._currentAgentId !== preferredAgentId || !this._currentSessionId)) {
                await this._activateAgent(preferredAgentId);
            }
        } catch (error) {
            this._postMessage({
                type: 'agentsLoadFailed',
                message: t('panel.failedLoadAgents', { error: String(error) })
            });
        }
    }

    public async refreshAgents(force: boolean = true): Promise<void> {
        if (force) {
            await this._agentManager.getAgents(true);
        }

        await this._loadAgents();
    }

    private async _handleMessage(message: any) {
        await handlePanelMessage(this._createMessageRouterContext(), message);
    }

    private _postRuntimeState() {
        postRuntimeStateAction(this._createRuntimeActionContext());
    }

    private async _refreshRuntimeState() {
        await refreshRuntimeStateAction(this._createRuntimeActionContext());
    }

    private async _handleSendMessage(
        content: string,
        agentId?: string,
        options: { optimisticEcho?: boolean } = {}
    ) {
        const normalizedContent = normalizeOutgoingMessageContent(content);
        const targetAgentId = agentId || this._currentAgentId;
        this._stopActiveSessionSync();
        
        if (!targetAgentId) {
            this._postMessage({
                type: 'error',
                message: t('panel.selectAgentFirst')
            });
            return;
        }

        // 确保有 session
        if (targetAgentId !== this._currentAgentId) {
            await this._activateAgent(targetAgentId);
        } else if (!this._currentSessionId) {
            await this._createSession();
        }

        const sessionId = this._currentSessionId;
        const chatRunToken = ++this._chatRunToken;

        // 添加用户消息到界面
        if (!options.optimisticEcho) {
            this._postMessage({
                type: 'addMessage',
                message: {
                    role: 'user',
                    content: normalizedContent,
                    timestamp: new Date().toISOString()
                }
            });
        }
        this._postRunState('chat', true);
        if (!this._service.providesAgentActivityStatus()) {
            this._agentManager.beginAgentRun(targetAgentId);
        }

        try {
            const config = vscode.workspace.getConfiguration('openclaw');
            const streamResponse = config.get<boolean>('streamResponse', true);

            if (streamResponse) {
                // 流式响应
                let fullContent = '';
                const streamedMessageIds = new Set<string>();
                const stream = this._sessionManager.streamMessage(normalizedContent);
                this._activeChatStream = stream;

                try {
                    for await (const chunk of stream) {
                        if (!this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                            break;
                        }

                        if (chunk.message) {
                            const messageId = typeof chunk.message.id === 'string'
                                ? chunk.message.id.trim()
                                : '';
                            if (messageId) {
                                if (streamedMessageIds.has(messageId)) {
                                    continue;
                                }
                                streamedMessageIds.add(messageId);
                            }

                            if (options.optimisticEcho && chunk.message.role === 'user') {
                                continue;
                            }

                            this._postMessage({
                                type: 'addMessage',
                                message: chunk.message
                            });
                            continue;
                        }

                        fullContent += chunk.content;

                        this._postMessage({
                            type: 'updateStreamingMessage',
                            content: fullContent,
                            done: chunk.done
                        });
                    }
                } finally {
                    if (this._activeChatStream === stream) {
                        this._activeChatStream = null;
                    }
                }
            } else {
                // 非流式响应
                const response = await this._sessionManager.sendMessage(normalizedContent);

                if (!this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                    return;
                }

                this._postMessage({
                    type: 'addMessage',
                    message: response
                });
            }
        } catch (error) {
            if (this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                this._postMessage({
                    type: 'error',
                    message: t('panel.failedSendMessage', { error: String(error) })
                });
            }
        } finally {
            if (!this._service.providesAgentActivityStatus()) {
                this._agentManager.endAgentRun(targetAgentId);
            }
            if (this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                this._postRunState('chat', false);
            }
        }
    }

    private async _createSession(): Promise<ChatSession | null> {
        if (!this._currentAgentId) return null;

        try {
            const session = await this._sessionManager.getOrCreateSession(this._currentAgentId, {
                refreshHistory: true
            });
            this._currentSessionId = session.id;
            return session;
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedCreateSession', { error: String(error) })
            });
            return null;
        }
    }

    private async _activateAgent(agentId: string) {
        const loadToken = ++this._contextLoadToken;
        this._stopActiveChatRun();
        this._currentAgentId = agentId;
        this._currentSessionId = null;
        this._agentManager.setActiveAgent(agentId);
        const cachedSession = this._sessionManager.findSessionByAgent(agentId);
        if (cachedSession) {
            this._currentSessionId = cachedSession.id;
        }
        this._postMessage({
            type: 'setActiveAgent',
            agentId
        });
        if (cachedSession) {
            this._postMessage({
                type: 'replaceMessages',
                messages: cachedSession.messages
            });
            this._postRunState('chat', this._service.hasActiveSessionRun(cachedSession.id));
        } else {
            this._postMessage({ type: 'clearChat' });
        }
        this._postMessage({
            type: 'setContextLoading',
            loading: true
        });

        try {
            const session = await this._createSession();
            if (!session) {
                return;
            }

            await this._loadSessionHistory(session, loadToken);
            this._startActiveSessionSync(session, agentId, loadToken);
        } catch (error) {
            if (loadToken === this._contextLoadToken) {
                this._postMessage({
                    type: 'error',
                    message: t('panel.failedLoadContext', { error: String(error) })
                });
            }
        } finally {
            if (loadToken === this._contextLoadToken) {
                this._postMessage({
                    type: 'setContextLoading',
                    loading: false
                });
            }
        }
    }

    private async _loadSessionHistory(session?: ChatSession | null, loadToken?: number) {
        if (!this._currentSessionId || (session && session.id !== this._currentSessionId) || (loadToken !== undefined && loadToken !== this._contextLoadToken)) {
            return;
        }

        try {
            const messages = session?.messages || [];
            if (loadToken !== undefined && loadToken !== this._contextLoadToken) {
                return;
            }
            this._postMessage({
                type: 'replaceMessages',
                messages
            });
            this._postRunState('chat', this._service.hasActiveSessionRun(this._currentSessionId));
        } catch (error) {
            this._postMessage({
                type: 'setContextLoading',
                loading: false
            });
            this._postMessage({
                type: 'error',
                message: t('panel.failedLoadChatHistory', { error: String(error) })
            });
        }
    }

    private _clearChat() {
        this._stopActiveSessionSync();
        this._stopActiveChatRun();
        this._currentSessionId = null;
        this._postMessage({ type: 'clearChat' });
        this._postRunState('chat', false);
    }

    private _stopActiveChatRun() {
        if (!this._service.providesAgentActivityStatus() && this._currentAgentId) {
            this._agentManager.endAgentRun(this._currentAgentId);
        }
        this._chatRunToken += 1;
        const activeStream = this._activeChatStream;
        this._activeChatStream = null;
        if (activeStream) {
            void activeStream.return(undefined).catch(() => undefined);
        }
    }

    private _abortSessionRun(sessionId: string | null | undefined) {
        const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
        if (!normalizedSessionId) {
            return;
        }

        void this._service.abortSessionRun(normalizedSessionId).catch(() => undefined);
    }

    private _stopActiveSessionSync() {
        this._sessionSyncToken += 1;
    }

    private _startActiveSessionSync(session: ChatSession, agentId: string, loadToken: number) {
        if (!this._service.supportsLiveSessionSync()) {
            return;
        }

        const syncToken = ++this._sessionSyncToken;
        const sessionId = session.id;
        let previousSignature = buildMessageSyncSignature(session.messages);

        void (async () => {
            while (this._isCurrentSessionSyncTarget(syncToken, agentId, sessionId, loadToken)) {
                await delay(SESSION_SYNC_INTERVAL_MS);

                if (!this._isCurrentSessionSyncTarget(syncToken, agentId, sessionId, loadToken)) {
                    return;
                }

                const messages = await this._sessionManager.refreshSessionHistory(sessionId, {
                    preferLiveState: true
                });
                const nextSignature = buildMessageSyncSignature(messages);
                if (nextSignature === previousSignature) {
                    continue;
                }

                previousSignature = nextSignature;
                if (!this._isCurrentSessionSyncTarget(syncToken, agentId, sessionId, loadToken)) {
                    return;
                }

                this._postMessage({
                    type: 'replaceMessages',
                    messages
                });
            }
        })().catch(() => {
            if (syncToken === this._sessionSyncToken) {
                this._stopActiveSessionSync();
            }
        });
    }

    private _isCurrentSessionSyncTarget(syncToken: number, agentId: string, sessionId: string, loadToken: number): boolean {
        return this._sessionSyncToken === syncToken
            && this._currentAgentId === agentId
            && this._currentSessionId === sessionId
            && this._contextLoadToken === loadToken
            && this._panel.visible;
    }

    private _isCurrentChatRun(chatRunToken: number, agentId: string, sessionId: string | null): boolean {
        return this._chatRunToken === chatRunToken
            && this._currentAgentId === agentId
            && this._currentSessionId === sessionId;
    }

    private async _loadClusters(selectedClusterId?: string) {
        await loadClustersAction(this._createClusterActionContext(), selectedClusterId);
    }

    private async _loadUsage() {
        try {
            const usage = await this._service.getUsage();
            this._postMessage({
                type: 'usageLoaded',
                usage
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedLoadUsage', { error: String(error) })
            });
        }
    }

    private async _loadChannels(selectedChannelId?: string) {
        await loadChannelsAction(this._createChannelActionContext(), selectedChannelId);
    }

    private async _activateChannel(channelId: string | null | undefined) {
        await activateChannelAction(this._createChannelActionContext(), channelId);
    }

    private async _refreshActiveChannelMessages(channelId?: string) {
        await refreshActiveChannelMessagesAction(this._createChannelActionContext(), channelId);
    }

    private _clearChannelSelection() {
        clearChannelSelectionAction(this._createChannelActionContext());
    }

    private _stopActiveChannelSync() {
        stopActiveChannelSyncAction(this._createChannelActionContext());
    }

    private async _handleCreateChannel(data: { name?: string; agentId?: string; description?: string }) {
        await createChannelAction(this._createChannelActionContext(), data);
    }

    private async _handleUpdateChannel(
        channelId: string,
        data: { name?: string; agentId?: string; description?: string }
    ) {
        await updateChannelAction(this._createChannelActionContext(), channelId, data);
    }

    private async _handleDeleteChannel(channelId: string) {
        await deleteChannelAction(this._createChannelActionContext(), channelId);
    }

    private async _handleSendChannelMessage(channelId: string, content: string) {
        await sendChannelMessageAction(this._createChannelActionContext(), channelId, content);
    }

    private async _handleCreateAgent(data: any) {
        await createAgentAction(this._createAgentActionContext(), data);
    }

    private async _handleDeleteAgent(agentId: string) {
        await deleteAgentAction(this._createAgentActionContext(), agentId);
    }

    private async _handleCreateAgentFolder(name: string) {
        await this._agentFolderManager.createFolder(name);
        await this._loadAgents();
    }

    private async _promptCreateAgentFolder() {
        const name = await vscode.window.showInputBox({
            prompt: t('sidebar.newFolderPrompt'),
            placeHolder: t('sidebar.newFolderPrompt'),
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : t('sidebar.folderNameRequired')
        });

        if (!name) {
            return;
        }

        await this._handleCreateAgentFolder(name.trim());
    }

    private async _promptRenameAgentFolder(folderId: string) {
        const folder = (await this._agentFolderManager.getFolders()).find(item => item.id === folderId);
        if (!folder) {
            return;
        }

        const nextName = await vscode.window.showInputBox({
            prompt: t('sidebar.renameFolderPrompt'),
            value: folder.name,
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : t('sidebar.folderNameRequired')
        });

        if (!nextName) {
            return;
        }

        const normalizedName = nextName.trim();
        if (normalizedName === folder.name) {
            return;
        }

        await this._handleRenameAgentFolder(folderId, normalizedName);
    }

    private async _promptDeleteAgentFolder(folderId: string) {
        const folder = (await this._agentFolderManager.getFolders()).find(item => item.id === folderId);
        if (!folder) {
            return;
        }

        const confirmed = await vscode.window.showWarningMessage(
            t('sidebar.deleteFolderConfirm', { name: folder.name }),
            { modal: true },
            t('common.delete')
        );

        if (confirmed !== t('common.delete')) {
            return;
        }

        await this._handleDeleteAgentFolder(folderId);
    }

    private async _handleRenameAgentFolder(folderId: string, name: string) {
        await this._agentFolderManager.renameFolder(folderId, name);
        await this._loadAgents();
    }

    private async _handleDeleteAgentFolder(folderId: string) {
        await this._agentFolderManager.deleteFolder(folderId);
        await this._loadAgents();
    }

    private async _handleToggleAgentFolder(folderId: string, collapsed: boolean) {
        await this._agentFolderManager.setFolderCollapsed(folderId, collapsed);
        await this._loadAgents();
    }

    private async _handleMoveAgentToFolder(agentId: string, folderId: string | null) {
        await this._agentFolderManager.moveAgentToFolder(agentId, folderId);
        await this._loadAgents();
    }

    private async _handleBroadcast(clusterId: string, message: string) {
        await broadcastToClusterAction(this._createClusterActionContext(), clusterId, message);
    }

    private async _loadTasks() {
        await loadTasksAction(this._createTaskActionContext());
    }

    private async _promptBroadcastToCluster(clusterId: string) {
        await promptBroadcastToClusterAction(this._createClusterActionContext(), clusterId);
    }

    private async _handleCollaborate(clusterId: string, message: string) {
        await collaborateClusterAction(this._createClusterActionContext(), clusterId, message);
    }

    private async _promptCollaborateCluster(clusterId: string) {
        await promptCollaborateClusterAction(this._createClusterActionContext(), clusterId);
    }

    private async _loadClusterAgentMessages(clusterId: string, agentId: string) {
        await loadClusterAgentMessagesAction(this._createClusterActionContext(), clusterId, agentId);
    }

    private async _handleClusterAgentMessage(clusterId: string, agentId: string, content: string) {
        await clusterAgentMessageAction(this._createClusterActionContext(), clusterId, agentId, content);
    }

    private async _handleClusterAgentSessionCommand(clusterId: string, agentId: string, command: 'new' | 'clear') {
        await clusterAgentSessionCommandAction(this._createClusterActionContext(), clusterId, agentId, command);
    }

    private _handleStopActiveRun(scope: unknown) {
        switch (scope) {
            case 'chat':
                this._stopActiveChatRun();
                this._abortSessionRun(this._currentSessionId);
                this._postRunState('chat', false);
                break;
            case 'channel':
                this._channelRunToken += 1;
                this._abortSessionRun(this._currentChannelSessionId);
                this._postRunState('channel', false);
                break;
            case 'cluster-swarm':
                this._clusterSwarmRunToken += 1;
                break;
            case 'cluster-agent':
                this._clusterAgentRunToken += 1;
                this._abortSessionRun(this._clusterSessionManager.getCurrentSessionId());
                break;
        }
    }

    private async _handleSaveAgentSettings(agentId: string, settings: any) {
        await saveAgentSettingsAction(this._createAgentActionContext(), agentId, settings);
    }

    private async _handleRetryConnection() {
        await retryConnectionAction(this._createRuntimeActionContext());
    }

    private async _handleSaveConnectionSettings(settings: {
        configMode?: 'auto' | 'gateway' | 'local' | 'openclaw';
        gatewayUrl?: string;
        gatewayToken?: string;
    }) {
        await saveConnectionSettingsAction(this._createRuntimeActionContext(), settings);
    }

    private async _handleSaveOpenClawConfig(settings: {
        gatewayPort?: number | string;
        gatewayToken?: string;
        defaultWorkspace?: string;
        defaultModel?: string;
        authProviderId?: string;
        authApiKey?: string;
    }) {
        await saveOpenClawConfigAction(this._createRuntimeActionContext(), settings);
    }

    private async _handleStartOpenClaw() {
        await startOpenClawAction(this._createRuntimeActionContext());
    }

    private async _handleSaveCluster(
        clusterId: string | undefined,
        data: {
            name?: string;
            agentIds?: string[];
            workspaceConfig?: Record<string, unknown>;
        }
    ) {
        await saveClusterAction(this._createClusterActionContext(), clusterId, data);
    }

    private async _handleAddAgentsToCluster(clusterId: string) {
        await addAgentsToClusterAction(this._createClusterActionContext(), clusterId);
    }

    private async _handleRemoveAgentsFromCluster(clusterId: string) {
        await removeAgentsFromClusterAction(this._createClusterActionContext(), clusterId);
    }

    private async _handleCreateTask(data: any) {
        await createTaskAction(this._createTaskActionContext(), data);
    }

    private async _handleUpdateTask(taskId: string, data: any) {
        await updateTaskAction(this._createTaskActionContext(), taskId, data);
    }

    private async _handleDeleteTask(taskId: string) {
        await deleteTaskAction(this._createTaskActionContext(), taskId);
    }

    private async _handleToggleTask(taskId: string, enabled?: boolean) {
        await toggleTaskAction(this._createTaskActionContext(), taskId, enabled);
    }

    private async _handleRunTask(taskId: string) {
        await runTaskAction(this._createTaskActionContext(), taskId);
    }

    private async _handleOpenAgentSettings(agentId: string) {
        await openAgentSettingsAction(this._createAgentActionContext(), agentId);
    }

    private async _handleOpenAgentFolder(agentId: string) {
        await openAgentFolderAction(this._createAgentActionContext(), agentId);
    }

    private _createRuntimeActionContext() {
        return {
            service: this._service,
            extensionPath: this._extensionUri.fsPath,
            postMessage: this._postMessage.bind(this),
            getRuntimeDiagnostics: () => this._runtimeDiagnostics,
            setRuntimeDiagnostics: (value: OpenClawRuntimeDiagnostics | null) => {
                this._runtimeDiagnostics = value;
            },
            getOpenClawConfigState: () => this._openClawConfigState,
            setOpenClawConfigState: (value: OpenClawConfigEditorState | null) => {
                this._openClawConfigState = value;
            },
            loadAgents: this._loadAgents.bind(this),
            loadClusters: this._loadClusters.bind(this),
            loadTasks: this._loadTasks.bind(this)
        };
    }

    private _createTaskActionContext() {
        return {
            taskManager: this._taskManager,
            postMessage: this._postMessage.bind(this),
            ensureCapability: this._ensureCapability.bind(this),
            loadTasks: this._loadTasks.bind(this)
        };
    }

    private _createClusterActionContext() {
        return {
            clusterManager: this._clusterManager,
            agentManager: this._agentManager,
            clusterSessionManager: this._clusterSessionManager,
            postMessage: this._postMessage.bind(this),
            loadClusters: this._loadClusters.bind(this),
            showClusterView: this.showClusterView.bind(this),
            getCurrentAgentId: () => this._currentAgentId,
            beginAgentRun: (agentId: string) => !this._service.providesAgentActivityStatus() && this._agentManager.beginAgentRun(agentId),
            endAgentRun: (agentId: string) => !this._service.providesAgentActivityStatus() && this._agentManager.endAgentRun(agentId),
            nextClusterSwarmRunToken: () => ++this._clusterSwarmRunToken,
            getClusterSwarmRunToken: () => this._clusterSwarmRunToken,
            nextClusterAgentRunToken: () => ++this._clusterAgentRunToken,
            getClusterAgentRunToken: () => this._clusterAgentRunToken
        };
    }

    private _createAgentActionContext() {
        return {
            agentManager: this._agentManager,
            postMessage: this._postMessage.bind(this),
            ensureCapability: this._ensureCapability.bind(this),
            loadAgents: this._loadAgents.bind(this),
            getCurrentAgentId: () => this._currentAgentId,
            setCurrentAgentId: (agentId: string | null) => {
                this._currentAgentId = agentId;
            },
            setCurrentSessionId: (sessionId: string | null) => {
                this._currentSessionId = sessionId;
            }
        };
    }

    private _createChannelActionContext() {
        return {
            service: this._service,
            agentManager: this._agentManager,
            channelManager: this._channelManager,
            importedChannelSessions: this._importedChannelSessions,
            postMessage: this._postMessage.bind(this),
            postRunState: this._postRunState.bind(this),
            resolveDiscoveredChannel: this._resolveDiscoveredChannel.bind(this),
            getCurrentChannelId: () => this._currentChannelId,
            setCurrentChannelId: (channelId: string | null) => {
                this._currentChannelId = channelId;
            },
            getCurrentChannelSessionId: () => this._currentChannelSessionId,
            setCurrentChannelSessionId: (sessionId: string | null) => {
                this._currentChannelSessionId = sessionId;
            },
            nextChannelLoadToken: () => ++this._channelLoadToken,
            getChannelLoadToken: () => this._channelLoadToken,
            bumpChannelSyncToken: () => ++this._channelSyncToken,
            getChannelSyncToken: () => this._channelSyncToken,
            nextChannelRunToken: () => ++this._channelRunToken,
            getChannelRunToken: () => this._channelRunToken,
            isPanelVisible: () => this._panel.visible
        };
    }

    private _createMessageRouterContext() {
        return {
            issueTrackerUrl: OPENCLAW_LUNA_ISSUES_URL,
            setWebviewReady: (ready: boolean) => {
                this._isWebviewReady = ready;
            },
            flushPendingMessages: this._flushPendingMessages.bind(this),
            postRuntimeState: this._postRuntimeState.bind(this),
            refreshRuntimeState: this._refreshRuntimeState.bind(this),
            isInitialDataLoaded: () => this._initialDataLoaded,
            setInitialDataLoaded: (value: boolean) => {
                this._initialDataLoaded = value;
            },
            loadAgents: this._loadAgents.bind(this),
            loadChannels: this._loadChannels.bind(this),
            loadClusters: this._loadClusters.bind(this),
            loadTasks: this._loadTasks.bind(this),
            loadUsage: this._loadUsage.bind(this),
            handleSendMessage: this._handleSendMessage.bind(this),
            handleStopActiveRun: this._handleStopActiveRun.bind(this),
            activateAgent: this._activateAgent.bind(this),
            loadClusterAgentMessages: this._loadClusterAgentMessages.bind(this),
            clearChat: this._clearChat.bind(this),
            refreshAgents: this.refreshAgents.bind(this),
            handleCreateAgent: this._handleCreateAgent.bind(this),
            showClusterEditor: this.showClusterEditor.bind(this),
            handleSaveCluster: this._handleSaveCluster.bind(this),
            activateChannel: this._activateChannel.bind(this),
            refreshActiveChannelMessages: this._refreshActiveChannelMessages.bind(this),
            handleCreateChannel: this._handleCreateChannel.bind(this),
            handleUpdateChannel: this._handleUpdateChannel.bind(this),
            handleDeleteChannel: this._handleDeleteChannel.bind(this),
            handleSendChannelMessage: this._handleSendChannelMessage.bind(this),
            handleAddAgentsToCluster: this._handleAddAgentsToCluster.bind(this),
            handleRemoveAgentsFromCluster: this._handleRemoveAgentsFromCluster.bind(this),
            handleDeleteAgent: this._handleDeleteAgent.bind(this),
            promptCreateAgentFolder: this._promptCreateAgentFolder.bind(this),
            promptRenameAgentFolder: this._promptRenameAgentFolder.bind(this),
            promptDeleteAgentFolder: this._promptDeleteAgentFolder.bind(this),
            handleCreateAgentFolder: this._handleCreateAgentFolder.bind(this),
            handleRenameAgentFolder: this._handleRenameAgentFolder.bind(this),
            handleDeleteAgentFolder: this._handleDeleteAgentFolder.bind(this),
            handleToggleAgentFolder: this._handleToggleAgentFolder.bind(this),
            handleMoveAgentToFolder: this._handleMoveAgentToFolder.bind(this),
            handleCreateTask: this._handleCreateTask.bind(this),
            handleUpdateTask: this._handleUpdateTask.bind(this),
            handleDeleteTask: this._handleDeleteTask.bind(this),
            handleToggleTask: this._handleToggleTask.bind(this),
            handleRunTask: this._handleRunTask.bind(this),
            setViewMode: (view: 'chat' | 'clusters' | 'usage' | 'channel' | 'tasks') => {
                this._viewMode = view;
            },
            getCurrentChannelId: () => this._currentChannelId,
            handleBroadcast: this._handleBroadcast.bind(this),
            promptBroadcastToCluster: this._promptBroadcastToCluster.bind(this),
            handleCollaborate: this._handleCollaborate.bind(this),
            handleClusterAgentMessage: this._handleClusterAgentMessage.bind(this),
            handleClusterAgentSessionCommand: this._handleClusterAgentSessionCommand.bind(this),
            promptCollaborateCluster: this._promptCollaborateCluster.bind(this),
            handleSaveAgentSettings: this._handleSaveAgentSettings.bind(this),
            handleRetryConnection: this._handleRetryConnection.bind(this),
            handleStartOpenClaw: this._handleStartOpenClaw.bind(this),
            handleSaveConnectionSettings: this._handleSaveConnectionSettings.bind(this),
            handleSaveOpenClawConfig: this._handleSaveOpenClawConfig.bind(this)
        };
    }

    public setActiveAgent(agentId: string) {
        void this._activateAgent(agentId);
    }

    public setInputText(text: string) {
        this._postMessage({
            type: 'setInputText',
            text
        });
    }

    public async sendMessage(message: string, agentId?: string) {
        await this._handleSendMessage(message, agentId);
    }

    public clearChat() {
        this._clearChat();
    }

    public showClusterView(clusters: AgentCluster[], selectedClusterId?: string) {
        this._viewMode = 'clusters';
        this._postMessage({
            type: 'switchView',
            view: 'clusters',
            clusters,
            selectedClusterId,
            workModePresets: getClusterWorkModePresets()
        });
    }

    public showClusterEditor(clusterId?: string) {
        this._viewMode = 'clusters';
        this._postMessage({
            type: 'showClusterEditor',
            clusterId,
            workModePresets: getClusterWorkModePresets()
        });
    }

    public showUsageDashboard() {
        this._viewMode = 'usage';
        this._postMessage({
            type: 'switchView',
            view: 'usage'
        });
        this._loadUsage();
    }

    public showAgentSettings(agent: any) {
        if (!this._ensureCapability('agentEditing')) {
            vscode.window.showErrorMessage(getCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        this._postMessage({
            type: 'showAgentSettings',
            agent,
            aiSkills: getAiSkills()
        });
    }

    public showTaskView() {
        this._viewMode = 'tasks';
        this._postMessage({
            type: 'switchView',
            view: 'tasks'
        });
        void this._loadTasks();
    }

    public async showTaskEditor(taskId?: string) {
        if (!this._ensureCapability('scheduledTasks')) {
            vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        const viewState = await this._taskManager.getTaskViewState();
        if (!viewState.available) {
            vscode.window.showErrorMessage(viewState.message || t('tasks.unavailable'));
            return;
        }

        this.showTaskView();

        let task: ScheduledTask | null = null;
        if (taskId) {
            task = await this._taskManager.getTask(taskId);
        }

        this._postMessage({
            type: 'showTaskEditor',
            task
        });
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'OpenClaw';
        this._stopActiveChatRun();
        this._stopActiveSessionSync();
        this._isWebviewReady = false;
        this._initialDataLoaded = false;
        this._pendingMessages = [];
        webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return buildOpenClawPanelHtml(this._extensionUri, webview);
    }

    public dispose() {
        OpenClawPanel.currentPanel = undefined;
        this._stopActiveChatRun();
        this._stopActiveSessionSync();
        this._stopActiveChannelSync();
        this._importedChannelSessions.clear();
        this._sessionManager.dispose();
        this._clusterSessionManager.dispose();

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _postRunState(scope: 'chat' | 'channel', running: boolean) {
        this._postMessage({
            type: 'setRunState',
            scope,
            running
        });
    }

    private _ensureCapability(capabilityId: OpenClawBooleanCapabilityId): boolean {
        return this._service.supportsCapability(capabilityId);
    }

    private async _resolveDiscoveredChannel(channelId: string): Promise<DiscoveredChannel | null> {
        if (!channelId) {
            return null;
        }

        const channels = await this._service.getDiscoveredChannels();
        return channels.find(channel => channel.id === channelId) || null;
    }
}

