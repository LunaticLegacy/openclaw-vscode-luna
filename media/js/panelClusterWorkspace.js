// OpenClaw Luna - Panel Cluster Workspace
// 集群工作区面板 - 负责集群工作区的UI渲染和交互处理
'use strict';

    /**
     * 渲染集群列表并更新状态
     * 将服务器返回的集群数据与本地状态合并，更新当前选中的集群，并重新渲染相关UI
     * @param {Array} clusters - 服务器返回的集群数组
     */
    function renderClusters(clusters) {
        // 保存之前的集群状态，用于合并时保留本地状态
        const previousClustersById = new Map((Array.isArray(state.clusters) ? state.clusters : []).map(cluster => [cluster.id, cluster]));
        // 保存服务器集群数据
        state.serverClusters = Array.isArray(clusters) ? [...clusters] : [];
        // 合并服务器集群与本地集群（如回放集群），并合并状态
        state.clusters = getMergedClusterList(state.serverClusters)
            .map(cluster => mergeClusterState(previousClustersById.get(cluster.id), cluster));

        // 如果当前选中的集群已不存在，重置选中状态
        if (state.currentClusterId && !state.clusters.some(cluster => cluster.id === state.currentClusterId)) {
            state.currentClusterId = null;
        }

        // 如果没有选中集群但有可用集群，自动选中第一个
        if (!state.currentClusterId && state.clusters.length > 0) {
            state.currentClusterId = state.clusters[0].id;
        }

        // 确保当前集群选择状态有效
        ensureCurrentClusterSelection();
        // 渲染侧边栏集群列表
        renderClusterSidebarList(state.clusters);
        // 渲染集群工作区主界面
        renderClusterWorkspace();

        // 如果当前视图是任务视图，同时更新任务渲染
        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        // 更新任务表单字段
        updateTaskFormFields();
        // 渲染控制台概览
        renderConsoleOverview();
    }

    /**
     * 渲染侧边栏集群列表
     * @param {Array} clusters - 集群数组
     */
    function renderClusterSidebarList(clusters) {
        if (!elements.clusterSidebarList) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        // 如果没有集群数据，显示空状态提示
        if (!Array.isArray(clusters) || clusters.length === 0) {
            elements.clusterSidebarList.innerHTML = `<div class="cluster-sidebar-empty">${escapeHtml(t('clusters.emptySidebar'))}</div>`;
            return;
        }

        // 渲染每个集群的侧边栏项
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

    /**
     * 渲染集群工作区主界面
     * 根据当前集群状态渲染整个工作区，包括标题、消息列表、输入框等
     */
    function renderClusterWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        const hasCluster = Boolean(cluster);
        const replay = cluster ? getClusterReplay(cluster) : null;
        const isReplay = Boolean(replay);

        // 切换空状态和工作区显示
        elements.clusterEmptyState?.classList.toggle('hidden', hasCluster);
        elements.clusterWorkspace?.classList.toggle('hidden', !hasCluster);

        // 没有选中集群时的空状态处理
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

        // 设置集群标题和副标题
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
        // 根据回放状态设置按钮可用性
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
        // 显示回放横幅
        if (elements.clusterReplayBanner) {
            elements.clusterReplayBanner.textContent = isReplay ? getClusterReplayBannerText(cluster) : '';
            elements.clusterReplayBanner.classList.toggle('hidden', !isReplay);
        }
        if (elements.btnClearClusterReplay) {
            elements.btnClearClusterReplay.classList.toggle('hidden', !isReplay);
        }
        renderClusterWorkmodeSummary(cluster);

        // 渲染各个UI组件
        renderClusterTargetTabs(cluster);
        renderClusterModeTabs();
        renderClusterOutputModeTabs();
        ensureCurrentClusterConversationLoaded(cluster);
        renderClusterTopology(cluster);
        renderCurrentClusterConversation();
        updateClusterInputState(cluster);
    }

    /**
     * 渲染集群顶部区域（可折叠部分）
     * @param {Object} cluster - 集群对象
     */
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

        // 更新折叠状态下的显示信息
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
        // 更新切换按钮状态
        updateClusterTopSectionToggle(elements.btnToggleClusterTopSection, collapsed);
        updateClusterTopSectionToggle(elements.btnToggleClusterTopSectionCollapsed, collapsed);
        applyClusterTopSectionCollapsedState(collapsed);
    }

    /**
     * 更新顶部区域切换按钮的状态
     * @param {HTMLElement} button - 切换按钮元素
     * @param {boolean} collapsed - 是否已折叠
     */
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

    /**
     * 应用顶部区域的折叠状态
     * @param {boolean} collapsed - 是否折叠
     */
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

        // 首次初始化时直接设置高度，不使用动画
        if (!wasInitialized) {
            topSection.dataset.initialized = 'true';
            body.style.height = collapsed ? '0px' : '';
            body.classList.toggle('is-collapsed', collapsed);
            body.style.overflow = collapsed ? 'hidden' : '';
            return;
        }

        // 状态未变化时跳过
        if (previousCollapsed === collapsed) {
            return;
        }

        body.style.height = collapsed ? '0px' : '';
        body.classList.toggle('is-collapsed', collapsed);
        body.style.overflow = collapsed ? 'hidden' : '';
    }

    /**
     * 渲染集群拓扑结构视图
     * 显示集群中Agent的层级关系和激活状态
     * @param {Object} cluster - 集群对象
     */
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
        // 解析协调者信息
        const coordinatorInfo = typeof resolveClusterCoordinatorInfo === 'function'
            ? resolveClusterCoordinatorInfo(cluster)
            : { agentId: cluster.agentIds[0] || '', isAuto: true };
        const topologyMode = resolveClusterTopologyMode(target);
        const topologyPlan = buildClusterTopologyPlan(cluster, topologyMode);
        const latencyByAgentId = buildClusterSwarmLatencyMap(cluster, target);
        // 根据目标类型确定模式标签
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

        // 渲染拓扑卡片HTML
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

        // 附加滚动监听器以更新连接线
        const graph = elements.clusterTopology.querySelector('.cluster-topology-graph');
        if (graph) {
            attachClusterTopologyScrollListener(graph);
        }

        scheduleClusterTopologyConnectorRender();
        ensureClusterTopologyConnectorObservers();
    }

    /**
     * 渲染集群目标标签页（Swarm/Agent切换）
     * @param {Object} cluster - 集群对象
     */
    function renderClusterTargetTabs(cluster) {
        if (!elements.clusterTargetTabs) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        // 回放集群只显示Swarm标签
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

        // 为每个Agent添加标签页
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

    /**
     * 渲染集群模式标签页（广播/协作模式切换）
     */
    function renderClusterModeTabs() {
        if (!elements.clusterModeTabs) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const cluster = getCurrentCluster();
        // 回放集群显示固定的回放模式
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
        // Swarm目标显示广播/协作模式切换
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

        // Agent目标显示聊天/广播/协作视图模式切换
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

    /**
     * 渲染集群输出模式标签页（前端视图/原始日志切换）
     * 仅在协作模式下显示
     */
    function renderClusterOutputModeTabs() {
        if (!elements.clusterOutputModeTabs) {
            return;
        }

        const cluster = getCurrentCluster();
        const target = getCurrentClusterTargetInfo(cluster);
        // 仅在非回放集群的Swarm协作模式下显示
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
                                const label = formatSwarmRunOptionLabel(cluster.id, target.mode, runId, index, runOptions.length);
                                return `<option value="${escapeHtml(runId)}" ${runId === selectedRunId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                            }).join('')}
                        </select>
                    </label>
                ` : ''}
            </div>
        `;
    }

    /**
     * 缩短Swarm运行ID以便显示
     * @param {string} runId - 运行ID
     * @returns {string} 缩短后的ID
     */
    function shortenSwarmRunId(runId) {
        const normalized = String(runId || '').trim();
        if (!normalized) {
            return '';
        }

        return normalized.length <= 18
            ? normalized
            : `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
    }

    function formatSwarmRunOptionLabel(clusterId, mode, runId, index, total) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const meta = typeof getKnownSwarmConversationRunMeta === 'function'
            ? getKnownSwarmConversationRunMeta(clusterId, mode, runId)
            : null;
        const isActive = runId === getActiveSwarmConversationRunId(clusterId, mode) || Boolean(meta?.isActive);
        const parts = [];

        if (isActive) {
            parts.push(t('clusters.currentRun') || 'Current');
        } else if (!meta?.startedAt && total > 1) {
            parts.push(`${t('clusters.runLabel') || 'Run'} ${total - index}`);
        }

        const timeLabel = formatSwarmRunTimestamp(meta?.startedAt || meta?.stoppedAt);
        if (timeLabel) {
            parts.push(timeLabel);
        }

        const statusLabel = formatSwarmRunStatus(meta);
        if (statusLabel) {
            parts.push(statusLabel);
        }

        parts.push(shortenSwarmRunId(runId));
        return parts.join(' · ');
    }

    function formatSwarmRunTimestamp(value) {
        const normalized = String(value || '').trim();
        if (!normalized) {
            return '';
        }

        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatSwarmRunStatus(meta) {
        if (!meta) {
            return '';
        }

        const phase = String(meta.phase || '').trim();
        const status = String(meta.status || '').trim();
        const round = Number(meta.currentRound);

        if (status === 'running') {
            if (phase === 'opening') {
                return 'Opening';
            }
            if (phase === 'critique' && Number.isFinite(round) && round > 0) {
                return `Critique R${round}`;
            }
            if (phase === 'revision' && Number.isFinite(round) && round > 0) {
                return `Revision R${round}`;
            }
            if (phase === 'stop-condition' && Number.isFinite(round) && round > 0) {
                return `Stop Check R${round}`;
            }
            if (phase === 'synthesis') {
                return 'Synthesis';
            }
            if (phase === 'broadcast') {
                return 'Broadcast';
            }
        }

        if (status === 'stopping') {
            return 'Stopping';
        }

        if (status === 'failed') {
            return 'Failed';
        }

        if (status === 'stopped') {
            return 'Stopped';
        }

        if (status === 'completed') {
            return 'Completed';
        }

        return '';
    }

    /**
     * 渲染当前集群对话内容
     */
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

        // 显示加载状态
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
        // 空对话显示提示
        if (conversation.messages.length === 0 && !conversation.pending) {
            sections.push(`<div class="cluster-empty-conversation">${escapeHtml(getClusterEmptyConversationCopy(cluster, target))}</div>`);
        } else {
            // 根据视图模式选择不同的消息构建方式
            sections.push(
                isRawClusterSwarmView(target)
                    ? buildRawClusterConversationEntries(conversation.messages).map(renderClusterConversationEntry).join('')
                    : buildClusterConversationEntries(conversation.messages, target).map(renderClusterConversationEntry).join('')
            );
        }

        // 显示等待中状态
        if (conversation.pending) {
            sections.push(renderClusterPendingMessage(target));
        }

        elements.clusterMessages.innerHTML = sections.join('');
        scrollClusterToBottom();
    }

    /**
     * 构建集群对话条目列表
     * 将消息列表组织为条目（消息或跟踪记录）
     * @param {Array} messages - 消息数组
     * @returns {Array} 条目数组
     */
    function buildClusterConversationEntries(messages, target) {
        const entries = [];
        const preserveSessionFlow = isFullClusterSessionFlowTarget(target)
            && Array.isArray(messages)
            && messages.some(msg => Boolean(msg?.metadata?.swarmSessionReconstructed));
        const sanitizedMessages = sanitizeClusterConversationMessages(messages, {
            preserveSessionFlow
        });

        sanitizedMessages.forEach(msg => {
            if (!msg || shouldHideMessage(msg)) {
                return;
            }

            // 用户消息直接作为独立条目
            if (msg.role === 'user') {
                entries.push({
                    kind: 'message',
                    message: msg
                });
                return;
            }

            // 检查是否应追加到现有跟踪条目
            if (shouldAppendToClusterTrace(msg, target)) {
                const currentEntry = entries[entries.length - 1];
                const batchKey = getClusterTraceBatchKey(msg);
                const shouldReuseTraceEntry = currentEntry?.kind === 'trace'
                    && currentEntry.displayName === (msg.displayName || '')
                    && currentEntry.contextLabel === (msg.contextLabel || '')
                    && currentEntry.batchKey === batchKey;

                // 复用相同批次的跟踪条目
                if (shouldReuseTraceEntry) {
                    currentEntry.messages.push(msg);
                    return;
                }

                // 创建新的跟踪条目
                entries.push({
                    kind: 'trace',
                    displayName: msg.displayName || '',
                    contextLabel: msg.contextLabel || '',
                    batchKey,
                    messages: [msg]
                });
                return;
            }

            // 普通消息作为独立条目
            entries.push({
                kind: 'message',
                message: msg
            });
        });

        return entries;
    }

    /**
     * 构建原始集群对话条目（不合并跟踪）
     * @param {Array} messages - 消息数组
     * @returns {Array} 条目数组
     */
    function buildRawClusterConversationEntries(messages) {
        return (Array.isArray(messages) ? messages : [])
            .filter(msg => msg && !shouldHideMessage(msg))
            .map(message => ({
                kind: 'message',
                message
            }));
    }

    /**
     * 检查是否为原始Swarm视图模式
     * @param {Object} target - 目标信息对象
     * @returns {boolean} 是否为原始视图
     */
    function isRawClusterSwarmView(target) {
        return target?.kind === 'swarm'
            && target?.mode === 'collaborate'
            && target?.outputMode === 'raw';
    }

    /**
     * 检查是否应以完整session结果流渲染
     * @param {Object} target - 目标信息对象
     * @returns {boolean} 是否为完整session流视图
     */
    function isFullClusterSessionFlowTarget(target) {
        if (!target) {
            return false;
        }

        return (target.kind === 'swarm' && target.mode === 'collaborate' && target.outputMode === 'frontend')
            || (target.kind === 'agent' && target.agentViewMode === 'collaborate');
    }

    /**
     * 检查消息是否应追加到集群跟踪记录
     * @param {Object} msg - 消息对象
     * @returns {boolean} 是否应追加
     */
    function shouldAppendToClusterTrace(msg, target) {
        if (isFullClusterSessionFlowTarget(target) && msg?.metadata?.swarmSessionReconstructed) {
            return false;
        }

        // 工具消息总是追加到跟踪
        if (msg?.role === 'tool') {
            return true;
        }

        // 非助手消息不追加
        if (msg?.role !== 'assistant') {
            return false;
        }

        // 广播消息根据内容结构决定是否追加
        if (isBroadcastClusterMessage(msg)) {
            return hasStructuredClusterTraceContent(msg);
        }

        // 有显示名、上下文标签或结构化内容的助手消息追加到跟踪
        return Boolean(msg.displayName)
            || Boolean(msg.contextLabel)
            || hasStructuredClusterTraceContent(msg);
    }

    /**
     * 获取集群跟踪批次键
     * @param {Object} msg - 消息对象
     * @returns {string} 批次键
     */
    function getClusterTraceBatchKey(msg) {
        return String(msg?.metadata?.swarmBatchId || '');
    }

    /**
     * 检查是否为广播集群消息
     * @param {Object} msg - 消息对象
     * @returns {boolean} 是否为广播消息
     */
    function isBroadcastClusterMessage(msg) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        return (msg?.contextLabel || '') === t('clusters.broadcast');
    }

    /**
     * 检查消息是否有结构化的集群跟踪内容
     * @param {Object} msg - 消息对象
     * @returns {boolean} 是否有结构化内容
     */
    function hasStructuredClusterTraceContent(msg) {
        // 工具使用消息视为有结构化内容
        if (isToolUseMessage(msg)) {
            return true;
        }

        // 检查消息parts中是否包含工具调用或结果
        return Array.isArray(msg?.parts)
            && msg.parts.some(part => part?.type === 'toolCall' || part?.type === 'toolResult');
    }

    /**
     * 清理集群对话消息
     * 过滤掉已解决的工具调用，避免重复显示
     * @param {Array} messages - 原始消息数组
     * @returns {Array} 清理后的消息数组
     */
    function sanitizeClusterConversationMessages(messages, options = {}) {
        const source = Array.isArray(messages) ? messages : [];
        if (options.preserveSessionFlow) {
            return source.filter(Boolean);
        }
        const resolvedToolKeys = new Set();

        // 第一轮：收集所有已解决的工具调用ID
        source.forEach(msg => {
            if (!msg) {
                return;
            }

            // 工具消息本身的ID
            if (msg.role === 'tool') {
                resolvedToolKeys.add(getClusterToolKey(msg.toolCallId, msg.toolName));
                return;
            }

            if (!Array.isArray(msg.parts)) {
                return;
            }

            // 从助手消息的工具结果中收集
            msg.parts
                .filter(part => part.type === 'toolResult')
                .forEach(part => resolvedToolKeys.add(getClusterToolKey(part.toolCallId, part.name)));
        });

        // 第二轮：过滤消息并清理助手消息中的已解决工具调用
        return source
            .map(msg => stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys))
            .filter(msg => {
                // 保留非工具消息
                if (msg?.role !== 'tool') {
                    return true;
                }

                // 过滤掉已在助手消息结果中的工具消息
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

    /**
     * 从助手消息中移除已解决的工具调用
     * @param {Object} msg - 消息对象
     * @param {Set} resolvedToolKeys - 已解决的工具键集合
     * @returns {Object} 处理后的消息对象
     */
    function stripResolvedToolCallsFromAssistant(msg, resolvedToolKeys) {
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.parts)) {
            return msg;
        }

        // 过滤掉已解决的工具调用
        const nextParts = msg.parts.filter(part => {
            if (part.type !== 'toolCall') {
                return true;
            }

            return !resolvedToolKeys.has(getClusterToolKey(part.id, part.name));
        });

        // 如果没有变化则返回原消息
        return nextParts.length === msg.parts.length
            ? msg
            : {
                ...msg,
                parts: nextParts
            };
    }

    /**
     * 获取集群工具键（用于去重）
     * @param {string} toolCallId - 工具调用ID
     * @param {string} toolName - 工具名称
     * @returns {string} 工具键
     */
    function getClusterToolKey(toolCallId, toolName) {
        return `${normalizeToolCallId(toolCallId)}::${normalizeToolName(toolName || 'tool')}`;
    }

    /**
     * 渲染集群对话条目
     * @param {Object} entry - 条目对象（消息或跟踪）
     * @returns {string} HTML字符串
     */
    function renderClusterConversationEntry(entry) {
        if (!entry) {
            return '';
        }

        // 跟踪条目使用特殊渲染
        if (entry.kind === 'trace') {
            return renderClusterTraceEntry(entry);
        }

        return renderClusterStandaloneMessage(entry.message);
    }

    /**
     * 渲染集群独立消息
     * @param {Object} msg - 消息对象
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群跟踪条目
     * @param {Object} entry - 跟踪条目对象
     * @returns {string} HTML字符串
     */
    function renderClusterTraceEntry(entry) {
        const headerMessage = entry.messages[0];
        const time = headerMessage?.timestamp ? new Date(headerMessage.timestamp).toLocaleTimeString() : '';
        const latencyBadge = renderClusterLatencyBadge(getClusterMessageLatencyMs(headerMessage));
        // 渲染跟踪段
        const body = entry.messages.map(msg => `
            <div class="trace-segment trace-segment-${escapeHtml(msg.role || 'assistant')}">
                ${renderClusterTraceSegmentHeader(msg, headerMessage, entry)}
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

    function renderClusterTraceSegmentHeader(msg, headerMessage, entry) {
        if (!msg || (entry?.messages?.length || 0) <= 1) {
            return '';
        }

        const sourceLabel = getMessageRoleLabel(msg) || getMessageRoleLabel(headerMessage);
        const contextLabel = msg.contextLabel || entry?.contextLabel || '';
        if (!sourceLabel && !contextLabel) {
            return '';
        }

        return `
            <div class="trace-segment-header">
                ${sourceLabel ? `<span class="trace-segment-source">${escapeHtml(sourceLabel)}</span>` : ''}
                ${contextLabel ? `<span class="cluster-status-pill">${escapeHtml(contextLabel)}</span>` : ''}
            </div>
        `;
    }

    /**
     * 渲染集群等待中消息指示器
     * @param {Object} target - 目标信息对象
     * @returns {string} HTML字符串
     */
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

    /**
     * 获取集群消息延迟（毫秒）
     * @param {Object} message - 消息对象
     * @returns {number|null} 延迟毫秒数或null
     */
    function getClusterMessageLatencyMs(message) {
        const value = Number(message?.metadata?.swarmLatencyMs);
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    /**
     * 格式化集群延迟为秒
     * @param {number} latencyMs - 延迟毫秒数
     * @returns {string} 格式化后的秒数
     */
    function formatClusterLatencySeconds(latencyMs) {
        const seconds = latencyMs / 1000;
        return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
    }

    /**
     * 渲染集群延迟徽章
     * @param {number} latencyMs - 延迟毫秒数
     * @param {string} className - 额外的CSS类名
     * @returns {string} HTML字符串
     */
    function renderClusterLatencyBadge(latencyMs, className = '') {
        if (!Number.isFinite(latencyMs) || latencyMs < 0) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const label = `${t('clusters.latency')}: ${formatClusterLatencySeconds(latencyMs)}`;
        return `<span class="message-metric-badge${className ? ` ${escapeHtml(className)}` : ''}">${escapeHtml(label)}</span>`;
    }

    /**
     * 构建集群Swarm延迟映射表
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @returns {Map} Agent ID到延迟的映射
     */
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

        // 遍历消息收集每个Agent的最新延迟
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

    /**
     * 获取集群回放横幅文本
     * @param {Object} cluster - 集群对象
     * @returns {string} 横幅文本
     */
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

    /**
     * 更新集群输入框状态
     * @param {Object} cluster - 集群对象
     */
    function updateClusterInputState(cluster) {
        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        // 在回放或Agent日志视图中禁用输入
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

    /**
     * 确保当前集群对话已加载
     * @param {Object} cluster - 集群对象
     */
    function ensureCurrentClusterConversationLoaded(cluster) {
        if (!cluster) {
            return;
        }

        const target = getCurrentClusterTargetInfo(cluster);
        const conversation = ensureClusterConversation(target.key);
        // 已加载或正在加载则跳过
        if (conversation.loaded || conversation.loading) {
            return;
        }

        // 回放集群使用本地消息
        if (isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            conversation.messages = Array.isArray(replay?.messages) ? replay.messages : [];
            conversation.loading = false;
            conversation.loaded = true;
            conversation.pending = false;
            return;
        }

        conversation.loading = true;
        // 根据目标类型发送不同的加载消息
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
            mode: target.agentViewMode,
            swarmRunId: target.swarmRunId || undefined
        });
    }

    /**
     * 选择指定集群
     * @param {string} clusterId - 集群ID
     * @param {Object} options - 选项
     * @param {boolean} options.notify - 是否通知主进程
     */
    function selectCluster(clusterId, options = {}) {
        const { notify = true } = options;
        state.currentClusterId = clusterId;
        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        applyView('clusters');

        // 非回放集群发送切换视图消息
        if (notify && !isReplayCluster(clusterId)) {
            vscode.postMessage({ type: 'switchView', view: 'clusters', clusterId });
        }
    }

    /**
     * 选择集群目标（Swarm或Agent）
     * @param {string} targetKind - 目标类型（swarm/agent）
     * @param {string} agentId - Agent ID（当targetKind为agent时）
     */
    function selectClusterTarget(targetKind, agentId) {
        const cluster = getCurrentCluster();
        // 回放集群强制使用Swarm目标
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

    /**
     * 选择集群Swarm模式（广播/协作）
     * @param {string} mode - 模式（broadcast/collaborate）
     */
    function selectClusterSwarmMode(mode) {
        if (mode !== 'broadcast' && mode !== 'collaborate') {
            return;
        }

        const cluster = getCurrentCluster();
        // 回放集群使用固定模式
        if (cluster && isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            state.currentClusterSwarmMode = replay?.mode === 'collaborate' ? 'collaborate' : 'broadcast';
            state.currentClusterSwarmOutputMode = 'frontend';
            renderClusterWorkspace();
            return;
        }

        state.currentClusterSwarmMode = mode;
        // 非协作模式重置输出模式
        if (mode !== 'collaborate') {
            state.currentClusterSwarmOutputMode = 'frontend';
        }
        renderClusterWorkspace();
    }

    /**
     * 选择集群Swarm输出模式（前端/原始）
     * @param {string} outputMode - 输出模式（frontend/raw）
     */
    function selectClusterSwarmOutputMode(outputMode) {
        if (!['frontend', 'raw'].includes(outputMode)) {
            return;
        }

        const cluster = getCurrentCluster();
        // 仅在非回放集群的Swarm协作模式下允许切换
        if (!cluster || isReplayCluster(cluster) || state.currentClusterTargetKind !== 'swarm' || state.currentClusterSwarmMode !== 'collaborate') {
            return;
        }

        state.currentClusterSwarmOutputMode = outputMode;
        renderClusterWorkspace();
    }

    /**
     * 选择集群Swarm运行记录
     * @param {string} runId - 运行ID
     */
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
        if (typeof markSwarmConversationAccess === 'function') {
            markSwarmConversationAccess(cluster.id, state.currentClusterSwarmMode, normalizedRunId);
        }
        renderClusterWorkspace();
    }

    /**
     * 选择集群Agent视图模式（聊天/广播/协作）
     * @param {string} mode - 视图模式（chat/broadcast/collaborate）
     */
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

    /**
     * 导出当前集群对话
     * @param {string} exportKind - 导出类型（readable/raw）
     */
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
            swarmRunId: target.swarmRunId || undefined,
            agentId: target.agentId,
            agentViewMode: target.agentViewMode
        });
    }

    /**
     * 导出当前集群Swarm配置
     */
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

    /**
     * 提示向集群发送广播消息
     * @param {string} clusterId - 集群ID
     */
    function promptBroadcastToCluster(clusterId) {
        vscode.postMessage({
            type: 'promptBroadcastToCluster',
            clusterId
        });
    }

    /**
     * 提示集群协作对话
     * @param {string} clusterId - 集群ID
     */
    function promptCollaborateCluster(clusterId) {
        vscode.postMessage({
            type: 'promptCollaborateCluster',
            clusterId
        });
    }

    /**
     * 删除集群
     * @param {string} clusterId - 集群ID
     */
    function deleteCluster(clusterId) {
        vscode.postMessage({
            type: 'deleteCluster',
            clusterId
        });
    }

    /**
     * 渲染Swarm结果
     * 根据最后一次Swarm运行的类型渲染不同的结果
     * @returns {string} HTML字符串
     */
    function renderSwarmResults() {
        if (!state.lastSwarmRun) {
            return '';
        }

        if (state.lastSwarmRun.kind === 'collaboration') {
            return renderCollaborationResults(state.lastSwarmRun.result);
        }

        return renderBroadcastResults(state.lastSwarmRun.clusterId, state.lastSwarmRun.responses);
    }

    /**
     * 渲染广播结果
     * @param {string} clusterId - 集群ID
     * @param {Object} responses - 各Agent的响应对象
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染协作结果
     * @param {Object} result - 协作结果对象
     * @returns {string} HTML字符串
     */
    function renderCollaborationResults(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        if (!result) {
            return '';
        }

        const cluster = state.clusters.find(item => item.id === result.clusterId);
        const clusterName = cluster?.name || result.clusterName || '';
        // 标准化轮次数据
        const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
            ? result.rounds
            : [{
                kind: 'revision-2',
                descriptor: buildFallbackCollaborationRoundDescriptor('revision-2'),
                entries: result.contributions || {}
            }];
        // 最终答案
        const finalAnswerHtml = result.synthesis?.ok && result.synthesis.message
            ? formatContent(result.synthesis.message.content || '')
            : `<p>${escapeHtml(result.synthesis?.error || (t('clusters.noSuccessfulAgents') || 'No agent produced a usable contribution.'))}</p>`;
        // 渲染各轮次
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

    /**
     * 获取翻译或回退文本
     * @param {Function} t - 翻译函数
     * @param {string} key - 翻译键
     * @param {string} fallback - 回退文本
     * @returns {string} 翻译文本或回退文本
     */
    function getTranslationOrFallback(t, key, fallback) {
        const translated = t(key);
        return translated && translated !== key ? translated : fallback;
    }

    /**
     * 渲染集群拓扑协调者徽章
     * @param {string} agentId - Agent ID
     * @param {Object} coordinatorInfo - 协调者信息
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑激活徽章
     * @param {Object} cluster - 集群对象
     * @param {string} agentId - Agent ID
     * @returns {string} HTML字符串
     */
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
        // 根据激活模式添加徽章
        if (activation.swarmModes.length === 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(t('clusters.topology.sleeping'))}</span>`);
        } else if (activation.swarmModes.length === 1) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(activation.swarmModes[0] === 'broadcast' ? t('clusters.form.memberWakeBroadcast') : t('clusters.form.memberWakeCollaborate'))}</span>`);
        }

        // 添加关键词规则徽章
        if (activation.keywords.length > 0) {
            badges.push(`<span class="cluster-topology-node-badge">${escapeHtml(`${t('clusters.topology.keywordRule')}: ${activation.keywords.join(', ')}`)}</span>`);
        }

        return badges.join('');
    }

    /**
     * 解析集群拓扑模式
     * @param {Object} target - 目标信息对象
     * @returns {string|null} 拓扑模式
     */
    function resolveClusterTopologyMode(target) {
        if (target?.kind === 'swarm') {
            return target.mode === 'collaborate' ? 'collaborate' : 'broadcast';
        }

        if (target?.agentViewMode === 'broadcast' || target?.agentViewMode === 'collaborate') {
            return target.agentViewMode;
        }

        return null;
    }

    /**
     * 构建集群拓扑计划
     * 分析集群配置中的成员层级关系和激活状态
     * @param {Object} cluster - 集群对象
     * @param {string} mode - 拓扑模式
     * @returns {Object} 拓扑计划对象，包含摘要和根节点
     */
    function buildClusterTopologyPlan(cluster, mode) {
        const config = typeof getClusterWorkModeConfig === 'function' ? getClusterWorkModeConfig(cluster) : (cluster?.workspaceConfig || {});
        const knownAgentIds = Array.isArray(cluster?.agentIds) ? cluster.agentIds : [];
        const rawParentByAgentId = new Map();
        const parentByAgentId = new Map();
        const childrenByAgentId = new Map();

        // 第一步：收集原始父节点关系
        knownAgentIds.forEach(agentId => {
            const profile = config?.memberProfiles?.[agentId] || {};
            const parentAgentId = typeof resolveClusterMemberParentAgentId === 'function'
                ? resolveClusterMemberParentAgentId(profile, agentId, knownAgentIds)
                : '';
            rawParentByAgentId.set(agentId, parentAgentId || '');
            childrenByAgentId.set(agentId, []);
        });

        // 第二步：检测并处理循环引用
        knownAgentIds.forEach(agentId => {
            const parentAgentId = rawParentByAgentId.get(agentId) || '';
            parentByAgentId.set(
                agentId,
                parentAgentId && !introducesClusterTopologyCycle(agentId, parentAgentId, rawParentByAgentId)
                    ? parentAgentId
                    : ''
            );
        });

        // 第三步：构建子节点映射
        knownAgentIds.forEach(agentId => {
            const parentAgentId = parentByAgentId.get(agentId) || '';
            if (parentAgentId && childrenByAgentId.has(parentAgentId)) {
                childrenByAgentId.get(parentAgentId).push(agentId);
            }
        });

        // 统计摘要信息
        const summary = {
            direct: 0,
            delegated: 0,
            keyword: 0,
            manual: 0,
            blocked: 0
        };

        // 递归构建节点树
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

    /**
     * 检查是否会引入拓扑循环
     * @param {string} agentId - Agent ID
     * @param {string} parentAgentId - 父Agent ID
     * @param {Map} parentMap - 父节点映射
     * @returns {boolean} 是否会引入循环
     */
    function introducesClusterTopologyCycle(agentId, parentAgentId, parentMap) {
        const visited = new Set([agentId]);
        let currentAgentId = parentAgentId;

        // 沿父节点链向上遍历检查循环
        while (currentAgentId) {
            if (visited.has(currentAgentId)) {
                return true;
            }

            visited.add(currentAgentId);
            currentAgentId = parentMap.get(currentAgentId) || '';
        }

        return false;
    }

    /**
     * 解析集群拓扑节点状态
     * @param {Object} activation - 激活配置
     * @param {string} mode - 当前模式
     * @param {string|null} parentState - 父节点状态
     * @param {boolean} hasParent - 是否有父节点
     * @returns {Object} 状态信息对象
     */
    function resolveClusterTopologyNodeState(activation, mode, parentState, hasParent) {
        const modeAllowed = !mode || activation.swarmModes.includes(mode);
        const keywordGated = activation.keywords.length > 0;
        const parentCovered = !hasParent || parentState === 'direct' || parentState === 'delegated';

        // 模式不匹配时标记为手动
        if (!modeAllowed) {
            return {
                state: 'manual',
                routeLabel: hasParent ? 'clusters.topology.routeDelegated' : 'clusters.topology.routeDirect'
            };
        }

        // 有关键词规则时标记为关键词等待或阻塞
        if (keywordGated) {
            return {
                state: parentCovered ? 'keyword' : 'blocked',
                routeLabel: hasParent ? 'clusters.topology.routeDelegated' : 'clusters.topology.routeDirect'
            };
        }

        // 有父节点时根据父状态决定
        if (hasParent) {
            return {
                state: parentCovered ? 'delegated' : 'blocked',
                routeLabel: 'clusters.topology.routeDelegated'
            };
        }

        // 根节点直接响应
        return {
            state: 'direct',
            routeLabel: 'clusters.topology.routeDirect'
        };
    }

    /**
     * 渲染集群拓扑摘要
     * @param {Object} summary - 摘要统计对象
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑树
     * @param {Array} nodes - 节点数组
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @param {Object} coordinatorInfo - 协调者信息
     * @param {Map} latencyByAgentId - 延迟映射
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑树节点
     * @param {Object} node - 节点对象
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @param {Object} coordinatorInfo - 协调者信息
     * @param {Map} latencyByAgentId - 延迟映射
     * @returns {string} HTML字符串
     */
    function renderClusterTopologyTreeNode(node, cluster, target, coordinatorInfo, latencyByAgentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const isFocused = target.kind === 'agent' && target.agentId === node.agentId;
        // 构建路由标签
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

    // 拓扑连接线渲染相关状态
    let topologyConnectorFrame = null;
    let topologyConnectorObserversReady = false;
    let topologyScrollListenerId = 0;

    /**
     * 确保集群拓扑连接线观察器已初始化
     * 监听窗口大小变化和元素尺寸变化以重新渲染连接线
     */
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

    /**
     * 附加集群拓扑滚动监听器
     * @param {HTMLElement} graph - 图形容器元素
     */
    function attachClusterTopologyScrollListener(graph) {
        if (!graph || graph.dataset.scrollListenerAttached === 'true') {
            return;
        }

        topologyScrollListenerId += 1;
        graph.dataset.scrollListenerAttached = 'true';
        graph.dataset.scrollListenerId = String(topologyScrollListenerId);
        graph.addEventListener('scroll', scheduleClusterTopologyConnectorRender, { passive: true });
    }

    /**
     * 调度集群拓扑连接线渲染
     * 使用requestAnimationFrame进行节流
     */
    function scheduleClusterTopologyConnectorRender() {
        if (topologyConnectorFrame) {
            window.cancelAnimationFrame(topologyConnectorFrame);
        }

        topologyConnectorFrame = window.requestAnimationFrame(() => {
            topologyConnectorFrame = null;
            renderClusterTopologyConnectors();
        });
    }

    /**
     * 渲染集群拓扑连接线
     * 使用SVG绘制节点之间的层级连接线
     */
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

        // 设置SVG尺寸
        const graphRect = graph.getBoundingClientRect();
        const width = Math.max(graph.scrollWidth, graphRect.width);
        const height = Math.max(graph.scrollHeight, graphRect.height);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        svg.innerHTML = '';

        // 构建节点ID映射
        const nodesById = new Map();
        nodesById.set(rootNode.dataset.nodeId, rootNode);
        nodeElements.forEach(node => {
            nodesById.set(node.dataset.nodeId, node);
        });

        // 构建父子关系映射
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

        // 绘制线条辅助函数
        const drawLine = (x1, y1, x2, y2) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            svg.appendChild(line);
        };

        // 获取锚点位置
        const getAnchor = (el, edge) => {
            const rect = el.getBoundingClientRect();
            const x = rect.left - graphRect.left + rect.width / 2 + graph.scrollLeft;
            const y = (edge === 'top' ? rect.top : rect.bottom) - graphRect.top + graph.scrollTop;
            return { x, y };
        };

        // 绘制每个父节点到其子节点的连接线
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

            // 单个子节点直接连接
            if (childAnchors.length === 1) {
                const childAnchor = childAnchors[0].anchor;
                drawLine(parentAnchor.x, parentAnchor.y, childAnchor.x, childAnchor.y);
                return;
            }

            // 多个子节点使用分叉连接线
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

    /**
     * 渲染集群拓扑延迟徽章
     * @param {number} latencyMs - 延迟毫秒数
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑状态徽章
     * @param {string} state - 状态类型
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑协调者徽章（重复定义，用于兼容性）
     * @param {string} agentId - Agent ID
     * @param {Object} coordinatorInfo - 协调者信息
     * @returns {string} HTML字符串
     */
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

    /**
     * 渲染集群拓扑激活徽章（重复定义，用于兼容性）
     * @param {Object} cluster - 集群对象
     * @param {string} agentId - Agent ID
     * @param {Object} activationOverride - 激活配置覆盖
     * @returns {string} HTML字符串
     */
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
