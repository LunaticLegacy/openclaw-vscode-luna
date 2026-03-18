﻿﻿﻿﻿import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { getClusterWorkModePresets } from '../config/clusterWorkModes';
import { getAiSkills } from '../config/aiSkills';
import { getCurrentLocale, t, MESSAGES } from '../i18n';
import { OpenClawService, ChatMessage, ChatSession, AgentCluster, APIUsage } from '../services/openclawService';
import {
    buildOpenClawRuntimeLogExport,
    inspectOpenClawEnvironment,
    loadOpenClawConfigEditorState,
    OpenClawConfigEditorState,
    OpenClawRuntimeDiagnostics,
    resolveOpenClawServiceConfig,
    saveOpenClawConfigEditorState,
    startOpenClawGateway
} from '../services/openclawConfig';
import type { DiscoveredChannel, OpenClawBooleanCapabilityId } from '../services/openclawService';
import { runWithNotificationProgress, showSuccessStatus, showWarningNotification, showWarningStatus } from '../utils/statusFeedback';
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
    buildClusterContextExportBundle,
    parseClusterSwarmReplayImport,
    resolveContextExportPath,
    type ClusterContextExportBundle,
    type ClusterContextExportKind
} from './openclawPanel/contextExport';
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
    handleCreateClusterFromMemberPreset as createClusterFromMemberPresetAction,
    handleRemoveAgentsFromCluster as removeAgentsFromClusterAction,
    handleSaveCluster as saveClusterAction,
    loadClusterAgentMessages as loadClusterAgentMessagesAction,
    loadClusterAgentSwarmMessages as loadClusterAgentSwarmMessagesAction,
    loadClusterSwarmMessages as loadClusterSwarmMessagesAction,
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
    handleCreateAgentsBatch as createAgentsBatchAction,
    handleDeleteAgent as deleteAgentAction,
    handleOpenAgentFolder as openAgentFolderAction,
    handleOpenAgentSettings as openAgentSettingsAction,
    promptDeleteAgentsBatch as promptDeleteAgentsBatchAction,
    handleSaveAgentSettings as saveAgentSettingsAction
} from './openclawPanel/agentActions';
import { handlePanelMessage } from './openclawPanel/messageRouter';

const SESSION_SYNC_INTERVAL_MS = 450;
const CHANNEL_SYNC_INTERVAL_MS = 450;
const OPENCLAW_LUNA_ISSUES_URL = 'https://github.com/LunaticLegacy/openclaw-vscode-luna/issues';

/**
 * Sanitizes a file segment by removing invalid characters and normalizing whitespace
 * @param value - The string to sanitize
 * @returns The sanitized file segment
 */
function sanitizeFileSegment(value: string): string {
    const normalized = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-');
    return normalized.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'openclaw';
}

/**
 * Builds a timestamp string for file naming
 * @param date - The date to use (defaults to current date)
 * @returns The formatted timestamp string
 */
function buildTimestampFileSegment(date: Date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-');
}


/**
 * Main panel class for the OpenClaw extension, managing the webview interface,
 * agent interactions, cluster operations, channel management, and task scheduling.
 */
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
    private _seenRuntimeNoticeKeys: Set<string> = new Set();
    private _skillMarketService: any;

    /**
     * Creates or shows the OpenClaw panel
     * @param extensionUri - The extension URI
     * @param service - The OpenClaw service instance
     * @param agentManager - The agent manager instance
     * @param agentFolderManager - The agent folder manager instance
     * @param channelManager - The channel manager instance
     * @param clusterManager - The cluster manager instance
     * @param taskManager - The scheduled task manager instance
     * @returns The OpenClaw panel instance
     */
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

    /**
     * Gets the current panel instance
     * @returns The current OpenClaw panel or undefined
     */
    public static getPanel(): OpenClawPanel | undefined {
        return OpenClawPanel.currentPanel;
    }

    /**
     * Checks if the panel is currently visible
     * @returns True if the panel is visible
     */
    public isVisible(): boolean {
        return this._panel.visible;
    }

    /**
     * Disposes the current panel
     */
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

    /**
     * Posts a message to the webview
     * @param message - The message to post
     */
    private _postMessage(message: Record<string, unknown>) {
        this._notifyRuntimeNoticesFromEnvelope(message);
        if (!this._isWebviewReady) {
            this._pendingMessages.push(message);
            return;
        }

        void this._panel.webview.postMessage(message);
    }

    /**
     * Flushes pending messages to the webview
     */
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

    /**
     * Handles panel visibility change events
     * @param visible - Whether the panel is now visible
     */
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

    /**
     * Loads the list of agents and updates the UI
     */
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

    /**
     * Refreshes the agent list
     * @param force - Whether to force refresh from source
     * @returns A promise that resolves when refresh is complete
     */
    public async refreshAgents(force: boolean = true): Promise<void> {
        if (force) {
            await this._agentManager.getAgents(true);
        }

        await this._loadAgents();
    }

    /**
     * Handles incoming messages from the webview
     * @param message - The message from the webview
     */
    private async _handleMessage(message: any) {
        await handlePanelMessage(this._createMessageRouterContext(), message);
    }

    /**
     * Posts the current runtime state to the webview
     */
    private _postRuntimeState() {
        postRuntimeStateAction(this._createRuntimeActionContext());
    }

    /**
     * Refreshes the runtime state
     */
    private async _refreshRuntimeState() {
        await refreshRuntimeStateAction(this._createRuntimeActionContext());
    }

    /**
     * Loads skills from the skill market
     * @param filters - Optional filters for the skill search
     */
    private async _loadSkillMarket(filters: any) {
        try {
            const result = await this._skillMarketService.searchSkills(filters || {});
            
            this._postMessage({
                type: 'skillMarketLoaded',
                skills: result.skills,
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                categories: result.categories,
                tags: result.tags
            });
        } catch (error) {
            console.error('Failed to load skills from market:', error);
            this._postMessage({
                type: 'skillMarketLoadFailed',
                message: 'Failed to load skills from market'
            });
        }
    }

    /**
     * Refreshes the skill market cache and reloads
     */
    private async _refreshSkillMarket() {
        this._skillMarketService.clearCache();
        await this._loadSkillMarket(null);
    }

    /**
     * Installs a skill from the skill market
     * @param skillId - The ID of the skill to install
     */
    private async _installSkill(skillId: string) {
        try {
            const skill = await this._skillMarketService.getSkillDetails(skillId);
            if (!skill) {
                throw new Error('Skill not found');
            }
            
            const result = await this._skillMarketService.installSkill(skill);
            
            if (result.success) {
                this._postMessage({
                    type: 'skillInstalled',
                    skill: result.skill
                });
                await this._loadAgents();
            } else {
                throw new Error(result.error || 'Installation failed');
            }
        } catch (error) {
            console.error('Failed to install skill:', error);
            this._postMessage({
                type: 'skillInstallFailed',
                skillId,
                message: String(error)
            });
        }
    }

    /**
     * Uninstalls a skill from the skill market
     * @param skillId - The ID of the skill to uninstall
     */
    private async _uninstallSkill(skillId: string) {
        try {
            const success = await this._skillMarketService.uninstallSkill(skillId);
            
            if (success) {
                this._postMessage({
                    type: 'skillUninstalled',
                    skillId
                });
                await this._loadAgents();
            } else {
                throw new Error('Uninstallation failed');
            }
        } catch (error) {
            console.error('Failed to uninstall skill:', error);
            this._postMessage({
                type: 'skillUninstallFailed',
                skillId,
                message: String(error)
            });
        }
    }

    /**
     * Toggles a skill for a specific agent
     * @param agentId - The agent ID
     * @param skillId - The skill ID
     * @param enable - Whether to enable or disable the skill
     */
    private async _toggleSkillForAgent(agentId: string, skillId: string, enable: boolean) {
        try {
            const agents = await this._agentManager.getAgents();
            const agent = agents.find(a => a.id === agentId);
            
            if (!agent) {
                throw new Error('Agent not found');
            }
            
            const currentEnabledSkills = agent.enabledSkills || [];
            let newEnabledSkills: string[];
            
            if (enable) {
                newEnabledSkills = [...new Set([...currentEnabledSkills, skillId])];
            } else {
                newEnabledSkills = currentEnabledSkills.filter(id => id !== skillId);
            }
            
            await this._agentManager.updateAgent(agentId, {
                ...agent,
                enabledSkills: newEnabledSkills
            });
            
            this._postMessage({
                type: 'skillToggledForAgent',
                agentId,
                skillId,
                enabled: enable
            });
            
            await this._loadAgents();
        } catch (error) {
            console.error('Failed to toggle skill for agent:', error);
            this._postMessage({
                type: 'skillToggleFailed',
                agentId,
                skillId,
                message: String(error)
            });
        }
    }

    /**
     * Handles sending a chat message
     * @param content - The message content
     * @param agentId - Optional target agent ID
     * @param options - Optional send options
     */
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

        const resolvedSession = await this._sessionManager.getOrCreateSession(targetAgentId, {
            sessionId: this._currentSessionId || undefined
        });
        this._currentSessionId = resolvedSession.id;
        this._sessionManager.setCurrentSession(resolvedSession.id);

        const sessionId = resolvedSession.id;
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
        this._agentManager.beginAgentRun(targetAgentId);

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
            this._agentManager.endAgentRun(targetAgentId);
            if (this._isCurrentChatRun(chatRunToken, targetAgentId, sessionId)) {
                this._postRunState('chat', false);
            }
        }
    }

    /**
     * Creates a new chat session for the current agent
     * @returns The created session or null
     */
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

    /**
     * Activates an agent and loads its session
     * @param agentId - The agent ID to activate
     */
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

    /**
     * Loads the session history
     * @param session - The session to load history for
     * @param loadToken - The load token for validation
     */
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

    /**
     * Clears the current chat
     */
    private _clearChat() {
        this._stopActiveSessionSync();
        this._stopActiveChatRun();
        this._currentSessionId = null;
        this._postMessage({ type: 'clearChat' });
        this._postRunState('chat', false);
    }

    /**
     * Stops the active chat run
     */
    private _stopActiveChatRun() {
        if (this._currentAgentId) {
            this._agentManager.endAgentRun(this._currentAgentId);
        }
        this._chatRunToken += 1;
        const activeStream = this._activeChatStream;
        this._activeChatStream = null;
        if (activeStream) {
            void activeStream.return(undefined).catch(() => undefined);
        }
    }

    /**
     * Aborts a session run
     * @param sessionId - The session ID to abort
     */
    private _abortSessionRun(sessionId: string | null | undefined) {
        const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
        if (!normalizedSessionId) {
            return;
        }

        void this._service.abortSessionRun(normalizedSessionId).catch(() => undefined);
    }

    /**
     * Stops the active session sync
     */
    private _stopActiveSessionSync() {
        this._sessionSyncToken += 1;
    }

    /**
     * Starts syncing the active session
     * @param session - The session to sync
     * @param agentId - The agent ID
     * @param loadToken - The load token for validation
     */
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

    /**
     * Checks if the current sync target matches
     * @param syncToken - The sync token
     * @param agentId - The agent ID
     * @param sessionId - The session ID
     * @param loadToken - The load token
     * @returns True if this is the current sync target
     */
    private _isCurrentSessionSyncTarget(syncToken: number, agentId: string, sessionId: string, loadToken: number): boolean {
        return this._sessionSyncToken === syncToken
            && this._currentAgentId === agentId
            && this._currentSessionId === sessionId
            && this._contextLoadToken === loadToken
            && this._panel.visible;
    }

    /**
     * Checks if the current chat run matches
     * @param chatRunToken - The chat run token
     * @param agentId - The agent ID
     * @param sessionId - The session ID
     * @returns True if this is the current chat run
     */
    private _isCurrentChatRun(chatRunToken: number, agentId: string, sessionId: string | null): boolean {
        return this._chatRunToken === chatRunToken
            && this._currentAgentId === agentId
            && this._currentSessionId === sessionId;
    }

    /**
     * Loads the clusters
     * @param selectedClusterId - Optional cluster ID to select
     */
    private async _loadClusters(selectedClusterId?: string) {
        await loadClustersAction(this._createClusterActionContext(), selectedClusterId);
    }

    /**
     * Loads the usage data
     */
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

    /**
     * Loads the channels
     * @param selectedChannelId - Optional channel ID to select
     */
    private async _loadChannels(selectedChannelId?: string) {
        await loadChannelsAction(this._createChannelActionContext(), selectedChannelId);
    }

    /**
     * Activates a channel
     * @param channelId - The channel ID to activate
     */
    private async _activateChannel(channelId: string | null | undefined) {
        await activateChannelAction(this._createChannelActionContext(), channelId);
    }

    /**
     * Refreshes active channel messages
     * @param channelId - Optional channel ID
     */
    private async _refreshActiveChannelMessages(channelId?: string) {
        await refreshActiveChannelMessagesAction(this._createChannelActionContext(), channelId);
    }

    /**
     * Clears the channel selection
     */
    private _clearChannelSelection() {
        clearChannelSelectionAction(this._createChannelActionContext());
    }

    /**
     * Stops the active channel sync
     */
    private _stopActiveChannelSync() {
        stopActiveChannelSyncAction(this._createChannelActionContext());
    }

    /**
     * Handles creating a channel
     * @param data - The channel data
     */
    private async _handleCreateChannel(data: { name?: string; agentId?: string; description?: string }) {
        await createChannelAction(this._createChannelActionContext(), data);
    }

    /**
     * Handles updating a channel
     * @param channelId - The channel ID
     * @param data - The updated channel data
     */
    private async _handleUpdateChannel(
        channelId: string,
        data: { name?: string; agentId?: string; description?: string }
    ) {
        await updateChannelAction(this._createChannelActionContext(), channelId, data);
    }

    /**
     * Handles deleting a channel
     * @param channelId - The channel ID to delete
     */
    private async _handleDeleteChannel(channelId: string) {
        await deleteChannelAction(this._createChannelActionContext(), channelId);
    }

    /**
     * Handles sending a channel message
     * @param channelId - The channel ID
     * @param content - The message content
     */
    private async _handleSendChannelMessage(channelId: string, content: string) {
        await sendChannelMessageAction(this._createChannelActionContext(), channelId, content);
    }

    /**
     * Handles creating an agent
     * @param data - The agent data
     */
    private async _handleCreateAgent(data: any) {
        await createAgentAction(this._createAgentActionContext(), data);
    }

    /**
     * Handles creating agents in batch
     * @param data - The batch creation data
     */
    private async _handleCreateAgentsBatch(data: any) {
        await createAgentsBatchAction(this._createAgentActionContext(), data);
    }

    /**
     * Handles deleting an agent
     * @param agentId - The agent ID to delete
     */
    private async _handleDeleteAgent(agentId: string) {
        await deleteAgentAction(this._createAgentActionContext(), agentId);
    }

    /**
     * Prompts for batch agent deletion
     */
    private async _promptDeleteAgentsBatch() {
        await promptDeleteAgentsBatchAction(this._createAgentActionContext());
    }

    /**
     * Handles creating an agent folder
     * @param name - The folder name
     */
    private async _handleCreateAgentFolder(name: string) {
        await this._agentFolderManager.createFolder(name);
        await this._loadAgents();
    }

    /**
     * Prompts for creating an agent folder
     */
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

    /**
     * Prompts for renaming an agent folder
     * @param folderId - The folder ID to rename
     */
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

    /**
     * Prompts for deleting an agent folder
     * @param folderId - The folder ID to delete
     */
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

    /**
     * Handles renaming an agent folder
     * @param folderId - The folder ID
     * @param name - The new name
     */
    private async _handleRenameAgentFolder(folderId: string, name: string) {
        await this._agentFolderManager.renameFolder(folderId, name);
        await this._loadAgents();
    }

    /**
     * Handles deleting an agent folder
     * @param folderId - The folder ID to delete
     */
    private async _handleDeleteAgentFolder(folderId: string) {
        await this._agentFolderManager.deleteFolder(folderId);
        await this._loadAgents();
    }

    /**
     * Handles toggling an agent folder's collapsed state
     * @param folderId - The folder ID
     * @param collapsed - Whether the folder should be collapsed
     */
    private async _handleToggleAgentFolder(folderId: string, collapsed: boolean) {
        await this._agentFolderManager.setFolderCollapsed(folderId, collapsed);
        await this._loadAgents();
    }

    /**
     * Handles moving an agent to a folder
     * @param agentId - The agent ID
     * @param folderId - The target folder ID or null
     */
    private async _handleMoveAgentToFolder(agentId: string, folderId: string | null) {
        await this._agentFolderManager.moveAgentToFolder(agentId, folderId);
        await this._loadAgents();
    }

    /**
     * Handles broadcasting a message to a cluster
     * @param clusterId - The cluster ID
     * @param message - The message to broadcast
     */
    private async _handleBroadcast(clusterId: string, message: string) {
        const succeeded = await broadcastToClusterAction(this._createClusterActionContext(), clusterId, message);
        if (succeeded) {
            await this._autoSaveClusterConversationMarkdown({
                clusterId,
                targetKind: 'swarm',
                mode: 'broadcast'
            });
        }
    }

    /**
     * Loads the scheduled tasks
     */
    private async _loadTasks() {
        await loadTasksAction(this._createTaskActionContext());
    }

    /**
     * Prompts for broadcasting to a cluster
     * @param clusterId - The cluster ID
     */
    private async _promptBroadcastToCluster(clusterId: string) {
        await promptBroadcastToClusterAction(this._createClusterActionContext(), clusterId);
    }

    /**
     * Handles collaborating on a cluster
     * @param clusterId - The cluster ID
     * @param message - The collaboration message
     */
    private async _handleCollaborate(clusterId: string, message: string) {
        const succeeded = await collaborateClusterAction(this._createClusterActionContext(), clusterId, message);
        if (succeeded) {
            await this._autoSaveClusterConversationMarkdown({
                clusterId,
                targetKind: 'swarm',
                mode: 'collaborate'
            });
        }
    }

    /**
     * Prompts for cluster collaboration
     * @param clusterId - The cluster ID
     */
    private async _promptCollaborateCluster(clusterId: string) {
        await promptCollaborateClusterAction(this._createClusterActionContext(), clusterId);
    }

    /**
     * Loads cluster agent messages
     * @param clusterId - The cluster ID
     * @param agentId - The agent ID
     */
    private async _loadClusterAgentMessages(clusterId: string, agentId: string) {
        await loadClusterAgentMessagesAction(this._createClusterActionContext(), clusterId, agentId);
    }

    /**
     * Loads cluster agent swarm messages
     * @param clusterId - The cluster ID
     * @param agentId - The agent ID
     * @param mode - The swarm mode
     */
    private async _loadClusterAgentSwarmMessages(
        clusterId: string,
        agentId: string,
        mode: 'broadcast' | 'collaborate'
    ) {
        await loadClusterAgentSwarmMessagesAction(this._createClusterActionContext(), clusterId, agentId, mode);
    }

    /**
     * Loads cluster swarm messages
     * @param clusterId - The cluster ID
     * @param mode - The swarm mode
     */
    private async _loadClusterSwarmMessages(clusterId: string, mode: 'broadcast' | 'collaborate') {
        await loadClusterSwarmMessagesAction(this._createClusterActionContext(), clusterId, mode);
    }

    /**
     * Handles sending a message to a cluster agent
     * @param clusterId - The cluster ID
     * @param agentId - The agent ID
     * @param content - The message content
     */
    private async _handleClusterAgentMessage(clusterId: string, agentId: string, content: string) {
        const succeeded = await clusterAgentMessageAction(this._createClusterActionContext(), clusterId, agentId, content);
        if (succeeded) {
            await this._autoSaveClusterConversationMarkdown({
                clusterId,
                targetKind: 'agent',
                agentId,
                agentViewMode: 'chat'
            });
        }
    }

    /**
     * Handles cluster agent session commands
     * @param clusterId - The cluster ID
     * @param agentId - The agent ID
     * @param command - The command to execute
     */
    private async _handleClusterAgentSessionCommand(clusterId: string, agentId: string, command: 'new' | 'clear') {
        await clusterAgentSessionCommandAction(this._createClusterActionContext(), clusterId, agentId, command);
    }

    /**
     * Exports a cluster conversation
     * @param options - The export options
     */
    private async _exportClusterConversation(options: {
        clusterId: string;
        targetKind: 'swarm' | 'agent';
        exportKind: ClusterContextExportKind;
        mode?: 'broadcast' | 'collaborate';
        agentId?: string;
        agentViewMode?: 'chat' | 'broadcast' | 'collaborate';
    }) {
        const clusterId = String(options.clusterId || '').trim();
        if (!clusterId) {
            return;
        }

        try {
            const exportPayload = await this._buildClusterContextExportBundle(options);

            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(this._buildExportDefaultPath(
                    options.exportKind === 'raw'
                        ? exportPayload.rawFileName
                        : exportPayload.readableFileName
                )),
                filters: {
                    ...(options.exportKind === 'raw'
                        ? { JSON: ['json'] }
                        : { Markdown: ['md'] })
                }
            });

            if (!targetUri) {
                return;
            }

            const resolvedPath = resolveContextExportPath(targetUri.fsPath, options.exportKind);
            if (options.exportKind === 'raw') {
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(resolvedPath),
                    Buffer.from(JSON.stringify(exportPayload.body, null, 2), 'utf8')
                );
                showSuccessStatus(t('clusters.exportedRawContext', { name: path.basename(resolvedPath) }));
                return;
            }

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(resolvedPath),
                Buffer.from(exportPayload.readableMarkdown, 'utf8')
            );
            showSuccessStatus(t('clusters.exportedReadableContext', { name: path.basename(resolvedPath) }));
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.exportFailed', { error: String(error) }));
        }
    }

    /**
     * Imports a cluster replay from file
     */
    private async _importClusterReplay() {
        try {
            const [targetUri] = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: t('clusters.importReplay'),
                filters: {
                    JSON: ['json']
                }
            }) || [];

            if (!targetUri) {
                return;
            }

            const rawContent = Buffer.from(await vscode.workspace.fs.readFile(targetUri)).toString('utf8');
            const replay = parseClusterSwarmReplayImport(targetUri.fsPath, rawContent);

            this._viewMode = 'clusters';
            this._postMessage({
                type: 'switchView',
                view: 'clusters'
            });
            this._postMessage({
                type: 'clusterReplayLoaded',
                replay: {
                    sourcePath: replay.sourcePath,
                    importedAt: replay.importedAt,
                    exportedAt: replay.body.exportedAt,
                    mode: replay.body.mode,
                    messageCount: replay.body.messageCount,
                    cluster: {
                        ...replay.body.cluster,
                        status: 'inactive'
                    },
                    messages: replay.body.messages
                }
            });
            showSuccessStatus(t('clusters.importedReplay', { name: path.basename(targetUri.fsPath) }));
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.importReplayFailed', { error: String(error) }));
        }
    }

    /**
     * Builds a cluster context export bundle
     * @param options - The export options
     * @returns The export bundle
     */
    private async _buildClusterContextExportBundle(options: {
        clusterId: string;
        targetKind: 'swarm' | 'agent';
        mode?: 'broadcast' | 'collaborate';
        agentId?: string;
        agentViewMode?: 'chat' | 'broadcast' | 'collaborate';
    }): Promise<ClusterContextExportBundle> {
        const clusterId = String(options.clusterId || '').trim();
        if (!clusterId) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        const cluster = await this._clusterManager.getCluster(clusterId);
        if (!cluster) {
            throw new Error(t('clusterManager.notFound', { clusterId }));
        }

        return options.targetKind === 'agent'
            ? this._buildClusterAgentContextExport(clusterId, cluster, String(options.agentId || '').trim(), options.agentViewMode)
            : this._buildClusterSwarmContextExport(clusterId, cluster, options.mode === 'collaborate' ? 'collaborate' : 'broadcast');
    }

    /**
     * Builds a cluster swarm context export
     * @param clusterId - The cluster ID
     * @param cluster - The cluster data
     * @param mode - The swarm mode
     * @returns The export bundle
     */
    private async _buildClusterSwarmContextExport(
        clusterId: string,
        cluster: AgentCluster,
        mode: 'broadcast' | 'collaborate'
    ): Promise<ClusterContextExportBundle> {
        const messages = await this._clusterManager.getClusterSwarmMessages(clusterId, mode);
        return buildClusterContextExportBundle(
            `${sanitizeFileSegment(cluster.name)}-swarm-${mode}-context`,
            {
                exportedAt: new Date().toISOString(),
                kind: 'cluster-swarm-context',
                cluster: {
                    id: cluster.id,
                    name: cluster.name,
                    agentIds: [...cluster.agentIds]
                },
                mode,
                messageCount: messages.length,
                messages
            }
        );
    }

    /**
     * Builds a cluster agent context export
     * @param clusterId - The cluster ID
     * @param cluster - The cluster data
     * @param agentId - The agent ID
     * @param currentView - The current view mode
     * @returns The export bundle
     */
    private async _buildClusterAgentContextExport(
        clusterId: string,
        cluster: AgentCluster,
        agentId: string,
        currentView: 'chat' | 'broadcast' | 'collaborate' = 'chat'
    ): Promise<ClusterContextExportBundle> {
        if (!agentId) {
            throw new Error(t('panel.failedLoadContext', { error: 'Missing agent id' }));
        }

        const [agent, snapshot] = await Promise.all([
            this._agentManager.getAgent(agentId),
            this._clusterManager.getClusterAgentContextSnapshot(clusterId, agentId)
        ]);

        return buildClusterContextExportBundle(
            `${sanitizeFileSegment(cluster.name)}-${sanitizeFileSegment(agent?.name || agentId)}-context`,
            {
                exportedAt: new Date().toISOString(),
                kind: 'cluster-agent-context',
                cluster: {
                    id: cluster.id,
                    name: cluster.name,
                    agentIds: [...cluster.agentIds]
                },
                agent: {
                    id: agentId,
                    name: agent?.name || agentId,
                    model: agent?.model || null
                },
                currentView,
                messageCounts: {
                    direct: snapshot.directMessages.length,
                    broadcast: snapshot.broadcastMessages.length,
                    collaborate: snapshot.collaborateMessages.length
                },
                conversations: {
                    direct: snapshot.directMessages,
                    broadcast: snapshot.broadcastMessages,
                    collaborate: snapshot.collaborateMessages
                }
            }
        );
    }

    /**
     * Auto-saves a cluster conversation as markdown
     * @param options - The auto-save options
     */
    private async _autoSaveClusterConversationMarkdown(options: {
        clusterId: string;
        targetKind: 'swarm' | 'agent';
        mode?: 'broadcast' | 'collaborate';
        agentId?: string;
        agentViewMode?: 'chat' | 'broadcast' | 'collaborate';
    }) {
        try {
            const exportPayload = await this._buildClusterContextExportBundle(options);
            const exportDirectory = this._buildAutoExportDirectoryPath();
            const targetPath = path.join(
                exportDirectory,
                `${exportPayload.baseName}-${buildTimestampFileSegment()}.md`
            );

            await vscode.workspace.fs.createDirectory(vscode.Uri.file(exportDirectory));
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(targetPath),
                Buffer.from(exportPayload.readableMarkdown, 'utf8')
            );
            showSuccessStatus(t('clusters.autoSavedContext', { name: path.basename(targetPath) }));
        } catch (error) {
            console.warn('[OpenClaw Luna] Failed to auto-save cluster context export.', error);
        }
    }

    /**
     * Notifies runtime notices from an envelope message
     * @param message - The envelope message
     */
    private _notifyRuntimeNoticesFromEnvelope(message: Record<string, unknown>) {
        for (const chatMessage of this._collectChatMessagesFromEnvelope(message)) {
            this._notifyRuntimeNotice(chatMessage);
        }
    }

    /**
     * Collects chat messages from an envelope
     * @param message - The envelope message
     * @returns The collected chat messages
     */
    private _collectChatMessagesFromEnvelope(message: Record<string, unknown>): ChatMessage[] {
        const collected: ChatMessage[] = [];
        const push = (value: unknown) => {
            if (!value) {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(push);
                return;
            }
            if (typeof value === 'object' && 'role' in (value as Record<string, unknown>) && 'content' in (value as Record<string, unknown>)) {
                collected.push(value as ChatMessage);
            }
        };

        switch (String(message.type || '')) {
            case 'addMessage':
            case 'addChannelMessage':
            case 'appendClusterMessage':
            case 'clusterAgentResponse':
                push(message.message);
                break;
            case 'replaceSwarmMessages':
                if (message.keepPending === true) {
                    push(message.messages);
                }
                break;
        }
        return collected;
    }

    /**
     * Notifies a runtime notice
     * @param message - The chat message containing the notice
     */
    private _notifyRuntimeNotice(message: ChatMessage) {
        if (message.metadata?.noticeType !== 'lifecycle') {
            return;
        }

        const noticeKind = typeof message.metadata?.noticeKind === 'string'
            ? message.metadata.noticeKind
            : this._resolveRuntimeNoticeKind(message.content);
        if (noticeKind !== 'fallback' && noticeKind !== 'compression') {
            return;
        }

        const noticeKey = String(message.id || `${noticeKind}:${message.content}`);
        if (this._seenRuntimeNoticeKeys.has(noticeKey)) {
            return;
        }
        this._seenRuntimeNoticeKeys.add(noticeKey);

        void showWarningNotification(message.content);
        showWarningStatus(message.content);
    }

    /**
     * Resolves the runtime notice kind from content
     * @param content - The notice content
     * @returns The notice kind
     */
    private _resolveRuntimeNoticeKind(content: string): 'fallback' | 'compression' | 'notice' {
        const normalized = String(content || '').trim().toLowerCase();
        if (/fallback|downgrade|rollback|roll back|rolling back|rolling-back|rolled back|rewind|revert/.test(normalized)) {
            return 'fallback';
        }
        if (/compact|compaction|compacting|compress|compression|compressing|compressed context|context refresh|context compressed/.test(normalized)) {
            return 'compression';
        }
        return 'notice';
    }

    /**
     * Exports runtime logs to a file
     */
    private async _exportRuntimeLogs() {
        try {
            const exportPayload = await buildOpenClawRuntimeLogExport(this._extensionUri.fsPath);
            const fileName = `openclaw-runtime-logs-${buildTimestampFileSegment()}.json`;
            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(this._buildExportDefaultPath(fileName)),
                filters: {
                    JSON: ['json']
                }
            });

            if (!targetUri) {
                return;
            }

            await vscode.workspace.fs.writeFile(
                targetUri,
                Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8')
            );
            showSuccessStatus(t('setup.runtimeLogs.exported', { name: path.basename(targetUri.fsPath) }));
        } catch (error) {
            vscode.window.showErrorMessage(t('setup.runtimeLogs.exportFailed', { error: String(error) }));
        }
    }

    /**
     * Builds the default export path
     * @param fileName - The file name
     * @returns The full export path
     */
    private _buildExportDefaultPath(fileName: string): string {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            || path.dirname(this._extensionUri.fsPath);
        return path.join(workspacePath, fileName);
    }

    /**
     * Builds the auto-export directory path
     * @returns The directory path
     */
    private _buildAutoExportDirectoryPath(): string {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            || path.dirname(this._extensionUri.fsPath);
        return path.join(workspacePath, 'openclaw-exports');
    }

    /**
     * Handles stopping an active run
     * @param scope - The scope of the run to stop
     */
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

    /**
     * Handles saving agent settings
     * @param agentId - The agent ID
     * @param settings - The agent settings
     */
    private async _handleSaveAgentSettings(agentId: string, settings: any) {
        await saveAgentSettingsAction(this._createAgentActionContext(), agentId, settings);
    }

    /**
     * Handles retrying the connection
     */
    private async _handleRetryConnection() {
        await retryConnectionAction(this._createRuntimeActionContext());
    }

    /**
     * Handles saving connection settings
     * @param settings - The connection settings
     */
    private async _handleSaveConnectionSettings(settings: {
        configMode?: 'auto' | 'gateway' | 'local' | 'openclaw';
        gatewayUrl?: string;
        gatewayToken?: string;
    }) {
        await saveConnectionSettingsAction(this._createRuntimeActionContext(), settings);
    }

    /**
     * Handles saving OpenClaw configuration
     * @param settings - The configuration settings
     */
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

    /**
     * Handles starting OpenClaw
     */
    private async _handleStartOpenClaw() {
        await startOpenClawAction(this._createRuntimeActionContext());
    }

    /**
     * Handles saving a cluster
     * @param clusterId - The cluster ID or undefined for new cluster
     * @param data - The cluster data
     */
    private async _handleSaveCluster(
        clusterId: string | undefined,
        data: {
            name?: string;
            agentIds?: string[];
            createAgents?: Array<{
                name?: string;
                model?: string;
                systemPrompt?: string;
                presetId?: string;
                enabledSkills?: string[];
            }>;
            workspaceConfig?: Record<string, unknown>;
        }
    ) {
        await saveClusterAction(this._createClusterActionContext(), clusterId, data);
    }

    /**
     * Handles creating a cluster from a member preset
     * @param params - The creation parameters
     */
    private async _handleCreateClusterFromMemberPreset(params: {
        memberPresetId: string;
        customName?: string;
        model?: string;
    }) {
        await createClusterFromMemberPresetAction(this._createClusterActionContext(), params);
    }

    /**
     * Handles adding agents to a cluster
     * @param clusterId - The cluster ID
     */
    private async _handleAddAgentsToCluster(clusterId: string) {
        await addAgentsToClusterAction(this._createClusterActionContext(), clusterId);
    }

    /**
     * Handles removing agents from a cluster
     * @param clusterId - The cluster ID
     */
    private async _handleRemoveAgentsFromCluster(clusterId: string) {
        await removeAgentsFromClusterAction(this._createClusterActionContext(), clusterId);
    }

    /**
     * Handles creating a task
     * @param data - The task data
     */
    private async _handleCreateTask(data: any) {
        await createTaskAction(this._createTaskActionContext(), data);
    }

    /**
     * Handles updating a task
     * @param taskId - The task ID
     * @param data - The updated task data
     */
    private async _handleUpdateTask(taskId: string, data: any) {
        await updateTaskAction(this._createTaskActionContext(), taskId, data);
    }

    /**
     * Handles deleting a task
     * @param taskId - The task ID to delete
     */
    private async _handleDeleteTask(taskId: string) {
        await deleteTaskAction(this._createTaskActionContext(), taskId);
    }

    /**
     * Handles toggling a task
     * @param taskId - The task ID
     * @param enabled - Whether to enable or disable the task
     */
    private async _handleToggleTask(taskId: string, enabled?: boolean) {
        await toggleTaskAction(this._createTaskActionContext(), taskId, enabled);
    }

    /**
     * Handles running a task
     * @param taskId - The task ID to run
     */
    private async _handleRunTask(taskId: string) {
        await runTaskAction(this._createTaskActionContext(), taskId);
    }

    /**
     * Handles opening agent settings
     * @param agentId - The agent ID
     */
    private async _handleOpenAgentSettings(agentId: string) {
        await openAgentSettingsAction(this._createAgentActionContext(), agentId);
    }

    /**
     * Handles opening an agent folder
     * @param agentId - The agent ID
     */
    private async _handleOpenAgentFolder(agentId: string) {
        await openAgentFolderAction(this._createAgentActionContext(), agentId);
    }

    /**
     * Creates the runtime action context
     * @returns The runtime action context
     */
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

    /**
     * Creates the task action context
     * @returns The task action context
     */
    private _createTaskActionContext() {
        return {
            taskManager: this._taskManager,
            postMessage: this._postMessage.bind(this),
            ensureCapability: this._ensureCapability.bind(this),
            loadTasks: this._loadTasks.bind(this)
        };
    }

    /**
     * Creates the cluster action context
     * @returns The cluster action context
     */
    private _createClusterActionContext() {
        return {
            clusterManager: this._clusterManager,
            agentManager: this._agentManager,
            clusterSessionManager: this._clusterSessionManager,
            postMessage: this._postMessage.bind(this),
            loadAgents: this._loadAgents.bind(this),
            loadClusters: this._loadClusters.bind(this),
            showClusterView: this.showClusterView.bind(this),
            getCurrentAgentId: () => this._currentAgentId,
            beginAgentRun: (agentId: string) => this._agentManager.beginAgentRun(agentId),
            endAgentRun: (agentId: string) => this._agentManager.endAgentRun(agentId),
            nextClusterSwarmRunToken: () => ++this._clusterSwarmRunToken,
            getClusterSwarmRunToken: () => this._clusterSwarmRunToken,
            nextClusterAgentRunToken: () => ++this._clusterAgentRunToken,
            getClusterAgentRunToken: () => this._clusterAgentRunToken
        };
    }

    /**
     * Creates the agent action context
     * @returns The agent action context
     */
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

    /**
     * Creates the channel action context
     * @returns The channel action context
     */
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

    /**
     * Creates the message router context
     * @returns The message router context
     */
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
            loadClusterSwarmMessages: this._loadClusterSwarmMessages.bind(this),
            loadClusterAgentMessages: this._loadClusterAgentMessages.bind(this),
            loadClusterAgentSwarmMessages: this._loadClusterAgentSwarmMessages.bind(this),
            exportClusterConversation: this._exportClusterConversation.bind(this),
            importClusterReplay: this._importClusterReplay.bind(this),
            exportRuntimeLogs: this._exportRuntimeLogs.bind(this),
            clearChat: this._clearChat.bind(this),
            refreshAgents: this.refreshAgents.bind(this),
            handleCreateAgent: this._handleCreateAgent.bind(this),
            handleCreateAgentsBatch: this._handleCreateAgentsBatch.bind(this),
            showClusterEditor: this.showClusterEditor.bind(this),
            handleSaveCluster: this._handleSaveCluster.bind(this),
            handleCreateClusterFromMemberPreset: this._handleCreateClusterFromMemberPreset.bind(this),
            activateChannel: this._activateChannel.bind(this),
            refreshActiveChannelMessages: this._refreshActiveChannelMessages.bind(this),
            handleCreateChannel: this._handleCreateChannel.bind(this),
            handleUpdateChannel: this._handleUpdateChannel.bind(this),
            handleDeleteChannel: this._handleDeleteChannel.bind(this),
            handleSendChannelMessage: this._handleSendChannelMessage.bind(this),
            handleAddAgentsToCluster: this._handleAddAgentsToCluster.bind(this),
            handleRemoveAgentsFromCluster: this._handleRemoveAgentsFromCluster.bind(this),
            handleDeleteAgent: this._handleDeleteAgent.bind(this),
            promptDeleteAgentsBatch: this._promptDeleteAgentsBatch.bind(this),
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
            handleSaveOpenClawConfig: this._handleSaveOpenClawConfig.bind(this),
            loadSkillMarket: this._loadSkillMarket.bind(this),
            refreshSkillMarket: this._refreshSkillMarket.bind(this),
            installSkill: this._installSkill.bind(this),
            uninstallSkill: this._uninstallSkill.bind(this),
            toggleSkillForAgent: this._toggleSkillForAgent.bind(this)
        };
    }

    /**
     * Sets the active agent
     * @param agentId - The agent ID to set as active
     */
    public setActiveAgent(agentId: string) {
        void this._activateAgent(agentId);
    }

    /**
     * Sets the input text in the panel
     * @param text - The text to set
     */
    public setInputText(text: string) {
        this._postMessage({
            type: 'setInputText',
            text
        });
    }

    /**
     * Sends a message
     * @param message - The message content
     * @param agentId - Optional target agent ID
     */
    public async sendMessage(message: string, agentId?: string) {
        await this._handleSendMessage(message, agentId);
    }

    /**
     * Clears the chat
     */
    public clearChat() {
        this._clearChat();
    }

    /**
     * Shows the cluster view
     * @param clusters - The clusters to display
     * @param selectedClusterId - Optional selected cluster ID
     */
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

    /**
     * Shows the cluster editor
     * @param clusterId - Optional cluster ID to edit
     */
    public showClusterEditor(clusterId?: string) {
        this._viewMode = 'clusters';
        this._postMessage({
            type: 'showClusterEditor',
            clusterId,
            workModePresets: getClusterWorkModePresets()
        });
    }

    /**
     * Shows the usage dashboard
     */
    public showUsageDashboard() {
        this._viewMode = 'usage';
        this._postMessage({
            type: 'switchView',
            view: 'usage'
        });
        this._loadUsage();
    }

    /**
     * Shows agent settings
     * @param agent - The agent to show settings for
     */
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

    /**
     * Shows the task view
     */
    public showTaskView() {
        this._viewMode = 'tasks';
        this._postMessage({
            type: 'switchView',
            view: 'tasks'
        });
        void this._loadTasks();
    }

    /**
     * Shows the task editor
     * @param taskId - Optional task ID to edit
     */
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

    /**
     * Updates the panel
     */
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

    /**
     * Gets the HTML for the webview
     * @param webview - The webview
     * @returns The HTML string
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        return buildOpenClawPanelHtml(this._extensionUri, webview);
    }

    /**
     * Disposes the panel and cleans up resources
     */
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

    /**
     * Posts the run state to the webview
     * @param scope - The run scope
     * @param running - Whether the run is active
     */
    private _postRunState(scope: 'chat' | 'channel', running: boolean) {
        this._postMessage({
            type: 'setRunState',
            scope,
            running
        });
    }

    /**
     * Ensures a capability is supported
     * @param capabilityId - The capability ID to check
     * @returns True if the capability is supported
     */
    private _ensureCapability(capabilityId: OpenClawBooleanCapabilityId): boolean {
        return this._service.supportsCapability(capabilityId);
    }

    /**
     * Resolves a discovered channel by ID
     * @param channelId - The channel ID
     * @returns The discovered channel or null
     */
    private async _resolveDiscoveredChannel(channelId: string): Promise<DiscoveredChannel | null> {
        if (!channelId) {
            return null;
        }

        const channels = await this._service.getDiscoveredChannels();
        return channels.find(channel => channel.id === channelId) || null;
    }
}
