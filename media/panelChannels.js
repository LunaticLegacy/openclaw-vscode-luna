// OpenClaw Luna - Panel Channels
'use strict';

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

