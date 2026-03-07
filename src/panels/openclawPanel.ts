import * as fs from 'fs';
import * as vscode from 'vscode';
import { getCurrentLocale, t } from '../i18n';
import { OpenClawService, ChatMessage, ChatSession, AgentCluster, APIUsage } from '../services/openclawService';
import { AgentManager } from '../managers/agentManager';
import { ChatSessionManager } from '../managers/chatSessionManager';

export class OpenClawPanel {
    public static currentPanel: OpenClawPanel | undefined;
    public static readonly viewType = 'openclawPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _service: OpenClawService;
    private _agentManager: AgentManager;
    private _sessionManager: ChatSessionManager;
    private _currentSessionId: string | null = null;
    private _currentAgentId: string | null = null;
    private _viewMode: 'chat' | 'clusters' | 'usage' = 'chat';
    private _contextLoadToken: number = 0;

    public static createOrShow(
        extensionUri: vscode.Uri,
        service: OpenClawService,
        agentManager: AgentManager
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

        OpenClawPanel.currentPanel = new OpenClawPanel(panel, extensionUri, service, agentManager);
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
        agentManager: AgentManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._service = service;
        this._agentManager = agentManager;
        this._sessionManager = new ChatSessionManager(service);

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        // 加载初始数据
        this._loadAgents();
    }

    private async _loadAgents() {
        try {
            const agents = await this._agentManager.getAgents();
            const models = await this._service.getAvailableModels(agents);
            this._panel.webview.postMessage({
                type: 'agentsLoaded',
                agents: agents.map(a => ({ id: a.id, name: a.name, model: a.model, status: a.status })),
                models
            });

            const preferredAgentId = this._currentAgentId
                || this._agentManager.getActiveAgentId()
                || agents.find(agent => agent.isDefault || agent.status === 'active')?.id
                || agents[0]?.id
                || null;

            if (preferredAgentId) {
                await this._activateAgent(preferredAgentId);
            }
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'agentsLoadFailed',
                message: t('panel.failedLoadAgents', { error: String(error) })
            });
        }
    }

    private async _handleMessage(message: any) {
        switch (message.type) {
            case 'sendMessage':
                await this._handleSendMessage(message.content, message.agentId);
                break;

            case 'selectAgent':
                await this._activateAgent(message.agentId);
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

            case 'createAgent':
                await this._handleCreateAgent(message.data);
                break;

            case 'deleteAgent':
                await this._handleDeleteAgent(message.agentId);
                break;

            case 'switchView':
                this._viewMode = message.view;
                if (message.view === 'clusters') {
                    await this._loadClusters();
                } else if (message.view === 'usage') {
                    await this._loadUsage();
                }
                break;

            case 'broadcastToCluster':
                await this._handleBroadcast(message.clusterId, message.message);
                break;

            case 'saveAgentSettings':
                await this._handleSaveAgentSettings(message.agentId, message.settings);
                break;

            case 'openAgentFolder':
                await this._handleOpenAgentFolder(message.agentId);
                break;
        }
    }

    private async _handleSendMessage(content: string, agentId?: string) {
        const targetAgentId = agentId || this._currentAgentId;
        
        if (!targetAgentId) {
            this._panel.webview.postMessage({
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

        // 添加用户消息到界面
        this._panel.webview.postMessage({
            type: 'addMessage',
            message: {
                role: 'user',
                content,
                timestamp: new Date().toISOString()
            }
        });

        try {
            const config = vscode.workspace.getConfiguration('openclaw');
            const streamResponse = config.get<boolean>('streamResponse', true);

            if (streamResponse) {
                // 流式响应
                let fullContent = '';
                
                for await (const chunk of this._sessionManager.streamMessage(content)) {
                    fullContent += chunk.content;
                    
                    this._panel.webview.postMessage({
                        type: 'updateStreamingMessage',
                        content: fullContent,
                        done: chunk.done
                    });
                }
            } else {
                // 非流式响应
                const response = await this._sessionManager.sendMessage(content);

                this._panel.webview.postMessage({
                    type: 'addMessage',
                    message: {
                        role: 'assistant',
                        content: response.content,
                        timestamp: response.timestamp,
                        tokenCount: response.tokenCount
                    }
                });
            }
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedSendMessage', { error: String(error) })
            });
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
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedCreateSession', { error: String(error) })
            });
            return null;
        }
    }

    private async _activateAgent(agentId: string) {
        const loadToken = ++this._contextLoadToken;
        this._currentAgentId = agentId;
        this._currentSessionId = null;
        this._agentManager.setActiveAgent(agentId);
        this._panel.webview.postMessage({
            type: 'setActiveAgent',
            agentId
        });
        this._panel.webview.postMessage({ type: 'clearChat' });
        this._panel.webview.postMessage({
            type: 'setContextLoading',
            loading: true
        });

        try {
            const session = await this._createSession();
            if (loadToken !== this._contextLoadToken || !session) {
                return;
            }

            await this._loadSessionHistory(session);
        } catch (error) {
            if (loadToken === this._contextLoadToken) {
                this._panel.webview.postMessage({
                    type: 'error',
                    message: t('panel.failedLoadContext', { error: String(error) })
                });
            }
        } finally {
            if (loadToken === this._contextLoadToken) {
                this._panel.webview.postMessage({
                    type: 'setContextLoading',
                    loading: false
                });
            }
        }
    }

    private async _loadSessionHistory(session?: ChatSession | null) {
        if (!this._currentSessionId) {
            return;
        }

        try {
            const messages = session?.messages || [];
            this._panel.webview.postMessage({ type: 'clearChat' });

            for (const message of messages) {
                this._panel.webview.postMessage({
                    type: 'addMessage',
                    message
                });
            }
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'setContextLoading',
                loading: false
            });
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedLoadChatHistory', { error: String(error) })
            });
        }
    }

    private _clearChat() {
        this._currentSessionId = null;
        this._panel.webview.postMessage({ type: 'clearChat' });
    }

    private async _loadClusters() {
        try {
            const clusters = await this._service.getClusters();
            this._panel.webview.postMessage({
                type: 'clustersLoaded',
                clusters
            });
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedLoadClusters', { error: String(error) })
            });
        }
    }

    private async _loadUsage() {
        try {
            const usage = await this._service.getUsage();
            this._panel.webview.postMessage({
                type: 'usageLoaded',
                usage
            });
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedLoadUsage', { error: String(error) })
            });
        }
    }

    private async _handleCreateAgent(data: any) {
        try {
            await this._agentManager.createAgent(data);
            await this._loadAgents();
            this._panel.webview.postMessage({
                type: 'agentCreated',
                success: true
            });
        } catch (error) {
            this._panel.webview.postMessage({
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
                this._panel.webview.postMessage({ type: 'clearChat' });
                this._panel.webview.postMessage({ type: 'setActiveAgent', agentId: null });
            }
            await this._loadAgents();
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedDeleteAgent', { error: String(error) })
            });
        }
    }

    private async _handleBroadcast(clusterId: string, message: string) {
        try {
            const responses = await this._service.sendToCluster(clusterId, message);
            this._panel.webview.postMessage({
                type: 'broadcastResults',
                responses
            });
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                message: t('panel.failedBroadcast', { error: String(error) })
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
        this._panel.webview.postMessage({
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

    public showClusterView(clusters: AgentCluster[]) {
        this._viewMode = 'clusters';
        this._panel.webview.postMessage({
            type: 'switchView',
            view: 'clusters',
            clusters
        });
    }

    public showUsageDashboard() {
        this._viewMode = 'usage';
        this._loadUsage();
    }

    public showAgentSettings(agent: any) {
        this._panel.webview.postMessage({
            type: 'showAgentSettings',
            agent
        });
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'OpenClaw';
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
        const panelScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js')
        );

        return this._applyTemplateVariables(template, {
            cspSource: webview.cspSource,
            locale: getCurrentLocale(),
            styleUri: styleUri.toString(),
            i18nScriptUri: i18nScriptUri.toString(),
            panelScriptUri: panelScriptUri.toString()
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

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
