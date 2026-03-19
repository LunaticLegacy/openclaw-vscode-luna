// OpenClaw Luna - Panel Cluster Conversation
'use strict';

    function getCurrentCluster() {
        return state.clusters.find(cluster => cluster.id === state.currentClusterId) || null;
    }

    function getCollaborationRoundLabel(round, t) {
        const descriptor = round?.descriptor || buildFallbackCollaborationRoundDescriptor(round?.kind || 'opening');
        const translated = t(descriptor.labelKey, { round: descriptor.reviewRound });
        return translated && translated !== descriptor.labelKey
            ? translated
            : descriptor.fallbackLabel;
    }

    function buildFallbackCollaborationRoundDescriptor(kind) {
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

    function ensureCurrentClusterSelection() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            return;
        }

        if (state.currentClusterTargetKind === 'agent' && !cluster.agentIds.includes(state.currentClusterAgentId)) {
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
        }

        if (isReplayCluster(cluster)) {
            const replay = getClusterReplay(cluster);
            state.currentClusterTargetKind = 'swarm';
            state.currentClusterAgentId = null;
            state.currentClusterSwarmMode = replay?.mode === 'collaborate' ? 'collaborate' : 'broadcast';
            state.currentClusterSwarmOutputMode = 'frontend';
            state.currentClusterAgentViewMode = 'chat';
            return;
        }

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

    function ensureClusterConversation(key) {
        if (!state.clusterConversations[key]) {
            state.clusterConversations[key] = {
                messages: [],
                loading: false,
                loaded: false,
                pending: false,
                swarmRunId: null,
                renderSignature: ''
            };
        }

        return state.clusterConversations[key];
    }

    function getSwarmConversationRegistryKey(clusterId, mode) {
        return `cluster:${clusterId}:swarm:${mode}`;
    }

    function getKnownSwarmConversationRuns(clusterId, mode) {
        return Array.isArray(state.clusterSwarmRunHistory?.[getSwarmConversationRegistryKey(clusterId, mode)])
            ? state.clusterSwarmRunHistory[getSwarmConversationRegistryKey(clusterId, mode)]
            : [];
    }

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
        state.clusterSwarmRunHistory[registryKey] = [normalizedRunId, ...existing].slice(0, 12);

        if (!state.currentClusterSwarmRunSelections) {
            state.currentClusterSwarmRunSelections = {};
        }

        if (options.select === true || !state.currentClusterSwarmRunSelections[registryKey]) {
            state.currentClusterSwarmRunSelections[registryKey] = normalizedRunId;
        }
    }

    function getActiveSwarmConversationRunId(clusterId, mode) {
        return state.activeClusterSwarmRuns?.[getSwarmConversationRegistryKey(clusterId, mode)] || null;
    }

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
    }

    function isVisibleClusterConversationKey(key) {
        const cluster = getCurrentCluster();
        if (!cluster || state.viewMode !== 'clusters') {
            return false;
        }

        return getCurrentClusterTargetInfo(cluster).key === key;
    }

    function refreshClusterConversationIfVisible(key) {
        if (isVisibleClusterConversationKey(key)) {
            renderClusterWorkspace();
        }
    }

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

    function shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options = {}) {
        const incomingRunId = typeof options.swarmRunId === 'string' && options.swarmRunId.trim()
            ? options.swarmRunId.trim()
            : '';
        const isRunInitialization = options.keepPending === true
            && Array.isArray(messages)
            && messages.length > 0
            && messages[0]?.role === 'user';

        if (incomingRunId) {
            recordKnownSwarmConversationRunId(clusterId, mode, incomingRunId, {
                select: isRunInitialization
            });
        }

        if (isRunInitialization && incomingRunId) {
            setActiveSwarmConversationRunId(clusterId, mode, incomingRunId);
            setSelectedSwarmConversationRunId(clusterId, mode, incomingRunId);
        }

        return true;
    }

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

    function appendSwarmConversationMessages(clusterId, mode, messages) {
        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: 'frontend',
            swarmRunId: getSelectedSwarmConversationRunId(clusterId, mode)
        });
        const conversation = ensureClusterConversation(key);
        conversation.messages.push(...messages);
        conversation.pending = false;
        conversation.loaded = true;
        conversation.renderSignature = buildConversationRenderSignature(conversation.messages, {
            loading: false,
            pending: false,
            swarmRunId: conversation.swarmRunId
        });
        refreshClusterConversationIfVisible(key);
    }

    function replaceSwarmConversationMessages(clusterId, mode, messages, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, messages, options)) {
            return;
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
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

    function clearSwarmConversationPending(clusterId, mode, options = {}) {
        if (!shouldAcceptSwarmConversationUpdate(clusterId, mode, [], options)) {
            return;
        }

        const key = getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode,
            outputMode: options.outputMode || 'frontend',
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
            return;
        }

        conversation.pending = false;
        conversation.swarmRunId = nextRunId || conversation.swarmRunId || null;
        conversation.renderSignature = nextSignature;
        refreshClusterConversationIfVisible(key);
    }

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

    function shouldPreferClusterTraceMessage(candidate, existing) {
        return computeClusterTraceMessageRichness(candidate) >= computeClusterTraceMessageRichness(existing);
    }

    function computeClusterTraceMessageRichness(message) {
        const contentLength = typeof message?.content === 'string' ? message.content.length : 0;
        const partsLength = Array.isArray(message?.parts)
            ? JSON.stringify(message.parts).length
            : 0;
        const metadataLength = message?.metadata ? JSON.stringify(message.metadata).length : 0;
        return contentLength + partsLength + metadataLength;
    }

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

    function buildTraceDeduplicationKey(message) {
        return message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
    }

    function buildCollaborationConversationMessages(result) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!result) {
            return [];
        }

        const messages = [];
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

    function getClusterPendingLabel(target) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (target.kind === 'agent') {
            return resolveClusterAgentLabel(target.agentId);
        }

        return t(target.mode === 'broadcast' ? 'clusters.broadcast' : 'clusters.collaborate');
    }

    function scrollClusterToBottom() {
        if (!elements.clusterMessages) {
            return;
        }

        elements.clusterMessages.scrollTop = elements.clusterMessages.scrollHeight;
    }

    function getAvailableAgentsForCluster(cluster) {
        if (!cluster) {
            return [];
        }

        return state.agents.filter(agent => !cluster.agentIds.includes(agent.id));
    }

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

    function resolveClusterAgentLabel(agentId) {
        if (!agentId) {
            return '-';
        }

        const agent = state.agents.find(item => item.id === agentId);
        return agent?.name || agentId;
    }

    function resolveTaskAgentLabel(agentId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!agentId) {
            return t('tasks.form.agentDefault');
        }

        return resolveAgentLabel(agentId);
    }

