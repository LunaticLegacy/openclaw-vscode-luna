// OpenClaw Luna - Panel View
'use strict';

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
            elements.btnNewAgent.innerHTML = `${t('sidebar.newAgent')}`;
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

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.title = t(key);
                el.setAttribute('aria-label', t(key));
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

