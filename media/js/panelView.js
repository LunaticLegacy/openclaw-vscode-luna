// OpenClaw Luna - Panel View
// 面板视图管理模块 - 负责处理UI文本更新、视图切换和各类交互操作
'use strict';

    /**
     * 更新UI界面中的所有文本内容
     * 根据当前语言设置(i18n)更新各输入框的placeholder、按钮文本、侧边栏标题等
     * @function updateUIText
     * @returns {void}
     */
    function updateUIText() {
        // 检查i18n模块是否已加载，若未加载则跳过更新
        if (!window.OpenClawI18n) return;
        
        // =====================================================
        // 更新输入框占位符和按钮文本
        // =====================================================
        
        // 更新主聊天输入框的placeholder
        if (elements.messageInput) {
            elements.messageInput.placeholder = t('chat.placeholder');
        }
        // 更新集群聊天输入框的placeholder
        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.placeholder = t('clusters.chatPlaceholder');
        }
        // 更新频道聊天输入框的placeholder
        if (elements.channelMessageInput) {
            elements.channelMessageInput.placeholder = t('channel.chatPlaceholder');
        }
        
        // 更新各视图中发送按钮的文本
        if (elements.btnSend) {
            elements.btnSend.textContent = t('chat.send');
        }
        if (elements.btnStop) {
            elements.btnStop.textContent = t('chat.stop');
        }
        if (elements.btnSendCluster) {
            elements.btnSendCluster.textContent = t('chat.send');
        }
        if (elements.btnStopCluster) {
            elements.btnStopCluster.textContent = t('chat.stop');
        }
        if (elements.btnSendChannel) {
            elements.btnSendChannel.textContent = t('chat.send');
        }
        if (elements.btnStopChannel) {
            elements.btnStopChannel.textContent = t('chat.stop');
        }
        
        // 更新功能按钮的标题(tooltip)
        if (elements.btnClear) {
            elements.btnClear.title = t('chat.clear');
        }
        // 更新新建Agent按钮的文本
        if (elements.btnNewAgent) {
            elements.btnNewAgent.innerHTML = `${t('sidebar.newAgent')}`;
        }
        
        // =====================================================
        // 更新侧边栏标题
        // =====================================================
        
        // 使用data-i18n属性选择器查找并更新侧边栏Agent标题
        const sidebarAgents = document.querySelector('[data-i18n="sidebar.agents"]');
        if (sidebarAgents) sidebarAgents.textContent = t('sidebar.agents');
        
        // 更新侧边栏集群标题
        const sidebarClusters = document.querySelector('[data-i18n="sidebar.clusters"]');
        if (sidebarClusters) sidebarClusters.textContent = t('sidebar.clusters');
        
        // 更新侧边栏使用量标题
        const sidebarUsage = document.querySelector('[data-i18n="sidebar.usage"]');
        if (sidebarUsage) sidebarUsage.textContent = t('sidebar.usage');
        
        // =====================================================
        // 批量更新所有带有data-i18n属性的元素
        // =====================================================
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = t(key);
            }
        });
        
        // =====================================================
        // 更新placeholder属性（通过data-i18n-placeholder标记）
        // =====================================================
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.placeholder = t(key);
            }
        });

        // =====================================================
        // 更新title和aria-label属性（通过data-i18n-title标记）
        // =====================================================
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.title = t(key);
                // 同时设置无障碍访问标签
                el.setAttribute('aria-label', t(key));
            }
        });

        // =====================================================
        // 触发各模块的重新渲染以更新文本
        // =====================================================
        updateConnectionBadge();      // 更新连接状态徽章
        renderConsoleOverview();      // 渲染控制台概览
        renderConnectionSetup();      // 渲染连接设置
        renderOpenClawConfig();       // 渲染OpenClaw配置
        updateOpenClawConfigEntryState(); // 更新配置入口状态
        renderClusterWorkspace();     // 渲染集群工作区
        renderChannelWorkspace();     // 渲染频道工作区
        
        // 如果有使用量数据，重新渲染使用量界面
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
        
        // 更新Agent预设选项
        setAgentPresets(state.agentPresets);
        // 渲染新建Agent模式界面
        renderNewAgentMode();
    }

    // =====================================================
    // 视图切换功能
    // =====================================================

    /**
     * 应用指定的视图模式（内部使用）
     * 更新导航标签和视图的激活状态，处理视图特定的渲染逻辑
     * @function applyView
     * @param {string} view - 视图名称，可选值: 'chat' | 'clusters' | 'tasks' | 'usage' 等
     * @returns {void}
     */
    function applyView(view) {
        // 保存当前视图模式到状态
        state.viewMode = view;

        // 当切换到非聊天视图时，清除聊天首页固定状态和强制设置面板状态
        if (view !== 'chat') {
            state.chatHomePinned = false;
            state.forceSetupPanel = false;
        }
        
        // 更新导航标签的激活状态：匹配当前视图的标签添加active类
        elements.navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
        
        // 更新视图容器的激活状态：显示对应id的视图
        elements.views.forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

        // 如果是聊天视图，渲染相关配置面板
        if (view === 'chat') {
            renderConnectionSetup();  // 渲染连接设置面板
            renderOpenClawConfig();   // 渲染OpenClaw配置面板
            updateChatHomeVisibility(); // 更新聊天首页可见性
        }

        // 更新配置入口的显示状态
        updateOpenClawConfigEntryState();
    }

    /**
     * 切换视图（外部调用接口）
     * 应用视图变更并通过VS Code API发送消息通知扩展
     * @function switchView
     * @param {string} view - 目标视图名称
     * @returns {void}
     */
    function switchView(view) {
        applyView(view);
        // 向VS Code扩展发送视图切换消息，用于状态同步
        vscode.postMessage({ type: 'switchView', view });
    }

    /**
     * 处理控制台操作
     * 根据操作类型执行对应的视图切换或模态框打开等操作
     * @function handleConsoleAction
     * @param {string} action - 操作类型，可选值:
     *   - 'new-agent': 打开新建Agent模态框
     *   - 'clusters': 切换到集群视图
     *   - 'tasks': 切换到任务视图
     *   - 'usage': 切换到使用量视图
     *   - 'console-home': 打开控制台首页
     *   - 'openclaw-config': 切换OpenClaw配置入口
     *   - 'report-issue': 打开问题追踪器
     *   - 'settings': 打开设置
     * @returns {void}
     */
    function handleConsoleAction(action) {
        switch (action) {
            case 'new-agent':
                // 打开新建Agent的模态框
                openNewAgentModal();
                break;
            case 'clusters':
                // 切换到集群视图
                switchView('clusters');
                break;
            case 'tasks':
                // 切换到任务视图
                switchView('tasks');
                break;
            case 'usage':
                // 切换到使用量视图
                switchView('usage');
                break;
            case 'console-home':
                // 打开控制台首页
                openConsoleHome();
                break;
            case 'openclaw-config':
                // 切换OpenClaw配置入口的显示状态
                toggleOpenClawConfigEntry();
                break;
            case 'report-issue':
                // 向VS Code发送打开问题追踪器的消息
                vscode.postMessage({ type: 'openIssueTracker' });
                break;
            case 'settings':
                // 向VS Code发送打开设置的消息
                vscode.postMessage({ type: 'openSettings' });
                break;
        }
    }

    /**
     * 检查聊天区域是否有内容
     * 用于判断是否需要显示欢迎页面或清空确认等场景
     * @function hasChatContent
     * @returns {boolean} - 如果聊天区域包含消息或加载指示器则返回true
     */
    function hasChatContent() {
        // 检查chatMessages元素中是否存在.message类（消息）或.context-loading类（加载中）的元素
        return Boolean(elements.chatMessages?.querySelector('.message, .context-loading'));
    }
