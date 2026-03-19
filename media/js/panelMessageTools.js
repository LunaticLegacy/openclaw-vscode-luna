// OpenClaw Luna - Panel Message Tools
'use strict';

    function renderToolMessage(msg, parts) {
        const toolPart = parts.find(part => part.type === 'toolResult');
        const toolName = toolPart?.name || msg.toolName || 'tool';
        const toolCallId = normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId);
        const toolArguments = toolPart?.arguments ?? msg.toolArguments ?? '';
        const toolResult = toolPart?.result ?? msg.content ?? '';
        const toolDetails = toolPart?.details ?? msg.toolDetails ?? '';
        const toolStatus = extractToolStatus(toolPart?.result) || extractToolStatus(toolDetails);
        const isError = Boolean(toolPart?.isError ?? msg.isError) || toolStatus === 'error';

        return `
            <details class="tool-card ${isError ? 'tool-card-error' : 'tool-card-success'}"${buildToolCardDataAttributes(toolCallId, toolName)}>
                <summary class="tool-card-summary">
                    <div class="tool-card-header">
                        <span class="tool-card-status">${isError ? '&#10060;' : '&#9989;'}</span>
                        <span class="tool-card-name">${escapeHtml(toolName)}</span>
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
    function getMessageRoleLabel(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (msg?.displayName) return msg.displayName;
        if (msg.role === 'user') return t('chat.roleUser');
        if (msg.role === 'system') return t('chat.roleNotice');
        if (msg.role === 'tool') return t('chat.roleTool');
        return t('chat.roleAssistant');
    }

    function isToolUseMessage(msg) {
        return msg?.role === 'assistant' && msg?.metadata?.stopReason === 'toolUse';
    }

    function extractToolStatus(value) {
        if (!value) {
            return '';
        }

        if (typeof value === 'object') {
            const record = value;
            if (typeof record.status === 'string') {
                return record.status.trim().toLowerCase();
            }
            if (record.result && typeof record.result === 'object' && typeof record.result.status === 'string') {
                return record.result.status.trim().toLowerCase();
            }
            return '';
        }

        if (typeof value !== 'string') {
            return '';
        }

        const trimmed = value.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return '';
        }

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

    function normalizeToolName(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
    }

    function normalizeToolCallId(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

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

    function buildToolCardDataAttributes(toolCallId, toolName) {
        const normalizedCallId = normalizeToolCallId(toolCallId);
        const normalizedName = normalizeToolName(toolName || 'tool');
        const attributes = [`data-tool-name="${escapeHtml(normalizedName)}"`];

        if (normalizedCallId) {
            attributes.push(`data-tool-call-id="${escapeHtml(encodeToolCallId(normalizedCallId))}"`);
        }

        return ` ${attributes.join(' ')}`;
    }

    function findPendingToolCard(container, toolCallId, toolName) {
        if (!container) {
            return null;
        }

        const normalizedCallId = normalizeToolCallId(toolCallId);
        if (normalizedCallId) {
            const byId = container.querySelector(`.tool-card-pending[data-tool-call-id="${encodeToolCallId(normalizedCallId)}"]`);
            if (byId) {
                return byId;
            }
        }

        const normalizedName = normalizeToolName(toolName || 'tool');
        const cards = container.querySelectorAll(`.tool-card-pending[data-tool-name="${normalizedName}"]`);
        if (cards.length === 0) {
            return null;
        }

        return cards[cards.length - 1];
    }

    function getToolResultContext(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const toolPart = parts.find(part => part.type === 'toolResult');
        return {
            parts,
            toolCallId: normalizeToolCallId(toolPart?.toolCallId ?? msg.toolCallId),
            toolName: toolPart?.name || msg.toolName || 'tool'
        };
    }

    function getToolSectionMetrics(value) {
        const formatted = formatToolData(value);
        const lineCount = formatted ? formatted.split(/\r?\n/).length : 0;
        return {
            formatted,
            lineCount,
            charCount: formatted.length
        };
    }

    function isHeavyToolName(toolName) {
        return new Set(['exec', 'write', 'append', 'edit', 'multi_edit', 'read']).has(normalizeToolName(toolName));
    }

    function shouldCollapseToolSection(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        return metrics.charCount > 280 || metrics.lineCount > 8;
    }

    function shouldStartToolSectionCollapsed(toolName, metrics) {
        if (isHeavyToolName(toolName)) {
            return true;
        }

        return metrics.charCount > 600 || metrics.lineCount > 16;
    }

    function describeToolSection(metrics) {
        if (metrics.lineCount > 1) {
            return `${metrics.lineCount} lines`;
        }

        return `${metrics.charCount} chars`;
    }

    function renderToolSection(label, value, options = {}) {
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
        const bodyContent = format === 'content' && typeof value === 'string'
            ? `<div class="message-content">${formatContent(value)}</div>`
            : `<pre class="tool-card-pre">${escapeHtml(metrics.formatted)}</pre>`;
        const isCollapsible = forceCollapsible || shouldCollapseToolSection(toolName, metrics);

        if (!isCollapsible) {
            return `
                <div class="tool-card-section">
                    <div class="tool-card-label">${label}</div>
                    ${bodyContent}
                </div>
            `;
        }

        const isCollapsed = defaultCollapsed ?? shouldStartToolSectionCollapsed(toolName, metrics);

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

    // Format thinking content
