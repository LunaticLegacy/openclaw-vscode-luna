import * as vscode from 'vscode';
import * as path from 'path';
import { t } from './i18n';
import { OpenClawService } from './services/openclawService';
import { resolveOpenClawServiceConfig } from './services/openclawConfig';
import { OpenClawPanel } from './panels/openclawPanel';
import { OpenClawSidebarProvider } from './providers/openclawSidebarProvider';
import { UsageTreeProvider } from './providers/usageTreeProvider';
import { TaskTreeProvider } from './providers/taskTreeProvider';
import { AgentManager } from './managers/agentManager';
import { ClusterManager } from './managers/clusterManager';
import { UsageManager } from './managers/usageManager';
import { ScheduledTaskManager } from './managers/scheduledTaskManager';
import { AgentPresetScaffolder } from './services/agentPresetScaffolder';
import {
    CUSTOM_AGENT_PRESET_ID,
    AgentPresetOption,
    getAgentPreset,
    getAgentPresets
} from './config/agentPresets';

let openclawService: OpenClawService;
let agentManager: AgentManager;
let clusterManager: ClusterManager;
let usageManager: UsageManager;
let taskManager: ScheduledTaskManager;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 OpenClaw extension is now active!');

    // 初始化服务
    const config = vscode.workspace.getConfiguration('openclaw');
    const serviceConfig = await resolveOpenClawServiceConfig(context.extensionPath);
    openclawService = new OpenClawService(serviceConfig);
    agentManager = new AgentManager(
        openclawService,
        new AgentPresetScaffolder(context.extensionPath, openclawService)
    );
    clusterManager = new ClusterManager(
        openclawService,
        path.join(context.globalStorageUri.fsPath, 'clusters.json')
    );
    usageManager = new UsageManager(openclawService);
    taskManager = new ScheduledTaskManager(openclawService);

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
    const sidebarTreeProvider = new OpenClawSidebarProvider(agentManager, clusterManager);
    const usageTreeProvider = new UsageTreeProvider(usageManager);
    const taskTreeProvider = new TaskTreeProvider(taskManager);

    vscode.window.registerTreeDataProvider('openclawSidebar', sidebarTreeProvider);
    vscode.window.registerTreeDataProvider('openclawUsage', usageTreeProvider);
    vscode.window.registerTreeDataProvider('openclawTasks', taskTreeProvider);

    // ==================== 命令注册 ====================

    // 1. 打开主面板
    const openPanelCmd = vscode.commands.registerCommand('openclaw.openPanel', () => {
        OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
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
            const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
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
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
        
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
        const selectedPreset = await pickAgentPreset();
        if (selectedPreset === undefined) {
            return;
        }

        const enteredName = await vscode.window.showInputBox({
            prompt: t('newAgent.promptName'),
            placeHolder: selectedPreset?.defaultName || t('newAgent.placeholderName'),
            value: selectedPreset?.defaultName || ''
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
                systemPrompt: selectedPreset?.systemPrompt || t('newAgent.defaultSystemPrompt'),
                presetId: selectedPreset?.id
            });
            
            vscode.window.showInformationMessage(t('newAgent.created', { name }));
            sidebarTreeProvider.refresh();
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
                handleAgentAction(action.action as string, selected.agent);
            }
        }
    });
    context.subscriptions.push(manageAgentsCmd);

    // 6. 查看 Agent Clusters
    const viewClustersCmd = vscode.commands.registerCommand('openclaw.viewClusters', async (clusterArg?: any) => {
        const selectedClusterId = resolveClusterId(clusterArg);
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

        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
        panel.showClusterView(clusters, selectedClusterId);
    });
    context.subscriptions.push(viewClustersCmd);

    const manageTasksCmd = vscode.commands.registerCommand('openclaw.manageTasks', () => {
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
        panel.showTaskView();
    });
    context.subscriptions.push(manageTasksCmd);

    const createTaskCmd = vscode.commands.registerCommand('openclaw.createTask', async () => {
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
        await panel.showTaskEditor();
    });
    context.subscriptions.push(createTaskCmd);

    const editTaskCmd = vscode.commands.registerCommand('openclaw.editTask', async (taskArg: any) => {
        const taskId = resolveTaskId(taskArg);
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
        await panel.showTaskEditor(taskId);
    });
    context.subscriptions.push(editTaskCmd);

    const toggleTaskCmd = vscode.commands.registerCommand('openclaw.toggleTask', async (taskArg: any) => {
        const taskId = resolveTaskId(taskArg);
        if (!taskId) {
            vscode.window.showErrorMessage(t('tasks.selectionRequired'));
            return;
        }

        try {
            const task = await taskManager.toggleTask(taskId);
            vscode.window.showInformationMessage(task.enabled ? t('tasks.enabled') : t('tasks.disabled'));
            taskTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(toggleTaskCmd);

    const runTaskCmd = vscode.commands.registerCommand('openclaw.runTask', async (taskArg: any) => {
        const taskId = resolveTaskId(taskArg);
        if (!taskId) {
            vscode.window.showErrorMessage(t('tasks.selectionRequired'));
            return;
        }

        try {
            await taskManager.runTask(taskId, 'manual');
            vscode.window.showInformationMessage(t('tasks.runTriggered'));
            taskTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.runFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(runTaskCmd);

    const deleteTaskCmd = vscode.commands.registerCommand('openclaw.deleteTask', async (taskArg: any) => {
        const taskId = resolveTaskId(taskArg);
        if (!taskId) {
            vscode.window.showErrorMessage(t('tasks.selectionRequired'));
            return;
        }

        try {
            const task = await taskManager.getTask(taskId);
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

            await taskManager.deleteTask(taskId);
            vscode.window.showInformationMessage(t('tasks.deleted'));
            taskTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.deleteFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(deleteTaskCmd);

    // 7. API 用量仪表板
    const apiUsageCmd = vscode.commands.registerCommand('openclaw.apiUsage', async () => {
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
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
        const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
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
    const refreshAgentsCmd = vscode.commands.registerCommand('openclaw.refreshAgents', async () => {
        try {
            await agentManager.getAgents(true);
            sidebarTreeProvider.refresh();
            const panel = OpenClawPanel.getPanel();
            if (panel) {
                await panel.refreshAgents(false);
            }
            vscode.window.showInformationMessage(t('agents.refreshed'));
        } catch (error) {
            vscode.window.showErrorMessage(t('agents.refreshFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(refreshAgentsCmd);

    const refreshTasksCmd = vscode.commands.registerCommand('openclaw.refreshTasks', async () => {
        try {
            await taskManager.refresh();
            taskTreeProvider.refresh();
            vscode.window.showInformationMessage(t('tasks.refreshed'));
        } catch (error) {
            vscode.window.showErrorMessage(t('tasks.refreshFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(refreshTasksCmd);

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
                sidebarTreeProvider.refresh();
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
            sidebarTreeProvider.refresh();
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
            sidebarTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.createFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(createClusterCmd);

    const deleteClusterCmd = vscode.commands.registerCommand('openclaw.deleteCluster', async (clusterArg: any) => {
        try {
            let clusterId = resolveClusterId(clusterArg);
            if (!clusterId) {
                const clusters = await clusterManager.getClusters();
                if (clusters.length === 0) {
                    vscode.window.showInformationMessage(t('clusters.noneFound'));
                    return;
                }

                const selectedCluster = await vscode.window.showQuickPick(
                    clusters.map(cluster => ({
                        label: cluster.name,
                        description: t('clusterTree.agentsCount', { count: cluster.agentIds.length }),
                        clusterId: cluster.id
                    })),
                    {
                        placeHolder: t('clusters.selectClusterToDelete')
                    }
                );

                if (!selectedCluster) {
                    return;
                }

                clusterId = selectedCluster.clusterId;
            }

            const cluster = await clusterManager.getCluster(clusterId);
            if (!cluster) {
                vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                t('clusters.deleteConfirm', { name: cluster.name }),
                { modal: true },
                t('common.delete')
            );

            if (confirm !== t('common.delete')) {
                return;
            }

            await clusterManager.deleteCluster(clusterId);
            vscode.window.showInformationMessage(t('clusters.deleted', { name: cluster.name }));
            sidebarTreeProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(t('clusters.deleteFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(deleteClusterCmd);

    // 15. 打开 Agent 文件夹
    const openAgentFolderCmd = vscode.commands.registerCommand('openclaw.openAgentFolder', async (agentArg: any) => {
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

            const folderPath = await openclawService.resolveAgentFolderPath(agent);
            if (!folderPath) {
                vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
                return;
            }

            const folderUri = vscode.Uri.file(folderPath);

            try {
                await vscode.workspace.fs.stat(folderUri);
            } catch {
                vscode.window.showWarningMessage(t('agentSettings.noWorkspace'));
                return;
            }

            await vscode.commands.executeCommand('revealFileInOS', folderUri);
        } catch (error) {
            vscode.window.showErrorMessage(t('agentSettings.openFolderFailed', { error: String(error) }));
        }
    });
    context.subscriptions.push(openAgentFolderCmd);

    // 16. 打开 Agent 设置
    const openAgentSettingsCmd = vscode.commands.registerCommand('openclaw.openAgentSettings', async (agentArg: any) => {
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

            // 打开设置面板
            const panel = OpenClawPanel.createOrShow(context.extensionUri, openclawService, agentManager, clusterManager, taskManager);
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
            sidebarTreeProvider.refresh();
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
                sidebarTreeProvider.refresh();
                usageTreeProvider.refresh();
                taskTreeProvider.refresh();
            })();
        }
    });
    context.subscriptions.push(configChange);

    // 初始化时加载数据
    sidebarTreeProvider.refresh();
    usageTreeProvider.refresh();
    taskTreeProvider.refresh();
    void taskManager.refresh().catch(error => {
        console.error('Failed to initialize scheduled tasks.', error);
    });
}

async function handleAgentAction(
    action: string,
    agent: any
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

function resolveClusterId(clusterArg: any): string | undefined {
    if (!clusterArg) {
        return undefined;
    }

    if (typeof clusterArg === 'string') {
        return clusterArg;
    }

    if (typeof clusterArg.id === 'string') {
        return clusterArg.id;
    }

    if (typeof clusterArg.cluster?.id === 'string') {
        return clusterArg.cluster.id;
    }

    return undefined;
}

function resolveTaskId(taskArg: any): string | undefined {
    if (!taskArg) {
        return undefined;
    }

    if (typeof taskArg === 'string') {
        return taskArg;
    }

    if (typeof taskArg.id === 'string') {
        return taskArg.id;
    }

    if (typeof taskArg.task?.id === 'string') {
        return taskArg.task.id;
    }

    return undefined;
}

async function pickAgentPreset(): Promise<AgentPresetOption | null | undefined> {
    const items = [
        {
            label: t('newAgent.preset.custom'),
            description: t('newAgent.preset.customDescription'),
            detail: t('newAgent.preset.hint'),
            presetId: CUSTOM_AGENT_PRESET_ID
        },
        ...getAgentPresets().map(preset => ({
            label: preset.label,
            description: preset.defaultName,
            detail: preset.description,
            presetId: preset.id
        }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: t('newAgent.selectPreset')
    });

    if (!selected) {
        return undefined;
    }

    return getAgentPreset(selected.presetId);
}

export function deactivate() {
    console.log('👋 OpenClaw Luna extension is now deactivated');
    
    // 清理资源
    OpenClawPanel.disposePanel();
    
    if (openclawService) {
        openclawService.dispose();
    }

    if (taskManager) {
        taskManager.dispose();
    }
    
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
