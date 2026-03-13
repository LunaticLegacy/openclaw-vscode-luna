// OpenClaw Luna - Panel Clusters
'use strict';

    function getClusterWorkModePresetById(presetId) {
        const normalizedPresetId = String(presetId || '').trim();
        const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
        return presets.find(preset => preset.id === normalizedPresetId)
            || presets.find(preset => preset.id === 'implementation-squad')
            || presets[0]
            || null;
    }

    function getDefaultClusterWorkModeConfig() {
        const preset = getClusterWorkModePresetById('implementation-squad') || {
            id: 'implementation-squad',
            presetId: 'implementation-squad',
            collaborationStyle: 'leader-draft',
            deliveryStyle: 'balanced',
            critiqueLevel: 'standard',
            rounds: 2,
            briefing: ''
        };
        return {
            presetId: preset.id,
            collaborationStyle: preset.collaborationStyle,
            deliveryStyle: preset.deliveryStyle,
            critiqueLevel: preset.critiqueLevel,
            rounds: preset.rounds,
            briefing: preset.briefing || '',
            coordinatorAgentId: '',
            memberProfiles: {}
        };
    }

    function getClusterWorkModeConfig(cluster) {
        const preset = getClusterWorkModePresetById(cluster?.workspaceConfig?.presetId);
        const base = preset
            ? {
                presetId: preset.id,
                collaborationStyle: preset.collaborationStyle,
                deliveryStyle: preset.deliveryStyle,
                critiqueLevel: preset.critiqueLevel,
                rounds: preset.rounds,
                briefing: preset.briefing || ''
            }
            : getDefaultClusterWorkModeConfig();
        const config = cluster?.workspaceConfig || {};
        return {
            presetId: String(config.presetId || base.presetId),
            collaborationStyle: ['debate', 'round-robin', 'review-board', 'leader-draft'].includes(config.collaborationStyle)
                ? config.collaborationStyle
                : base.collaborationStyle,
            deliveryStyle: ['fast', 'balanced', 'deep'].includes(config.deliveryStyle)
                ? config.deliveryStyle
                : base.deliveryStyle,
            critiqueLevel: ['minimal', 'standard', 'aggressive'].includes(config.critiqueLevel)
                ? config.critiqueLevel
                : base.critiqueLevel,
            rounds: normalizeClusterRoundsInput(config.rounds, base.rounds || 1),
            briefing: typeof config.briefing === 'string' && config.briefing.trim()
                ? config.briefing.trim()
                : (base.briefing || ''),
            coordinatorAgentId: typeof config.coordinatorAgentId === 'string' ? config.coordinatorAgentId.trim() : '',
            memberProfiles: normalizeClusterMemberProfiles(config.memberProfiles)
        };
    }

    function normalizeClusterMemberProfiles(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        const normalized = {};
        Object.entries(value).forEach(([agentId, profile]) => {
            if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
                return;
            }

            const normalizedAgentId = String(agentId || '').trim();
            const identity = String(profile.identity || '').trim();
            const stance = String(profile.stance || '').trim();
            if (!normalizedAgentId || (!identity && !stance)) {
                return;
            }

            normalized[normalizedAgentId] = {
                ...(identity ? { identity } : {}),
                ...(stance ? { stance } : {})
            };
        });

        return normalized;
    }

    function normalizeClusterRoundsInput(value, fallback = 1) {
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(Number(fallback) || 1)));
        }

        return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(parsedValue)));
    }

    function populateClusterEditorOptions() {
        if (elements.clusterEditorPreset) {
            const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
            elements.clusterEditorPreset.innerHTML = presets.map(preset => `
                <option value="${escapeHtml(preset.id)}">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</option>
            `).join('');
        }

        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.innerHTML = [
                ['debate', t('clusters.style.debate')],
                ['round-robin', t('clusters.style.roundRobin')],
                ['review-board', t('clusters.style.reviewBoard')],
                ['leader-draft', t('clusters.style.leaderDraft')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.innerHTML = [
                ['fast', t('clusters.delivery.fast')],
                ['balanced', t('clusters.delivery.balanced')],
                ['deep', t('clusters.delivery.deep')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.innerHTML = [
                ['minimal', t('clusters.critique.minimal')],
                ['standard', t('clusters.critique.standard')],
                ['aggressive', t('clusters.critique.aggressive')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.min = '1';
            elements.clusterEditorRounds.step = '1';
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(elements.clusterEditorRounds.value || 2, 2));
        }
    }

    function renderClusterAgentPicker(selectedAgentIds) {
        if (!elements.clusterEditorAgentPicker) {
            return;
        }

        if (!Array.isArray(state.agents) || state.agents.length === 0) {
            elements.clusterEditorAgentPicker.innerHTML = `<div class="cluster-agent-picker-empty">${escapeHtml(t('clusters.createAgentFirst'))}</div>`;
            return;
        }

        const selected = new Set(Array.isArray(selectedAgentIds) ? selectedAgentIds : []);
        elements.clusterEditorAgentPicker.innerHTML = state.agents.map(agent => `
            <label class="cluster-agent-option">
                <input type="checkbox" value="${escapeHtml(agent.id)}"${selected.has(agent.id) ? ' checked' : ''}>
                <div>
                    <div class="cluster-agent-option-title">${escapeHtml(agent.name)}</div>
                    <div class="cluster-agent-option-meta">${escapeHtml(agent.model || agent.id)}</div>
                </div>
            </label>
        `).join('');
    }

    function getSelectedClusterEditorAgentIds() {
        return Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => String(input.value || '').trim())
            .filter(Boolean);
    }

    function renderClusterCoordinatorOptions(selectedAgentIds, coordinatorAgentId) {
        if (!elements.clusterEditorCoordinatorAgent) {
            return;
        }

        const selected = new Set(Array.isArray(selectedAgentIds) ? selectedAgentIds : []);
        const options = state.agents.filter(agent => selected.has(agent.id));
        const normalizedCoordinatorId = options.some(agent => agent.id === coordinatorAgentId)
            ? coordinatorAgentId
            : (options[0]?.id || '');

        elements.clusterEditorCoordinatorAgent.innerHTML = options.map(agent => `
            <option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}${agent.model ? ` (${escapeHtml(agent.model)})` : ''}</option>
        `).join('');
        elements.clusterEditorCoordinatorAgent.value = normalizedCoordinatorId;
        elements.clusterEditorCoordinatorAgent.disabled = options.length === 0;
    }

    function renderClusterMemberProfiles(selectedAgentIds, memberProfiles) {
        if (!elements.clusterEditorMemberProfiles) {
            return;
        }

        const normalizedProfiles = normalizeClusterMemberProfiles(memberProfiles);
        if (!Array.isArray(selectedAgentIds) || selectedAgentIds.length === 0) {
            elements.clusterEditorMemberProfiles.innerHTML = `<div class="cluster-agent-picker-empty">${escapeHtml(t('clusters.form.memberProfilesEmpty'))}</div>`;
            return;
        }

        elements.clusterEditorMemberProfiles.innerHTML = selectedAgentIds.map(agentId => {
            const agent = state.agents.find(item => item.id === agentId);
            const profile = normalizedProfiles[agentId] || {};
            return `
                <section class="cluster-member-profile-card" data-cluster-member-profile="${escapeHtml(agentId)}">
                    <div class="cluster-member-profile-title">${escapeHtml(agent?.name || agentId)}</div>
                    <div class="cluster-member-profile-meta">${escapeHtml(agent?.model || agentId)}</div>
                    <div class="form-group">
                        <label for="cluster-member-identity-${escapeHtml(agentId)}">${escapeHtml(t('clusters.form.memberIdentity'))}</label>
                        <input
                            type="text"
                            id="cluster-member-identity-${escapeHtml(agentId)}"
                            data-cluster-member-identity="${escapeHtml(agentId)}"
                            value="${escapeHtml(profile.identity || '')}"
                            placeholder="${escapeHtml(t('clusters.form.memberIdentityPlaceholder'))}"
                        >
                    </div>
                    <div class="form-group">
                        <label for="cluster-member-stance-${escapeHtml(agentId)}">${escapeHtml(t('clusters.form.memberStance'))}</label>
                        <textarea
                            id="cluster-member-stance-${escapeHtml(agentId)}"
                            rows="3"
                            data-cluster-member-stance="${escapeHtml(agentId)}"
                            placeholder="${escapeHtml(t('clusters.form.memberStancePlaceholder'))}"
                        >${escapeHtml(profile.stance || '')}</textarea>
                    </div>
                </section>
            `;
        }).join('');
    }

    function readClusterMemberProfilesFromEditor() {
        const profiles = {};
        const selectedAgentIds = getSelectedClusterEditorAgentIds();

        selectedAgentIds.forEach(agentId => {
            const identity = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-identity="${agentId}"]`)?.value || '').trim();
            const stance = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-stance="${agentId}"]`)?.value || '').trim();
            if (!identity && !stance) {
                return;
            }

            profiles[agentId] = {
                ...(identity ? { identity } : {}),
                ...(stance ? { stance } : {})
            };
        });

        return profiles;
    }

    function syncClusterMemberCustomizationState(options = {}) {
        const selectedAgentIds = getSelectedClusterEditorAgentIds();
        const memberProfiles = options.memberProfiles || readClusterMemberProfilesFromEditor();
        const coordinatorAgentId = options.coordinatorAgentId || elements.clusterEditorCoordinatorAgent?.value || '';
        renderClusterCoordinatorOptions(selectedAgentIds, coordinatorAgentId);
        renderClusterMemberProfiles(selectedAgentIds, memberProfiles);
        renderClusterPresetSummary();
    }

    function renderClusterPresetSummary() {
        if (!elements.clusterPresetSummary) {
            return;
        }

        const preset = getClusterWorkModePresetById(elements.clusterEditorPreset?.value);
        const styleValue = elements.clusterEditorStyle?.value || 'leader-draft';
        const deliveryValue = elements.clusterEditorDelivery?.value || 'balanced';
        const critiqueValue = elements.clusterEditorCritique?.value || 'standard';
        const roundsValue = normalizeClusterRoundsInput(elements.clusterEditorRounds?.value || 2, 2);
        const briefing = String(elements.clusterEditorBriefing?.value || '').trim();
        const coordinatorId = String(elements.clusterEditorCoordinatorAgent?.value || '').trim();
        const coordinatorLabel = coordinatorId ? resolveClusterAgentLabel(coordinatorId) : t('clusters.form.coordinatorAuto');

        elements.clusterPresetSummary.innerHTML = `
            <h3>${escapeHtml(preset ? (t(`clusters.preset.${preset.id}.label`) || preset.id) : t('clusters.form.preset'))}</h3>
            <p>${escapeHtml(preset ? (t(`clusters.preset.${preset.id}.description`) || '') : '')}</p>
            <div class="cluster-preset-summary-grid">
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.collaborationStyle'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterStyleLabel(styleValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.deliveryStyle'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterDeliveryLabel(deliveryValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.critiqueLevel'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterCritiqueLabel(critiqueValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.rounds'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(t('clusters.rounds.value', { count: roundsValue }) || String(roundsValue))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.coordinator'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(coordinatorLabel)}</div>
                </div>
            </div>
            ${briefing ? `<p>${escapeHtml(briefing)}</p>` : ''}
        `;
    }

    function applyClusterPreset(presetId) {
        const preset = getClusterWorkModePresetById(presetId);
        if (!preset) {
            return;
        }

        if (elements.clusterEditorPreset) {
            elements.clusterEditorPreset.value = preset.id;
        }
        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.value = preset.collaborationStyle;
        }
        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.value = preset.deliveryStyle;
        }
        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.value = preset.critiqueLevel;
        }
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(preset.rounds, 2));
        }
        if (elements.clusterEditorBriefing && !String(elements.clusterEditorBriefing.value || '').trim()) {
            elements.clusterEditorBriefing.value = preset.briefing || '';
        }

        renderClusterPresetSummary();
    }

    function openClusterEditor(clusterId) {
        applyView('clusters');
        populateClusterEditorOptions();

        const cluster = clusterId
            ? state.clusters.find(item => item.id === clusterId) || null
            : null;
        const config = getClusterWorkModeConfig(cluster);
        const selectedAgentIds = cluster?.agentIds || state.agents.slice(0, Math.min(3, state.agents.length)).map(agent => agent.id);

        if (elements.clusterModalTitle) {
            elements.clusterModalTitle.textContent = cluster
                ? (t('clusters.editTitle', { name: cluster.name }) || cluster.name)
                : t('clusters.create');
        }
        if (elements.clusterEditorId) {
            elements.clusterEditorId.value = cluster?.id || '';
        }
        if (elements.clusterEditorName) {
            elements.clusterEditorName.value = cluster?.name || '';
        }
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = config.briefing || '';
        }

        renderClusterAgentPicker(selectedAgentIds);
        renderClusterCoordinatorOptions(selectedAgentIds, config.coordinatorAgentId || selectedAgentIds[0] || '');
        renderClusterMemberProfiles(selectedAgentIds, config.memberProfiles || {});
        applyClusterPreset(config.presetId);

        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.value = config.collaborationStyle;
        }
        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.value = config.deliveryStyle;
        }
        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.value = config.critiqueLevel;
        }
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(config.rounds, 2));
        }
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = config.briefing || '';
        }
        if (elements.clusterEditorCoordinatorAgent) {
            elements.clusterEditorCoordinatorAgent.value = config.coordinatorAgentId || elements.clusterEditorCoordinatorAgent.value || selectedAgentIds[0] || '';
        }

        renderClusterPresetSummary();
        openModal(elements.modalClusterEditor);
    }

    function saveClusterEditor() {
        const clusterId = String(elements.clusterEditorId?.value || '').trim();
        const name = String(elements.clusterEditorName?.value || '').trim();
        const selectedAgentIds = Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);

        if (!name) {
            showError(t('clusters.validationName'));
            return;
        }

        if (selectedAgentIds.length === 0) {
            showError(t('clusters.validationAgents'));
            return;
        }

        vscode.postMessage({
            type: 'saveCluster',
            clusterId: clusterId || undefined,
            data: {
                name,
                agentIds: selectedAgentIds,
                workspaceConfig: {
                    presetId: elements.clusterEditorPreset?.value || 'implementation-squad',
                    collaborationStyle: elements.clusterEditorStyle?.value || 'leader-draft',
                    deliveryStyle: elements.clusterEditorDelivery?.value || 'balanced',
                    critiqueLevel: elements.clusterEditorCritique?.value || 'standard',
                    rounds: normalizeClusterRoundsInput(elements.clusterEditorRounds?.value || 2, 2),
                    briefing: String(elements.clusterEditorBriefing?.value || '').trim(),
                    coordinatorAgentId: String(elements.clusterEditorCoordinatorAgent?.value || '').trim(),
                    memberProfiles: readClusterMemberProfilesFromEditor()
                }
            }
        });
        closeAllModals();
    }

    function renderClusterWorkmodeSummary(cluster) {
        if (!elements.clusterWorkmodeSummary) {
            return;
        }

        const config = getClusterWorkModeConfig(cluster);
        const preset = getClusterWorkModePresetById(config.presetId);
        elements.clusterWorkmodeSummary.innerHTML = [
            preset ? `<span class="cluster-workmode-chip">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</span>` : '',
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterStyleLabel(config.collaborationStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterDeliveryLabel(config.deliveryStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterCritiqueLabel(config.critiqueLevel))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(t('clusters.rounds.value', { count: config.rounds }) || String(config.rounds))}</span>`,
            config.coordinatorAgentId ? `<span class="cluster-workmode-chip">${escapeHtml(`${t('clusters.form.coordinator')}: ${resolveClusterAgentLabel(config.coordinatorAgentId)}`)}</span>` : ''
        ].filter(Boolean).join('');
    }

    function mergeClusterState(existingCluster, nextCluster) {
        if (!nextCluster || !nextCluster.id) {
            return existingCluster || nextCluster;
        }

        return {
            ...(existingCluster || {}),
            ...nextCluster,
            agentIds: Array.isArray(nextCluster.agentIds)
                ? [...nextCluster.agentIds]
                : Array.isArray(existingCluster?.agentIds)
                    ? [...existingCluster.agentIds]
                    : [],
            workspaceConfig: nextCluster.workspaceConfig
                ? {
                    ...(existingCluster?.workspaceConfig || {}),
                    ...nextCluster.workspaceConfig
                }
                : existingCluster?.workspaceConfig
        };
    }

    function getClusterStyleLabel(value) {
        switch (value) {
            case 'debate':
                return t('clusters.style.debate');
            case 'round-robin':
                return t('clusters.style.roundRobin');
            case 'review-board':
                return t('clusters.style.reviewBoard');
            case 'leader-draft':
            default:
                return t('clusters.style.leaderDraft');
        }
    }

    function getClusterDeliveryLabel(value) {
        switch (value) {
            case 'fast':
                return t('clusters.delivery.fast');
            case 'deep':
                return t('clusters.delivery.deep');
            case 'balanced':
            default:
                return t('clusters.delivery.balanced');
        }
    }

    function getClusterCritiqueLabel(value) {
        switch (value) {
            case 'minimal':
                return t('clusters.critique.minimal');
            case 'aggressive':
                return t('clusters.critique.aggressive');
            case 'standard':
            default:
                return t('clusters.critique.standard');
        }
    }

    function upsertClusterState(cluster, options = {}) {
        if (!cluster || !cluster.id) {
            return;
        }

        const index = state.clusters.findIndex(item => item.id === cluster.id);
        const mergedCluster = mergeClusterState(index >= 0 ? state.clusters[index] : null, cluster);
        if (index >= 0) {
            state.clusters[index] = mergedCluster;
        } else {
            state.clusters.push(mergedCluster);
        }

        if (options.select !== false) {
            state.currentClusterId = mergedCluster.id;
        }

        ensureCurrentClusterSelection();
        renderClusterSidebarList(state.clusters);
        renderClusterWorkspace();
        renderConsoleOverview();
    }

    // Render clusters
