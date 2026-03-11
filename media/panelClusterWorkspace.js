// OpenClaw Luna - Panel Cluster Workspace
'use strict';

    function renderClusters(clusters) {
        const previousClustersById = new Map((Array.isArray(state.clusters) ? state.clusters : []).map(cluster => [cluster.id, cluster]));
        state.clusters = Array.isArray(clusters)
            ? clusters.map(cluster => mergeClusterState(previousClustersById.get(cluster.id), cluster))
            : [];

        if (state.currentClusterId && !state.clusters.some(cluster => cluster.id === state.currentClusterId)) {
            state.currentClusterId = null;
        }

        if (!state.currentClusterId && state.clusters.length > 0) {
            state.currentClusterId = state.clusters[0].id;
        }

        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();

        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        updateTaskFormFields();
        renderConsoleOverview();
    }

    function renderClusterSidebarList(clusters) {
        if (!elements.clusterSidebarList) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!Array.isArray(clusters) || clusters.length === 0) {
            elements.clusterSidebarList.innerHTML = `<div class="cluster-sidebar-empty">${escapeHtml(t('clusters.emptySidebar'))}</div>`;
            return;
        }

        elements.clusterSidebarList.innerHTML = clusters.map(cluster => `
            <div class="cluster-sidebar-item ${cluster.id === state.currentClusterId ? 'active' : ''}" data-sidebar-cluster-id="${escapeHtml(cluster.id)}" title="${escapeHtml(cluster.name)}">
                <span class="cluster-sidebar-icon">&#128421;</span>
                <div class="cluster-sidebar-info">
                    <div class="cluster-sidebar-name">${escapeHtml(cluster.name)}</div>
                    <div class="cluster-sidebar-meta">${escapeHtml(t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</div>
                </div>
            </div>
        `).join('');
    }

    function renderClusterWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        const hasCluster = Boolean(cluster);

        elements.clusterEmptyState?.classList.toggle('hidden', hasCluster);
        elements.clusterWorkspace?.classList.toggle('hidden', !hasCluster);

        if (!cluster) {
            if (elements.clusterMessages) {
                elements.clusterMessages.innerHTML = `<div class="cluster-empty-conversation">${escapeHtml(t('clusters.emptyWorkspace'))}</div>`;
            }
            if (elements.clusterBriefing) {
                elements.clusterBriefing.textContent = '';
                elements.clusterBriefing.classList.add('hidden');
            }
            if (elements.clusterTargetTabs) {
                elements.clusterTargetTabs.innerHTML = '';
            }
            if (elements.clusterModeTabs) {
                elements.clusterModeTabs.innerHTML = '';
                elements.clusterModeTabs.classList.add('hidden');
            }
            if (elements.clusterMessageInput) {
                elements.clusterMessageInput.disabled = true;
            }
            if (elements.btnSendCluster) {
                elements.btnSendCluster.disabled = true;
            }
            if (elements.clusterTargetHint) {
                elements.clusterTargetHint.textContent = '';
            }
            if (elements.btnDeleteCurrentCluster) {
                elements.btnDeleteCurrentCluster.disabled = true;
            }
            if (elements.btnAddClusterAgent) {
                elements.btnAddClusterAgent.disabled = true;
            }
            if (elements.btnRemoveClusterAgent) {
                elements.btnRemoveClusterAgent.disabled = true;
            }
            if (elements.btnEditCluster) {
                elements.btnEditCluster.disabled = true;
            }
            if (elements.clusterWorkmodeSummary) {
                elements.clusterWorkmodeSummary.innerHTML = '';
            }
            return;
        }

        if (elements.clusterTitle) {
            elements.clusterTitle.textContent = cluster.name;
        }
        if (elements.clusterBriefing) {
            const briefing = String(getClusterWorkModeConfig(cluster).briefing || '').trim();
            elements.clusterBriefing.textContent = briefing;
            elements.clusterBriefing.classList.toggle('hidden', !briefing);
        }
        if (elements.clusterSubtitle) {
            elements.clusterSubtitle.textContent = t('clusters.subtitle', {
                count: cluster.agentIds.length,
                status: resolveClusterStatusLabel(cluster.status)
            });
        }
        if (elements.btnAddClusterAgent) {
            elements.btnAddClusterAgent.disabled = getAvailableAgentsForCluster(cluster).length === 0;
        }
        if (elements.btnRemoveClusterAgent) {
            elements.btnRemoveClusterAgent.disabled = cluster.agentIds.length <= 1;
        }
        if (elements.btnDeleteCurrentCluster) {
            elements.btnDeleteCurrentCluster.disabled = false;
        }
        if (elements.btnEditCluster) {
            elements.btnEditCluster.disabled = false;
        }
        renderClusterWorkmodeSummary(cluster);

        renderClusterTargetTabs(cluster);
        renderClusterModeTabs();
        renderCurrentClusterConversation();
        updateClusterInputState(cluster);
    }

    function renderClusterTargetTabs(cluster) {
        if (!elements.clusterTargetTabs) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const items = [
            `
                <button class="cluster-target-tab ${state.currentClusterTargetKind === 'swarm' ? 'active' : ''}" type="button" data-cluster-target-kind="swarm">
                    <span>${escapeHtml(t('clusters.targetSwarm'))}</span>
                    <span class="cluster-target-count">${escapeHtml(t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</span>
                </button>
            `
        ];

        cluster.agentIds.forEach(agentId => {
            items.push(`
                <button
                    class="cluster-target-tab ${state.currentClusterTargetKind === 'agent' && state.currentClusterAgentId === agentId ? 'active' : ''}"
                    type="button"
                    data-cluster-target-kind="agent"
                    data-cluster-agent-id="${escapeHtml(agentId)}"
                >
                    <span>${escapeHtml(resolveClusterAgentLabel(agentId))}</span>
                </button>
            `);
        });

        elements.clusterTargetTabs.innerHTML = items.join('');
    }

    function renderClusterModeTabs() {
        if (!elements.clusterModeTabs) {
            return;
        }

        if (state.currentClusterTargetKind !== 'swarm') {
            elements.clusterModeTabs.innerHTML = '';
            elements.clusterModeTabs.classList.add('hidden');
            return;
        }

        elements.clusterModeTabs.classList.remove('hidden');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        elements.clusterModeTabs.innerHTML = ['broadcast', 'collaborate'].map(mode => `
            <button
                class="cluster-mode-tab ${state.currentClusterSwarmMode === mode ? 'active' : ''}"
                type="button"
                data-cluster-mode="${mode}"
            >
                ${escapeHtml(t(mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate'))}
            </button>
        `).join('');
    }

    function renderCurrentClusterConversation() {
        if (!elements.clusterMessages) {
            return;
        }

        const cluster = getCurrentCluster();
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            elements.clusterMessages.innerHTML = `<div class="cluster-empty-conversation">${escapeHtml(t('clusters.emptyWorkspace'))}</div>`;
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);

        if (conversation.loading) {
            elements.clusterMessages.innerHTML = `
                <div class="context-loading">
                    <div class="context-loading-spinner"></div>
                    <span class="context-loading-text">${escapeHtml(t('common.loading'))}</span>
                </div>
            `;
            return;
        }

        const sections = [];
        if (conversation.messages.length === 0 && !conversation.pending) {
            sections.push(`<div class="cluster-empty-conversation">${escapeHtml(getClusterEmptyConversationCopy(cluster, target))}</div>`);
        } else {
            sections.push(buildClusterConversationEntries(conversation.messages).map(renderClusterConversationEntry).join(''));
        }

        if (conversation.pending) {
            sections.push(renderClusterPendingMessage(target));
        }

        elements.clusterMessages.innerHTML = sections.join('');
        scrollClusterToBottom();
    }

    function buildClusterConversationEntries(messages) {
        const entries = [];
        const sanitizedMessages = sanitizeClusterConversationMessages(messages);

        sanitizedMessages.forEach(msg => {
            if (!msg || shouldHideMessage(msg)) {
                return;
            }

            if (msg.role === 'user') {
                entries.push({
                    kind: 'message',
                    message: msg
                });
                return;
            }

            if (shouldAppendToTrace(msg)) {
                const currentEntry = entries[entries.length - 1];
                const shouldReuseTraceEntry = currentEntry?.kind === 'trace'
                    && currentEntry.displayName === (msg.displayName || '')
                    && currentEntry.contextLabel === (msg.contextLabel || '');

                if (shouldReuseTraceEntry) {
                    currentEntry.messages.push(msg);
                    return;
                }

                entries.push({
                    kind: 'trace',
                    displayName: msg.displayName || '',
                    contextLabel: msg.contextLabel || '',
                    messages: [msg]
                });
                return;
            }

            entries.push({
                kind: 'message',
                message: msg
            });
        });

        return entries;
    }

    function sanitizeClusterConversationMessages(messages) {
        const source = Array.isArray(messages) ? messages : [];
        const resolvedToolKeys = new Set();

        source.forEach(msg => {
            if (!msg) {
                return;
            }

            if (msg.role === 'tool') {
                resolvedToolKeys.add(getClusterToolKey(msg.toolCallId, msg.toolName));
                return;
            }

            if (!Array.isArray(msg.parts)) {
                return;
            }

            msg.parts
                .filter(part => part.type === 'toolResult')
                .forEach(part => resolvedToolKeys.add(getClusterToolKey(part.toolCallId, part.name)));
        });

        return source
            .map(msg => stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys))
            .filter(msg => {
                if (msg?.role !== 'tool') {
                    return true;
                }

                const toolKey = getClusterToolKey(msg.toolCallId, msg.toolName);
                return !source.some(other =>
                    other?.role === 'assistant'
                    && Array.isArray(other.parts)
                    && other.parts.some(part =>
                        part.type === 'toolResult'
                        && getClusterToolKey(part.toolCallId, part.name) === toolKey
                    )
                );
            });
    }

    function stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys) {
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.parts)) {
            return msg;
        }

        const nextParts = msg.parts.filter(part => {
            if (part.type !== 'toolCall') {
                return true;
            }

            return !resolvedToolKeys.has(getClusterToolKey(part.id, part.name));
        });

        return nextParts.length === msg.parts.length
            ? msg
            : {
                ...msg,
                parts: nextParts
            };
    }

    function getClusterToolKey(toolCallId, toolName) {
        return `${normalizeToolCallId(toolCallId)}::${normalizeToolName(toolName || 'tool')}`;
    }

    function renderClusterConversationEntry(entry) {
        if (!entry) {
            return '';
        }

        if (entry.kind === 'trace') {
            return renderClusterTraceEntry(entry);
        }

        return renderClusterStandaloneMessage(entry.message);
    }

    function renderClusterStandaloneMessage(msg) {
        if (!msg || shouldHideMessage(msg)) {
            return '';
        }

        const role = msg.role || 'assistant';
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const badge = msg.contextLabel ? `<span class="cluster-status-pill">${escapeHtml(msg.contextLabel)}</span>` : '';

        return `
            <div class="message message-${escapeHtml(role)}">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getMessageRoleLabel(msg))}</span>
                    ${badge}
                    ${time ? `<span class="message-time">${time}</span>` : ''}
                    ${tokenInfo}
                </div>
                ${renderMessageContent(msg)}
            </div>
        `;
    }

    function renderClusterTraceEntry(entry) {
        const headerMessage = entry.messages[0];
        const time = headerMessage?.timestamp ? new Date(headerMessage.timestamp).toLocaleTimeString() : '';
        const body = entry.messages.map(msg => `
            <div class="trace-segment trace-segment-${escapeHtml(msg.role || 'assistant')}">
                ${msg.role === 'tool' ? renderToolMessage(msg, Array.isArray(msg.parts) ? msg.parts : []) : renderMessageContent(msg)}
            </div>
        `).join('');

        return `
            <div class="message message-assistant message-trace">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getMessageRoleLabel(headerMessage))}</span>
                    ${entry.contextLabel ? `<span class="cluster-status-pill">${escapeHtml(entry.contextLabel)}</span>` : ''}
                    ${time ? `<span class="message-time">${time}</span>` : ''}
                </div>
                <div class="trace-body">${body}</div>
            </div>
        `;
    }

    function renderClusterPendingMessage(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return `
            <div class="message message-thinking thinking-indicator">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getClusterPendingLabel(target))}</span>
                    <span class="thinking-dots">
                        <span></span><span></span><span></span>
                    </span>
                </div>
                <div class="thinking-content">
                    <div class="thinking-line">${escapeHtml(t('thinking.processing'))}</div>
                </div>
            </div>
        `;
    }

    function updateClusterInputState(cluster) {
        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        const disabled = !cluster || conversation.loading || conversation.pending;

        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.disabled = disabled;
            elements.clusterMessageInput.placeholder = getClusterInputPlaceholder(cluster, target);
        }

        if (elements.btnSendCluster) {
            elements.btnSendCluster.disabled = disabled;
        }

        if (elements.btnStopCluster) {
            const canStop = Boolean(cluster) && (conversation.loading || conversation.pending);
            elements.btnStopCluster.classList.toggle('hidden', !canStop);
            elements.btnStopCluster.disabled = !canStop;
        }

        if (elements.clusterTargetHint) {
            elements.clusterTargetHint.textContent = getClusterTargetHint(cluster, target);
        }
    }

    function selectCluster(clusterId, options = {}) {
        const { notify = true } = options;
        state.currentClusterId = clusterId;
        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        applyView('clusters');

        if (notify) {
            vscode.postMessage({ type: 'switchView', view: 'clusters', clusterId });
        }
    }

    function selectClusterTarget(targetKind, agentId) {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        if (targetKind === 'agent' && agentId) {
            state.currentClusterTargetKind = 'agent';
            state.currentClusterAgentId = agentId;

            const conversation = ensureClusterConversation(getClusterConversationKey(cluster.id, {
                targetKind: 'agent',
                agentId
            }));

            if (!conversation.loaded && !conversation.loading) {
                conversation.loading = true;
                renderClusterWorkspace();
                vscode.postMessage({
                    type: 'loadClusterAgentMessages',
                    clusterId: cluster.id,
                    agentId
                });
                return;
            }
        } else {
            state.currentClusterTargetKind = 'swarm';
        }

        renderClusterWorkspace();
    }

    function selectClusterSwarmMode(mode) {
        if (mode !== 'broadcast' && mode !== 'collaborate') {
            return;
        }

        state.currentClusterSwarmMode = mode;
        renderClusterWorkspace();
    }

    function promptBroadcastToCluster(clusterId) {
        vscode.postMessage({
            type: 'promptBroadcastToCluster',
            clusterId
        });
    }

    function promptCollaborateCluster(clusterId) {
        vscode.postMessage({
            type: 'promptCollaborateCluster',
            clusterId
        });
    }

    function deleteCluster(clusterId) {
        vscode.postMessage({
            type: 'deleteCluster',
            clusterId
        });
    }

    function renderSwarmResults() {
        if (!state.lastSwarmRun) {
            return '';
        }

        if (state.lastSwarmRun.kind === 'collaboration') {
            return renderCollaborationResults(state.lastSwarmRun.result);
        }

        return renderBroadcastResults(state.lastSwarmRun.clusterId, state.lastSwarmRun.responses);
    }

    function renderBroadcastResults(clusterId, responses) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const cluster = state.clusters.find(item => item.id === clusterId);
        const entries = Object.values(responses || {});
        if (entries.length === 0) {
            return '';
        }

        return `
            <div class="broadcast-results">
                <h4>${t('clusters.resultsTitle') || 'Broadcast Results'}${cluster ? ` · ${escapeHtml(cluster.name)}` : ''}</h4>
                ${entries.map(entry => `
                    <div class="broadcast-result-item">
                        <div class="message-header">
                            <span class="message-role">${escapeHtml(resolveAgentLabel(entry.agentId))}</span>
                            <span class="message-time">${entry.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                        </div>
                        <div class="message-content">
                            ${entry.ok && entry.message
                                ? formatContent(entry.message.content || '')
                                : `<p>${escapeHtml(entry.error || (t('clusters.resultUnknownError') || 'Unknown error'))}</p>`}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderCollaborationResults(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        if (!result) {
            return '';
        }

        const cluster = state.clusters.find(item => item.id === result.clusterId);
        const clusterName = cluster?.name || result.clusterName || '';
        const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
            ? result.rounds
            : [{
                kind: 'revision-2',
                entries: result.contributions || {}
            }];
        const finalAnswerHtml = result.synthesis?.ok && result.synthesis.message
            ? formatContent(result.synthesis.message.content || '')
            : `<p>${escapeHtml(result.synthesis?.error || (t('clusters.noSuccessfulAgents') || 'No agent produced a usable contribution.'))}</p>`;
        const roundsHtml = rounds.map(round => {
            const roundAgentIds = (cluster?.agentIds || Object.keys(round.entries || {}))
                .filter(agentId => round.entries?.[agentId]);
            if (roundAgentIds.length === 0) {
                return '';
            }

            return `
                <h4>${escapeHtml(getCollaborationRoundLabel(round.kind, t))}</h4>
                ${roundAgentIds.map(agentId => {
                    const entry = round.entries[agentId];
                    return `
                        <div class="broadcast-result-item">
                            <div class="message-header">
                                <span class="message-role">${escapeHtml(resolveAgentLabel(agentId))}</span>
                                <span class="message-time">${entry.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                            </div>
                            <div class="message-content">
                                ${entry.ok && entry.message
                                    ? formatContent(entry.message.content || '')
                                    : `<p>${escapeHtml(entry.error || (t('clusters.resultUnknownError') || 'Unknown error'))}</p>`}
                            </div>
                        </div>
                    `;
                }).join('')}
            `;
        }).join('');
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : '—';

        return `
            <div class="broadcast-results">
                <h4>${t('clusters.collaborationTitle') || 'Swarm Collaboration'}${clusterName ? ` · ${escapeHtml(clusterName)}` : ''}</h4>
                <div class="broadcast-result-item">
                    <div class="message-header">
                        <span class="message-role">${t('clusters.coordinator') || 'Coordinator'}: ${escapeHtml(coordinatorLabel)}</span>
                        <span class="message-time">${result.synthesis?.ok ? (t('clusters.resultOk') || 'Completed') : (t('clusters.resultFailed') || 'Failed')}</span>
                    </div>
                    <div class="message-header">
                        <span class="message-role">${t('clusters.finalAnswer') || 'Final Answer'}</span>
                    </div>
                    <div class="message-content">${finalAnswerHtml}</div>
                </div>
                <h4>${getTranslationOrFallback(t, 'clusters.debateRounds', 'Debate Rounds')}</h4>
                ${roundsHtml}
            </div>
        `;
    }

    function getTranslationOrFallback(t, key, fallback) {
        const translated = t(key);
        return translated && translated !== key ? translated : fallback;
    }

