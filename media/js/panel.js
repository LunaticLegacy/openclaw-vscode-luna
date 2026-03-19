// OpenClaw Luna - Panel Bootstrap
'use strict';

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
                    openClawConfig: message.openClawConfig || null,
                    memoryStatus: message.memoryStatus || null
                };
                updateConnectionBadge();
                renderConsoleOverview();
                break;

            case 'agentsLoaded':
                state.aiSkills = Array.isArray(message.aiSkills) ? message.aiSkills : state.aiSkills;
                state.availableModels = Array.isArray(message.models) ? message.models : state.availableModels;
                state.chatSubagents = Array.isArray(message.subagents) ? message.subagents : [];
                renderAgents(message.agents, message.folders);
                populateModelSelect(message.models || []);
                setAgentPresets(message.presets || state.agentPresets);
                if (typeof renderChatCommandBar === 'function') {
                    renderChatCommandBar();
                }
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
                if (typeof renderChatCommandBar === 'function') {
                    renderChatCommandBar();
                }
                break;
                
            case 'setInputText':
                elements.messageInput.value = message.text;
                break;
                
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

            case 'clusterReplayLoaded':
                loadClusterReplay(message.replay || null);
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
                if (message.agent?.id && message.agent.id === state.currentAgentId) {
                    state.agentOnboardingSaving = false;
                    setAgentOnboardingStatus(
                        'success',
                        window.OpenClawI18n ? window.OpenClawI18n.t('agentOnboarding.saved') : 'Preset context saved.'
                    );
                }
                if (message.agent?.id && document.getElementById('settings-agent-id')?.value === message.agent.id) {
                    state.agentSettingsSaving = false;
                    state.agentSettingsFormDirty = false;
                    setAgentSettingsStatus(
                        'success',
                        window.OpenClawI18n ? window.OpenClawI18n.t('agentSettings.saved') : 'Settings saved'
                    );
                }
                break;

            case 'agentSaveFailed':
                state.agentSettingsSaving = false;
                state.agentSettingsFormDirty = true;
                if (!message.agentId || message.agentId === state.currentAgentId) {
                    state.agentOnboardingSaving = false;
                    setAgentOnboardingStatus(
                        'error',
                        message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentOnboarding.saveFailed', { error: 'unknown error' }) : 'Failed to save preset context.')
                    );
                }
                setAgentSettingsStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentSettings.saveFailed', { error: 'unknown error' }) : 'Failed to save settings.')
                );
                break;

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

            case 'agentsBatchCreateFailed':
                state.batchCreateAgentsSaving = false;
                setBatchCreateAgentsStatus(
                    'error',
                    message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('agentBatch.createFailed', { error: 'unknown error' }) : 'Failed to create agents.')
                );
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

            case 'setClusterSwarmContextLoading':
                setSwarmConversationLoading(message.clusterId, message.mode, message.loading, {
                    swarmRunId: message.swarmRunId,
                    outputMode: message.outputMode
                });
                break;

            case 'setClusterAgentSwarmContextLoading':
                setClusterAgentSwarmConversationLoading(message.clusterId, message.agentId, message.mode, message.loading);
                break;

            case 'replaceClusterMessages':
                replaceClusterConversationMessages(message.clusterId, message.agentId, message.messages || []);
                break;

            case 'replaceClusterAgentSwarmMessages':
                replaceClusterAgentSwarmConversationMessages(message.clusterId, message.agentId, message.mode, message.messages || []);
                break;

            case 'replaceSwarmMessages':
                replaceSwarmConversationMessages(message.clusterId, message.mode, message.messages || [], {
                    swarmRunId: message.swarmRunId,
                    keepPending: Boolean(message.keepPending),
                    outputMode: message.outputMode
                });
                break;

            case 'appendClusterMessage':
                appendClusterConversationMessage(message.clusterId, message.agentId, message.message, {
                    keepPending: Boolean(message.keepPending)
                });
                break;

            case 'clusterAgentResponse':
                appendClusterConversationMessage(message.clusterId, message.agentId, message.message);
                break;

            case 'clusterRunFailed':
                clearSwarmConversationPending(message.clusterId, message.mode, {
                    swarmRunId: message.swarmRunId,
                    outputMode: message.outputMode
                });
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
                // Refresh agent settings model options if modal is open
                if (elements.modalAgentSettings?.classList.contains('active')) {
                    const agentId = document.getElementById('settings-agent-id')?.value;
                    const agent = state.agents.find(a => a.id === agentId);
                    if (agent) {
                        syncAgentModelFormState('settings', agent.model || '');
                    }
                }
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

            case 'skillMarketLoadFailed':
                if (elements.skillMarketLoading) {
                    elements.skillMarketLoading.classList.add('hidden');
                }
                if (elements.skillMarketContent) {
                    elements.skillMarketContent.classList.remove('hidden');
                }
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.loadFailed') : 'Failed to load skills from market'));
                break;

            case 'skillInstalled':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.installSuccess') : 'Skill installed successfully');
                // Refresh installed skills list
                void refreshSkillMarket();
                break;

            case 'skillInstallFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.installError') : 'Failed to install skill'));
                break;

            case 'skillUninstalled':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.uninstallSuccess') : 'Skill uninstalled');
                // Refresh installed skills list
                void refreshSkillMarket();
                break;

            case 'skillUninstallFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('skillMarket.uninstallError') : 'Failed to uninstall skill'));
                break;

            case 'skillToggledForAgent':
                // Refresh UI to reflect the change
                renderSkillMarket();
                break;

            case 'skillToggleFailed':
                showNotification(message.message || 'Failed to toggle skill');
                break;

            case 'memoryStatus':
                state.runtime = state.runtime || {};
                state.runtime.memoryStatus = message.status || null;
                renderMemoryStatus();
                break;

            case 'memoryExported':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('memory.exportSuccess', { name: message.result?.targetPath || '' }) : 'Memory exported.');
                break;

            case 'memoryExportFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('memory.exportFailed', { error: '' }) : 'Memory export failed.'));
                break;

            case 'memoryImported':
                showNotification(window.OpenClawI18n ? window.OpenClawI18n.t('memory.importSuccess', { name: message.sourcePath || '' }) : 'Memory imported.');
                break;

            case 'memoryImportFailed':
                showNotification(message.message || (window.OpenClawI18n ? window.OpenClawI18n.t('memory.importFailed', { error: '' }) : 'Memory import failed.'));
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
