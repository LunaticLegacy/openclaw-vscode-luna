// OpenClaw Luna - Panel Message Envelope
'use strict';

    function renderMessageContent(msg) {
        const displayContent = getDisplayContent(msg);

        if (msg.role === 'user') {
            const envelope = parseUserInputEnvelope(displayContent);
            if (envelope) {
                return renderUserInputEnvelope(envelope);
            }

            const { mainContent, thinkingHtml } = processMessageContent(displayContent);
            return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
        }

        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
            return renderStructuredMessage(msg);
        }

        const { mainContent, thinkingHtml } = processMessageContent(displayContent);
        return `${thinkingHtml}<div class="message-content">${formatContent(mainContent)}</div>`;
    }

    function getDisplayContent(msg) {
        const content = String(msg?.content || '');
        if (msg?.role !== 'user') {
            return content;
        }

        return stripHiddenUserEnvelope(content);
    }

    function stripHiddenUserEnvelope(content) {
        const normalized = String(content || '').trim();
        if (!normalized) {
            return '';
        }

        if (normalized.startsWith('A new session was started via /new or /reset.')) {
            return '';
        }

        if (!normalized.startsWith('Conversation info (untrusted metadata):')) {
            return normalized;
        }

        let visible = normalized.replace(
            /^Conversation info \(untrusted metadata\):\s*/i,
            ''
        ).trim();

        visible = visible.replace(
            /^(?:```(?:json)?\s*[\r\n]+|json\s*[\r\n]+)?\{[\s\S]*?\}(?:\s*```)?\s*/i,
            ''
        ).trim();

        visible = visible.replace(/^\[[^\]]+\]\s*/, '').trim();
        return visible;
    }

    function parseUserInputEnvelope(content) {
        const normalized = String(content || '').trim();
        if (!normalized || !/\buser request\s*[:\uFF1A]/i.test(normalized)) {
            return null;
        }

        const sections = collectStructuredEnvelopeSections(normalized);
        if (sections.length === 0) {
            return null;
        }

        const requestIndex = sections.findIndex(section => isUserRequestSectionTitle(section.title));
        if (requestIndex < 0) {
            return null;
        }

        const userRequest = sections[requestIndex]?.content?.trim() || '';
        if (!userRequest) {
            return null;
        }

        const extras = sections
            .filter((_, index) => index !== requestIndex)
            .filter(section => section.content.trim().length > 0);

        return {
            raw: normalized,
            userRequest,
            extras
        };
    }

    function isUserRequestSectionTitle(title) {
        const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return normalized === 'user request';
    }

    function stopClusterRun() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        if (!conversation.pending && !conversation.loading) {
            return;
        }

        conversation.pending = false;
        conversation.loading = false;
        renderClusterWorkspace();
        vscode.postMessage({
            type: 'stopActiveRun',
            scope: target.kind === 'agent' ? 'cluster-agent' : 'cluster-swarm',
            clusterId: cluster.id,
            agentId: target.kind === 'agent' ? target.agentId : undefined,
            mode: target.kind === 'swarm' ? target.mode : undefined
        });
    }

    function bindStopButton(button, handler) {
        if (!button) {
            return;
        }

        button.addEventListener('mousedown', (e) => {
            if (e.button !== 0) {
                return;
            }

            e.preventDefault();
            handler();
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
        });
    }

    function collectStructuredEnvelopeSections(content) {
        const lines = String(content || '').split(/\r?\n/);
        const sections = [];
        let cursor = 0;

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

        const senderSection = extractNamedEnvelopeSection(lines, cursor, /^Sender\s+\(untrusted metadata\)\s*:\s*$/i, [
            /^\[[^\]]+\]/,
            /^User request\s*[:\uFF1A]/i,
            /^Current positions\s*[:\uFF1A]/i
        ]);
        if (senderSection) {
            pushEnvelopeSection(sections, 'Sender (untrusted metadata)', senderSection.content);
            cursor = senderSection.nextIndex;
        }

        const swarmContextSection = extractLeadingEnvelopeBlock(lines, cursor, /^User request\s*[:\uFF1A]/i);
        if (swarmContextSection && /^\[[^\]]+\]/.test(swarmContextSection.content.trim())) {
            pushEnvelopeSection(sections, 'Swarm Context', swarmContextSection.content);
            cursor = swarmContextSection.nextIndex;
        }

        const userRequestSection = extractNamedEnvelopeSection(lines, cursor, /^User request\s*[:\uFF1A]/i, [
            /^Current positions\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (userRequestSection) {
            pushEnvelopeSection(sections, 'User request', userRequestSection.content);
            cursor = userRequestSection.nextIndex;
        }

        const positionsSection = extractNamedEnvelopeSection(lines, cursor, /^Current positions\s*[:\uFF1A]/i, [
            /^Peer reviews\s*[:\uFF1A]/i,
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (positionsSection) {
            pushEnvelopeSection(sections, 'Current positions', positionsSection.content);
            cursor = positionsSection.nextIndex;
        }

        const peerReviewsSection = extractNamedEnvelopeSection(lines, cursor, /^Peer reviews\s*[:\uFF1A]/i, [
            /^Requirements?\s*[:\uFF1A]/i
        ]);
        if (peerReviewsSection) {
            pushEnvelopeSection(sections, 'Peer reviews', peerReviewsSection.content);
            cursor = peerReviewsSection.nextIndex;
        }

        const remainder = lines.slice(cursor).join('\n').trim();
        if (remainder) {
            const fallbackSections = collectInputEnvelopeSections(remainder);
            if (fallbackSections.length > 0) {
                fallbackSections.forEach(section => pushEnvelopeSection(sections, section.title, section.content));
            } else {
                pushEnvelopeSection(sections, 'Additional Context', remainder);
            }
        }

        return sections;
    }

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

    function extractNamedEnvelopeSection(lines, startIndex, headingPattern, stopPatterns) {
        for (let index = startIndex; index < lines.length; index += 1) {
            const line = lines[index];
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            if (!headingPattern.test(trimmed)) {
                return null;
            }

            const inlineContent = trimmed.replace(headingPattern, '').trim();
            const bodyLines = [];
            if (inlineContent) {
                bodyLines.push(inlineContent);
            }

            let cursor = index + 1;
            let activeFence = null;
            while (cursor < lines.length) {
                const candidate = lines[cursor];
                const candidateTrimmed = candidate.trim();
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

    function extractLeadingEnvelopeBlock(lines, startIndex, stopPattern) {
        let cursor = startIndex;
        const bodyLines = [];
        let activeFence = null;

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

    function collectInputEnvelopeSections(content) {
        const sections = [];
        const leadingLines = [];
        const lines = String(content || '').split(/\r?\n/);
        let current = null;
        let activeFence = null;

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

        for (const rawLine of lines) {
            const trimmed = String(rawLine || '').trim();
            const heading = activeFence ? null : detectInputEnvelopeHeading(rawLine);
            if (heading) {
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

            if (current) {
                current.lines.push(rawLine);
            } else {
                leadingLines.push(rawLine);
            }

            activeFence = updateEnvelopeFenceState(activeFence, trimmed);
        }

        pushCurrent();

        const leadingContent = leadingLines.join('\n').trim();
        if (leadingContent) {
            sections.unshift({
                title: 'Context',
                content: leadingContent
            });
        }

        return sections;
    }

    function updateEnvelopeFenceState(activeFence, trimmedLine) {
        const match = String(trimmedLine || '').match(/^(`{3,}|~{3,})/);
        if (!match) {
            return activeFence;
        }

        const fenceType = match[1].charAt(0);
        if (!activeFence) {
            return fenceType;
        }

        return activeFence === fenceType ? null : activeFence;
    }

    function detectInputEnvelopeHeading(rawLine) {
        const trimmed = String(rawLine || '').trim();
        if (!trimmed || trimmed.startsWith('```')) {
            return null;
        }

        const hashHeadingMatch = trimmed.match(/^#{1,6}\s*(.+?)\s*[:\uFF1A]?\s*$/);
        if (hashHeadingMatch) {
            return {
                title: hashHeadingMatch[1].trim(),
                inlineContent: ''
            };
        }

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

    function renderUserInputEnvelope(parsed) {
        const requestHtml = `
            <div class="user-input-request">
                <div class="user-input-title">User request</div>
                <div class="message-content">${formatContent(parsed.userRequest)}</div>
            </div>
        `;

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

    function describeInputEnvelopeSection(content) {
        const text = String(content || '');
        const lineCount = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
        if (lineCount > 1) {
            return `${lineCount} lines`;
        }

        return `${text.length} chars`;
    }

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

    function getUserInputToggleLabel(showRaw) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return showRaw ? t('input.showRendered') : t('input.showRaw');
    }

    function toggleUserInputEnvelopeRaw(trigger) {
        const container = trigger.closest('[data-user-input-envelope]');
        if (!container) {
            return;
        }

        const renderedView = container.querySelector('.user-input-rendered-view');
        const rawView = container.querySelector('.user-input-raw-view');
        const nextShowRaw = container.getAttribute('data-show-raw') !== 'true';

        container.setAttribute('data-show-raw', nextShowRaw ? 'true' : 'false');
        renderedView?.classList.toggle('hidden', nextShowRaw);
        rawView?.classList.toggle('hidden', !nextShowRaw);
        trigger.textContent = getUserInputToggleLabel(nextShowRaw);
    }

    function renderStructuredMessage(msg) {
        const parts = Array.isArray(msg.parts) ? msg.parts : [];
        const fallbackContent = getDisplayContent(msg);

        if (msg.role === 'tool') {
            return renderToolMessage(msg, parts);
        }

        const thinkingParts = parts.filter(part => part.type === 'thinking');
        const textParts = parts.filter(part => part.type === 'text');
        const toolCalls = parts.filter(part => part.type === 'toolCall');
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
        const toolCallsHtml = toolCalls.length > 0
            ? `
                <div class="tool-call-list">
                    ${toolCalls.map(toolCall => `
                        <details class="tool-card tool-card-pending"${buildToolCardDataAttributes(toolCall.id, toolCall.name)}>
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
        const textContent = textParts.map(part => part.text).join('');
        const hasStructuredNonTextContent = thinkingParts.length > 0 || toolCalls.length > 0;
        const mainContent = textContent || (hasStructuredNonTextContent ? '' : fallbackContent);

        return `
            ${thinkingHtml}
            ${toolCallsHtml}
            ${mainContent ? `<div class="message-content">${formatContent(mainContent)}</div>` : ''}
        `;
    }

