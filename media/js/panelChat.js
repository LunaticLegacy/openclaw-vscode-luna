// OpenClaw Luna - Panel Chat
'use strict';

    function getCurrentAgentSubagents() {
        const currentAgentId = String(state.currentAgentId || '').trim();
        const source = Array.isArray(state.chatSubagents) ? state.chatSubagents : [];
        if (!currentAgentId) {
            return [];
        }

        const exact = source.filter(item => String(item?.parentAgentId || '').trim() === currentAgentId);
        if (exact.length > 0) {
            return exact;
        }

        return source.filter(item => !String(item?.parentAgentId || '').trim());
    }

    function getOpenClawSlashCommandCatalog() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return [
            {
                id: 'session',
                label: t('chat.openclawCommands.groupSession') || 'Session',
                commands: [
                    { label: '/new', value: '/new' },
                    { label: '/clear', value: '/clear' },
                    { label: '/reset', value: '/reset' }
                ]
            },
            {
                id: 'subagents',
                label: t('chat.openclawCommands.groupSubagents') || 'Subagents',
                commands: [
                    { label: '/subagents', value: '/subagents' },
                    { label: '/subagents list', value: '/subagents list' },
                    { label: '/subagents runs', value: '/subagents runs' }
                ]
            },
            {
                id: 'memory',
                label: t('chat.openclawCommands.groupMemory') || 'Memory',
                commands: [
                    { label: '/memory', value: '/memory' },
                    { label: '/memory status', value: '/memory status' },
                    { label: '/memory sync', value: '/memory sync' }
                ]
            }
        ];
    }

    function renderChatCommandBar() {
        if (!elements.chatCommandBar) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const subagents = getCurrentAgentSubagents();

        if (elements.chatSubagentsCount) {
            elements.chatSubagentsCount.textContent = String(subagents.length);
        }

        if (elements.chatCommandBarSummary) {
            const summary = t('chat.commandBar.summary', {
                count: subagents.length
            });
            elements.chatCommandBarSummary.textContent = summary === 'chat.commandBar.summary'
                ? `${subagents.length} subagents · OpenClaw commands`
                : summary;
        }

        if (elements.chatSubagentSelect) {
            const emptyLabel = t('chat.subagents.none') || 'No subagents';
            elements.chatSubagentSelect.innerHTML = subagents.length > 0
                ? subagents.map(item => `
                    <option value="${escapeHtml(String(item.id || ''))}">
                        ${escapeHtml(String(item.label || item.id || ''))}
                    </option>
                `).join('')
                : `<option value="">${escapeHtml(emptyLabel)}</option>`;
            elements.chatSubagentSelect.disabled = subagents.length === 0;
        }

        if (elements.btnChatInsertSubagentCommand) {
            elements.btnChatInsertSubagentCommand.disabled = subagents.length === 0;
        }

        if (elements.chatOpenClawCommandTree) {
            elements.chatOpenClawCommandTree.innerHTML = getOpenClawSlashCommandCatalog().map((group, index) => `
                <details class="chat-command-group" ${index === 0 ? 'open' : ''}>
                    <summary>${escapeHtml(group.label)}</summary>
                    <div class="chat-command-group-body">
                        ${group.commands.map(command => `
                            <button class="chat-command-chip" type="button" data-chat-openclaw-command="${escapeHtml(command.value)}">
                                ${escapeHtml(command.label)}
                            </button>
                        `).join('')}
                    </div>
                </details>
            `).join('');
        }

        applyChatCommandBarCollapsedState();
    }

    function toggleChatCommandBar() {
        state.chatCommandBarCollapsed = !state.chatCommandBarCollapsed;
        applyChatCommandBarCollapsedState();
        if (typeof persistUiState === 'function') {
            persistUiState();
        }
    }

    function applyChatCommandBarCollapsedState() {
        if (!elements.chatCommandBar || !elements.btnToggleChatCommandBar) {
            return;
        }

        const collapsed = Boolean(state.chatCommandBarCollapsed);
        elements.chatCommandBar.classList.toggle('collapsed', collapsed);
        elements.btnToggleChatCommandBar.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        elements.btnToggleChatCommandBar.setAttribute(
            'title',
            collapsed
                ? (window.OpenClawI18n ? window.OpenClawI18n.t('chat.commandBar.expand') : 'Expand chat toolbar')
                : (window.OpenClawI18n ? window.OpenClawI18n.t('chat.commandBar.collapse') : 'Collapse chat toolbar')
        );
        if (elements.chatCommandBarToggleIcon) {
            elements.chatCommandBarToggleIcon.innerHTML = collapsed ? '&#9654;' : '&#9660;';
        }
    }

    function insertSelectedSubagentCommand() {
        const selectedSubagentId = String(elements.chatSubagentSelect?.value || '').trim();
        if (!selectedSubagentId) {
            return;
        }

        const command = `/subagents ${selectedSubagentId}`;
        if (elements.chatOpenClawCommandInput) {
            elements.chatOpenClawCommandInput.value = command;
        }
        insertCommandIntoChatInput(command);
    }

    function insertOpenClawSlashCommand(command) {
        const resolvedCommand = typeof command === 'string'
            ? command.trim()
            : String(elements.chatOpenClawCommandInput?.value || '').trim();
        if (!resolvedCommand) {
            return;
        }

        insertCommandIntoChatInput(resolvedCommand);
    }

    function insertCommandIntoChatInput(command) {
        if (!elements.messageInput) {
            return;
        }

        elements.messageInput.value = command;
        elements.messageInput.focus();
    }

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

        if (isReplayCluster(cluster)) {
            showError(window.OpenClawI18n ? window.OpenClawI18n.t('clusters.replayReadonlyHint') : 'Replay clusters are read-only.');
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

        const command = target.kind === 'agent' ? parseClusterAgentCommand(content) : null;
        if (command) {
            conversation.loading = true;
            renderCurrentClusterConversation();
            updateClusterInputState(cluster);
            vscode.postMessage({
                type: 'clusterAgentSessionCommand',
                clusterId: cluster.id,
                agentId: target.agentId,
                command
            });
            if (elements.clusterMessageInput) {
                elements.clusterMessageInput.value = '';
            }
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

    function parseClusterAgentCommand(content) {
        const normalized = String(content || '').trim().toLowerCase();
        if (normalized === '/new' || normalized === '/reset') {
            return 'new';
        }

        if (normalized === '/clear') {
            return 'clear';
        }

        return null;
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

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const commandChip = target.closest('[data-chat-openclaw-command]');
        if (commandChip) {
            insertOpenClawSlashCommand(commandChip.getAttribute('data-chat-openclaw-command') || '');
        }
    });

