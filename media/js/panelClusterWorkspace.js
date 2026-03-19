// OpenClaw Luna - Panel Cluster Workspace
'use strict';

    function renderClusters(clusters) {
        const previousClustersById = new Map((Array.isArray(state.clusters) ? state.clusters : []).map(cluster => [cluster.id, cluster]));
        state.serverClusters = Array.isArray(clusters) ? [...clusters] : [];
        state.clusters = getMergedClusterList(state.serverClusters)
            .map(cluster => mergeClusterState(previousClustersById.get(cluster.id), cluster));

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
            <div class="cluster-sidebar-item ${cluster.id === state.currentClusterId ? 'active' : ''}${isReplayCluster(cluster) ? ' is-replay' : ''}" data-sidebar-cluster-id="${escapeHtml(cluster.id)}" title="${escapeHtml(cluster.name)}">
                <span class="cluster-sidebar-icon">&#128421;</span>
                <div class="cluster-sidebar-info">
                    <div class="cluster-sidebar-name">
                        ${escapeHtml(cluster.name)}
                        ${isReplayCluster(cluster) ? `<span class="cluster-sidebar-replay">${escapeHtml(t('clusters.replayTag'))}</span>` : ''}
                    </div>
                    <div class="cluster-sidebar-meta">${escapeHtml(isReplayCluster(cluster)
                        ? t('clusters.replaySidebarMeta', { count: cluster.agentIds.length })
                        : t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</div>
                </div>
            </div>
        `).join('');
    }

    function renderClusterWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        const hasCluster = Boolean(cluster);
        const replay = cluster ? getClusterReplay(cluster) : null;
        const isReplay = Boolean(replay);

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
            if (elements.clusterReplayBanner) {
                elements.clusterReplayBanner.textContent = '';
                elements.clusterReplayBanner.classList.add('hidden');
            }
            if (elements.btnClearClusterReplay) {
                elements.btnClearClusterReplay.classList.add('hidden');
            }
            if (elements.clusterModeTabs) {
                elements.clusterModeTabs.innerHTML = '';
                elements.clusterModeTabs.classList.add('hidden');
            }
            if (elements.clusterOutputModeTabs) {
                elements.clusterOutputModeTabs.innerHTML = '';
                elements.clusterOutputModeTabs.classList.add('hidden');
            }
            if (elements.clusterTopology) {
                elements.clusterTopology.innerHTML = '';
            }
            renderClusterTopSection(null);
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
            if (elements.btnExportClusterReadableContext) {
                elements.btnExportClusterReadableContext.disabled = true;
            }
            if (elements.btnExportClusterRawContext) {
                elements.btnExportClusterRawContext.disabled = true;
            }
            if (elements.btnExportClusterSwarm) {
                elements.btnExportClusterSwarm.disabled = true;
            }
            if (elements.clusterWorkmodeSummary) {
                elements.clusterWorkmodeSummary.innerHTML = '';
            }
            return;
        }

        if (elements.clusterTitle) {
            elements.clusterTitle.textContent = cluster.name;
        }
        renderClusterTopSection(cluster);
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
            elements.btnAddClusterAgent.disabled = isReplay || getAvailableAgentsForCluster(cluster).length === 0;
        }
        if (elements.btnRemoveClusterAgent) {
            elements.btnRemoveClusterAgent.disabled = isReplay || cluster.agentIds.length <= 1;
        }
        if (elements.btnDeleteCurrentCluster) {
            elements.btnDeleteCurrentCluster.disabled = isReplay;
        }
        if (elements.btnEditCluster) {
            elements.btnEditCluster.disabled = isReplay;
        }
        if (elements.btnExportClusterReadableContext) {
            elements.btnExportClusterReadableContext.disabled = isReplay;
        }
        if (elements.btnExportClusterRawContext) {
            elements.btnExportClusterRawContext.disabled = isReplay;
        }
        if (elements.btnExportClusterSwarm) {
            elements.btnExportClusterSwarm.disabled = isReplay;
        }
        if (elements.clusterReplayBanner) {
            elements.clusterReplayBanner.textContent = isReplay ? getClusterReplayBannerText(cluster) : '';
            elements.clusterReplayBanner.classList.toggle('hidden', !isReplay);
        }
        if (elements.btnClearClusterReplay) {
            elements.btnClearClusterReplay.classList.toggle('hidden', !isReplay);
        }
        renderClusterWorkmodeSummary(cluster);

        renderClusterTargetTabs(cluster);
        renderClusterModeTabs();
        renderClusterOutputModeTabs();
        ensureCurrentClusterConversationLoaded(cluster);
        renderClusterTopology(cluster);
        renderCurrentClusterConversation();
        updateClusterInputState(cluster);
    }

    function renderClusterTopSection(cluster) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const modeLabel = cluster
            ? t(state.currentClusterSwarmMode === 'collaborate' ? 'clusters.collaborate' : 'clusters.broadcast')
            : t('clusters.broadcast');
        const title = cluster?.name || 'Cluster';
        const statusLabel = cluster ? resolveClusterStatusLabel(cluster.status) : 'Inactive';
        const countLabel = cluster
            ? t('clusterTree.agentsCount', { count: cluster.agentIds.length })
            : t('clusterTree.agentsCount', { count: 0 });
        const collapsed = Boolean(state.clusterTopSectionCollapsed);

        if (elements.clusterTopSectionCollapsedTitle) {
            elements.clusterTopSectionCollapsedTitle.textContent = title;
        }
        if (elements.clusterTopSectionCollapsedMode) {
            elements.clusterTopSectionCollapsedMode.textContent = modeLabel;
        }
        if (elements.clusterTopSectionCollapsedCount) {
            elements.clusterTopSectionCollapsedCount.textContent = countLabel;
        }
        if (elements.clusterTopSectionCollapsedStatus) {
            elements.clusterTopSectionCollapsedStatus.textContent = statusLabel;
        }
        updateClusterTopSectionToggle(elements.btnToggleClusterTopSection, collapsed);
        updateClusterTopSectionToggle(elements.btnToggleClusterTopSectionCollapsed, collapsed);
        applyClusterTopSectionCollapsedState(collapsed);
    }

    function updateClusterTopSectionToggle(button, collapsed) {
        if (!button) {
            return;
        }

        const label = collapsed ? 'Expand' : 'Collapse';
        const title = collapsed ? 'Expand swarm header' : 'Collapse swarm header';
        const icon = collapsed ? '&#9654;' : '&#9660;';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.setAttribute('title', title);

        const iconElement = button.querySelector('.cluster-section-toggle-icon');
        if (iconElement) {
            iconElement.innerHTML = icon;
        }

        const labelElement = button.querySelector('.cluster-section-toggle-label');
        if (labelElement) {
            labelElement.textContent = label;
        }
    }

    function applyClusterTopSectionCollapsedState(collapsed) {
        const topSection = elements.clusterTopSection;
        const collapsedBar = elements.clusterTopSectionCollapsedBar;
        const body = elements.clusterTopSectionBody;
        if (!topSection || !collapsedBar || !body) {
            return;
        }

        const wasInitialized = topSection.dataset.initialized === 'true';
        const previousCollapsed = topSection.dataset.collapsed === 'true';
        topSection.dataset.collapsed = collapsed ? 'true' : 'false';
        topSection.classList.toggle('collapsed', collapsed);
        collapsedBar.classList.toggle('hidden', !collapsed);

        if (!wasInitialized) {
            topSection.dataset.initialized = 'true';
            body.style.height = collapsed ? '0px' : '';
            body.classList.toggle('is-collapsed', collapsed);
            body.style.overflow = collapsed ? 'hidden' : '';
            return;
        }

        if (previousCollapsed === collapsed) {
            return;
        }

        animateClusterTopSectionBody(body, collapsed);
    }

    function animateClusterTopSectionBody(body, collapsed) {
        const endHeight = collapsed ? 0 : body.scrollHeight;
        const startHeight = collapsed ? body.scrollHeight : 0;

        body.classList.remove('is-collapsed');
        body.style.overflow = 'hidden';
        body.style.height = `${startHeight}px`;
        body.getBoundingClientRect();

        requestAnimationFrame(() => {
            body.style.height = `${endHeight}px`;
        });

        const handleTransitionEnd = (event) => {
            if (event.target !== body || event.propertyName !== 'height') {
                return;
            }

            body.removeEventListener('transitionend', handleTransitionEnd);
            body.classList.toggle('is-collapsed', collapsed);
            body.style.overflow = collapsed ? 'hidden' : '';
            body.style.height = collapsed ? '0px' : '';
        };

        body.addEventListener('transitionend', handleTransitionEnd);
    }

    function renderClusterTopology(cluster) {
        if (!elements.clusterTopology) {
            return;
        }

        if (!cluster) {
            elements.clusterTopology.innerHTML = '';
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const target = getCurrentClusterTargetInfo(cluster);
        const coordinatorInfo = typeof resolveClusterCoordinatorInfo === 'function'
            ? resolveClusterCoordinatorInfo(cluster)
            : { agentId: cluster.agentIds[0] || '', isAuto: true };
        const topologyMode = resolveClusterTopologyMode(target);
        const topologyPlan = buildClusterTopologyPlan(cluster, topologyMode);
        const latencyByAgentId = buildClusterSwarmLatencyMap(cluster, target);
        const modeLabel = target.kind === 'swarm'
            ? (window.OpenClawI18n ? window.OpenClawI18n.t(target.mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate') : target.mode)
            : (window.OpenClawI18n ? window.OpenClawI18n.t(
                target.agentViewMode === 'chat'
                    ? 'clusters.agentViewChat'
                    : target.agentViewMode === 'broadcast'
                        ? 'clusters.agentViewBroadcast'
                        : 'clusters.agentViewCollaborate'
            ) : target.agentViewMode);
        const collapsed = Boolean(state.clusterTopologyCollapsed);
        const toggleLabel = collapsed ? 'Expand topology view' : 'Collapse topology view';
        const toggleSymbol = collapsed ? '&#9654;' : '&#9660;';

        elements.clusterTopology.innerHTML = `
            <div class="cluster-topology-card${collapsed ? ' collapsed' : ''}">
                <div class="cluster-topology-head">
                    <div class="cluster-topology-heading">
                        <button
                            class="cluster-topology-toggle"
                            type="button"
                            data-cluster-topology-toggle
                            aria-expanded="${collapsed ? 'false' : 'true'}"
                            title="${escapeHtml(toggleLabel)}"
                        >
                            <span class="cluster-topology-toggle-icon" aria-hidden="true">${toggleSymbol}</span>
                            <span class="cluster-topology-toggle-copy">
                                <span class="cluster-topology-eyebrow">Topology View</span>
                                <span class="cluster-topology-title">${escapeHtml(cluster.name)}</span>
                            </span>
                        </button>
                    </div>
                    <span class="cluster-topology-mode">${escapeHtml(modeLabel)}</span>
                </div>
                <div class="cluster-topology-graph${collapsed ? ' hidden' : ''}">
                    <svg class="cluster-topology-connectors" aria-hidden="true"></svg>
                    <div class="cluster-topology-summary">
                        ${renderClusterTopologySummary(topologyPlan.summary)}
                    </div>
                    <div class="cluster-topology-root${target.kind === 'swarm' ? ' active' : ''}" data-node-id="swarm-root">
                        <span class="cluster-topology-root-label">${escapeHtml(t('clusters.targetSwarm'))}</span>
                        <span class="cluster-topology-root-meta">${escapeHtml(t('clusterTree.agentsCount', { count: cluster.agentIds.length }))}</span>
                    </div>
                    <div class="cluster-topology-tree">
                        ${topologyPlan.rootNodes.length > 0
                            ? renderClusterTopologyTree(topologyPlan.rootNodes, cluster, target, coordinatorInfo, latencyByAgentId)
                            : `<div class="cluster-topology-empty">${escapeHtml(t('clusters.noneFound'))}</div>`}
                    </div>
                </div>
            </div>
        `;

        const graph = elements.clusterTopology.querySelector('.cluster-topology-graph');
        if (graph) {
            attachClusterTopologyScrollListener(graph);
        }

        scheduleClusterTopologyConnectorRender();
        ensureClusterTopologyConnectorObservers();
    }

    function renderClusterTargetTabs(cluster) {
        if (!elements.clusterTargetTabs) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (isReplayCluster(cluster)) {
            elements.clusterTargetTabs.innerHTML = `
                <button class="cluster-target-tab active" type="button" data-cluster-target-kind="swarm">
                    <span>${escapeHtml(t('clusters.targetSwarm'))}</span>
                    <span class="cluster-target-count">${escapeHtml(t('clusters.replayTag'))}</span>
                </button>
            `;
            return;
        }

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

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        if (cluster && isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            const mode = replay?.mode === 'collaborate' ? 'collaborate' : 'broadcast';
            elements.clusterModeTabs.classList.remove('hidden');
            elements.clusterModeTabs.innerHTML = `
                <button class="cluster-mode-tab active" type="button" data-cluster-mode="${escapeHtml(mode)}">
                    ${escapeHtml(t(mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate'))}
                </button>
            `;
            return;
        }

        elements.clusterModeTabs.classList.remove('hidden');
        if (state.currentClusterTargetKind === 'swarm') {
            elements.clusterModeTabs.innerHTML = ['broadcast', 'collaborate'].map(mode => `
                <button
                    class="cluster-mode-tab ${state.currentClusterSwarmMode === mode ? 'active' : ''}"
                    type="button"
                    data-cluster-mode="${mode}"
                >
                    ${escapeHtml(t(mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate'))}
                </button>
            `).join('');
            return;
        }

        elements.clusterModeTabs.innerHTML = ['chat', 'broadcast', 'collaborate'].map(mode => `
            <button
                class="cluster-mode-tab ${state.currentClusterAgentViewMode === mode ? 'active' : ''}"
                type="button"
                data-cluster-agent-view-mode="${mode}"
            >
                ${escapeHtml(t(
                    mode === 'chat'
                        ? 'clusters.agentViewChat'
                        : mode === 'broadcast'
                            ? 'clusters.agentViewBroadcast'
                            : 'clusters.agentViewCollaborate'
                ))}
            </button>
        `).join('');
    }

    function renderClusterOutputModeTabs() {
        if (!elements.clusterOutputModeTabs) {
            return;
        }

        const cluster = getCurrentCluster();
        const target = getCurrentClusterTargetInfo(cluster);
        if (!cluster || isReplayCluster(cluster) || target.kind !== 'swarm' || target.mode !== 'collaborate') {
            elements.clusterOutputModeTabs.classList.add('hidden');
            elements.clusterOutputModeTabs.innerHTML = '';
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const runOptions = getKnownSwarmConversationRuns(cluster.id, target.mode);
        const selectedRunId = target.swarmRunId || getSelectedSwarmConversationRunId(cluster.id, target.mode);
        elements.clusterOutputModeTabs.classList.remove('hidden');
        elements.clusterOutputModeTabs.innerHTML = `
            <div class="cluster-output-mode-strip">
                <div class="cluster-output-mode-buttons">
                    ${[
                        { value: 'frontend', label: t('clusters.frontendView') || 'Frontend View' },
                        { value: 'raw', label: t('clusters.rawSwarmLog') || 'Raw Log' }
                    ].map(option => `
                        <button
                            class="cluster-mode-tab ${state.currentClusterSwarmOutputMode === option.value ? 'active' : ''}"
                            type="button"
                            data-cluster-output-mode="${escapeHtml(option.value)}"
                        >
                            ${escapeHtml(option.label)}
                        </button>
                    `).join('')}
                </div>
                ${runOptions.length > 0 ? `
                    <label class="cluster-run-select-wrap">
                        <span class="cluster-run-select-label">${escapeHtml(t('clusters.runLabel') || 'Run')}</span>
                        <select class="cluster-run-select" data-cluster-swarm-run-select>
                            ${runOptions.map((runId, index) => {
                                const isActive = runId === getActiveSwarmConversationRunId(cluster.id, target.mode);
                                const label = isActive
                                    ? `${t('clusters.currentRun') || 'Current'} · ${shortenSwarmRunId(runId)}`
                                    : `${t('clusters.runLabel') || 'Run'} ${runOptions.length - index} · ${shortenSwarmRunId(runId)}`;
                                return `<option value="${escapeHtml(runId)}" ${runId === selectedRunId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                            }).join('')}
                        </select>
                    </label>
                ` : ''}
            </div>
        `;
    }

    function shortenSwarmRunId(runId) {
        const normalized = String(runId || '').trim();
        if (!normalized) {
            return '';
        }

        return normalized.length <= 18
            ? normalized
            : `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
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
            sections.push(
                isRawClusterSwarmView(target)
                    ? buildRawClusterConversationEntries(conversation.messages).map(renderClusterConversationEntry).join('')
                    : buildClusterConversationEntries(conversation.messages).map(renderClusterConversationEntry).join('')
            );
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

            if (shouldAppendToClusterTrace(msg)) {
                const currentEntry = entries[entries.length - 1];
                const batchKey = getClusterTraceBatchKey(msg);
                const shouldReuseTraceEntry = currentEntry?.kind === 'trace'
                    && currentEntry.displayName === (msg.displayName || '')
                    && currentEntry.contextLabel === (msg.contextLabel || '')
                    && currentEntry.batchKey === batchKey;

                if (shouldReuseTraceEntry) {
                    currentEntry.messages.push(msg);
                    return;
                }

                entries.push({
                    kind: 'trace',
                    displayName: msg.displayName || '',
                    contextLabel: msg.contextLabel || '',
                    batchKey,
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

    function buildRawClusterConversationEntries(messages) {
        return (Array.isArray(messages) ? messages : [])
            .filter(msg => msg && !shouldHideMessage(msg))
            .map(message => ({
                kind: 'message',
                message
            }));
    }

    function isRawClusterSwarmView(target) {
        return target?.kind === 'swarm'
            && target?.mode === 'collaborate'
            && target?.outputMode === 'raw';
    }

    function shouldAppendToClusterTrace(msg) {
        if (msg?.role === 'tool') {
            return true;
        }

        if (msg?.role !== 'assistant') {
            return false;
        }

        if (isBroadcastClusterMessage(msg)) {
            return hasStructuredClusterTraceContent(msg);
        }

        return Boolean(msg.displayName)
            || Boolean(msg.contextLabel)
            || hasStructuredClusterTraceContent(msg);
    }

    function getClusterTraceBatchKey(msg) {
        return String(msg?.metadata?.swarmBatchId || '');
    }

    function isBroadcastClusterMessage(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return (msg?.contextLabel || '') === t('clusters.broadcast');
    }

    function hasStructuredClusterTraceContent(msg) {
        if (isToolUseMessage(msg)) {
            return true;
        }

        return Array.isArray(msg?.parts)
            && msg.parts.some(part => part?.type === 'toolCall' || part?.type === 'toolResult');
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
        const latencyBadge = renderClusterLatencyBadge(getClusterMessageLatencyMs(msg));

        return `
            <div class="message message-${escapeHtml(role)}">
                <div class="message-header">
                    <span class="message-role">${escapeHtml(getMessageRoleLabel(msg))}</span>
                    ${badge}
                    ${latencyBadge}
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
        const latencyBadge = renderClusterLatencyBadge(getClusterMessageLatencyMs(headerMessage));
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
                    ${latencyBadge}
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

    function getClusterMessageLatencyMs(message) {
        const value = Number(message?.metadata?.swarmLatencyMs);
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    function formatClusterLatencySeconds(latencyMs) {
        const seconds = latencyMs / 1000;
        return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
    }

    function renderClusterLatencyBadge(latencyMs, className = '') {
        if (!Number.isFinite(latencyMs) || latencyMs < 0) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const label = `${t('clusters.latency')}: ${formatClusterLatencySeconds(latencyMs)}`;
        return `<span class="message-metric-badge${className ? ` ${escapeHtml(className)}` : ''}">${escapeHtml(label)}</span>`;
    }

    function buildClusterSwarmLatencyMap(cluster, target) {
        const mode = target?.kind === 'swarm'
            ? target.mode
            : (target?.agentViewMode === 'broadcast' || target?.agentViewMode === 'collaborate'
                ? target.agentViewMode
                : state.currentClusterSwarmMode);
        const conversation = ensureClusterConversation(getClusterConversationKey(cluster.id, {
            targetKind: 'swarm',
            mode
        }));
        const latencyByAgentId = new Map();

        (conversation.messages || []).forEach(message => {
            const latencyMs = getClusterMessageLatencyMs(message);
            if (!Number.isFinite(latencyMs)) {
                return;
            }

            const agentId = typeof message.agentId === 'string' && message.agentId.trim()
                ? message.agentId.trim()
                : '';
            if (agentId) {
                latencyByAgentId.set(agentId, latencyMs);
            }
        });

        return latencyByAgentId;
    }

    function getClusterReplayBannerText(cluster) {
        const replay = getClusterReplay(cluster);
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!replay?.cluster?.replayMeta) {
            return '';
        }

        return t('clusters.replayBanner', {
            source: replay.cluster.replayMeta.sourcePath || '-',
            exportedAt: replay.cluster.replayMeta.exportedAt || replay.cluster.replayMeta.importedAt || '-'
        });
    }

    function updateClusterInputState(cluster) {
        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        const readOnlyAgentLog = target.kind === 'agent' && target.agentViewMode !== 'chat';
        const disabled = !cluster || conversation.loading || conversation.pending || readOnlyAgentLog || isReplayCluster(cluster);

        if (elements.clusterMessageInput) {
            elements.clusterMessageInput.disabled = disabled;
            elements.clusterMessageInput.placeholder = getClusterInputPlaceholder(cluster, target);
        }

        if (elements.btnSendCluster) {
            elements.btnSendCluster.disabled = disabled;
        }

        if (elements.btnStopCluster) {
            const canStop = Boolean(cluster) && !readOnlyAgentLog && (conversation.loading || conversation.pending);
            elements.btnStopCluster.classList.toggle('hidden', !canStop);
            elements.btnStopCluster.disabled = !canStop;
        }

        if (elements.clusterTargetHint) {
            elements.clusterTargetHint.textContent = getClusterTargetHint(cluster, target);
        }
    }

    function ensureCurrentClusterConversationLoaded(cluster) {
        if (!cluster) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        if (conversation.loaded || conversation.loading) {
            return;
        }

        if (isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            conversation.messages = Array.isArray(replay?.messages) ? replay.messages : [];
            conversation.loading = false;
            conversation.loaded = true;
            conversation.pending = false;
            return;
        }

        conversation.loading = true;
        if (target.kind === 'swarm') {
            vscode.postMessage({
                type: 'loadClusterSwarmMessages',
                clusterId: cluster.id,
                mode: target.mode,
                outputMode: target.outputMode || 'frontend',
                swarmRunId: target.swarmRunId || undefined
            });
            return;
        }

        if (target.agentViewMode === 'chat') {
            vscode.postMessage({
                type: 'loadClusterAgentMessages',
                clusterId: cluster.id,
                agentId: target.agentId
            });
            return;
        }

        vscode.postMessage({
            type: 'loadClusterAgentSwarmMessages',
            clusterId: cluster.id,
            agentId: target.agentId,
            mode: target.agentViewMode
        });
    }

    function selectCluster(clusterId, options = {}) {
        const { notify = true } = options;
        state.currentClusterId = clusterId;
        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        applyView('clusters');

        if (notify && !isReplayCluster(clusterId)) {
            vscode.postMessage({ type: 'switchView', view: 'clusters', clusterId });
        }
    }

    function selectClusterTarget(targetKind, agentId) {
        const cluster = getCurrentCluster();
        if (cluster && isReplayCluster(cluster)) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            renderClusterWorkspace();
            return;
        }

        if (targetKind === 'agent' && agentId) {
            state.currentClusterTargetKind = 'agent';
            state.currentClusterAgentId = agentId;
            state.currentClusterAgentViewMode = state.currentClusterSwarmMode || 'collaborate';
        } else {
            state.currentClusterTargetKind = 'swarm';
        }

        renderClusterWorkspace();
    }

    function selectClusterSwarmMode(mode) {
        if (mode !== 'broadcast' && mode !== 'collaborate') {
            return;
        }

        const cluster = getCurrentCluster();
        if (cluster && isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            state.currentClusterSwarmMode = replay?.mode === 'collaborate' ? 'collaborate' : 'broadcast';
            state.currentClusterSwarmOutputMode = 'frontend';
            renderClusterWorkspace();
            return;
        }

        state.currentClusterSwarmMode = mode;
        if (mode !== 'collaborate') {
            state.currentClusterSwarmOutputMode = 'frontend';
        }
        renderClusterWorkspace();
    }

    function selectClusterSwarmOutputMode(outputMode) {
        if (!['frontend', 'raw'].includes(outputMode)) {
            return;
        }

        const cluster = getCurrentCluster();
        if (!cluster || isReplayCluster(cluster) || state.currentClusterTargetKind !== 'swarm' || state.currentClusterSwarmMode !== 'collaborate') {
            return;
        }

        state.currentClusterSwarmOutputMode = outputMode;
        renderClusterWorkspace();
    }

    function selectClusterSwarmRun(runId) {
        const cluster = getCurrentCluster();
        if (!cluster || isReplayCluster(cluster) || state.currentClusterTargetKind !== 'swarm') {
            return;
        }

        const normalizedRunId = String(runId || '').trim();
        if (!normalizedRunId) {
            return;
        }

        setSelectedSwarmConversationRunId(cluster.id, state.currentClusterSwarmMode, normalizedRunId);
        renderClusterWorkspace();
    }

    function selectClusterAgentViewMode(mode) {
        if (!['chat', 'broadcast', 'collaborate'].includes(mode)) {
            return;
        }

        if (isReplayCluster(getCurrentCluster())) {
            return;
        }

        state.currentClusterAgentViewMode = mode;
        renderClusterWorkspace();
    }

    function exportCurrentClusterConversation(exportKind) {
        const cluster = getCurrentCluster();
        if (!cluster || isReplayCluster(cluster)) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        vscode.postMessage({
            type: 'exportClusterConversation',
            clusterId: cluster.id,
            targetKind: target.kind,
            exportKind: exportKind === 'raw' ? 'raw' : 'readable',
            mode: target.mode,
            agentId: target.agentId,
            agentViewMode: target.agentViewMode
        });
    }

    function exportCurrentClusterSwarm() {
        const cluster = getCurrentCluster();
        if (!cluster || isReplayCluster(cluster)) {
            return;
        }
        vscode.postMessage({
            type: 'exportClusterSwarm',
            clusterId: cluster.id
        });
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
                descriptor: buildFallbackCollaborationRoundDescriptor('revision-2'),
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
                <h4>${escapeHtml(getCollaborationRoundLabel(round, t))}</h4>
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

    function renderClusterTopologyCoordinatorBadge(agentId, coordinatorInfo) {
        if (!coordinatorInfo?.agentId || coordinatorInfo.agentId !== agentId) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return `
            <span class="cluster-topology-node-badge is-coordinator">
                ${escapeHtml(t('clusters.topology.coordinator'))}
                ${coordinatorInfo.isAuto ? ` · ${escapeHtml(t('clusters.topology.coordinatorAuto'))}` : ''}
            </span>
        `;
    }

    function renderClusterTopologyActivationBadges(cluster, agentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const config = typeof getClusterWorkModeConfig === 'function' ? getClusterWorkModeConfig(cluster) : (cluster?.workspaceConfig || {});
        const profile = config?.memberProfiles?.[agentId] || {};
        const activation = typeof resolveClusterMemberActivation === 'function'
            ? resolveClusterMemberActivation(profile)
            : {
                swarmModes: ['broadcast', 'collaborate'],
                keywords: []
            };

        const badges = [];
        if (activation.swarmModes.length === 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(t('clusters.topology.sleeping'))}</span>`);
        } else if (activation.swarmModes.length === 1) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(activation.swarmModes[0] === 'broadcast' ? t('clusters.form.memberWakeBroadcast') : t('clusters.form.memberWakeCollaborate'))}</span>`);
        }

        if (activation.keywords.length > 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(`${t('clusters.topology.keywordRule')}: ${activation.keywords.join(', ')}`)}</span>`);
        }

        return badges.join('');
    }

    function resolveClusterTopologyMode(target) {
        if (target?.kind === 'swarm') {
            return target.mode === 'collaborate' ? 'collaborate' : 'broadcast';
        }

        if (target?.agentViewMode === 'broadcast' || target?.agentViewMode === 'collaborate') {
            return target.agentViewMode;
        }

        return null;
    }

    function buildClusterTopologyPlan(cluster, mode) {
        const config = typeof getClusterWorkModeConfig === 'function' ? getClusterWorkModeConfig(cluster) : (cluster?.workspaceConfig || {});
        const knownAgentIds = Array.isArray(cluster?.agentIds) ? cluster.agentIds : [];
        const rawParentByAgentId = new Map();
        const parentByAgentId = new Map();
        const childrenByAgentId = new Map();

        knownAgentIds.forEach(agentId => {
            const profile = config?.memberProfiles?.[agentId] || {};
            const parentAgentId = typeof resolveClusterMemberParentAgentId === 'function'
                ? resolveClusterMemberParentAgentId(profile, agentId, knownAgentIds)
                : '';
            rawParentByAgentId.set(agentId, parentAgentId || '');
            childrenByAgentId.set(agentId, []);
        });

        knownAgentIds.forEach(agentId => {
            const parentAgentId = rawParentByAgentId.get(agentId) || '';
            parentByAgentId.set(
                agentId,
                parentAgentId && !introducesClusterTopologyCycle(agentId, parentAgentId, rawParentByAgentId)
                    ? parentAgentId
                    : ''
            );
        });

        knownAgentIds.forEach(agentId => {
            const parentAgentId = parentByAgentId.get(agentId) || '';
            if (parentAgentId && childrenByAgentId.has(parentAgentId)) {
                childrenByAgentId.get(parentAgentId).push(agentId);
            }
        });

        const summary = {
            direct: 0,
            delegated: 0,
            keyword: 0,
            manual: 0,
            blocked: 0
        };

        const buildNode = (agentId, parentState) => {
            const profile = config?.memberProfiles?.[agentId] || {};
            const activation = typeof resolveClusterMemberActivation === 'function'
                ? resolveClusterMemberActivation(profile)
                : {
                    swarmModes: ['broadcast', 'collaborate'],
                    keywords: []
                };
            const parentAgentId = parentByAgentId.get(agentId) || '';
            const stateInfo = resolveClusterTopologyNodeState(activation, mode, parentState, Boolean(parentAgentId));
            summary[stateInfo.state] += 1;

            return {
                agentId,
                parentAgentId,
                activation,
                state: stateInfo.state,
                routeLabel: stateInfo.routeLabel,
                children: (childrenByAgentId.get(agentId) || []).map(childAgentId => buildNode(childAgentId, stateInfo.state))
            };
        };

        return {
            summary,
            rootNodes: knownAgentIds
                .filter(agentId => !parentByAgentId.get(agentId))
                .map(agentId => buildNode(agentId, null))
        };
    }

    function introducesClusterTopologyCycle(agentId, parentAgentId, parentMap) {
        const visited = new Set([agentId]);
        let currentAgentId = parentAgentId;

        while (currentAgentId) {
            if (visited.has(currentAgentId)) {
                return true;
            }

            visited.add(currentAgentId);
            currentAgentId = parentMap.get(currentAgentId) || '';
        }

        return false;
    }

    function resolveClusterTopologyNodeState(activation, mode, parentState, hasParent) {
        const modeAllowed = !mode || activation.swarmModes.includes(mode);
        const keywordGated = activation.keywords.length > 0;
        const parentCovered = !hasParent || parentState === 'direct' || parentState === 'delegated';

        if (!modeAllowed) {
            return {
                state: 'manual',
                routeLabel: hasParent ? 'clusters.topology.routeDelegated' : 'clusters.topology.routeDirect'
            };
        }

        if (keywordGated) {
            return {
                state: parentCovered ? 'keyword' : 'blocked',
                routeLabel: hasParent ? 'clusters.topology.routeDelegated' : 'clusters.topology.routeDirect'
            };
        }

        if (hasParent) {
            return {
                state: parentCovered ? 'delegated' : 'blocked',
                routeLabel: 'clusters.topology.routeDelegated'
            };
        }

        return {
            state: 'direct',
            routeLabel: 'clusters.topology.routeDirect'
        };
    }

    function renderClusterTopologySummary(summary) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const chips = [
            ['direct', 'clusters.topology.direct'],
            ['delegated', 'clusters.topology.delegated'],
            ['keyword', 'clusters.topology.keywordWaiting'],
            ['manual', 'clusters.topology.sleeping'],
            ['blocked', 'clusters.topology.blocked']
        ];

        return chips
            .filter(([state]) => Number(summary?.[state] || 0) > 0)
            .map(([state, labelKey]) => `
                <span class="cluster-topology-summary-chip is-${escapeHtml(state)}">
                    ${escapeHtml(`${summary[state]} ${t(labelKey)}`)}
                </span>
            `)
            .join('');
    }

    function renderClusterTopologyTree(nodes, cluster, target, coordinatorInfo, latencyByAgentId) {
        if (!Array.isArray(nodes) || nodes.length === 0) {
            return '';
        }

        return `
            <ul class="cluster-topology-branches">
                ${nodes.map(node => renderClusterTopologyTreeNode(node, cluster, target, coordinatorInfo, latencyByAgentId)).join('')}
            </ul>
        `;
    }

    function renderClusterTopologyTreeNode(node, cluster, target, coordinatorInfo, latencyByAgentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const isFocused = target.kind === 'agent' && target.agentId === node.agentId;
        const routeLabel = node.parentAgentId
            ? `${t(node.routeLabel)}: ${resolveClusterAgentLabel(node.parentAgentId)}`
            : t(node.routeLabel);
        const latencyBadge = renderClusterTopologyLatencyBadge(latencyByAgentId?.get(node.agentId));

        const hasChildren = node.children.length > 0;
        const parentId = node.parentAgentId || 'swarm-root';
        return `
            <li class="cluster-topology-branch${hasChildren ? ' has-children' : ''}">
                <div class="cluster-topology-branch-line"></div>
                <div class="cluster-topology-node state-${escapeHtml(node.state)}${isFocused ? ' active' : ''}" data-node-id="${escapeHtml(node.agentId)}" data-parent-id="${escapeHtml(parentId)}">
                    <div class="cluster-topology-node-header">
                        <div class="cluster-topology-node-copy">
                            <span class="cluster-topology-node-name">${escapeHtml(resolveClusterAgentLabel(node.agentId))}</span>
                            <span class="cluster-topology-node-route">${escapeHtml(routeLabel)}</span>
                        </div>
                        <span class="cluster-topology-node-meta">${escapeHtml(node.agentId)}</span>
                    </div>
                    <div class="cluster-topology-node-badges">
                        ${renderClusterTopologyStateBadge(node.state)}
                        ${latencyBadge}
                        ${renderClusterTopologyCoordinatorBadge(node.agentId, coordinatorInfo)}
                        ${renderClusterTopologyActivationBadges(cluster, node.agentId, node.activation)}
                    </div>
                </div>
                ${node.children.length > 0 ? renderClusterTopologyTree(node.children, cluster, target, coordinatorInfo, latencyByAgentId) : ''}
            </li>
        `;
    }

    let topologyConnectorFrame = null;
    let topologyConnectorObserversReady = false;
    let topologyScrollListenerId = 0;

    function ensureClusterTopologyConnectorObservers() {
        if (topologyConnectorObserversReady) {
            return;
        }

        topologyConnectorObserversReady = true;

        window.addEventListener('resize', scheduleClusterTopologyConnectorRender);

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => {
            scheduleClusterTopologyConnectorRender();
        });

        if (elements.clusterTopology) {
            observer.observe(elements.clusterTopology);
        }
    }

    function attachClusterTopologyScrollListener(graph) {
        if (!graph || graph.dataset.scrollListenerAttached === 'true') {
            return;
        }

        topologyScrollListenerId += 1;
        graph.dataset.scrollListenerAttached = 'true';
        graph.dataset.scrollListenerId = String(topologyScrollListenerId);
        graph.addEventListener('scroll', scheduleClusterTopologyConnectorRender, { passive: true });
    }

    function scheduleClusterTopologyConnectorRender() {
        if (topologyConnectorFrame) {
            window.cancelAnimationFrame(topologyConnectorFrame);
        }

        topologyConnectorFrame = window.requestAnimationFrame(() => {
            topologyConnectorFrame = null;
            renderClusterTopologyConnectors();
        });
    }

    function renderClusterTopologyConnectors() {
        const graph = elements.clusterTopology?.querySelector('.cluster-topology-graph');
        if (!graph || graph.classList.contains('hidden')) {
            return;
        }

        const svg = graph.querySelector('.cluster-topology-connectors');
        if (!svg) {
            return;
        }

        const rootNode = graph.querySelector('.cluster-topology-root[data-node-id]');
        const nodeElements = Array.from(graph.querySelectorAll('.cluster-topology-node[data-node-id]'));
        if (!rootNode || nodeElements.length === 0) {
            svg.innerHTML = '';
            return;
        }

        const graphRect = graph.getBoundingClientRect();
        const width = Math.max(graph.scrollWidth, graphRect.width);
        const height = Math.max(graph.scrollHeight, graphRect.height);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        svg.innerHTML = '';

        const nodesById = new Map();
        nodesById.set(rootNode.dataset.nodeId, rootNode);
        nodeElements.forEach(node => {
            nodesById.set(node.dataset.nodeId, node);
        });

        const childrenByParent = new Map();
        nodeElements.forEach(node => {
            const parentId = node.dataset.parentId;
            if (!parentId) {
                return;
            }
            if (!childrenByParent.has(parentId)) {
                childrenByParent.set(parentId, []);
            }
            childrenByParent.get(parentId).push(node);
        });

        const drawLine = (x1, y1, x2, y2) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            svg.appendChild(line);
        };

        const getAnchor = (el, edge) => {
            const rect = el.getBoundingClientRect();
            const x = rect.left - graphRect.left + rect.width / 2 + graph.scrollLeft;
            const y = (edge === 'top' ? rect.top : rect.bottom) - graphRect.top + graph.scrollTop;
            return { x, y };
        };

        childrenByParent.forEach((children, parentId) => {
            const parent = nodesById.get(parentId);
            if (!parent || children.length === 0) {
                return;
            }

            const parentAnchor = getAnchor(parent, 'bottom');
            const childAnchors = children.map(child => ({
                el: child,
                anchor: getAnchor(child, 'top')
            }));

            if (childAnchors.length === 1) {
                const childAnchor = childAnchors[0].anchor;
                drawLine(parentAnchor.x, parentAnchor.y, childAnchor.x, childAnchor.y);
                return;
            }

            const minChildY = Math.min(...childAnchors.map(item => item.anchor.y));
            const connectorY = Math.max(parentAnchor.y + 12, parentAnchor.y + Math.round((minChildY - parentAnchor.y) / 2));
            const minX = Math.min(...childAnchors.map(item => item.anchor.x));
            const maxX = Math.max(...childAnchors.map(item => item.anchor.x));

            drawLine(minX, connectorY, maxX, connectorY);
            drawLine(parentAnchor.x, parentAnchor.y, parentAnchor.x, connectorY);
            childAnchors.forEach(({ anchor }) => {
                drawLine(anchor.x, anchor.y, anchor.x, connectorY);
            });
        });
    }

    function renderClusterTopologyLatencyBadge(latencyMs) {
        if (!Number.isFinite(latencyMs) || latencyMs < 0) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return `
            <span class="cluster-topology-node-badge is-latency">
                ${escapeHtml(`${t('clusters.latency')}: ${formatClusterLatencySeconds(latencyMs)}`)}
            </span>
        `;
    }

    function renderClusterTopologyStateBadge(state) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const labelKeyByState = {
            direct: 'clusters.topology.direct',
            delegated: 'clusters.topology.delegated',
            keyword: 'clusters.topology.keywordWaiting',
            manual: 'clusters.topology.sleeping',
            blocked: 'clusters.topology.blocked'
        };
        const labelKey = labelKeyByState[state];
        return labelKey
            ? `<span class="cluster-topology-node-badge is-state is-${escapeHtml(state)}">${escapeHtml(t(labelKey))}</span>`
            : '';
    }

    function renderClusterTopologyCoordinatorBadge(agentId, coordinatorInfo) {
        if (!coordinatorInfo?.agentId || coordinatorInfo.agentId !== agentId) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return `
            <span class="cluster-topology-node-badge is-coordinator">
                ${escapeHtml(t('clusters.topology.coordinator'))}
                ${coordinatorInfo.isAuto ? ` · ${escapeHtml(t('clusters.topology.coordinatorAuto'))}` : ''}
            </span>
        `;
    }

    function renderClusterTopologyActivationBadges(cluster, agentId, activationOverride) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const config = typeof getClusterWorkModeConfig === 'function' ? getClusterWorkModeConfig(cluster) : (cluster?.workspaceConfig || {});
        const profile = config?.memberProfiles?.[agentId] || {};
        const activation = activationOverride || (typeof resolveClusterMemberActivation === 'function'
            ? resolveClusterMemberActivation(profile)
            : {
                swarmModes: ['broadcast', 'collaborate'],
                keywords: []
            });

        const badges = [];
        if (activation.swarmModes.length === 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(t('clusters.topology.sleeping'))}</span>`);
        } else if (activation.swarmModes.length === 1) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(activation.swarmModes[0] === 'broadcast' ? t('clusters.form.memberWakeBroadcast') : t('clusters.form.memberWakeCollaborate'))}</span>`);
        }

        if (activation.keywords.length > 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(`${t('clusters.topology.keywordRule')}: ${activation.keywords.join(', ')}`)}</span>`);
        }

        return badges.join('');
    }

