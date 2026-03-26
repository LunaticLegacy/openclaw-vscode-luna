/**
 * OpenClaw Luna - Panel Core
 * OpenClaw Luna 面板核心模块
 * 
 * 该模块是Webview面板的核心逻辑层，负责：
 * - 全局状态管理（智能体、集群、频道、任务等）
 * - DOM元素缓存和管理
 * - 事件绑定和处理
 * - 国际化(i18n)支持
 * - UI状态持久化
 * - 集群回放管理
 * - 侧边栏和导航控制
 * 
 * 依赖关系：
 * - 依赖VS Code Webview API (acquireVsCodeApi)
 * - 与panel.js配合处理消息
 * - 与panelCommon.js共享工具函数
 */
'use strict';

    // ==================== 常量定义 ====================
    
    /**
     * VS Code Webview API实例
     * 用于与扩展主机进行双向通信
     */
    const vscode = acquireVsCodeApi();
    
    /** 默认网关URL */
    const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18789';
    /** 安装命令 */
    const INSTALL_COMMAND = 'npm install -g openclaw@latest';
    /** 初始化命令 */
    const ONBOARD_COMMAND = 'openclaw onboard --install-daemon';
    /** 启动OpenClaw命令 */
    const START_OPENCLAW_COMMAND = 'openclaw gateway start';
    
    // 智能体相关常量
    /** 自定义智能体预设ID */
    const CUSTOM_AGENT_PRESET_ID = 'custom';
    /** 自定义模型提供者选项值 */
    const CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE = '__custom_agent_provider__';
    /** 直接模型提供者选项值 */
    const DIRECT_AGENT_MODEL_PROVIDER_OPTION_VALUE = '__direct_agent_provider__';
    /** 自定义模型选项值 */
    const CUSTOM_AGENT_MODEL_OPTION_VALUE = '__custom_agent_model__';
    
    // OpenClaw配置相关常量
    /** 自定义认证提供者选项值 */
    const CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE = '__custom__';
    /** 自定义默认模型选项值 */
    const CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE = '__custom__';
    
    // ==================== 全局状态管理 ====================
    
    /**
     * 应用全局状态对象
     * 包含所有UI和数据的当前状态
     * @type {Object}
     */
    let state = {
        // 当前选中的智能体ID
        currentAgentId: null,
        // 聊天子智能体列表
        chatSubagents: [],
        // 聊天命令栏是否折叠
        chatCommandBarCollapsed: false,
        
        // 集群相关状态
        currentClusterId: null,                    // 当前选中的集群ID
        currentClusterTargetKind: 'swarm',         // 当前集群目标类型
        currentClusterAgentId: null,               // 当前集群选中的智能体ID
        currentClusterSwarmMode: 'broadcast',      // 当前Swarm模式
        currentClusterSwarmOutputMode: 'frontend', // 当前Swarm输出模式
        currentClusterSwarmRunSelections: {},      // Swarm运行选择状态
        currentClusterAgentViewMode: 'chat',       // 集群智能体视图模式
        
        // 数据列表
        agents: [],            // 智能体列表
        agentFolders: [],      // 智能体文件夹列表
        agentPresets: [],      // 智能体预设列表
        aiSkills: [],          // AI技能列表
        availableModels: [],   // 可用模型列表
        
        // 新建智能体相关
        newAgentMode: 'custom',                    // 新建智能体模式
        newAgentPresetId: CUSTOM_AGENT_PRESET_ID,  // 新建智能体预设ID
        
        // 集群数据
        clusters: [],                // 集群列表
        serverClusters: [],          // 服务器端集群列表
        clusterReplays: {},          // 集群回放数据
        clusterWorkModePresets: [],  // 集群工作模式预设
        identityPresets: [],         // 身份预设
        clusterConversations: {},    // 集群对话数据
        activeClusterSwarmRuns: {},  // 活跃的Swarm运行
        clusterSwarmRunHistory: {},  // Swarm运行历史
        
        // 任务相关
        tasks: [],                 // 任务列表
        tasksAvailable: true,      // 任务功能是否可用
        tasksLoaded: false,        // 任务是否已加载
        tasksMessage: '',          // 任务加载消息
        tasksSourcePath: '',       // 任务源路径
        
        // 使用率统计
        latestUsage: null,         // 最新使用数据
        usagePeriodDays: 7,        // 统计周期天数
        
        // 频道相关
        channels: [],              // 频道列表
        channelsLoaded: false,     // 频道是否已加载
        currentChannelId: null,    // 当前频道ID
        channelMessages: [],       // 频道消息列表
        channelLoading: false,     // 频道是否加载中
        channelSending: false,     // 频道是否发送中
        channelDraft: null,        // 频道草稿
        
        // 流式输出状态
        isStreaming: false,             // 是否正在流式输出
        currentChannelThinking: null,   // 当前频道思考内容
        currentThinking: null,          // 当前思考内容
        
        // 视图状态
        viewMode: 'chat',          // 当前视图模式
        locale: 'en',              // 当前语言区域
        
        // 运行时状态
        runtime: {
            connected: false,           // 是否已连接
            mode: 'gateway',            // 运行模式
            sourceDescription: '',      // 源描述
            supportsTasks: false,       // 是否支持任务
            supportsLiveSync: false,    // 是否支持实时同步
            capabilities: null,         // 能力列表
            capabilityMatrix: [],       // 能力矩阵
            diagnostics: null,          // 诊断信息
            openClawConfig: null,       // OpenClaw配置
            memoryStatus: null          // 内存状态
        },
        
        // 表单状态
        connectionFormDirty: false,         // 连接表单是否修改
        connectionSettingsStatus: null,     // 连接设置状态
        agentSettingsFormDirty: false,      // 智能体设置表单是否修改
        agentSettingsSaving: false,         // 智能体设置是否保存中
        agentSettingsStatus: null,          // 智能体设置状态
        openClawConfigFormDirty: false,     // OpenClaw配置表单是否修改
        openClawConfigStatus: null,         // OpenClaw配置状态
        batchCreateAgentsSaving: false,     // 批量创建智能体是否保存中
        batchCreateAgentsStatus: null,      // 批量创建智能体状态
        
        // 引导相关
        agentOnboardingAgentId: null,       // 引导中的智能体ID
        agentOnboardingPresetId: '',        // 引导预设ID
        agentOnboardingPrompt: '',          // 引导提示词
        agentOnboardingSaving: false,       // 引导是否保存中
        agentOnboardingStatus: null,        // 引导状态
        
        // UI折叠状态
        chatHomePinned: false,              // 聊天首页是否固定
        forceSetupPanel: false,             // 是否强制显示设置面板
        installGuideStatus: null,           // 安装引导状态
        installGuideBusy: false,            // 安装引导是否忙碌
        agentMutation: null,                // 智能体变更状态
        mainSidebarCollapsed: false,        // 主侧边栏是否折叠
        clusterTopSectionCollapsed: false,  // 集群顶部区域是否折叠
        clusterTopologyCollapsed: false,    // 集群拓扑图是否折叠
        
        // 技能市场筛选
        skillMarketFilters: {
            query: '',          // 搜索关键词
            category: 'all',    // 分类筛选
            tags: [],           // 标签筛选
            sortBy: 'popular',  // 排序方式
            hubId: 'all'        // Hub筛选
        },
        skillMarketTab: 'market',   // 技能市场当前标签
        skillMarketData: null,      // 技能市场数据
        skillMarketLoading: false   // 技能市场是否加载中
    };
    
    // ==================== 临时状态变量 ====================
    
    /** 当前活跃的Trace容器（用于AI思考过程展示） */
    let activeTraceContainer = null;
    /** 当前频道活跃的Trace容器 */
    let activeChannelTraceContainer = null;
    /** 是否正在批量渲染聊天消息（用于优化性能） */
    let isBulkRenderingChat = false;
    /** 是否正在批量渲染频道消息 */
    let isBulkRenderingChannel = false;
    /** 待处理的流式渲染任务 */
    let pendingStreamingRender = null;
    /** 流式渲染动画帧ID */
    let streamRenderFrame = null;
    /** 智能体变更提示定时器 */
    let agentMutationTimer = null;
    /** 技能市场刷新定时器（防抖用） */
    let skillMarketRefreshTimer = null;
    /** 已渲染的聊天消息ID集合（防止重复渲染） */
    const renderedChatMessageIds = new Set();
    /** 已渲染的频道消息ID集合 */
    const renderedChannelMessageIds = new Set();
    /** 集群最大讨论轮数 */
    const MAX_CLUSTER_ROUNDS = 12;

    // ==================== DOM元素缓存 ====================
    
    /**
     * DOM元素缓存对象
     * 在init()时通过cacheElements()填充，避免频繁查询DOM
     * @type {Object.<string, HTMLElement>}
     */
    const elements = {};

    // ==================== 本地化回退文本 ====================
    
    /**
     * 本地化回退文本表
     * 当i18n系统不可用时使用这些硬编码的中文翻译
     * @type {Object.<string, Object.<string, string>>}
     */
    const LOCAL_I18N_FALLBACKS = {
        'zh-cn': {
            // 侧边栏
            'sidebar.newFolder': '新建文件夹',
            'sidebar.newFolderPrompt': '输入文件夹名称',
            'sidebar.renameFolderPrompt': '重命名文件夹',
            'sidebar.deleteFolderConfirm': '确定删除文件夹"{name}"吗？其中的智能体会回到未分组。',
            'sidebar.folderEmpty': '把智能体拖到这里',
            'sidebar.ungrouped': '未分组',
            'sidebar.ungroupedHint': '把智能体拖到这里以移出文件夹',
            'sidebar.removeFromFolder': '移出文件夹',
            
            // 集群
            'clusters.updated': '集群"{name}"已更新',
            'clusters.editTitle': '编辑 {name}',
            'clusters.validationName': '请填写集群名称。',
            'clusters.validationAgents': '请至少为集群选择一个智能体。',
            'clusters.form.name': '集群名称',
            'clusters.form.preset': '工作模式预设',
            'clusters.form.collaborationStyle': '协作样式',
            'clusters.form.deliveryStyle': '输出深度',
            'clusters.form.critiqueLevel': '审视强度',
            'clusters.form.rounds': '讨论轮次',
            'clusters.form.briefing': '集群简报',
            'clusters.form.briefingPlaceholder': '补充这个集群应该以什么方式工作。',
            'clusters.form.members': '集群成员',
            'clusters.form.membersHint': '选择这个集群需要包含的智能体。',
            'clusters.style.debate': '辩论',
            'clusters.style.roundRobin': '轮转并行',
            'clusters.style.reviewBoard': '评审委员会',
            'clusters.style.leaderDraft': '主导草案',
            'clusters.delivery.fast': '快速',
            'clusters.delivery.balanced': '平衡',
            'clusters.delivery.deep': '深入',
            'clusters.critique.minimal': '轻度',
            'clusters.critique.standard': '标准',
            'clusters.critique.aggressive': '高压',
            'clusters.rounds.value': '{count} 轮',
            'clusters.debateRoundCritiqueDynamic': '第 {round} 轮评审',
            'clusters.debateRoundRevisionDynamic': '第 {round} 轮修订',
            
            // 集群预设
            'clusters.preset.implementation-squad.label': '实施小队',
            'clusters.preset.implementation-squad.description': '面向交付，将请求收束为实施方案、代码变更和验证步骤。',
            'clusters.preset.rapid-brainstorm.label': '快速头脑风暴',
            'clusters.preset.rapid-brainstorm.description': '适合快速并行出方案、分支思路和低成本探索。',
            'clusters.preset.architecture-review.label': '架构评审',
            'clusters.preset.architecture-review.description': '强调边界、迁移风险、可维护性和长期权衡。',
            'clusters.preset.debug-war-room.label': '故障作战室',
            'clusters.preset.debug-war-room.description': '把重点锁定在复现路径、最强信号和最小安全修复。',
            'clusters.preset.red-team-audit.label': '红队审计',
            'clusters.preset.red-team-audit.description': '高压审视失效方式、滥用路径、隐藏假设和边界情况。',
            'clusters.preset.research-synthesis.label': '研究汇总',
            'clusters.preset.research-synthesis.description': '收集不同观点、保留不确定性，并将结论汇总成可辩护输出。',
            'clusters.preset.spec-to-build.label': '从规格到交付',
            'clusters.preset.spec-to-build.description': '从需求向 API 形状、任务切分、发布计划和交付顺序收束。',
            'clusters.preset.qa-regression.label': '回归保障',
            'clusters.preset.qa-regression.description': '重点关注用户可感知回归、缺失测试、脆弱状态流转和发布风险。'
        }
    };

    // ==================== 国际化函数 ====================

    /**
     * 翻译函数
     * 根据键值获取对应的本地化文本，支持变量替换
     * 
     * @param {string} key - 翻译键值
     * @param {Object.<string, string>} [vars] - 变量替换映射
     * @returns {string} 翻译后的文本
     * @example
     * t('clusters.rounds.value', { count: 5 }) // 返回: '5 轮' 或 '5 rounds'
     */
    function t(key, vars) {
        // 首先尝试使用i18n系统
        const translated = window.OpenClawI18n ? window.OpenClawI18n.t(key, vars) : key;
        if (translated !== key) {
            return translated;
        }

        // 回退到本地翻译表
        const localeFallbacks = LOCAL_I18N_FALLBACKS[state.locale] || {};
        let fallback = localeFallbacks[key] || key;
        
        // 替换变量占位符 {varName}
        Object.keys(vars || {}).forEach(name => {
            fallback = fallback.replace(new RegExp(`{${name}}`, 'g'), vars[name]);
        });
        return fallback;
    }

    // ==================== 初始化函数 ====================

    /**
     * 初始化应用
     * 执行完整的初始化流程：缓存元素、恢复状态、绑定事件、加载配置
     */
    function init() {
        cacheElements();      // 缓存DOM元素引用
        hydrateUiState();     // 恢复保存的UI状态
        bindEvents();         // 绑定事件处理器
        
        // 从DOM获取语言设置
        const locale = document.body?.dataset.locale;
        if (locale) {
            state.locale = locale;
        }

        // 从DOM获取并解析翻译数据
        const encodedTranslations = document.body?.dataset.translations;
        if (encodedTranslations && window.OpenClawI18n) {
            try {
                const translations = JSON.parse(decodeBase64Utf8(encodedTranslations));
                window.OpenClawI18n.setTranslations(translations, state.locale);
            } catch (error) {
                console.error('Failed to initialize OpenClaw translations.', error);
            }
        }
        
        // 更新UI文本和侧边栏状态
        updateUIText();
        applySidebarState();
        
        // 通知VS Code Webview已就绪
        vscode.postMessage({ type: 'webviewReady' });
    }

    /**
     * 恢复UI状态
     * 从VS Code状态存储中读取之前保存的UI折叠状态
     */
    function hydrateUiState() {
        const savedState = vscode.getState ? (vscode.getState() || {}) : {};
        state.mainSidebarCollapsed = Boolean(savedState.mainSidebarCollapsed);
        state.clusterTopSectionCollapsed = Boolean(savedState.clusterTopSectionCollapsed);
        state.clusterTopologyCollapsed = Boolean(savedState.clusterTopologyCollapsed);
        state.chatCommandBarCollapsed = Boolean(savedState.chatCommandBarCollapsed);
    }

    /**
     * 持久化UI状态
     * 将当前的UI折叠状态保存到VS Code状态存储
     */
    function persistUiState() {
        if (!vscode.setState) {
            return;
        }

        vscode.setState({
            mainSidebarCollapsed: state.mainSidebarCollapsed,
            clusterTopSectionCollapsed: state.clusterTopSectionCollapsed,
            clusterTopologyCollapsed: state.clusterTopologyCollapsed,
            chatCommandBarCollapsed: state.chatCommandBarCollapsed
        });
    }

    // ==================== 集群回放管理 ====================

    /**
     * 构建回放集群ID
     * 生成唯一的回放集群标识符
     * 
     * @param {string} clusterId - 原始集群ID
     * @param {string} mode - 回放模式
     * @param {string} importedAt - 导入时间
     * @returns {string} 回放集群ID
     */
    function buildReplayClusterId(clusterId, mode, importedAt) {
        return `replay:${clusterId || 'cluster'}:${mode || 'broadcast'}:${importedAt || Date.now()}`;
    }

    /**
     * 获取集群回放数据
     * 
     * @param {string|Object} clusterOrId - 集群对象或集群ID
     * @returns {Object|null} 回放数据对象
     */
    function getClusterReplay(clusterOrId) {
        const clusterId = typeof clusterOrId === 'string'
            ? clusterOrId
            : clusterOrId?.id;
        return clusterId ? (state.clusterReplays?.[clusterId] || null) : null;
    }

    /**
     * 检查是否为回放集群
     * 
     * @param {string|Object} clusterOrId - 集群对象或集群ID
     * @returns {boolean} 是否为回放集群
     */
    function isReplayCluster(clusterOrId) {
        return Boolean(getClusterReplay(clusterOrId));
    }

    /**
     * 获取合并后的集群列表
     * 合并服务器端集群和本地回放集群
     * 
     * @param {Array} [serverClusters=state.serverClusters] - 服务器端集群列表
     * @returns {Array} 合并后的集群列表
     */
    function getMergedClusterList(serverClusters = state.serverClusters) {
        const liveClusters = Array.isArray(serverClusters) ? serverClusters : [];
        const replayClusters = Object.values(state.clusterReplays || {})
            .map(item => item.cluster)
            .filter(Boolean);
        return [...liveClusters, ...replayClusters];
    }

    /**
     * 清除回放集群
     * 删除指定集群的回放数据及其相关对话历史
     * 
     * @param {string} clusterId - 要清除的集群ID
     */
    function clearReplayCluster(clusterId) {
        if (!clusterId || !state.clusterReplays?.[clusterId]) {
            return;
        }

        // 删除回放数据
        delete state.clusterReplays[clusterId];
        
        // 清理关联的对话数据
        Object.keys(state.clusterConversations || {}).forEach(key => {
            if (key.startsWith(`cluster:${clusterId}:`)) {
                delete state.clusterConversations[key];
            }
        });
        
        // 清理活跃的Swarm运行
        Object.keys(state.activeClusterSwarmRuns || {}).forEach(key => {
            if (key.startsWith(`cluster:${clusterId}:swarm:`)) {
                delete state.activeClusterSwarmRuns[key];
            }
        });
        
        // 清理Swarm运行历史
        Object.keys(state.clusterSwarmRunHistory || {}).forEach(key => {
            if (key.startsWith(`cluster:${clusterId}:swarm:`)) {
                delete state.clusterSwarmRunHistory[key];
            }
        });
        
        // 清理选择状态
        Object.keys(state.currentClusterSwarmRunSelections || {}).forEach(key => {
            if (key.startsWith(`cluster:${clusterId}:swarm:`)) {
                delete state.currentClusterSwarmRunSelections[key];
            }
        });

        // 如果当前选中的集群被清除，重置选择
        if (state.currentClusterId === clusterId) {
            state.currentClusterId = null;
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
        }

        renderClusters(state.serverClusters || []);
    }

    /**
     * 加载集群回放数据
     * 导入回放数据并创建回放集群实例
     * 
     * @param {Object} replay - 回放数据对象
     * @param {Object} replay.cluster - 集群数据
     * @param {Array} replay.messages - 消息列表
     * @param {string} replay.mode - 回放模式
     * @param {string} replay.sourcePath - 源文件路径
     * @param {string} replay.importedAt - 导入时间
     * @param {string} replay.exportedAt - 导出时间
     */
    function loadClusterReplay(replay) {
        if (!replay?.cluster?.id) {
            return;
        }

        // 标准化导入时间
        const importedAt = typeof replay.importedAt === 'string' && replay.importedAt.trim()
            ? replay.importedAt
            : new Date().toISOString();
        
        const mode = replay.mode === 'collaborate' ? 'collaborate' : 'broadcast';
        const replayClusterId = buildReplayClusterId(replay.cluster.id, mode, importedAt);
        
        // 创建回放集群对象
        const replayCluster = {
            ...replay.cluster,
            id: replayClusterId,
            name: `${replay.cluster.name} · Replay`,  // 添加回放标记
            replayMeta: {
                sourcePath: replay.sourcePath || '',
                importedAt,
                exportedAt: replay.exportedAt || '',
                mode,
                messageCount: Number(replay.messageCount) || (Array.isArray(replay.messages) ? replay.messages.length : 0),
                originalClusterId: replay.cluster.id
            }
        };

        // 存储回放数据
        state.clusterReplays[replayClusterId] = {
            cluster: replayCluster,
            mode,
            messages: Array.isArray(replay.messages) ? replay.messages : []
        };

        // 确保对话容器存在并填充消息
        const conversation = ensureClusterConversation(getClusterConversationKey(replayClusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.messages = Array.isArray(replay.messages) ? replay.messages : [];
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;

        // 更新当前选中状态
        state.currentClusterId = replayClusterId;
        state.currentClusterTargetKind = 'swarm';
        state.currentClusterAgentId = null;
        state.currentClusterSwarmMode = mode;

        renderClusters(state.serverClusters || []);
    }

    // ==================== 侧边栏控制 ====================

    /**
     * 切换主侧边栏展开/折叠状态
     */
    function toggleMainSidebar() {
        state.mainSidebarCollapsed = !state.mainSidebarCollapsed;
        applySidebarState();
        persistUiState();
    }

    /**
     * 切换集群拓扑图展开/折叠状态
     */
    function toggleClusterTopology() {
        state.clusterTopologyCollapsed = !state.clusterTopologyCollapsed;
        renderClusterWorkspace();
        persistUiState();
    }

    /**
     * 切换集群顶部区域展开/折叠状态
     */
    function toggleClusterTopSection() {
        state.clusterTopSectionCollapsed = !state.clusterTopSectionCollapsed;
        renderClusterWorkspace();
        persistUiState();
    }

    /**
     * 应用侧边栏状态到DOM
     * 根据state中的折叠状态更新UI
     */
    function applySidebarState() {
        elements.mainSidebar?.classList.toggle('collapsed', state.mainSidebarCollapsed);

        // 更新切换按钮图标和提示
        if (elements.btnToggleMainSidebar) {
            elements.btnToggleMainSidebar.innerHTML = state.mainSidebarCollapsed ? '&#9654;' : '&#9664;';
            elements.btnToggleMainSidebar.title = state.mainSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
        }
    }

    // ==================== 工具函数 ====================

    /**
     * Base64 UTF-8解码
     * 将Base64编码的字符串解码为普通UTF-8字符串
     * 
     * @param {string} value - Base64编码的字符串
     * @returns {string} 解码后的UTF-8字符串
     */
    function decodeBase64Utf8(value) {
        // Base64解码为二进制字符串
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));

        // 使用TextDecoder如果可用（现代浏览器）
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(bytes);
        }

        // 回退方案：手动解码（兼容旧浏览器）
        let result = '';
        bytes.forEach(byte => {
            result += String.fromCharCode(byte);
        });
        return decodeURIComponent(escape(result));
    }
    // ==================== DOM元素缓存 ====================

    /**
     * 缓存所有DOM元素引用
     * 在初始化时调用一次，将所有常用的DOM元素缓存到elements对象中
     * 避免后续频繁调用document.getElementById带来的性能开销
     */
    function cacheElements() {
        // 主布局和侧边栏
        elements.mainSidebar = document.getElementById('main-sidebar');
        elements.btnToggleMainSidebar = document.getElementById('btn-toggle-main-sidebar');
        elements.agentList = document.getElementById('agent-list');
        
        // 智能体管理按钮
        elements.btnNewAgentFolder = document.getElementById('btn-new-agent-folder');
        elements.btnBatchDeleteAgents = document.getElementById('btn-batch-delete-agents');
        
        // 聊天主区域
        elements.chatHome = document.getElementById('chat-home');
        elements.chatConsoleHomeContent = document.getElementById('chat-console-home-content');
        
        // 智能体引导面板
        elements.agentOnboardingPanel = document.getElementById('agent-onboarding-panel');
        elements.agentOnboardingAgentName = document.getElementById('agent-onboarding-agent-name');
        elements.agentOnboardingAgentModel = document.getElementById('agent-onboarding-agent-model');
        elements.agentOnboardingPresetGrid = document.getElementById('agent-onboarding-preset-grid');
        elements.agentOnboardingPresetSummary = document.getElementById('agent-onboarding-preset-summary');
        elements.agentOnboardingPrompt = document.getElementById('agent-onboarding-prompt');
        elements.agentOnboardingStatus = document.getElementById('agent-onboarding-status');
        elements.btnSaveAgentOnboarding = document.getElementById('btn-save-agent-onboarding');
        elements.btnOpenAgentOnboardingSettings = document.getElementById('btn-open-agent-onboarding-settings');
        
        // 集群侧边栏
        elements.clusterSidebarList = document.getElementById('cluster-sidebar-list');
        
        // 聊天消息区域
        elements.chatMessages = document.getElementById('chat-messages');
        elements.chatCommandBar = document.getElementById('chat-command-bar');
        elements.btnToggleChatCommandBar = document.getElementById('btn-toggle-chat-command-bar');
        elements.chatCommandBarBody = document.getElementById('chat-command-bar-body');
        elements.chatCommandBarToggleIcon = document.getElementById('chat-command-bar-toggle-icon');
        elements.chatCommandBarSummary = document.getElementById('chat-command-bar-summary');
        elements.chatSubagentSelect = document.getElementById('chat-subagent-select');
        elements.chatSubagentsCount = document.getElementById('chat-subagents-count');
        elements.btnChatInsertSubagentCommand = document.getElementById('btn-chat-insert-subagent-command');
        elements.chatOpenClawCommandInput = document.getElementById('chat-openclaw-command-input');
        elements.btnChatInsertOpenClawCommand = document.getElementById('btn-chat-insert-openclaw-command');
        elements.chatOpenClawCommandTree = document.getElementById('chat-openclaw-command-tree');
        
        // 消息输入和发送
        elements.messageInput = document.getElementById('message-input');
        elements.btnSend = document.getElementById('btn-send');
        elements.btnClear = document.getElementById('btn-clear');
        elements.btnStop = document.getElementById('btn-stop');
        
        // 连接状态显示
        elements.connectionStatus = document.getElementById('connection-status');
        elements.connectionLabel = document.getElementById('connection-label');
        elements.connectionCaption = document.getElementById('connection-caption');
        elements.connectionPill = document.getElementById('connection-pill');
        
        // 控制台概览
        elements.consoleSummary = document.getElementById('console-summary');
        elements.consoleConnectionValue = document.getElementById('console-connection-value');
        elements.consoleConnectionMeta = document.getElementById('console-connection-meta');
        elements.consoleModeValue = document.getElementById('console-mode-value');
        elements.consoleModeMeta = document.getElementById('console-mode-meta');
        elements.consoleAgentsValue = document.getElementById('console-agents-value');
        elements.consoleAgentsMeta = document.getElementById('console-agents-meta');
        elements.consoleTasksValue = document.getElementById('console-tasks-value');
        elements.consoleTasksMeta = document.getElementById('console-tasks-meta');
        elements.consoleCapabilityTitle = document.getElementById('console-capability-title');
        elements.consoleCapabilityBody = document.getElementById('console-capability-body');
        elements.consoleCapabilityMatrix = document.getElementById('console-capability-matrix');
        elements.consoleSetupPanel = document.getElementById('console-setup-panel');
        elements.consoleNextSteps = document.getElementById('console-next-steps');
        elements.consoleActionButtons = document.querySelectorAll('[data-console-action]');
        
        // 功能入口按钮
        elements.btnOpenSkillMarket = document.getElementById('btn-open-skill-market');
        elements.btnOpenClawConfigEntry = document.getElementById('btn-openclaw-config-entry');
        
        // 连接设置表单
        elements.formConnectionSettings = document.getElementById('form-connection-settings');
        elements.connectionConfigMode = document.getElementById('connection-config-mode');
        elements.connectionGatewayUrl = document.getElementById('connection-gateway-url');
        elements.connectionGatewayToken = document.getElementById('connection-gateway-token');
        elements.connectionSettingsHint = document.getElementById('connection-settings-hint');
        elements.connectionSettingsStatus = document.getElementById('connection-settings-status');
        elements.btnRetryConnection = document.getElementById('btn-retry-connection');
        elements.btnUseDetectedGateway = document.getElementById('btn-use-detected-gateway');
        elements.exportRuntimeLogButtons = document.querySelectorAll('[data-export-runtime-logs]');
        
        // OpenClaw配置面板
        elements.consoleOpenClawConfigPanel = document.getElementById('console-openclaw-config-panel');
        elements.formOpenClawConfig = document.getElementById('form-openclaw-config');
        elements.openclawStateDir = document.getElementById('openclaw-state-dir');
        elements.openclawConfigPath = document.getElementById('openclaw-config-path');
        elements.openclawAuthProfilesPath = document.getElementById('openclaw-auth-profiles-path');
        elements.openclawGatewayPort = document.getElementById('openclaw-gateway-port');
        elements.openclawGatewayToken = document.getElementById('openclaw-gateway-token');
        elements.openclawDefaultWorkspace = document.getElementById('openclaw-default-workspace');
        elements.openclawDefaultModel = document.getElementById('openclaw-default-model-select');
        elements.openclawDefaultModelCustom = document.getElementById('openclaw-default-model-custom');
        elements.openclawAuthProvider = document.getElementById('openclaw-auth-provider-select');
        elements.openclawAuthProviderCustom = document.getElementById('openclaw-auth-provider-custom');
        elements.openclawAuthApiKey = document.getElementById('openclaw-auth-api-key');
        elements.secretRevealButtons = document.querySelectorAll('[data-press-reveal]');
        elements.openclawConfigHint = document.getElementById('openclaw-config-hint');
        elements.openclawConfigStatus = document.getElementById('openclaw-config-status');
        elements.btnRefreshOpenclawConfig = document.getElementById('btn-refresh-openclaw-config');
        
        // 内存状态
        elements.memoryStatus = document.getElementById('memory-status');
        elements.memoryStatusBackend = document.getElementById('memory-status-backend');
        elements.memoryStatusRoot = document.getElementById('memory-status-root');
        elements.memoryStatusSync = document.getElementById('memory-status-sync');
        elements.memoryStatusEvent = document.getElementById('memory-status-event');
        elements.memoryStatusError = document.getElementById('memory-status-error');
        elements.memoryStatusErrorValue = document.getElementById('memory-status-error-value');
        elements.btnRefreshMemoryStatus = document.getElementById('btn-refresh-memory-status');
        elements.btnOpenMemoryRoot = document.getElementById('btn-open-memory-root');
        elements.btnExportMemory = document.getElementById('btn-export-memory');
        elements.btnImportMemory = document.getElementById('btn-import-memory');
        
        // 安装引导
        elements.consoleInstallGuide = document.getElementById('console-install-guide');
        elements.installGuideTitle = document.getElementById('install-guide-title');
        elements.installGuideSummary = document.getElementById('install-guide-summary');
        elements.installGuideState = document.getElementById('install-guide-state');
        elements.installCommandBlock = document.getElementById('install-command-block');
        elements.installCommand = document.getElementById('install-command');
        elements.onboardCommandBlock = document.getElementById('onboard-command-block');
        elements.onboardCommand = document.getElementById('onboard-command');
        elements.startCommandBlock = document.getElementById('start-command-block');
        elements.startCommand = document.getElementById('start-command');
        elements.installGuideStatus = document.getElementById('install-guide-status');
        elements.installGuideFootnote = document.getElementById('install-guide-footnote');
        elements.btnStartOpenClaw = document.getElementById('btn-start-openclaw');
        elements.copyCommandButtons = document.querySelectorAll('[data-copy-command]');
        
        // 集群工作区
        elements.clusterEmptyState = document.getElementById('clusters-empty-state');
        elements.clusterWorkspace = document.getElementById('cluster-workspace');
        elements.clusterTopSection = document.getElementById('cluster-top-section');
        elements.clusterTopSectionCollapsedBar = document.getElementById('cluster-top-section-collapsed-bar');
        elements.clusterTopSectionBody = document.getElementById('cluster-top-section-body');
        elements.clusterTopSectionCollapsedTitle = document.getElementById('cluster-top-section-collapsed-title');
        elements.clusterTopSectionCollapsedMode = document.getElementById('cluster-top-section-collapsed-mode');
        elements.clusterTopSectionCollapsedCount = document.getElementById('cluster-top-section-collapsed-count');
        elements.clusterTopSectionCollapsedStatus = document.getElementById('cluster-top-section-collapsed-status');
        elements.btnToggleClusterTopSection = document.getElementById('btn-toggle-cluster-top-section');
        elements.btnToggleClusterTopSectionCollapsed = document.getElementById('btn-toggle-cluster-top-section-collapsed');
        elements.clusterTitle = document.getElementById('cluster-title');
        elements.clusterBriefing = document.getElementById('cluster-briefing');
        elements.clusterSubtitle = document.getElementById('cluster-subtitle');
        elements.clusterReplayBanner = document.getElementById('cluster-replay-banner');
        elements.clusterWorkmodeSummary = document.getElementById('cluster-workmode-summary');
        elements.clusterTargetTabs = document.getElementById('cluster-target-tabs');
        elements.clusterModeTabs = document.getElementById('cluster-mode-tabs');
        elements.clusterOutputModeTabs = document.getElementById('cluster-output-mode-tabs');
        elements.clusterTopology = document.getElementById('cluster-topology');
        elements.clusterMessages = document.getElementById('cluster-messages');
        elements.clusterMessageInput = document.getElementById('cluster-message-input');
        elements.clusterTargetHint = document.getElementById('cluster-target-hint');
        elements.btnSendCluster = document.getElementById('btn-send-cluster');
        elements.btnStopCluster = document.getElementById('btn-stop-cluster');
        
        // 集群操作按钮
        elements.btnExportClusterReadableContext = document.getElementById('btn-export-cluster-readable-context');
        elements.btnExportClusterRawContext = document.getElementById('btn-export-cluster-raw-context');
        elements.btnExportClusterSwarm = document.getElementById('btn-export-cluster-swarm');
        elements.btnImportClusterSwarm = document.getElementById('btn-import-cluster-swarm');
        elements.btnImportClusterReplay = document.getElementById('btn-import-cluster-replay');
        elements.btnImportClusterReplayEmpty = document.getElementById('btn-import-cluster-replay-empty');
        elements.btnClearClusterReplay = document.getElementById('btn-clear-cluster-replay');
        elements.btnEditCluster = document.getElementById('btn-edit-cluster');
        
        // 工具栏按钮
        elements.btnNewAgent = document.getElementById('btn-new-agent');
        elements.btnRefreshAgents = document.getElementById('btn-refresh-agents');
        elements.btnNewCluster = document.getElementById('btn-new-cluster');
        
        // 新建智能体模态框
        elements.modalNewAgent = document.getElementById('modal-new-agent');
        elements.formNewAgent = document.getElementById('form-new-agent');
        elements.newAgentModeButtons = document.querySelectorAll('[data-new-agent-mode]');
        elements.newAgentPresetPanel = document.getElementById('new-agent-preset-panel');
        elements.newAgentPresetGrid = document.getElementById('new-agent-preset-grid');
        elements.newAgentPresetDescription = document.getElementById('new-agent-preset-description');
        elements.newAgentSingleFields = document.getElementById('new-agent-single-fields');
        elements.newAgentBatchPanel = document.getElementById('new-agent-batch-panel');
        elements.newAgentName = document.getElementById('new-agent-name');
        elements.newAgentModelProvider = document.getElementById('new-agent-model-provider');
        elements.newAgentModelProviderCustom = document.getElementById('new-agent-model-provider-custom');
        elements.newAgentModel = document.getElementById('new-agent-model');
        elements.newAgentModelCustom = document.getElementById('new-agent-model-custom');
        elements.newAgentPrompt = document.getElementById('new-agent-prompt');
        elements.batchAgentNames = document.getElementById('batch-agent-names');
        elements.batchAgentModelProvider = document.getElementById('batch-agent-model-provider');
        elements.batchAgentModelProviderCustom = document.getElementById('batch-agent-model-provider-custom');
        elements.batchAgentModel = document.getElementById('batch-agent-model');
        elements.batchAgentModelCustom = document.getElementById('batch-agent-model-custom');
        elements.batchAgentPrompt = document.getElementById('batch-agent-prompt');
        elements.batchAgentFormStatus = document.getElementById('batch-agent-form-status');
        
        // 导航和视图
        elements.navTabs = document.querySelectorAll('.nav-tab');
        elements.views = document.querySelectorAll('.view');
        elements.tokenCount = document.getElementById('token-count');
        
        // 任务列表
        elements.tasksList = document.getElementById('tasks-list');
        elements.tasksSource = document.getElementById('tasks-source');
        
        // 集群创建和管理按钮
        elements.btnCreateCluster = document.getElementById('btn-create-cluster');
        elements.btnCreateClusterToolbar = document.getElementById('btn-create-cluster-toolbar');
        elements.btnAddClusterAgent = document.getElementById('btn-add-cluster-agent');
        elements.btnRemoveClusterAgent = document.getElementById('btn-remove-cluster-agent');
        elements.btnDeleteCurrentCluster = document.getElementById('btn-delete-current-cluster');
        
        // 集群编辑器模态框
        elements.modalClusterEditor = document.getElementById('modal-cluster-editor');
        elements.formClusterEditor = document.getElementById('form-cluster-editor');
        elements.clusterModalTitle = document.getElementById('cluster-modal-title');
        elements.clusterEditorId = document.getElementById('cluster-editor-id');
        elements.clusterEditorName = document.getElementById('cluster-editor-name');
        elements.clusterEditorPreset = document.getElementById('cluster-editor-preset');
        elements.clusterEditorStyle = document.getElementById('cluster-editor-style');
        elements.clusterEditorDelivery = document.getElementById('cluster-editor-delivery');
        elements.clusterEditorCritique = document.getElementById('cluster-editor-critique');
        elements.clusterEditorRounds = document.getElementById('cluster-editor-rounds');
        elements.clusterEditorRoundsUnlimited = document.getElementById('cluster-editor-rounds-unlimited');
        elements.clusterEditorStopConditionGroup = document.getElementById('cluster-editor-stop-condition-group');
        elements.clusterEditorStopCondition = document.getElementById('cluster-editor-stop-condition');
        elements.clusterEditorBriefing = document.getElementById('cluster-editor-briefing');
        elements.clusterEditorCoordinatorAgent = document.getElementById('cluster-editor-coordinator-agent');
        elements.clusterPresetSummary = document.getElementById('cluster-preset-summary');
        elements.clusterEditorAgentPicker = document.getElementById('cluster-editor-agent-picker');
        elements.clusterEditorMemberProfiles = document.getElementById('cluster-editor-member-profiles');
        elements.clusterBatchAgentNames = document.getElementById('cluster-batch-agent-names');
        elements.clusterBatchAgentModelProvider = document.getElementById('cluster-batch-agent-model-provider');
        elements.clusterBatchAgentModelProviderCustom = document.getElementById('cluster-batch-agent-model-provider-custom');
        elements.clusterBatchAgentModel = document.getElementById('cluster-batch-agent-model');
        elements.clusterBatchAgentModelCustom = document.getElementById('cluster-batch-agent-model-custom');
        elements.clusterBatchAgentPrompt = document.getElementById('cluster-batch-agent-prompt');
        
        // 任务和统计按钮
        elements.btnCreateTask = document.getElementById('btn-create-task');
        elements.btnRefreshUsage = document.getElementById('btn-refresh-usage');
        elements.btnUsagePeriod7 = document.getElementById('btn-usage-period-7');
        elements.btnUsagePeriod30 = document.getElementById('btn-usage-period-30');
        elements.usagePeriodButtons = document.querySelectorAll('[data-usage-period]');
        elements.usagePeriodCaption = document.getElementById('usage-period-caption');
        elements.usageChartTitle = document.getElementById('usage-chart-title');
        elements.modelChartTitle = document.getElementById('model-chart-title');
        
        // 频道相关
        elements.channelSidebar = document.getElementById('channel-sidebar');
        elements.btnRefreshChannel = document.getElementById('btn-refresh-channel');
        elements.btnRefreshChannelMessages = document.getElementById('btn-refresh-channel-messages');
        elements.btnNewChannel = document.getElementById('btn-new-channel');
        elements.btnNewChannelEmpty = document.getElementById('btn-new-channel-empty');
        elements.btnDeleteChannel = document.getElementById('btn-delete-channel');
        elements.channelList = document.getElementById('channel-list');
        elements.channelEmptyState = document.getElementById('channel-empty-state');
        elements.channelWorkspace = document.getElementById('channel-workspace');
        elements.channelChatShell = document.getElementById('channel-chat-shell');
        elements.formChannelConfig = document.getElementById('form-channel-config');
        elements.channelEditorTitle = document.getElementById('channel-editor-title');
        elements.channelEditorSummary = document.getElementById('channel-editor-summary');
        elements.channelName = document.getElementById('channel-name');
        elements.channelAgentId = document.getElementById('channel-agent-id');
        elements.channelDescription = document.getElementById('channel-description');
        elements.channelChatTitle = document.getElementById('channel-chat-title');
        elements.channelChatSubtitle = document.getElementById('channel-chat-subtitle');
        elements.channelChatHint = document.getElementById('channel-chat-hint');
        elements.channelMessages = document.getElementById('channel-messages');
        elements.channelMessageInput = document.getElementById('channel-message-input');
        elements.btnSendChannel = document.getElementById('btn-send-channel');
        elements.btnStopChannel = document.getElementById('btn-stop-channel');
        
        // 智能体设置模态框
        elements.modalAgentSettings = document.getElementById('modal-agent-settings');
        elements.modalSkillMarket = document.getElementById('modal-skill-market');
        elements.formAgentSettings = document.getElementById('form-agent-settings');
        elements.settingsAgentFormStatus = document.getElementById('settings-agent-form-status');
        elements.settingsAgentModelProvider = document.getElementById('settings-agent-model-provider');
        elements.settingsAgentModelProviderCustom = document.getElementById('settings-agent-model-provider-custom');
        elements.settingsAgentModel = document.getElementById('settings-agent-model');
        elements.settingsAgentModelCustom = document.getElementById('settings-agent-model-custom');
        elements.agentSkillsPicker = document.getElementById('settings-agent-skills');
        elements.agentSkillsHint = document.getElementById('settings-agent-skills-hint');
        elements.agentSkillLinks = document.getElementById('settings-agent-skill-links');
        
        // 技能市场
        elements.skillMarketSubtitle = document.getElementById('skill-market-subtitle');
        elements.skillMarketTabs = document.getElementById('skill-market-tabs');
        elements.skillMarketGrid = document.getElementById('skill-market-grid');
        elements.skillMarketContent = document.getElementById('skill-market-content');
        elements.skillMarketSearchInput = document.getElementById('skill-market-search-input');
        elements.skillMarketSearchClear = document.getElementById('skill-market-search-clear');
        elements.skillMarketSort = document.getElementById('skill-market-sort');
        elements.skillMarketCategories = document.getElementById('skill-market-categories');
        elements.skillMarketTags = document.getElementById('skill-market-tags');
        elements.skillMarketHubs = document.getElementById('skill-market-hubs');
        elements.skillMarketStats = document.getElementById('skill-market-stats');
        elements.skillMarketStatus = document.getElementById('skill-market-status');
        elements.skillMarketEmpty = document.getElementById('skill-market-empty');
        elements.skillMarketLoading = document.getElementById('skill-market-loading');
        elements.btnRefreshSkills = document.getElementById('btn-refresh-skills');
        elements.btnCreateCustomSkill = document.getElementById('btn-create-custom-skill');
        
        // 任务模态框
        elements.modalTask = document.getElementById('modal-task');
        elements.formTask = document.getElementById('form-task');
    }

    // ==================== 技能市场刷新控制 ====================

    /**
     * 调度技能市场刷新（防抖）
     * 使用350ms的防抖延迟，避免频繁筛选时重复刷新
     */
    function scheduleSkillMarketRefresh() {
        if (skillMarketRefreshTimer) {
            clearTimeout(skillMarketRefreshTimer);
        }
        skillMarketRefreshTimer = setTimeout(() => {
            skillMarketRefreshTimer = null;
            if (typeof refreshSkillMarket === 'function') {
                refreshSkillMarket();
            }
        }, 350);
    }

    // ==================== 事件绑定 ====================

    /**
     * 绑定所有事件处理器
     * 集中管理所有DOM事件监听器的注册
     */
    function bindEvents() {
        // 主侧边栏切换
        elements.btnToggleMainSidebar?.addEventListener('click', toggleMainSidebar);

        // 导航标签切换
        elements.navTabs.forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        // 发送消息相关
        elements.btnSend?.addEventListener('click', sendMessage);
        elements.btnToggleChatCommandBar?.addEventListener('click', toggleChatCommandBar);
        elements.btnChatInsertSubagentCommand?.addEventListener('click', () => {
            insertSelectedSubagentCommand();
        });
        elements.btnChatInsertOpenClawCommand?.addEventListener('click', () => {
            insertOpenClawSlashCommand();
        });
        bindStopButton(elements.btnStop, stopChatRun);
        
        // 消息输入框键盘事件（Enter发送，Shift+Enter换行）
        elements.messageInput?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) {
                return;
            }

            if (e.shiftKey) {
                return;  // Shift+Enter允许默认行为（换行）
            }

            e.preventDefault();
            sendMessage();
        });
        
        // 智能体引导面板事件
        elements.agentOnboardingPrompt?.addEventListener('input', () => {
            state.agentOnboardingPrompt = elements.agentOnboardingPrompt.value;
            state.agentOnboardingStatus = null;
            renderAgentOnboarding();
        });
        elements.btnSaveAgentOnboarding?.addEventListener('click', () => {
            saveAgentOnboarding();
        });
        elements.btnOpenAgentOnboardingSettings?.addEventListener('click', () => {
            openAgentOnboardingSettings();
        });

        // 集群消息发送
        elements.btnSendCluster?.addEventListener('click', sendClusterMessage);
        bindStopButton(elements.btnStopCluster, stopClusterRun);
        elements.clusterMessageInput?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) {
                return;
            }

            if (e.shiftKey) {
                return;
            }

            e.preventDefault();
            sendClusterMessage();
        });

        // 清空聊天
        elements.btnClear?.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearChat' });
        });

        // 控制台操作按钮
        elements.consoleActionButtons?.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.getAttribute('data-console-action');
                handleConsoleAction(action);
            });
        });

        // 技能市场
        elements.btnOpenSkillMarket?.addEventListener('click', () => {
            openSkillMarket();
        });

        // 技能市场标签切换
        elements.skillMarketTabs?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const tabButton = target.closest('[data-tab]');
            if (!tabButton) {
                return;
            }
            const nextTab = tabButton.getAttribute('data-tab');
            if (!nextTab || state.skillMarketTab === nextTab) {
                return;
            }
            state.skillMarketTab = nextTab;
            renderSkillMarket();
        });

        // 技能市场搜索和筛选
        elements.skillMarketSearchInput?.addEventListener('input', (e) => {
            state.skillMarketFilters = { ...state.skillMarketFilters, query: e.target.value };
            renderSkillMarket();
            elements.skillMarketSearchClear?.classList.toggle('is-visible', e.target.value.length > 0);
            scheduleSkillMarketRefresh();
        });

        elements.skillMarketSearchClear?.addEventListener('click', () => {
            if (elements.skillMarketSearchInput) {
                elements.skillMarketSearchInput.value = '';
                state.skillMarketFilters = { ...state.skillMarketFilters, query: '' };
                renderSkillMarket();
                elements.skillMarketSearchClear.classList.remove('is-visible');
                scheduleSkillMarketRefresh();
            }
        });

        elements.skillMarketSort?.addEventListener('change', (e) => {
            state.skillMarketFilters = { ...state.skillMarketFilters, sortBy: e.target.value };
            renderSkillMarket();
            scheduleSkillMarketRefresh();
        });

        elements.skillMarketCategories?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest('[data-category]');
            if (!button) {
                return;
            }
            const category = button.getAttribute('data-category') || 'all';
            state.skillMarketFilters = { ...state.skillMarketFilters, category };
            renderSkillMarket();
            scheduleSkillMarketRefresh();
        });

        elements.skillMarketTags?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest('[data-tag]');
            if (!button) {
                return;
            }
            const tag = button.getAttribute('data-tag');
            if (!tag) {
                return;
            }
            // 切换标签选中状态
            const currentTags = Array.isArray(state.skillMarketFilters?.tags) ? [...state.skillMarketFilters.tags] : [];
            const existingIndex = currentTags.indexOf(tag);
            if (existingIndex >= 0) {
                currentTags.splice(existingIndex, 1);
            } else {
                currentTags.push(tag);
            }
            state.skillMarketFilters = { ...state.skillMarketFilters, tags: currentTags };
            renderSkillMarket();
            scheduleSkillMarketRefresh();
        });

        elements.skillMarketHubs?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest('[data-hub]');
            if (!button) {
                return;
            }
            const hubId = button.getAttribute('data-hub') || 'all';
            state.skillMarketFilters = { ...state.skillMarketFilters, hubId };
            renderSkillMarket();
            scheduleSkillMarketRefresh();
        });

        elements.btnRefreshSkills?.addEventListener('click', () => {
            refreshSkillMarket();
        });

        elements.btnCreateCustomSkill?.addEventListener('click', () => {
            // TODO: 打开自定义技能创建模态框
            showNotification('Custom skill creation coming soon');
        });

        // 连接设置表单
        elements.formConnectionSettings?.addEventListener('submit', (e) => {
            e.preventDefault();
            saveConnectionSettings();
        });

        elements.connectionConfigMode?.addEventListener('change', () => {
            state.connectionFormDirty = true;
            state.connectionSettingsStatus = null;
            renderConnectionSetup();
        });

        [elements.connectionGatewayUrl, elements.connectionGatewayToken].forEach(input => {
            input?.addEventListener('input', () => {
                state.connectionFormDirty = true;
                state.connectionSettingsStatus = null;
                renderConnectionSetupStatus();
            });
        });

        elements.btnRetryConnection?.addEventListener('click', () => {
            state.connectionSettingsStatus = null;
            renderConnectionSetupStatus();
            vscode.postMessage({ type: 'retryConnection' });
        });

        elements.btnUseDetectedGateway?.addEventListener('click', () => {
            applyDetectedGatewayValues();
        });

        elements.exportRuntimeLogButtons?.forEach(button => {
            button.addEventListener('click', () => {
                exportRuntimeLogs();
            });
        });

        // OpenClaw配置表单
        elements.formOpenClawConfig?.addEventListener('submit', (e) => {
            e.preventDefault();
            saveOpenClawConfig();
        });

        const markOpenClawConfigFormDirty = () => {
            state.openClawConfigFormDirty = true;
            state.openClawConfigStatus = null;
            renderOpenClawConfigStatus();
        };

        [
            elements.openclawGatewayPort,
            elements.openclawGatewayToken,
            elements.openclawDefaultWorkspace,
            elements.openclawDefaultModelCustom,
            elements.openclawAuthProviderCustom,
            elements.openclawAuthApiKey
        ].forEach(input => {
            input?.addEventListener('input', () => {
                if (input === elements.openclawAuthProviderCustom) {
                    refreshOpenClawDefaultModelOptions();
                }
                markOpenClawConfigFormDirty();
            });
        });

        elements.secretRevealButtons?.forEach(button => {
            bindSecretRevealButton(button);
        });

        elements.openclawDefaultModel?.addEventListener('change', () => {
            syncOpenClawDefaultModelCustomVisibility();
            markOpenClawConfigFormDirty();
        });

        elements.openclawAuthProvider?.addEventListener('change', () => {
            syncOpenClawAuthProviderCustomVisibility();
            refreshOpenClawDefaultModelOptions();
            markOpenClawConfigFormDirty();
        });

        elements.btnRefreshOpenclawConfig?.addEventListener('click', () => {
            state.openClawConfigFormDirty = false;
            state.openClawConfigStatus = null;
            renderOpenClawConfigStatus();
            vscode.postMessage({ type: 'refreshOpenClawConfig' });
        });

        // 内存状态
        elements.btnRefreshMemoryStatus?.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshMemoryStatus' });
        });

        elements.btnOpenMemoryRoot?.addEventListener('click', () => {
            vscode.postMessage({ type: 'openMemoryRoot' });
        });

        elements.btnExportMemory?.addEventListener('click', () => {
            vscode.postMessage({ type: 'exportMemoryBundle' });
        });

        elements.btnImportMemory?.addEventListener('click', () => {
            vscode.postMessage({ type: 'importMemoryBundle' });
        });

        elements.btnStartOpenClaw?.addEventListener('click', () => {
            startOpenClaw();
        });

        elements.copyCommandButtons?.forEach(button => {
            button.addEventListener('click', () => {
                void copySetupCommand(button.getAttribute('data-copy-command'));
            });
        });

        // 新建智能体
        elements.btnNewAgent?.addEventListener('click', () => {
            openNewAgentModal();
        });

        elements.btnBatchDeleteAgents?.addEventListener('click', () => {
            vscode.postMessage({ type: 'promptDeleteAgentsBatch' });
        });

        elements.btnNewAgentFolder?.addEventListener('click', () => {
            createAgentFolder();
        });

        elements.btnRefreshAgents?.addEventListener('click', () => {
            vscode.postMessage({ type: 'getAgents' });
        });

        elements.btnNewCluster?.addEventListener('click', () => {
            openClusterEditor();
        });

        elements.btnCreateCluster?.addEventListener('click', () => {
            openClusterEditor();
        });

        elements.btnCreateClusterToolbar?.addEventListener('click', () => {
            openClusterEditor();
        });

        elements.btnEditCluster?.addEventListener('click', () => {
            if (state.currentClusterId) {
                openClusterEditor(state.currentClusterId);
            }
        });

        elements.btnExportClusterReadableContext?.addEventListener('click', () => {
            exportCurrentClusterConversation('readable');
        });

        elements.btnExportClusterRawContext?.addEventListener('click', () => {
            exportCurrentClusterConversation('raw');
        });
        elements.btnExportClusterSwarm?.addEventListener('click', () => {
            exportCurrentClusterSwarm();
        });
        elements.btnImportClusterSwarm?.addEventListener('click', () => {
            vscode.postMessage({ type: 'importClusterSwarm' });
        });

        [elements.btnImportClusterReplay, elements.btnImportClusterReplayEmpty].forEach(button => {
            button?.addEventListener('click', () => {
                vscode.postMessage({ type: 'importClusterReplay' });
            });
        });

        elements.btnClearClusterReplay?.addEventListener('click', () => {
            if (state.currentClusterId) {
                clearReplayCluster(state.currentClusterId);
            }
        });

        elements.btnAddClusterAgent?.addEventListener('click', () => {
            if (state.currentClusterId) {
                vscode.postMessage({ type: 'addAgentsToCluster', clusterId: state.currentClusterId });
            }
        });

        elements.btnRemoveClusterAgent?.addEventListener('click', () => {
            if (state.currentClusterId) {
                vscode.postMessage({ type: 'removeAgentsFromCluster', clusterId: state.currentClusterId });
            }
        });

        elements.btnDeleteCurrentCluster?.addEventListener('click', () => {
            if (state.currentClusterId) {
                deleteCluster(state.currentClusterId);
            }
        });

        elements.btnCreateTask?.addEventListener('click', () => {
            showTaskEditor();
        });

        elements.btnRefreshUsage?.addEventListener('click', () => {
            vscode.postMessage({ type: 'getUsage' });
        });

        elements.usagePeriodButtons?.forEach(btn => {
            btn.addEventListener('click', () => {
                const days = Number(btn.getAttribute('data-usage-period'));
                if (days === 7 || days === 30) {
                    setUsagePeriod(days);
                }
            });
        });

        elements.btnRefreshChannel?.addEventListener('click', () => {
            vscode.postMessage({ type: 'getChannels' });
        });

        [elements.btnNewChannel, elements.btnNewChannelEmpty].forEach(button => {
            button?.addEventListener('click', () => {
                startNewChannelDraft();
            });
        });

        elements.btnRefreshChannelMessages?.addEventListener('click', () => {
            if (!state.currentChannelId) {
                return;
            }

            vscode.postMessage({
                type: 'refreshChannelMessages',
                channelId: state.currentChannelId
            });
        });

        elements.formChannelConfig?.addEventListener('submit', (e) => {
            e.preventDefault();
            saveChannelConfig();
        });

        elements.btnDeleteChannel?.addEventListener('click', () => {
            if (!state.currentChannelId || state.channelDraft) {
                return;
            }

            vscode.postMessage({
                type: 'deleteChannel',
                channelId: state.currentChannelId
            });
        });

        elements.btnSendChannel?.addEventListener('click', sendChannelMessage);
        bindStopButton(elements.btnStopChannel, stopChannelRun);
        elements.channelMessageInput?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) {
                return;
            }

            if (e.shiftKey) {
                return;
            }

            e.preventDefault();
            sendChannelMessage();
        });

        // 模态框关闭按钮
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeAllModals);
        });

        // 新建智能体表单
        elements.formNewAgent?.addEventListener('submit', (e) => {
            e.preventDefault();
            createAgent();
        });

        elements.newAgentModeButtons?.forEach(button => {
            button.addEventListener('click', () => {
                const mode = button.getAttribute('data-new-agent-mode');
                if (mode === 'custom' || mode === 'preset' || mode === 'batch') {
                    setNewAgentMode(mode);
                }
            });
        });

        // 智能体设置表单
        if (elements.formAgentSettings) {
            elements.formAgentSettings.addEventListener('submit', (e) => {
                e.preventDefault();
                saveAgentSettings();
            });

            const markDirty = () => {
                markAgentSettingsDirty();
            };
            elements.formAgentSettings.addEventListener('input', markDirty);
            elements.formAgentSettings.addEventListener('change', markDirty);
            
            // 温度滑块实时更新显示值
            const tempRange = document.getElementById('settings-agent-temperature');
            if (tempRange) {
                tempRange.addEventListener('input', (e) => {
                    const target = e.target;
                    const value = target.value;
                    const parent = tempRange.parentElement;
                    if (parent) {
                        const valueDisplay = parent.querySelector('.range-value');
                        if (valueDisplay) {
                            valueDisplay.textContent = value;
                        }
                    }
                });
            }
        }

        // 模型选择联动
        elements.newAgentModelProvider?.addEventListener('change', () => {
            handleAgentModelProviderChange('new');
        });
        elements.newAgentModel?.addEventListener('change', () => {
            syncAgentModelCustomVisibility('new');
        });
        elements.batchAgentModelProvider?.addEventListener('change', () => {
            handleAgentModelProviderChange('batch');
        });
        elements.batchAgentModel?.addEventListener('change', () => {
            syncAgentModelCustomVisibility('batch');
        });
        elements.settingsAgentModelProvider?.addEventListener('change', () => {
            handleAgentModelProviderChange('settings');
        });
        elements.settingsAgentModel?.addEventListener('change', () => {
            syncAgentModelCustomVisibility('settings');
        });
        elements.clusterBatchAgentModelProvider?.addEventListener('change', () => {
            handleAgentModelProviderChange('clusterBatch');
        });
        elements.clusterBatchAgentModel?.addEventListener('change', () => {
            syncAgentModelCustomVisibility('clusterBatch');
        });

        // 任务表单
        if (elements.formTask) {
            elements.formTask.addEventListener('submit', (e) => {
                e.preventDefault();
                saveTask();
            });

            const taskScheduleKind = document.getElementById('task-schedule-kind');
            taskScheduleKind?.addEventListener('change', () => updateTaskFormFields());
            const taskPayloadKind = document.getElementById('task-payload-kind');
            taskPayloadKind?.addEventListener('change', () => updateTaskFormFields());
        }

        // 集群编辑器表单
        if (elements.formClusterEditor) {
            elements.formClusterEditor.addEventListener('submit', (e) => {
                e.preventDefault();
                saveClusterEditor();
            });
        }

        // 集群编辑器字段变化监听
        [
            elements.clusterEditorPreset,
            elements.clusterEditorStyle,
            elements.clusterEditorDelivery,
            elements.clusterEditorCritique,
            elements.clusterEditorRounds,
            elements.clusterEditorRoundsUnlimited,
            elements.clusterEditorStopCondition,
            elements.clusterEditorCoordinatorAgent
        ].forEach(input => {
            input?.addEventListener('change', () => {
                if (input === elements.clusterEditorPreset) {
                    applyClusterPreset(elements.clusterEditorPreset?.value || '');
                } else {
                    if (input === elements.clusterEditorRoundsUnlimited && typeof syncClusterRoundModeState === 'function') {
                        syncClusterRoundModeState();
                    }
                    renderClusterPresetSummary();
                }
            });
        });
        elements.clusterEditorStopCondition?.addEventListener('input', () => {
            renderClusterPresetSummary();
        });
        elements.clusterEditorBriefing?.addEventListener('input', () => {
            renderClusterPresetSummary();
        });
        elements.clusterEditorAgentPicker?.addEventListener('change', () => {
            if (typeof syncClusterAgentPickerRowState === 'function') {
                syncClusterAgentPickerRowState();
            }
            syncClusterMemberCustomizationState();
        });
        elements.clusterEditorMemberProfiles?.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLSelectElement)) {
                return;
            }
            const agentId = target.getAttribute('data-cluster-member-preset-identity');
            if (!agentId) {
                return;
            }
            const presetId = String(target.value || '').trim();
            if (presetId && typeof applyClusterMemberIdentityPreset === 'function') {
                applyClusterMemberIdentityPreset(agentId, presetId);
            }
        });

        // 模态框外部点击关闭
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAllModals();
            });
        });

        // 全局点击事件委托处理
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) {
                return;
            }

            // 技能链接打开
            const skillLink = target.closest('[data-skill-url]');
            if (skillLink) {
                const url = skillLink.getAttribute('data-skill-url');
                if (url) {
                    vscode.postMessage({ type: 'openSkillUrl', url });
                }
                return;
            }

            // 技能开关切换
            const skillToggle = target.closest('[data-skill-toggle]');
            if (skillToggle) {
                const skillId = skillToggle.getAttribute('data-skill-toggle');
                if (skillId) {
                    toggleSkillForActiveAgent(skillId);
                }
                return;
            }

            // 技能安装
            const skillInstall = target.closest('[data-skill-install]');
            if (skillInstall) {
                const skillId = skillInstall.getAttribute('data-skill-install');
                if (skillId) {
                    const hubId = skillInstall.getAttribute('data-skill-hub') || null;
                    installSkill(skillId, hubId);
                }
                return;
            }

            // 技能卸载
            const skillUninstall = target.closest('[data-skill-uninstall]');
            if (skillUninstall) {
                const skillId = skillUninstall.getAttribute('data-skill-uninstall');
                if (skillId) {
                    uninstallSkill(skillId);
                }
                return;
            }

            // 思考块展开/折叠
            const thinkingHeader = target.closest('.thinking-header');
            if (thinkingHeader) {
                toggleThinkingBlock(thinkingHeader);
                return;
            }

            // 用户输入信封原始内容切换
            const envelopeToggle = target.closest('[data-user-input-toggle]');
            if (envelopeToggle) {
                toggleUserInputEnvelopeRaw(envelopeToggle);
                return;
            }

            // 集群侧边栏项选择
            const clusterSidebarItem = target.closest('[data-sidebar-cluster-id]');
            if (clusterSidebarItem) {
                const clusterId = clusterSidebarItem.getAttribute('data-sidebar-cluster-id');
                if (clusterId) {
                    selectCluster(clusterId);
                }
                return;
            }

            // 集群目标标签切换
            const clusterTargetTab = target.closest('[data-cluster-target-kind]');
            if (clusterTargetTab) {
                const targetKind = clusterTargetTab.getAttribute('data-cluster-target-kind');
                const agentId = clusterTargetTab.getAttribute('data-cluster-agent-id');
                if (targetKind === 'swarm') {
                    selectClusterTarget('swarm');
                } else if (targetKind === 'agent' && agentId) {
                    selectClusterTarget('agent', agentId);
                }
                return;
            }

            // 集群模式标签切换
            const clusterModeTab = target.closest('[data-cluster-mode]');
            if (clusterModeTab) {
                const mode = clusterModeTab.getAttribute('data-cluster-mode');
                if (mode === 'broadcast' || mode === 'collaborate') {
                    selectClusterSwarmMode(mode);
                }
                return;
            }

            // 集群智能体视图模式切换
            const clusterAgentViewTab = target.closest('[data-cluster-agent-view-mode]');
            if (clusterAgentViewTab) {
                const mode = clusterAgentViewTab.getAttribute('data-cluster-agent-view-mode');
                if (mode) {
                    selectClusterAgentViewMode(mode);
                }
                return;
            }

            // 集群输出模式切换
            const clusterOutputModeTab = target.closest('[data-cluster-output-mode]');
            if (clusterOutputModeTab) {
                const outputMode = clusterOutputModeTab.getAttribute('data-cluster-output-mode');
                if (outputMode === 'frontend' || outputMode === 'raw') {
                    selectClusterSwarmOutputMode(outputMode);
                }
                return;
            }

            // 集群拓扑图切换
            const clusterTopologyToggle = target.closest('[data-cluster-topology-toggle]');
            if (clusterTopologyToggle) {
                toggleClusterTopology();
                return;
            }

            // 集群顶部区域切换
            const clusterTopSectionToggle = target.closest('[data-cluster-top-section-toggle]');
            if (clusterTopSectionToggle) {
                toggleClusterTopSection();
                return;
            }

            // 任务操作按钮
            const taskActionButton = target.closest('[data-task-action]');
            if (taskActionButton) {
                const taskId = taskActionButton.getAttribute('data-task-id');
                const action = taskActionButton.getAttribute('data-task-action');
                if (!taskId || !action) {
                    return;
                }

                if (action === 'edit') {
                    const task = state.tasks.find(item => item.id === taskId) || null;
                    showTaskEditor(task);
                } else if (action === 'toggle') {
                    toggleTask(taskId);
                } else if (action === 'run') {
                    runTask(taskId);
                } else if (action === 'delete') {
                    deleteTask(taskId);
                }
            }

            // 智能体预设卡片选择
            const presetCard = target.closest('[data-agent-preset-card]');
            if (presetCard) {
                const presetId = presetCard.getAttribute('data-agent-preset-id');
                if (presetId) {
                    setNewAgentMode('preset');
                    applySelectedAgentPreset(presetId, { resetToDefault: false });
                }
                return;
            }

            // 智能体引导预设卡片选择
            const onboardingPresetCard = target.closest('[data-agent-onboarding-preset-id]');
            if (onboardingPresetCard) {
                const presetId = onboardingPresetCard.getAttribute('data-agent-onboarding-preset-id');
                if (presetId) {
                    applyAgentOnboardingPreset(presetId);
                }
            }
        });

        // Swarm运行选择变化
        document.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLSelectElement)) {
                return;
            }

            if (target.matches('[data-cluster-swarm-run-select]')) {
                selectClusterSwarmRun(target.value);
            }
        });

        // 思考块键盘可访问性
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') {
                return;
            }

            const target = e.target;
            if (!(target instanceof Element)) {
                return;
            }

            const thinkingHeader = target.closest('.thinking-header');
            if (!thinkingHeader) {
                return;
            }

            e.preventDefault();
            toggleThinkingBlock(thinkingHeader);
        });

        // 用户输入额外卡片手风琴效果
        document.addEventListener('toggle', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLDetailsElement)) {
                return;
            }

            if (!target.hasAttribute('data-user-input-extra-card') || !target.open) {
                return;
            }

            const list = target.closest('[data-user-input-extra-list]');
            if (!list) {
                return;
            }

            // 关闭同组的其他展开项
            list.querySelectorAll('details[data-user-input-extra-card][open]').forEach(item => {
                if (item !== target) {
                    item.open = false;
                }
            });
        }, true);
    }

    // ==================== 密码显示切换按钮 ====================

    /**
     * 绑定密码显示/隐藏切换按钮
     * 支持鼠标按下显示、松开隐藏，以及键盘Space/Enter切换
     * 
     * @param {HTMLElement} button - 切换按钮元素
     */
    function bindSecretRevealButton(button) {
        const inputId = button?.getAttribute('data-press-reveal');
        if (!inputId) {
            return;
        }

        /**
         * 切换输入框类型
         * @param {boolean} reveal - 是否显示明文
         */
        const toggleReveal = (reveal) => {
            const input = document.getElementById(inputId);
            if (!(input instanceof HTMLInputElement)) {
                return;
            }

            input.type = reveal ? 'text' : 'password';
            button.classList.toggle('active', reveal);
        };

        // 鼠标事件：按下显示，松开/离开/取消时隐藏
        button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            toggleReveal(true);
        });
        ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(eventName => {
            button.addEventListener(eventName, () => {
                toggleReveal(false);
            });
        });
        
        // 键盘事件：Space/Enter切换
        button.addEventListener('keydown', (event) => {
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                toggleReveal(true);
            }
        });
        button.addEventListener('keyup', (event) => {
            if (event.key === ' ' || event.key === 'Enter') {
                toggleReveal(false);
            }
        });
    }
