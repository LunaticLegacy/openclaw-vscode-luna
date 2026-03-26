// OpenClaw Luna - Panel Cluster Conversation
// 集群对话管理面板 - 负责集群对话的加载、渲染、消息处理和状态管理
'use strict';

    const SWARM_RECENT_CACHE_LIMIT = 5;
    const SWARM_FREQUENT_ACCESS_THRESHOLD = 3;

    /**
     * 获取当前选中的集群
     * @returns {Object|null} 当前集群对象或null
     */
    function getCurrentCluster() {
        return state.clusters.find(cluster => cluster.id === state.currentClusterId) || null;
    }

    /**
     * 获取协作轮次标签
     * 根据轮次描述符生成本地化的轮次标签
     * @param {Object} round - 轮次对象
     * @param {Function} t - 翻译函数
     * @returns {string} 轮次标签
     */
    function getCollaborationRoundLabel(round, t) {
        const descriptor = round?.descriptor || buildFallbackCollaborationRoundDescriptor(round?.kind || 'opening');
        const translated = t(descriptor.labelKey, { round: descriptor.reviewRound });
        return translated && translated !== descriptor.labelKey
            ? translated
            : descriptor.fallbackLabel;
    }

    /**
     * 构建回退协作轮次描述符
     * 当没有预定义描述符时，根据轮次类型生成默认描述
     * @param {string} kind - 轮次类型
     * @returns {Object} 轮次描述符对象
     */
    function buildFallbackCollaborationRoundDescriptor(kind) {
        // 开场轮次
        if (kind === 'opening') {
            return {
                kind,
                phase: 'opening',
                reviewRound: 0,
                phaseIndex: 1,
                displayOrder: 1,
                labelKey: 'clusters.debateRoundOpening',
                fallbackLabel: 'Opening Positions'
            };
        }

        // 批评轮次（格式：critique-N）
        if (String(kind).startsWith('critique-')) {
            const reviewRound = Number(String(kind).slice('critique-'.length) || '1');
            return {
                kind,
                phase: 'critique',
                reviewRound,
                phaseIndex: 2,
                displayOrder: reviewRound * 2,
                labelKey: 'clusters.debateRoundCritiqueDynamic',
                fallbackLabel: `Review Round ${reviewRound}: Critique`
            };
        }

        // 修改轮次（格式：revision-N）
        const reviewRound = Number(String(kind).slice('revision-'.length) || '1');
        return {
            kind,
            phase: 'revision',
            reviewRound,
            phaseIndex: 3,
            displayOrder: (reviewRound * 2) + 1,
            labelKey: 'clusters.debateRoundRevisionDynamic',
            fallbackLabel: `Review Round ${reviewRound}: Revision`
        };
    }

    /**
     * 确保当前集群选择有效
     * 验证并修正当前集群的目标类型和视图模式设置
     */
    function ensureCurrentClusterSelection() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            return;
        }

        // 验证Agent目标是否有效
        if (state.currentClusterTargetKind === 'agent' && !cluster.agentIds.includes(state.currentClusterAgentId)) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
        }

        // 回放集群使用固定的视图设置
        if (isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            state.currentClusterSwarmMode = replay?.mode === 'collaborate' ? 'collaborate' : 'broadcast';
            state.currentClusterSwarmOutputMode = 'frontend';
            state.currentClusterAgentViewMode = 'chat';
            return;
        }

        // 设置默认模式
        if (!state.currentClusterSwarmMode) {
            state.currentClusterSwarmMode = 'broadcast';
        }

        if (!state.currentClusterSwarmOutputMode || !['frontend', 'raw'].includes(state.currentClusterSwarmOutputMode)) {
            state.currentClusterSwarmOutputMode = 'frontend';
        }

        if (!state.currentClusterAgentViewMode || !['chat', 'broadcast', 'collaborate'].includes(state.currentClusterAgentViewMode)) {
            state.currentClusterAgentViewMode = 'chat';
        }
    }

    /**
     * 获取当前集群目标信息
     * 根据当前选择的目标类型（Swarm/Agent）返回相应的信息对象
     * @param {Object} cluster - 集群对象（默认为当前集群）
     * @returns {Object} 目标信息对象
     */
    function getCurrentClusterTargetInfo(cluster = getCurrentCluster()) {
        if (!cluster) {
            return {
                kind: 'swarm',
                mode: state.currentClusterSwarmMode,
                agentId: null,
                key: getClusterConversationKey('', {
                    targetKind: 'swarm',
                    mode: state.currentClusterSwarmMode
                })
            };
        }

        // Agent目标信息
        if (state.currentClusterTargetKind === 'agent' && state.currentClusterAgentId) {
            return {
                kind: 'agent',
                agentId: state.currentClusterAgentId,
                agentViewMode: state.currentClusterAgentViewMode || 'chat',
                key: getClusterConversationKey(cluster.id, {
                    targetKind: 'agent',
                    agentId: state.currentClusterAgentId,
                    agentViewMode: state.currentClusterAgentViewMode || 'chat'
                })
            };
        }

        // Swarm目标信息
        return {
            kind: 'swarm',
            mode: state.currentClusterSwarmMode,
            outputMode: state.currentClusterSwarmOutputMode || 'frontend',
            swarmRunId: getSelectedSwarmConversationRunId(cluster.id, state.currentClusterSwarmMode),
            agentId: null,
            key: getClusterConversationKey(cluster.id, {
                targetKind: 'swarm',
                mode: state.currentClusterSwarmMode,
                outputMode: state.currentClusterSwarmOutputMode || 'frontend',
                swarmRunId: getSelectedSwarmConversationRunId(cluster.id, state.currentClusterSwarmMode)
            })
        };
    }

    /**
     * 获取集群对话键
     * 生成用于标识特定对话的唯一键
     * @param {string} clusterId - 集群ID
     * @param {Object} options - 选项
     * @param {string} options.targetKind - 目标类型
     * @param {string} options.agentId - Agent ID
     * @param {string} options.agentViewMode - Agent视图模式
     * @param {string} options.mode - Swarm模式
     * @param {string} options.outputMode - 输出模式
     * @param {string} options.swarmRunId - Swarm运行ID
     * @returns {string} 对话键
     */
    function getClusterConversationKey(clusterId, options = {}) {
        const targetKind = options.targetKind || state.currentClusterTargetKind;
        if (targetKind === 'agent') {
            return `cluster:${clusterId}:agent:${options.agentId || state.currentClusterAgentId || ''}:${options.agentViewMode || state.currentClusterAgentViewMode || 'chat'}`;
        }

        const mode = options.mode || state.currentClusterSwarmMode || 'broadcast';
        const outputMode = mode === 'collaborate'
            ? (options.outputMode || state.currentClusterSwarmOutputMode || 'frontend')
            : 'frontend';
        const swarmRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : getSelectedSwarmConversationRunId(clusterId, mode);
        return `cluster:${clusterId}:swarm:${mode}:run:${swarmRunId || 'latest'}:view:${outputMode}`;
    }

    /**
     * 确保集群对话存在
     * 如果指定键的对话不存在，则创建一个新的对话对象
     * @param {string} key - 对话键
     * @returns {Object} 对话对象
     */
    function ensureClusterConversation(key) {
        if (!state.clusterConversations[key]) {
            state.clusterConversations[key] = {
                messages: [],
                loading: false,
                loaded: false,
                pending: false,
                swarmRunId: null,
                renderSignature: '',
                accessCount: 0,
                lastAccessedAt: 0
            };
        }

        return state.clusterConversations[key];
    }

    /**
     * 获取Swarm对话注册表键
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @returns {string} 注册表键
     */
    function getSwarmConversationRegistryKey(clusterId, mode) {
        return `cluster:${clusterId}:swarm:${mode}`;
    }

    /**
     * 获取已知的Swarm对话运行列表
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @returns {Array} 运行ID数组
     */
    function getKnownSwarmConversationRuns(clusterId, mode) {
        return Array.isArray(state.clusterSwarmRunHistory?.[getSwarmConversationRegistryKey(clusterId, mode)])
            ? state.clusterSwarmRunHistory[getSwarmConversationRegistryKey(clusterId, mode)]
            : [];
    }

    /**
     * 记录已知的Swarm对话运行ID
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {string} swarmRunId - 运行ID
     * @param {Object} options - 选项
     * @param {boolean} options.select - 是否选中新运行
     */
    function recordKnownSwarmConversationRunId(clusterId, mode, swarmRunId, options = {}) {
        const normalizedRunId = typeof swarmRunId === 'string' ? swarmRunId.trim() : '';
        if (!normalizedRunId) {
            return;
        }

        if (!state.clusterSwarmRunHistory) {
            state.clusterSwarmRunHistory = {};
        }

        const registryKey = getSwarmConversationRegistryKey(clusterId, mode);
        const existing = getKnownSwarmConversationRuns(clusterId, mode).filter(runId => runId !== normalizedRunId);
        // 保持最多12个运行记录，新记录放在前面
        state.clusterSwarmRunHistory[registryKey] = [normalizedRunId, ...existing].slice(0, 12);

        if (!state.currentClusterSwarmRunSelections) {
            state.currentClusterSwarmRunSelections = {};
        }

        if (options.select === true || !state.currentClusterSwarmRunSelections[registryKey]) {
            state.currentClusterSwarmRunSelections[registryKey] = normalizedRunId;
        }

        if (window.persistUiState) {
            window.persistUiState();
        }
    }

    function syncKnownSwarmConversationRuns(clusterId, mode, runIds, options = {}) {
        if (!Array.isArray(runIds) || runIds.length === 0) {
            return;
        }

        const normalized = runIds
            .map(runId => String(runId || '').trim())
            .filter(Boolean);
        if (normalized.length === 0) {
            return;
        }

        if (!state.clusterSwarmRunHistory) {
            state.clusterSwarmRunHistory = {};
        }

        const registryKey = getSwarmConversationRegistryKey(clusterId, mode);
        state.clusterSwarmRunHistory[registryKey] = Array.from(new Set(normalized)).slice(0, 24);

        if (options.select && normalized[0]) {
            setSelectedSwarmConversationRunId(clusterId, mode, normalized[0]);
        } else if (window.persistUiState) {
            window.persistUiState();
        }
    }

    function markSwarmConversationAccess(clusterId, mode, swarmRunId) {
        const normalizedRunId = typeof swarmRunId === 'string' ? swarmRunId.trim() : '';
        if (!clusterId || !mode || !normalizedRunId) {
            return;
        }

        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            swarmRunId: normalizedRunId
        });
        const conversation = ensureClusterConversation(key);
        conversation.accessCount = Number(conversation.accessCount || 0) + 1;
        conversation.lastAccessedAt = Date.now();
        pruneSwarmConversationCache(key);
    }

    function pruneSwarmConversationCache(preserveKey) {
        const candidates = Object.entries(state.clusterConversations || {})
            .filter(([key, conversation]) =>
                key.includes(':swarm:')
                && key !== preserveKey
                && conversation
                && Array.isArray(conversation.messages)
                && conversation.messages.length > 0
                && conversation.loaded
                && !conversation.pending
            )
            .sort((left, right) => Number((right[1] || {}).lastAccessedAt || 0) - Number((left[1] || {}).lastAccessedAt || 0));

        const keepKeys = new Set(candidates
            .slice(0, SWARM_RECENT_CACHE_LIMIT)
            .map(([key]) => key));
        keepKeys.add(preserveKey);

        for (const [key, conversation] of candidates) {
            if (keepKeys.has(key) || Number(conversation.accessCount || 0) >= SWARM_FREQUENT_ACCESS_THRESHOLD) {
                continue;
            }

            conversation.messages = [];
            conversation.loaded = false;
            conversation.loading = false;
            conversation.renderSignature = '';
        }
    }

    /**
     * 获取活动的Swarm对话运行ID
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @returns {string|null} 运行ID或null
     */
    function getActiveSwarmConversationRunId(clusterId, mode) {
        return state.activeClusterSwarmRuns?.[getSwarmConversationRegistryKey(clusterId, mode)] || null;
    }

    /**
     * 设置活动的Swarm对话运行ID
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {string} swarmRunId - 运行ID
     */
    function setActiveSwarmConversationRunId(clusterId, mode, swarmRunId) {
        if (!state.activeClusterSwarmRuns) {
            state.activeClusterSwarmRuns = {};
        }

        const registryKey = getSwarmConversationRegistryKey(clusterId, mode);
        if (swarmRunId) {
            state.activeClusterSwarmRuns[registryKey] = swarmRunId;
            return;
        }

        delete state.activeClusterSwarmRuns[registryKey];
    }

    /**
     * 获取选中的Swarm对话运行ID
     * 优先级：用户选择 > 活动运行 > 最新运行
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @returns {string|null} 运行ID或null
     */
    function getSelectedSwarmConversationRunId(clusterId, mode) {
        const registryKey = getSwarmConversationRegistryKey(clusterId, mode);
        const selectedRunId = state.currentClusterSwarmRunSelections?.[registryKey];
        if (typeof selectedRunId === 'string' && selectedRunId.trim()) {
            return selectedRunId.trim();
        }

        const activeRunId = getActiveSwarmConversationRunId(clusterId, mode);
        if (activeRunId) {
            return activeRunId;
        }

        return getKnownSwarmConversationRuns(clusterId, mode)[0] || null;
    }

    /**
     * 设置选中的Swarm对话运行ID
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {string} swarmRunId - 运行ID
     */
    function setSelectedSwarmConversationRunId(clusterId, mode, swarmRunId) {
        const normalizedRunId = typeof swarmRunId === 'string' ? swarmRunId.trim() : '';
        if (!normalizedRunId) {
            return;
        }

        if (!state.currentClusterSwarmRunSelections) {
            state.currentClusterSwarmRunSelections = {};
        }

        recordKnownSwarmConversationRunId(clusterId, mode, normalizedRunId);
        state.currentClusterSwarmRunSelections[getSwarmConversationRegistryKey(clusterId, mode)] = normalizedRunId;
        if (window.persistUiState) {
            window.persistUiState();
        }
    }

    /**
     * 检查指定键的对话是否当前可见
     * @param {string} key - 对话键
     * @returns {boolean} 是否可见
     */
    function isVisibleClusterConversationKey(key) {
        const cluster = getCurrentCluster();
        if (!cluster || state.viewMode !== 'clusters') {
            return false;
        }

        return getCurrentClusterTargetInfo(cluster).key === key;
    }

    /**
     * 如果指定对话可见，则刷新集群工作区
     * @param {string} key - 对话键
     */
    function refreshClusterConversationIfVisible(key) {
        if (isVisibleClusterConversationKey(key)) {
            renderClusterWorkspace();
        }
    }

    /**
     * 构建对话渲染签名
     * 用于检测对话内容是否有变化，避免不必要的重新渲染
     * @param {Array} messages - 消息数组
     * @param {Object} options - 选项
     * @param {boolean} options.loading - 是否加载中
     * @param {boolean} options.pending - 是否等待中
     * @param {string} options.swarmRunId - Swarm运行ID
     * @returns {string} 渲染签名
     */
    function buildConversationRenderSignature(messages, options = {}) {
        const source = Array.isArray(messages) ? messages : [];
        const messageSignature = source.map(message => ([
            message?.id || '',
            message?.role || '',
            message?.timestamp || '',
            message?.content || '',
            message?.displayName || '',
            message?.contextLabel || '',
            String(message?.metadata?.swarmBatchId || ''),
            String(message?.metadata?.swarmRunId || ''),
            message?.toolCallId || '',
            message?.toolName || '',
            Array.isArray(message?.parts) ? message.parts.length : 0
        ].join('|'))).join('||');

        return [
            options.loading ? '1' : '0',
            options.pending ? '1' : '0',
            options.swarmRunId || '',
            messageSignature
        ].join(':::');
    }

    /**
     * 判断是否应接受Swarm对话更新
     * 处理运行初始化和运行记录更新逻辑
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {Array} messages - 消息数组
     * @param {Object} options - 选项
     * @param {boolean} options.keepPending - 是否保持等待状态
     * @param {string} options.swarmRunId - Swarm运行ID
     * @returns {boolean} 是否接受更新
     */
    function shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options = {}) {
        const incomingRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : '';
        // 检测是否为运行初始化（第一条用户消息）
        const isRunInitialization = options.keepPending === true
            && Array.isArray(messages)
            && messages.length > 0
            && messages[0]?.role === 'user';

        if (incomingRunId) {
            recordKnownSwarmConversationRunId(clusterId, mode, incomingRunId, {
                select: isRunInitialization
            });
        }

        // 运行初始化时设置活动和选中状态
        if (isRunInitialization && incomingRunId) {
            setActiveSwarmConversationRunId(clusterId, mode, incomingRunId);
            setSelectedSwarmConversationRunId(clusterId, mode, incomingRunId);
        }

        return true;
    }

    /**
     * 设置集群对话加载状态
     * @param {string} clusterId - 集群ID
     * @param {string} agentId - Agent ID
     * @param {boolean} loading - 是否加载中
     */
    function setClusterConversationLoading(clusterId, agentId, loading) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId,
            agentViewMode: 'chat'
        }));
        conversation.loading = Boolean(loading);
        if (!loading) {
            conversation.loaded = true;
        }
        renderClusterWorkspace();
    }

    /**
     * 设置Swarm对话加载状态
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {boolean} loading - 是否加载中
     * @param {Object} options - 选项
     * @param {string} options.outputMode - 输出模式
     * @param {string} options.swarmRunId - Swarm运行ID
     */
    function setSwarmConversationLoading(clusterId, mode, loading, options = {}) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: options.outputMode,
            swarmRunId: options.swarmRunId
        });
        const conversation = ensureClusterConversation(key);
        if (options.swarmRunId) {
            recordKnownSwarmConversationRunId(clusterId, mode, options.swarmRunId);
        }
        const nextSignature = buildConversationRenderSignature(conversation.messages, {
            loading: Boolean(loading),
            pending: conversation.pending,
            swarmRunId: options.swarmRunId || conversation.swarmRunId
        });
        // 签名未变化时跳过渲染
        if (conversation.renderSignature === nextSignature) {
            return;
        }
        conversation.loading = Boolean(loading);
        if (!loading) {
            conversation.loaded = true;
        }
        if (options.swarmRunId) {
            conversation.swarmRunId = options.swarmRunId;
        }
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 替换集群对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} agentId - Agent ID
     * @param {Array} messages - 新消息数组
     */
    function replaceClusterConversationMessages(clusterId, agentId, messages) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId,
            agentViewMode: 'chat'
        });
        const conversation = ensureClusterConversation(key);
        const nextMessages = Array.isArray(messages) ? messages : [];
        const nextSignature = buildConversationRenderSignature(nextMessages, {
            loading: false,
            pending: false
        });
        if (conversation.renderSignature === nextSignature) {
            return;
        }
        conversation.messages = nextMessages;
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 追加集群对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} agentId - Agent ID
     * @param {Object} message - 消息对象
     * @param {Object} options - 选项
     * @param {boolean} options.keepPending - 是否保持等待状态
     */
    function appendClusterConversationMessage(clusterId, agentId, message, options = {}) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId,
            agentViewMode: 'chat'
        });
        const conversation = ensureClusterConversation(key);
        conversation.messages.push(message);
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = options.keepPending === true;
        conversation.renderSignature = buildConversationRenderSignature(conversation.messages, {
            loading: false,
            pending: conversation.pending
        });
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 设置集群Agent Swarm对话加载状态
     * @param {string} clusterId - 集群ID
     * @param {string} agentId - Agent ID
     * @param {string} mode - Swarm模式
     * @param {boolean} loading - 是否加载中
     */
    function setClusterAgentSwarmConversationLoading(clusterId, agentId, mode, loading) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId,
            agentViewMode: mode
        });
        const conversation = ensureClusterConversation(key);
        const nextSignature = buildConversationRenderSignature(conversation.messages, {
            loading: Boolean(loading),
            pending: conversation.pending
        });
        if (conversation.renderSignature === nextSignature) {
            return;
        }
        conversation.loading = Boolean(loading);
        if (!loading) {
            conversation.loaded = true;
        }
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 替换集群Agent Swarm对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} agentId - Agent ID
     * @param {string} mode - Swarm模式
     * @param {Array} messages - 新消息数组
     */
    function replaceClusterAgentSwarmConversationMessages(clusterId, agentId, mode, messages) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId,
            agentViewMode: mode
        });
        const conversation = ensureClusterConversation(key);
        const nextMessages = Array.isArray(messages) ? messages : [];
        const nextSignature = buildConversationRenderSignature(nextMessages, {
            loading: false,
            pending: false
        });
        if (conversation.renderSignature === nextSignature) {
            return;
        }
        conversation.messages = nextMessages;
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 追加Swarm对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {Array} messages - 消息数组
     * @param {Object} options - 选项
     * @param {string} options.swarmRunId - Swarm运行ID
     * @param {boolean} options.keepPending - 是否保持等待状态
     */
    function appendSwarmConversationMessages(clusterId, mode, messages, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options)) {
            return;
        }

        if (Array.isArray(options.knownRunIds) && options.knownRunIds.length > 0) {
            syncKnownSwarmConversationRuns(clusterId, mode, options.knownRunIds);
        }

        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: options.outputMode || 'frontend',
            swarmRunId: options.swarmRunId
        });
        const conversation = ensureClusterConversation(key);
        const nextMessages = Array.isArray(messages) ? messages : [];
        if (nextMessages.length === 0 && options.keepPending !== true) {
            return;
        }

        const nextRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : conversation.swarmRunId;
        conversation.messages.push(...nextMessages);
        conversation.loading = false;
        conversation.pending = options.keepPending === true;
        conversation.loaded = true;
        conversation.lastAccessedAt = Date.now();
        conversation.renderSignature = buildConversationRenderSignature(conversation.messages, {
            loading: false,
            pending: conversation.pending,
            swarmRunId: nextRunId
        });
        conversation.swarmRunId = nextRunId || conversation.swarmRunId || null;
        pruneSwarmConversationCache(key);
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 按消息ID修补Swarm对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {Array} messages - 替换后的消息数组
     * @param {Object} options - 选项
     */
    function patchSwarmConversationMessages(clusterId, mode, messages, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options)) {
            return;
        }

        if (Array.isArray(options.knownRunIds) && options.knownRunIds.length > 0) {
            syncKnownSwarmConversationRuns(clusterId, mode, options.knownRunIds);
        }

        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: options.outputMode || 'frontend',
            swarmRunId: options.swarmRunId
        });
        const conversation = ensureClusterConversation(key);
        const incoming = Array.isArray(messages) ? messages : [];
        if (incoming.length === 0 && options.keepPending !== true) {
            return;
        }

        const identifiedIncoming = [];
        const anonymousIncoming = [];
        for (const message of incoming) {
            if (typeof message?.id === 'string' && message.id) {
                identifiedIncoming.push(message);
            } else {
                anonymousIncoming.push(message);
            }
        }

        const byId = new Map(identifiedIncoming.map(message => [message.id, message]));
        if (byId.size > 0) {
            const seenIds = new Set();
            conversation.messages = conversation.messages.map(existing => {
                if (existing && byId.has(existing.id)) {
                    seenIds.add(existing.id);
                    return byId.get(existing.id);
                }
                return existing;
            });

            for (const [messageId, message] of byId.entries()) {
                if (!seenIds.has(messageId)) {
                    conversation.messages.push(message);
                }
            }
        }

        if (anonymousIncoming.length > 0) {
            conversation.messages.push(...anonymousIncoming);
        }

        conversation.loading = false;
        conversation.pending = options.keepPending === true;
        conversation.loaded = true;
        const nextRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : conversation.swarmRunId;
        conversation.swarmRunId = nextRunId || conversation.swarmRunId || null;
        conversation.lastAccessedAt = Date.now();
        conversation.renderSignature = buildConversationRenderSignature(conversation.messages, {
            loading: false,
            pending: conversation.pending,
            swarmRunId: conversation.swarmRunId
        });
        pruneSwarmConversationCache(key);
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 替换Swarm对话消息
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {Array} messages - 新消息数组
     * @param {Object} options - 选项
     * @param {string} options.outputMode - 输出模式
     * @param {string} options.swarmRunId - Swarm运行ID
     * @param {boolean} options.keepPending - 是否保持等待状态
     */
    function replaceSwarmConversationMessages(clusterId, mode, messages, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options)) {
            return;
        }

        if (Array.isArray(options.knownRunIds) && options.knownRunIds.length > 0) {
            syncKnownSwarmConversationRuns(clusterId, mode, options.knownRunIds);
        }

        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: options.outputMode || 'frontend',
            swarmRunId: options.swarmRunId
        });
        const conversation = ensureClusterConversation(key);
        const nextMessages = Array.isArray(messages) ? messages : [];
        const nextRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : conversation.swarmRunId;
        const nextSignature = buildConversationRenderSignature(nextMessages, {
            loading: false,
            pending: options.keepPending === true,
            swarmRunId: nextRunId
        });
        if (conversation.renderSignature === nextSignature) {
            return;
        }

        conversation.messages = nextMessages;
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = options.keepPending === true;
        conversation.swarmRunId = nextRunId || null;
        conversation.lastAccessedAt = Date.now();
        conversation.renderSignature = nextSignature;
        pruneSwarmConversationCache(key);
        refreshClusterConversationIfVisible(key);
    }

    /**
     * 清除Swarm对话等待状态
     * @param {string} clusterId - 集群ID
     * @param {string} mode - Swarm模式
     * @param {Object} options - 选项
     * @param {string} options.outputMode - 输出模式
     * @param {string} options.swarmRunId - Swarm运行ID
     */
    function clearSwarmConversationPending(clusterId, mode, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, [], options)) {
            return;
        }

        const outputModes = options.outputMode
            ? [options.outputMode]
            : (mode === 'collaborate' ? ['frontend', 'raw'] : ['frontend']);

        for (const outputMode of outputModes) {
            const key = getClusterConversationKey(clusterId, {
                targetKind: 'swarm',
                mode,
                outputMode,
                swarmRunId: options.swarmRunId
            });
            const conversation = ensureClusterConversation(key);
            const nextRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
                ? options.swarmRunId.trim()
                : conversation.swarmRunId;
            const nextSignature = buildConversationRenderSignature(conversation.messages, {
                loading: false,
                pending: false,
                swarmRunId: nextRunId
            });
            if (conversation.renderSignature === nextSignature) {
                continue;
            }

            conversation.pending = false;
            conversation.loading = false;
            conversation.swarmRunId = nextRunId || conversation.swarmRunId || null;
            conversation.renderSignature = nextSignature;
            refreshClusterConversationIfVisible(key);
        }
    }

    /**
     * 清除当前集群等待状态
     */
    function clearCurrentClusterPendingState() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        const conversation = ensureClusterConversation(getCurrentClusterTargetInfo(cluster).key);
        conversation.pending = false;
        conversation.loading = false;
        conversation.renderSignature = buildConversationRenderSignature(conversation.messages, {
            loading: false,
            pending: false,
            swarmRunId: conversation.swarmRunId
        });
        renderClusterWorkspace();
    }

    /**
     * 构建广播对话消息
     * 将各Agent的响应转换为统一的对话消息格式
     * @param {Object} responses - 各Agent的响应对象
     * @returns {Array} 消息数组
     */
    function buildBroadcastConversationMessages(responses) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const messages = [];
        Object.values(responses || {}).forEach(entry => {
            const displayName = resolveAgentLabel(entry.agentId);
            const contextLabel = t('clusters.broadcast');
            if (entry.ok) {
                messages.push(...buildAgentTraceMessages(entry, displayName, contextLabel));
                return;
            }

            messages.push({
                role: 'assistant',
                content: entry.error || t('clusters.resultUnknownError'),
                timestamp: new Date().toISOString(),
                displayName,
                contextLabel
            });
        });
        return messages;
    }

    /**
     * 构建Agent跟踪消息
     * 将Agent的执行跟踪和最终消息合并为对话消息
     * @param {Object} entry - Agent响应条目
     * @param {string} displayName - 显示名称
     * @param {string} contextLabel - 上下文标签
     * @returns {Array} 消息数组
     */
    function buildAgentTraceMessages(entry, displayName, contextLabel) {
        const trace = Array.isArray(entry?.trace) ? entry.trace : [];
        const source = mergeTraceWithFinalMessage(trace, entry?.message);
        const deduped = [];
        const byKey = new Map();

        source.forEach(message => {
            if (!message) {
                return;
            }

            const key = message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
            const existingIndex = byKey.get(key);
            if (existingIndex !== undefined) {
                // 选择内容更丰富的消息
                if (shouldPreferClusterTraceMessage(message, deduped[existingIndex])) {
                    deduped[existingIndex] = {
                        ...message,
                        displayName,
                        contextLabel
                    };
                }
                return;
            }

            byKey.set(key, deduped.length);
            deduped.push({
                ...message,
                displayName,
                contextLabel
            });
        });

        return deduped;
    }

    /**
     * 判断是否应优先使用候选消息
     * @param {Object} candidate - 候选消息
     * @param {Object} existing - 现有消息
     * @returns {boolean} 是否优先使用候选
     */
    function shouldPreferClusterTraceMessage(candidate, existing) {
        return computeClusterTraceMessageRichness(candidate) >= computeClusterTraceMessageRichness(existing);
    }

    /**
     * 计算集群跟踪消息的丰富度
     * 用于去重时选择更完整的消息
     * @param {Object} message - 消息对象
     * @returns {number} 丰富度得分
     */
    function computeClusterTraceMessageRichness(message) {
        const contentLength = typeof message?.content === 'string' ? message.content.length : 0;
        const partsLength = Array.isArray(message?.parts)
            ? JSON.stringify(message.parts).length
            : 0;
        const metadataLength = message?.metadata ? JSON.stringify(message.metadata).length : 0;
        return contentLength + partsLength + metadataLength;
    }

    /**
     * 合并跟踪与最终消息
     * 确保最终消息被包含在跟踪中（如果不存在）
     * @param {Array} trace - 跟踪消息数组
     * @param {Object} finalMessage - 最终消息
     * @returns {Array} 合并后的消息数组
     */
    function mergeTraceWithFinalMessage(trace, finalMessage) {
        if (!finalMessage) {
            return trace;
        }

        if (!Array.isArray(trace) || trace.length === 0) {
            return [finalMessage];
        }

        const finalKey = buildTraceDeduplicationKey(finalMessage);
        const hasFinalMessage = trace.some(message => buildTraceDeduplicationKey(message) === finalKey);
        if (hasFinalMessage) {
            return trace;
        }

        const hasAssistantResult = trace.some(message => message?.role === 'assistant');
        return hasAssistantResult ? trace : [...trace, finalMessage];
    }

    /**
     * 构建跟踪去重键
     * @param {Object} message - 消息对象
     * @returns {string} 去重键
     */
    function buildTraceDeduplicationKey(message) {
        return message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
    }

    /**
     * 构建协作对话消息
     * 将协作结果转换为对话消息格式
     * @param {Object} result - 协作结果对象
     * @returns {Array} 消息数组
     */
    function buildCollaborationConversationMessages(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!result) {
            return [];
        }

        const messages = [];
        // 标准化轮次数据
        const rounds = Array.isArray(result.rounds) && result.rounds.length > 0
            ? result.rounds
            : [{
                kind: 'revision-2',
                descriptor: buildFallbackCollaborationRoundDescriptor('revision-2'),
                entries: result.contributions || {}
            }];
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : t('clusters.targetSwarm');

        // 处理每个轮次
        rounds.forEach(round => {
            const roundLabel = getCollaborationRoundLabel(round, t);
            Object.entries(round.entries || {}).forEach(([agentId, entry]) => {
                if (entry.ok) {
                    messages.push(...buildAgentTraceMessages(
                        entry,
                        resolveAgentLabel(agentId),
                        roundLabel
                    ));
                    return;
                }

                messages.push({
                        role: 'assistant',
                        content: entry.error || t('clusters.resultUnknownError'),
                        timestamp: new Date().toISOString(),
                        displayName: resolveAgentLabel(agentId),
                        contextLabel: roundLabel
                    });
            });
        });

        // 添加最终综合结果
        messages.push(result.synthesis?.ok && result.synthesis.message
            ? {
                ...result.synthesis.message,
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            }
            : {
                role: 'assistant',
                content: result.synthesis?.error || t('clusters.noSuccessfulAgents'),
                timestamp: new Date().toISOString(),
                displayName: t('clusters.finalAnswer'),
                contextLabel: `${t('clusters.coordinator')}: ${coordinatorLabel}`
            });

        return messages;
    }

    /**
     * 获取集群空对话提示文本
     * 根据目标类型和模式返回相应的空状态提示
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @returns {string} 提示文本
     */
    function getClusterEmptyConversationCopy(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            if (target.agentViewMode === 'broadcast') {
                return t('clusters.emptyAgentBroadcastConversation', {
                    agent: resolveClusterAgentLabel(target.agentId)
                });
            }

            if (target.agentViewMode === 'collaborate') {
                return t('clusters.emptyAgentCollaborateConversation', {
                    agent: resolveClusterAgentLabel(target.agentId)
                });
            }

            return t('clusters.emptyAgentConversation', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.emptyCollaborateConversation', { count: cluster.agentIds.length })
            : t('clusters.emptyBroadcastConversation', { count: cluster.agentIds.length });
    }

    /**
     * 获取集群输入框占位符文本
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @returns {string} 占位符文本
     */
    function getClusterInputPlaceholder(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            return t('clusters.chatPlaceholder');
        }

        if (isReplayCluster(cluster)) {
            return t('clusters.chatPlaceholderReplay');
        }

        if (target.kind === 'agent') {
            if (target.agentViewMode === 'broadcast' || target.agentViewMode === 'collaborate') {
                return t('clusters.chatPlaceholderAgentReadonly', {
                    agent: resolveClusterAgentLabel(target.agentId)
                });
            }

            return t('clusters.chatPlaceholderAgent', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.chatPlaceholderCollaborate')
            : t('clusters.chatPlaceholderBroadcast');
    }

    /**
     * 获取集群目标提示文本
     * @param {Object} cluster - 集群对象
     * @param {Object} target - 目标信息对象
     * @returns {string} 提示文本
     */
    function getClusterTargetHint(cluster, target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!cluster) {
            return '';
        }

        if (isReplayCluster(cluster)) {
            return t('clusters.replayReadonlyHint');
        }

        if (target.kind === 'agent') {
            if (target.agentViewMode === 'broadcast') {
                return t('clusters.hintAgentLogBroadcast', {
                    agent: resolveClusterAgentLabel(target.agentId)
                });
            }

            if (target.agentViewMode === 'collaborate') {
                return t('clusters.hintAgentLogCollaborate', {
                    agent: resolveClusterAgentLabel(target.agentId)
                });
            }

            return t('clusters.hintAgent', {
                agent: resolveClusterAgentLabel(target.agentId)
            });
        }

        return target.mode === 'collaborate'
            ? t('clusters.hintCollaborate', { count: cluster.agentIds.length })
            : t('clusters.hintBroadcast', { count: cluster.agentIds.length });
    }

    /**
     * 获取集群等待中标签
     * @param {Object} target - 目标信息对象
     * @returns {string} 等待中标签
     */
    function getClusterPendingLabel(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return resolveClusterAgentLabel(target.agentId);
        }

        return t(target.mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate');
    }

    /**
     * 滚动集群消息到底部
     */
    function scrollClusterToBottom() {
        if (!elements.clusterMessages) {
            return;
        }

        elements.clusterMessages.scrollTop = elements.clusterMessages.scrollHeight;
    }

    /**
     * 获取集群可用Agent列表
     * @param {Object} cluster - 集群对象
     * @returns {Array} 可用Agent数组
     */
    function getAvailableAgentsForCluster(cluster) {
        if (!cluster) {
            return [];
        }

        return state.agents.filter(agent => !cluster.agentIds.includes(agent.id));
    }

    /**
     * 解析集群状态标签
     * @param {string} status - 状态值
     * @returns {string} 本地化状态标签
     */
    function resolveClusterStatusLabel(status) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (status === 'active') {
            return t('clusters.statusActive');
        }
        if (status === 'inactive') {
            return t('clusters.statusInactive');
        }
        return t('clusters.statusUnknown');
    }

    /**
     * 解析Agent标签
     * 返回包含名称和模型的完整标签
     * @param {string} agentId - Agent ID
     * @returns {string} Agent标签
     */
    function resolveAgentLabel(agentId) {
        if (!agentId) {
            return '—';
        }

        const agent = state.agents.find(item => item.id === agentId);
        if (!agent) {
            return agentId;
        }

        return `${agent.name} (${agent.model})`;
    }

    /**
     * 解析集群Agent标签
     * 返回仅包含名称的简短标签
     * @param {string} agentId - Agent ID
     * @returns {string} Agent名称
     */
    function resolveClusterAgentLabel(agentId) {
        if (!agentId) {
            return '-';
        }

        const agent = state.agents.find(item => item.id === agentId);
        return agent?.name || agentId;
    }

    /**
     * 解析任务Agent标签
     * @param {string} agentId - Agent ID
     * @returns {string} Agent标签
     */
    function resolveTaskAgentLabel(agentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!agentId) {
            return t('tasks.form.agentDefault');
        }

        return resolveAgentLabel(agentId);
    }
