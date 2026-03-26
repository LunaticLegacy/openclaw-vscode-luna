/**
 * OpenClaw Luna - Panel Bootstrap
 * OpenClaw Luna 面板引导模块
 * 
 * 该模块是Webview面板的入口点，负责：
 * - 监听来自VS Code扩展主机的消息
 * - 根据消息类型分发处理逻辑
 * - 协调各个功能模块的数据更新
 * - 初始化应用
 * 
 * 消息处理架构：
 * VS Code扩展主机 <---> Webview面板 (postMessage/message)
 */
'use strict';

    /**
     * 监听来自VS Code的消息事件
     * 这是Webview与扩展主机通信的主要通道
     * 所有来自extension.ts的消息都在这里处理
     */
    window.addEventListener('message', event => {
        const message = event.data;
        
        /**
         * 消息类型分发器
         * 根据message.type路由到对应的处理逻辑
         */
        switch (message.type) {
            /**
             * 运行时状态更新
             * 来自扩展主机的连接状态和配置信息
             */
            case 'runtimeState':
                // 更新运行时状态对象，确保所有字段都有安全的默认值
                state.runtime = {
                    connected: Boolean(message.connected),           // 连接状态
                    mode: message.mode || 'gateway',                 // 运行模式
                    sourceDescription: message.sourceDescription || '',  // 源描述
                    supportsTasks: Boolean(message.supportsTasks),   // 是否支持任务
                    supportsLiveSync: Boolean(message.supportsLiveSync), // 是否支持实时同步
                    capabilities: message.capabilities || null,      // 能力列表
                    capabilityMatrix: Array.isArray(message.capabilityMatrix) ? message.capabilityMatrix : [],
                    diagnostics: message.diagnostics || null,        // 诊断信息
                    openClawConfig: message.openClawConfig || null,  // OpenClaw配置
                    memoryStatus: message.memoryStatus || null       // 内存状态
                };
                // 更新UI组件
                updateConnectionBadge();
                renderConsoleOverview();
                break;

            /**
             * 智能体列表加载完成
             * 更新智能体、文件夹、模型等相关数据
             */
            case 'agentsLoaded':
                // 更新各类数据到状态管理
                state.aiSkills = Array.isArray(message.aiSkills) ? message.aiSkills : state.aiSkills;
                state.availableModels = Array.isArray(message.models) ? message.models : state.availableModels;
                state.chatSubagents = Array.isArray(message.subagents) ? message.subagents : [];
                
                // 渲染智能体列表和文件夹
                renderAgents(message.agents, message.folders);
                populateModelSelect(message.models || []);
                setAgentPresets(message.presets || state.agentPresets);
                
                // 如果存在命令栏渲染函数，更新命令栏
                if (typeof renderChatCommandBar === 'function') {
                    renderChatCommandBar();
                }
                break;

            /**
             * 智能体变更状态（创建/删除中）
             * 用于显示操作中的加载状态
             */
            case 'agentMutationState':
                // 操作开始：设置pending状态
                if (message.pending) {
                    // 清除之前的定时器
                    if (agentMutationTimer) {
                        window.clearTimeout(agentMutationTimer);
                        agentMutationTimer = null;
                    }
                    // 记录变更状态
                    state.agentMutation = {
                        action: message.action === 'delete' ? 'delete' : 'create',
                        pending: true,
                        agentName: typeof message.agentName === 'string' ? message.agentName : '',
                        agentId: typeof message.agentId === 'string' ? message.agentId : ''
                    };
                    renderAgents(state.agents);
                    break;
                }

                // 操作失败：显示错误状态
                if (message.success === false) {
                    state.agentMutation = {
                        action: message.action === 'delete' ? 'delete' : 'create',
                        pending: false,
                        success: false,
                        error: typeof message.error === 'string' ? message.error : '',
                        agentName: typeof message.agentName === 'string' ? message.agentName : '',
                        agentId: typeof message.agentId === 'string' ? message.agentId : ''
                    };
                    renderAgents(state.agents);
                    clearAgentMutationBanner(8000);  // 8秒后清除提示
                    break;
                }

                // 操作成功：清除状态
                clearAgentMutationBanner(0);
                break;
                 
            /**
             * 添加单条聊天消息
             * 用于流式接收或单次添加消息
             */
            case 'addMessage':
                addMessage(message.message);
                break;
                
            /**
             * 更新流式消息内容
             * 在AI生成回复过程中逐步更新内容
             */
            case 'updateStreamingMessage':
                updateStreamingMessage(message.content, message.done);
                break;

            /**
             * 替换整个消息列表
             * 用于切换智能体时加载历史消息
             */
            case 'replaceMessages':
                resetTransientChatState();           // 重置临时状态
                renderedChatMessageIds.clear();       // 清除已渲染消息ID集合
                elements.chatMessages.innerHTML = ''; // 清空消息容器
                isBulkRenderingChat = true;           // 标记批量渲染模式
                (message.messages || []).forEach(item => addMessage(item));
                isBulkRenderingChat = false;
                updateChatHomeVisibility();
                scrollToBottom();
                break;
                 
            /**
             * 清空聊天记录
             */
            case 'clearChat':
                resetTransientChatState();
                renderedChatMessageIds.clear();
                elements.chatMessages.innerHTML = '';
                updateChatHomeVisibility();
                break;
                 
            /**
             * 设置当前活动智能体
             * 切换选中的智能体并更新相关UI
             */
            case 'setActiveAgent':
                resetTransientChatState();
                renderedChatMessageIds.clear();
                state.currentAgentId = message.agentId;
                renderAgents(state.agents);
                renderConsoleOverview();
                if (typeof renderChatCommandBar === 'function') {
                    renderChatCommandBar();
                }
                break;
                
            /**
             * 设置输入框文本
             * 用于从外部填充输入框内容
             */
            case 'setInputText':
                elements.messageInput.value = message.text;
                break;
                
            /**
             * 集群列表加载完成
             */
            case 'clustersLoaded':
                if (Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                if (Array.isArray(message.identityPresets)) {
                    state.identityPresets = message.identityPresets;
                }
                if (message.selectedClusterId) {
                    state.currentClusterId = message.selectedClusterId;
                }
                renderClusters(message.clusters);
                break;

            /**
             * 集群回放数据加载完成
             */
            case 'clusterReplayLoaded':
                loadClusterReplay(message.replay || null);
                break;

            /**
             * 任务列表加载完成
             */
            case 'tasksLoaded':
                renderTasks(message.tasks, message.available, message.message, message.sourcePath);
                break;
                
            /**
             * 使用率数据加载完成
             */
            case 'usageLoaded':
                renderUsage(message.usage);
                break;

            /**
             * 频道列表加载完成
             */
            case 'channelsLoaded':
                renderChannels(message.channels, message.selectedChannelId);
                break;

            /**
             * 设置当前活动频道
             */
            case 'setActiveChannel':
                state.currentChannelId = message.channelId || null;
                if (state.currentChannelId) {
                    state.channelDraft = null;  // 清除草稿状态
                }
                // 如果没有选中频道且频道列表为空，创建新频道草稿
                if (!state.currentChannelId) {
                    state.channelMessages = [];
                    state.channelLoading = false;
                    if (state.channelsLoaded && !state.channelDraft && state.channels.length === 0) {
                        startNewChannelDraft({ focus: false });
                        break;
                    }
                }
                renderChannelWorkspace();
                break;

            /**
             * 设置频道上下文加载状态
             */
            case 'setChannelContextLoading':
                if (!message.channelId || message.channelId === state.currentChannelId) {
                    state.channelLoading = Boolean(message.loading);
                    if (!state.channelLoading) {
                        updateChannelInputState();
                    }
                    renderChannelConversation();
                }
                break;

            /**
             * 替换频道消息列表
             */
            case 'replaceChannelMessages':
                if (message.channelId === null || message.channelId === state.currentChannelId) {
                    state.channelMessages = Array.isArray(message.messages) ? message.messages : [];
                    state.channelLoading = false;
                    renderChannelConversation();
                    updateChannelInputState();
                }
                break;

            /**
             * 添加频道消息
             */
            case 'addChannelMessage':
                if (message.channelId === state.currentChannelId) {
                    clearChannelThinkingIndicator();  // 清除思考指示器
                    addChannelMessage(message.message);
                    state.channelSending = false;
                    updateChannelInputState();
                }
                break;

            /**
             * 频道消息发送失败
             */
            case 'channelSendFailed':
                if (message.channelId === state.currentChannelId) {
                    clearChannelThinkingIndicator();
                    state.channelSending = false;
                    updateChannelInputState();
                    showChannelError(message.message);
                }
                break;

            /**
             * 设置运行状态（流式/发送中）
             */
            case 'setRunState':
                // 聊天作用域
                if (message.scope === 'chat') {
                    state.isStreaming = Boolean(message.running);
                    updateChatInputState();
                    break;
                }
                // 频道作用域
                if (message.scope === 'channel') {
                    state.channelSending = Boolean(message.running);
                    updateChannelInputState();
                }
                break;

            /**
             * 切换视图
             */
            case 'switchView':
                applyView(message.view);
                // 集群视图额外处理
                if (message.view === 'clusters' && message.selectedClusterId) {
                    state.currentClusterId = message.selectedClusterId;
                }
                if (message.view === 'clusters' && Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                if (message.view === 'clusters' && message.clusters) {
                    renderClusters(message.clusters);
                }
                // 使用率视图额外处理
                if (message.view === 'usage' && message.usage) {
                    renderUsage(message.usage);
                }
                // 任务视图额外处理
                if (message.view === 'tasks' && message.tasks) {
                    renderTasks(message.tasks);
                }
                break;
                
            /**
             * 显示智能体设置对话框
             */
            case 'showAgentSettings':
                if (Array.isArray(message.aiSkills)) {
                    state.aiSkills = message.aiSkills;
                }
                showAgentSettings(message.agent);
                break;

            /**
             * 显示任务编辑器
             */
            case 'showTaskEditor':
                showTaskEditor(message.task || null);
                break;

            /**
             * 显示集群编辑器
             */
            case 'showClusterEditor':
                if (Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                openClusterEditor(message.clusterId || state.currentClusterId || undefined);
                break;

            /**
             * 智能体保存成功
             */
            case 'agentSaved':
                upsertAgentState(message.agent);
                // 如果是当前 onboarding 的智能体，更新状态
                if (message.agent?.id && message.agent.id === state.currentAgentId) {
                    state.agentOnboardingSaving = false;
                    setAgentOnboardingStatus(
                        'success',
                        window.OpenClawI18n ? window.OpenClawI18n.t('agentOnboarding.saved') : 'Preset context saved.'
                    );
                }
                // 如果是设置对话框中的智能体，更新保存状态
                if (message.agent?.id && document.getElementById('settings-agent-id')?.value === message.agent.id) {
                    state.agentSettingsSaving = false;
                    state.agentSettingsFormDirty = false;
                    setAgentSettingsStatus(
                        'success',
                        window.OpenClawI18n ? window.OpenClawI18n.t('agentSettings.saved') : 'Settings saved'
                    );
                }
                break;

            /**
             * 智能体保存失败
             */
            case 'agentSaveFailed':
                state.agentSettingsSaving = false;
                state.agentSettingsFormDirty = true;
                // 更新 onboarding 错误状态
                if (!message.agentId || message.agentId === state.currentAgentId) {
                    state.agentOnboardingSaving = false;
                    setAgentOnboardingStatus(
                        'error',
                        message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentOnboarding.saveFailed', { error: 'unknown error' }) : 'Failed to save preset context.')
                    );
                }
                // 更新设置对话框错误状态
                setAgentSettingsStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentSettings.saveFailed', { error: 'unknown error' }) : 'Failed to save settings.')
                );
                break;

            /**
             * 批量创建智能体成功
             */
            case 'agentsBatchCreated':
                state.batchCreateAgentsSaving = false;
                setBatchCreateAgentsStatus(
                    'success',
                    window.OpenClawI18n
                        ? window.OpenClawI18n.t('agentBatch.created', { count: message.count || 0 })
                        : 'Agents created.'
                );
                closeAllModals();
                resetNewAgentForm();
                break;

            /**
             * 批量创建智能体失败
             */
            case 'agentsBatchCreateFailed':
                state.batchCreateAgentsSaving = false;
                setBatchCreateAgentsStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentBatch.createFailed', { error: 'unknown error' }) : 'Failed to create agents.')
                );
                break;

            /**
             * 集群保存成功
             */
            case 'clusterSaved':
                upsertClusterState(message.cluster);
                break;
                
            /**
             * 广播模式结果返回
             */
            case 'broadcastResults':
                appendSwarmConversationMessages(
                    message.clusterId,
                    'broadcast',
                    buildBroadcastConversationMessages(message.responses || {})
                );
                break;

            /**
             * 协作模式结果返回
             */
            case 'collaborationResults':
                appendSwarmConversationMessages(
                    message.result?.clusterId || state.currentClusterId,
                    'collaborate',
                    buildCollaborationConversationMessages(message.result || null)
                );
                break;

            /**
             * 设置集群上下文加载状态
             */
            case 'setClusterContextLoading':
                setClusterConversationLoading(message.clusterId, message.agentId, message.loading);
                break;

            /**
             * 设置集群Swarm上下文加载状态
             */
            case 'setClusterSwarmContextLoading':
                setSwarmConversationLoading(message.clusterId, message.mode, message.loading, {
                    swarmRunId: message.swarmRunId,
                    outputMode: message.outputMode
                });
                break;

            /**
             * 设置集群智能体Swarm上下文加载状态
             */
            case 'setClusterAgentSwarmContextLoading':
                setClusterAgentSwarmConversationLoading(
                    message.clusterId,
                    message.agentId,
                    message.mode,
                    message.loading,
                    {
                        swarmRunId: message.swarmRunId
                    }
                );
                break;

            /**
             * 替换集群消息列表
             */
            case 'replaceClusterMessages':
                replaceClusterConversationMessages(message.clusterId, message.agentId, message.messages || []);
                break;

            /**
             * 替换集群智能体Swarm消息列表
             */
            case 'replaceClusterAgentSwarmMessages':
                replaceClusterAgentSwarmConversationMessages(
                    message.clusterId,
                    message.agentId,
                    message.mode,
                    message.messages || [],
                    {
                        swarmRunId: message.swarmRunId
                    }
                );
                break;

            /**
             * 替换Swarm消息列表
             */
            case 'replaceSwarmMessages':
                replaceSwarmConversationMessages(message.clusterId, message.mode, message.messages || [], {
                    swarmRunId: message.swarmRunId,
                    keepPending: Boolean(message.keepPending),
                    outputMode: message.outputMode,
                    knownRunIds: message.knownRunIds || []
                });
                break;

            case 'appendSwarmMessages':
                appendSwarmConversationMessages(message.clusterId, message.mode, message.messages || [], {
                    swarmRunId: message.swarmRunId,
                    keepPending: Boolean(message.keepPending),
                    outputMode: message.outputMode,
                    knownRunIds: message.knownRunIds || []
                });
                break;

            case 'patchSwarmMessages':
                patchSwarmConversationMessages(message.clusterId, message.mode, message.messages || [], {
                    swarmRunId: message.swarmRunId,
                    keepPending: Boolean(message.keepPending),
                    outputMode: message.outputMode,
                    knownRunIds: message.knownRunIds || []
                });
                break;

            /**
             * 追加集群消息
             */
            case 'appendClusterMessage':
                appendClusterConversationMessage(message.clusterId, message.agentId, message.message, {
                    keepPending: Boolean(message.keepPending)
                });
                break;

            /**
             * 集群智能体响应
             */
            case 'clusterAgentResponse':
                appendClusterConversationMessage(message.clusterId, message.agentId, message.message);
                break;

            /**
             * 集群运行失败
             */
            case 'clusterRunFailed':
                clearSwarmConversationPending(message.clusterId, message.mode, {
                    swarmRunId: message.swarmRunId,
                    outputMode: message.outputMode
                });
                break;

            /**
             * 智能体加载失败
             */
            case 'agentsLoadFailed':
                elements.agentList.innerHTML = `<div class="empty">Failed to load agents: ${escapeHtml(message.message)}</div>`;
                renderConsoleOverview();
                break;

            /**
             * 设置上下文加载状态
             */
            case 'setContextLoading':
                if (message.loading) {
                    showContextLoading();
                } else {
                    hideContextLoading();
                }
                break;
                
            /**
             * 通用错误消息
             */
            case 'error':
                showError(message.message);
                resetTransientChatState();
                if (state.viewMode === 'clusters') {
                    clearCurrentClusterPendingState();
                }
                break;

            /**
             * 连接设置保存成功
             */
            case 'connectionSettingsSaved':
                state.connectionFormDirty = false;
                syncConnectionForm(true);
                setConnectionSetupStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusSaved') : 'Connection settings saved.'
                );
                renderConsoleOverview();
                break;

            /**
             * 连接设置保存失败
             */
            case 'connectionSettingsSaveFailed':
                state.connectionFormDirty = true;
                setConnectionSetupStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusSaveFailed') : 'Failed to save connection settings.')
                );
                break;

            /**
             * OpenClaw配置保存成功
             */
            case 'openClawConfigSaved':
                state.openClawConfigFormDirty = false;
                syncOpenClawConfigForm(true);
                setOpenClawConfigStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.statusSaved') : 'OpenClaw config saved.'
                );
                renderConsoleOverview();
                // 如果智能体设置对话框打开，刷新模型选项
                if (elements.modalAgentSettings?.classList.contains('active')) {
                    const agentId = document.getElementById('settings-agent-id')?.value;
                    const agent = state.agents.find(a => a.id === agentId);
                    if (agent) {
                        syncAgentModelFormState('settings', agent.model || '');
                    }
                }
                break;

            /**
             * OpenClaw配置保存失败
             */
            case 'openClawConfigSaveFailed':
                state.openClawConfigFormDirty = true;
                setOpenClawConfigStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.statusSaveFailed') : 'Failed to save OpenClaw config.')
                );
                break;

            /**
             * OpenClaw启动成功
             */
            case 'openClawStartSucceeded':
                state.installGuideBusy = false;
                setInstallGuideStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.startStatusStarted') : 'OpenClaw started. Luna is reconnecting.'
                );
                renderConnectionSetup();
                break;

            /**
             * OpenClaw启动失败
             */
            case 'openClawStartFailed':
                state.installGuideBusy = false;
                setInstallGuideStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.startStatusFailed', { error: 'unknown error' }) : 'Failed to start OpenClaw.')
                );
                renderConnectionSetup();
                break;

            /**
             * 技能市场数据加载完成
             */
            case 'skillMarketLoaded':
                state.skillMarketData = message.overview || message.data || message;
                renderSkillMarket();
                if (elements.skillMarketLoading) {
                    elements.skillMarketLoading.classList.add('hidden');
                }
                if (elements.skillMarketContent) {
                    elements.skillMarketContent.classList.remove('hidden');
                }
                break;

            /**
             * 技能市场数据加载失败
             */
            case 'skillMarketLoadFailed':
                if (elements.skillMarketLoading) {
                    elements.skillMarketLoading.classList.add('hidden');
                }
                if (elements.skillMarketContent) {
                    elements.skillMarketContent.classList.remove('hidden');
                }
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.loadFailed') : 'Failed to load skills from market'));
                break;

            /**
             * 技能安装成功
             */
            case 'skillInstalled':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.installSuccess') : 'Skill installed successfully');
                // 刷新已安装技能列表
                void refreshSkillMarket();
                break;

            /**
             * 技能安装失败
             */
            case 'skillInstallFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.installError') : 'Failed to install skill'));
                break;

            /**
             * 技能卸载成功
             */
            case 'skillUninstalled':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.uninstallSuccess') : 'Skill uninstalled');
                // 刷新已安装技能列表
                void refreshSkillMarket();
                break;

            /**
             * 技能卸载失败
             */
            case 'skillUninstallFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.uninstallError') : 'Failed to uninstall skill'));
                break;

            /**
             * 智能体技能切换成功
             */
            case 'skillToggledForAgent':
                // 刷新UI以反映更改
                renderSkillMarket();
                break;

            /**
             * 技能切换失败
             */
            case 'skillToggleFailed':
                showNotification(message.message || 'Failed to toggle skill');
                break;

            /**
             * 内存状态更新
             */
            case 'memoryStatus':
                state.runtime = state.runtime || {};
                state.runtime.memoryStatus = message.status || null;
                renderMemoryStatus();
                break;

            /**
             * 内存导出成功
             */
            case 'memoryExported':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('memory.exportSuccess', { name: message.result?.targetPath || '' }) : 'Memory exported.');
                break;

            /**
             * 内存导出失败
             */
            case 'memoryExportFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('memory.exportFailed', { error: '' }) : 'Memory export failed.'));
                break;

            /**
             * 内存导入成功
             */
            case 'memoryImported':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('memory.importSuccess', { name: message.sourcePath || '' }) : 'Memory imported.');
                break;

            /**
             * 内存导入失败
             */
            case 'memoryImportFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('memory.importFailed', { error: '' }) : 'Memory import failed.'));
                break;
        }
    });

    /**
     * 显示上下文加载指示器
     * 在消息列表底部显示旋转的加载动画
     */
    function showContextLoading() {
        // 检查是否已在显示
        if (document.querySelector('.context-loading')) return;
        
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'context-loading';
        loadingDiv.innerHTML = `
            <div class="context-loading-spinner"></div>
            <span class="context-loading-text">${t('common.loading') || 'Loading...'}</span>
        `;
        elements.chatMessages.appendChild(loadingDiv);
        updateChatHomeVisibility();
        scrollToBottom();
    }

    /**
     * 隐藏上下文加载指示器
     */
    function hideContextLoading() {
        document.querySelector('.context-loading')?.remove();
        updateChatHomeVisibility();
    }

    /**
     * 初始化应用
     * 根据文档加载状态决定立即执行或等待DOMContentLoaded
     */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
