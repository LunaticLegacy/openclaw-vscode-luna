// OpenClaw Luna - Panel Message Envelope
// 该文件负责处理聊天面板中的消息信封（Envelope）功能，包括用户输入信封的解析、渲染和切换视图
'use strict';

    /**
     * 渲染消息内容的主入口函数
     * 根据消息角色和结构，选择合适的方式进行渲染
     * @param {Object} msg - 消息对象
     * @param {string} msg.role - 消息角色（user/assistant/tool/system）
     * @param {string} msg.content - 消息内容
     * @param {Array} msg.parts - 消息的结构化部分数组
     * @returns {string} 渲染后的HTML字符串
     */
    function renderMessageContent(msg) {
        // 获取用于显示的内容（处理隐藏的信封内容）
        const displayContent = getDisplayContent(msg);

        // 用户消息特殊处理：解析用户输入信封格式
        if (msg.role === 'user') {
            const envelope = parseUserInputEnvelope(displayContent);
            if (envelope) {
                return renderUserInputEnvelope(envelope);
            }

            // 非信封格式的用户消息：处理思考块并渲染
            const { mainContent, thinkingHtml } = processMessageContent(displayContent);
            return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
        }

        // 如果消息包含结构化parts数组，使用结构化渲染
        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
            return renderStructuredMessage(msg);
        }

        // 默认处理方式：处理思考块并渲染
        const { mainContent, thinkingHtml } = processMessageContent(displayContent);
        return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
    }

    /**
     * 获取用于显示的消息内容
     * 对用户消息，会去除隐藏的信封包装内容
     * @param {Object} msg - 消息对象
     * @returns {string} 处理后的显示内容
     */
    function getDisplayContent(msg) {
        const content = String(msg?.content || '');
        // 非用户消息直接返回内容
        if (msg?.role !== 'user') {
            return content;
        }

        // 用户消息需要去除隐藏的信封包装
        return stripHiddenUserEnvelope(content);
    }

    /**
     * 去除用户消息中隐藏的信封包装内容
     * 用于清理系统添加的元数据信封，保留用户实际输入
     * @param {string} content - 原始消息内容
     * @returns {string} 清理后的可见内容
     */
    function stripHiddenUserEnvelope(content) {
        const normalized = String(content || '').trim();
        if (!normalized) {
            return '';
        }

        // 处理会话重置的特殊消息
        if (normalized.startsWith('A new session was started via /new or /reset.')) {
            return '';
        }

        // 如果不是对话信息信封格式，直接返回原内容
        if (!normalized.startsWith('Conversation info (untrusted metadata):')) {
            return normalized;
        }

        // 去除"Conversation info (untrusted metadata):"前缀
        let visible = normalized.replace(
            /^Conversation info \(untrusted metadata\):\s*/i,
            ''
        ).trim();

        // 去除JSON代码块包装
        visible = visible.replace(
            /^(?:```(?:json)?\s*[\r\n]+|json\s*[\r\n]+)?\{[\s\S]*?\}(?:\s*```)?\s*/i,
            ''
        ).trim();

        // 去除文件路径前缀（如[file/path]）
        visible = visible.replace(/^\[[^\]]+\]\s*/, '').trim();
        return visible;
    }

    /**
     * 解析用户输入信封格式
     * 识别包含"User request:"结构的信封内容
     * @param {string} content - 消息内容
     * @returns {Object|null} 解析后的信封对象，包含raw、userRequest和extras字段；如果不是信封格式则返回null
     */
    function parseUserInputEnvelope(content) {
        const normalized = String(content || '').trim();
        // 检查是否包含"User request:"标记（支持中英文冒号）
        if (!normalized || !/\buser request\s*[:\uFF1A]/i.test(normalized)) {
            return null;
        }

        // 收集信封的各个部分
        const sections = collectStructuredEnvelopeSections(normalized);
        if (sections.length === 0) {
            return null;
        }

        // 查找"User request"部分
        const requestIndex = sections.findIndex(section => isUserRequestSectionTitle(section.title));
        if (requestIndex < 0) {
            return null;
        }

        // 提取用户请求内容
        const userRequest = sections[requestIndex]?.content?.trim() || '';
        if (!userRequest) {
            return null;
        }

        // 收集其他额外信息部分
        const extras = sections
            .filter((_, index) => index !== requestIndex)
            .filter(section => section.content.trim().length > 0);

        return {
            raw: normalized,
            userRequest,
            extras
        };
    }

    /**
     * 判断标题是否为"User request"部分
     * @param {string} title - 部分标题
     * @returns {boolean} 是否为User request标题
     */
     function isUserRequestSectionTitle(title) {
        const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return normalized === 'user request';
    }

    /**
     * 停止集群运行
     * 向VSCode发送停止当前运行的消息
     * @returns {void}
     */
    function stopClusterRun() {
        // 获取当前集群信息
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        // 获取目标信息和对话状态
        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        // 如果没有待处理或加载中的状态，无需停止
        if (!conversation.pending && !conversation.loading) {
            return;
        }

        // 更新对话状态为已停止
        conversation.pending = false;
        conversation.loading = false;
        renderClusterWorkspace();
        // 向VSCode发送停止运行的消息
        vscode.postMessage({
            type: 'stopActiveRun',
            scope: target.kind === 'agent' ? 'cluster-agent' : 'cluster-swarm',
            clusterId: cluster.id,
            agentId: target.kind === 'agent' ? target.agentId : undefined,
            mode: target.kind === 'swarm' ? target.mode : undefined
        });
    }

    /**
     * 绑定停止按钮的事件处理器
     * 处理鼠标按下和点击事件，防止默认行为
     * @param {HTMLElement} button - 按钮元素
     * @param {Function} handler - 点击处理函数
     * @returns {void}
     */
    function bindStopButton(button, handler) {
        if (!button) {
            return;
        }

        // 鼠标按下时触发（左键）
        button.addEventListener('mousedown', (e) => {
            if (e.button !== 0) {
                return;
            }

            e.preventDefault();
            handler();
        });

        // 点击事件阻止默认行为
        button.addEventListener('click', (e) => {
            e.preventDefault();
        });
    }

    /**
     * 收集结构化的信封部分
     * 按顺序解析信封的各个部分（System Information、Sender、Swarm Context等）
     * @param {string} content - 信封内容
     * @returns {Array} 信封部分数组，每个部分包含title和content
     */
    function collectStructuredEnvelopeSections(content) {
        const lines = String(content || '').split(/\r?\n/);
        const sections = [];
        let cursor = 0;

        // 解析System部分（以"System:"开头的行）
        const systemLines = [];
        while (cursor < lines.length) {
            const trimmed = lines[cursor].trim();
            if (!trimmed) {
                if (systemLines.length > 0) {
                    systemLines.push('');
                }
                cursor += 1;
                continue;
            }

            if (!trimmed.startsWith('System:')) {
                break;
            }

            systemLines.push(trimmed.replace(/^System:\s*/, ''));
            cursor += 1;
        }

        pushEnvelopeSection(sections, 'System Information', systemLines.join('\n').trim());

        // 解析Sender部分（未受信任的发送者元数据）
        const senderSection = extractNamedEnvelopeSection(lines, cursor, /^Sender\s+\(untrusted metadata\)\s*:\s*$/i, [
            /^\[[^\]]+\]/,
            /^User request\s*[:\uFF1A]/i,
            /^Current positions\s*[:\uFF1A]/i
        ]);
        if (senderSection) {
            pushEnvelopeSection(sections, 'Sender (untrusted metadata)', senderSection.content);
            cursor = senderSection.nextIndex;
        }

        // 解析Swarm Context部分（集群上下文信息）
        const swarmContextSection = extractLeadingEnvelopeBlock(lines, cursor, /^User request\s*[:\uFF1A]/i);
        if (swarmContextSection && /^\[[^\]]+\]/.test(swarmContextSection.content.trim())) {
            pushEnvelopeSection(sections, 'Swarm Context', swarmContextSection.content);
            cursor = swarmContextSection.nextIndex;
        }

        // 解析User request部分
        const userRequestSection = extractNamedEnvelopeSection(lines, cursor, /^User request\s*[:\uFF1A]/i, [
            /^Current positions\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (userRequestSection) {
            pushEnvelopeSection(sections, 'User request', userRequestSection.content);
            cursor = userRequestSection.nextIndex;
        }

        // 解析Current positions部分
        const positionsSection = extractNamedEnvelopeSection(lines, cursor, /^Current positions\s*[:\uFF1A]/i, [
            /^Peer reviews\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (positionsSection) {
            pushEnvelopeSection(sections, 'Current positions', positionsSection.content);
            cursor = positionsSection.nextIndex;
        }

        // 解析Peer reviews部分
        const peerReviewsSection = extractNamedEnvelopeSection(lines, cursor, /^Peer reviews\s*[:\uFF1A]/i, [
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (peerReviewsSection) {
            pushEnvelopeSection(sections, 'Peer reviews', peerReviewsSection.content);
            cursor = peerReviewsSection.nextIndex;
        }

        // 处理剩余内容
        const remainder = lines.slice(cursor).join('\n').trim();
        if (remainder) {
            // 尝试作为输入信封部分解析
            const fallbackSections = collectInputEnvelopeSections(remainder);
            if (fallbackSections.length > 0) {
                fallbackSections.forEach(section => pushEnvelopeSection(sections, section.title, section.content));
            } else {
                // 否则作为附加上下文
                pushEnvelopeSection(sections, 'Additional Context', remainder);
            }
        }

        return sections;
    }

    /**
     * 向信封部分数组添加一个新的部分
     * 如果标题或内容为空，则不添加
     * @param {Array} sections - 信封部分数组
     * @param {string} title - 部分标题
     * @param {string} content - 部分内容
     * @returns {void}
     */
    function pushEnvelopeSection(sections, title, content) {
        const normalizedTitle = String(title || '').trim();
        const normalizedContent = String(content || '').trim();
        if (!normalizedTitle || !normalizedContent) {
            return;
        }

        sections.push({
            title: normalizedTitle,
            content: normalizedContent
        });
    }

    /**
     * 从指定行开始提取命名的信封部分
     * @param {Array} lines - 行数组
     * @param {number} startIndex - 开始索引
     * @param {RegExp} headingPattern - 标题匹配正则
     * @param {Array} stopPatterns - 停止匹配的正则数组
     * @returns {Object|null} 提取结果，包含content和nextIndex；未匹配则返回null
     */
    function extractNamedEnvelopeSection(lines, startIndex, headingPattern, stopPatterns) {
        for (let index = startIndex; index < lines.length; index += 1) {
            const line = lines[index];
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            // 检查是否匹配标题模式
            if (!headingPattern.test(trimmed)) {
                return null;
            }

            // 提取行内内容（标题后的内容）
            const inlineContent = trimmed.replace(headingPattern, '').trim();
            const bodyLines = [];
            if (inlineContent) {
                bodyLines.push(inlineContent);
            }

            // 收集内容直到遇到停止模式或文档结束
            let cursor = index + 1;
            let activeFence = null; // 当前代码块围栏状态
            while (cursor < lines.length) {
                const candidate = lines[cursor];
                const candidateTrimmed = candidate.trim();
                // 检查是否遇到停止模式（且不在代码块内）
                if (!activeFence && candidateTrimmed && stopPatterns.some(pattern => pattern.test(candidateTrimmed))) {
                    break;
                }
                bodyLines.push(candidate);
                activeFence = updateEnvelopeFenceState(activeFence, candidateTrimmed);
                cursor += 1;
            }

            return {
                content: bodyLines.join('\n').trim(),
                nextIndex: cursor
            };
        }

        return null;
    }

    /**
     * 提取信封的开头块（在遇到停止模式之前的内容）
     * @param {Array} lines - 行数组
     * @param {number} startIndex - 开始索引
     * @param {RegExp} stopPattern - 停止匹配正则
     * @returns {Object|null} 提取结果，包含content和nextIndex；无内容则返回null
     */
    function extractLeadingEnvelopeBlock(lines, startIndex, stopPattern) {
        let cursor = startIndex;
        const bodyLines = [];
        let activeFence = null;

        // 收集内容直到遇到停止模式
        while (cursor < lines.length) {
            const trimmed = lines[cursor].trim();
            if (!activeFence && trimmed && stopPattern.test(trimmed)) {
                break;
            }
            bodyLines.push(lines[cursor]);
            activeFence = updateEnvelopeFenceState(activeFence, trimmed);
            cursor += 1;
        }

        const content = bodyLines.join('\n').trim();
        if (!content) {
            return null;
        }

        return {
            content,
            nextIndex: cursor
        };
    }

    /**
     * 收集输入信封的各个部分
     * 支持Markdown标题格式（# ## ###）和冒号格式（Title: content）
     * @param {string} content - 内容字符串
     * @returns {Array} 信封部分数组
     */
    function collectInputEnvelopeSections(content) {
        const sections = [];
        const leadingLines = [];
        const lines = String(content || '').split(/\r?\n/);
        let current = null;
        let activeFence = null;

        // 将当前部分推入数组
        const pushCurrent = () => {
            if (!current) {
                return;
            }

            const body = current.lines.join('\n').trim();
            if (current.title && body) {
                sections.push({
                    title: current.title,
                    content: body
                });
            }
            current = null;
        };

        // 逐行处理
        for (const rawLine of lines) {
            const trimmed = String(rawLine || '').trim();
            // 检测标题（不在代码块内时）
            const heading = activeFence ? null : detectInputEnvelopeHeading(rawLine);
            if (heading) {
                // 如果当前已有相同标题的部分，追加内容
                if (current && current.title === heading.title) {
                    if (heading.inlineContent) {
                        current.lines.push(heading.inlineContent);
                    }
                    continue;
                }

                pushCurrent();
                current = {
                    title: heading.title,
                    lines: []
                };
                if (heading.inlineContent) {
                    current.lines.push(heading.inlineContent);
                }
                continue;
            }

            // 将行添加到当前部分或作为引导内容
            if (current) {
                current.lines.push(rawLine);
            } else {
                leadingLines.push(rawLine);
            }

            activeFence = updateEnvelopeFenceState(activeFence, trimmed);
        }

        pushCurrent();

        // 将引导内容作为第一个部分
        const leadingContent = leadingLines.join('\n').trim();
        if (leadingContent) {
            sections.unshift({
                title: 'Context',
                content: leadingContent
            });
        }

        return sections;
    }

    /**
     * 更新代码块围栏状态
     * 用于跟踪当前是否在代码块内（``` 或 ~~~）
     * @param {string|null} activeFence - 当前活动的围栏字符（` 或 ~），null表示不在代码块内
     * @param {string} trimmedLine - 当前行的trim后内容
     * @returns {string|null} 更新后的围栏状态
     */
    function updateEnvelopeFenceState(activeFence, trimmedLine) {
        const match = String(trimmedLine || '').match(/^(`{3,}|~{3,})/);
        if (!match) {
            return activeFence;
        }

        const fenceType = match[1].charAt(0);
        if (!activeFence) {
            return fenceType;
        }

        // 相同类型的围栏结束代码块
        return activeFence === fenceType ? null : activeFence;
    }

    /**
     * 检测输入信封标题
     * 支持Markdown标题（# ## ###）和冒号格式（Title: content）
     * @param {string} rawLine - 原始行内容
     * @returns {Object|null} 标题对象，包含title和inlineContent；未检测到则返回null
     */
    function detectInputEnvelopeHeading(rawLine) {
        const trimmed = String(rawLine || '').trim();
        if (!trimmed || trimmed.startsWith('```')) {
            return null;
        }

        // 检测Markdown标题格式（# ## ### 等）
        const hashHeadingMatch = trimmed.match(/^#{1,6}\s*(.+?)\s*[:\uFF1A]?\s*$/);
        if (hashHeadingMatch) {
            return {
                title: hashHeadingMatch[1].trim(),
                inlineContent: ''
            };
        }

        // 检测冒号格式标题（Title: content）
        const colonHeadingMatch = trimmed.match(/^([^:\uFF1A]{1,80})\s*[:\uFF1A]\s*(.*)$/);
        if (!colonHeadingMatch) {
            return null;
        }

        const headingTitle = colonHeadingMatch[1].trim();
        const inlineContent = colonHeadingMatch[2].trim();
        if (!headingTitle) {
            return null;
        }

        return {
            title: headingTitle,
            inlineContent
        };
    }

    /**
     * 渲染用户输入信封
     * 生成包含用户请求和额外信息卡片的可折叠信封HTML
     * @param {Object} parsed - 解析后的信封对象
     * @param {string} parsed.userRequest - 用户请求内容
     * @param {Array} parsed.extras - 额外信息部分数组
     * @param {string} parsed.raw - 原始内容
     * @returns {string} 信封的HTML字符串
     */
    function renderUserInputEnvelope(parsed) {
        // 渲染用户请求部分
        const requestHtml = `
            <div class="user-input-request">
                <div class="user-input-title">User request</div>
                <div class="message-content">${formatContent(parsed.userRequest)}</div>
            </div>
        `;

        // 渲染额外信息卡片（可折叠）
        const extrasHtml = (parsed.extras || []).map((section, index) => {
            const summary = describeInputEnvelopeSection(section.content);
            return `
                <details class="user-input-extra-card" data-user-input-extra-card>
                    <summary>
                        <span class="user-input-extra-title">${escapeHtml(section.title || `Context ${index + 1}`)}</span>
                        <span class="user-input-extra-meta">${escapeHtml(summary)}</span>
                    </summary>
                    <div class="user-input-extra-body">
                        <div class="message-content">${formatContent(section.content)}</div>
                    </div>
                </details>
            `;
        }).join('');

        // 组合完整信封HTML
        return `
            <div class="user-input-envelope" data-user-input-envelope>
                <div class="user-input-toolbar">
                    <button type="button" class="btn btn-secondary btn-small user-input-toggle" data-user-input-toggle>${escapeHtml(getUserInputToggleLabel(false))}</button>
                </div>
                <div class="user-input-rendered-view">
                    ${requestHtml}
                    <div class="user-input-extra-list${extrasHtml ? '' : ' hidden'}" data-user-input-extra-list>
                        ${extrasHtml}
                    </div>
                </div>
                <div class="user-input-raw-view hidden">
                    <pre class="user-input-raw-pre">${escapeHtml(buildRawUserInputEnvelope(parsed))}</pre>
                </div>
            </div>
        `;
    }

    /**
     * 描述输入信封部分的内容概要
     * 根据内容行数或字符数生成描述
     * @param {string} content - 部分内容
     * @returns {string} 描述文本（如"5 lines"或"100 chars"）
     */
    function describeInputEnvelopeSection(content) {
        const text = String(content || '');
        const lineCount = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
        if (lineCount > 1) {
            return `${lineCount} lines`;
        }

        return `${text.length} chars`;
    }

    /**
     * 构建原始用户输入信封内容
     * 将解析后的信封对象重新组合为原始格式
     * @param {Object} parsed - 解析后的信封对象
     * @returns {string} 原始格式的信封内容
     */
    function buildRawUserInputEnvelope(parsed) {
        if (parsed.raw) {
            return String(parsed.raw);
        }

        const sections = [];
        if (parsed.userRequest) {
            sections.push(`User request:\n${parsed.userRequest.trim()}`);
        }

        (parsed.extras || []).forEach(section => {
            sections.push(`${section.title}:\n${String(section.content || '').trim()}`);
        });

        return sections.join('\n\n');
    }

    /**
     * 获取用户输入切换按钮的标签文本
     * @param {boolean} showRaw - 是否显示原始内容
     * @returns {string} 按钮标签文本
     */
    function getUserInputToggleLabel(showRaw) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return showRaw ? t('input.showRendered') : t('input.showRaw');
    }

    /**
     * 切换用户输入信封的原始/渲染视图
     * @param {HTMLElement} trigger - 触发切换的元素（按钮）
     * @returns {void}
     */
    function toggleUserInputEnvelopeRaw(trigger) {
        const container = trigger.closest('[data-user-input-envelope]');
        if (!container) {
            return;
        }

        const renderedView = container.querySelector('.user-input-rendered-view');
        const rawView = container.querySelector('.user-input-raw-view');
        const nextShowRaw = container.getAttribute('data-show-raw') !== 'true';

        // 切换视图显示状态
        container.setAttribute('data-show-raw', nextShowRaw ? 'true' : 'false');
        renderedView?.classList.toggle('hidden', nextShowRaw);
        rawView?.classList.toggle('hidden', !nextShowRaw);
        trigger.textContent = getUserInputToggleLabel(nextShowRaw);
    }

    /**
     * 渲染结构化消息
     * 处理包含thinking、text、toolCall等parts的复杂消息
     * @param {Object} msg - 消息对象
     * @param {Array} msg.parts - 消息部分数组
     * @param {string} msg.role - 消息角色
     * @returns {string} 渲染后的HTML字符串
     */
    function renderStructuredMessage(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const fallbackContent = getDisplayContent(msg);

        // 工具消息使用专门的渲染函数
        if (msg.role === 'tool') {
            return renderToolMessage(msg, parts);
        }

        // 分类处理不同类型的parts
        const thinkingParts = parts.filter(part => part.type === 'thinking');
        const textParts = parts.filter(part => part.type === 'text');
        const toolCalls = parts.filter(part => part.type === 'toolCall');

        // 渲染思考块（可折叠）
        const thinkingHtml = thinkingParts.length > 0
            ? `
                <div class="thinking-block collapsed">
                    <div class="thinking-header" role="button" tabindex="0" aria-expanded="false">
                        <span class="thinking-icon">&#128173;</span>
                        <span class="thinking-label">${window.OpenClawI18n ? window.OpenClawI18n.t('common.thinking') : 'Thinking'}</span>
                        <span class="thinking-toggle">&#9660;</span>
                    </div>
                    <div class="thinking-body">${formatThinking(thinkingParts.map(part => part.thinking).join('\n\n'))}</div>
                </div>
            `
            : '';

        // 渲染工具调用卡片（待执行状态）
        const toolCallsHtml = toolCalls.length > 0
            ? `
                <div class="tool-call-list">
                    ${toolCalls.map(toolCall => `
                        <details class="tool-card tool-card-pending"${buildToolCardDataAttributes(toolCall.id, toolCall.name, {
                            startedAt: typeof msg?.timestamp === 'string' ? msg.timestamp : ''
                        })}>
                            <summary class="tool-card-summary">
                                <div class="tool-card-header">
                                    <span class="tool-card-status">&#9203;</span>
                                    <span class="tool-card-name">${escapeHtml(toolCall.name || 'tool')}</span>
                                </div>
                            </summary>
                            <div class="tool-card-body">
                                ${renderToolSection('Input', toolCall.arguments, {
                                    toolName: toolCall.name,
                                    format: 'pre'
                                })}
                            </div>
                        </details>
                    `).join('')}
                </div>
            `
            : '';

        // 组合文本内容
        const textContent = textParts.map(part => part.text).join('');
        const hasStructuredNonTextContent = thinkingParts.length > 0 || toolCalls.length > 0;
        const mainContent = textContent || (hasStructuredNonTextContent ? '' : fallbackContent);

        return `
            ${thinkingHtml}
            ${toolCallsHtml}
            ${mainContent ? `<div class="message-content">${formatContent(mainContent)}</div>` : ''}
        `;
    }
