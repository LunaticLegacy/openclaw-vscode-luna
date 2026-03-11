// OpenClaw Luna - Webview Panel Script
(function() {
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
        agents: [],
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
        mainSidebarCollapsed: false
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
    }

    function persistUiState() {
        if (!vscode.setState) {
            return;
        }

        vscode.setState({
            mainSidebarCollapsed: state.mainSidebarCollapsed
        });
    }

    function toggleMainSidebar() {
        state.mainSidebarCollapsed = !state.mainSidebarCollapsed;
        applySidebarState();
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
        elements.btnOpenClawConfigEntry = document.getElementById('btn-openclaw-config-entry');
        elements.formConnectionSettings = document.getElementById('form-connection-settings');
        elements.connectionConfigMode = document.getElementById('connection-config-mode');
        elements.connectionGatewayUrl = document.getElementById('connection-gateway-url');
        elements.connectionGatewayToken = document.getElementById('connection-gateway-token');
        elements.connectionSettingsHint = document.getElementById('connection-settings-hint');
        elements.connectionSettingsStatus = document.getElementById('connection-settings-status');
        elements.btnRetryConnection = document.getElementById('btn-retry-connection');
        elements.btnUseDetectedGateway = document.getElementById('btn-use-detected-gateway');
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
        elements.clusterMessages = document.getElementById('cluster-messages');
        elements.clusterMessageInput = document.getElementById('cluster-message-input');
        elements.clusterTargetHint = document.getElementById('cluster-target-hint');
        elements.btnSendCluster = document.getElementById('btn-send-cluster');
        elements.btnStopCluster = document.getElementById('btn-stop-cluster');
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
        elements.clusterPresetSummary = document.getElementById('cluster-preset-summary');
        elements.clusterEditorAgentPicker = document.getElementById('cluster-editor-agent-picker');
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
        elements.formAgentSettings = document.getElementById('form-agent-settings');
        elements.agentSkillsPicker = document.getElementById('settings-agent-skills');
        elements.agentSkillsHint = document.getElementById('settings-agent-skills-hint');
        elements.agentSkillLinks = document.getElementById('settings-agent-skill-links');
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
            elements.clusterEditorRounds
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

    function updateUIText() {
        if (!window.OpenClawI18n) return;
        
        // Update placeholders and buttons
        if (elements.messageInput) {
            elements.messageInput.placeholder = t('chat.placeholder');
        }
        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.placeholder = t('clusters.chatPlaceholder');
        }
        if (elements.channelMessageInput) {
            elements.channelMessageInput.placeholder = t('channel.chatPlaceholder');
        }
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
        if (elements.btnClear) {
            elements.btnClear.title = t('chat.clear');
        }
        if (elements.btnNewAgent) {
            elements.btnNewAgent.innerHTML = `<span class="icon">+</span> ${t('sidebar.newAgent')}`;
        }
        
        // Update sidebar titles
        const sidebarAgents = document.querySelector('[data-i18n="sidebar.agents"]');
        if (sidebarAgents) sidebarAgents.textContent = t('sidebar.agents');
        
        const sidebarClusters = document.querySelector('[data-i18n="sidebar.clusters"]');
        if (sidebarClusters) sidebarClusters.textContent = t('sidebar.clusters');
        
        const sidebarUsage = document.querySelector('[data-i18n="sidebar.usage"]');
        if (sidebarUsage) sidebarUsage.textContent = t('sidebar.usage');
        
        // Update all data-i18n elements
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = t(key);
            }
        });
        
        // Update placeholder attributes
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.placeholder = t(key);
            }
        });

        updateConnectionBadge();
        renderConsoleOverview();
        renderConnectionSetup();
        renderOpenClawConfig();
        updateOpenClawConfigEntryState();
        renderClusterWorkspace();
        renderChannelWorkspace();
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
        setAgentPresets(state.agentPresets);
        renderNewAgentMode();
    }

    // View switching
    function applyView(view) {
        state.viewMode = view;

        if (view !== 'chat') {
            state.chatHomePinned = false;
            state.forceSetupPanel = false;
        }
        
        elements.navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
        elements.views.forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

        if (view === 'chat') {
            renderConnectionSetup();
            renderOpenClawConfig();
            updateChatHomeVisibility();
        }

        updateOpenClawConfigEntryState();
    }

    function switchView(view) {
        applyView(view);
        vscode.postMessage({ type: 'switchView', view });
    }

    function handleConsoleAction(action) {
        switch (action) {
            case 'new-agent':
                openNewAgentModal();
                break;
            case 'clusters':
                switchView('clusters');
                break;
            case 'tasks':
                switchView('tasks');
                break;
            case 'usage':
                switchView('usage');
                break;
            case 'console-home':
                openConsoleHome();
                break;
            case 'openclaw-config':
                toggleOpenClawConfigEntry();
                break;
            case 'report-issue':
                vscode.postMessage({ type: 'openIssueTracker' });
                break;
            case 'settings':
                vscode.postMessage({ type: 'openSettings' });
                break;
        }
    }

    function hasChatContent() {
        return Boolean(elements.chatMessages?.querySelector('.message, .context-loading'));
    }

    function updateOpenClawConfigEntryState() {
        if (!elements.btnOpenClawConfigEntry) {
            return;
        }

        elements.btnOpenClawConfigEntry.classList.toggle('active', hasChatContent() && state.chatHomePinned);
    }

    function focusOpenClawConfig() {
        window.setTimeout(() => {
            if (elements.openclawGatewayPort && !elements.consoleOpenClawConfigPanel?.classList.contains('hidden')) {
                elements.openclawGatewayPort.focus();
                if (typeof elements.openclawGatewayPort.select === 'function') {
                    elements.openclawGatewayPort.select();
                }
            }
        }, 0);
    }

    function openConsoleHome() {
        const hadChatContent = hasChatContent();
        switchView('chat');
        state.forceSetupPanel = true;
        state.chatHomePinned = hadChatContent;
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();

        if (elements.chatHome) {
            elements.chatHome.scrollTop = 0;
        }

        window.setTimeout(() => {
            elements.connectionConfigMode?.focus();
        }, 0);
    }

    function toggleOpenClawConfigEntry() {
        const hadChatContent = hasChatContent();
        switchView('chat');
        state.forceSetupPanel = false;
        state.chatHomePinned = hadChatContent ? !state.chatHomePinned : false;
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();

        if (!hadChatContent || state.chatHomePinned) {
            focusOpenClawConfig();
        }
    }

    function getRuntimeDiagnostics() {
        return state.runtime.diagnostics || null;
    }

    function getOpenClawConfigState() {
        return state.runtime.openClawConfig || null;
    }

    function hasDetectedGateway(diagnostics) {
        return Boolean(diagnostics?.detectedGatewayUrl || diagnostics?.detectedGatewayToken);
    }

    function resolveConnectionFormState(diagnostics) {
        return {
            configMode: diagnostics?.configMode || 'auto',
            gatewayUrl: diagnostics?.configuredGatewayUrl || diagnostics?.detectedGatewayUrl || DEFAULT_GATEWAY_URL,
            gatewayToken: diagnostics?.configuredGatewayToken || diagnostics?.detectedGatewayToken || ''
        };
    }

    function syncConnectionForm(force = false) {
        if (!elements.connectionConfigMode || !elements.connectionGatewayUrl || !elements.connectionGatewayToken) {
            return;
        }

        if (state.connectionFormDirty && !force) {
            updateDetectedGatewayButton();
            return;
        }

        const formState = resolveConnectionFormState(getRuntimeDiagnostics());
        elements.connectionConfigMode.value = formState.configMode;
        elements.connectionGatewayUrl.value = formState.gatewayUrl;
        elements.connectionGatewayToken.value = formState.gatewayToken;
        updateDetectedGatewayButton();
    }

    function updateDetectedGatewayButton() {
        if (!elements.btnUseDetectedGateway) {
            return;
        }

        elements.btnUseDetectedGateway.disabled = !hasDetectedGateway(getRuntimeDiagnostics());
    }

    function collectConnectionSettings() {
        return {
            configMode: elements.connectionConfigMode?.value || 'auto',
            gatewayUrl: elements.connectionGatewayUrl?.value?.trim() || '',
            gatewayToken: elements.connectionGatewayToken?.value?.trim() || ''
        };
    }

    function saveConnectionSettings() {
        state.connectionSettingsStatus = null;
        renderConnectionSetupStatus();
        vscode.postMessage({
            type: 'saveConnectionSettings',
            settings: collectConnectionSettings()
        });
    }

    function applyDetectedGatewayValues() {
        const diagnostics = getRuntimeDiagnostics();
        if (!hasDetectedGateway(diagnostics)) {
            return;
        }

        if (elements.connectionConfigMode) {
            elements.connectionConfigMode.value = 'gateway';
        }
        if (elements.connectionGatewayUrl && diagnostics?.detectedGatewayUrl) {
            elements.connectionGatewayUrl.value = diagnostics.detectedGatewayUrl;
        }
        if (elements.connectionGatewayToken) {
            elements.connectionGatewayToken.value = diagnostics?.detectedGatewayToken || '';
        }

        state.connectionFormDirty = true;
        state.connectionSettingsStatus = null;
        renderConnectionSetup();
    }

    function setConnectionSetupStatus(kind, text) {
        window.OpenClawPanelFeedback.setConnectionSetupStatus(state, elements, kind, text);
    }

    function renderConnectionSetupStatus() {
        window.OpenClawPanelFeedback.renderConnectionSetupStatus(state, elements);
    }

    function setInstallGuideStatus(kind, text) {
        state.installGuideStatus = text ? { kind, text } : null;
        renderInstallGuideStatus();
    }

    function renderInstallGuideStatus() {
        if (!elements.installGuideStatus) {
            return;
        }

        const status = state.installGuideStatus;
        elements.installGuideStatus.classList.toggle('hidden', !status);
        elements.installGuideStatus.classList.toggle('success', status?.kind === 'success');
        elements.installGuideStatus.classList.toggle('error', status?.kind === 'error');
        elements.installGuideStatus.textContent = status?.text || '';
    }

    function resolveConnectionHint(t, diagnostics) {
        if (diagnostics?.detectedGatewayUrl) {
            const source = diagnostics.detectedConfigPath || diagnostics.detectedStateDir || '';
            if (source) {
                return t('setup.hintDetectedGatewayWithSource', {
                    url: diagnostics.detectedGatewayUrl,
                    source
                });
            }

            return t('setup.hintDetectedGateway', {
                url: diagnostics.detectedGatewayUrl
            });
        }

        if (diagnostics?.configuredGatewayUrl) {
            return t('setup.hintConfiguredGateway', {
                url: diagnostics.configuredGatewayUrl
            });
        }

        return t('setup.hintNoGatewayDetected', {
            defaultUrl: DEFAULT_GATEWAY_URL
        });
    }

    function resolveInstallGuideState(t, diagnostics) {
        if (diagnostics?.openClawInstalled) {
            return t('setup.installStateDetected', {
                path: diagnostics.detectedCliEntryPath || diagnostics.detectedNodePath || ''
            });
        }

        return t('setup.installStateNotDetected');
    }

    function renderInstallGuideCard(t, diagnostics, showSetupPanel) {
        const isInstalled = Boolean(diagnostics?.openClawInstalled);

        if (elements.consoleInstallGuide) {
            elements.consoleInstallGuide.classList.toggle('hidden', !showSetupPanel);
        }
        if (!showSetupPanel) {
            return;
        }

        if (elements.installGuideTitle) {
            elements.installGuideTitle.textContent = t(isInstalled ? 'setup.startTitle' : 'setup.installTitle');
        }
        if (elements.installGuideSummary) {
            elements.installGuideSummary.textContent = t(isInstalled ? 'setup.startSummary' : 'setup.installSummary');
        }
        if (elements.installGuideState) {
            elements.installGuideState.textContent = resolveInstallGuideState(t, diagnostics);
        }
        if (elements.installCommand) {
            elements.installCommand.textContent = INSTALL_COMMAND;
        }
        if (elements.onboardCommand) {
            elements.onboardCommand.textContent = ONBOARD_COMMAND;
        }
        if (elements.startCommand) {
            elements.startCommand.textContent = START_OPENCLAW_COMMAND;
        }
        if (elements.installCommandBlock) {
            elements.installCommandBlock.classList.toggle('hidden', isInstalled);
        }
        if (elements.onboardCommandBlock) {
            elements.onboardCommandBlock.classList.toggle('hidden', isInstalled);
        }
        if (elements.startCommandBlock) {
            elements.startCommandBlock.classList.toggle('hidden', !isInstalled);
        }
        if (elements.btnStartOpenClaw) {
            elements.btnStartOpenClaw.classList.toggle('hidden', !isInstalled);
            elements.btnStartOpenClaw.disabled = !isInstalled || state.installGuideBusy;
        }
        if (elements.installGuideFootnote) {
            elements.installGuideFootnote.textContent = t(isInstalled ? 'setup.startStepRetry' : 'setup.installStepRetry');
        }

        renderInstallGuideStatus();
    }

    function startOpenClaw() {
        state.installGuideBusy = true;
        setInstallGuideStatus(null, '');
        renderConnectionSetup();
        vscode.postMessage({ type: 'startOpenClaw' });
    }

    function renderConnectionSetup() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (!vars) {
                return key;
            }
            return Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);
        };
        const diagnostics = getRuntimeDiagnostics();
        const showSetupPanel = state.forceSetupPanel || !state.runtime.connected || state.agents.length === 0;

        if (elements.consoleSetupPanel) {
            elements.consoleSetupPanel.classList.toggle('hidden', !showSetupPanel);
        }

        syncConnectionForm();

        if (elements.connectionSettingsHint) {
            elements.connectionSettingsHint.textContent = resolveConnectionHint(t, diagnostics);
        }

        renderInstallGuideCard(t, diagnostics, showSetupPanel);

        renderConnectionSetupStatus();
    }

    function shouldShowOpenClawConfigPanel() {
        const diagnostics = getRuntimeDiagnostics();
        return Boolean(
            getOpenClawConfigState()
            || diagnostics?.configMode === 'openclaw'
            || diagnostics?.configuredStateDir
            || diagnostics?.detectedStateDir
            || diagnostics?.openClawInstalled
        );
    }

    function resolveOpenClawConfigFormState() {
        const openClawConfig = getOpenClawConfigState();
        const diagnostics = getRuntimeDiagnostics();
        return {
            stateDir: openClawConfig?.stateDir || diagnostics?.configuredStateDir || diagnostics?.detectedStateDir || '',
            configPath: openClawConfig?.configPath || diagnostics?.detectedConfigPath || '',
            authProfilesPath: openClawConfig?.authProfilesPath || '',
            gatewayPort: String(openClawConfig?.gatewayPort || 18789),
            gatewayToken: openClawConfig?.gatewayToken || '',
            defaultWorkspace: openClawConfig?.defaultWorkspace || '',
            defaultModel: openClawConfig?.defaultModel || '',
            authProviderId: openClawConfig?.authProviderId || '',
            authApiKey: openClawConfig?.authApiKey || '',
            authProviders: Array.isArray(openClawConfig?.authProviders) ? openClawConfig.authProviders : [],
            defaultModelSuggestionsByProvider: openClawConfig?.defaultModelSuggestionsByProvider || {}
        };
    }

    function inferOpenClawProviderIdFromModel(modelRef) {
        const normalizedModelRef = String(modelRef || '').trim();
        if (!normalizedModelRef) {
            return '';
        }

        const slashIndex = normalizedModelRef.indexOf('/');
        if (slashIndex <= 0) {
            return '';
        }

        return normalizedModelRef.slice(0, slashIndex).trim();
    }

    function resolveOpenClawAuthProviderIdFromForm() {
        const selectedProviderId = elements.openclawAuthProvider?.value?.trim() || '';
        if (selectedProviderId === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE) {
            return elements.openclawAuthProviderCustom?.value?.trim() || '';
        }

        return selectedProviderId;
    }

    function resolveOpenClawDefaultModelFromForm() {
        const selectedModelRef = elements.openclawDefaultModel?.value?.trim() || '';
        if (selectedModelRef === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE) {
            return elements.openclawDefaultModelCustom?.value?.trim() || '';
        }

        return selectedModelRef;
    }

    function syncOpenClawAuthProviderCustomVisibility(selectedProviderId) {
        if (!elements.openclawAuthProviderCustom) {
            return;
        }

        const nextValue = selectedProviderId ?? (elements.openclawAuthProvider?.value?.trim() || '');
        const shouldShowCustomProvider = nextValue === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE;

        elements.openclawAuthProviderCustom.classList.toggle('hidden', !shouldShowCustomProvider);
        elements.openclawAuthProviderCustom.disabled = !shouldShowCustomProvider;

        if (!shouldShowCustomProvider) {
            elements.openclawAuthProviderCustom.value = '';
        }
    }

    function syncOpenClawDefaultModelCustomVisibility(selectedModelRef) {
        if (!elements.openclawDefaultModelCustom) {
            return;
        }

        const nextValue = selectedModelRef ?? (elements.openclawDefaultModel?.value?.trim() || '');
        const shouldShowCustomModel = nextValue === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE;

        elements.openclawDefaultModelCustom.classList.toggle('hidden', !shouldShowCustomModel);
        elements.openclawDefaultModelCustom.disabled = !shouldShowCustomModel;

        if (!shouldShowCustomModel) {
            elements.openclawDefaultModelCustom.value = '';
        }
    }

    function refreshOpenClawDefaultModelOptions() {
        const formState = resolveOpenClawConfigFormState();
        renderOpenClawDefaultModelOptions(
            formState.defaultModelSuggestionsByProvider,
            resolveOpenClawAuthProviderIdFromForm() || inferOpenClawProviderIdFromModel(resolveOpenClawDefaultModelFromForm()),
            resolveOpenClawDefaultModelFromForm()
        );
    }

    function syncOpenClawConfigForm(force = false) {
        if (
            !elements.openclawStateDir
            || !elements.openclawConfigPath
            || !elements.openclawAuthProfilesPath
            || !elements.openclawGatewayPort
            || !elements.openclawGatewayToken
            || !elements.openclawDefaultWorkspace
            || !elements.openclawDefaultModel
            || !elements.openclawDefaultModelCustom
            || !elements.openclawAuthProvider
            || !elements.openclawAuthProviderCustom
            || !elements.openclawAuthApiKey
        ) {
            return;
        }

        if (state.openClawConfigFormDirty && !force) {
            return;
        }

        const formState = resolveOpenClawConfigFormState();
        elements.openclawStateDir.value = formState.stateDir;
        elements.openclawConfigPath.value = formState.configPath;
        elements.openclawAuthProfilesPath.value = formState.authProfilesPath;
        elements.openclawGatewayPort.value = formState.gatewayPort;
        elements.openclawGatewayToken.value = formState.gatewayToken;
        elements.openclawDefaultWorkspace.value = formState.defaultWorkspace;
        elements.openclawAuthApiKey.value = formState.authApiKey;
        renderOpenClawAuthProviderOptions(formState.authProviders, formState.authProviderId);
        renderOpenClawDefaultModelOptions(
            formState.defaultModelSuggestionsByProvider,
            formState.authProviderId || inferOpenClawProviderIdFromModel(formState.defaultModel),
            formState.defaultModel
        );
    }

    function collectOpenClawConfigSettings() {
        return {
            gatewayPort: elements.openclawGatewayPort?.value?.trim() || '',
            gatewayToken: elements.openclawGatewayToken?.value?.trim() || '',
            defaultWorkspace: elements.openclawDefaultWorkspace?.value?.trim() || '',
            defaultModel: resolveOpenClawDefaultModelFromForm(),
            authProviderId: resolveOpenClawAuthProviderIdFromForm(),
            authApiKey: elements.openclawAuthApiKey?.value?.trim() || ''
        };
    }

    function validateOpenClawConfigSettings(settings) {
        const gatewayPort = Number(settings.gatewayPort);
        if (!Number.isInteger(gatewayPort) || gatewayPort <= 0 || gatewayPort > 65535) {
            return {
                ok: false,
                message: window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.invalidPort') : 'Gateway port must be an integer between 1 and 65535.'
            };
        }

        if (settings.authApiKey && !settings.authProviderId) {
            return {
                ok: false,
                message: window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.authProviderRequired') : 'Choose or enter a provider before saving an API key.'
            };
        }

        return {
            ok: true,
            settings: {
                gatewayPort,
                gatewayToken: settings.gatewayToken,
                defaultWorkspace: settings.defaultWorkspace,
                defaultModel: settings.defaultModel,
                authProviderId: settings.authProviderId,
                authApiKey: settings.authApiKey
            }
        };
    }

    function saveOpenClawConfig() {
        state.openClawConfigStatus = null;
        renderOpenClawConfigStatus();
        const validation = validateOpenClawConfigSettings(collectOpenClawConfigSettings());
        if (!validation.ok) {
            setOpenClawConfigStatus('error', validation.message);
            return;
        }

        vscode.postMessage({
            type: 'saveOpenClawConfig',
            settings: validation.settings
        });
    }

    function setOpenClawConfigStatus(kind, text) {
        state.openClawConfigStatus = text ? { kind, text } : null;
        renderOpenClawConfigStatus();
    }

    function renderOpenClawConfigStatus() {
        if (!elements.openclawConfigStatus) {
            return;
        }

        const status = state.openClawConfigStatus;
        elements.openclawConfigStatus.classList.toggle('hidden', !status);
        elements.openclawConfigStatus.classList.toggle('success', status?.kind === 'success');
        elements.openclawConfigStatus.classList.toggle('error', status?.kind === 'error');
        elements.openclawConfigStatus.textContent = status?.text || '';
    }

    function resolveOpenClawConfigHint(t, openClawConfig) {
        if (!openClawConfig) {
            return t('setup.openclawConfig.hintUnavailable');
        }

        if (openClawConfig.exists && openClawConfig.authProfilesExists) {
            return t('setup.openclawConfig.hintExistingWithAuth', {
                path: openClawConfig.configPath,
                authPath: openClawConfig.authProfilesPath
            });
        }

        if (openClawConfig.exists) {
            return t('setup.openclawConfig.hintExisting', {
                path: openClawConfig.configPath
            });
        }

        if (openClawConfig.authProfilesExists) {
            return t('setup.openclawConfig.hintCreateWithAuth', {
                path: openClawConfig.configPath,
                authPath: openClawConfig.authProfilesPath
            });
        }

        return t('setup.openclawConfig.hintCreate', {
            path: openClawConfig.configPath
        });
    }

    function renderOpenClawAuthProviderOptions(authProviders, selectedProviderId = '') {
        if (!elements.openclawAuthProvider) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const normalizedProviderIds = Array.from(new Set((authProviders || [])
            .map(providerId => String(providerId || '').trim())
            .filter(Boolean)))
            .sort((left, right) => left.localeCompare(right));
        const resolvedSelectedProviderId = selectedProviderId && normalizedProviderIds.includes(selectedProviderId)
            ? selectedProviderId
            : selectedProviderId
                ? CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE
                : '';

        elements.openclawAuthProvider.innerHTML = [
            `<option value="">${escapeHtml(t('setup.openclawConfig.authProviderSelectPlaceholder'))}</option>`,
            ...normalizedProviderIds.map(providerId => `<option value="${escapeHtml(providerId)}">${escapeHtml(providerId)}</option>`),
            `<option value="${CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE}">${escapeHtml(t('setup.openclawConfig.authProviderCustomOption'))}</option>`
        ].join('');
        elements.openclawAuthProvider.value = resolvedSelectedProviderId;

        if (resolvedSelectedProviderId === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE && elements.openclawAuthProviderCustom) {
            elements.openclawAuthProviderCustom.value = selectedProviderId;
        }

        syncOpenClawAuthProviderCustomVisibility(resolvedSelectedProviderId);
    }

    function renderOpenClawDefaultModelOptions(defaultModelSuggestionsByProvider, providerId, selectedModelRef = '') {
        if (!elements.openclawDefaultModel) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const resolvedProviderId = String(providerId || '').trim();
        const providerSuggestions = Array.from(new Set((defaultModelSuggestionsByProvider?.[resolvedProviderId] || [])
            .map(modelRef => String(modelRef || '').trim())
            .filter(Boolean)));
        const resolvedSelectedModelRef = selectedModelRef && providerSuggestions.includes(selectedModelRef)
            ? selectedModelRef
            : selectedModelRef
                ? CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE
                : '';

        elements.openclawDefaultModel.innerHTML = [
            `<option value="">${escapeHtml(t('setup.openclawConfig.defaultModelSelectPlaceholder'))}</option>`,
            ...providerSuggestions.map(modelRef => `<option value="${escapeHtml(modelRef)}">${escapeHtml(modelRef)}</option>`),
            `<option value="${CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE}">${escapeHtml(t('setup.openclawConfig.defaultModelCustomOption'))}</option>`
        ].join('');
        elements.openclawDefaultModel.value = resolvedSelectedModelRef;

        if (resolvedSelectedModelRef === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE && elements.openclawDefaultModelCustom) {
            elements.openclawDefaultModelCustom.value = selectedModelRef;
        }

        syncOpenClawDefaultModelCustomVisibility(resolvedSelectedModelRef);
    }

    function renderOpenClawConfig() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (!vars) {
                return key;
            }
            return Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);
        };
        const shouldShow = shouldShowOpenClawConfigPanel();
        const openClawConfig = getOpenClawConfigState();

        if (elements.consoleOpenClawConfigPanel) {
            elements.consoleOpenClawConfigPanel.classList.toggle('hidden', !shouldShow);
        }

        if (!shouldShow) {
            return;
        }

        syncOpenClawConfigForm();

        if (elements.openclawConfigHint) {
            elements.openclawConfigHint.textContent = resolveOpenClawConfigHint(t, openClawConfig);
        }

        renderOpenClawConfigStatus();
    }

    async function copySetupCommand(kind) {
        const command = kind === 'onboard'
            ? ONBOARD_COMMAND
            : kind === 'start'
                ? START_OPENCLAW_COMMAND
                : INSTALL_COMMAND;

        try {
            await copyTextToClipboard(command);
            setConnectionSetupStatus(
                'success',
                (window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusCopied') : 'Copied command to clipboard.')
            );
        } catch (error) {
            setConnectionSetupStatus(
                'error',
                String(error instanceof Error ? error.message : error)
            );
        }
    }

    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const copied = document.execCommand('copy');
            if (!copied) {
                throw new Error('Copy command failed.');
            }
        } finally {
            textarea.remove();
        }
    }

    function resolveRuntimeModeLabel(t) {
        switch (state.runtime.mode) {
            case 'openclaw':
                return t('console.mode.openclaw');
            case 'local':
                return t('console.mode.local');
            case 'gateway':
            default:
                return t('console.mode.gateway');
        }
    }

    function updateConnectionBadge() {
        if (!elements.connectionStatus || !elements.connectionLabel || !elements.connectionCaption || !elements.connectionPill) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const connected = Boolean(state.runtime.connected);
        const statusKey = connected ? 'console.connected' : 'console.disconnected';
        const modeLabel = resolveRuntimeModeLabel(t);

        elements.connectionStatus.classList.toggle('online', connected);
        elements.connectionStatus.classList.toggle('offline', !connected);
        elements.connectionPill.classList.toggle('online', connected);
        elements.connectionPill.classList.toggle('offline', !connected);
        elements.connectionLabel.textContent = t(statusKey);
        elements.connectionCaption.textContent = state.runtime.sourceDescription || modeLabel;
    }

    function supportsRuntimeCapability(capabilityId) {
        return Boolean(state.runtime.capabilities?.supports?.[capabilityId]);
    }

    function resolveCapabilityUnavailableMessage(capabilityId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        switch (capabilityId) {
            case 'agentEditing':
                return t('capability.unavailable.agentEditing');
            case 'scheduledTasks':
                return t('capability.unavailable.scheduledTasks');
            case 'liveSessionSync':
                return t('capability.unavailable.liveSessionSync');
            case 'swarmWorkspace':
                return t('capability.unavailable.swarmWorkspace');
            default:
                return t('capability.unavailable.generic', { capability: capabilityId });
        }
    }

    function renderCapabilityMatrix() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const capabilities = state.runtime.capabilities || null;
        const matrix = Array.isArray(state.runtime.capabilityMatrix) ? state.runtime.capabilityMatrix : [];
        const currentMode = state.runtime.mode || 'gateway';

        if (elements.consoleCapabilityTitle) {
            elements.consoleCapabilityTitle.textContent = capabilities?.currentModeTitleKey
                ? t(capabilities.currentModeTitleKey)
                : resolveRuntimeModeLabel(t);
        }

        if (elements.consoleCapabilityBody) {
            elements.consoleCapabilityBody.textContent = capabilities?.currentModeBodyKey
                ? t(capabilities.currentModeBodyKey)
                : resolveRuntimeModeLabel(t);
        }

        if (!elements.consoleCapabilityMatrix) {
            return;
        }

        elements.consoleCapabilityMatrix.innerHTML = matrix.map(row => {
            const title = t(row.titleKey);
            const summary = t(row.summaryKey);
            const cells = ['gateway', 'openclaw', 'local'].map(mode => {
                const cell = row.modes?.[mode] || { support: 'unavailable', noteKey: '' };
                const supportLabel = t(`capability.support.${cell.support}`);
                const note = cell.noteKey ? t(cell.noteKey) : '';
                return `
                    <td class="console-capability-cell ${escapeHtml(cell.support)}${mode === currentMode ? ' current' : ''}">
                        <span class="capability-support-badge ${escapeHtml(cell.support)}">${escapeHtml(supportLabel)}</span>
                        <div class="capability-support-note">${escapeHtml(note)}</div>
                    </td>
                `;
            }).join('');

            return `
                <tr>
                    <th scope="row">
                        <div class="capability-row-title">${escapeHtml(title)}</div>
                    </th>
                    <td>
                        <div class="capability-row-summary">${escapeHtml(summary)}</div>
                    </td>
                    ${cells}
                </tr>
            `;
        }).join('');
    }

    function renderConsoleOverview() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const modeLabel = resolveRuntimeModeLabel(t);
        const selectedAgent = state.agents.find(agent => agent.id === state.currentAgentId) || null;

        if (elements.consoleSummary) {
            if (state.agents.length === 0) {
                elements.consoleSummary.textContent = t('console.summaryNoAgents');
            } else if (state.runtime.connected) {
                elements.consoleSummary.textContent = t('console.summaryConnected', { mode: modeLabel });
            } else {
                elements.consoleSummary.textContent = t('console.summaryDisconnected', { mode: modeLabel });
            }
        }

        if (elements.consoleConnectionValue) {
            elements.consoleConnectionValue.textContent = t(state.runtime.connected ? 'console.connected' : 'console.disconnected');
        }
        if (elements.consoleConnectionMeta) {
            elements.consoleConnectionMeta.textContent = state.runtime.sourceDescription || modeLabel;
        }

        if (elements.consoleModeValue) {
            elements.consoleModeValue.textContent = modeLabel;
        }
        if (elements.consoleModeMeta) {
            elements.consoleModeMeta.textContent = state.runtime.capabilities?.currentModeTitleKey
                ? t(state.runtime.capabilities.currentModeTitleKey)
                : t(state.runtime.supportsLiveSync ? 'console.liveSync' : 'console.liveSyncDisabled');
        }

        if (elements.consoleAgentsValue) {
            elements.consoleAgentsValue.textContent = String(state.agents.length);
        }
        if (elements.consoleAgentsMeta) {
            elements.consoleAgentsMeta.textContent = selectedAgent
                ? t('console.currentAgent', { name: selectedAgent.name })
                : t('sidebar.noAgents');
        }

        if (elements.consoleTasksValue) {
            if (!state.runtime.supportsTasks) {
                elements.consoleTasksValue.textContent = t('console.unavailable');
            } else if (!state.tasksLoaded) {
                elements.consoleTasksValue.textContent = t('common.loading');
            } else {
                elements.consoleTasksValue.textContent = String(state.tasks.length);
            }
        }
        if (elements.consoleTasksMeta) {
            if (!state.runtime.supportsTasks) {
                elements.consoleTasksMeta.textContent = t('console.requiresCli');
            } else if (!state.tasksLoaded) {
                elements.consoleTasksMeta.textContent = t('tasks.note');
            } else if (state.tasks.length === 0) {
                elements.consoleTasksMeta.textContent = t('tasks.empty');
            } else {
                elements.consoleTasksMeta.textContent = t('console.tasksReady', { count: state.tasks.length });
            }
        }

        if (elements.consoleNextSteps) {
            elements.consoleNextSteps.innerHTML = buildConsoleSteps(t).map((step, index) => `
                <div class="console-step">
                    <span class="console-step-index">${index + 1}</span>
                    <div class="console-step-copy">
                        <div class="console-step-title">${escapeHtml(step.title)}</div>
                        <div class="console-step-text">${escapeHtml(step.text)}</div>
                    </div>
                </div>
            `).join('');
        }

        renderCapabilityMatrix();
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();
    }

    function buildConsoleSteps(t) {
        const steps = [];

        if (!state.runtime.connected) {
            steps.push({
                title: t('console.stepCheckConnectionTitle'),
                text: t('console.stepCheckConnection')
            });
        }

        if (state.agents.length === 0) {
            steps.push({
                title: t('console.stepCreateAgentTitle'),
                text: t('console.stepCreateAgent')
            });
        } else {
            steps.push({
                title: t('console.stepSendMessageTitle'),
                text: t('console.stepSendMessage')
            });
        }

        if (!state.runtime.supportsTasks) {
            steps.push({
                title: t('console.stepEnableTasksTitle'),
                text: t('console.stepEnableTasks')
            });
        } else {
            steps.push({
                title: t('console.stepScheduleTitle'),
                text: t('console.stepSchedule')
            });
        }

        steps.push(state.clusters.length === 0 ? {
            title: t('console.stepCreateClusterTitle'),
            text: t('console.stepCreateCluster')
        } : {
            title: t('console.stepCompareAgentsTitle'),
            text: t('console.stepCompareAgents')
        });

        return steps.slice(0, 4);
    }

    function updateChatHomeVisibility() {
        if (!elements.chatHome || !elements.chatMessages) {
            return;
        }

        const hasMessages = hasChatContent();
        if (!hasMessages) {
            state.chatHomePinned = false;
        }

        elements.chatHome.classList.toggle('hidden', hasMessages && !state.chatHomePinned);
        updateOpenClawConfigEntryState();
    }

    // Send message
    function sendMessage() {
        const content = normalizeOutgoingMessage(elements.messageInput?.value || '');
        if (!content.trim() || state.isStreaming) return;
        
        if (!state.currentAgentId) {
            showError(window.OpenClawI18n ? window.OpenClawI18n.t('panel.selectAgentFirst') : 'Please select an agent first');
            return;
        }
        
        elements.messageInput.value = '';
        resetTransientChatState();
        
        // Add user message
        addMessage({
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });
        
        // Show thinking indicator
        showThinkingIndicator();
        
        state.isStreaming = true;
        elements.btnSend.disabled = true;
        updateChatInputState();
        
        vscode.postMessage({
            type: 'sendMessage',
            content,
            agentId: state.currentAgentId,
            optimistic: true
        });
    }

    function normalizeOutgoingMessage(content) {
        return String(content || '').replace(/\r\n?/g, '\n');
    }

    function updateChatInputState() {
        if (elements.btnSend) {
            elements.btnSend.disabled = state.isStreaming;
        }

        if (elements.btnStop) {
            elements.btnStop.classList.toggle('hidden', !state.isStreaming);
            elements.btnStop.disabled = !state.isStreaming;
        }
    }

    function stopChatRun() {
        if (!state.isStreaming) {
            return;
        }

        resetTransientChatState();
        updateChatInputState();
        vscode.postMessage({ type: 'stopActiveRun', scope: 'chat' });
    }

    function sendClusterMessage() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            showError(window.OpenClawI18n ? window.OpenClawI18n.t('clusters.emptyWorkspace') : 'Select a cluster first');
            return;
        }

        const content = normalizeOutgoingMessage(elements.clusterMessageInput?.value || '');
        if (!content.trim()) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        if (conversation.loading || conversation.pending) {
            return;
        }

        conversation.messages.push({
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            contextLabel: target.kind === 'swarm'
                ? (window.OpenClawI18n ? window.OpenClawI18n.t(target.mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate') : target.mode)
                : resolveClusterAgentLabel(target.agentId)
        });
        conversation.pending = true;

        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.value = '';
        }

        renderCurrentClusterConversation();
        updateClusterInputState(cluster);

        if (target.kind === 'agent') {
            vscode.postMessage({
                type: 'sendClusterAgentMessage',
                clusterId: cluster.id,
                agentId: target.agentId,
                content
            });
            return;
        }

        vscode.postMessage({
            type: target.mode === 'broadcast' ? 'broadcastToCluster' : 'collaborateCluster',
            clusterId: cluster.id,
            message: content
        });
    }

    // Show thinking indicator
    function showThinkingIndicator() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        
        const div = document.createElement('div');
        div.className = 'message message-thinking thinking-indicator';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${t('chat.thinking')}</span>
                <span class="thinking-dots">
                    <span></span><span></span><span></span>
                </span>
            </div>
            <div class="thinking-content">
                <div class="thinking-line">${t('thinking.started')}</div>
            </div>
        `;
        
        elements.chatMessages.appendChild(div);
        scrollToBottom();
        
        state.currentThinking = div;
    }

    function clearThinkingIndicator() {
        if (!state.currentThinking) return;
        state.currentThinking.remove();
        state.currentThinking = null;
    }

    function resetTransientChatState() {
        clearThinkingIndicator();
        document.querySelector('.message-streaming')?.remove();
        pendingStreamingRender = null;
        if (streamRenderFrame !== null) {
            window.cancelAnimationFrame(streamRenderFrame);
            streamRenderFrame = null;
        }
        activeTraceContainer = null;
        finalizeStreamingState();
    }

    // Update thinking content
    function updateThinking(content) {
        if (!state.currentThinking) return;
        
        const thinkingContent = state.currentThinking.querySelector('.thinking-content');
        if (thinkingContent) {
            thinkingContent.innerHTML = `<div class="message-content thinking-markdown">${formatContent(String(content || ''))}</div>`;
        }
    }

    // Hide thinking and show response
    function finalizeThinking(content) {
        clearThinkingIndicator();
        
        addMessage({
            role: 'assistant',
            content,
            timestamp: new Date().toISOString()
        });
    }

    function finalizeStreamingState() {
        state.isStreaming = false;
        updateChatInputState();
    }

    function finalizeStreamingMessage() {
        clearThinkingIndicator();
        pendingStreamingRender = null;
        if (streamRenderFrame !== null) {
            window.cancelAnimationFrame(streamRenderFrame);
            streamRenderFrame = null;
        }

        const streamingMsg = document.querySelector('.message-streaming');
        if (streamingMsg) {
            streamingMsg.classList.remove('message-streaming');
            const indicator = streamingMsg.querySelector('.streaming-indicator');
            if (indicator) {
                indicator.remove();
            }
        }

        finalizeStreamingState();
    }

    function rememberRenderedMessageId(msg, renderedIds) {
        const messageId = typeof msg?.id === 'string' ? msg.id.trim() : '';
        if (!messageId) {
            return false;
        }

        if (renderedIds.has(messageId)) {
            return true;
        }

        renderedIds.add(messageId);
        return false;
    }

    // Add message to chat
    function addMessage(msg) {
        if (!msg) return;
        if (rememberRenderedMessageId(msg, renderedChatMessageIds)) return;
        if (shouldHideMessage(msg)) return;

        if ((msg.role === 'assistant' || msg.role === 'tool') && state.currentThinking) {
            clearThinkingIndicator();
        }

        if (msg.role === 'user') {
            activeTraceContainer = null;
            appendStandaloneMessage(msg);
            if (!isBulkRenderingChat) {
                updateChatHomeVisibility();
            }
            return;
        }

        if (shouldAppendToTrace(msg)) {
            appendTraceMessage(msg);
            if (!isBulkRenderingChat) {
                updateChatHomeVisibility();
            }
            return;
        }

        activeTraceContainer = null;
        appendStandaloneMessage(msg);
        if (!isBulkRenderingChat) {
            updateChatHomeVisibility();
        }
    }

    function appendStandaloneMessage(msg) {
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;
        
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const rendered = renderMessageContent(msg);
        
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${getMessageRoleLabel(msg)}</span>
                <span class="message-time">${time}</span>
                ${tokenInfo}
            </div>
            ${rendered}
        `;
        
        elements.chatMessages.appendChild(div);
        if (!isBulkRenderingChat) {
            scrollToBottom();
        }

        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            state.isStreaming = false;
            if (elements.btnSend) {
                elements.btnSend.disabled = false;
            }
        }
    }

    function appendTraceMessage(msg) {
        const container = getOrCreateTraceContainer(msg);
        const body = container.querySelector('.trace-body');
        if (!body) {
            return;
        }

        if (msg.role === 'tool') {
            const toolContext = getToolResultContext(msg);
            const pendingCard = findPendingToolCard(body, toolContext.toolCallId, toolContext.toolName);
            if (pendingCard) {
                const rendered = document.createElement('div');
                rendered.innerHTML = renderToolMessage(msg, toolContext.parts).trim();
                const nextCard = rendered.firstElementChild;
                if (nextCard) {
                    pendingCard.replaceWith(nextCard);
                    if (!isBulkRenderingChat) {
                        scrollToBottom();
                    }
                    return;
                }
            }
        }

        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        if (!isBulkRenderingChat) {
            scrollToBottom();
        }

        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            activeTraceContainer = null;
            state.isStreaming = false;
            if (elements.btnSend) {
                elements.btnSend.disabled = false;
            }
        }
    }

    function getOrCreateTraceContainer(msg) {
        if (activeTraceContainer?.isConnected) {
            return activeTraceContainer;
        }

        const div = document.createElement('div');
        div.className = 'message message-assistant message-trace';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">Assistant</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="trace-body"></div>
        `;

        elements.chatMessages.appendChild(div);
        activeTraceContainer = div;
        return div;
    }

    function renderTraceSegment(msg) {
        if (msg.role === 'tool') {
            return renderToolMessage(msg, Array.isArray(msg.parts) ? msg.parts : []);
        }

        return renderMessageContent(msg);
    }

    function shouldAppendToTrace(msg) {
        if (msg.role === 'tool') {
            return true;
        }

        if (msg.role !== 'assistant') {
            return false;
        }

        return isToolUseMessage(msg) || Boolean(activeTraceContainer);
    }

    function shouldHideMessage(msg) {
        if (!msg) {
            return false;
        }

        const hasStructuredParts = Array.isArray(msg.parts) && msg.parts.length > 0;
        if ((msg.role === 'user' || msg.role === 'assistant') && !hasStructuredParts) {
            return !getDisplayContent(msg).trim();
        }

        return false;
    }

    function renderMessageContent(msg) {
        const displayContent = getDisplayContent(msg);

        if (msg.role === 'user') {
            const envelope = parseUserInputEnvelope(displayContent);
            if (envelope) {
                return renderUserInputEnvelope(envelope);
            }

            const { mainContent, thinkingHtml } = processMessageContent(displayContent);
            return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
        }

        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
            return renderStructuredMessage(msg);
        }

        const { mainContent, thinkingHtml } = processMessageContent(displayContent);
        return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
    }

    function getDisplayContent(msg) {
        const content = String(msg?.content || '');
        if (msg?.role !== 'user') {
            return content;
        }

        return stripHiddenUserEnvelope(content);
    }

    function stripHiddenUserEnvelope(content) {
        const normalized = String(content || '').trim();
        if (!normalized) {
            return '';
        }

        if (normalized.startsWith('A new session was started via /new or /reset.')) {
            return '';
        }

        if (!normalized.startsWith('Conversation info (untrusted metadata):')) {
            return normalized;
        }

        let visible = normalized.replace(
            /^Conversation info \(untrusted metadata\):\s*/i,
            ''
        ).trim();

        visible = visible.replace(
            /^(?:```(?:json)?\s*[\r\n]+|json\s*[\r\n]+)?\{[\s\S]*?\}(?:\s*```)?\s*/i,
            ''
        ).trim();

        visible = visible.replace(/^\[[^\]]+\]\s*/, '').trim();
        return visible;
    }

    function parseUserInputEnvelope(content) {
        const normalized = String(content || '').trim();
        if (!normalized || !/\buser request\s*[:\uFF1A]/i.test(normalized)) {
            return null;
        }

        const sections = collectStructuredEnvelopeSections(normalized);
        if (sections.length === 0) {
            return null;
        }

        const requestIndex = sections.findIndex(section => isUserRequestSectionTitle(section.title));
        if (requestIndex < 0) {
            return null;
        }

        const userRequest = sections[requestIndex]?.content?.trim() || '';
        if (!userRequest) {
            return null;
        }

        const extras = sections
            .filter((_, index) => index !== requestIndex)
            .filter(section => section.content.trim().length > 0);

        return {
            raw: normalized,
            userRequest,
            extras
        };
    }

    function isUserRequestSectionTitle(title) {
        const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return normalized === 'user request';
    }

    function stopClusterRun() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        if (!conversation.pending && !conversation.loading) {
            return;
        }

        conversation.pending = false;
        conversation.loading = false;
        renderClusterWorkspace();
        vscode.postMessage({
            type: 'stopActiveRun',
            scope: target.kind === 'agent' ? 'cluster-agent' : 'cluster-swarm',
            clusterId: cluster.id,
            agentId: target.kind === 'agent' ? target.agentId : undefined,
            mode: target.kind === 'swarm' ? target.mode : undefined
        });
    }

    function bindStopButton(button, handler) {
        if (!button) {
            return;
        }

        button.addEventListener('mousedown', (e) => {
            if (e.button !== 0) {
                return;
            }

            e.preventDefault();
            handler();
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
        });
    }

    function collectStructuredEnvelopeSections(content) {
        const lines = String(content || '').split(/\r?\n/);
        const sections = [];
        let cursor = 0;

        const systemLines = [];
        while (cursor < lines.length) {
            const trimmed = lines[cursor].trim();
            if (!trimmed) {
                if (systemLines.length > 0) {
                    systemLines.push('');
                }
                cursor += 1;
                continue;
            }

            if (!trimmed.startsWith('System:')) {
                break;
            }

            systemLines.push(trimmed.replace(/^System:\s*/, ''));
            cursor += 1;
        }

        pushEnvelopeSection(sections, 'System Information', systemLines.join('\n').trim());

        const senderSection = extractNamedEnvelopeSection(lines, cursor, /^Sender\s+\(untrusted metadata\)\s*:\s*$/i, [
            /^\[[^\]]+\]/,
            /^User request\s*[:\uFF1A]/i,
            /^Current positions\s*[:\uFF1A]/i
        ]);
        if (senderSection) {
            pushEnvelopeSection(sections, 'Sender (untrusted metadata)', senderSection.content);
            cursor = senderSection.nextIndex;
        }

        const swarmContextSection = extractLeadingEnvelopeBlock(lines, cursor, /^User request\s*[:\uFF1A]/i);
        if (swarmContextSection && /^\[[^\]]+\]/.test(swarmContextSection.content.trim())) {
            pushEnvelopeSection(sections, 'Swarm Context', swarmContextSection.content);
            cursor = swarmContextSection.nextIndex;
        }

        const userRequestSection = extractNamedEnvelopeSection(lines, cursor, /^User request\s*[:\uFF1A]/i, [
            /^Current positions\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (userRequestSection) {
            pushEnvelopeSection(sections, 'User request', userRequestSection.content);
            cursor = userRequestSection.nextIndex;
        }

        const positionsSection = extractNamedEnvelopeSection(lines, cursor, /^Current positions\s*[:\uFF1A]/i, [
            /^Peer reviews\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (positionsSection) {
            pushEnvelopeSection(sections, 'Current positions', positionsSection.content);
            cursor = positionsSection.nextIndex;
        }

        const peerReviewsSection = extractNamedEnvelopeSection(lines, cursor, /^Peer reviews\s*[:\uFF1A]/i, [
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (peerReviewsSection) {
            pushEnvelopeSection(sections, 'Peer reviews', peerReviewsSection.content);
            cursor = peerReviewsSection.nextIndex;
        }

        const remainder = lines.slice(cursor).join('\n').trim();
        if (remainder) {
            const fallbackSections = collectInputEnvelopeSections(remainder);
            if (fallbackSections.length > 0) {
                fallbackSections.forEach(section => pushEnvelopeSection(sections, section.title, section.content));
            } else {
                pushEnvelopeSection(sections, 'Additional Context', remainder);
            }
        }

        return sections;
    }

    function pushEnvelopeSection(sections, title, content) {
        const normalizedTitle = String(title || '').trim();
        const normalizedContent = String(content || '').trim();
        if (!normalizedTitle || !normalizedContent) {
            return;
        }

        sections.push({
            title: normalizedTitle,
            content: normalizedContent
        });
    }

    function extractNamedEnvelopeSection(lines, startIndex, headingPattern, stopPatterns) {
        for (let index = startIndex; index < lines.length; index += 1) {
            const line = lines[index];
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            if (!headingPattern.test(trimmed)) {
                return null;
            }

            const inlineContent = trimmed.replace(headingPattern, '').trim();
            const bodyLines = [];
            if (inlineContent) {
                bodyLines.push(inlineContent);
            }

            let cursor = index + 1;
            let activeFence = null;
            while (cursor < lines.length) {
                const candidate = lines[cursor];
                const candidateTrimmed = candidate.trim();
                if (!activeFence && candidateTrimmed && stopPatterns.some(pattern => pattern.test(candidateTrimmed))) {
                    break;
                }
                bodyLines.push(candidate);
                activeFence = updateEnvelopeFenceState(activeFence, candidateTrimmed);
                cursor += 1;
            }

            return {
                content: bodyLines.join('\n').trim(),
                nextIndex: cursor
            };
        }

        return null;
    }

    function extractLeadingEnvelopeBlock(lines, startIndex, stopPattern) {
        let cursor = startIndex;
        const bodyLines = [];
        let activeFence = null;

        while (cursor < lines.length) {
            const trimmed = lines[cursor].trim();
            if (!activeFence && trimmed && stopPattern.test(trimmed)) {
                break;
            }
            bodyLines.push(lines[cursor]);
            activeFence = updateEnvelopeFenceState(activeFence, trimmed);
            cursor += 1;
        }

        const content = bodyLines.join('\n').trim();
        if (!content) {
            return null;
        }

        return {
            content,
            nextIndex: cursor
        };
    }

    function collectInputEnvelopeSections(content) {
        const sections = [];
        const leadingLines = [];
        const lines = String(content || '').split(/\r?\n/);
        let current = null;
        let activeFence = null;

        const pushCurrent = () => {
            if (!current) {
                return;
            }

            const body = current.lines.join('\n').trim();
            if (current.title && body) {
                sections.push({
                    title: current.title,
                    content: body
                });
            }
            current = null;
        };

        for (const rawLine of lines) {
            const trimmed = String(rawLine || '').trim();
            const heading = activeFence ? null : detectInputEnvelopeHeading(rawLine);
            if (heading) {
                if (current && current.title === heading.title) {
                    if (heading.inlineContent) {
                        current.lines.push(heading.inlineContent);
                    }
                    continue;
                }

                pushCurrent();
                current = {
                    title: heading.title,
                    lines: []
                };
                if (heading.inlineContent) {
                    current.lines.push(heading.inlineContent);
                }
                continue;
            }

            if (current) {
                current.lines.push(rawLine);
            } else {
                leadingLines.push(rawLine);
            }

            activeFence = updateEnvelopeFenceState(activeFence, trimmed);
        }

        pushCurrent();

        const leadingContent = leadingLines.join('\n').trim();
        if (leadingContent) {
            sections.unshift({
                title: 'Context',
                content: leadingContent
            });
        }

        return sections;
    }

    function updateEnvelopeFenceState(activeFence, trimmedLine) {
        const match = String(trimmedLine || '').match(/^(`{3,}|~{3,})/);
        if (!match) {
            return activeFence;
        }

        const fenceType = match[1].charAt(0);
        if (!activeFence) {
            return fenceType;
        }

        return activeFence === fenceType ? null : activeFence;
    }

    function detectInputEnvelopeHeading(rawLine) {
        const trimmed = String(rawLine || '').trim();
        if (!trimmed || trimmed.startsWith('```')) {
            return null;
        }

        const hashHeadingMatch = trimmed.match(/^#{1,6}\s*(.+?)\s*[:\uFF1A]?\s*$/);
        if (hashHeadingMatch) {
            return {
                title: hashHeadingMatch[1].trim(),
                inlineContent: ''
            };
        }

        const colonHeadingMatch = trimmed.match(/^([^:\uFF1A]{1,80})\s*[:\uFF1A]\s*(.*)$/);
        if (!colonHeadingMatch) {
            return null;
        }

        const headingTitle = colonHeadingMatch[1].trim();
        const inlineContent = colonHeadingMatch[2].trim();
        if (!headingTitle) {
            return null;
        }

        return {
            title: headingTitle,
            inlineContent
        };
    }

    function renderUserInputEnvelope(parsed) {
        const requestHtml = `
            <div class="user-input-request">
                <div class="user-input-title">User request</div>
                <div class="message-content">${formatContent(parsed.userRequest)}</div>
            </div>
        `;

        const extrasHtml = (parsed.extras || []).map((section, index) => {
            const summary = describeInputEnvelopeSection(section.content);
            return `
                <details class="user-input-extra-card" data-user-input-extra-card>
                    <summary>
                        <span class="user-input-extra-title">${escapeHtml(section.title || `Context ${index + 1}`)}</span>
                        <span class="user-input-extra-meta">${escapeHtml(summary)}</span>
                    </summary>
                    <div class="user-input-extra-body">
                        <div class="message-content">${formatContent(section.content)}</div>
                    </div>
                </details>
            `;
        }).join('');

        return `
            <div class="user-input-envelope" data-user-input-envelope>
                <div class="user-input-toolbar">
                    <button type="button" class="btn btn-secondary btn-small user-input-toggle" data-user-input-toggle>${escapeHtml(getUserInputToggleLabel(false))}</button>
                </div>
                <div class="user-input-rendered-view">
                    ${requestHtml}
                    <div class="user-input-extra-list${extrasHtml ? '' : ' hidden'}" data-user-input-extra-list>
                        ${extrasHtml}
                    </div>
                </div>
                <div class="user-input-raw-view hidden">
                    <pre class="user-input-raw-pre">${escapeHtml(buildRawUserInputEnvelope(parsed))}</pre>
                </div>
            </div>
        `;
    }

    function describeInputEnvelopeSection(content) {
        const text = String(content || '');
        const lineCount = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
        if (lineCount > 1) {
            return `${lineCount} lines`;
        }

        return `${text.length} chars`;
    }

    function buildRawUserInputEnvelope(parsed) {
        if (parsed.raw) {
            return String(parsed.raw);
        }

        const sections = [];
        if (parsed.userRequest) {
            sections.push(`User request:\n${parsed.userRequest.trim()}`);
        }

        (parsed.extras || []).forEach(section => {
            sections.push(`${section.title}:\n${String(section.content || '').trim()}`);
        });

        return sections.join('\n\n');
    }

    function getUserInputToggleLabel(showRaw) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return showRaw ? t('input.showRendered') : t('input.showRaw');
    }

    function toggleUserInputEnvelopeRaw(trigger) {
        const container = trigger.closest('[data-user-input-envelope]');
        if (!container) {
            return;
        }

        const renderedView = container.querySelector('.user-input-rendered-view');
        const rawView = container.querySelector('.user-input-raw-view');
        const nextShowRaw = container.getAttribute('data-show-raw') !== 'true';

        container.setAttribute('data-show-raw', nextShowRaw ? 'true' : 'false');
        renderedView?.classList.toggle('hidden', nextShowRaw);
        rawView?.classList.toggle('hidden', !nextShowRaw);
        trigger.textContent = getUserInputToggleLabel(nextShowRaw);
    }

    function renderStructuredMessage(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const fallbackContent = getDisplayContent(msg);

        if (msg.role === 'tool') {
            return renderToolMessage(msg, parts);
        }

        const thinkingParts = parts.filter(part => part.type === 'thinking');
        const textParts = parts.filter(part => part.type === 'text');
        const toolCalls = parts.filter(part => part.type === 'toolCall');
        const thinkingHtml = thinkingParts.length > 0
            ? `
                <div class="thinking-block collapsed">
                    <div class="thinking-header" role="button" tabindex="0" aria-expanded="false">
                        <span class="thinking-icon">&#128173;</span>
                        <span class="thinking-label">${window.OpenClawI18n ? window.OpenClawI18n.t('common.thinking') : 'Thinking'}</span>
                        <span class="thinking-toggle">&#9660;</span>
                    </div>
                    <div class="thinking-body">${formatThinking(thinkingParts.map(part => part.thinking).join('\n\n'))}</div>
                </div>
            `
            : '';
        const toolCallsHtml = toolCalls.length > 0
            ? `
                <div class="tool-call-list">
                    ${toolCalls.map(toolCall => `
                        <details class="tool-card tool-card-pending"${buildToolCardDataAttributes(toolCall.id, toolCall.name)}>
                            <summary class="tool-card-summary">
                                <div class="tool-card-header">
                                    <span class="tool-card-status">&#9203;</span>
                                    <span class="tool-card-name">${escapeHtml(toolCall.name || 'tool')}</span>
                                </div>
                            </summary>
                            <div class="tool-card-body">
                                ${renderToolSection('Input', toolCall.arguments, {
                                    toolName: toolCall.name,
                                    format: 'pre'
                                })}
                                ${renderToolSection('Result', '', {
                                    toolName: toolCall.name,
                                    format: 'pre'
                                })}
                                ${renderToolSection('Details', '', {
                                    toolName: toolCall.name,
                                    format: 'pre'
                                })}
                            </div>
                        </details>
                    `).join('')}
                </div>
            `
            : '';
        const textContent = textParts.map(part => part.text).join('');
        const hasStructuredNonTextContent = thinkingParts.length > 0 || toolCalls.length > 0;
        const mainContent = textContent || (hasStructuredNonTextContent ? '' : fallbackContent);

        return `
            ${thinkingHtml}
            ${toolCallsHtml}
            ${mainContent ? `<div class="message-content">${formatContent(mainContent)}</div>` : ''}
        `;
    }

    function renderToolMessage(msg, parts) {
        const toolPart = parts.find(part => part.type === 'toolResult');
        const toolName = toolPart?.name || msg.toolName || 'tool';
        const toolCallId = normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId);
        const toolArguments = toolPart?.arguments ?? msg.toolArguments ?? '';
        const toolResult = toolPart?.result ?? msg.content ?? '';
        const toolDetails = toolPart?.details ?? msg.toolDetails ?? '';
        const toolStatus = extractToolStatus(toolPart?.result) || extractToolStatus(toolDetails);
        const isError = Boolean(toolPart?.isError ?? msg.isError) || toolStatus === 'error';

        return `
            <details class="tool-card ${isError ? 'tool-card-error' : 'tool-card-success'}"${buildToolCardDataAttributes(toolCallId, toolName)}>
                <summary class="tool-card-summary">
                    <div class="tool-card-header">
                        <span class="tool-card-status">${isError ? '&#10060;' : '&#9989;'}</span>
                        <span class="tool-card-name">${escapeHtml(toolName)}</span>
                    </div>
                </summary>
                <div class="tool-card-body">
                    ${renderToolSection('Input', toolArguments, {
                        toolName,
                        format: 'pre'
                    })}
                    ${renderToolSection('Result', toolResult, {
                        toolName,
                        format: 'pre'
                    })}
                    ${renderToolSection('Details', toolDetails, {
                        toolName,
                        format: 'pre'
                    })}
                </div>
            </details>
        `;
    }
    function getMessageRoleLabel(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (msg?.displayName) return msg.displayName;
        if (msg.role === 'user') return t('chat.roleUser');
        if (msg.role === 'system') return t('chat.roleNotice');
        if (msg.role === 'tool') return t('chat.roleTool');
        return t('chat.roleAssistant');
    }

    function isToolUseMessage(msg) {
        return msg?.role === 'assistant' && msg?.metadata?.stopReason === 'toolUse';
    }

    function extractToolStatus(value) {
        if (!value) {
            return '';
        }

        if (typeof value === 'object') {
            const record = value;
            if (typeof record.status === 'string') {
                return record.status.trim().toLowerCase();
            }
            if (record.result && typeof record.result === 'object' && typeof record.result.status === 'string') {
                return record.result.status.trim().toLowerCase();
            }
            return '';
        }

        if (typeof value !== 'string') {
            return '';
        }

        const trimmed = value.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return '';
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
                return parsed.status.trim().toLowerCase();
            }
        } catch {
            return '';
        }

        return '';
    }

    function formatToolData(value) {
        if (typeof value === 'string') {
            return normalizeVisibleNewlines(value);
        }

        try {
            return normalizeVisibleNewlines(JSON.stringify(value, null, 2));
        } catch {
            return normalizeVisibleNewlines(String(value));
        }
    }

    function normalizeToolName(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
    }

    function normalizeToolCallId(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function encodeToolCallId(value) {
        if (!value) {
            return '';
        }

        try {
            return encodeURIComponent(value);
        } catch {
            return value;
        }
    }

    function buildToolCardDataAttributes(toolCallId, toolName) {
        const normalizedCallId = normalizeToolCallId(toolCallId);
        const normalizedName = normalizeToolName(toolName || 'tool');
        const attributes = [`data-tool-name="${escapeHtml(normalizedName)}"`];

        if (normalizedCallId) {
            attributes.push(`data-tool-call-id="${escapeHtml(encodeToolCallId(normalizedCallId))}"`);
        }

        return ` ${attributes.join(' ')}`;
    }

    function findPendingToolCard(container, toolCallId, toolName) {
        if (!container) {
            return null;
        }

        const normalizedCallId = normalizeToolCallId(toolCallId);
        if (normalizedCallId) {
            const byId = container.querySelector(`.tool-card-pending[data-tool-call-id="${encodeToolCallId(normalizedCallId)}"]`);
            if (byId) {
                return byId;
            }
        }

        const normalizedName = normalizeToolName(toolName || 'tool');
        const cards = container.querySelectorAll(`.tool-card-pending[data-tool-name="${normalizedName}"]`);
        if (cards.length === 0) {
            return null;
        }

        return cards[cards.length - 1];
    }

    function getToolResultContext(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const toolPart = parts.find(part => part.type === 'toolResult');
        return {
            parts,
            toolCallId: normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId),
            toolName: toolPart?.name || msg.toolName || 'tool'
        };
    }

    function getToolSectionMetrics(value) {
        const formatted = formatToolData(value);
        const lineCount = formatted ? formatted.split(/\r?\n/).length : 0;
        return {
            formatted,
            lineCount,
            charCount: formatted.length
        };
    }

    function isHeavyToolName(toolName) {
        return new Set(['exec', 'write', 'append', 'edit', 'multi_edit', 'read']).has(normalizeToolName(toolName));
    }

    function shouldCollapseToolSection(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        return metrics.charCount > 280 || metrics.lineCount > 8;
    }

    function shouldStartToolSectionCollapsed(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        return metrics.charCount > 600 || metrics.lineCount > 16;
    }

    function describeToolSection(metrics) {
        if (metrics.lineCount > 1) {
            return `${metrics.lineCount} lines`;
        }

        return `${metrics.charCount} chars`;
    }

    function renderToolSection(label, value, options = {}) {
        if (value === undefined) {
            return '';
        }

        const {
            toolName = '',
            format = 'pre',
            forceCollapsible = true,
            defaultCollapsed
        } = options;
        const metrics = getToolSectionMetrics(value);
        const bodyContent = format === 'content' && typeof value === 'string'
            ? `<div class="message-content">${formatContent(value)}</div>`
            : `<pre class="tool-card-pre">${escapeHtml(metrics.formatted)}</pre>`;
        const isCollapsible = forceCollapsible || shouldCollapseToolSection(toolName, metrics);

        if (!isCollapsible) {
            return `
                <div class="tool-card-section">
                    <div class="tool-card-label">${label}</div>
                    ${bodyContent}
                </div>
            `;
        }

        const isCollapsed = defaultCollapsed ?? shouldStartToolSectionCollapsed(toolName, metrics);

        return `
            <details class="tool-card-section tool-card-foldout"${isCollapsed ? '' : ' open'}>
                <summary>
                    <span class="tool-card-label">${label}</span>
                    <span class="tool-card-meta">${escapeHtml(describeToolSection(metrics))}</span>
                </summary>
                <div class="tool-card-foldout-body">
                    ${bodyContent}
                </div>
            </details>
        `;
    }
    
    // Process message content, extracting thinking blocks
    function processMessageContent(content) {
        if (!content) return { mainContent: '', thinkingHtml: '' };
        
        let mainContent = content;
        let thinkingHtml = '';
        
        // Find all thinking blocks
        const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
        const thinkingBlocks = [];
        let match;
        
        while ((match = thinkingRegex.exec(content)) !== null) {
            thinkingBlocks.push(match[1].trim());
        }
        
        // Remove thinking blocks from main content
        mainContent = content.replace(thinkingRegex, '').trim();
        
        // Generate thinking HTML if there are thinking blocks
        if (thinkingBlocks.length > 0) {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
            const combinedThinking = thinkingBlocks.join('\n\n---\n\n');
            
            thinkingHtml = `
                <div class="thinking-block collapsed">
                    <div class="thinking-header" role="button" tabindex="0" aria-expanded="false">
                        <span class="thinking-icon">💭</span>
                        <span class="thinking-label">${t('common.thinking')}</span>
                        <span class="thinking-toggle">▼</span>
                    </div>
                    <div class="thinking-body">${formatThinking(combinedThinking)}</div>
                </div>
            `;
        }
        
        return { mainContent, thinkingHtml };
    }

    // Format thinking content
    function formatThinking(content) {
        return `<div class="message-content thinking-markdown">${formatContent(String(content || ''))}</div>`;
    }

    function toggleThinkingBlock(header) {
        const block = header.parentElement;
        if (!block) {
            return;
        }
        block.classList.toggle('collapsed');
        const toggle = header.querySelector('.thinking-toggle');
        if (toggle) {
            toggle.textContent = block.classList.contains('collapsed') ? '▼' : '▲';
        }
        header.setAttribute('aria-expanded', block.classList.contains('collapsed') ? 'false' : 'true');
    }

    // Update streaming message
    function updateStreamingMessage(content, done) {
        if (!content) {
            if (done) {
                finalizeStreamingMessage();
            }
            return;
        }

        pendingStreamingRender = {
            content,
            done: Boolean(done)
        };

        if (streamRenderFrame !== null) {
            return;
        }

        streamRenderFrame = window.requestAnimationFrame(() => {
            streamRenderFrame = null;
            const nextRender = pendingStreamingRender;
            pendingStreamingRender = null;
            if (!nextRender) {
                return;
            }

            renderStreamingMessage(nextRender.content, nextRender.done);
        });
    }

    function renderStreamingMessage(content, done) {
        // Check if we're still in thinking phase (opening tag but no closing tag)
        const hasOpening = content.includes('<thinking>');
        const hasClosing = content.includes('</thinking>');

        if (hasOpening && !hasClosing) {
            // Still in thinking phase - update thinking indicator
            const thinkingStart = content.indexOf('<thinking>') + 10;
            const thinkingContent = content.substring(thinkingStart);
            updateThinking(thinkingContent);
            return;
        }

        // Get or create streaming message element
        let streamingMsg = document.querySelector('.message-streaming');

        if (!streamingMsg) {
            // Remove thinking indicator if exists
            clearThinkingIndicator();

            streamingMsg = document.createElement('div');
            streamingMsg.className = 'message message-assistant message-streaming';
            elements.chatMessages.appendChild(streamingMsg);
            scrollToBottom();
        }

        // Process content for display
        const { mainContent, thinkingHtml } = processMessageContent(content);
        const time = new Date().toLocaleTimeString();

        // Build message HTML
        let messageHtml = `
            <div class="message-header">
                <span class="message-role">Assistant</span>
                <span class="message-time">${time}</span>
                <span class="streaming-indicator">●</span>
            </div>
        `;

        if (thinkingHtml) {
            messageHtml += thinkingHtml;
        }

        messageHtml += `<div class="message-content">${formatContent(mainContent)}</div>`;

        streamingMsg.innerHTML = messageHtml;

        if (done) {
            finalizeStreamingMessage();
        }
    }

    // Format content with markdown-like syntax
    function formatContent(content) {
        if (!content) return '';

        if (window.MarkdownRenderer && typeof window.MarkdownRenderer.render === 'function') {
            return window.MarkdownRenderer.render(content);
        }

        return escapeHtml(content).replace(/\n/g, '<br>');
    }

    function escapeHtml(text) {
        return window.OpenClawPanelCommon.escapeHtml(text);
    }

    function scrollToBottom() {
        if (!elements.chatMessages) return;
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    function showError(msg) {
        window.OpenClawPanelFeedback.showChatError(elements.chatMessages, msg, scrollToBottom);
    }

    function clearAgentMutationBanner(delayMs = 0) {
        if (agentMutationTimer) {
            window.clearTimeout(agentMutationTimer);
            agentMutationTimer = null;
        }

        if (delayMs <= 0) {
            state.agentMutation = null;
            renderAgents(state.agents);
            return;
        }

        agentMutationTimer = window.setTimeout(() => {
            state.agentMutation = null;
            agentMutationTimer = null;
            renderAgents(state.agents);
        }, delayMs);
    }

    function applyAgentActionAvailability() {
        const isBusy = Boolean(state.agentMutation?.pending);
        if (elements.btnNewAgent) {
            elements.btnNewAgent.disabled = isBusy;
        }
        if (elements.btnRefreshAgents) {
            elements.btnRefreshAgents.disabled = isBusy;
        }
    }

    function renderAgentMutationBanner() {
        const mutation = state.agentMutation;
        if (!mutation) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const targetName = mutation.agentName || mutation.agentId || 'agent';

        if (mutation.pending) {
            if (mutation.action === 'delete') {
                const label = t('agent.operationDeleting', { name: targetName });
                return `<div class="loading agent-mutation-banner">${escapeHtml(label)}</div>`;
            }

            // Creating status is shown in VS Code's notification progress UI.
            return '';
        }

        if (mutation.success === false && mutation.error) {
            const label = mutation.action === 'delete'
                ? t('panel.failedDeleteAgent', { error: mutation.error })
                : t('newAgent.createFailed', { error: mutation.error });
            return `<div class="empty agent-mutation-banner-error">${escapeHtml(label)}</div>`;
        }

        return '';
    }

    function normalizeVisibleNewlines(value) {
        return String(value || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\\n/g, '\n');
    }

    function resolveAgentIndicatorStatus(agent) {
        if (agent?.id && state.currentAgentId === agent.id) {
            return 'active';
        }

        return 'idle';
    }

    // Render agents
    function renderAgents(agentData) {
        state.agents = agentData;
        const mutationBanner = renderAgentMutationBanner();
        applyAgentActionAvailability();
        
        if (state.agents.length === 0) {
            elements.agentList.innerHTML = `${mutationBanner}<div class="empty">No agents yet. Create one!</div>`;
            if (state.viewMode === 'channel') {
                renderChannelWorkspace();
            }
            renderConsoleOverview();
            return;
        }
        
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const canEditAgentSettings = supportsRuntimeCapability('agentEditing');
        const settingsTitle = canEditAgentSettings
            ? t('common.settings')
            : resolveCapabilityUnavailableMessage('agentEditing');
        
        elements.agentList.innerHTML = `${mutationBanner}${state.agents.map(agent => `
            <div class="agent-item ${agent.id === state.currentAgentId ? 'active' : ''}" data-id="${agent.id}">
                <span class="agent-status status-${resolveAgentIndicatorStatus(agent)}"></span>
                <div class="agent-info">
                    <div class="agent-name">${escapeHtml(agent.name)}</div>
                    <div class="agent-model">${escapeHtml(agent.model)}</div>
                </div>
                <div class="agent-actions">
                    <button class="agent-action-btn" data-action="settings" title="${escapeHtml(settingsTitle)}" ${canEditAgentSettings ? '' : 'disabled aria-disabled="true"'}>⚙️</button>
                    <button class="agent-action-btn" data-action="folder" title="${t('common.openInExplorer')}">📁</button>
                </div>
            </div>
        `).join('')}`;
        
        document.querySelectorAll('.agent-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.agent-actions')) return;
                const agentId = item.dataset.id;
                selectAgent(agentId);
            });
        });
        
        // Agent action buttons
        document.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.disabled) {
                    showError(btn.title || resolveCapabilityUnavailableMessage('agentEditing'));
                    return;
                }
                const agentId = btn.closest('.agent-item').dataset.id;
                const action = btn.dataset.action;
                
                if (action === 'settings') {
                    vscode.postMessage({ type: 'openAgentSettings', agentId });
                } else if (action === 'folder') {
                    vscode.postMessage({ type: 'openAgentFolder', agentId });
                }
            });
        });

        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        if (state.viewMode === 'clusters') {
            renderClusterWorkspace();
        }
        if (state.viewMode === 'channel') {
            renderChannelWorkspace();
        }
        updateTaskFormFields();
        renderConsoleOverview();
    }

    function upsertAgentState(agent) {
        if (!agent || !agent.id) {
            return;
        }

        const index = state.agents.findIndex(item => item.id === agent.id);
        if (index >= 0) {
            state.agents[index] = {
                ...state.agents[index],
                ...agent
            };
        } else {
            state.agents.push(agent);
        }

        renderAgents([...state.agents]);
    }

    function renderChannels(channelData, selectedChannelId) {
        state.channels = Array.isArray(channelData) ? channelData : [];
        state.channelsLoaded = true;

        if (selectedChannelId && state.channels.some(channel => channel.id === selectedChannelId)) {
            state.currentChannelId = selectedChannelId;
            state.channelDraft = null;
        } else if (state.currentChannelId && !state.channels.some(channel => channel.id === state.currentChannelId)) {
            state.currentChannelId = null;
            state.channelMessages = [];
        }

        if (!state.currentChannelId && !state.channelDraft && state.channels.length > 0) {
            state.currentChannelId = state.channels[0].id;
        }

        if (!state.currentChannelId && !state.channelDraft && state.channels.length === 0) {
            startNewChannelDraft({ focus: false });
            return;
        }

        renderChannelList();
        renderChannelWorkspace();
    }

    function renderChannelList() {
        if (!elements.channelList) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!state.channelsLoaded) {
            elements.channelList.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (state.channels.length === 0) {
            elements.channelList.innerHTML = `<div class="empty">${escapeHtml(t('channel.listEmpty'))}</div>`;
            return;
        }

        elements.channelList.innerHTML = state.channels.map(channel => {
            const agent = resolveAgent(channel.agentId);
            const meta = isImportedChannel(channel)
                ? t('channel.importedMeta', {
                    provider: channel.providerId || 'openclaw',
                    account: channel.accountId || channel.name
                })
                : agent
                    ? t('channel.listMeta', { agent: agent.name, model: agent.model })
                    : t('channel.listMetaMissingAgent', { agentId: channel.agentId });

            return `
                <div class="channel-list-item ${channel.id === state.currentChannelId && !state.channelDraft ? 'active' : ''}" data-channel-id="${channel.id}">
                    <div class="channel-list-name">${escapeHtml(channel.name)}</div>
                    <div class="channel-list-meta">${escapeHtml(meta)}</div>
                    ${channel.description ? `<div class="channel-list-description">${escapeHtml(channel.description)}</div>` : ''}
                </div>
            `;
        }).join('');

        document.querySelectorAll('[data-channel-id]').forEach(item => {
            item.addEventListener('click', () => {
                const channelId = item.getAttribute('data-channel-id');
                if (!channelId) {
                    return;
                }

                selectChannel(channelId);
            });
        });
    }

    function renderChannelWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const isDraft = Boolean(state.channelDraft);
        const formData = state.channelDraft || channel;
        const hasWorkspace = Boolean(formData);

        if (elements.channelEmptyState) {
            elements.channelEmptyState.classList.toggle('hidden', hasWorkspace);
        }
        if (elements.channelWorkspace) {
            elements.channelWorkspace.classList.toggle('hidden', !hasWorkspace);
        }
        if (elements.channelChatShell) {
            elements.channelChatShell.classList.toggle('hidden', !hasWorkspace);
        }

        if (!hasWorkspace || !formData) {
            renderChannelList();
            return;
        }

        const agentId = formData.agentId || state.agents[0]?.id || '';
        const agent = resolveAgent(agentId);
        const importedChannel = !state.channelDraft && isImportedChannel(formData);

        if (elements.channelEditorTitle) {
            elements.channelEditorTitle.textContent = isDraft
                ? t('channel.editorTitleNew')
                : t('channel.editorTitleExisting', { name: formData.name });
        }
        if (elements.channelEditorSummary) {
            elements.channelEditorSummary.textContent = isDraft
                ? t('channel.editorSummaryNew')
                : t('channel.editorSummaryExisting');
        }

        populateChannelAgentOptions(agentId);

        if (elements.channelName) {
            elements.channelName.value = formData.name || '';
        }
        if (elements.channelDescription) {
            elements.channelDescription.value = formData.description || '';
        }
        if (elements.channelAgentId) {
            elements.channelAgentId.value = agentId;
        }
        if (elements.btnDeleteChannel) {
            elements.btnDeleteChannel.disabled = isDraft || importedChannel;
        }
        if (elements.channelChatTitle) {
            elements.channelChatTitle.textContent = isDraft
                ? t('channel.chatTitleDraft')
                : t('channel.chatTitleNamed', { name: formData.name });
        }
        if (elements.channelChatSubtitle) {
            if (importedChannel) {
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleImported', {
                    provider: formData.providerId || 'openclaw',
                    account: formData.accountId || formData.name
                });
            } else if (agent) {
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleBound', {
                    agent: agent.name,
                    model: agent.model
                });
            } else if (agentId) {
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleMissing', { agentId });
            } else {
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleUnbound');
            }
        }

        renderChannelConversation();
        updateChannelInputState();
        renderChannelList();
    }

    function renderChannelConversation() {
        if (!elements.channelMessages) {
            return;
        }

        resetTransientChannelState();
        renderedChannelMessageIds.clear();
        elements.channelMessages.innerHTML = '';

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const draft = state.channelDraft;

        if (state.channelLoading) {
            elements.channelMessages.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (draft) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.unsavedHint'))}</div>`;
            return;
        }

        if (!channel) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.selectHint'))}</div>`;
            return;
        }

        if (!resolveChannelAgent(channel)) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.missingAgentHint'))}</div>`;
            return;
        }

        if (state.channelMessages.length === 0) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.emptyConversation'))}</div>`;
            return;
        }

        isBulkRenderingChannel = true;
        state.channelMessages.forEach(message => addChannelMessage(message));
        isBulkRenderingChannel = false;
        scrollChannelToBottom();
    }

    function populateChannelAgentOptions(selectedAgentId) {
        if (!elements.channelAgentId) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (state.agents.length === 0) {
            elements.channelAgentId.innerHTML = `<option value="">${escapeHtml(t('sidebar.noAgents'))}</option>`;
            elements.channelAgentId.disabled = true;
            return;
        }

        const hasSelectedAgent = state.agents.some(agent => agent.id === selectedAgentId);
        const options = state.agents.map(agent => `
            <option value="${escapeHtml(agent.id)}">${escapeHtml(`${agent.name} · ${agent.model}`)}</option>
        `);

        if (selectedAgentId && !hasSelectedAgent) {
            options.unshift(`<option value="${escapeHtml(selectedAgentId)}">${escapeHtml(t('channel.listMetaMissingAgent', { agentId: selectedAgentId }))}</option>`);
        }

        elements.channelAgentId.disabled = false;
        elements.channelAgentId.innerHTML = options.join('');
        elements.channelAgentId.value = selectedAgentId && (hasSelectedAgent || selectedAgentId)
            ? selectedAgentId
            : state.agents[0]?.id || '';
    }

    function getCurrentChannel() {
        if (!state.currentChannelId) {
            return null;
        }

        return state.channels.find(channel => channel.id === state.currentChannelId) || null;
    }

    function resolveAgent(agentId) {
        if (!agentId) {
            return null;
        }

        return state.agents.find(agent => agent.id === agentId) || null;
    }

    function resolveChannelAgent(channel) {
        if (!channel) {
            return null;
        }

        return resolveAgent(channel.agentId) || state.agents[0] || null;
    }

    function isImportedChannel(channel) {
        return Boolean(channel && channel.source === 'openclaw');
    }

    function startNewChannelDraft(options = {}) {
        state.channelDraft = {
            name: '',
            agentId: state.agents[0]?.id || '',
            description: ''
        };
        state.currentChannelId = null;
        state.channelMessages = [];
        state.channelLoading = false;
        resetTransientChannelState();
        renderChannelWorkspace();

        if (options.focus === false) {
            return;
        }

        window.setTimeout(() => {
            elements.channelName?.focus();
        }, 0);
    }

    function selectChannel(channelId) {
        if (!channelId || channelId === state.currentChannelId && !state.channelDraft) {
            return;
        }

        state.channelDraft = null;
        state.currentChannelId = channelId;
        state.channelMessages = [];
        state.channelLoading = true;
        resetTransientChannelState();
        renderChannelWorkspace();
        vscode.postMessage({
            type: 'selectChannel',
            channelId
        });
    }

    function saveChannelConfig() {
        const payload = {
            name: normalizeOutgoingMessage(elements.channelName?.value || ''),
            agentId: elements.channelAgentId?.value || '',
            description: normalizeOutgoingMessage(elements.channelDescription?.value || '')
        };

        if (state.channelDraft) {
            vscode.postMessage({
                type: 'createChannel',
                data: payload
            });
            return;
        }

        if (!state.currentChannelId) {
            return;
        }

        const existingChannel = getCurrentChannel();
        if (isImportedChannel(existingChannel)) {
            vscode.postMessage({
                type: 'createChannel',
                data: payload
            });
            return;
        }

        vscode.postMessage({
            type: 'updateChannel',
            channelId: state.currentChannelId,
            data: payload
        });
    }

    function updateChannelInputState() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const agent = channel ? resolveChannelAgent(channel) : null;

        let disabled = false;
        let hint = '';

        if (state.channelDraft) {
            disabled = true;
            hint = t('channel.unsavedHint');
        } else if (!channel) {
            disabled = true;
            hint = t('channel.selectHint');
        } else if (!agent) {
            disabled = true;
            hint = t('channel.missingAgentHint');
        } else if (state.channelLoading) {
            disabled = true;
            hint = t('common.loading');
        } else if (state.channelSending) {
            disabled = true;
            hint = t('chat.thinking');
        } else {
            hint = t('channel.chatHintReady', { agent: agent.name });
        }

        if (elements.channelChatHint) {
            elements.channelChatHint.textContent = hint;
        }
        if (elements.channelMessageInput) {
            elements.channelMessageInput.disabled = disabled;
        }
        if (elements.btnSendChannel) {
            elements.btnSendChannel.disabled = disabled;
        }
        if (elements.btnStopChannel) {
            elements.btnStopChannel.classList.toggle('hidden', !state.channelSending);
            elements.btnStopChannel.disabled = !state.channelSending;
        }
    }

    function sendChannelMessage() {
        const content = normalizeOutgoingMessage(elements.channelMessageInput?.value || '');

        if (state.channelDraft) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.unsavedHint') : 'Save the channel first.');
            return;
        }

        const channel = getCurrentChannel();
        if (!channel) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.selectHint') : 'Select a channel first.');
            return;
        }

        if (!resolveChannelAgent(channel)) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.missingAgentHint') : 'Bind this channel to an available agent first.');
            return;
        }

        if (!content.trim() || state.channelSending || state.channelLoading) {
            return;
        }

        if (elements.channelMessageInput) {
            elements.channelMessageInput.value = '';
        }

        state.channelSending = true;
        addChannelMessage({
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });
        showChannelThinkingIndicator();
        updateChannelInputState();

        vscode.postMessage({
            type: 'sendChannelMessage',
            channelId: channel.id,
            content
        });
    }

    function showChannelThinkingIndicator() {
        if (!elements.channelMessages) {
            return;
        }

        clearChannelThinkingIndicator();
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        const div = document.createElement('div');
        div.className = 'message message-thinking thinking-indicator';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${t('chat.thinking')}</span>
                <span class="thinking-dots">
                    <span></span><span></span><span></span>
                </span>
            </div>
            <div class="thinking-content">
                <div class="thinking-line">${t('thinking.started')}</div>
            </div>
        `;

        elements.channelMessages.appendChild(div);
        scrollChannelToBottom();
        state.currentChannelThinking = div;
    }

    function clearChannelThinkingIndicator() {
        if (!state.currentChannelThinking) {
            return;
        }

        state.currentChannelThinking.remove();
        state.currentChannelThinking = null;
    }

    function resetTransientChannelState() {
        clearChannelThinkingIndicator();
        activeChannelTraceContainer = null;
        state.channelSending = false;
        updateChannelInputState();
    }

    function stopChannelRun() {
        if (!state.channelSending) {
            return;
        }

        resetTransientChannelState();
        vscode.postMessage({
            type: 'stopActiveRun',
            scope: 'channel',
            channelId: state.currentChannelId
        });
    }

    function addChannelMessage(msg) {
        if (!msg || !elements.channelMessages) return;
        if (rememberRenderedMessageId(msg, renderedChannelMessageIds)) return;
        if (shouldHideMessage(msg)) return;

        if ((msg.role === 'assistant' || msg.role === 'tool') && state.currentChannelThinking) {
            clearChannelThinkingIndicator();
        }

        if (msg.role === 'user') {
            activeChannelTraceContainer = null;
            appendStandaloneChannelMessage(msg);
            return;
        }

        if (shouldAppendToTrace(msg)) {
            appendChannelTraceMessage(msg);
            return;
        }

        activeChannelTraceContainer = null;
        appendStandaloneChannelMessage(msg);
    }

    function appendStandaloneChannelMessage(msg) {
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;

        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const rendered = renderMessageContent(msg);

        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${getMessageRoleLabel(msg)}</span>
                <span class="message-time">${time}</span>
                ${tokenInfo}
            </div>
            ${rendered}
        `;

        elements.channelMessages.appendChild(div);
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            state.channelSending = false;
            updateChannelInputState();
        }
    }

    function appendChannelTraceMessage(msg) {
        const container = getOrCreateChannelTraceContainer(msg);
        const body = container.querySelector('.trace-body');
        if (!body) {
            return;
        }

        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            activeChannelTraceContainer = null;
            state.channelSending = false;
            updateChannelInputState();
        }
    }

    function getOrCreateChannelTraceContainer(msg) {
        if (activeChannelTraceContainer?.isConnected) {
            return activeChannelTraceContainer;
        }

        const div = document.createElement('div');
        div.className = 'message message-assistant message-trace';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${window.OpenClawI18n ? window.OpenClawI18n.t('chat.roleAssistant') : 'Assistant'}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="trace-body"></div>
        `;

        elements.channelMessages.appendChild(div);
        activeChannelTraceContainer = div;
        return div;
    }

    function scrollChannelToBottom() {
        if (!elements.channelMessages) {
            return;
        }

        elements.channelMessages.scrollTop = elements.channelMessages.scrollHeight;
    }

    function showChannelError(msg) {
        if (!elements.channelMessages) {
            return;
        }

        window.OpenClawPanelFeedback.showChatError(elements.channelMessages, msg, scrollChannelToBottom);
    }

    function selectAgent(agentId) {
        state.currentAgentId = agentId;
        document.querySelectorAll('.agent-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === agentId);
        });

        if (state.viewMode !== 'chat') {
            applyView('chat');
            vscode.postMessage({ type: 'switchView', view: 'chat' });
        }
        
        renderConsoleOverview();
        vscode.postMessage({ type: 'selectAgent', agentId });
    }

    function openNewAgentModal() {
        resetNewAgentForm();
        openModal(elements.modalNewAgent);
    }

    function setAgentPresets(presets) {
        state.agentPresets = Array.isArray(presets) ? presets : [];

        if (!state.agentPresets.some(preset => preset.id === state.newAgentPresetId)) {
            state.newAgentPresetId = CUSTOM_AGENT_PRESET_ID;
        }

        if (state.newAgentMode === 'preset' && state.newAgentPresetId === CUSTOM_AGENT_PRESET_ID && state.agentPresets[0]) {
            applySelectedAgentPreset(state.agentPresets[0].id, { resetToDefault: true });
            return;
        }

        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
    }

    function getSelectedAgentPreset() {
        return state.agentPresets.find(preset => preset.id === state.newAgentPresetId) || null;
    }

    function renderNewAgentMode() {
        const isPresetMode = state.newAgentMode === 'preset';

        elements.newAgentModeButtons?.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-new-agent-mode') === state.newAgentMode);
        });

        elements.newAgentPresetPanel?.classList.toggle('hidden', !isPresetMode);
        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
    }

    function renderNewAgentPresetGrid() {
        if (!elements.newAgentPresetGrid) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        if (!state.agentPresets.length) {
            elements.newAgentPresetGrid.innerHTML = `
                <div class="new-agent-preset-empty">${escapeHtml(t('newAgent.preset.empty'))}</div>
            `;
            return;
        }

        elements.newAgentPresetGrid.innerHTML = state.agentPresets.map((preset) => {
            const isSelected = preset.id === state.newAgentPresetId;
            return `
                <button
                    type="button"
                    class="new-agent-preset-card${isSelected ? ' selected' : ''}"
                    data-agent-preset-card="true"
                    data-agent-preset-id="${escapeHtml(preset.id)}"
                >
                    <span class="new-agent-preset-card-badge">${escapeHtml(preset.badge || preset.defaultName)}</span>
                    <div class="new-agent-preset-card-name">${escapeHtml(preset.defaultName)}</div>
                    <div class="new-agent-preset-card-title">${escapeHtml(preset.label)}</div>
                    <div class="new-agent-preset-card-description">${escapeHtml(preset.description)}</div>
                </button>
            `;
        }).join('');
    }

    function renderNewAgentPresetDescription() {
        if (!elements.newAgentPresetDescription) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = getSelectedAgentPreset();

        if (!preset) {
            elements.newAgentPresetDescription.innerHTML = `
                <div class="new-agent-preset-summary-label">${escapeHtml(t('newAgent.preset.galleryEyebrow'))}</div>
                <div class="new-agent-preset-summary-text">${escapeHtml(t('newAgent.preset.galleryHint'))}</div>
            `;
            return;
        }

        elements.newAgentPresetDescription.innerHTML = `
            <div class="new-agent-preset-summary-label">${escapeHtml(t('newAgent.preset.selected'))}</div>
            <div class="new-agent-preset-summary-head">
                <div class="new-agent-preset-summary-title">${escapeHtml(preset.label)}</div>
                <span class="new-agent-preset-summary-badge">${escapeHtml(preset.badge || preset.defaultName)}</span>
            </div>
            <div class="new-agent-preset-summary-grid">
                ${renderPresetSummaryDetail(t('newAgent.preset.useWhen'), preset.description)}
                ${renderPresetSummaryDetail(t('newAgent.preset.recommendedModel'), preset.recommendedModel)}
                ${renderPresetSummaryDetail(t('newAgent.preset.failureSignals'), preset.failureSignals)}
                ${renderPresetSummaryDetail(t('newAgent.preset.outputStandard'), preset.outputStandard)}
            </div>
        `;
    }

    function renderPresetSummaryDetail(label, value) {
        return `
            <div class="new-agent-preset-detail">
                <div class="new-agent-preset-detail-label">${escapeHtml(label)}</div>
                <div class="new-agent-preset-detail-value">${escapeHtml(value || '-')}</div>
            </div>
        `;
    }

    function setNewAgentMode(mode, options = { resetToDefault: true }) {
        const nextMode = mode === 'preset' ? 'preset' : 'custom';
        if (state.newAgentMode === nextMode) {
            renderNewAgentMode();
            return;
        }

        state.newAgentMode = nextMode;

        if (state.newAgentMode === 'preset') {
            const nextPresetId = getSelectedAgentPreset()?.id || state.agentPresets[0]?.id || CUSTOM_AGENT_PRESET_ID;
            if (nextPresetId !== CUSTOM_AGENT_PRESET_ID) {
                applySelectedAgentPreset(nextPresetId, { resetToDefault: true });
            } else {
                renderNewAgentMode();
            }
            return;
        }

        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, {
            resetToDefault: options.resetToDefault !== false
        });
    }

    function applySelectedAgentPreset(presetId, options = { resetToDefault: false }) {
        state.newAgentPresetId = presetId || CUSTOM_AGENT_PRESET_ID;

        const preset = getSelectedAgentPreset();
        if (preset) {
            if (elements.newAgentName) {
                elements.newAgentName.value = preset.defaultName;
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = preset.systemPrompt;
            }
        } else if (options.resetToDefault) {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            if (elements.newAgentName) {
                elements.newAgentName.value = '';
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = t('newAgent.defaultSystemPrompt');
            }
        }

        renderNewAgentMode();
        renderNewAgentPresetDescription();
    }

    function resetNewAgentForm() {
        elements.formNewAgent?.reset();
        state.newAgentMode = 'custom';
        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, { resetToDefault: true });
    }

    // Populate model select dropdown
    function populateModelSelect(models) {
        const modelSelect = elements.newAgentModel;
        if (!modelSelect) return;
        
        modelSelect.innerHTML = '';
        
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = 'default';
            option.textContent = 'default';
            modelSelect.appendChild(option);
            return;
        }
        
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
    }

    // Create agent
    function createAgent() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = state.newAgentMode === 'preset' ? getSelectedAgentPreset() : null;
        const data = {
            name: elements.newAgentName?.value?.trim() || '',
            model: elements.newAgentModel?.value?.trim() || '',
            systemPrompt: elements.newAgentPrompt?.value?.trim() || t('newAgent.defaultSystemPrompt'),
            presetId: preset?.id || undefined
        };

        if (state.newAgentMode === 'preset' && !preset) {
            showError(t('newAgent.preset.required'));
            return;
        }

        if (!data.name || !data.model) {
            return;
        }

        if (agentMutationTimer) {
            window.clearTimeout(agentMutationTimer);
            agentMutationTimer = null;
        }
        state.agentMutation = {
            action: 'create',
            pending: true,
            agentName: data.name,
            agentId: ''
        };
        renderAgents(state.agents);

        vscode.postMessage({ type: 'createAgent', data });
        closeAllModals();
        resetNewAgentForm();
    }

    // Show agent settings
    function renderAgentSkillsPicker(enabledSkills) {
        if (!elements.agentSkillsPicker) {
            return;
        }

        const selected = new Set(Array.isArray(enabledSkills) ? enabledSkills : []);
        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        if (skills.length === 0) {
            elements.agentSkillsPicker.innerHTML = '';
            return;
        }

        elements.agentSkillsPicker.innerHTML = skills.map(skill => `
            <label class="cluster-agent-option">
                <input type="checkbox" value="${escapeHtml(skill.id)}"${selected.has(skill.id) ? ' checked' : ''}>
                <div>
                    <div class="cluster-agent-option-title">${escapeHtml(skill.label || skill.id)}</div>
                    <div class="cluster-agent-option-meta">${escapeHtml(skill.description || '')}</div>
                </div>
            </label>
        `).join('');
    }

    function renderAgentSkillLinks() {
        if (!elements.agentSkillLinks) {
            return;
        }

        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        if (skills.length === 0) {
            elements.agentSkillLinks.innerHTML = '';
            return;
        }

        const uniqueLinks = new Map();
        skills.forEach(skill => {
            const url = String(skill.downloadUrl || '').trim();
            if (!url || uniqueLinks.has(url)) {
                return;
            }
            const defaultLinkLabel = t('agentSettings.skills.downloadLink');
            const defaultLinkDescription = t('agentSettings.skills.downloadHint');
            uniqueLinks.set(url, {
                label: skill.linkLabel || (defaultLinkLabel === 'agentSettings.skills.downloadLink' ? 'Skill Download Address' : defaultLinkLabel),
                description: skill.linkDescription || (defaultLinkDescription === 'agentSettings.skills.downloadHint' ? 'Open the skill catalog or repository in your browser.' : defaultLinkDescription)
            });
        });

        elements.agentSkillLinks.innerHTML = Array.from(uniqueLinks.entries()).map(([url, entry]) => `
            <button type="button" class="btn skill-link-card" data-skill-url="${escapeHtml(url)}">
                <div class="skill-link-card-title">${escapeHtml(entry.label)}</div>
                <div class="skill-link-card-meta">${escapeHtml(entry.description)}</div>
            </button>
        `).join('');
    }

    function showAgentSettings(agent) {
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        const modal = document.getElementById('modal-agent-settings');
        if (!modal) return;
        
        const idField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        const skillsLabel = document.getElementById('settings-agent-skills-label');
        const skillLinksLabel = document.getElementById('settings-agent-skills-links-label');

        if (idField) idField.value = agent.id;
        if (nameField) nameField.value = agent.name;
        if (promptField) promptField.value = agent.systemPrompt || '';
        if (tempField) {
            tempField.value = agent.temperature || 0.7;
            // Update range value display
            const parent = tempField.parentElement;
            if (parent) {
                const valueDisplay = parent.querySelector('.range-value');
                if (valueDisplay) valueDisplay.textContent = tempField.value;
            }
        }
        if (maxTokensField) maxTokensField.value = agent.maxTokens || 4096;
        if (skillsLabel) {
            const label = t('agentSettings.skills.label');
            skillsLabel.textContent = label === 'agentSettings.skills.label' ? 'AI Skills' : label;
        }
        if (skillLinksLabel) {
            const label = t('agentSettings.skills.resources');
            skillLinksLabel.textContent = label === 'agentSettings.skills.resources' ? 'Skill Resources' : label;
        }
        if (elements.agentSkillsHint) {
            const hint = t('agentSettings.skills.hint');
            elements.agentSkillsHint.textContent = hint === 'agentSettings.skills.hint'
                ? 'Enable the skills this agent should apply during reasoning and response generation.'
                : hint;
        }
        renderAgentSkillsPicker(agent.enabledSkills || []);
        renderAgentSkillLinks();
        
        openModal(modal);
    }

    // Save agent settings
    function saveAgentSettings() {
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        const agentIdField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        const enabledSkills = Array.from(elements.agentSkillsPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);
        
        const agentId = agentIdField ? agentIdField.value : '';
        const settings = {
            name: nameField ? nameField.value : '',
            systemPrompt: promptField ? promptField.value : '',
            temperature: tempField ? parseFloat(tempField.value) : 0.7,
            maxTokens: maxTokensField ? parseInt(maxTokensField.value) : 4096,
            enabledSkills
        };
        
        vscode.postMessage({ type: 'saveAgentSettings', agentId, settings });
        closeAllModals();
    }

    function showTaskEditor(task) {
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        if (state.tasksAvailable === false) {
            showError(state.tasksMessage || resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        const modal = elements.modalTask;
        if (!modal) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const title = document.getElementById('task-modal-title');
        const idField = document.getElementById('task-id');
        const nameField = document.getElementById('task-name');
        const descriptionField = document.getElementById('task-description');
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneField = document.getElementById('task-schedule-timezone');
        const sessionTargetField = document.getElementById('task-session-target');
        const wakeModeField = document.getElementById('task-wake-mode');
        const payloadKindField = document.getElementById('task-payload-kind');
        const contentField = document.getElementById('task-content');
        const modelField = document.getElementById('task-model');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const enabledField = document.getElementById('task-enabled');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');

        if (!idField
            || !nameField
            || !descriptionField
            || !agentField
            || !scheduleKindField
            || !scheduleEveryField
            || !scheduleAtField
            || !scheduleCronField
            || !scheduleTimezoneField
            || !sessionTargetField
            || !wakeModeField
            || !payloadKindField
            || !contentField
            || !modelField
            || !timeoutField
            || !enabledField
            || !deleteAfterRunField) {
            return;
        }

        idField.value = task?.id || '';
        nameField.value = task?.name || '';
        descriptionField.value = task?.description || '';
        populateTaskAgentOptions(task?.agentId || '');

        const scheduleKind = task?.schedule?.kind || 'every';
        scheduleKindField.value = scheduleKind;
        scheduleEveryField.value = task?.schedule?.kind === 'every'
            ? formatEveryDuration(task.schedule.everyMs)
            : '10m';
        scheduleAtField.value = task?.schedule?.kind === 'at'
            ? toDateTimeLocalValue(task.schedule.at)
            : '';
        scheduleCronField.value = task?.schedule?.kind === 'cron'
            ? task.schedule.expr
            : '';
        scheduleTimezoneField.value = task?.schedule?.kind === 'cron'
            ? (task.schedule.tz || '')
            : '';

        const payloadKind = task?.payload?.kind || 'agentTurn';
        payloadKindField.value = payloadKind;
        sessionTargetField.value = task?.sessionTarget || (payloadKind === 'systemEvent' ? 'main' : 'isolated');
        wakeModeField.value = task?.wakeMode || 'now';
        contentField.value = extractTaskContent(task) || '';
        modelField.value = task?.payload?.kind === 'agentTurn' ? (task.payload.model || '') : '';
        timeoutField.value = task?.payload?.kind === 'agentTurn' && task.payload.timeoutSeconds
            ? String(task.payload.timeoutSeconds)
            : '';
        enabledField.checked = task ? task.enabled !== false : true;
        deleteAfterRunField.checked = task
            ? Boolean(task.deleteAfterRun)
            : scheduleKind === 'at';

        if (title) {
            title.textContent = task ? t('tasks.form.editTitle') : t('tasks.form.createTitle');
        }

        updateTaskFormFields();
        openModal(modal);
    }

    function updateTaskFormFields() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryGroup = document.getElementById('task-schedule-every-group');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtGroup = document.getElementById('task-schedule-at-group');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronGroup = document.getElementById('task-schedule-cron-group');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneGroup = document.getElementById('task-schedule-timezone-group');
        const payloadKindField = document.getElementById('task-payload-kind');
        const sessionTargetField = document.getElementById('task-session-target');
        const modelGroup = document.getElementById('task-model-group');
        const modelField = document.getElementById('task-model');
        const timeoutGroup = document.getElementById('task-timeout-group');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const deleteAfterRunGroup = document.getElementById('task-delete-after-run-group');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');
        const contentLabel = document.getElementById('task-content-label');

        if (!agentField
            || !scheduleKindField
            || !scheduleEveryGroup
            || !scheduleEveryField
            || !scheduleAtGroup
            || !scheduleAtField
            || !scheduleCronGroup
            || !scheduleCronField
            || !scheduleTimezoneGroup
            || !payloadKindField
            || !sessionTargetField
            || !modelGroup
            || !modelField
            || !timeoutGroup
            || !timeoutField
            || !deleteAfterRunGroup
            || !deleteAfterRunField
            || !contentLabel) {
            return;
        }

        populateTaskAgentOptions(agentField.value || '');

        const scheduleKind = scheduleKindField.value || 'every';
        scheduleEveryGroup.hidden = scheduleKind !== 'every';
        scheduleEveryField.required = scheduleKind === 'every';
        scheduleAtGroup.hidden = scheduleKind !== 'at';
        scheduleAtField.required = scheduleKind === 'at';
        scheduleCronGroup.hidden = scheduleKind !== 'cron';
        scheduleCronField.required = scheduleKind === 'cron';
        scheduleTimezoneGroup.hidden = scheduleKind !== 'cron';
        deleteAfterRunGroup.hidden = scheduleKind !== 'at';
        if (scheduleKind !== 'at') {
            deleteAfterRunField.checked = false;
        }

        const payloadKind = payloadKindField.value === 'systemEvent' ? 'systemEvent' : 'agentTurn';
        const isSystemEvent = payloadKind === 'systemEvent';
        sessionTargetField.value = isSystemEvent ? 'main' : 'isolated';
        sessionTargetField.disabled = true;
        modelGroup.hidden = isSystemEvent;
        timeoutGroup.hidden = isSystemEvent;
        modelField.required = false;
        timeoutField.required = false;
        contentLabel.textContent = isSystemEvent
            ? t('tasks.form.payloadSystemEvent')
            : t('tasks.form.payloadAgentTurn');
    }

    function saveTask() {
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        const idField = document.getElementById('task-id');
        const nameField = document.getElementById('task-name');
        const descriptionField = document.getElementById('task-description');
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneField = document.getElementById('task-schedule-timezone');
        const sessionTargetField = document.getElementById('task-session-target');
        const wakeModeField = document.getElementById('task-wake-mode');
        const payloadKindField = document.getElementById('task-payload-kind');
        const contentField = document.getElementById('task-content');
        const modelField = document.getElementById('task-model');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const enabledField = document.getElementById('task-enabled');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');

        const taskId = idField ? idField.value : '';
        const scheduleKind = scheduleKindField?.value || 'every';
        const data = {
            name: nameField ? nameField.value : '',
            description: descriptionField ? descriptionField.value : '',
            agentId: agentField ? agentField.value : '',
            scheduleKind,
            scheduleEvery: scheduleEveryField ? scheduleEveryField.value : '',
            scheduleAt: scheduleAtField ? scheduleAtField.value : '',
            scheduleCron: scheduleCronField ? scheduleCronField.value : '',
            scheduleTimezone: scheduleTimezoneField ? scheduleTimezoneField.value : '',
            sessionTarget: sessionTargetField ? sessionTargetField.value : 'isolated',
            wakeMode: wakeModeField ? wakeModeField.value : 'now',
            payloadKind: payloadKindField ? payloadKindField.value : 'agentTurn',
            content: contentField ? contentField.value : '',
            model: modelField ? modelField.value : '',
            timeoutSeconds: timeoutField ? timeoutField.value : '',
            enabled: Boolean(enabledField?.checked),
            deleteAfterRun: Boolean(deleteAfterRunField?.checked)
        };

        vscode.postMessage({
            type: taskId ? 'updateTask' : 'createTask',
            taskId,
            data
        });
        closeAllModals();
    }

    // Modal handling
    function openModal(modal) {
        if (modal) modal.classList.add('active');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    }

    function getClusterWorkModePresetById(presetId) {
        const normalizedPresetId = String(presetId || '').trim();
        const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
        return presets.find(preset => preset.id === normalizedPresetId)
            || presets.find(preset => preset.id === 'implementation-squad')
            || presets[0]
            || null;
    }

    function getDefaultClusterWorkModeConfig() {
        const preset = getClusterWorkModePresetById('implementation-squad') || {
            id: 'implementation-squad',
            presetId: 'implementation-squad',
            collaborationStyle: 'leader-draft',
            deliveryStyle: 'balanced',
            critiqueLevel: 'standard',
            rounds: 2,
            briefing: ''
        };
        return {
            presetId: preset.id,
            collaborationStyle: preset.collaborationStyle,
            deliveryStyle: preset.deliveryStyle,
            critiqueLevel: preset.critiqueLevel,
            rounds: preset.rounds,
            briefing: preset.briefing || ''
        };
    }

    function getClusterWorkModeConfig(cluster) {
        const preset = getClusterWorkModePresetById(cluster?.workspaceConfig?.presetId);
        const base = preset
            ? {
                presetId: preset.id,
                collaborationStyle: preset.collaborationStyle,
                deliveryStyle: preset.deliveryStyle,
                critiqueLevel: preset.critiqueLevel,
                rounds: preset.rounds,
                briefing: preset.briefing || ''
            }
            : getDefaultClusterWorkModeConfig();
        const config = cluster?.workspaceConfig || {};
        return {
            presetId: String(config.presetId || base.presetId),
            collaborationStyle: ['debate', 'round-robin', 'review-board', 'leader-draft'].includes(config.collaborationStyle)
                ? config.collaborationStyle
                : base.collaborationStyle,
            deliveryStyle: ['fast', 'balanced', 'deep'].includes(config.deliveryStyle)
                ? config.deliveryStyle
                : base.deliveryStyle,
            critiqueLevel: ['minimal', 'standard', 'aggressive'].includes(config.critiqueLevel)
                ? config.critiqueLevel
                : base.critiqueLevel,
            rounds: normalizeClusterRoundsInput(config.rounds, base.rounds || 1),
            briefing: typeof config.briefing === 'string' && config.briefing.trim()
                ? config.briefing.trim()
                : (base.briefing || '')
        };
    }

    function normalizeClusterRoundsInput(value, fallback = 1) {
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(Number(fallback) || 1)));
        }

        return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(parsedValue)));
    }

    function populateClusterEditorOptions() {
        if (elements.clusterEditorPreset) {
            const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
            elements.clusterEditorPreset.innerHTML = presets.map(preset => `
                <option value="${escapeHtml(preset.id)}">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</option>
            `).join('');
        }

        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.innerHTML = [
                ['debate', t('clusters.style.debate')],
                ['round-robin', t('clusters.style.roundRobin')],
                ['review-board', t('clusters.style.reviewBoard')],
                ['leader-draft', t('clusters.style.leaderDraft')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.innerHTML = [
                ['fast', t('clusters.delivery.fast')],
                ['balanced', t('clusters.delivery.balanced')],
                ['deep', t('clusters.delivery.deep')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.innerHTML = [
                ['minimal', t('clusters.critique.minimal')],
                ['standard', t('clusters.critique.standard')],
                ['aggressive', t('clusters.critique.aggressive')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.min = '1';
            elements.clusterEditorRounds.step = '1';
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(elements.clusterEditorRounds.value || 2, 2));
        }
    }

    function renderClusterAgentPicker(selectedAgentIds) {
        if (!elements.clusterEditorAgentPicker) {
            return;
        }

        if (!Array.isArray(state.agents) || state.agents.length === 0) {
            elements.clusterEditorAgentPicker.innerHTML = `<div class="cluster-agent-picker-empty">${escapeHtml(t('clusters.createAgentFirst'))}</div>`;
            return;
        }

        const selected = new Set(Array.isArray(selectedAgentIds) ? selectedAgentIds : []);
        elements.clusterEditorAgentPicker.innerHTML = state.agents.map(agent => `
            <label class="cluster-agent-option">
                <input type="checkbox" value="${escapeHtml(agent.id)}"${selected.has(agent.id) ? ' checked' : ''}>
                <div>
                    <div class="cluster-agent-option-title">${escapeHtml(agent.name)}</div>
                    <div class="cluster-agent-option-meta">${escapeHtml(agent.model || agent.id)}</div>
                </div>
            </label>
        `).join('');
    }

    function renderClusterPresetSummary() {
        if (!elements.clusterPresetSummary) {
            return;
        }

        const preset = getClusterWorkModePresetById(elements.clusterEditorPreset?.value);
        const styleValue = elements.clusterEditorStyle?.value || 'leader-draft';
        const deliveryValue = elements.clusterEditorDelivery?.value || 'balanced';
        const critiqueValue = elements.clusterEditorCritique?.value || 'standard';
        const roundsValue = normalizeClusterRoundsInput(elements.clusterEditorRounds?.value || 2, 2);
        const briefing = String(elements.clusterEditorBriefing?.value || '').trim();

        elements.clusterPresetSummary.innerHTML = `
            <h3>${escapeHtml(preset ? (t(`clusters.preset.${preset.id}.label`) || preset.id) : t('clusters.form.preset'))}</h3>
            <p>${escapeHtml(preset ? (t(`clusters.preset.${preset.id}.description`) || '') : '')}</p>
            <div class="cluster-preset-summary-grid">
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.collaborationStyle'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterStyleLabel(styleValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.deliveryStyle'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterDeliveryLabel(deliveryValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.critiqueLevel'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterCritiqueLabel(critiqueValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.rounds'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(t('clusters.rounds.value', { count: roundsValue }) || String(roundsValue))}</div>
                </div>
            </div>
            ${briefing ? `<p>${escapeHtml(briefing)}</p>` : ''}
        `;
    }

    function applyClusterPreset(presetId) {
        const preset = getClusterWorkModePresetById(presetId);
        if (!preset) {
            return;
        }

        if (elements.clusterEditorPreset) {
            elements.clusterEditorPreset.value = preset.id;
        }
        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.value = preset.collaborationStyle;
        }
        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.value = preset.deliveryStyle;
        }
        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.value = preset.critiqueLevel;
        }
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(preset.rounds, 2));
        }
        if (elements.clusterEditorBriefing && !String(elements.clusterEditorBriefing.value || '').trim()) {
            elements.clusterEditorBriefing.value = preset.briefing || '';
        }

        renderClusterPresetSummary();
    }

    function openClusterEditor(clusterId) {
        applyView('clusters');
        populateClusterEditorOptions();

        const cluster = clusterId
            ? state.clusters.find(item => item.id === clusterId) || null
            : null;
        const config = getClusterWorkModeConfig(cluster);
        const selectedAgentIds = cluster?.agentIds || state.agents.slice(0, Math.min(3, state.agents.length)).map(agent => agent.id);

        if (elements.clusterModalTitle) {
            elements.clusterModalTitle.textContent = cluster
                ? (t('clusters.editTitle', { name: cluster.name }) || cluster.name)
                : t('clusters.create');
        }
        if (elements.clusterEditorId) {
            elements.clusterEditorId.value = cluster?.id || '';
        }
        if (elements.clusterEditorName) {
            elements.clusterEditorName.value = cluster?.name || '';
        }
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = config.briefing || '';
        }

        renderClusterAgentPicker(selectedAgentIds);
        applyClusterPreset(config.presetId);

        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.value = config.collaborationStyle;
        }
        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.value = config.deliveryStyle;
        }
        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.value = config.critiqueLevel;
        }
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(config.rounds, 2));
        }
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = config.briefing || '';
        }

        renderClusterPresetSummary();
        openModal(elements.modalClusterEditor);
    }

    function saveClusterEditor() {
        const clusterId = String(elements.clusterEditorId?.value || '').trim();
        const name = String(elements.clusterEditorName?.value || '').trim();
        const selectedAgentIds = Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);

        if (!name) {
            showError(t('clusters.validationName'));
            return;
        }

        if (selectedAgentIds.length === 0) {
            showError(t('clusters.validationAgents'));
            return;
        }

        vscode.postMessage({
            type: 'saveCluster',
            clusterId: clusterId || undefined,
            data: {
                name,
                agentIds: selectedAgentIds,
                workspaceConfig: {
                    presetId: elements.clusterEditorPreset?.value || 'implementation-squad',
                    collaborationStyle: elements.clusterEditorStyle?.value || 'leader-draft',
                    deliveryStyle: elements.clusterEditorDelivery?.value || 'balanced',
                    critiqueLevel: elements.clusterEditorCritique?.value || 'standard',
                    rounds: normalizeClusterRoundsInput(elements.clusterEditorRounds?.value || 2, 2),
                    briefing: String(elements.clusterEditorBriefing?.value || '').trim()
                }
            }
        });
        closeAllModals();
    }

    function renderClusterWorkmodeSummary(cluster) {
        if (!elements.clusterWorkmodeSummary) {
            return;
        }

        const config = getClusterWorkModeConfig(cluster);
        const preset = getClusterWorkModePresetById(config.presetId);
        elements.clusterWorkmodeSummary.innerHTML = [
            preset ? `<span class="cluster-workmode-chip">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</span>` : '',
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterStyleLabel(config.collaborationStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterDeliveryLabel(config.deliveryStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterCritiqueLabel(config.critiqueLevel))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(t('clusters.rounds.value', { count: config.rounds }) || String(config.rounds))}</span>`
        ].filter(Boolean).join('');
    }

    function mergeClusterState(existingCluster, nextCluster) {
        if (!nextCluster || !nextCluster.id) {
            return existingCluster || nextCluster;
        }

        return {
            ...(existingCluster || {}),
            ...nextCluster,
            agentIds: Array.isArray(nextCluster.agentIds)
                ? [...nextCluster.agentIds]
                : Array.isArray(existingCluster?.agentIds)
                    ? [...existingCluster.agentIds]
                    : [],
            workspaceConfig: nextCluster.workspaceConfig
                ? {
                    ...(existingCluster?.workspaceConfig || {}),
                    ...nextCluster.workspaceConfig
                }
                : existingCluster?.workspaceConfig
        };
    }

    function getClusterStyleLabel(value) {
        switch (value) {
            case 'debate':
                return t('clusters.style.debate');
            case 'round-robin':
                return t('clusters.style.roundRobin');
            case 'review-board':
                return t('clusters.style.reviewBoard');
            case 'leader-draft':
            default:
                return t('clusters.style.leaderDraft');
        }
    }

    function getClusterDeliveryLabel(value) {
        switch (value) {
            case 'fast':
                return t('clusters.delivery.fast');
            case 'deep':
                return t('clusters.delivery.deep');
            case 'balanced':
            default:
                return t('clusters.delivery.balanced');
        }
    }

    function getClusterCritiqueLabel(value) {
        switch (value) {
            case 'minimal':
                return t('clusters.critique.minimal');
            case 'aggressive':
                return t('clusters.critique.aggressive');
            case 'standard':
            default:
                return t('clusters.critique.standard');
        }
    }

    function upsertClusterState(cluster, options = {}) {
        if (!cluster || !cluster.id) {
            return;
        }

        const index = state.clusters.findIndex(item => item.id === cluster.id);
        const mergedCluster = mergeClusterState(index >= 0 ? state.clusters[index] : null, cluster);
        if (index >= 0) {
            state.clusters[index] = mergedCluster;
        } else {
            state.clusters.push(mergedCluster);
        }

        if (options.select !== false) {
            state.currentClusterId = mergedCluster.id;
        }

        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        renderConsoleOverview();
    }

    // Render clusters
    function renderClusters(clusters) {
        const previousClustersById = new Map((Array.isArray(state.clusters) ? state.clusters : []).map(cluster => [cluster.id, cluster]));
        state.clusters = Array.isArray(clusters)
            ? clusters.map(cluster => mergeClusterState(previousClustersById.get(cluster.id), cluster))
            : [];

        if (state.currentClusterId && !state.clusters.some(cluster => cluster.id === state.currentClusterId)) {
            state.currentClusterId = null;
        }

        if (!state.currentClusterId && state.clusters.length > 0) {
            state.currentClusterId = state.clusters[0].id;
        }

        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();

        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        updateTaskFormFields();
        renderConsoleOverview();
    }

    function renderClusterSidebarList(clusters) {
        if (!elements.clusterSidebarList) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!Array.isArray(clusters) || clusters.length === 0) {
            elements.clusterSidebarList.innerHTML = `<div class="cluster-sidebar-empty">${escapeHtml(t('clusters.emptySidebar'))}</div>`;
            return;
        }

        elements.clusterSidebarList.innerHTML = clusters.map(cluster => `
            <div class="cluster-sidebar-item ${cluster.id === state.currentClusterId ? 'active' : ''}" data-sidebar-cluster-id="${escapeHtml(cluster.id)}" title="${escapeHtml(cluster.name)}">
                <span class="cluster-sidebar-icon">&#128421;</span>
                <div class="cluster-sidebar-info">
                    <div class="cluster-sidebar-name">${escapeHtml(cluster.name)}</div>
                    <div class="cluster-sidebar-meta">${escapeHtml(t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</div>
                </div>
            </div>
        `).join('');
    }

    function renderClusterWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        const hasCluster = Boolean(cluster);

        elements.clusterEmptyState?.classList.toggle('hidden', hasCluster);
        elements.clusterWorkspace?.classList.toggle('hidden', !hasCluster);

        if (!cluster) {
            if (elements.clusterMessages) {
                elements.clusterMessages.innerHTML = `<div class="cluster-empty-conversation">${escapeHtml(t('clusters.emptyWorkspace'))}</div>`;
            }
            if (elements.clusterBriefing) {
                elements.clusterBriefing.textContent = '';
                elements.clusterBriefing.classList.add('hidden');
            }
            if (elements.clusterTargetTabs) {
                elements.clusterTargetTabs.innerHTML = '';
            }
            if (elements.clusterModeTabs) {
                elements.clusterModeTabs.innerHTML = '';
                elements.clusterModeTabs.classList.add('hidden');
            }
            if (elements.clusterMessageInput) {
                elements.clusterMessageInput.disabled = true;
            }
            if (elements.btnSendCluster) {
                elements.btnSendCluster.disabled = true;
            }
            if (elements.clusterTargetHint) {
                elements.clusterTargetHint.textContent = '';
            }
            if (elements.btnDeleteCurrentCluster) {
                elements.btnDeleteCurrentCluster.disabled = true;
            }
            if (elements.btnAddClusterAgent) {
                elements.btnAddClusterAgent.disabled = true;
            }
            if (elements.btnRemoveClusterAgent) {
                elements.btnRemoveClusterAgent.disabled = true;
            }
            if (elements.btnEditCluster) {
                elements.btnEditCluster.disabled = true;
            }
            if (elements.clusterWorkmodeSummary) {
                elements.clusterWorkmodeSummary.innerHTML = '';
            }
            return;
        }

        if (elements.clusterTitle) {
            elements.clusterTitle.textContent = cluster.name;
        }
        if (elements.clusterBriefing) {
            const briefing = String(getClusterWorkModeConfig(cluster).briefing || '').trim();
            elements.clusterBriefing.textContent = briefing;
            elements.clusterBriefing.classList.toggle('hidden', !briefing);
        }
        if (elements.clusterSubtitle) {
            elements.clusterSubtitle.textContent = t('clusters.subtitle', {
                count: cluster.agentIds.length,
                status: resolveClusterStatusLabel(cluster.status)
            });
        }
        if (elements.btnAddClusterAgent) {
            elements.btnAddClusterAgent.disabled = getAvailableAgentsForCluster(cluster).length === 0;
        }
        if (elements.btnRemoveClusterAgent) {
            elements.btnRemoveClusterAgent.disabled = cluster.agentIds.length <= 1;
        }
        if (elements.btnDeleteCurrentCluster) {
            elements.btnDeleteCurrentCluster.disabled = false;
        }
        if (elements.btnEditCluster) {
            elements.btnEditCluster.disabled = false;
        }
        renderClusterWorkmodeSummary(cluster);

        renderClusterTargetTabs(cluster);
        renderClusterModeTabs();
        renderCurrentClusterConversation();
        updateClusterInputState(cluster);
    }

    function renderClusterTargetTabs(cluster) {
        if (!elements.clusterTargetTabs) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const items = [
            `
                <button class="cluster-target-tab ${state.currentClusterTargetKind === 'swarm' ? 'active' : ''}" type="button" data-cluster-target-kind="swarm">
                    <span>${escapeHtml(t('clusters.targetSwarm'))}</span>
                    <span class="cluster-target-count">${escapeHtml(t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</span>
                </button>
            `
        ];

        cluster.agentIds.forEach(agentId => {
            items.push(`
                <button
                    class="cluster-target-tab ${state.currentClusterTargetKind === 'agent' && state.currentClusterAgentId === agentId ? 'active' : ''}"
                    type="button"
                    data-cluster-target-kind="agent"
                    data-cluster-agent-id="${escapeHtml(agentId)}"
                >
                    <span>${escapeHtml(resolveClusterAgentLabel(agentId))}</span>
                </button>
            `);
        });

        elements.clusterTargetTabs.innerHTML = items.join('');
    }

    function renderClusterModeTabs() {
        if (!elements.clusterModeTabs) {
            return;
        }

        if (state.currentClusterTargetKind !== 'swarm') {
            elements.clusterModeTabs.innerHTML = '';
            elements.clusterModeTabs.classList.add('hidden');
            return;
        }

        elements.clusterModeTabs.classList.remove('hidden');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        elements.clusterModeTabs.innerHTML = ['broadcast', 'collaborate'].map(mode => `
            <button
                class="cluster-mode-tab ${state.currentClusterSwarmMode === mode ? 'active' : ''}"
                type="button"
                data-cluster-mode="${mode}"
            >
                ${escapeHtml(t(mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate'))}
            </button>
        `).join('');
    }

    function renderCurrentClusterConversation() {
        if (!elements.clusterMessages) {
            return;
        }

        const cluster = getCurrentCluster();
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            elements.clusterMessages.innerHTML = `<div class="cluster-empty-conversation">${escapeHtml(t('clusters.emptyWorkspace'))}</div>`;
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);

        if (conversation.loading) {
            elements.clusterMessages.innerHTML = `
                <div class="context-loading">
                    <div class="context-loading-spinner"></div>
                    <span class="context-loading-text">${escapeHtml(t('common.loading'))}</span>
                </div>
            `;
            return;
        }

        const sections = [];
        if (conversation.messages.length === 0 && !conversation.pending) {
            sections.push(`<div class="cluster-empty-conversation">${escapeHtml(getClusterEmptyConversationCopy(cluster, target))}</div>`);
        } else {
            sections.push(buildClusterConversationEntries(conversation.messages).map(renderClusterConversationEntry).join(''));
        }

        if (conversation.pending) {
            sections.push(renderClusterPendingMessage(target));
        }

        elements.clusterMessages.innerHTML = sections.join('');
        scrollClusterToBottom();
    }

    function buildClusterConversationEntries(messages) {
        const entries = [];
        const sanitizedMessages = sanitizeClusterConversationMessages(messages);

        sanitizedMessages.forEach(msg => {
            if (!msg || shouldHideMessage(msg)) {
                return;
            }

            if (msg.role === 'user') {
                entries.push({
                    kind: 'message',
                    message: msg
                });
                return;
            }

            if (shouldAppendToTrace(msg)) {
                const currentEntry = entries[entries.length - 1];
                const shouldReuseTraceEntry = currentEntry?.kind === 'trace'
                    && currentEntry.displayName === (msg.displayName || '')
                    && currentEntry.contextLabel === (msg.contextLabel || '');

                if (shouldReuseTraceEntry) {
                    currentEntry.messages.push(msg);
                    return;
                }

                entries.push({
                    kind: 'trace',
                    displayName: msg.displayName || '',
                    contextLabel: msg.contextLabel || '',
                    messages: [msg]
                });
                return;
            }

            entries.push({
                kind: 'message',
                message: msg
            });
        });

        return entries;
    }

    function sanitizeClusterConversationMessages(messages) {
        const source = Array.isArray(messages) ? messages : [];
        const resolvedToolKeys = new Set();

        source.forEach(msg => {
            if (!msg) {
                return;
            }

            if (msg.role === 'tool') {
                resolvedToolKeys.add(getClusterToolKey(msg.toolCallId, msg.toolName));
                return;
            }

            if (!Array.isArray(msg.parts)) {
                return;
            }

            msg.parts
                .filter(part => part.type === 'toolResult')
                .forEach(part => resolvedToolKeys.add(getClusterToolKey(part.toolCallId, part.name)));
        });

        return source
            .map(msg => stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys))
            .filter(msg => {
                if (msg?.role !== 'tool') {
                    return true;
                }

                const toolKey = getClusterToolKey(msg.toolCallId, msg.toolName);
                return !source.some(other =>
                    other?.role === 'assistant'
                    && Array.isArray(other.parts)
                    && other.parts.some(part =>
                        part.type === 'toolResult'
                        && getClusterToolKey(part.toolCallId, part.name) === toolKey
                    )
                );
            });
    }

    function stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys) {
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.parts)) {
            return msg;
        }

        const nextParts = msg.parts.filter(part => {
            if (part.type !== 'toolCall') {
                return true;
            }

            return !resolvedToolKeys.has(getClusterToolKey(part.id, part.name));
        });

        return nextParts.length === msg.parts.length
            ? msg
            : {
                ...msg,
                parts: nextParts
            };
    }

    function getClusterToolKey(toolCallId, toolName) {
        return `${normalizeToolCallId(toolCallId)}::${normalizeToolName(toolName || 'tool')}`;
    }

    function renderClusterConversationEntry(entry) {
        if (!entry) {
            return '';
        }

        if (entry.kind === 'trace') {
            return renderClusterTraceEntry(entry);
        }

        return renderClusterStandaloneMessage(entry.message);
    }

    function renderClusterStandaloneMessage(msg) {
        if (!msg || shouldHideMessage(msg)) {
            return '';
        }

        const role = msg.role || 'assistant';
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const badge = msg.contextLabel ? `<span class="cluster-status-pill">${escapeHtml(msg.contextLabel)}</span>` : '';

        return `
            <div class="message message-${escapeHtml(role)}">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getMessageRoleLabel(msg))}</span>
                    ${badge}
                    ${time ? `<span class="message-time">${time}</span>` : ''}
                    ${tokenInfo}
                </div>
                ${renderMessageContent(msg)}
            </div>
        `;
    }

    function renderClusterTraceEntry(entry) {
        const headerMessage = entry.messages[0];
        const time = headerMessage?.timestamp ? new Date(headerMessage.timestamp).toLocaleTimeString() : '';
        const body = entry.messages.map(msg => `
            <div class="trace-segment trace-segment-${escapeHtml(msg.role || 'assistant')}">
                ${msg.role === 'tool' ? renderToolMessage(msg, Array.isArray(msg.parts) ? msg.parts : []) : renderMessageContent(msg)}
            </div>
        `).join('');

        return `
            <div class="message message-assistant message-trace">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getMessageRoleLabel(headerMessage))}</span>
                    ${entry.contextLabel ? `<span class="cluster-status-pill">${escapeHtml(entry.contextLabel)}</span>` : ''}
                    ${time ? `<span class="message-time">${time}</span>` : ''}
                </div>
                <div class="trace-body">${body}</div>
            </div>
        `;
    }

    function renderClusterPendingMessage(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return `
            <div class="message message-thinking thinking-indicator">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getClusterPendingLabel(target))}</span>
                    <span class="thinking-dots">
                        <span></span><span></span><span></span>
                    </span>
                </div>
                <div class="thinking-content">
                    <div class="thinking-line">${escapeHtml(t('thinking.processing'))}</div>
                </div>
            </div>
        `;
    }

    function updateClusterInputState(cluster) {
        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        const disabled = !cluster || conversation.loading || conversation.pending;

        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.disabled = disabled;
            elements.clusterMessageInput.placeholder = getClusterInputPlaceholder(cluster, target);
        }

        if (elements.btnSendCluster) {
            elements.btnSendCluster.disabled = disabled;
        }

        if (elements.btnStopCluster) {
            const canStop = Boolean(cluster) && (conversation.loading || conversation.pending);
            elements.btnStopCluster.classList.toggle('hidden', !canStop);
            elements.btnStopCluster.disabled = !canStop;
        }

        if (elements.clusterTargetHint) {
            elements.clusterTargetHint.textContent = getClusterTargetHint(cluster, target);
        }
    }

    function selectCluster(clusterId, options = {}) {
        const { notify = true } = options;
        state.currentClusterId = clusterId;
        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        applyView('clusters');

        if (notify) {
            vscode.postMessage({ type: 'switchView', view: 'clusters', clusterId });
        }
    }

    function selectClusterTarget(targetKind, agentId) {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        if (targetKind === 'agent' && agentId) {
            state.currentClusterTargetKind = 'agent';
            state.currentClusterAgentId = agentId;

            const conversation = ensureClusterConversation(getClusterConversationKey(cluster.id, {
                targetKind: 'agent',
                agentId
            }));

            if (!conversation.loaded && !conversation.loading) {
                conversation.loading = true;
                renderClusterWorkspace();
                vscode.postMessage({
                    type: 'loadClusterAgentMessages',
                    clusterId: cluster.id,
                    agentId
                });
                return;
            }
        } else {
            state.currentClusterTargetKind = 'swarm';
        }

        renderClusterWorkspace();
    }

    function selectClusterSwarmMode(mode) {
        if (mode !== 'broadcast' && mode !== 'collaborate') {
            return;
        }

        state.currentClusterSwarmMode = mode;
        renderClusterWorkspace();
    }

    function promptBroadcastToCluster(clusterId) {
        vscode.postMessage({
            type: 'promptBroadcastToCluster',
            clusterId
        });
    }

    function promptCollaborateCluster(clusterId) {
        vscode.postMessage({
            type: 'promptCollaborateCluster',
            clusterId
        });
    }

    function deleteCluster(clusterId) {
        vscode.postMessage({
            type: 'deleteCluster',
            clusterId
        });
    }

    function renderSwarmResults() {
        if (!state.lastSwarmRun) {
            return '';
        }

        if (state.lastSwarmRun.kind === 'collaboration') {
            return renderCollaborationResults(state.lastSwarmRun.result);
        }

        return renderBroadcastResults(state.lastSwarmRun.clusterId, state.lastSwarmRun.responses);
    }

    function renderBroadcastResults(clusterId, responses) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const cluster = state.clusters.find(item => item.id === clusterId);
        const entries = Object.values(responses || {});
        if (entries.length === 0) {
            return '';
        }

        return `
            <div class="broadcast-results">
                <h4>${t('clusters.resultsTitle') || 'Broadcast Results'}${cluster ? ` · ${escapeHtml(cluster.name)}` : ''}</h4>
                ${entries.map(entry => `
                    <div class="broadcast-result-item">
                        <div class="message-header">
                            <span class="message-role">${escapeHtml(resolveAgentLabel(entry.agentId))}</span>
                            <span class="message-time">${entry.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                        </div>
                        <div class="message-content">
                            ${entry.ok && entry.message
                                ? formatContent(entry.message.content || '')
                                : `<p>${escapeHtml(entry.error || (t('clusters.resultUnknownError') || 'Unknown error'))}</p>`}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderCollaborationResults(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        if (!result) {
            return '';
        }

        const cluster = state.clusters.find(item => item.id === result.clusterId);
        const clusterName = cluster?.name || result.clusterName || '';
        const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
            ? result.rounds
            : [{
                kind: 'revision-2',
                entries: result.contributions || {}
            }];
        const finalAnswerHtml = result.synthesis?.ok && result.synthesis.message
            ? formatContent(result.synthesis.message.content || '')
            : `<p>${escapeHtml(result.synthesis?.error || (t('clusters.noSuccessfulAgents') || 'No agent produced a usable contribution.'))}</p>`;
        const roundsHtml = rounds.map(round => {
            const roundAgentIds = (cluster?.agentIds || Object.keys(round.entries || {}))
                .filter(agentId => round.entries?.[agentId]);
            if (roundAgentIds.length === 0) {
                return '';
            }

            return `
                <h4>${escapeHtml(getCollaborationRoundLabel(round.kind, t))}</h4>
                ${roundAgentIds.map(agentId => {
                    const entry = round.entries[agentId];
                    return `
                        <div class="broadcast-result-item">
                            <div class="message-header">
                                <span class="message-role">${escapeHtml(resolveAgentLabel(agentId))}</span>
                                <span class="message-time">${entry.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                            </div>
                            <div class="message-content">
                                ${entry.ok && entry.message
                                    ? formatContent(entry.message.content || '')
                                    : `<p>${escapeHtml(entry.error || (t('clusters.resultUnknownError') || 'Unknown error'))}</p>`}
                            </div>
                        </div>
                    `;
                }).join('')}
            `;
        }).join('');
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : '—';

        return `
            <div class="broadcast-results">
                <h4>${t('clusters.collaborationTitle') || 'Swarm Collaboration'}${clusterName ? ` · ${escapeHtml(clusterName)}` : ''}</h4>
                <div class="broadcast-result-item">
                    <div class="message-header">
                        <span class="message-role">${t('clusters.coordinator') || 'Coordinator'}: ${escapeHtml(coordinatorLabel)}</span>
                        <span class="message-time">${result.synthesis?.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                    </div>
                    <div class="message-header">
                        <span class="message-role">${t('clusters.finalAnswer') || 'Final Answer'}</span>
                    </div>
                    <div class="message-content">${finalAnswerHtml}</div>
                </div>
                <h4>${getTranslationOrFallback(t, 'clusters.debateRounds', 'Debate Rounds')}</h4>
                ${roundsHtml}
            </div>
        `;
    }

    function getTranslationOrFallback(t, key, fallback) {
        const translated = t(key);
        return translated && translated !== key ? translated : fallback;
    }

    function getCollaborationRoundLabel(kind, t) {
        const keyMap = {
            opening: 'clusters.debateRoundOpening',
            'critique-1': 'clusters.debateRoundCritique1',
            'revision-1': 'clusters.debateRoundRevision1',
            'critique-2': 'clusters.debateRoundCritique2',
            'revision-2': 'clusters.debateRoundRevision2'
        };
        const fallbackMap = {
            opening: 'Round 1 - Opening Positions',
            'critique-1': 'Round 2 - Peer Review',
            'revision-1': 'Round 3 - Revised Positions',
            'critique-2': 'Round 4 - Second Peer Review',
            'revision-2': 'Round 5 - Final Positions'
        };

        if (keyMap[kind]) {
            return getTranslationOrFallback(t, keyMap[kind], fallbackMap[kind]);
        }

        switch (kind) {
            case 'opening':
                return t('clusters.debateRoundOpening') || 'Round 1 · Opening Positions';
            case 'critique-1':
                return t('clusters.debateRoundCritique1') || 'Round 2 · Peer Review';
            case 'revision-1':
                return t('clusters.debateRoundRevision1') || 'Round 3 · Revised Positions';
            case 'critique-2':
                return t('clusters.debateRoundCritique2') || 'Round 4 · Second Peer Review';
            case 'revision-2':
                return t('clusters.debateRoundRevision2') || 'Round 5 · Final Positions';
            default:
                return t('clusters.contributions') || 'Contributions';
        }
    }

    function getCurrentCluster() {
        return state.clusters.find(cluster => cluster.id === state.currentClusterId) || null;
    }

    function getCollaborationRoundLabel(kind, t) {
        const keyMap = {
            opening: 'clusters.debateRoundOpening',
            'critique-1': 'clusters.debateRoundCritique1',
            'revision-1': 'clusters.debateRoundRevision1',
            'critique-2': 'clusters.debateRoundCritique2',
            'revision-2': 'clusters.debateRoundRevision2'
        };
        const fallbackMap = {
            opening: 'Round 1 - Opening Positions',
            'critique-1': 'Round 2 - Peer Review',
            'revision-1': 'Round 3 - Revised Positions',
            'critique-2': 'Round 4 - Second Peer Review',
            'revision-2': 'Round 5 - Final Positions'
        };

        if (keyMap[kind]) {
            return getTranslationOrFallback(t, keyMap[kind], fallbackMap[kind]);
        }

        if (kind === 'opening') {
            return t('clusters.debateRoundOpening') || 'Round 1 - Opening Positions';
        }

        if (kind.startsWith('critique-')) {
            const round = Number(kind.slice('critique-'.length) || '1');
            return t('clusters.debateRoundCritiqueDynamic', { round }) || `Critique Round ${round}`;
        }

        if (kind.startsWith('revision-')) {
            const round = Number(kind.slice('revision-'.length) || '1');
            return t('clusters.debateRoundRevisionDynamic', { round }) || `Revision Round ${round}`;
        }

        return t('clusters.contributions') || 'Contributions';
    }

    function ensureCurrentClusterSelection() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            return;
        }

        if (state.currentClusterTargetKind === 'agent' && !cluster.agentIds.includes(state.currentClusterAgentId)) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
        }

        if (!state.currentClusterSwarmMode) {
            state.currentClusterSwarmMode = 'broadcast';
        }

        if (state.currentClusterTargetKind === 'swarm') {
            ensureClusterConversation(getClusterConversationKey(cluster.id, {
                targetKind: 'swarm',
                mode: state.currentClusterSwarmMode
            })).loaded = true;
        }
    }

    function getCurrentClusterTargetInfo(cluster = getCurrentCluster()) {
        if (!cluster) {
            return {
                kind: 'swarm',
                mode: state.currentClusterSwarmMode,
                agentId: null,
                key: getClusterConversationKey('', {
                    targetKind: 'swarm',
                    mode: state.currentClusterSwarmMode
                })
            };
        }

        if (state.currentClusterTargetKind === 'agent' && state.currentClusterAgentId) {
            return {
                kind: 'agent',
                agentId: state.currentClusterAgentId,
                key: getClusterConversationKey(cluster.id, {
                    targetKind: 'agent',
                    agentId: state.currentClusterAgentId
                })
            };
        }

        return {
            kind: 'swarm',
            mode: state.currentClusterSwarmMode,
            agentId: null,
            key: getClusterConversationKey(cluster.id, {
                targetKind: 'swarm',
                mode: state.currentClusterSwarmMode
            })
        };
    }

    function getClusterConversationKey(clusterId, options = {}) {
        const targetKind = options.targetKind || state.currentClusterTargetKind;
        if (targetKind === 'agent') {
            return `cluster:${clusterId}:agent:${options.agentId || state.currentClusterAgentId || ''}`;
        }

        return `cluster:${clusterId}:swarm:${options.mode || state.currentClusterSwarmMode || 'broadcast'}`;
    }

    function ensureClusterConversation(key) {
        if (!state.clusterConversations[key]) {
            state.clusterConversations[key] = {
                messages: [],
                loading: false,
                loaded: false,
                pending: false
            };
        }

        return state.clusterConversations[key];
    }

    function setClusterConversationLoading(clusterId, agentId, loading) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.loading = Boolean(loading);
        if (!loading) {
            conversation.loaded = true;
        }
        renderClusterWorkspace();
    }

    function replaceClusterConversationMessages(clusterId, agentId, messages) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.messages = Array.isArray(messages) ? messages : [];
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function appendClusterConversationMessage(clusterId, agentId, message) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.messages.push(message);
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function appendSwarmConversationMessages(clusterId, mode, messages) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.messages.push(...messages);
        conversation.pending = false;
        conversation.loaded = true;
        renderClusterWorkspace();
    }

    function clearSwarmConversationPending(clusterId, mode) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function clearCurrentClusterPendingState() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        const conversation = ensureClusterConversation(getCurrentClusterTargetInfo(cluster).key);
        conversation.pending = false;
        conversation.loading = false;
        renderClusterWorkspace();
    }

    function buildBroadcastConversationMessages(responses) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const messages = [];
        Object.values(responses || {}).forEach(entry => {
            const displayName = resolveAgentLabel(entry.agentId);
            const contextLabel = t('clusters.broadcast');
            if (entry.ok) {
                messages.push(...buildAgentTraceMessages(entry, displayName, contextLabel));
                return;
            }

            messages.push({
                role: 'assistant',
                content: entry.error || t('clusters.resultUnknownError'),
                timestamp: new Date().toISOString(),
                displayName,
                contextLabel
            });
        });
        return messages;
    }

    function buildAgentTraceMessages(entry, displayName, contextLabel) {
        const trace = Array.isArray(entry?.trace) ? entry.trace : [];
        const source = trace.length > 0
            ? trace
            : (entry?.message ? [entry.message] : []);
        const deduped = [];
        const seen = new Set();

        source.forEach(message => {
            if (!message) {
                return;
            }

            const id = message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
            if (seen.has(id)) {
                return;
            }
            seen.add(id);

            deduped.push({
                ...message,
                displayName,
                contextLabel
            });
        });

        return deduped;
    }

    function buildCollaborationConversationMessages(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!result) {
            return [];
        }

        const messages = [];
        const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
            ? result.rounds
            : [{
                kind: 'revision-2',
                entries: result.contributions || {}
            }];
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : t('clusters.targetSwarm');

        rounds.forEach(round => {
            const roundLabel = getCollaborationRoundLabel(round.kind, t);
            Object.entries(round.entries || {}).forEach(([agentId, entry]) => {
                if (entry.ok) {
                    messages.push(...buildAgentTraceMessages(
                        entry,
                        resolveAgentLabel(agentId),
                        roundLabel
                    ));
                    return;
                }

                messages.push({
                        role: 'assistant',
                        content: entry.error || t('clusters.resultUnknownError'),
                        timestamp: new Date().toISOString(),
                        displayName: resolveAgentLabel(agentId),
                        contextLabel: roundLabel
                    });
            });
        });

        messages.push(result.synthesis?.ok && result.synthesis.message
            ? {
                ...result.synthesis.message,
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            }
            : {
                role: 'assistant',
                content: result.synthesis?.error || t('clusters.noSuccessfulAgents'),
                timestamp: new Date().toISOString(),
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            });

        return messages;
    }

    function getClusterEmptyConversationCopy(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return t('clusters.emptyAgentConversation', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.emptyCollaborateConversation', { count: cluster.agentIds.length })
            : t('clusters.emptyBroadcastConversation', { count: cluster.agentIds.length });
    }

    function getClusterInputPlaceholder(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            return t('clusters.chatPlaceholder');
        }

        if (target.kind === 'agent') {
            return t('clusters.chatPlaceholderAgent', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.chatPlaceholderCollaborate')
            : t('clusters.chatPlaceholderBroadcast');
    }

    function getClusterTargetHint(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            return '';
        }

        if (target.kind === 'agent') {
            return t('clusters.hintAgent', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.hintCollaborate', { count: cluster.agentIds.length })
            : t('clusters.hintBroadcast', { count: cluster.agentIds.length });
    }

    function getClusterPendingLabel(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return resolveClusterAgentLabel(target.agentId);
        }

        return t(target.mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate');
    }

    function scrollClusterToBottom() {
        if (!elements.clusterMessages) {
            return;
        }

        elements.clusterMessages.scrollTop = elements.clusterMessages.scrollHeight;
    }

    function getAvailableAgentsForCluster(cluster) {
        if (!cluster) {
            return [];
        }

        return state.agents.filter(agent => !cluster.agentIds.includes(agent.id));
    }

    function resolveClusterStatusLabel(status) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (status === 'active') {
            return t('clusters.statusActive');
        }
        if (status === 'inactive') {
            return t('clusters.statusInactive');
        }
        return t('clusters.statusUnknown');
    }

    function resolveAgentLabel(agentId) {
        if (!agentId) {
            return '—';
        }

        const agent = state.agents.find(item => item.id === agentId);
        if (!agent) {
            return agentId;
        }

        return `${agent.name} (${agent.model})`;
    }

    function resolveClusterAgentLabel(agentId) {
        if (!agentId) {
            return '-';
        }

        const agent = state.agents.find(item => item.id === agentId);
        return agent?.name || agentId;
    }

    function resolveTaskAgentLabel(agentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!agentId) {
            return t('tasks.form.agentDefault');
        }

        return resolveAgentLabel(agentId);
    }

    function populateTaskAgentOptions(selectedAgentId) {
        const select = document.getElementById('task-agent-id');
        if (!select) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const options = [{
            value: '',
            label: t('tasks.form.agentDefault')
        }];

        state.agents.forEach(agent => {
            options.push({
                value: agent.id,
                label: `${agent.name} (${agent.model})`
            });
        });

        if (selectedAgentId && !options.some(option => option.value === selectedAgentId)) {
            options.push({
                value: selectedAgentId,
                label: selectedAgentId
            });
        }

        select.innerHTML = options.map(option => `
            <option value="${escapeHtml(option.value)}"${option.value === (selectedAgentId || '') ? ' selected' : ''}>
                ${escapeHtml(option.label)}
            </option>
        `).join('');
    }

    function extractTaskContent(task) {
        if (!task || !task.payload) {
            return '';
        }

        return task.payload.kind === 'systemEvent'
            ? (task.payload.text || '')
            : (task.payload.message || '');
    }

    function formatTaskSchedule(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!task || !task.schedule) {
            return '-';
        }

        if (task.schedule.kind === 'at') {
            return `${t('tasks.form.scheduleAt')}: ${formatTaskDateTime(task.schedule.at)}`;
        }

        if (task.schedule.kind === 'cron') {
            return task.schedule.tz
                ? `${task.schedule.expr} (${task.schedule.tz})`
                : task.schedule.expr;
        }

        return formatEveryDuration(task.schedule.everyMs);
    }

    function formatEveryDuration(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '-';
        }

        if (value % 86400000 === 0) {
            return `${value / 86400000}d`;
        }

        if (value % 3600000 === 0) {
            return `${value / 3600000}h`;
        }

        if (value % 60000 === 0) {
            return `${value / 60000}m`;
        }

        if (value % 1000 === 0) {
            return `${value / 1000}s`;
        }

        return `${value}ms`;
    }

    function toDateTimeLocalValue(value) {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    function renderTasks(tasks, available = state.tasksAvailable, message = state.tasksMessage, sourcePath = state.tasksSourcePath) {
        state.tasks = Array.isArray(tasks) ? tasks : [];
        state.tasksAvailable = available !== false;
        state.tasksLoaded = true;
        state.tasksMessage = message || '';
        state.tasksSourcePath = sourcePath || '';
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        if (elements.btnCreateTask) {
            elements.btnCreateTask.disabled = !state.tasksAvailable;
            elements.btnCreateTask.title = state.tasksAvailable
                ? ''
                : resolveCapabilityUnavailableMessage('scheduledTasks');
        }

        if (elements.tasksSource) {
            elements.tasksSource.textContent = state.tasksSourcePath
                ? `${t('tasks.source')}: ${state.tasksSourcePath}`
                : '';
        }

        if (!elements.tasksList) {
            renderConsoleOverview();
            return;
        }

        if (!state.tasksAvailable) {
            elements.tasksList.innerHTML = `
                <div class="task-card unavailable">
                    <div class="task-summary">
                        <div class="task-summary-label">${escapeHtml(t('tasks.status.label'))}</div>
                        <div class="task-summary-text">${escapeHtml(state.tasksMessage || t('tasks.unavailable'))}</div>
                    </div>
                </div>
            `;
            renderConsoleOverview();
            return;
        }

        if (state.tasks.length === 0) {
            elements.tasksList.innerHTML = `<div class="empty">${t('tasks.empty')}</div>`;
            renderConsoleOverview();
            return;
        }

        elements.tasksList.innerHTML = state.tasks.map(task => renderTaskCard(task)).join('');
        renderConsoleOverview();
    }

    function renderTaskCard(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const effectiveStatus = task.enabled ? (task.lastRunStatus || 'idle') : 'disabled';
        const targetLabel = resolveTaskAgentLabel(task.agentId);
        const scheduleLabel = formatTaskSchedule(task);
        const nextRunLabel = task.enabled && task.nextRunAt
            ? formatTaskDateTime(task.nextRunAt)
            : t('tasks.status.disabled');
        const lastRunLabel = task.lastRunAt
            ? formatTaskDateTime(task.lastRunAt)
            : '-';
        const resultText = task.lastError || task.lastRunSummary || '-';
        const payloadKindLabel = task.payload?.kind === 'systemEvent'
            ? t('tasks.form.payloadSystemEvent')
            : t('tasks.form.payloadAgentTurn');
        const resultTitle = task.lastError
            ? t('tasks.lastError', { error: '' }).replace(/:\s*$/, '')
            : t('tasks.lastResult', { summary: '' }).replace(/:\s*$/, '');
        return `
            <div class="task-card ${escapeHtml(effectiveStatus)}">
                <div class="task-card-header">
                    <div class="task-card-title-wrap">
                        <h4>${escapeHtml(task.name)}</h4>
                        <div class="task-card-target">${escapeHtml(targetLabel)}</div>
                    </div>
                    <span class="task-status ${escapeHtml(effectiveStatus)}">${escapeHtml(t(`tasks.status.${effectiveStatus}`))}</span>
                </div>
                ${task.description ? `
                    <div class="task-summary">
                        <div class="task-summary-label">${escapeHtml(t('tasks.description'))}</div>
                        <div class="task-summary-text">${escapeHtml(task.description)}</div>
                    </div>
                ` : ''}
                <div class="task-meta">
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.schedule'))}</div>
                        <div class="task-meta-value">${escapeHtml(scheduleLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.nextRunAt', { time: '' }).replace(/:\s*$/, ''))}</div>
                        <div class="task-meta-value">${escapeHtml(nextRunLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.lastRunAt', { time: '' }).replace(/:\s*$/, ''))}</div>
                        <div class="task-meta-value">${escapeHtml(lastRunLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.target'))}</div>
                        <div class="task-meta-value">${escapeHtml(targetLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.payloadKind'))}</div>
                        <div class="task-meta-value">${escapeHtml(payloadKindLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.wakeMode'))}</div>
                        <div class="task-meta-value">${escapeHtml(t(task.wakeMode === 'next-heartbeat' ? 'tasks.form.wakeModeNextHeartbeat' : 'tasks.form.wakeModeNow'))}</div>
                    </div>
                </div>
                <div class="task-summary">
                    <div class="task-summary-label">${escapeHtml(resultTitle)}</div>
                    <div class="task-summary-text">${escapeHtml(resultText)}</div>
                </div>
                <details class="task-prompt">
                    <summary>${escapeHtml(t('tasks.form.content'))}</summary>
                    <pre>${escapeHtml(extractTaskContent(task) || '-')}</pre>
                </details>
                <div class="task-actions">
                    <button class="btn btn-small" data-task-action="run" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('tasks.runNow'))}</button>
                    <button class="btn btn-small" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('common.edit'))}</button>
                    <button class="btn btn-small btn-secondary" data-task-action="toggle" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.enabled ? t('tasks.disable') : t('tasks.enable'))}</button>
                    <button class="btn btn-small btn-secondary" data-task-action="delete" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('common.delete'))}</button>
                </div>
            </div>
        `;
    }

    function resolveLegacyTaskTargetLabel(task) {
        if (!task) {
            return '-';
        }

        if (task.targetType === 'cluster') {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            const cluster = state.clusters.find(item => item.id === task.targetId);
            const clusterName = cluster ? cluster.name : task.targetId;
            const modeKey = task.action === 'collaborate'
                ? 'tasks.form.actionCollaborate'
                : 'tasks.form.actionBroadcast';
            return `${clusterName} · ${t(modeKey)}`;
        }

        return resolveAgentLabel(task.targetId);
    }

    function resolveTaskTargetLabel(task) {
        return resolveTaskAgentLabel(task?.agentId);
    }

    function toggleTask(taskId) {
        const task = state.tasks.find(item => item.id === taskId);
        vscode.postMessage({
            type: 'toggleTask',
            taskId,
            enabled: task ? !task.enabled : undefined
        });
    }

    function runTask(taskId) {
        vscode.postMessage({
            type: 'runTask',
            taskId
        });
    }

    function deleteTask(taskId) {
        vscode.postMessage({
            type: 'deleteTask',
            taskId
        });
    }

    function formatTaskDateTime(value) {
        if (!value) {
            return '-';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString();
    }

    // Render usage
    function renderUsage(usage) {
        state.latestUsage = usage || null;
        const usageWindow = buildUsageWindow(state.latestUsage, state.usagePeriodDays);
        const requestsEl = document.getElementById('usage-requests');
        const tokensEl = document.getElementById('usage-tokens');
        const costEl = document.getElementById('usage-cost');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        if (requestsEl) requestsEl.textContent = usageWindow.totalRequests.toLocaleString();
        if (tokensEl) tokensEl.textContent = formatCompactNumber(usageWindow.totalTokens);
        if (costEl) costEl.textContent = formatUsageCurrency(usageWindow.totalCost, usageWindow.currencySymbol);

        if (elements.usagePeriodButtons) {
            elements.usagePeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-usage-period')) === state.usagePeriodDays);
            });
        }
        if (elements.usagePeriodCaption) {
            elements.usagePeriodCaption.textContent = t('usage.showingPeriod', { days: state.usagePeriodDays });
        }
        if (elements.usageChartTitle) {
            elements.usageChartTitle.textContent = t('usage.dailyUsagePeriod', { days: state.usagePeriodDays });
        }
        if (elements.modelChartTitle) {
            elements.modelChartTitle.textContent = t('usage.byModelPeriod', { days: state.usagePeriodDays });
        }

        const chartContainer = document.getElementById('usage-chart');
        if (chartContainer) {
            const maxTokens = usageWindow.days.reduce((max, [, data]) => Math.max(max, data.tokens || 0), 0);
            const hasUsageData = usageWindow.days.some(([, data]) => (data.tokens || 0) > 0 || (data.requests || 0) > 0 || (data.cost || 0) > 0);
            if (hasUsageData) {
                chartContainer.innerHTML = usageWindow.days.map(([date, data]) => `
                    <div class="bar-item">
                        <div
                            class="bar"
                            style="height: ${computeUsageBarHeight(data.tokens || 0, maxTokens)}px"
                            title="${escapeHtml(buildDailyUsageBarTooltip(t, date, data, usageWindow.currencySymbol))}"
                            aria-label="${escapeHtml(buildDailyUsageBarTooltip(t, date, data, usageWindow.currencySymbol))}"
                        ></div>
                        <div class="bar-label">${date.slice(5)}</div>
                    </div>
                `).join('');
            } else {
                chartContainer.innerHTML = `<div class="empty">${escapeHtml(t('usage.noData'))}</div>`;
            }
        }

        const modelChart = document.getElementById('model-chart');
        if (modelChart) {
            const models = Object.entries(usageWindow.byModel || {}).sort(([, left], [, right]) => (right.tokens || 0) - (left.tokens || 0));
            if (models.length > 0 && usageWindow.totalTokens > 0) {
                modelChart.innerHTML = models.map(([model, data]) => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(model)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((data.tokens || 0) / usageWindow.totalTokens * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${formatCompactNumber(data.tokens || 0)} tokens</div>
                    </div>
                `).join('');
            } else {
                modelChart.innerHTML = `<div class="empty">${escapeHtml(t('usage.noModelData'))}</div>`;
            }
        }
    }

    function renderChannel(usage) {
        state.latestUsage = usage || null;
        const channelWindow = buildChannelWindow(state.latestUsage, state.channelPeriodDays);
        const activeCountEl = document.getElementById('channel-active-count');
        const topNameEl = document.getElementById('channel-top-name');
        const topTokensEl = document.getElementById('channel-top-tokens');
        const topRequestsEl = document.getElementById('channel-top-requests');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        if (activeCountEl) activeCountEl.textContent = channelWindow.totalChannels.toLocaleString();
        if (topNameEl) topNameEl.textContent = channelWindow.dominantChannel || t('channel.none');
        if (topTokensEl) topTokensEl.textContent = formatCompactNumber(channelWindow.dominantTokens);
        if (topRequestsEl) topRequestsEl.textContent = channelWindow.dominantRequests.toLocaleString();

        if (elements.channelPeriodButtons) {
            elements.channelPeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-channel-period')) === state.channelPeriodDays);
            });
        }
        if (elements.channelPeriodCaption) {
            elements.channelPeriodCaption.textContent = t('channel.showingPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelChartTitle) {
            elements.channelChartTitle.textContent = t('channel.byTokensPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelRequestsTitle) {
            elements.channelRequestsTitle.textContent = t('channel.byRequestsPeriod', { days: state.channelPeriodDays });
        }

        const channelChart = document.getElementById('channel-chart');
        if (channelChart) {
            if (channelWindow.channels.length > 0 && channelWindow.totalTokens > 0) {
                channelChart.innerHTML = channelWindow.channels.map(channel => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(channel.channel)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((channel.tokens || 0) / channelWindow.totalTokens * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${formatCompactNumber(channel.tokens || 0)} tokens</div>
                    </div>
                `).join('');
            } else {
                channelChart.innerHTML = `<div class="empty">${escapeHtml(t('channel.noData'))}</div>`;
            }
        }

        const requestsChart = document.getElementById('channel-requests-chart');
        if (requestsChart) {
            if (channelWindow.channels.length > 0 && channelWindow.totalRequests > 0) {
                requestsChart.innerHTML = channelWindow.channels.map(channel => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(channel.channel)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((channel.requests || 0) / channelWindow.totalRequests * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${(channel.requests || 0).toLocaleString()} req</div>
                    </div>
                `).join('');
            } else {
                requestsChart.innerHTML = `<div class="empty">${escapeHtml(t('channel.noData'))}</div>`;
            }
        }
    }

    function buildDailyUsageBarTooltip(t, date, data, currencySymbol) {
        return [
            date,
            `${t('usage.totalTokens')}: ${(data.tokens || 0).toLocaleString()}`,
            `${t('usage.totalRequests')}: ${(data.requests || 0).toLocaleString()}`,
            `${t('usage.estimatedCost')}: ${formatUsageCurrency(data.cost || 0, currencySymbol)}`
        ].join(' • ');
    }

    function setUsagePeriod(days) {
        if ((days !== 7 && days !== 30) || state.usagePeriodDays === days) {
            return;
        }

        state.usagePeriodDays = days;
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
    }

    function setChannelPeriod(days) {
        if ((days !== 7 && days !== 30) || state.channelPeriodDays === days) {
            return;
        }

        state.channelPeriodDays = days;
        if (state.latestUsage) {
            renderChannel(state.latestUsage);
        }
    }

    function buildUsageWindow(usage, days) {
        return window.OpenClawPanelCommon.buildUsageWindow(usage, days);
    }

    function buildChannelWindow(usage, days) {
        return window.OpenClawPanelCommon.buildChannelWindow(usage, days);
    }

    function computeUsageBarHeight(value, maxValue) {
        return window.OpenClawPanelCommon.computeUsageBarHeight(value, maxValue);
    }

    function formatCompactNumber(n) {
        return window.OpenClawPanelCommon.formatCompactNumber(n);
    }

    function formatUsageCurrency(value, symbol) {
        return window.OpenClawPanelCommon.formatUsageCurrency(value, symbol);
    }

    // Message handling from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'runtimeState':
                state.runtime = {
                    connected: Boolean(message.connected),
                    mode: message.mode || 'gateway',
                    sourceDescription: message.sourceDescription || '',
                    supportsTasks: Boolean(message.supportsTasks),
                    supportsLiveSync: Boolean(message.supportsLiveSync),
                    capabilities: message.capabilities || null,
                    capabilityMatrix: Array.isArray(message.capabilityMatrix) ? message.capabilityMatrix : [],
                    diagnostics: message.diagnostics || null,
                    openClawConfig: message.openClawConfig || null
                };
                updateConnectionBadge();
                renderConsoleOverview();
                break;

            case 'agentsLoaded':
                renderAgents(message.agents);
                populateModelSelect(message.models || []);
                setAgentPresets(message.presets || state.agentPresets);
                break;

            case 'agentMutationState':
                if (message.pending) {
                    if (agentMutationTimer) {
                        window.clearTimeout(agentMutationTimer);
                        agentMutationTimer = null;
                    }
                    state.agentMutation = {
                        action: message.action === 'delete' ? 'delete' : 'create',
                        pending: true,
                        agentName: typeof message.agentName === 'string' ? message.agentName : '',
                        agentId: typeof message.agentId === 'string' ? message.agentId : ''
                    };
                    renderAgents(state.agents);
                    break;
                }

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
                    clearAgentMutationBanner(8000);
                    break;
                }

                clearAgentMutationBanner(0);
                break;
                 
            case 'addMessage':
                addMessage(message.message);
                break;
                
            case 'updateStreamingMessage':
                updateStreamingMessage(message.content, message.done);
                break;

            case 'replaceMessages':
                resetTransientChatState();
                renderedChatMessageIds.clear();
                elements.chatMessages.innerHTML = '';
                isBulkRenderingChat = true;
                (message.messages || []).forEach(item => addMessage(item));
                isBulkRenderingChat = false;
                updateChatHomeVisibility();
                scrollToBottom();
                break;
                 
            case 'clearChat':
                resetTransientChatState();
                renderedChatMessageIds.clear();
                elements.chatMessages.innerHTML = '';
                updateChatHomeVisibility();
                break;
                 
            case 'setActiveAgent':
                resetTransientChatState();
                renderedChatMessageIds.clear();
                state.currentAgentId = message.agentId;
                renderAgents(state.agents);
                renderConsoleOverview();
                break;
                
            case 'setInputText':
                elements.messageInput.value = message.text;
                break;
                
            case 'clustersLoaded':
                if (Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                if (message.selectedClusterId) {
                    state.currentClusterId = message.selectedClusterId;
                }
                renderClusters(message.clusters);
                break;

            case 'tasksLoaded':
                renderTasks(message.tasks, message.available, message.message, message.sourcePath);
                break;
                
            case 'usageLoaded':
                renderUsage(message.usage);
                break;

            case 'channelsLoaded':
                renderChannels(message.channels, message.selectedChannelId);
                break;

            case 'setActiveChannel':
                state.currentChannelId = message.channelId || null;
                if (state.currentChannelId) {
                    state.channelDraft = null;
                }
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

            case 'setChannelContextLoading':
                if (!message.channelId || message.channelId === state.currentChannelId) {
                    state.channelLoading = Boolean(message.loading);
                    if (!state.channelLoading) {
                        updateChannelInputState();
                    }
                    renderChannelConversation();
                }
                break;

            case 'replaceChannelMessages':
                if (message.channelId === null || message.channelId === state.currentChannelId) {
                    state.channelMessages = Array.isArray(message.messages) ? message.messages : [];
                    state.channelLoading = false;
                    renderChannelConversation();
                    updateChannelInputState();
                }
                break;

            case 'addChannelMessage':
                if (message.channelId === state.currentChannelId) {
                    clearChannelThinkingIndicator();
                    addChannelMessage(message.message);
                    state.channelSending = false;
                    updateChannelInputState();
                }
                break;

            case 'channelSendFailed':
                if (message.channelId === state.currentChannelId) {
                    clearChannelThinkingIndicator();
                    state.channelSending = false;
                    updateChannelInputState();
                    showChannelError(message.message);
                }
                break;

            case 'setRunState':
                if (message.scope === 'chat') {
                    state.isStreaming = Boolean(message.running);
                    updateChatInputState();
                    break;
                }
                if (message.scope === 'channel') {
                    state.channelSending = Boolean(message.running);
                    updateChannelInputState();
                }
                break;

            case 'switchView':
                applyView(message.view);
                if (message.view === 'clusters' && message.selectedClusterId) {
                    state.currentClusterId = message.selectedClusterId;
                }
                if (message.view === 'clusters' && Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                if (message.view === 'clusters' && message.clusters) {
                    renderClusters(message.clusters);
                }
                if (message.view === 'usage' && message.usage) {
                    renderUsage(message.usage);
                }
                if (message.view === 'tasks' && message.tasks) {
                    renderTasks(message.tasks);
                }
                break;
                
            case 'showAgentSettings':
                if (Array.isArray(message.aiSkills)) {
                    state.aiSkills = message.aiSkills;
                }
                showAgentSettings(message.agent);
                break;

            case 'showTaskEditor':
                showTaskEditor(message.task || null);
                break;

            case 'showClusterEditor':
                if (Array.isArray(message.workModePresets)) {
                    state.clusterWorkModePresets = message.workModePresets;
                }
                openClusterEditor(message.clusterId || state.currentClusterId || undefined);
                break;

            case 'agentSaved':
                upsertAgentState(message.agent);
                break;

            case 'clusterSaved':
                upsertClusterState(message.cluster);
                break;
                
            case 'broadcastResults':
                appendSwarmConversationMessages(
                    message.clusterId,
                    'broadcast',
                    buildBroadcastConversationMessages(message.responses || {})
                );
                break;

            case 'collaborationResults':
                appendSwarmConversationMessages(
                    message.result?.clusterId || state.currentClusterId,
                    'collaborate',
                    buildCollaborationConversationMessages(message.result || null)
                );
                break;

            case 'setClusterContextLoading':
                setClusterConversationLoading(message.clusterId, message.agentId, message.loading);
                break;

            case 'replaceClusterMessages':
                replaceClusterConversationMessages(message.clusterId, message.agentId, message.messages || []);
                break;

            case 'clusterAgentResponse':
                appendClusterConversationMessage(message.clusterId, message.agentId, message.message);
                break;

            case 'clusterRunFailed':
                clearSwarmConversationPending(message.clusterId, message.mode);
                break;

            case 'agentsLoadFailed':
                elements.agentList.innerHTML = `<div class="empty">Failed to load agents: ${escapeHtml(message.message)}</div>`;
                renderConsoleOverview();
                break;

            case 'setContextLoading':
                if (message.loading) {
                    showContextLoading();
                } else {
                    hideContextLoading();
                }
                break;
                
            case 'error':
                showError(message.message);
                resetTransientChatState();
                if (state.viewMode === 'clusters') {
                    clearCurrentClusterPendingState();
                }
                break;

            case 'connectionSettingsSaved':
                state.connectionFormDirty = false;
                syncConnectionForm(true);
                setConnectionSetupStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusSaved') : 'Connection settings saved.'
                );
                renderConsoleOverview();
                break;

            case 'connectionSettingsSaveFailed':
                state.connectionFormDirty = true;
                setConnectionSetupStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusSaveFailed') : 'Failed to save connection settings.')
                );
                break;

            case 'openClawConfigSaved':
                state.openClawConfigFormDirty = false;
                syncOpenClawConfigForm(true);
                setOpenClawConfigStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.statusSaved') : 'OpenClaw config saved.'
                );
                renderConsoleOverview();
                break;

            case 'openClawConfigSaveFailed':
                state.openClawConfigFormDirty = true;
                setOpenClawConfigStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.statusSaveFailed') : 'Failed to save OpenClaw config.')
                );
                break;

            case 'openClawStartSucceeded':
                state.installGuideBusy = false;
                setInstallGuideStatus(
                    'success',
                    window.OpenClawI18n ? window.OpenClawI18n.t('setup.startStatusStarted') : 'OpenClaw started. Luna is reconnecting.'
                );
                renderConnectionSetup();
                break;

            case 'openClawStartFailed':
                state.installGuideBusy = false;
                setInstallGuideStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('setup.startStatusFailed', { error: 'unknown error' }) : 'Failed to start OpenClaw.')
                );
                renderConnectionSetup();
                break;
        }
    });

    // Show context loading indicator
    function showContextLoading() {
        // Check if already showing
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

    // Hide context loading indicator
    function hideContextLoading() {
        document.querySelector('.context-loading')?.remove();
        updateChatHomeVisibility();
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();


