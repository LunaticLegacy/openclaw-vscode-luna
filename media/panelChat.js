// OpenClaw Luna - Panel Chat
'use strict';

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

