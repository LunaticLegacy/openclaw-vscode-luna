// OpenClaw Luna - Panel Message Render
// 该文件负责处理聊天面板中消息的渲染、添加和管理，包括独立消息和追踪消息的渲染逻辑
'use strict';

    /**
     * 记录已渲染的消息ID
     * 用于防止重复渲染同一条消息
     * @param {Object} msg - 消息对象
     * @param {string} msg.id - 消息唯一标识
     * @param {Set} renderedIds - 已渲染消息ID的集合
     * @returns {boolean} 如果消息ID已存在返回true，否则返回false并添加到集合
     */
    function rememberRenderedMessageId(msg, renderedIds) {
        const messageId = typeof msg?.id === 'string' ? msg.id.trim() : '';
        if (!messageId) {
            return false;
        }

        // 检查是否已存在
        if (renderedIds.has(messageId)) {
            return true;
        }

        // 添加到已渲染集合
        renderedIds.add(messageId);
        return false;
    }

    /**
     * 添加消息到聊天界面
     * 消息渲染的主入口函数，根据消息类型选择合适的渲染方式
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色（user/assistant/tool）
     * @param {string} msg.id - 消息唯一标识
     * @param {string} msg.timestamp - 消息时间戳
     * @returns {void}
     */
    function addMessage(msg) {
        if (!msg) return;
        // 检查是否已渲染过该消息
        if (rememberRenderedMessageId(msg, renderedChatMessageIds)) return;
        // 检查是否应该隐藏该消息
        if (shouldHideMessage(msg)) return;

        // 如果是助手或工具消息，清除思考指示器
        if ((msg.role === 'assistant' || msg.role === 'tool') && state.currentThinking) {
            clearThinkingIndicator();
        }

        // 用户消息：作为独立消息追加
        if (msg.role === 'user') {
            activeTraceContainer = null; // 重置追踪容器
            appendStandaloneMessage(msg);
            if (!isBulkRenderingChat) {
                updateChatHomeVisibility();
            }
            return;
        }

        // 检查是否应该追加到追踪容器
        if (shouldAppendToTrace(msg)) {
            appendTraceMessage(msg);
            if (!isBulkRenderingChat) {
                updateChatHomeVisibility();
            }
            return;
        }

        // 其他消息：作为独立消息追加
        activeTraceContainer = null;
        appendStandaloneMessage(msg);
        if (!isBulkRenderingChat) {
            updateChatHomeVisibility();
        }
    }

    /**
     * 追加独立消息到聊天界面
     * 创建新的消息元素并添加到聊天容器中
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色
     * @param {string} msg.timestamp - 消息时间戳
     * @param {number} msg.tokenCount - Token数量（可选）
     * @returns {void}
     */
    function appendStandaloneMessage(msg) {
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;
        
        // 格式化时间和Token信息
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const rendered = renderMessageContent(msg);
        
        // 构建消息HTML结构
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

        // 非工具使用的助手消息表示流式输出结束
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            state.isStreaming = false;
            if (elements.btnSend) {
                elements.btnSend.disabled = false;
            }
        }
    }

    /**
     * 追加消息到追踪容器
     * 用于将工具调用结果或相关消息组织到同一追踪会话中
     * @param {Object} msg - 消息对象
     * @returns {void}
     */
    function appendTraceMessage(msg) {
        const container = getOrCreateTraceContainer(msg);
        const body = container.querySelector('.trace-body');
        if (!body) {
            return;
        }

        // 工具消息：查找对应的待处理工具卡片并替换
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

        // 创建追踪段并添加到追踪体
        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        if (!isBulkRenderingChat) {
            scrollToBottom();
        }

        // 非工具使用的助手消息表示流式输出结束
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            activeTraceContainer = null;
            state.isStreaming = false;
            if (elements.btnSend) {
                elements.btnSend.disabled = false;
            }
        }
    }

    /**
     * 获取或创建追踪容器
     * 追踪容器用于组织相关联的一系列消息（如工具调用链）
     * @param {Object} msg - 消息对象
     * @param {string} msg.timestamp - 消息时间戳
     * @returns {HTMLElement} 追踪容器元素
     */
    function getOrCreateTraceContainer(msg) {
        // 如果已有活动的追踪容器且仍在DOM中，直接返回
        if (activeTraceContainer?.isConnected) {
            return activeTraceContainer;
        }

        // 创建新的追踪容器
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

    /**
     * 渲染追踪段
     * 根据消息角色选择合适的渲染方式
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色
     * @returns {string} 渲染后的HTML字符串
     */
    function renderTraceSegment(msg) {
        // 工具消息使用工具消息渲染
        if (msg.role === 'tool') {
            return renderToolMessage(msg, Array.isArray(msg.parts) ? msg.parts : []);
        }

        // 其他消息使用标准消息内容渲染
        return renderMessageContent(msg);
    }

    /**
     * 判断消息是否应该追加到追踪容器
     * 工具消息、工具使用消息或已有活动追踪容器时返回true
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色
     * @returns {boolean} 是否应该追加到追踪容器
     */
    function shouldAppendToTrace(msg) {
        // 工具消息总是追加到追踪
        if (msg.role === 'tool') {
            return true;
        }

        // 非助手消息不追加
        if (msg.role !== 'assistant') {
            return false;
        }

        // 工具使用消息或有活动追踪容器时追加
        return isToolUseMessage(msg) || Boolean(activeTraceContainer);
    }

    /**
     * 判断是否应该隐藏消息
     * 空内容的用户或助手消息（无结构化parts）将被隐藏
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色
     * @param {Array} msg.parts - 消息结构化部分数组
     * @returns {boolean} 是否应该隐藏该消息
     */
    function shouldHideMessage(msg) {
        if (!msg) {
            return false;
        }

        // 检查是否有结构化parts
        const hasStructuredParts = Array.isArray(msg.parts) && msg.parts.length > 0;
        // 用户或助手消息，如果没有结构化parts且内容为空，则隐藏
        if ((msg.role === 'user' || msg.role === 'assistant') && !hasStructuredParts) {
            return !getDisplayContent(msg).trim();
        }

        return false;
    }
