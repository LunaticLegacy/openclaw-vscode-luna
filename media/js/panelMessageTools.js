// OpenClaw Luna - Panel Message Tools
// 该文件负责处理工具消息的渲染、工具卡片的构建以及工具相关数据的处理
'use strict';

    /**
     * 渲染工具消息
     * 将工具调用结果渲染为可折叠的工具卡片
     * @param {Object} msg - 消息对象
     * @param {Array} parts - 消息的结构化部分数组
     * @param {Object} parts[].type - 部分类型（toolResult等）
     * @param {string} parts[].name - 工具名称
     * @param {string} parts[].toolCallId - 工具调用ID
     * @param {*} parts[].arguments - 工具参数
     * @param {*} parts[].result - 工具执行结果
     * @param {*} parts[].details - 工具执行详情
     * @param {boolean} parts[].isError - 是否发生错误
     * @returns {string} 工具卡片的HTML字符串
     */
    function renderToolMessage(msg, parts) {
        // 查找工具结果部分
        const toolPart = parts.find(part => part.type === 'toolResult');
        // 提取工具信息（优先从parts获取，否则从msg获取）
        const toolName = toolPart?.name || msg.toolName || 'tool';
        const toolCallId = normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId);
        const toolArguments = toolPart?.arguments ?? msg.toolArguments ?? '';
        const toolResult = toolPart?.result ?? msg.content ?? '';
        const toolDetails = toolPart?.details ?? msg.toolDetails ?? '';
        // 提取错误状态
        const toolStatus = extractToolStatus(toolPart?.result) || extractToolStatus(toolDetails);
        const isError = Boolean(toolPart?.isError ?? msg.isError) || toolStatus === 'error';
        const toolDurationMs = getToolDurationMs(msg);
        const startedAt = getToolStartedAt(msg);

        // 构建工具卡片HTML
        return `
            <details class="tool-card ${isError ? 'tool-card-error' : 'tool-card-success'}"${buildToolCardDataAttributes(toolCallId, toolName, { startedAt })}>
                <summary class="tool-card-summary">
                    <div class="tool-card-header">
                        <span class="tool-card-status">${isError ? '&#10060;' : '&#9989;'}</span>
                        <span class="tool-card-name">${escapeHtml(toolName)}</span>
                        ${renderToolDurationBadge(toolDurationMs)}
                    </div>
                </summary>
                <div class="tool-card-body">
                    ${renderToolSection('Input', toolArguments, {
                        toolName,
                        format: 'pre'
                    })}
                    ${renderToolSection('Result', toolResult, {
                        toolName,
                        format: 'pre'
                    })}
                    ${renderToolSection('Details', toolDetails, {
                        toolName,
                        format: 'pre'
                    })}
                </div>
            </details>
        `;
    }

    /**
     * 获取消息角色标签的本地化文本
     * 优先使用消息的displayName，否则根据角色返回对应翻译
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色
     * @param {string} [msg.displayName] - 自定义显示名称
     * @returns {string} 角色标签文本
     */
    function getMessageRoleLabel(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (msg?.displayName) return msg.displayName;
        if (msg.role === 'user') return t('chat.roleUser');
        if (msg.role === 'system') return t('chat.roleNotice');
        if (msg.role === 'tool') return t('chat.roleTool');
        return t('chat.roleAssistant');
    }

    /**
     * 判断消息是否为工具使用消息
     * 根据消息的stopReason元数据判断
     * @param {Object} msg - 消息对象
     * @param {Object} msg.metadata - 消息元数据
     * @param {string} msg.metadata.stopReason - 停止原因
     * @returns {boolean} 是否为工具使用消息
     */
    function isToolUseMessage(msg) {
        return msg?.role === 'assistant' && msg?.metadata?.stopReason === 'toolUse';
    }

    /**
     * 从值中提取工具状态
     * 支持从对象、JSON字符串中提取status字段
     * @param {*} value - 要提取状态的值
     * @returns {string} 工具状态字符串（'error'等）或空字符串
     */
    function extractToolStatus(value) {
        if (!value) {
            return '';
        }

        // 对象类型：直接读取status属性
        if (typeof value === 'object') {
            const record = value;
            if (typeof record.status === 'string') {
                return record.status.trim().toLowerCase();
            }
            // 嵌套result对象
            if (record.result && typeof record.result === 'object' && typeof record.result.status === 'string') {
                return record.result.status.trim().toLowerCase();
            }
            return '';
        }

        // 非字符串类型返回空
        if (typeof value !== 'string') {
            return '';
        }

        // 检查是否为JSON格式
        const trimmed = value.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return '';
        }

        // 尝试解析JSON并提取status
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
                return parsed.status.trim().toLowerCase();
            }
        } catch {
            return '';
        }

        return '';
    }

    /**
     * 格式化工具数据
     * 将值格式化为可显示的字符串，对象会转为格式化的JSON
     * @param {*} value - 要格式化的值
     * @returns {string} 格式化后的字符串
     */
    function formatToolData(value) {
        if (typeof value === 'string') {
            return normalizeVisibleNewlines(value);
        }

        try {
            return normalizeVisibleNewlines(JSON.stringify(value, null, 2));
        } catch {
            return normalizeVisibleNewlines(String(value));
        }
    }

    /**
     * 规范化工具名称
     * 将工具名称转换为小写、去除空格、替换为下划线
     * @param {string} name - 原始工具名称
     * @returns {string} 规范化后的工具名称
     */
    function normalizeToolName(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
    }

    /**
     * 规范化工具调用ID
     * @param {*} value - 原始工具调用ID
     * @returns {string} 规范化后的字符串
     */
    function normalizeToolCallId(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function getToolStartedAt(message) {
        return typeof message?.metadata?.toolStartedAt === 'string' && message.metadata.toolStartedAt.trim()
            ? message.metadata.toolStartedAt.trim()
            : (typeof message?.timestamp === 'string' ? message.timestamp : '');
    }

    function getToolDurationMs(message) {
        const explicit = Number(message?.metadata?.toolDurationMs);
        if (Number.isFinite(explicit) && explicit >= 0) {
            return explicit;
        }

        const startedAt = Date.parse(String(message?.metadata?.toolStartedAt || ''));
        const completedAt = Date.parse(String(message?.metadata?.toolCompletedAt || message?.timestamp || ''));
        if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
            return null;
        }

        return completedAt - startedAt;
    }

    function formatToolDuration(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return '';
        }

        if (durationMs < 1000) {
            return `${Math.round(durationMs)}ms`;
        }

        const seconds = durationMs / 1000;
        return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
    }

    function renderToolDurationBadge(durationMs) {
        const formatted = formatToolDuration(durationMs);
        if (!formatted) {
            return '';
        }

        return `<span class="message-metric-badge tool-card-duration">${escapeHtml(formatted)}</span>`;
    }

    /**
     * 编码工具调用ID
     * 用于在HTML属性中安全使用
     * @param {*} value - 工具调用ID
     * @returns {string} URL编码后的ID或原值
     */
    function encodeToolCallId(value) {
        if (!value) {
            return '';
        }

        try {
            return encodeURIComponent(value);
        } catch {
            return value;
        }
    }

    /**
     * 构建工具卡片的数据属性字符串
     * @param {string} toolCallId - 工具调用ID
     * @param {string} toolName - 工具名称
     * @returns {string} HTML数据属性字符串（如 ' data-tool-name="xxx" data-tool-call-id="yyy"'）
     */
    function buildToolCardDataAttributes(toolCallId, toolName, options = {}) {
        const normalizedCallId = normalizeToolCallId(toolCallId);
        const normalizedName = normalizeToolName(toolName || 'tool');
        const attributes = [`data-tool-name="${escapeHtml(normalizedName)}"`];

        if (normalizedCallId) {
            attributes.push(`data-tool-call-id="${escapeHtml(encodeToolCallId(normalizedCallId))}"`);
        }

        if (typeof options.startedAt === 'string' && options.startedAt.trim()) {
            attributes.push(`data-tool-started-at="${escapeHtml(options.startedAt.trim())}"`);
        }

        return ` ${attributes.join(' ')}`;
    }

    /**
     * 在容器中查找待处理的工具卡片
     * 优先按工具调用ID查找，其次按工具名称查找最后一个
     * @param {HTMLElement} container - 容器元素
     * @param {string} toolCallId - 工具调用ID
     * @param {string} toolName - 工具名称
     * @returns {HTMLElement|null} 找到的工具卡片元素或null
     */
    function findPendingToolCard(container, toolCallId, toolName) {
        if (!container) {
            return null;
        }

        // 先按ID查找
        const normalizedCallId = normalizeToolCallId(toolCallId);
        if (normalizedCallId) {
            const byId = container.querySelector(`.tool-card-pending[data-tool-call-id="${encodeToolCallId(normalizedCallId)}"]`);
            if (byId) {
                return byId;
            }
        }

        // 按名称查找最后一个匹配的卡片
        const normalizedName = normalizeToolName(toolName || 'tool');
        const cards = container.querySelectorAll(`.tool-card-pending[data-tool-name="${normalizedName}"]`);
        if (cards.length === 0) {
            return null;
        }

        return cards[cards.length - 1];
    }

    /**
     * 获取工具结果的上下文信息
     * @param {Object} msg - 消息对象
     * @param {Array} msg.parts - 消息结构化部分
     * @param {string} msg.toolCallId - 工具调用ID
     * @param {string} msg.toolName - 工具名称
     * @returns {Object} 工具结果上下文，包含parts、toolCallId和toolName
     */
    function getToolResultContext(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const toolPart = parts.find(part => part.type === 'toolResult');
        return {
            parts,
            toolCallId: normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId),
            toolName: toolPart?.name || msg.toolName || 'tool'
        };
    }

    /**
     * 获取工具部分的度量信息
     * 计算格式化后的内容、行数和字符数
     * @param {*} value - 工具部分值
     * @returns {Object} 度量信息对象，包含formatted、lineCount和charCount
     */
    function getToolSectionMetrics(value) {
        const formatted = formatToolData(value);
        const lineCount = formatted ? formatted.split(/\r?\n/).length : 0;
        return {
            formatted,
            lineCount,
            charCount: formatted.length
        };
    }

    /**
     * 判断是否为重量级工具名称
     * 重量级工具（如文件操作）默认需要折叠
     * @param {string} toolName - 工具名称
     * @returns {boolean} 是否为重量级工具
     */
    function isHeavyToolName(toolName) {
        return new Set(['exec', 'write', 'append', 'edit', 'multi_edit', 'read']).has(normalizeToolName(toolName));
    }

    /**
     * 判断工具部分是否应该折叠
     * 重量级工具或内容超过阈值时返回true
     * @param {string} toolName - 工具名称
     * @param {Object} metrics - 度量信息对象
     * @returns {boolean} 是否应该折叠
     */
    function shouldCollapseToolSection(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        // 内容超过280字符或8行时折叠
        return metrics.charCount > 280 || metrics.lineCount > 8;
    }

    /**
     * 判断工具部分初始状态是否应该折叠
     * 重量级工具或内容超过较大阈值时返回true
     * @param {string} toolName - 工具名称
     * @param {Object} metrics - 度量信息对象
     * @returns {boolean} 初始是否应该折叠
     */
    function shouldStartToolSectionCollapsed(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        // 内容超过600字符或16行时默认折叠
        return metrics.charCount > 600 || metrics.lineCount > 16;
    }

    /**
     * 描述工具部分的内容概要
     * 根据行数或字符数生成描述
     * @param {Object} metrics - 度量信息对象
     * @returns {string} 描述文本（如"5 lines"或"100 chars"）
     */
    function describeToolSection(metrics) {
        if (metrics.lineCount > 1) {
            return `${metrics.lineCount} lines`;
        }

        return `${metrics.charCount} chars`;
    }

    /**
     * 渲染工具部分（如Input、Result、Details）
     * 根据内容大小决定是否折叠显示
     * @param {string} label - 部分标签（如"Input"、"Result"）
     * @param {*} value - 部分内容值
     * @param {Object} options - 渲染选项
     * @param {string} options.toolName - 工具名称
     * @param {string} options.format - 格式类型（'pre'或'content'）
     * @param {boolean} options.forceCollapsible - 是否强制可折叠
     * @param {boolean} options.defaultCollapsed - 默认是否折叠
     * @returns {string} 渲染后的HTML字符串
     */
    function renderToolSection(label, value, options = {}) {
        // 空值检查
        if (value === undefined || value === null) {
            return '';
        }

        if (typeof value === 'string' && !value.trim()) {
            return '';
        }

        const {
            toolName = '',
            format = 'pre',
            forceCollapsible = true,
            defaultCollapsed
        } = options;

        const metrics = getToolSectionMetrics(value);
        // 根据格式类型生成内容HTML
        const bodyContent = format === 'content' && typeof value === 'string'
            ? `<div class="message-content">${formatContent(value)}</div>`
            : `<pre class="tool-card-pre">${escapeHtml(metrics.formatted)}</pre>`;

        // 判断是否需要可折叠
        const isCollapsible = forceCollapsible || shouldCollapseToolSection(toolName, metrics);

        // 不需要折叠时直接返回
        if (!isCollapsible) {
            return `
                <div class="tool-card-section">
                    <div class="tool-card-label">${label}</div>
                    ${bodyContent}
                </div>
            `;
        }

        // 判断是否默认折叠
        const isCollapsed = defaultCollapsed ?? shouldStartToolSectionCollapsed(toolName, metrics);

        // 返回可折叠的details元素
        return `
            <details class="tool-card-section tool-card-foldout"${isCollapsed ? '' : ' open'}>
                <summary>
                    <span class="tool-card-label">${label}</span>
                    <span class="tool-card-meta">${escapeHtml(describeToolSection(metrics))}</span>
                </summary>
                <div class="tool-card-foldout-body">
                    ${bodyContent}
                </div>
            </details>
        `;
    }
    
    /**
     * 处理消息内容，提取思考块
     * 将<thinking>标签包裹的内容提取为思考块，从主内容中移除
     * @param {string} content - 原始消息内容
     * @returns {Object} 包含mainContent（主内容）和thinkingHtml（思考块HTML）的对象
     */
    function processMessageContent(content) {
        if (!content) return { mainContent: '', thinkingHtml: '' };
        
        let mainContent = content;
        let thinkingHtml = '';
        
        // 查找所有思考块（<thinking>...</thinking>）
        const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
        const thinkingBlocks = [];
        let match;
        
        while ((match = thinkingRegex.exec(content)) !== null) {
            thinkingBlocks.push(match[1].trim());
        }
        
        // 从主内容中移除思考块
        mainContent = content.replace(thinkingRegex, '').trim();
        
        // 如果有思考块，生成可折叠的思考块HTML
        if (thinkingBlocks.length > 0) {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
            const combinedThinking = thinkingBlocks.join('\n\n---\n\n');
            
            thinkingHtml = `
                <div class="thinking-block collapsed">
                    <div class="thinking-header" role="button" tabindex="0" aria-expanded="false">
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
