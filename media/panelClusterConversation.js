// OpenClaw Luna - Panel Cluster Conversation
'use strict';

    function getCurrentCluster() {
        return state.clusters.find(cluster => cluster.id === state.currentClusterId) || null;
    }

    function getCollaborationRoundLabel(kind, t) {
        const keyMap = {
            opening: 'clusters.debateRoundOpening',
            'critique-1': 'clusters.debateRoundCritique1',
            'revision-1': 'clusters.debateRoundRevision1',
            'critique-2': 'clusters.debateRoundCritique2',
            'revision-2': 'clusters.debateRoundRevision2'
        };
        const fallbackMap = {
            opening: 'Round 1 - Opening Positions',
            'critique-1': 'Round 2 - Peer Review',
            'revision-1': 'Round 3 - Revised Positions',
            'critique-2': 'Round 4 - Second Peer Review',
            'revision-2': 'Round 5 - Final Positions'
        };

        if (keyMap[kind]) {
            return getTranslationOrFallback(t, keyMap[kind], fallbackMap[kind]);
        }

        if (kind === 'opening') {
            return t('clusters.debateRoundOpening') || 'Round 1 - Opening Positions';
        }

        if (kind.startsWith('critique-')) {
            const round = Number(kind.slice('critique-'.length) || '1');
            return t('clusters.debateRoundCritiqueDynamic', { round }) || `Critique Round ${round}`;
        }

        if (kind.startsWith('revision-')) {
            const round = Number(kind.slice('revision-'.length) || '1');
            return t('clusters.debateRoundRevisionDynamic', { round }) || `Revision Round ${round}`;
        }

        return t('clusters.contributions') || 'Contributions';
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

        if (!state.currentClusterSwarmMode) {
            state.currentClusterSwarmMode = 'broadcast';
        }

        if (state.currentClusterTargetKind === 'swarm') {
            ensureClusterConversation(getClusterConversationKey(cluster.id, {
                targetKind: 'swarm',
                mode: state.currentClusterSwarmMode
            })).loaded = true;
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
                key: getClusterConversationKey(cluster.id, {
                    targetKind: 'agent',
                    agentId: state.currentClusterAgentId
                })
            };
        }

        return {
            kind: 'swarm',
            mode: state.currentClusterSwarmMode,
            agentId: null,
            key: getClusterConversationKey(cluster.id, {
                targetKind: 'swarm',
                mode: state.currentClusterSwarmMode
            })
        };
    }

    function getClusterConversationKey(clusterId, options = {}) {
        const targetKind = options.targetKind || state.currentClusterTargetKind;
        if (targetKind === 'agent') {
            return `cluster:${clusterId}:agent:${options.agentId || state.currentClusterAgentId || ''}`;
        }

        return `cluster:${clusterId}:swarm:${options.mode || state.currentClusterSwarmMode || 'broadcast'}`;
    }

    function ensureClusterConversation(key) {
        if (!state.clusterConversations[key]) {
            state.clusterConversations[key] = {
                messages: [],
                loading: false,
                loaded: false,
                pending: false
            };
        }

        return state.clusterConversations[key];
    }

    function setClusterConversationLoading(clusterId, agentId, loading) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.loading = Boolean(loading);
        if (!loading) {
            conversation.loaded = true;
        }
        renderClusterWorkspace();
    }

    function replaceClusterConversationMessages(clusterId, agentId, messages) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.messages = Array.isArray(messages) ? messages : [];
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function appendClusterConversationMessage(clusterId, agentId, message) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'agent',
            agentId
        }));
        conversation.messages.push(message);
        conversation.loading = false;
        conversation.loaded = true;
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function appendSwarmConversationMessages(clusterId, mode, messages) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.messages.push(...messages);
        conversation.pending = false;
        conversation.loaded = true;
        renderClusterWorkspace();
    }

    function clearSwarmConversationPending(clusterId, mode) {
        const conversation = ensureClusterConversation(getClusterConversationKey(clusterId, {
            targetKind: 'swarm',
            mode
        }));
        conversation.pending = false;
        renderClusterWorkspace();
    }

    function clearCurrentClusterPendingState() {
        const cluster = getCurrentCluster();
        if (!cluster) {
            return;
        }

        const conversation = ensureClusterConversation(getCurrentClusterTargetInfo(cluster).key);
        conversation.pending = false;
        conversation.loading = false;
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
        const source = trace.length > 0
            ? trace
            : (entry?.message ? [entry.message] : []);
        const deduped = [];
        const seen = new Set();

        source.forEach(message => {
            if (!message) {
                return;
            }

            const id = message.id || `${message.role}:${message.timestamp || ''}:${message.content || ''}`;
            if (seen.has(id)) {
                return;
            }
            seen.add(id);

            deduped.push({
                ...message,
                displayName,
                contextLabel
            });
        });

        return deduped;
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
                entries: result.contributions || {}
            }];
        const coordinatorLabel = result.coordinatorAgentId
            ? resolveAgentLabel(result.coordinatorAgentId)
            : t('clusters.targetSwarm');

        rounds.forEach(round => {
            const roundLabel = getCollaborationRoundLabel(round.kind, t);
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

        if (target.kind === 'agent') {
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

        if (target.kind === 'agent') {
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

