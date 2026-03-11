// OpenClaw Luna - Panel Message Render
'use strict';

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

