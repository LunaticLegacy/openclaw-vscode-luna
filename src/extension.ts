import * as vscode from 'vscode';
import { t } from './i18n';
import { OpenClawService } from './services/openclawService';
import { resolveOpenClawServiceConfig } from './services/openclawConfig';
import { OpenClawPanel } from './panels/openclawPanel';
import { AgentTreeProvider } from './providers/agentTreeProvider';
import { ClusterTreeProvider } from './providers/clusterTreeProvider';
import { UsageTreeProvider } from './providers/usageTreeProvider';
import { AgentManager } from './managers/agentManager';
import { ClusterManager } from './managers/clusterManager';
import { UsageManager } from './managers/usageManager';

let openclawService: OpenClawService;
let agentManager: AgentManager;
let clusterManager: ClusterManager;
let usageManager: UsageManager;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 OpenClaw extension is now active!');

    // 初始化服务
    const config = vscode.workspace.getConfiguration('openclaw');
    const serviceConfig = await resolveOpenClawServiceConfig(context.extensionPath);
    openclawService = new OpenClawService(serviceConfig);
    agentManager = new AgentManager(openclawService);
    clusterManager = new ClusterManager(openclawService);
    usageManager = new UsageManager(openclawService);

    // 设置上下文变量
    vscode.commands.executeCommand('setContext', 'openclaw.enabled', true);

    // 创建状态栏按钮
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(rocket) OpenClaw";
    statusBarItem.tooltip = t('statusBar.tooltip');
    statusBarItem.command = 'openclaw.openPanel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 注册 Tree View Providers
    const agentTreeProvider = new AgentTreeProvider(agentManager);
    const clusterTreeProvider = new ClusterTreeProvider(clusterManager);
    const usageTreeProvider = new UsageTreeProvider(usageManager);

    vscode.window.registerTreeDataProvider('openclawSidebar', agentTreeProvider);
    vscode.window.registerTreeDataProvider('openclawClusters', clusterTreeProvider);
    vscode.window.registerTreeDataProvider('openclawUsage', usageTreeProvider);

    // ==================== 命令注册 ====================

    // 1. 打开主面板
    const openPanelCmd = vscode.commands.registerCommand('openclaw.openPanel', () => {
        OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
    });
    context.subscriptions.push(openPanelCmd);

    // 2. 快速聊天 (Quick Chat) - 悬浮输入框
    const quickChatCmd = vscode.commands.registerCommand('openclaw.quickChat', async () => {
        const agents = await agentManager.getAgents();
        
        if (agents.length === 0) {
            const action = await vscode.window.showInformationMessage(
                t('quickChat.noAgents'),
                t('quickChat.createAgent'),
                t('quickChat.openPanel')
            );
            if (action === t('quickChat.createAgent')) {
                vscode.commands.executeCommand('openclaw.newAgent');
            } else if (action === t('quickChat.openPanel')) {
                vscode.commands.executeCommand('openclaw.openPanel');
            }
            return;
        }

        // 选择 Agent
        const agentItems = agents.map(agent => ({
            label: `$(account) ${agent.name}`,
            description: agent.model,
            detail: t('quickChat.status', { status: agent.status }),
            agentId: agent.id
        }));

        const selectedAgent = await vscode.window.showQuickPick(agentItems, {
            placeHolder: t('quickChat.selectAgent')
        });

        if (!selectedAgent) return;

        // 获取输入
        const input = await vscode.window.showInputBox({
            prompt: t('quickChat.promptSendTo', {
                name: selectedAgent.label.replace('$(account) ', '')
            }),
            placeHolder: t('quickChat.inputPlaceholder'),
            ignoreFocusOut: true
        });

        if (!input) return;

        // 发送消息
        try {
            const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
            panel.setActiveAgent(selectedAgent.agentId);
            await panel.sendMessage(input, selectedAgent.agentId);
            
            // 显示成功提示
            vscode.window.showInformationMessage(t('quickChat.sent'));
        } catch (error) {
            vscode.window.showErrorMessage(t('quickChat.sendFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(quickChatCmd);

    // 3. 与 Agent 聊天 (完整面板)
    const chatCmd = vscode.commands.registerCommand('openclaw.chat', async (agentArg?: any) => {
        const agentId = resolveAgentId(agentArg);
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
        
        if (agentId) {
            panel.setActiveAgent(agentId);
        }
        
        // 如果有选中的文本，自动添加到输入框
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.selection) {
            const selectedText = editor.document.getText(editor.selection);
            if (selectedText) {
                panel.setInputText(selectedText);
            }
        }
    });
    context.subscriptions.push(chatCmd);

    // 状态栏点击命令
    const statusBarClickCmd = vscode.commands.registerCommand('openclaw.statusBarClick', () => {
        vscode.commands.executeCommand('openclaw.openPanel');
    });
    context.subscriptions.push(statusBarClickCmd);

    // 4. 创建新 Agent
    const newAgentCmd = vscode.commands.registerCommand('openclaw.newAgent', async () => {
        const enteredName = await vscode.window.showInputBox({
            prompt: t('newAgent.promptName'),
            placeHolder: t('newAgent.placeholderName')
        });
        
        const name = enteredName?.trim();
        if (!name) return;

        const availableModels = await openclawService.getAvailableModels();
        let model: string | undefined;

        if (availableModels.length > 0) {
            const selectedModel = await vscode.window.showQuickPick(
                [
                    ...availableModels.map(modelName => ({
                        label: modelName
                    })),
                    {
                        label: t('newAgent.customModelOption'),
                        description: t('newAgent.customModelDescription')
                    }
                ],
                {
                    placeHolder: t('newAgent.selectModel')
                }
            );

            if (selectedModel?.label === t('newAgent.customModelOption')) {
                model = await vscode.window.showInputBox({
                    prompt: t('newAgent.promptModel'),
                    placeHolder: availableModels[0] || t('newAgent.placeholderModel'),
                    ignoreFocusOut: true
                });
            } else {
                model = selectedModel?.label;
            }
        } else {
            model = await vscode.window.showInputBox({
                prompt: t('newAgent.promptModel'),
                placeHolder: t('newAgent.placeholderModel'),
                ignoreFocusOut: true
            });
        }

        model = model?.trim();
        if (!model) return;

        try {
            await agentManager.createAgent({
                name,
                model,
                systemPrompt: t('newAgent.defaultSystemPrompt')
            });
            
            vscode.window.showInformationMessage(t('newAgent.created', { name }));
            agentTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('newAgent.createFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(newAgentCmd);

    // 5. 管理 Agents
    const manageAgentsCmd = vscode.commands.registerCommand('openclaw.manageAgents', async () => {
        const agents = await agentManager.getAgents();
        
        const items = agents.map(agent => ({
            label: agent.name,
            description: agent.model,
            detail: agent.id,
            agent
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('manageAgents.selectAgent')
        });

        if (selected) {
            const action = await vscode.window.showQuickPick([
                { label: t('manageAgents.actionChat'), action: 'chat' },
                { label: t('manageAgents.actionEdit'), action: 'edit' },
                { label: t('manageAgents.actionDelete'), action: 'delete' },
                { label: t('manageAgents.actionDetails'), action: 'details' }
            ], {
                placeHolder: t('manageAgents.selectAction')
            });

            if (action) {
                handleAgentAction(action.action as string, selected.agent, agentTreeProvider);
            }
        }
    });
    context.subscriptions.push(manageAgentsCmd);

    // 6. 查看 Agent Clusters
    const viewClustersCmd = vscode.commands.registerCommand('openclaw.viewClusters', async () => {
        const clusters = await clusterManager.getClusters();
        
        if (clusters.length === 0) {
            const createNew = await vscode.window.showInformationMessage(
                t('clusters.noneFound'),
                t('common.yes'),
                t('common.no')
            );
            
            if (createNew === t('common.yes')) {
                vscode.commands.executeCommand('openclaw.createCluster');
            }
            return;
        }

        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
        panel.showClusterView(clusters);
    });
    context.subscriptions.push(viewClustersCmd);

    // 7. API 用量仪表板
    const apiUsageCmd = vscode.commands.registerCommand('openclaw.apiUsage', async () => {
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
        panel.showUsageDashboard();
    });
    context.subscriptions.push(apiUsageCmd);

    // 8. 打开设置
    const settingsCmd = vscode.commands.registerCommand('openclaw.settings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'openclaw');
    });
    context.subscriptions.push(settingsCmd);

    // 9. 发送消息
    const sendMessageCmd = vscode.commands.registerCommand('openclaw.sendMessage', async (message: string, agentId?: string) => {
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
        await panel.sendMessage(message, agentId);
    });
    context.subscriptions.push(sendMessageCmd);

    // 10. 清空聊天记录
    const clearChatCmd = vscode.commands.registerCommand('openclaw.clearChat', async () => {
        const panel = OpenClawPanel.getPanel();
        if (panel) {
            panel.clearChat();
            vscode.window.showInformationMessage(t('clearChat.cleared'));
        }
    });
    context.subscriptions.push(clearChatCmd);

    // 11. 刷新 Agents
    const refreshAgentsCmd = vscode.commands.registerCommand('openclaw.refreshAgents', () => {
        agentTreeProvider.refresh();
        vscode.window.showInformationMessage(t('agents.refreshed'));
    });
    context.subscriptions.push(refreshAgentsCmd);

    // 12. 删除 Agent
    const deleteAgentCmd = vscode.commands.registerCommand('openclaw.deleteAgent', async (agentArg: any) => {
        const agentId = resolveAgentId(agentArg);
        if (!agentId) {
            vscode.window.showErrorMessage(t('agent.notFound'));
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            t('agent.deleteConfirm', { agentId }),
            { modal: true },
            t('common.delete')
        );
        
        if (confirm === t('common.delete')) {
            try {
                await agentManager.deleteAgent(agentId);
                vscode.window.showInformationMessage(t('agent.deleted'));
                agentTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('agent.deleteFailed', { error: String(error) }));
            }
        }
    });
    context.subscriptions.push(deleteAgentCmd);

    // 13. 编辑 Agent
    const editAgentCmd = vscode.commands.registerCommand('openclaw.editAgent', async (agentArg: any) => {
        const agentId = resolveAgentId(agentArg);
        if (!agentId) {
            vscode.window.showErrorMessage(t('agent.notFound'));
            return;
        }

        try {
            const agent = await agentManager.getAgent(agentId);
            if (!agent) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            const newName = await vscode.window.showInputBox({
                prompt: t('agent.editName'),
                value: agent.name
            });

            if (newName === undefined) return;

            const newPrompt = await vscode.window.showInputBox({
                prompt: t('agent.editPrompt'),
                value: agent.systemPrompt
            });

            if (newPrompt === undefined) return;

            await agentManager.updateAgent(agentId, {
                name: newName,
                systemPrompt: newPrompt
            });

            vscode.window.showInformationMessage(t('agent.updated'));
            agentTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('agent.editFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(editAgentCmd);

    // 14. 创建 Cluster
    const createClusterCmd = vscode.commands.registerCommand('openclaw.createCluster', async () => {
        const name = await vscode.window.showInputBox({
            prompt: t('clusters.promptName'),
            placeHolder: t('clusters.placeholderName')
        });
        
        if (!name) return;

        const agents = await agentManager.getAgents();
        if (agents.length === 0) {
            vscode.window.showErrorMessage(t('clusters.createAgentFirst'));
            return;
        }

        const selectedAgents = await vscode.window.showQuickPick(
            agents.map(a => ({ label: a.name, picked: false, agentId: a.id })),
            {
                placeHolder: t('clusters.selectAgents'),
                canPickMany: true
            }
        );

        if (!selectedAgents || selectedAgents.length === 0) return;

        try {
            await clusterManager.createCluster({
                name,
                agentIds: selectedAgents.map(s => s.agentId)
            });
            
            vscode.window.showInformationMessage(t('clusters.created', { name }));
            clusterTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.createFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(createClusterCmd);

    // 15. 打开 Agent 文件夹
    const openAgentFolderCmd = vscode.commands.registerCommand('openclaw.openAgentFolder', async (agentId: string) => {
        try {
            const agent = await agentManager.getAgent(agentId);
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
    });
    context.subscriptions.push(openAgentFolderCmd);

    // 16. 打开 Agent 设置
    const openAgentSettingsCmd = vscode.commands.registerCommand('openclaw.openAgentSettings', async (agentId: string) => {
        try {
            const agent = await agentManager.getAgent(agentId);
            if (!agent) {
                vscode.window.showErrorMessage(t('agent.notFound'));
                return;
            }

            // 打开设置面板
            const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager);
            panel.showAgentSettings(agent);
            
        } catch (error) {
            vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(openAgentSettingsCmd);

    // 17. 保存 Agent 设置
    const saveAgentSettingsCmd = vscode.commands.registerCommand('openclaw.saveAgentSettings', async (agentId: string, settings: any) => {
        try {
            await agentManager.updateAgent(agentId, settings);
            vscode.window.showInformationMessage(t('agentSettings.saved'));
            agentTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('agentSettings.saveFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(saveAgentSettingsCmd);

    // ==================== 事件监听 ====================

    // 监听配置变化
    const configChange = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('openclaw')) {
            void (async () => {
                const nextConfig = await resolveOpenClawServiceConfig(context.extensionPath);
                openclawService.updateConfig(nextConfig);
                agentTreeProvider.refresh();
                clusterTreeProvider.refresh();
                usageTreeProvider.refresh();
            })();
        }
    });
    context.subscriptions.push(configChange);

    // 初始化时加载数据
    agentTreeProvider.refresh();
    clusterTreeProvider.refresh();
    usageTreeProvider.refresh();
}

async function handleAgentAction(
    action: string,
    agent: any,
    treeProvider: AgentTreeProvider
) {
    switch (action) {
        case 'chat':
            vscode.commands.executeCommand('openclaw.chat', agent.id);
            break;
        case 'edit':
            vscode.commands.executeCommand('openclaw.editAgent', agent.id);
            break;
        case 'delete':
            vscode.commands.executeCommand('openclaw.deleteAgent', agent.id);
            break;
        case 'details':
            const details = t('agent.details', {
                name: agent.name,
                id: agent.id,
                model: agent.model,
                status: agent.status,
                created: new Date(agent.createdAt).toLocaleString()
            });
            vscode.window.showInformationMessage(details);
            break;
    }
}

function resolveAgentId(agentArg: any): string | undefined {
    if (!agentArg) {
        return undefined;
    }

    if (typeof agentArg === 'string') {
        return agentArg;
    }

    if (typeof agentArg.id === 'string') {
        return agentArg.id;
    }

    if (typeof agentArg.agent?.id === 'string') {
        return agentArg.agent.id;
    }

    return undefined;
}

export function deactivate() {
    console.log('👋 OpenClaw Luna extension is now deactivated');
    
    // 清理资源
    OpenClawPanel.disposePanel();
    
    if (openclawService) {
        openclawService.dispose();
    }
    
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
