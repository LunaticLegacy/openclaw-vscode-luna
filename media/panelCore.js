// OpenClaw Luna - Panel Core
    'use strict';

    const vscode = acquireVsCodeApi();
    const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18789';
    const INSTALL_COMMAND = 'npm install -g openclaw@latest';
    const ONBOARD_COMMAND = 'openclaw onboard --install-daemon';
    const START_OPENCLAW_COMMAND = 'openclaw gateway start';
    const CUSTOM_AGENT_PRESET_ID = 'custom';
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
        newAgentMode: 'custom',
        newAgentPresetId: CUSTOM_AGENT_PRESET_ID,
        clusters: [],
        clusterWorkModePresets: [],
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
            openClawConfig: null
        },
        connectionFormDirty: false,
        connectionSettingsStatus: null,
        openClawConfigFormDirty: false,
        openClawConfigStatus: null,
        chatHomePinned: false,
        forceSetupPanel: false,
        installGuideStatus: null,
        installGuideBusy: false,
        agentMutation: null,
        mainSidebarCollapsed: false,
        clusterTopologyCollapsed: false
    };
    let activeTraceContainer = null;
    let activeChannelTraceContainer = null;
    let isBulkRenderingChat = false;
    let isBulkRenderingChannel = false;
    let pendingStreamingRender = null;
    let streamRenderFrame = null;
    let agentMutationTimer = null;
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
        elements.chatHome = document.getElementById('chat-home');
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
        elements.openclawConfigHint = document.getElementById('openclaw-config-hint');
        elements.openclawConfigStatus = document.getElementById('openclaw-config-status');
        elements.btnRefreshOpenclawConfig = document.getElementById('btn-refresh-openclaw-config');
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
        elements.clusterWorkmodeSummary = document.getElementById('cluster-workmode-summary');
        elements.clusterTargetTabs = document.getElementById('cluster-target-tabs');
        elements.clusterModeTabs = document.getElementById('cluster-mode-tabs');
        elements.clusterTopology = document.getElementById('cluster-topology');
        elements.clusterMessages = document.getElementById('cluster-messages');
        elements.clusterMessageInput = document.getElementById('cluster-message-input');
        elements.clusterTargetHint = document.getElementById('cluster-target-hint');
        elements.btnSendCluster = document.getElementById('btn-send-cluster');
        elements.btnStopCluster = document.getElementById('btn-stop-cluster');
        elements.btnExportClusterContext = document.getElementById('btn-export-cluster-context');
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
        elements.newAgentName = document.getElementById('new-agent-name');
        elements.newAgentModel = document.getElementById('new-agent-model');
        elements.newAgentPrompt = document.getElementById('new-agent-prompt');
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
        elements.clusterEditorBriefing = document.getElementById('cluster-editor-briefing');
        elements.clusterEditorCoordinatorAgent = document.getElementById('cluster-editor-coordinator-agent');
        elements.clusterPresetSummary = document.getElementById('cluster-preset-summary');
        elements.clusterEditorAgentPicker = document.getElementById('cluster-editor-agent-picker');
        elements.clusterEditorMemberProfiles = document.getElementById('cluster-editor-member-profiles');
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
        elements.agentSkillsPicker = document.getElementById('settings-agent-skills');
        elements.agentSkillsHint = document.getElementById('settings-agent-skills-hint');
        elements.agentSkillLinks = document.getElementById('settings-agent-skill-links');
        elements.skillMarketAgentLabel = document.getElementById('skill-market-agent-label');
        elements.skillMarketGrid = document.getElementById('skill-market-grid');
        elements.modalTask = document.getElementById('modal-task');
        elements.formTask = document.getElementById('form-task');
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

        elements.btnExportClusterContext?.addEventListener('click', () => {
            exportCurrentClusterConversation();
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
                if (mode === 'custom' || mode === 'preset') {
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
            elements.clusterEditorCoordinatorAgent
        ].forEach(input => {
            input?.addEventListener('change', () => {
                if (input === elements.clusterEditorPreset) {
                    applyClusterPreset(elements.clusterEditorPreset?.value || '');
                } else {
                    renderClusterPresetSummary();
                }
            });
        });
        elements.clusterEditorBriefing?.addEventListener('input', () => {
            renderClusterPresetSummary();
        });
        elements.clusterEditorAgentPicker?.addEventListener('change', () => {
            syncClusterMemberCustomizationState();
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

            const skillToggle = target.closest('[data-skill-market-toggle]');
            if (skillToggle) {
                const skillId = skillToggle.getAttribute('data-skill-id');
                if (skillId) {
                    toggleSkillForActiveAgent(skillId);
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

