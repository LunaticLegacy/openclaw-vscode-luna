// OpenClaw Luna - Webview Panel Script
(function() {
    'use strict';

    const vscode = acquireVsCodeApi();
    
    // State
    let state = {
        currentAgentId: null,
        currentClusterId: null,
        currentClusterTargetKind: 'swarm',
        currentClusterAgentId: null,
        currentClusterSwarmMode: 'broadcast',
        agents: [],
        clusters: [],
        clusterConversations: {},
        tasks: [],
        tasksAvailable: true,
        tasksLoaded: false,
        tasksMessage: '',
        tasksSourcePath: '',
        latestUsage: null,
        usagePeriodDays: 7,
        isStreaming: false,
        currentThinking: null,
        viewMode: 'chat',
        locale: 'en',
        runtime: {
            connected: false,
            mode: 'gateway',
            sourceDescription: '',
            supportsTasks: false,
            supportsLiveSync: false
        }
    };
    let activeTraceContainer = null;

    // DOM Elements cache
    const elements = {};

    // Initialize
    function init() {
        cacheElements();
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
        vscode.postMessage({ type: 'webviewReady' });
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
        elements.agentList = document.getElementById('agent-list');
        elements.chatHome = document.getElementById('chat-home');
        elements.clusterSidebarList = document.getElementById('cluster-sidebar-list');
        elements.chatMessages = document.getElementById('chat-messages');
        elements.messageInput = document.getElementById('message-input');
        elements.btnSend = document.getElementById('btn-send');
        elements.btnClear = document.getElementById('btn-clear');
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
        elements.consoleNextSteps = document.getElementById('console-next-steps');
        elements.consoleActionButtons = document.querySelectorAll('[data-console-action]');
        elements.clusterEmptyState = document.getElementById('clusters-empty-state');
        elements.clusterWorkspace = document.getElementById('cluster-workspace');
        elements.clusterTitle = document.getElementById('cluster-title');
        elements.clusterSubtitle = document.getElementById('cluster-subtitle');
        elements.clusterTargetTabs = document.getElementById('cluster-target-tabs');
        elements.clusterModeTabs = document.getElementById('cluster-mode-tabs');
        elements.clusterMessages = document.getElementById('cluster-messages');
        elements.clusterMessageInput = document.getElementById('cluster-message-input');
        elements.clusterTargetHint = document.getElementById('cluster-target-hint');
        elements.btnSendCluster = document.getElementById('btn-send-cluster');
        elements.btnNewAgent = document.getElementById('btn-new-agent');
        elements.btnNewCluster = document.getElementById('btn-new-cluster');
        elements.modalNewAgent = document.getElementById('modal-new-agent');
        elements.formNewAgent = document.getElementById('form-new-agent');
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
        elements.btnCreateTask = document.getElementById('btn-create-task');
        elements.btnRefreshUsage = document.getElementById('btn-refresh-usage');
        elements.btnUsagePeriod7 = document.getElementById('btn-usage-period-7');
        elements.btnUsagePeriod30 = document.getElementById('btn-usage-period-30');
        elements.usagePeriodButtons = document.querySelectorAll('[data-usage-period]');
        elements.usagePeriodCaption = document.getElementById('usage-period-caption');
        elements.usageChartTitle = document.getElementById('usage-chart-title');
        elements.modelChartTitle = document.getElementById('model-chart-title');
        elements.modalAgentSettings = document.getElementById('modal-agent-settings');
        elements.formAgentSettings = document.getElementById('form-agent-settings');
        elements.modalTask = document.getElementById('modal-task');
        elements.formTask = document.getElementById('form-task');
    }

    function bindEvents() {
        // Navigation
        elements.navTabs.forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        // Send message
        elements.btnSend?.addEventListener('click', sendMessage);
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

        // New agent modal
        elements.btnNewAgent?.addEventListener('click', () => {
            openModal(elements.modalNewAgent);
        });

        elements.btnNewCluster?.addEventListener('click', () => {
            vscode.postMessage({ type: 'createCluster' });
        });

        elements.btnCreateCluster?.addEventListener('click', () => {
            vscode.postMessage({ type: 'createCluster' });
        });

        elements.btnCreateClusterToolbar?.addEventListener('click', () => {
            vscode.postMessage({ type: 'createCluster' });
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

        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeAllModals);
        });

        elements.formNewAgent?.addEventListener('submit', (e) => {
            e.preventDefault();
            createAgent();
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

            const thinkingHeader = target.closest('.thinking-header');
            if (thinkingHeader) {
                toggleThinkingBlock(thinkingHeader);
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
    }

    function updateUIText() {
        if (!window.OpenClawI18n) return;
        
        const t = window.OpenClawI18n.t;
        
        // Update placeholders and buttons
        if (elements.messageInput) {
            elements.messageInput.placeholder = t('chat.placeholder');
        }
        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.placeholder = t('clusters.chatPlaceholder');
        }
        if (elements.btnSend) {
            elements.btnSend.textContent = t('chat.send');
        }
        if (elements.btnSendCluster) {
            elements.btnSendCluster.textContent = t('chat.send');
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
        renderClusterWorkspace();
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
    }

    // View switching
    function applyView(view) {
        state.viewMode = view;
        
        elements.navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
        elements.views.forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    }

    function switchView(view) {
        applyView(view);
        vscode.postMessage({ type: 'switchView', view });
    }

    function handleConsoleAction(action) {
        switch (action) {
            case 'new-agent':
                openModal(elements.modalNewAgent);
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
            case 'settings':
                vscode.postMessage({ type: 'openSettings' });
                break;
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
            elements.consoleModeMeta.textContent = t(state.runtime.supportsLiveSync ? 'console.liveSync' : 'console.liveSyncDisabled');
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

        const hasMessages = Boolean(elements.chatMessages.querySelector('.message, .context-loading'));
        elements.chatHome.classList.toggle('hidden', hasMessages);
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
                : resolveAgentLabel(target.agentId)
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
        activeTraceContainer = null;
        finalizeStreamingState();
    }

    // Update thinking content
    function updateThinking(content) {
        if (!state.currentThinking) return;
        
        const thinkingContent = state.currentThinking.querySelector('.thinking-content');
        if (thinkingContent) {
            // Parse thinking blocks if they follow OpenClaw format
            const lines = content.split('\n').filter(l => l.trim());
            thinkingContent.innerHTML = lines.map(line => {
                // Check for step markers like "Step 1:" or "1."
                const stepMatch = line.match(/^(?:Step\s+)?(\d+)[:.]/i);
                if (stepMatch) {
                    return `<div class="thinking-step"><span class="step-number">${stepMatch[1]}</span>${escapeHtml(line.substring(stepMatch[0].length).trim())}</div>`;
                }
                return `<div class="thinking-line">${escapeHtml(line)}</div>`;
            }).join('');
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
        if (elements.btnSend) {
            elements.btnSend.disabled = false;
        }
    }

    function finalizeStreamingMessage() {
        clearThinkingIndicator();

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

    // Add message to chat
    function addMessage(msg) {
        if (!msg) return;
        if (shouldHideMessage(msg)) return;

        if ((msg.role === 'assistant' || msg.role === 'tool') && state.currentThinking) {
            clearThinkingIndicator();
        }

        if (msg.role === 'user') {
            activeTraceContainer = null;
            appendStandaloneMessage(msg);
            updateChatHomeVisibility();
            return;
        }

        if (shouldAppendToTrace(msg)) {
            appendTraceMessage(msg);
            updateChatHomeVisibility();
            return;
        }

        activeTraceContainer = null;
        appendStandaloneMessage(msg);
        updateChatHomeVisibility();
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
        scrollToBottom();

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

        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        scrollToBottom();

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
        if (msg.role !== 'user') {
            return false;
        }

        return !getDisplayContent(msg).trim();
    }

    function renderMessageContent(msg) {
        const displayContent = getDisplayContent(msg);

        if (msg.role === 'user') {
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
                        <span class="thinking-icon">💭</span>
                        <span class="thinking-label">${window.OpenClawI18n ? window.OpenClawI18n.t('common.thinking') : 'Thinking'}</span>
                        <span class="thinking-toggle">▼</span>
                    </div>
                    <div class="thinking-body">${formatThinking(thinkingParts.map(part => part.thinking).join('\n\n'))}</div>
                </div>
            `
            : '';
        const toolCallsHtml = toolCalls.length > 0
            ? `
                <div class="tool-call-list">
                    ${toolCalls.map(toolCall => `
                        <div class="tool-card tool-card-pending">
                            <div class="tool-card-header">
                                <span class="tool-card-status">⏳</span>
                                <span class="tool-card-name">${escapeHtml(toolCall.name || 'tool')}</span>
                            </div>
                            ${renderToolSection('Input', toolCall.arguments, {
                                toolName: toolCall.name,
                                format: 'pre'
                            })}
                        </div>
                    `).join('')}
                </div>
            `
            : '';
        const mainContent = textParts.map(part => part.text).join('') || fallbackContent;

        return `
            ${thinkingHtml}
            ${toolCallsHtml}
            ${mainContent ? `<div class="message-content">${formatContent(mainContent)}</div>` : ''}
        `;
    }

    function renderToolMessage(msg, parts) {
        const toolPart = parts.find(part => part.type === 'toolResult');
        const toolName = toolPart?.name || msg.toolName || 'tool';
        const toolArguments = toolPart?.arguments ?? msg.toolArguments;
        const toolResult = toolPart?.result ?? msg.content ?? '';
        const toolDetails = toolPart?.details ?? msg.toolDetails;
        const isError = Boolean(toolPart?.isError ?? msg.isError);

        return `
            <div class="tool-card ${isError ? 'tool-card-error' : 'tool-card-success'}">
                <div class="tool-card-header">
                    <span class="tool-card-status">${isError ? '❌' : '✅'}</span>
                    <span class="tool-card-name">${escapeHtml(toolName)}</span>
                </div>
                ${renderToolSection('Input', toolArguments, {
                    toolName,
                    format: 'pre'
                })}
                ${renderToolSection('Result', toolResult, {
                    toolName,
                    format: 'content'
                })}
                ${renderToolSection('Details', toolDetails, {
                    toolName,
                    format: 'pre',
                    forceCollapsible: true,
                    defaultCollapsed: true
                })}
            </div>
        `;
    }

    function getMessageRoleLabel(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (msg?.displayName) return msg.displayName;
        if (msg.role === 'user') return t('chat.roleUser');
        if (msg.role === 'tool') return t('chat.roleTool');
        return t('chat.roleAssistant');
    }

    function isToolUseMessage(msg) {
        return msg?.role === 'assistant' && msg?.metadata?.stopReason === 'toolUse';
    }

    function formatToolData(value) {
        if (typeof value === 'string') {
            return value;
        }

        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    function normalizeToolName(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
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
            forceCollapsible = false,
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
        const lines = content.split('\n').filter(l => l.trim());
        return lines.map(line => {
            const stepMatch = line.match(/^(?:Step\s+)?(\d+)[:.]/i);
            if (stepMatch) {
                return `<div class="thinking-step"><span class="step-number">${stepMatch[1]}</span>${escapeHtml(line.substring(stepMatch[0].length).trim())}</div>`;
            }
            if (line.startsWith('- ') || line.startsWith('* ')) {
                return `<div class="thinking-bullet">${escapeHtml(line.substring(2))}</div>`;
            }
            return `<div class="thinking-line">${escapeHtml(line)}</div>`;
        }).join('');
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
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function scrollToBottom() {
        if (!elements.chatMessages) return;
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    function showError(msg) {
        const div = document.createElement('div');
        div.className = 'error-message';
        div.textContent = msg;
        elements.chatMessages.appendChild(div);
        scrollToBottom();
        setTimeout(() => div.remove(), 5000);
    }

    // Render agents
    function renderAgents(agentData) {
        state.agents = agentData;
        
        if (state.agents.length === 0) {
            elements.agentList.innerHTML = '<div class="empty">No agents yet. Create one!</div>';
            renderConsoleOverview();
            return;
        }
        
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        
        elements.agentList.innerHTML = state.agents.map(agent => `
            <div class="agent-item ${agent.id === state.currentAgentId ? 'active' : ''}" data-id="${agent.id}">
                <span class="agent-status status-${agent.status}"></span>
                <div class="agent-info">
                    <div class="agent-name">${escapeHtml(agent.name)}</div>
                    <div class="agent-model">${escapeHtml(agent.model)}</div>
                </div>
                <div class="agent-actions">
                    <button class="agent-action-btn" data-action="settings" title="${t('common.settings')}">⚙️</button>
                    <button class="agent-action-btn" data-action="folder" title="${t('common.openInExplorer')}">📁</button>
                </div>
            </div>
        `).join('');
        
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
        updateTaskFormFields();
        renderConsoleOverview();
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

    // Populate model select dropdown
    function populateModelSelect(models) {
        const modelSelect = document.getElementById('new-agent-model');
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
        const data = {
            name: document.getElementById('new-agent-name').value,
            model: document.getElementById('new-agent-model').value,
            systemPrompt: document.getElementById('new-agent-prompt').value
        };
        
        vscode.postMessage({ type: 'createAgent', data });
        closeAllModals();
        elements.formNewAgent.reset();
    }

    // Show agent settings
    function showAgentSettings(agent) {
        const modal = document.getElementById('modal-agent-settings');
        if (!modal) return;
        
        const idField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        
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
        
        openModal(modal);
    }

    // Save agent settings
    function saveAgentSettings() {
        const agentIdField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        
        const agentId = agentIdField ? agentIdField.value : '';
        const settings = {
            name: nameField ? nameField.value : '',
            systemPrompt: promptField ? promptField.value : '',
            temperature: tempField ? parseFloat(tempField.value) : 0.7,
            maxTokens: maxTokensField ? parseInt(maxTokensField.value) : 4096
        };
        
        vscode.postMessage({ type: 'saveAgentSettings', agentId, settings });
        closeAllModals();
    }

    function showTaskEditor(task) {
        if (state.tasksAvailable === false) {
            showError(state.tasksMessage || (window.OpenClawI18n ? window.OpenClawI18n.t('tasks.unavailable') : 'OpenClaw cron is unavailable.'));
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

    // Render clusters
    function renderClusters(clusters) {
        state.clusters = Array.isArray(clusters) ? clusters : [];

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
        return;
    }

        if (elements.clusterTitle) {
            elements.clusterTitle.textContent = cluster.name;
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
                    <span>${escapeHtml(resolveAgentLabel(agentId))}</span>
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
            sections.push(conversation.messages.map(renderClusterConversationMessage).join(''));
        }

        if (conversation.pending) {
            sections.push(renderClusterPendingMessage(target));
        }

        elements.clusterMessages.innerHTML = sections.join('');
        scrollClusterToBottom();
    }

    function renderClusterConversationMessage(msg) {
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
        const contributionIds = (cluster?.agentIds || Object.keys(result.contributions || {}))
            .filter(agentId => result.contributions?.[agentId]);
        const finalAnswerHtml = result.synthesis?.ok && result.synthesis.message
            ? formatContent(result.synthesis.message.content || '')
            : `<p>${escapeHtml(result.synthesis?.error || (t('clusters.noSuccessfulAgents') || 'No agent produced a usable contribution.'))}</p>`;
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
                <h4>${t('clusters.contributions') || 'Contributions'}</h4>
                ${contributionIds.map(agentId => {
                    const entry = result.contributions[agentId];
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
            </div>
        `;
    }

    function getCurrentCluster() {
        return state.clusters.find(cluster => cluster.id === state.currentClusterId) || null;
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
        return Object.values(responses || {}).map(entry => {
            if (entry.ok && entry.message) {
                return {
                    ...entry.message,
                    displayName: resolveAgentLabel(entry.agentId),
                    contextLabel: t('clusters.broadcast')
                };
            }

            return {
                role: 'assistant',
                content: entry.error || t('clusters.resultUnknownError'),
                timestamp: new Date().toISOString(),
                displayName: resolveAgentLabel(entry.agentId),
                contextLabel: t('clusters.broadcast')
            };
        });
    }

    function buildCollaborationConversationMessages(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!result) {
            return [];
        }

        const messages = [];
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : t('clusters.targetSwarm');

        if (result.synthesis?.ok && result.synthesis.message) {
            messages.push({
                ...result.synthesis.message,
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            });
        } else {
            messages.push({
                role: 'assistant',
                content: result.synthesis?.error || t('clusters.noSuccessfulAgents'),
                timestamp: new Date().toISOString(),
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            });
        }

        Object.entries(result.contributions || {}).forEach(([agentId, entry]) => {
            messages.push(entry.ok && entry.message
                ? {
                    ...entry.message,
                    displayName: resolveAgentLabel(agentId),
                    contextLabel: t('clusters.contributions')
                }
                : {
                    role: 'assistant',
                    content: entry.error || t('clusters.resultUnknownError'),
                    timestamp: new Date().toISOString(),
                    displayName: resolveAgentLabel(agentId),
                    contextLabel: t('clusters.contributions')
                });
        });

        return messages;
    }

    function getClusterEmptyConversationCopy(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return t('clusters.emptyAgentConversation', {
                agent: resolveAgentLabel(target.agentId)
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
                agent: resolveAgentLabel(target.agentId)
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
                agent: resolveAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.hintCollaborate', { count: cluster.agentIds.length })
            : t('clusters.hintBroadcast', { count: cluster.agentIds.length });
    }

    function getClusterPendingLabel(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return resolveAgentLabel(target.agentId);
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
                        <div class="bar" style="height: ${computeUsageBarHeight(data.tokens || 0, maxTokens)}px"></div>
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

    function setUsagePeriod(days) {
        if ((days !== 7 && days !== 30) || state.usagePeriodDays === days) {
            return;
        }

        state.usagePeriodDays = days;
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
    }

    function buildUsageWindow(usage, days) {
        const safeUsage = usage || {
            totalRequests: 0,
            totalTokens: 0,
            cost: 0,
            currencySymbol: '$',
            byDay: {},
            byModel: {},
            byModelByDay: {}
        };
        const dayKeys = buildRecentDateKeys(days);
        const dayEntries = dayKeys.map(date => {
            const data = safeUsage.byDay?.[date] || { requests: 0, tokens: 0, cost: 0 };
            return [date, data];
        });

        const totals = dayEntries.reduce((acc, [, data]) => {
            acc.totalRequests += data.requests || 0;
            acc.totalTokens += data.tokens || 0;
            acc.totalCost += data.cost || 0;
            return acc;
        }, {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0
        });

        return {
            days: dayEntries,
            byModel: aggregateUsageModelsByWindow(safeUsage, dayKeys),
            currencySymbol: safeUsage.currencySymbol || '$',
            ...totals
        };
    }

    function aggregateUsageModelsByWindow(usage, dayKeys) {
        const aggregated = {};
        const byModelByDay = usage?.byModelByDay;

        if (byModelByDay && Object.keys(byModelByDay).length > 0) {
            dayKeys.forEach(date => {
                const dayModels = byModelByDay[date] || {};
                Object.entries(dayModels).forEach(([model, data]) => {
                    if (!aggregated[model]) {
                        aggregated[model] = { requests: 0, tokens: 0, cost: 0 };
                    }

                    aggregated[model].requests += data.requests || 0;
                    aggregated[model].tokens += data.tokens || 0;
                    aggregated[model].cost += data.cost || 0;
                });
            });

            return aggregated;
        }

        return usage?.byModel || {};
    }

    function buildRecentDateKeys(days) {
        const result = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let offset = days - 1; offset >= 0; offset -= 1) {
            const date = new Date(today);
            date.setDate(today.getDate() - offset);
            result.push(formatLocalDateKey(date));
        }

        return result;
    }

    function formatLocalDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function computeUsageBarHeight(value, maxValue) {
        if (!maxValue || value <= 0) {
            return 4;
        }

        return Math.max(4, Math.min((value / maxValue) * 120, 120));
    }

    function formatCompactNumber(n) {
        return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
    }

    function formatUsageCurrency(value, symbol) {
        return `${symbol || '$'}${Number(value || 0).toFixed(4)}`;
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
                    supportsLiveSync: Boolean(message.supportsLiveSync)
                };
                updateConnectionBadge();
                renderConsoleOverview();
                break;

            case 'agentsLoaded':
                renderAgents(message.agents);
                populateModelSelect(message.models || []);
                break;
                
            case 'addMessage':
                addMessage(message.message);
                break;
                
            case 'updateStreamingMessage':
                updateStreamingMessage(message.content, message.done);
                break;

            case 'replaceMessages':
                resetTransientChatState();
                elements.chatMessages.innerHTML = '';
                (message.messages || []).forEach(item => addMessage(item));
                updateChatHomeVisibility();
                break;
                
            case 'clearChat':
                resetTransientChatState();
                elements.chatMessages.innerHTML = '';
                updateChatHomeVisibility();
                break;
                
            case 'setActiveAgent':
                resetTransientChatState();
                state.currentAgentId = message.agentId;
                document.querySelectorAll('.agent-item').forEach(item => {
                    item.classList.toggle('active', item.dataset.id === message.agentId);
                });
                renderConsoleOverview();
                break;
                
            case 'setInputText':
                elements.messageInput.value = message.text;
                break;
                
            case 'clustersLoaded':
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

            case 'switchView':
                applyView(message.view);
                if (message.view === 'clusters' && message.selectedClusterId) {
                    state.currentClusterId = message.selectedClusterId;
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
                showAgentSettings(message.agent);
                break;

            case 'showTaskEditor':
                showTaskEditor(message.task || null);
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
