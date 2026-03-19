// OpenClaw Luna - Panel Format
'use strict';

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

