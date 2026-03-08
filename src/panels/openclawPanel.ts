import * as fs from 'fs';
import * as vscode from 'vscode';
import { getCurrentLocale, t, MESSAGES } from '../i18n';
import { OpenClawService, ChatMessage, ChatSession, AgentCluster, APIUsage } from '../services/openclawService';
import { AgentManager } from '../managers/agentManager';
import { ChatSessionManager } from '../managers/chatSessionManager';
import { ClusterManager } from '../managers/clusterManager';
import { ScheduledTask, ScheduledTaskManager } from '../managers/scheduledTaskManager';

export class OpenClawPanel {
    public static currentPanel: OpenClawPanel | undefined;
    public static readonly viewType = 'openclawPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _service: OpenClawService;
    private _agentManager: AgentManager;
    private _clusterManager: ClusterManager;
    private _taskManager: ScheduledTaskManager;
    private _sessionManager: ChatSessionManager;
    private _clusterSessionManager: ChatSessionManager;
    private _currentSessionId: string | null = null;
    private _currentAgentId: string | null = null;
    private _viewMode: 'chat' | 'clusters' | 'usage' | 'tasks' = 'chat';
    private _contextLoadToken: number = 0;
    private _chatRunToken: number = 0;
    private _sessionSyncToken: number = 0;
    private _isWebviewReady = false;
    private _initialDataLoaded = false;
    private _pendingMessages: Array<Record<string, unknown>> = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        service: OpenClawService,
        agentManager: AgentManager,
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

        OpenClawPanel.currentPanel = new OpenClawPanel(panel, extensionUri, service, agentManager, clusterManager, taskManager);
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
        clusterManager: ClusterManager,
        taskManager: ScheduledTaskManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._service = service;
        this._agentManager = agentManager;
        this._clusterManager = clusterManager;
        this._taskManager = taskManager;
        this._sessionManager = new ChatSessionManager(service);
        this._clusterSessionManager = new ChatSessionManager(service);

        this._update();

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

    private async _loadAgents() {
        try {
            const agents = await this._agentManager.getAgents();
            const models = await this._service.getAvailableModels(agents);
            this._postMessage({
                type: 'agentsLoaded',
                agents: agents.map(a => ({ id: a.id, name: a.name, model: a.model, status: a.status })),
                models
            });

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

    private async _handleMessage(message: any) {
        switch (message.type) {
            case 'webviewReady':
                this._isWebviewReady = true;
                this._flushPendingMessages();
                if (!this._initialDataLoaded) {
                    this._initialDataLoaded = true;
                    await Promise.all([
                        this._loadAgents(),
                        this._loadClusters()
                    ]);
                }
                break;

            case 'sendMessage':
                await this._handleSendMessage(message.content, message.agentId, {
                    optimisticEcho: Boolean(message.optimistic)
                });
                break;

            case 'selectAgent':
                await this._activateAgent(message.agentId);
                break;

            case 'loadClusterAgentMessages':
                await this._loadClusterAgentMessages(message.clusterId, message.agentId);
                break;

            case 'clearChat':
                this._clearChat();
                break;

            case 'getClusters':
                await this._loadClusters();
                break;

            case 'getUsage':
                await this._loadUsage();
                break;

            case 'getTasks':
                await this._loadTasks();
                break;

            case 'createAgent':
                await this._handleCreateAgent(message.data);
                break;

            case 'createCluster':
                await this._handleCreateCluster();
                break;

            case 'addAgentsToCluster':
                await this._handleAddAgentsToCluster(message.clusterId);
                break;

            case 'removeAgentsFromCluster':
                await this._handleRemoveAgentsFromCluster(message.clusterId);
                break;

            case 'deleteAgent':
                await this._handleDeleteAgent(message.agentId);
                break;

            case 'createTask':
                await this._handleCreateTask(message.data);
                break;

            case 'updateTask':
                await this._handleUpdateTask(message.taskId, message.data);
                break;

            case 'deleteTask':
                await this._handleDeleteTask(message.taskId);
                break;

            case 'toggleTask':
                await this._handleToggleTask(message.taskId, message.enabled);
                break;

            case 'runTask':
                await this._handleRunTask(message.taskId);
                break;

            case 'switchView':
                this._viewMode = message.view;
                if (message.view === 'clusters') {
                    await this._loadClusters(message.clusterId);
                } else if (message.view === 'usage') {
                    await this._loadUsage();
                } else if (message.view === 'tasks') {
                    await this._loadTasks();
                }
                break;

            case 'broadcastToCluster':
                await this._handleBroadcast(message.clusterId, message.message);
                break;

            case 'promptBroadcastToCluster':
                await this._promptBroadcastToCluster(message.clusterId);
                break;

            case 'collaborateCluster':
                await this._handleCollaborate(message.clusterId, message.message);
                break;

            case 'sendClusterAgentMessage':
                await this._handleClusterAgentMessage(message.clusterId, message.agentId, message.content);
                break;

            case 'promptCollaborateCluster':
                await this._promptCollaborateCluster(message.clusterId);
                break;

            case 'deleteCluster':
                await vscode.commands.executeCommand('openclaw.deleteCluster', message.clusterId);
                await this._loadClusters();
                break;

            case 'saveAgentSettings':
                await this._handleSaveAgentSettings(message.agentId, message.settings);
                break;

            case 'openAgentSettings':
                await vscode.commands.executeCommand('openclaw.openAgentSettings', message.agentId);
                break;

            case 'openAgentFolder':
                await vscode.commands.executeCommand('openclaw.openAgentFolder', message.agentId);
                break;
        }
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

        try {
            const config = vscode.workspace.getConfiguration('openclaw');
            const streamResponse = config.get<boolean>('streamResponse', true);

            if (streamResponse) {
                // 流式响应
                let fullContent = '';
                
                for await (const chunk of this._sessionManager.streamMessage(normalizedContent)) {
                    if (!this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                        break;
                    }

                    if (chunk.message) {
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
        this._chatRunToken += 1;
        this._currentAgentId = agentId;
        this._currentSessionId = null;
        this._agentManager.setActiveAgent(agentId);
        this._postMessage({
            type: 'setActiveAgent',
            agentId
        });
        this._postMessage({ type: 'clearChat' });
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
            this._postMessage({ type: 'clearChat' });

            for (const message of messages) {
                if (loadToken !== undefined && loadToken !== this._contextLoadToken) {
                    return;
                }

                this._postMessage({
                    type: 'addMessage',
                    message
                });
            }
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
        this._chatRunToken += 1;
        this._currentSessionId = null;
        this._postMessage({ type: 'clearChat' });
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
                await delay(120);

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
            && this._contextLoadToken === loadToken;
    }

    private _isCurrentChatRun(chatRunToken: number, agentId: string, sessionId: string | null): boolean {
        return this._chatRunToken === chatRunToken
            && this._currentAgentId === agentId
            && this._currentSessionId === sessionId;
    }

    private async _loadClusters(selectedClusterId?: string) {
        try {
            const clusters = await this._clusterManager.getClusters(true);
            this._postMessage({
                type: 'clustersLoaded',
                clusters,
                selectedClusterId
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedLoadClusters', { error: String(error) })
            });
        }
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

    private async _handleCreateAgent(data: any) {
        try {
            await this._agentManager.createAgent(data);
            await this._loadAgents();
            this._postMessage({
                type: 'agentCreated',
                success: true
            });
        } catch (error) {
            this._postMessage({
                type: 'agentCreated',
                success: false,
                error: String(error)
            });
        }
    }

    private async _handleDeleteAgent(agentId: string) {
        try {
            await this._agentManager.deleteAgent(agentId);
            if (this._currentAgentId === agentId) {
                this._currentAgentId = null;
                this._currentSessionId = null;
                this._postMessage({ type: 'clearChat' });
                this._postMessage({ type: 'setActiveAgent', agentId: null });
            }
            await this._loadAgents();
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedDeleteAgent', { error: String(error) })
            });
        }
    }

    private async _handleBroadcast(clusterId: string, message: string) {
        try {
            const responses = await this._clusterManager.broadcastToCluster(clusterId, message);
            this._postMessage({
                type: 'broadcastResults',
                clusterId,
                responses
            });
        } catch (error) {
            this._postMessage({
                type: 'clusterRunFailed',
                clusterId,
                mode: 'broadcast'
            });
            this._postMessage({
                type: 'error',
                message: t('panel.failedBroadcast', { error: String(error) })
            });
        }
    }

    private async _loadTasks() {
        try {
            const viewState = await this._taskManager.getTaskViewState();
            this._postMessage({
                type: 'tasksLoaded',
                available: viewState.available,
                message: viewState.message,
                sourcePath: viewState.sourcePath,
                tasks: viewState.tasks
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedLoadTasks', { error: String(error) })
            });
        }
    }

    private async _promptBroadcastToCluster(clusterId: string) {
        const message = await vscode.window.showInputBox({
            prompt: t('clusters.broadcastPrompt'),
            ignoreFocusOut: true
        });

        if (!message?.trim()) {
            return;
        }

        await this._handleBroadcast(clusterId, normalizeOutgoingMessageContent(message));
    }

    private async _handleCollaborate(clusterId: string, message: string) {
        try {
            const result = await this._clusterManager.collaborateOnCluster(clusterId, normalizeOutgoingMessageContent(message), {
                coordinatorAgentId: this._currentAgentId || undefined
            });

            this._postMessage({
                type: 'collaborationResults',
                result
            });
        } catch (error) {
            this._postMessage({
                type: 'clusterRunFailed',
                clusterId,
                mode: 'collaborate'
            });
            this._postMessage({
                type: 'error',
                message: t('panel.failedCollaborate', { error: String(error) })
            });
        }
    }

    private async _promptCollaborateCluster(clusterId: string) {
        const message = await vscode.window.showInputBox({
            prompt: t('clusters.collaborationPrompt'),
            ignoreFocusOut: true
        });

        if (!message?.trim()) {
            return;
        }

        await this._handleCollaborate(clusterId, normalizeOutgoingMessageContent(message));
    }

    private async _loadClusterAgentMessages(clusterId: string, agentId: string) {
        if (!clusterId || !agentId) {
            return;
        }

        try {
            this._postMessage({
                type: 'setClusterContextLoading',
                clusterId,
                agentId,
                loading: true
            });

            const session = await this._clusterSessionManager.getOrCreateSession(agentId, {
                refreshHistory: true
            });
            this._clusterSessionManager.setCurrentSession(session.id);

            this._postMessage({
                type: 'replaceClusterMessages',
                clusterId,
                agentId,
                messages: session.messages
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedLoadContext', { error: String(error) })
            });
        } finally {
            this._postMessage({
                type: 'setClusterContextLoading',
                clusterId,
                agentId,
                loading: false
            });
        }
    }

    private async _handleClusterAgentMessage(clusterId: string, agentId: string, content: string) {
        const normalizedContent = normalizeOutgoingMessageContent(content);
        if (!clusterId || !agentId || !normalizedContent.trim()) {
            return;
        }

        try {
            const session = await this._clusterSessionManager.getOrCreateSession(agentId);
            this._clusterSessionManager.setCurrentSession(session.id);
            const response = await this._clusterSessionManager.sendMessage(normalizedContent);

            this._postMessage({
                type: 'clusterAgentResponse',
                clusterId,
                agentId,
                message: response
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('panel.failedSendMessage', { error: String(error) })
            });
        }
    }

    private async _handleSaveAgentSettings(agentId: string, settings: any) {
        try {
            await this._agentManager.updateAgent(agentId, settings);
            await this._loadAgents();
            vscode.window.showInformationMessage(t('agentSettings.saved'));
        } catch (error) {
            vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
        }
    }

    private async _handleCreateCluster() {
        await vscode.commands.executeCommand('openclaw.createCluster');
        await this._loadClusters();
    }

    private async _handleAddAgentsToCluster(clusterId: string) {
        if (!clusterId) {
            return;
        }

        try {
            const [cluster, agents] = await Promise.all([
                this._clusterManager.getCluster(clusterId),
                this._agentManager.getAgents()
            ]);

            if (!cluster) {
                vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
                return;
            }

            const availableAgents = agents.filter(agent => !cluster.agentIds.includes(agent.id));
            if (availableAgents.length === 0) {
                vscode.window.showInformationMessage(t('clusters.noAvailableAgentsToAdd'));
                return;
            }

            const selectedAgents = await vscode.window.showQuickPick(
                availableAgents.map(agent => ({
                    label: agent.name,
                    description: agent.model,
                    agentId: agent.id
                })),
                {
                    placeHolder: t('clusters.selectAgentsToAdd'),
                    canPickMany: true
                }
            );

            if (!selectedAgents || selectedAgents.length === 0) {
                return;
            }

            await this._clusterManager.updateCluster(clusterId, {
                agentIds: [...cluster.agentIds, ...selectedAgents.map(agent => agent.agentId)]
            });
            await this._loadClusters(clusterId);
            vscode.window.showInformationMessage(t('clusters.agentsAdded', { count: selectedAgents.length }));
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
        }
    }

    private async _handleRemoveAgentsFromCluster(clusterId: string) {
        if (!clusterId) {
            return;
        }

        try {
            const cluster = await this._clusterManager.getCluster(clusterId);
            if (!cluster) {
                vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
                return;
            }

            const agents = await this._agentManager.getAgents();
            const agentNames = new Map(agents.map(agent => [agent.id, agent.name]));

            if (cluster.agentIds.length <= 1) {
                vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
                return;
            }

            const selectedAgents = await vscode.window.showQuickPick(
                cluster.agentIds.map(agentId => ({
                    label: agentNames.get(agentId) || agentId,
                    description: agentId,
                    agentId,
                    picked: false
                })),
                {
                    placeHolder: t('clusters.selectAgentsToRemove'),
                    canPickMany: true
                }
            );

            if (!selectedAgents || selectedAgents.length === 0) {
                return;
            }

            const remainingAgentIds = cluster.agentIds.filter(agentId =>
                !selectedAgents.some(selected => selected.agentId === agentId)
            );

            if (remainingAgentIds.length === 0) {
                vscode.window.showWarningMessage(t('clusters.removeLastAgentBlocked'));
                return;
            }

            await this._clusterManager.updateCluster(clusterId, {
                agentIds: remainingAgentIds
            });
            await this._loadClusters(clusterId);
            vscode.window.showInformationMessage(t('clusters.agentsRemoved', { count: selectedAgents.length }));
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.updateFailed', { error: String(error) }));
        }
    }

    private async _handleCreateTask(data: any) {
        try {
            await this._taskManager.createTask(data);
            await this._loadTasks();
            vscode.window.showInformationMessage(t('tasks.created'));
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.createFailed', { error: String(error) }));
        }
    }

    private async _handleUpdateTask(taskId: string, data: any) {
        try {
            await this._taskManager.updateTask(taskId, data);
            await this._loadTasks();
            vscode.window.showInformationMessage(t('tasks.updated'));
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
        }
    }

    private async _handleDeleteTask(taskId: string) {
        try {
            const task = await this._taskManager.getTask(taskId);
            if (!task) {
                vscode.window.showErrorMessage(t('tasks.notFound', { taskId }));
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                t('tasks.deleteConfirm', { name: task.name }),
                { modal: true },
                t('common.delete')
            );

            if (confirm !== t('common.delete')) {
                return;
            }

            await this._taskManager.deleteTask(taskId);
            await this._loadTasks();
            vscode.window.showInformationMessage(t('tasks.deleted'));
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.deleteFailed', { error: String(error) }));
        }
    }

    private async _handleToggleTask(taskId: string, enabled?: boolean) {
        try {
            const task = await this._taskManager.toggleTask(taskId, enabled);
            await this._loadTasks();
            vscode.window.showInformationMessage(
                task.enabled ? t('tasks.enabled') : t('tasks.disabled')
            );
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
        }
    }

    private async _handleRunTask(taskId: string) {
        try {
            await this._taskManager.runTask(taskId, 'manual');
            await this._loadTasks();
            vscode.window.showInformationMessage(t('tasks.runTriggered'));
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.runFailed', { error: String(error) }));
        }
    }

    private async _handleOpenAgentSettings(agentId: string) {
        try {
            const agent = await this._agentManager.getAgent(agentId);
            if (!agent) {
                this._postMessage({
                    type: 'error',
                    message: t('agent.notFound')
                });
                return;
            }

            this._postMessage({
                type: 'showAgentSettings',
                agent
            });
        } catch (error) {
            this._postMessage({
                type: 'error',
                message: t('agentSettings.saveFailed', { error: String(error) })
            });
        }
    }

    private async _handleOpenAgentFolder(agentId: string) {
        try {
            const agent = await this._agentManager.getAgent(agentId);
            if (!agent) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            // 获取 Agent 工作区路径
            let folderPath: string | undefined;
            
            if (agent.workspacePath) {
                folderPath = agent.workspacePath;
            } else {
                // 尝试从配置或默认位置获取
                const config = vscode.workspace.getConfiguration('openclaw');
                const agentsRoot = config.get<string>('agentsRootPath');
                if (agentsRoot) {
                    folderPath = `${agentsRoot}/${agentId}`;
                }
            }

            if (!folderPath) {
                vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
                return;
            }

            const folderUri = vscode.Uri.file(folderPath);
            
            // 检查文件夹是否存在
            try {
                await vscode.workspace.fs.stat(folderUri);
            } catch {
                // 文件夹不存在，创建它
                await vscode.workspace.fs.createDirectory(folderUri);
            }

            // 在 VSCode 中打开文件夹
            await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
                forceNewWindow: false
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(t('agentSettings.openFolderFailed', { error: String(error) }));
        }
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
            selectedClusterId
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
        this._postMessage({
            type: 'showAgentSettings',
            agent
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
        this._stopActiveSessionSync();
        this._isWebviewReady = false;
        this._initialDataLoaded = false;
        this._pendingMessages = [];
        webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const template = this._readMediaFile('panel.html');
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );
        const i18nScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'i18n.js')
        );
        const markdownRendererScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'markdownRenderer.js')
        );
        const panelScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js')
        );

        // Get translations for current locale
        const locale = getCurrentLocale();
        const translations = MESSAGES[locale] || MESSAGES.en;
        const translationsBase64 = Buffer.from(
            JSON.stringify(translations),
            'utf8'
        ).toString('base64');

        return this._applyTemplateVariables(template, {
            cspSource: webview.cspSource,
            locale: locale,
            styleUri: styleUri.toString(),
            i18nScriptUri: i18nScriptUri.toString(),
            markdownRendererScriptUri: markdownRendererScriptUri.toString(),
            panelScriptUri: panelScriptUri.toString(),
            translationsBase64
        });
    }

    private _readMediaFile(fileName: string): string {
        const fileUri = vscode.Uri.joinPath(this._extensionUri, 'media', fileName);
        return fs.readFileSync(fileUri.fsPath, 'utf8');
    }

    private _applyTemplateVariables(template: string, variables: Record<string, string>): string {
        let output = template;
        for (const [key, value] of Object.entries(variables)) {
            output = output.split(`{{${key}}}`).join(value);
        }

        return output;
    }

    public dispose() {
        OpenClawPanel.currentPanel = undefined;
        this._stopActiveSessionSync();
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
}

function normalizeOutgoingMessageContent(content: string): string {
    return String(content ?? '').replace(/\r\n?/g, '\n');
}

function buildMessageSyncSignature(messages: ChatMessage[]): string {
    return JSON.stringify(messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        tokenCount: message.tokenCount,
        parts: message.parts,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        toolArguments: message.toolArguments,
        toolDetails: message.toolDetails,
        isError: message.isError,
        metadata: message.metadata
    })));
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

