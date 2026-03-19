// OpenClaw Luna - Panel Core
    'use strict';

    const vscode = acquireVsCodeApi();
    const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18789';
    const INSTALL_COMMAND = 'npm install -g openclaw@latest';
    const ONBOARD_COMMAND = 'openclaw onboard --install-daemon';
    const START_OPENCLAW_COMMAND = 'openclaw gateway start';
    const CUSTOM_AGENT_PRESET_ID = 'custom';
    const CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE = '__custom_agent_provider__';
    const DIRECT_AGENT_MODEL_PROVIDER_OPTION_VALUE = '__direct_agent_provider__';
    const CUSTOM_AGENT_MODEL_OPTION_VALUE = '__custom_agent_model__';
    const CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE = '__custom__';
    const CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE = '__custom__';
    
    // State
    let state = {
        currentAgentId: null,
        currentClusterId: null,
        currentClusterTargetKind: 'swarm',
        currentClusterAgentId: null,
        currentClusterSwarmMode: 'broadcast',
        currentClusterAgentViewMode: 'chat',
        agents: [],
        agentFolders: [],
        agentPresets: [],
        aiSkills: [],
        availableModels: [],
        newAgentMode: 'custom',
        newAgentPresetId: CUSTOM_AGENT_PRESET_ID,
        clusters: [],
        serverClusters: [],
        clusterReplays: {},
        clusterWorkModePresets: [],
        identityPresets: [],
        clusterConversations: {},
        tasks: [],
        tasksAvailable: true,
        tasksLoaded: false,
        tasksMessage: '',
        tasksSourcePath: '',
        latestUsage: null,
        usagePeriodDays: 7,
        channels: [],
        channelsLoaded: false,
        currentChannelId: null,
        channelMessages: [],
        channelLoading: false,
        channelSending: false,
        channelDraft: null,
        isStreaming: false,
        currentChannelThinking: null,
        currentThinking: null,
        viewMode: 'chat',
        locale: 'en',
        runtime: {
            connected: false,
            mode: 'gateway',
            sourceDescription: '',
            supportsTasks: false,
            supportsLiveSync: false,
            capabilities: null,
            capabilityMatrix: [],
            diagnostics: null,
            openClawConfig: null,
            memoryStatus: null
        },
        connectionFormDirty: false,
        connectionSettingsStatus: null,
        agentSettingsFormDirty: false,
        agentSettingsSaving: false,
        agentSettingsStatus: null,
        openClawConfigFormDirty: false,
        openClawConfigStatus: null,
        batchCreateAgentsSaving: false,
        batchCreateAgentsStatus: null,
        agentOnboardingAgentId: null,
        agentOnboardingPresetId: '',
        agentOnboardingPrompt: '',
        agentOnboardingSaving: false,
        agentOnboardingStatus: null,
        chatHomePinned: false,
        forceSetupPanel: false,
        installGuideStatus: null,
        installGuideBusy: false,
        agentMutation: null,
        mainSidebarCollapsed: false,
        clusterTopologyCollapsed: false,
        skillMarketFilters: {
            query: '',
            category: 'all',
            tags: [],
            sortBy: 'popular',
            hubId: 'all'
        },
        skillMarketTab: 'market',
        skillMarketData: null,
        skillMarketLoading: false
    };
    let activeTraceContainer = null;
    let activeChannelTraceContainer = null;
    let isBulkRenderingChat = false;
    let isBulkRenderingChannel = false;
    let pendingStreamingRender = null;
    let streamRenderFrame = null;
    let agentMutationTimer = null;
    let skillMarketRefreshTimer = null;
    const renderedChatMessageIds = new Set();
    const renderedChannelMessageIds = new Set();
    const MAX_CLUSTER_ROUNDS = 12;

    // DOM Elements cache
    const elements = {};

    const LOCAL_I18N_FALLBACKS = {
        'zh-cn': {
            'sidebar.newFolder': '新建文件夹',
            'sidebar.newFolderPrompt': '输入文件夹名称',
            'sidebar.renameFolderPrompt': '重命名文件夹',
            'sidebar.deleteFolderConfirm': '确定删除文件夹“{name}”吗？其中的智能体会回到未分组。',
            'sidebar.folderEmpty': '把智能体拖到这里',
            'sidebar.ungrouped': '未分组',
            'sidebar.ungroupedHint': '把智能体拖到这里以移出文件夹',
            'sidebar.removeFromFolder': '移出文件夹',
            'clusters.updated': '集群“{name}”已更新',
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

    function t(key, vars) {
        const translated = window.OpenClawI18n ? window.OpenClawI18n.t(key, vars) : key;
        if (translated !== key) {
            return translated;
        }

        const localeFallbacks = LOCAL_I18N_FALLBACKS[state.locale] || {};
        let fallback = localeFallbacks[key] || key;
        Object.keys(vars || {}).forEach(name => {
            fallback = fallback.replace(new RegExp(`{${name}}`, 'g'), vars[name]);
        });
        return fallback;
    }

    // Initialize
    function init() {
        cacheElements();
        hydrateUiState();
        bindEvents();
        
        const locale = document.body?.dataset.locale;
        if (locale) {
            state.locale = locale;
        }

        const encodedTranslations = document.body?.dataset.translations;
        if (encodedTranslations && window.OpenClawI18n) {
            try {
                const translations = JSON.parse(decodeBase64Utf8(encodedTranslations));
                window.OpenClawI18n.setTranslations(translations, state.locale);
            } catch (error) {
                console.error('Failed to initialize OpenClaw translations.', error);
            }
        }
        
        updateUIText();
        applySidebarState();
        vscode.postMessage({ type: 'webviewReady' });
    }

    function hydrateUiState() {
        const savedState = vscode.getState ? (vscode.getState() || {}) : {};
        state.mainSidebarCollapsed = Boolean(savedState.mainSidebarCollapsed);
        state.clusterTopologyCollapsed = Boolean(savedState.clusterTopologyCollapsed);
    }

    function persistUiState() {
        if (!vscode.setState) {
            return;
        }

        vscode.setState({
            mainSidebarCollapsed: state.mainSidebarCollapsed,
            clusterTopologyCollapsed: state.clusterTopologyCollapsed
        });
    }

    function buildReplayClusterId(clusterId, mode, importedAt) {
        return `replay:${clusterId || 'cluster'}:${mode || 'broadcast'}:${importedAt || Date.now()}`;
    }

    function getClusterReplay(clusterOrId) {
        const clusterId = typeof clusterOrId === 'string'
            ? clusterOrId
            : clusterOrId?.id;
        return clusterId ? (state.clusterReplays?.[clusterId] || null) : null;
    }

    function isReplayCluster(clusterOrId) {
        return Boolean(getClusterReplay(clusterOrId));
    }

    function getMergedClusterList(serverClusters = state.serverClusters) {
        const liveClusters = Array.isArray(serverClusters) ? serverClusters : [];
        const replayClusters = Object.values(state.clusterReplays || {}).map(item => item.cluster).filter(Boolean);
        return [...liveClusters, ...replayClusters];
    }

    function clearReplayCluster(clusterId) {
        if (!clusterId || !state.clusterReplays?.[clusterId]) {
            return;
        }

        delete state.clusterReplays[clusterId];
        Object.keys(state.clusterConversations || {}).forEach(key => {
            if (key.startsWith(`cluster:${clusterId}:`)) {
                delete state.clusterConversations[key];
            }
        });

        if (state.currentClusterId === clusterId) {
            state.currentClusterId = null;
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
        }

        renderClusters(state.serverClusters || []);
    }

    function loadClusterReplay(replay) {
        if (!replay?.cluster?.id) {
            return;
        }

        const importedAt = typeof replay.importedAt === 'string' && replay.importedAt.trim()
            ? replay.importedAt
            : new Date().toISOString();
        const mode = replay.mode === 'collaborate' ? 'collaborate' : 'broadcast';
        const replayClusterId = buildReplayClusterId(replay.cluster.id, mode, importedAt);
        const replayCluster = {
            ...replay.cluster,
            id: replayClusterId,
            name: `${replay.cluster.name} · Replay`,
            replayMeta: {
                sourcePath: replay.sourcePath || '',
                importedAt,
                exportedAt: replay.exportedAt || '',
                mode,
                messageCount: Number(replay.messageCount) || (Array.isArray(replay.messages) ? replay.messages.length : 0),
                originalClusterId: replay.cluster.id
            }
        };

        state.clusterReplays[replayClusterId] = {
            cluster: replayCluster,
            mode,
            messages: Array.isArray(replay.messages) ? replay.messages : []
        };

        const conversation = ensureClusterConversation(getClusterConversationKey(replayClusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.messages = Array.isArray(replay.messages) ? replay.messages : [];
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;

        state.currentClusterId = replayClusterId;
        state.currentClusterTargetKind = 'swarm';
        state.currentClusterAgentId = null;
        state.currentClusterSwarmMode = mode;

        renderClusters(state.serverClusters || []);
    }

    function toggleMainSidebar() {
        state.mainSidebarCollapsed = !state.mainSidebarCollapsed;
        applySidebarState();
        persistUiState();
    }

    function toggleClusterTopology() {
        state.clusterTopologyCollapsed = !state.clusterTopologyCollapsed;
        renderClusterWorkspace();
        persistUiState();
    }

    function applySidebarState() {
        elements.mainSidebar?.classList.toggle('collapsed', state.mainSidebarCollapsed);

        if (elements.btnToggleMainSidebar) {
            elements.btnToggleMainSidebar.innerHTML = state.mainSidebarCollapsed ? '&#9654;' : '&#9664;';
            elements.btnToggleMainSidebar.title = state.mainSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
        }
    }

    function decodeBase64Utf8(value) {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));

        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(bytes);
        }

        let result = '';
        bytes.forEach(byte => {
            result += String.fromCharCode(byte);
        });
        return decodeURIComponent(escape(result));
    }

    function cacheElements() {
        elements.mainSidebar = document.getElementById('main-sidebar');
        elements.btnToggleMainSidebar = document.getElementById('btn-toggle-main-sidebar');
        elements.agentList = document.getElementById('agent-list');
        elements.btnNewAgentFolder = document.getElementById('btn-new-agent-folder');
        elements.btnBatchDeleteAgents = document.getElementById('btn-batch-delete-agents');
        elements.chatHome = document.getElementById('chat-home');
        elements.chatConsoleHomeContent = document.getElementById('chat-console-home-content');
        elements.agentOnboardingPanel = document.getElementById('agent-onboarding-panel');
        elements.agentOnboardingAgentName = document.getElementById('agent-onboarding-agent-name');
        elements.agentOnboardingAgentModel = document.getElementById('agent-onboarding-agent-model');
        elements.agentOnboardingPresetGrid = document.getElementById('agent-onboarding-preset-grid');
        elements.agentOnboardingPresetSummary = document.getElementById('agent-onboarding-preset-summary');
        elements.agentOnboardingPrompt = document.getElementById('agent-onboarding-prompt');
        elements.agentOnboardingStatus = document.getElementById('agent-onboarding-status');
        elements.btnSaveAgentOnboarding = document.getElementById('btn-save-agent-onboarding');
        elements.btnOpenAgentOnboardingSettings = document.getElementById('btn-open-agent-onboarding-settings');
        elements.clusterSidebarList = document.getElementById('cluster-sidebar-list');
        elements.chatMessages = document.getElementById('chat-messages');
        elements.messageInput = document.getElementById('message-input');
        elements.btnSend = document.getElementById('btn-send');
        elements.btnClear = document.getElementById('btn-clear');
        elements.btnStop = document.getElementById('btn-stop');
        elements.connectionStatus = document.getElementById('connection-status');
        elements.connectionLabel = document.getElementById('connection-label');
        elements.connectionCaption = document.getElementById('connection-caption');
        elements.connectionPill = document.getElementById('connection-pill');
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
        elements.btnOpenSkillMarket = document.getElementById('btn-open-skill-market');
        elements.btnOpenClawConfigEntry = document.getElementById('btn-openclaw-config-entry');
        elements.formConnectionSettings = document.getElementById('form-connection-settings');
        elements.connectionConfigMode = document.getElementById('connection-config-mode');
        elements.connectionGatewayUrl = document.getElementById('connection-gateway-url');
        elements.connectionGatewayToken = document.getElementById('connection-gateway-token');
        elements.connectionSettingsHint = document.getElementById('connection-settings-hint');
        elements.connectionSettingsStatus = document.getElementById('connection-settings-status');
        elements.btnRetryConnection = document.getElementById('btn-retry-connection');
        elements.btnUseDetectedGateway = document.getElementById('btn-use-detected-gateway');
        elements.exportRuntimeLogButtons = document.querySelectorAll('[data-export-runtime-logs]');
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
        elements.clusterEmptyState = document.getElementById('clusters-empty-state');
        elements.clusterWorkspace = document.getElementById('cluster-workspace');
        elements.clusterTitle = document.getElementById('cluster-title');
        elements.clusterBriefing = document.getElementById('cluster-briefing');
        elements.clusterSubtitle = document.getElementById('cluster-subtitle');
        elements.clusterReplayBanner = document.getElementById('cluster-replay-banner');
        elements.clusterWorkmodeSummary = document.getElementById('cluster-workmode-summary');
        elements.clusterTargetTabs = document.getElementById('cluster-target-tabs');
        elements.clusterModeTabs = document.getElementById('cluster-mode-tabs');
        elements.clusterTopology = document.getElementById('cluster-topology');
        elements.clusterMessages = document.getElementById('cluster-messages');
        elements.clusterMessageInput = document.getElementById('cluster-message-input');
        elements.clusterTargetHint = document.getElementById('cluster-target-hint');
        elements.btnSendCluster = document.getElementById('btn-send-cluster');
        elements.btnStopCluster = document.getElementById('btn-stop-cluster');
        elements.btnExportClusterReadableContext = document.getElementById('btn-export-cluster-readable-context');
        elements.btnExportClusterRawContext = document.getElementById('btn-export-cluster-raw-context');
        elements.btnExportClusterSwarm = document.getElementById('btn-export-cluster-swarm');
        elements.btnImportClusterSwarm = document.getElementById('btn-import-cluster-swarm');
        elements.btnImportClusterReplay = document.getElementById('btn-import-cluster-replay');
        elements.btnImportClusterReplayEmpty = document.getElementById('btn-import-cluster-replay-empty');
        elements.btnClearClusterReplay = document.getElementById('btn-clear-cluster-replay');
        elements.btnEditCluster = document.getElementById('btn-edit-cluster');
        elements.btnNewAgent = document.getElementById('btn-new-agent');
        elements.btnRefreshAgents = document.getElementById('btn-refresh-agents');
        elements.btnNewCluster = document.getElementById('btn-new-cluster');
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
        elements.navTabs = document.querySelectorAll('.nav-tab');
        elements.views = document.querySelectorAll('.view');
        elements.tokenCount = document.getElementById('token-count');
        elements.tasksList = document.getElementById('tasks-list');
        elements.tasksSource = document.getElementById('tasks-source');
        elements.btnCreateCluster = document.getElementById('btn-create-cluster');
        elements.btnCreateClusterToolbar = document.getElementById('btn-create-cluster-toolbar');
        elements.btnAddClusterAgent = document.getElementById('btn-add-cluster-agent');
        elements.btnRemoveClusterAgent = document.getElementById('btn-remove-cluster-agent');
        elements.btnDeleteCurrentCluster = document.getElementById('btn-delete-current-cluster');
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
        elements.btnCreateTask = document.getElementById('btn-create-task');
        elements.btnRefreshUsage = document.getElementById('btn-refresh-usage');
        elements.btnUsagePeriod7 = document.getElementById('btn-usage-period-7');
        elements.btnUsagePeriod30 = document.getElementById('btn-usage-period-30');
        elements.usagePeriodButtons = document.querySelectorAll('[data-usage-period]');
        elements.usagePeriodCaption = document.getElementById('usage-period-caption');
        elements.usageChartTitle = document.getElementById('usage-chart-title');
        elements.modelChartTitle = document.getElementById('model-chart-title');
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
        elements.modalTask = document.getElementById('modal-task');
        elements.formTask = document.getElementById('form-task');
    }

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

    function bindEvents() {
        elements.btnToggleMainSidebar?.addEventListener('click', toggleMainSidebar);

        // Navigation
        elements.navTabs.forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        // Send message
        elements.btnSend?.addEventListener('click', sendMessage);
        bindStopButton(elements.btnStop, stopChatRun);
        elements.messageInput?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) {
                return;
            }

            if (e.shiftKey) {
                return;
            }

            e.preventDefault();
            sendMessage();
        });
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

        // Clear chat
        elements.btnClear?.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearChat' });
        });

        elements.consoleActionButtons?.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.getAttribute('data-console-action');
                handleConsoleAction(action);
            });
        });

        elements.btnOpenSkillMarket?.addEventListener('click', () => {
            openSkillMarket();
        });

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

        // Skill Market search and filters
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
            // TODO: Open custom skill creation modal
            showNotification('Custom skill creation coming soon');
        });

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

        // New agent modal
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

        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeAllModals);
        });

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

        // Agent settings form
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
            
            // Range input listener for temperature
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

        if (elements.formClusterEditor) {
            elements.formClusterEditor.addEventListener('submit', (e) => {
                e.preventDefault();
                saveClusterEditor();
            });
        }

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

        // Close modal when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAllModals();
            });
        });

        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) {
                return;
            }

            const skillLink = target.closest('[data-skill-url]');
            if (skillLink) {
                const url = skillLink.getAttribute('data-skill-url');
                if (url) {
                    vscode.postMessage({ type: 'openSkillUrl', url });
                }
                return;
            }

            const skillToggle = target.closest('[data-skill-toggle]');
            if (skillToggle) {
                const skillId = skillToggle.getAttribute('data-skill-toggle');
                if (skillId) {
                    toggleSkillForActiveAgent(skillId);
                }
                return;
            }

            const skillInstall = target.closest('[data-skill-install]');
            if (skillInstall) {
                const skillId = skillInstall.getAttribute('data-skill-install');
                if (skillId) {
                    const hubId = skillInstall.getAttribute('data-skill-hub') || null;
                    installSkill(skillId, hubId);
                }
                return;
            }

            const skillUninstall = target.closest('[data-skill-uninstall]');
            if (skillUninstall) {
                const skillId = skillUninstall.getAttribute('data-skill-uninstall');
                if (skillId) {
                    uninstallSkill(skillId);
                }
                return;
            }

            const thinkingHeader = target.closest('.thinking-header');
            if (thinkingHeader) {
                toggleThinkingBlock(thinkingHeader);
                return;
            }

            const envelopeToggle = target.closest('[data-user-input-toggle]');
            if (envelopeToggle) {
                toggleUserInputEnvelopeRaw(envelopeToggle);
                return;
            }

            const clusterSidebarItem = target.closest('[data-sidebar-cluster-id]');
            if (clusterSidebarItem) {
                const clusterId = clusterSidebarItem.getAttribute('data-sidebar-cluster-id');
                if (clusterId) {
                    selectCluster(clusterId);
                }
                return;
            }

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

            const clusterModeTab = target.closest('[data-cluster-mode]');
            if (clusterModeTab) {
                const mode = clusterModeTab.getAttribute('data-cluster-mode');
                if (mode === 'broadcast' || mode === 'collaborate') {
                    selectClusterSwarmMode(mode);
                }
                return;
            }

            const clusterAgentViewTab = target.closest('[data-cluster-agent-view-mode]');
            if (clusterAgentViewTab) {
                const mode = clusterAgentViewTab.getAttribute('data-cluster-agent-view-mode');
                if (mode) {
                    selectClusterAgentViewMode(mode);
                }
                return;
            }

            const clusterTopologyToggle = target.closest('[data-cluster-topology-toggle]');
            if (clusterTopologyToggle) {
                toggleClusterTopology();
                return;
            }

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

            const presetCard = target.closest('[data-agent-preset-card]');
            if (presetCard) {
                const presetId = presetCard.getAttribute('data-agent-preset-id');
                if (presetId) {
                    setNewAgentMode('preset');
                    applySelectedAgentPreset(presetId, { resetToDefault: false });
                }
                return;
            }

            const onboardingPresetCard = target.closest('[data-agent-onboarding-preset-id]');
            if (onboardingPresetCard) {
                const presetId = onboardingPresetCard.getAttribute('data-agent-onboarding-preset-id');
                if (presetId) {
                    applyAgentOnboardingPreset(presetId);
                }
            }
        });

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

            list.querySelectorAll('details[data-user-input-extra-card][open]').forEach(item => {
                if (item !== target) {
                    item.open = false;
                }
            });
        }, true);
    }

    function bindSecretRevealButton(button) {
        const inputId = button?.getAttribute('data-press-reveal');
        if (!inputId) {
            return;
        }

        const toggleReveal = (reveal) => {
            const input = document.getElementById(inputId);
            if (!(input instanceof HTMLInputElement)) {
                return;
            }

            input.type = reveal ? 'text' : 'password';
            button.classList.toggle('active', reveal);
        };

        button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            toggleReveal(true);
        });
        ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(eventName => {
            button.addEventListener(eventName, () => {
                toggleReveal(false);
            });
        });
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
