// OpenClaw Luna - Panel Channels
// 频道面板模块 - 管理频道的渲染、交互和消息处理
'use strict';

    /**
     * 渲染频道列表数据
     * 根据传入的频道数据和当前选中的频道ID，更新状态并重新渲染界面
     * 
     * @param {Array} channelData - 频道数据数组
     * @param {string|null} selectedChannelId - 当前选中的频道ID
     */
    function renderChannels(channelData, selectedChannelId) {
        // 更新频道列表状态，确保数据为数组类型
        state.channels = Array.isArray(channelData) ? channelData : [];
        state.channelsLoaded = true;

        // 如果指定了选中的频道ID且该频道存在于列表中，则设置为当前频道
        if (selectedChannelId && state.channels.some(channel => channel.id === selectedChannelId)) {
            state.currentChannelId = selectedChannelId;
            state.channelDraft = null; // 清除草稿状态
        } 
        // 如果当前频道ID已设置但不在频道列表中，则清除当前频道
        else if (state.currentChannelId && !state.channels.some(channel => channel.id === state.currentChannelId)) {
            state.currentChannelId = null;
            state.channelMessages = [];
        }

        // 如果没有当前频道且没有草稿，默认选中第一个频道
        if (!state.currentChannelId && !state.channelDraft && state.channels.length > 0) {
            state.currentChannelId = state.channels[0].id;
        }

        // 如果没有频道数据且没有草稿，创建一个新的频道草稿
        if (!state.currentChannelId && !state.channelDraft && state.channels.length === 0) {
            startNewChannelDraft({ focus: false });
            return;
        }

        // 重新渲染频道列表和工作区
        renderChannelList();
        renderChannelWorkspace();
    }

    /**
     * 渲染频道列表UI
     * 根据当前状态生成频道列表的HTML并绑定点击事件
     */
    function renderChannelList() {
        // 检查频道列表元素是否存在
        if (!elements.channelList) {
            return;
        }

        // 获取国际化翻译函数，若不可用则返回key本身
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 频道数据尚未加载完成，显示加载中提示
        if (!state.channelsLoaded) {
            elements.channelList.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        // 频道列表为空，显示空状态提示
        if (state.channels.length === 0) {
            elements.channelList.innerHTML = `<div class="empty">${escapeHtml(t('channel.listEmpty'))}</div>`;
            return;
        }

        // 生成频道列表HTML
        elements.channelList.innerHTML = state.channels.map(channel => {
            // 解析频道关联的Agent
            const agent = resolveAgent(channel.agentId);
            
            // 根据频道类型生成不同的元信息
            const meta = isImportedChannel(channel)
                ? t('channel.importedMeta', {
                    provider: channel.providerId || 'openclaw',
                    account: channel.accountId || channel.name
                })
                : agent
                    ? t('channel.listMeta', { agent: agent.name, model: agent.model })
                    : t('channel.listMetaMissingAgent', { agentId: channel.agentId });

            // 返回频道项HTML
            return `
                <div class="channel-list-item ${channel.id === state.currentChannelId && !state.channelDraft ? 'active' : ''}" data-channel-id="${channel.id}">
                    <div class="channel-list-name">${escapeHtml(channel.name)}</div>
                    <div class="channel-list-meta">${escapeHtml(meta)}</div>
                    ${channel.description ? `<div class="channel-list-description">${escapeHtml(channel.description)}</div>` : ''}
                </div>
            `;
        }).join('');

        // 为每个频道项绑定点击事件
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

    /**
     * 渲染频道工作区
     * 根据当前选中的频道或草稿状态，渲染编辑器和聊天界面
     */
    function renderChannelWorkspace() {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 获取当前频道和表单数据
        const channel = getCurrentChannel();
        const isDraft = Boolean(state.channelDraft);
        const formData = state.channelDraft || channel;
        const hasWorkspace = Boolean(formData);

        // 控制空状态和工作区的显示/隐藏
        if (elements.channelEmptyState) {
            elements.channelEmptyState.classList.toggle('hidden', hasWorkspace);
        }
        if (elements.channelWorkspace) {
            elements.channelWorkspace.classList.toggle('hidden', !hasWorkspace);
        }
        if (elements.channelChatShell) {
            elements.channelChatShell.classList.toggle('hidden', !hasWorkspace);
        }

        // 如果没有工作区数据，只渲染列表后返回
        if (!hasWorkspace || !formData) {
            renderChannelList();
            return;
        }

        // 解析Agent信息
        const agentId = formData.agentId || state.agents[0]?.id || '';
        const agent = resolveAgent(agentId);
        const importedChannel = !state.channelDraft && isImportedChannel(formData);

        // 设置编辑器标题和摘要
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

        // 填充Agent选项下拉框
        populateChannelAgentOptions(agentId);

        // 填充表单字段
        if (elements.channelName) {
            elements.channelName.value = formData.name || '';
        }
        if (elements.channelDescription) {
            elements.channelDescription.value = formData.description || '';
        }
        if (elements.channelAgentId) {
            elements.channelAgentId.value = agentId;
        }
        // 草稿或导入频道时禁用删除按钮
        if (elements.btnDeleteChannel) {
            elements.btnDeleteChannel.disabled = isDraft || importedChannel;
        }
        
        // 设置聊天区域标题
        if (elements.channelChatTitle) {
            elements.channelChatTitle.textContent = isDraft
                ? t('channel.chatTitleDraft')
                : t('channel.chatTitleNamed', { name: formData.name });
        }
        // 设置聊天区域副标题（显示Agent绑定状态）
        if (elements.channelChatSubtitle) {
            if (importedChannel) {
                // 导入频道的副标题
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleImported', {
                    provider: formData.providerId || 'openclaw',
                    account: formData.accountId || formData.name
                });
            } else if (agent) {
                // 已绑定Agent的副标题
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleBound', {
                    agent: agent.name,
                    model: agent.model
                });
            } else if (agentId) {
                // Agent丢失的副标题
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleMissing', { agentId });
            } else {
                // 未绑定Agent的副标题
                elements.channelChatSubtitle.textContent = t('channel.chatSubtitleUnbound');
            }
        }

        // 渲染对话内容和更新输入状态
        renderChannelConversation();
        updateChannelInputState();
        renderChannelList();
    }

    /**
     * 渲染频道对话内容
     * 清空消息容器并根据当前状态重新渲染所有消息
     */
    function renderChannelConversation() {
        // 检查消息容器是否存在
        if (!elements.channelMessages) {
            return;
        }

        // 重置临时状态并清空消息容器
        resetTransientChannelState();
        renderedChannelMessageIds.clear();
        elements.channelMessages.innerHTML = '';

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const draft = state.channelDraft;

        // 根据当前状态显示不同的提示信息
        if (state.channelLoading) {
            // 加载中状态
            elements.channelMessages.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (draft) {
            // 草稿状态：提示用户先保存频道
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.unsavedHint'))}</div>`;
            return;
        }

        if (!channel) {
            // 未选择频道状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.selectHint'))}</div>`;
            return;
        }

        if (!resolveChannelAgent(channel)) {
            // Agent缺失状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.missingAgentHint'))}</div>`;
            return;
        }

        if (state.channelMessages.length === 0) {
            // 空对话状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.emptyConversation'))}</div>`;
            return;
        }

        // 批量渲染消息
        isBulkRenderingChannel = true;
        state.channelMessages.forEach(message => addChannelMessage(message));
        isBulkRenderingChannel = false;
        scrollChannelToBottom();
    }

    /**
     * 填充频道Agent选项下拉框
     * 
     * @param {string} selectedAgentId - 当前选中的Agent ID
     */
    function populateChannelAgentOptions(selectedAgentId) {
        // 检查下拉框元素是否存在
        if (!elements.channelAgentId) {
            return;
        }

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 没有可用Agent时的处理
        if (state.agents.length === 0) {
            elements.channelAgentId.innerHTML = `<option value="">${escapeHtml(t('sidebar.noAgents'))}</option>`;
            elements.channelAgentId.disabled = true;
            return;
        }

        // 检查选中的Agent是否存在于列表中
        const hasSelectedAgent = state.agents.some(agent => agent.id === selectedAgentId);
        
        // 生成Agent选项HTML
        const options = state.agents.map(agent => `
            <option value="${escapeHtml(agent.id)}">${escapeHtml(`${agent.name} · ${agent.model}`)}</option>
        `);

        // 如果选中的Agent不在列表中，添加一个缺失提示选项
        if (selectedAgentId && !hasSelectedAgent) {
            options.unshift(`<option value="${escapeHtml(selectedAgentId)}">${escapeHtml(t('channel.listMetaMissingAgent', { agentId: selectedAgentId }))}</option>`);
        }

        // 更新下拉框
        elements.channelAgentId.disabled = false;
        elements.channelAgentId.innerHTML = options.join('');
        // 设置选中值，优先使用传入的值，否则使用第一个Agent
        elements.channelAgentId.value = selectedAgentId && (hasSelectedAgent || selectedAgentId)
            ? selectedAgentId
            : state.agents[0]?.id || '';
    }

    /**
     * 获取当前选中的频道
     * 
     * @returns {Object|null} 当前频道对象，未选中则返回null
     */
    function getCurrentChannel() {
        if (!state.currentChannelId) {
            return null;
        }

        return state.channels.find(channel => channel.id === state.currentChannelId) || null;
    }

    /**
     * 根据ID解析Agent
     * 
     * @param {string} agentId - Agent ID
     * @returns {Object|null} Agent对象，未找到则返回null
     */
    function resolveAgent(agentId) {
        if (!agentId) {
            return null;
        }

        return state.agents.find(agent => agent.id === agentId) || null;
    }

    /**
     * 解析频道关联的Agent
     * 优先使用频道绑定的Agent，若无则使用第一个可用Agent
     * 
     * @param {Object} channel - 频道对象
     * @returns {Object|null} Agent对象
     */
    function resolveChannelAgent(channel) {
        if (!channel) {
            return null;
        }

        return resolveAgent(channel.agentId) || state.agents[0] || null;
    }

    /**
     * 判断频道是否为导入的频道
     * 
     * @param {Object} channel - 频道对象
     * @returns {boolean} 是否为导入频道
     */
    function isImportedChannel(channel) {
        return Boolean(channel && channel.source === 'openclaw');
    }

    /**
     * 开始创建新频道草稿
     * 初始化草稿状态并清空相关数据
     * 
     * @param {Object} options - 配置选项
     * @param {boolean} options.focus - 是否聚焦到名称输入框，默认为true
     */
    function startNewChannelDraft(options = {}) {
        // 初始化草稿数据
        state.channelDraft = {
            name: '',
            agentId: state.agents[0]?.id || '', // 默认使用第一个Agent
            description: ''
        };
        // 重置相关状态
        state.currentChannelId = null;
        state.channelMessages = [];
        state.channelLoading = false;
        resetTransientChannelState();
        renderChannelWorkspace();

        // 根据配置决定是否聚焦输入框
        if (options.focus === false) {
            return;
        }

        // 延迟聚焦以确保DOM已更新
        window.setTimeout(() => {
            elements.channelName?.focus();
        }, 0);
    }

    /**
     * 选择指定频道
     * 切换当前频道并请求加载频道消息
     * 
     * @param {string} channelId - 要选择的频道ID
     */
    function selectChannel(channelId) {
        // 检查是否已选中该频道
        if (!channelId || channelId === state.currentChannelId && !state.channelDraft) {
            return;
        }

        // 重置状态
        state.channelDraft = null;
        state.currentChannelId = channelId;
        state.channelMessages = [];
        state.channelLoading = true;
        resetTransientChannelState();
        renderChannelWorkspace();
        
        // 向VSCode发送选择频道消息
        vscode.postMessage({
            type: 'selectChannel',
            channelId
        });
    }

    /**
     * 保存频道配置
     * 根据当前状态决定是创建新频道还是更新现有频道
     */
    function saveChannelConfig() {
        // 构建保存数据，对输入内容进行规范化处理
        const payload = {
            name: normalizeOutgoingMessage(elements.channelName?.value || ''),
            agentId: elements.channelAgentId?.value || '',
            description: normalizeOutgoingMessage(elements.channelDescription?.value || '')
        };

        // 草稿状态：创建新频道
        if (state.channelDraft) {
            vscode.postMessage({
                type: 'createChannel',
                data: payload
            });
            return;
        }

        // 检查当前频道ID是否存在
        if (!state.currentChannelId) {
            return;
        }

        // 导入频道：创建新频道（导入频道不能直接更新）
        const existingChannel = getCurrentChannel();
        if (isImportedChannel(existingChannel)) {
            vscode.postMessage({
                type: 'createChannel',
                data: payload
            });
            return;
        }

        // 更新现有频道
        vscode.postMessage({
            type: 'updateChannel',
            channelId: state.currentChannelId,
            data: payload
        });
    }

    /**
     * 更新频道输入框状态
     * 根据当前状态启用或禁用输入框并更新提示信息
     */
    function updateChannelInputState() {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const agent = channel ? resolveChannelAgent(channel) : null;

        let disabled = false;
        let hint = '';

        // 根据不同状态确定输入框状态和提示
        if (state.channelDraft) {
            // 草稿状态：禁用输入
            disabled = true;
            hint = t('channel.unsavedHint');
        } else if (!channel) {
            // 未选择频道
            disabled = true;
            hint = t('channel.selectHint');
        } else if (!agent) {
            // Agent缺失
            disabled = true;
            hint = t('channel.missingAgentHint');
        } else if (state.channelLoading) {
            // 加载中
            disabled = true;
            hint = t('common.loading');
        } else if (state.channelSending) {
            // 发送中
            disabled = true;
            hint = t('chat.thinking');
        } else {
            // 就绪状态
            hint = t('channel.chatHintReady', { agent: agent.name });
        }

        // 更新UI元素
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
            // 只在发送状态下显示停止按钮
            elements.btnStopChannel.classList.toggle('hidden', !state.channelSending);
            elements.btnStopChannel.disabled = !state.channelSending;
        }
    }

    /**
     * 发送频道消息
     * 验证状态后将用户消息添加到界面并发送到VSCode
     */
    function sendChannelMessage() {
        // 获取并规范化输入内容
        const content = normalizeOutgoingMessage(elements.channelMessageInput?.value || '');

        // 检查草稿状态
        if (state.channelDraft) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.unsavedHint') : 'Save the channel first.');
            return;
        }

        // 检查频道是否已选择
        const channel = getCurrentChannel();
        if (!channel) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.selectHint') : 'Select a channel first.');
            return;
        }

        // 检查Agent是否可用
        if (!resolveChannelAgent(channel)) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.missingAgentHint') : 'Bind this channel to an available agent first.');
            return;
        }

        // 检查内容是否为空或正在发送/加载中
        if (!content.trim() || state.channelSending || state.channelLoading) {
            return;
        }

        // 清空输入框
        if (elements.channelMessageInput) {
            elements.channelMessageInput.value = '';
        }

        // 更新发送状态并添加用户消息
        state.channelSending = true;
        addChannelMessage({
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });
        
        // 显示思考指示器并更新输入状态
        showChannelThinkingIndicator();
        updateChannelInputState();

        // 向VSCode发送消息
        vscode.postMessage({
            type: 'sendChannelMessage',
            channelId: channel.id,
            content
        });
    }

    /**
     * 显示频道思考指示器
     * 在消息列表底部显示AI正在思考的动画
     */
    function showChannelThinkingIndicator() {
        // 检查消息容器是否存在
        if (!elements.channelMessages) {
            return;
        }

        // 清除已有的思考指示器
        clearChannelThinkingIndicator();
        
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 创建思考指示器元素
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

        // 添加到消息容器
        elements.channelMessages.appendChild(div);
        scrollChannelToBottom();
        state.currentChannelThinking = div;
    }

    /**
     * 清除频道思考指示器
     * 移除正在显示的思考动画元素
     */
    function clearChannelThinkingIndicator() {
        if (!state.currentChannelThinking) {
            return;
        }

        state.currentChannelThinking.remove();
        state.currentChannelThinking = null;
    }

    /**
     * 重置频道临时状态
     * 清除思考指示器和相关状态标志
     */
    function resetTransientChannelState() {
        clearChannelThinkingIndicator();
        activeChannelTraceContainer = null;
        state.channelSending = false;
        updateChannelInputState();
    }

    /**
     * 停止频道运行
     * 发送停止消息到VSCode并重置临时状态
     */
    function stopChannelRun() {
        // 只有在发送状态下才能停止
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

    /**
     * 添加频道消息到界面
     * 根据消息类型决定如何渲染（独立消息或追踪消息）
     * 
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色（user/assistant/tool等）
     * @param {string} msg.content - 消息内容
     * @param {string} msg.timestamp - 消息时间戳
     */
    function addChannelMessage(msg) {
        // 验证消息和容器
        if (!msg || !elements.channelMessages) return;
        // 避免重复渲染同一消息
        if (rememberRenderedMessageId(msg, renderedChannelMessageIds)) return;
        // 根据规则决定是否隐藏消息
        if (shouldHideMessage(msg)) return;

        // 助手或工具消息清除思考指示器
        if ((msg.role === 'assistant' || msg.role === 'tool') && state.currentChannelThinking) {
            clearChannelThinkingIndicator();
        }

        // 用户消息：重置追踪容器并渲染为独立消息
        if (msg.role === 'user') {
            activeChannelTraceContainer = null;
            appendStandaloneChannelMessage(msg);
            return;
        }

        // 检查是否应该追加到现有追踪容器
        if (shouldAppendToTrace(msg)) {
            appendChannelTraceMessage(msg);
            return;
        }

        // 其他情况：渲染为独立消息
        activeChannelTraceContainer = null;
        appendStandaloneChannelMessage(msg);
    }

    /**
     * 追加独立频道消息
     * 创建完整的消息元素并添加到消息列表
     * 
     * @param {Object} msg - 消息对象
     */
    function appendStandaloneChannelMessage(msg) {
        // 创建消息元素
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;

        // 格式化时间和Token信息
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const rendered = renderMessageContent(msg);

        // 设置消息HTML内容
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${getMessageRoleLabel(msg)}</span>
                <span class="message-time">${time}</span>
                ${tokenInfo}
            </div>
            ${rendered}
        `;

        // 添加到消息容器
        elements.channelMessages.appendChild(div);
        // 非批量渲染模式下滚动到底部
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        // 助手消息（非工具使用）完成时重置发送状态
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            state.channelSending = false;
            updateChannelInputState();
        }
    }

    /**
     * 追加频道追踪消息
     * 将消息追加到当前的追踪容器中（用于工具调用链）
     * 
     * @param {Object} msg - 消息对象
     */
    function appendChannelTraceMessage(msg) {
        // 获取或创建追踪容器
        const container = getOrCreateChannelTraceContainer(msg);
        const body = container.querySelector('.trace-body');
        if (!body) {
            return;
        }

        // 创建追踪段落元素
        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        
        // 非批量渲染模式下滚动到底部
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        // 助手消息（非工具使用）完成时重置状态
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            activeChannelTraceContainer = null;
            state.channelSending = false;
            updateChannelInputState();
        }
    }

    /**
     * 获取或创建频道追踪容器
     * 用于存放一系列相关的工具调用和响应
     * 
     * @param {Object} msg - 消息对象
     * @returns {HTMLElement} 追踪容器元素
     */
    function getOrCreateChannelTraceContainer(msg) {
        // 如果已有连接的容器，直接返回
        if (activeChannelTraceContainer?.isConnected) {
            return activeChannelTraceContainer;
        }

        // 创建新的追踪容器
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

    /**
     * 滚动频道消息到底部
     * 将消息容器的滚动条滚动到最底部
     */
    function scrollChannelToBottom() {
        if (!elements.channelMessages) {
            return;
        }

        elements.channelMessages.scrollTop = elements.channelMessages.scrollHeight;
    }

    /**
     * 显示频道错误信息
     * 在消息区域显示错误提示
     * 
     * @param {string} msg - 错误消息内容
     */
    function showChannelError(msg) {
        if (!elements.channelMessages) {
            return;
        }

        // 使用全局反馈模块显示错误
        window.OpenClawPanelFeedback.showChatError(elements.channelMessages, msg, scrollChannelToBottom);
    }
