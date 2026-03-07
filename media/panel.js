// OpenClaw Luna - Webview Panel Script
(function() {
    'use strict';

    const vscode = acquireVsCodeApi();
    
    // State
    let state = {
        currentAgentId: null,
        agents: [],
        isStreaming: false,
        currentThinking: null,
        viewMode: 'chat',
        locale: 'en'
    };

    // DOM Elements cache
    const elements = {};

    // Initialize
    function init() {
        cacheElements();
        bindEvents();
        
        // Set locale and translations from global variables
        if (typeof window.LOCALE !== 'undefined') {
            state.locale = window.LOCALE;
        }
        if (typeof window.TRANSLATIONS !== 'undefined' && window.OpenClawI18n) {
            window.OpenClawI18n.setTranslations(window.TRANSLATIONS, state.locale);
        }
        
        updateUIText();
        vscode.postMessage({ type: 'webviewReady' });
    }

    function cacheElements() {
        elements.agentList = document.getElementById('agent-list');
        elements.chatMessages = document.getElementById('chat-messages');
        elements.messageInput = document.getElementById('message-input');
        elements.btnSend = document.getElementById('btn-send');
        elements.btnClear = document.getElementById('btn-clear');
        elements.btnNewAgent = document.getElementById('btn-new-agent');
        elements.modalNewAgent = document.getElementById('modal-new-agent');
        elements.formNewAgent = document.getElementById('form-new-agent');
        elements.navTabs = document.querySelectorAll('.nav-tab');
        elements.views = document.querySelectorAll('.view');
        elements.tokenCount = document.getElementById('token-count');
        elements.clustersList = document.getElementById('clusters-list');
        elements.modalAgentSettings = document.getElementById('modal-agent-settings');
        elements.formAgentSettings = document.getElementById('form-agent-settings');
    }

    function bindEvents() {
        // Navigation
        elements.navTabs.forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        // Send message
        elements.btnSend?.addEventListener('click', sendMessage);
        elements.messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Clear chat
        elements.btnClear?.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearChat' });
        });

        // New agent modal
        elements.btnNewAgent?.addEventListener('click', () => {
            openModal(elements.modalNewAgent);
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

        // Close modal when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAllModals();
            });
        });
    }

    function updateUIText() {
        if (!window.OpenClawI18n) return;
        
        const t = window.OpenClawI18n.t;
        
        // Update placeholders and buttons
        if (elements.messageInput) {
            elements.messageInput.placeholder = t('chat.placeholder');
        }
        if (elements.btnSend) {
            elements.btnSend.textContent = t('chat.send');
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

    // Send message
    function sendMessage() {
        const content = elements.messageInput.value.trim();
        if (!content || state.isStreaming) return;
        
        if (!state.currentAgentId) {
            showError(window.OpenClawI18n ? window.OpenClawI18n.t('panel.selectAgentFirst') : 'Please select an agent first');
            return;
        }
        
        elements.messageInput.value = '';
        
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
        if (state.currentThinking) {
            state.currentThinking.remove();
            state.currentThinking = null;
        }
        
        addMessage({
            role: 'assistant',
            content,
            timestamp: new Date().toISOString()
        });
    }

    // Add message to chat
    function addMessage(msg) {
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;
        
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        
        // Process content: first handle thinking blocks, then format the rest
        const { mainContent, thinkingHtml } = processMessageContent(msg.content);
        
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${msg.role === 'user' ? 'You' : 'Assistant'}</span>
                <span class="message-time">${time}</span>
                ${tokenInfo}
            </div>
            ${thinkingHtml}
            <div class="message-content">${formatContent(mainContent)}</div>
        `;
        
        elements.chatMessages.appendChild(div);
        scrollToBottom();
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
                    <div class="thinking-header" onclick="toggleThinking(this)">
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

    // Toggle thinking block
    window.toggleThinking = function(header) {
        const block = header.parentElement;
        block.classList.toggle('collapsed');
        const toggle = header.querySelector('.thinking-toggle');
        toggle.textContent = block.classList.contains('collapsed') ? '▼' : '▲';
    };

    // Update streaming message
    function updateStreamingMessage(content, done) {
        if (!content) return;
        
        // If we were showing thinking indicator and we're done, finalize
        if (state.currentThinking && done) {
            finalizeThinking(content);
            state.isStreaming = false;
            elements.btnSend.disabled = false;
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
            if (state.currentThinking) {
                state.currentThinking.remove();
                state.currentThinking = null;
            }
            
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
            streamingMsg.classList.remove('message-streaming');
            const indicator = streamingMsg.querySelector('.streaming-indicator');
            if (indicator) indicator.remove();
            state.isStreaming = false;
            elements.btnSend.disabled = false;
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
    }

    function selectAgent(agentId) {
        state.currentAgentId = agentId;
        document.querySelectorAll('.agent-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === agentId);
        });
        
        document.querySelector('.welcome-message')?.remove();
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

    // Modal handling
    function openModal(modal) {
        if (modal) modal.classList.add('active');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    }

    // Render clusters
    function renderClusters(clusters) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        
        if (clusters.length === 0) {
            elements.clustersList.innerHTML = `<div class="empty">${t('clusters.noneFound')}</div>`;
            return;
        }
        
        elements.clustersList.innerHTML = clusters.map(cluster => `
            <div class="cluster-card">
                <div class="cluster-header">
                    <h4>${escapeHtml(cluster.name)}</h4>
                    <span class="cluster-status status-${cluster.status}">${cluster.status}</span>
                </div>
                <div class="cluster-agents">
                    ${cluster.agentIds.map(id => `<span class="cluster-agent-tag">${id}</span>`).join('')}
                </div>
                <div class="cluster-actions">
                    <button class="btn btn-small" onclick="broadcastToCluster('${cluster.id}')">
                        ${t('clusters.broadcast')}
                    </button>
                </div>
            </div>
        `).join('');
    }

    window.broadcastToCluster = function(clusterId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const message = prompt(t('clusters.broadcastPrompt') || 'Enter message to broadcast:');
        if (message) {
            vscode.postMessage({ type: 'broadcastToCluster', clusterId, message });
        }
    };

    // Render usage
    function renderUsage(usage) {
        const formatNum = (n) => n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : n >= 1000 ? (n/1000).toFixed(1) + 'K' : n;
        
        const requestsEl = document.getElementById('usage-requests');
        const tokensEl = document.getElementById('usage-tokens');
        const costEl = document.getElementById('usage-cost');
        
        if (requestsEl) requestsEl.textContent = usage.totalRequests.toLocaleString();
        if (tokensEl) tokensEl.textContent = formatNum(usage.totalTokens);
        if (costEl) costEl.textContent = '$' + (usage.cost || 0).toFixed(4);
        
        // Render charts
        const chartContainer = document.getElementById('usage-chart');
        if (chartContainer) {
            const days = Object.entries(usage.byDay || {}).slice(-7);
            if (days.length > 0) {
                chartContainer.innerHTML = days.map(([date, data]) => `
                    <div class="bar-item">
                        <div class="bar" style="height: ${Math.min((data.tokens || 0) / 1000, 100)}px"></div>
                        <div class="bar-label">${date.slice(5)}</div>
                    </div>
                `).join('');
            } else {
                chartContainer.innerHTML = '<div class="empty">No data available</div>';
            }
        }
        
        const modelChart = document.getElementById('model-chart');
        if (modelChart) {
            const models = Object.entries(usage.byModel || {});
            if (models.length > 0 && usage.totalTokens > 0) {
                modelChart.innerHTML = models.map(([model, data]) => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(model)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((data.tokens || 0) / usage.totalTokens * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${formatNum(data.tokens || 0)} tokens</div>
                    </div>
                `).join('');
            } else {
                modelChart.innerHTML = '<div class="empty">No model data available</div>';
            }
        }
    }

    // Message handling from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
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
                
            case 'clearChat':
                elements.chatMessages.innerHTML = '';
                break;
                
            case 'setActiveAgent':
                state.currentAgentId = message.agentId;
                document.querySelectorAll('.agent-item').forEach(item => {
                    item.classList.toggle('active', item.dataset.id === message.agentId);
                });
                break;
                
            case 'setInputText':
                elements.messageInput.value = message.text;
                break;
                
            case 'clustersLoaded':
                renderClusters(message.clusters);
                break;
                
            case 'usageLoaded':
                renderUsage(message.usage);
                break;

            case 'switchView':
                applyView(message.view);
                if (message.view === 'clusters' && message.clusters) {
                    renderClusters(message.clusters);
                }
                if (message.view === 'usage' && message.usage) {
                    renderUsage(message.usage);
                }
                break;
                
            case 'showAgentSettings':
                showAgentSettings(message.agent);
                break;
                
            case 'broadcastResults':
                // Handle broadcast results
                break;

            case 'agentsLoadFailed':
                elements.agentList.innerHTML = `<div class="empty">Failed to load agents: ${escapeHtml(message.message)}</div>`;
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
                if (state.isStreaming) {
                    state.isStreaming = false;
                    elements.btnSend.disabled = false;
                }
                break;
        }
    });

    // Show context loading indicator
    function showContextLoading() {
        // Remove any existing welcome message
        document.querySelector('.welcome-message')?.remove();
        
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
        scrollToBottom();
    }

    // Hide context loading indicator
    function hideContextLoading() {
        document.querySelector('.context-loading')?.remove();
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
