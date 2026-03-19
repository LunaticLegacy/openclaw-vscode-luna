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
            briefing: '',
            memberBlueprints: []
        };
        return {
            presetId: preset.id,
            collaborationStyle: preset.collaborationStyle,
            deliveryStyle: preset.deliveryStyle,
            critiqueLevel: preset.critiqueLevel,
            rounds: preset.rounds,
            runUntilConditionMet: false,
            stopCondition: '',
            briefing: preset.briefing || '',
            coordinatorAgentId: '',
            memberProfiles: {}
        };
    }

    function getClusterWorkModePresetMemberBlueprints(preset) {
        if (!Array.isArray(preset?.memberBlueprints)) {
            return [];
        }

        return preset.memberBlueprints
            .filter(blueprint => blueprint && typeof blueprint === 'object')
            .map(blueprint => ({
                id: String(blueprint.id || '').trim(),
                title: String(blueprint.title || '').trim(),
                identity: String(blueprint.identity || '').trim(),
                stance: String(blueprint.stance || '').trim(),
                parentId: String(blueprint.parentId || '').trim(),
                isCoordinator: Boolean(blueprint.isCoordinator),
                activation: normalizeClusterMemberActivation(blueprint.activation)
            }))
            .filter(blueprint => blueprint.id && blueprint.title);
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
            runUntilConditionMet: Boolean(config.runUntilConditionMet && String(config.stopCondition || '').trim()),
            stopCondition: typeof config.stopCondition === 'string' ? config.stopCondition.trim() : '',
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
            const parentAgentId = String(profile.parentAgentId || '').trim();
            const activation = normalizeClusterMemberActivation(profile.activation);
            if (!normalizedAgentId || (!identity && !stance && !parentAgentId && !activation)) {
                return;
            }

            normalized[normalizedAgentId] = {
                ...(identity ? { identity } : {}),
                ...(stance ? { stance } : {}),
                ...(parentAgentId ? { parentAgentId } : {}),
                ...(activation ? { activation } : {})
            };
        });

        return normalized;
    }

    function normalizeClusterMemberActivation(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const swarmModes = Array.isArray(value.swarmModes)
            ? Array.from(new Set(value.swarmModes.filter(mode => mode === 'broadcast' || mode === 'collaborate')))
            : undefined;
        const keywords = Array.isArray(value.keywords)
            ? Array.from(new Set(
                value.keywords
                    .map(keyword => String(keyword || '').trim())
                    .filter(Boolean)
            ))
            : undefined;

        if ((!swarmModes || swarmModes.length === 0) && (!keywords || keywords.length === 0)) {
            return swarmModes ? { swarmModes: [] } : undefined;
        }

        return {
            ...(swarmModes ? { swarmModes } : {}),
            ...(keywords && keywords.length > 0 ? { keywords } : {})
        };
    }

    function resolveClusterMemberActivation(profile) {
        const activation = normalizeClusterMemberActivation(profile?.activation);
        return {
            swarmModes: activation?.swarmModes ? [...activation.swarmModes] : ['broadcast', 'collaborate'],
            keywords: activation?.keywords ? [...activation.keywords] : []
        };
    }

    function resolveClusterMemberParentAgentId(profile, agentId, selectedAgentIds) {
        const normalizedParentId = String(profile?.parentAgentId || '').trim();
        if (!normalizedParentId || normalizedParentId === agentId) {
            return '';
        }

        return Array.isArray(selectedAgentIds) && selectedAgentIds.includes(normalizedParentId)
            ? normalizedParentId
            : '';
    }

    function buildClusterPresetMemberProfiles(selectedAgentIds, preset, options = {}) {
        const normalizedSelectedAgentIds = Array.isArray(selectedAgentIds) ? selectedAgentIds.map(agentId => String(agentId || '').trim()).filter(Boolean) : [];
        const existingProfiles = normalizeClusterMemberProfiles(options.existingProfiles);
        const blueprints = getClusterWorkModePresetMemberBlueprints(preset);
        const slotAgentIdByBlueprintId = new Map();

        blueprints.forEach((blueprint, index) => {
            const agentId = normalizedSelectedAgentIds[index];
            if (agentId) {
                slotAgentIdByBlueprintId.set(blueprint.id, agentId);
            }
        });

        const profiles = {};
        normalizedSelectedAgentIds.forEach((agentId, index) => {
            const blueprint = blueprints[index] || null;
            const existingProfile = existingProfiles[agentId];
            if (!blueprint) {
                if (existingProfile && options.preserveExisting !== false) {
                    profiles[agentId] = existingProfile;
                }
                return;
            }

            const generatedProfile = {
                ...(blueprint.identity ? { identity: blueprint.identity } : {}),
                ...(blueprint.stance ? { stance: blueprint.stance } : {}),
                ...(blueprint.parentId && slotAgentIdByBlueprintId.get(blueprint.parentId)
                    ? { parentAgentId: slotAgentIdByBlueprintId.get(blueprint.parentId) }
                    : {}),
                ...(blueprint.activation ? { activation: blueprint.activation } : {})
            };

            profiles[agentId] = options.preserveExisting !== false && existingProfile
                ? existingProfile
                : generatedProfile;
        });

        return normalizeClusterMemberProfiles(profiles);
    }

    function resolveClusterPresetCoordinatorAgentId(selectedAgentIds, preset, fallbackCoordinatorAgentId, options = {}) {
        const normalizedSelectedAgentIds = Array.isArray(selectedAgentIds) ? selectedAgentIds.map(agentId => String(agentId || '').trim()).filter(Boolean) : [];
        const normalizedFallbackId = String(fallbackCoordinatorAgentId || '').trim();
        if (options.preserveExisting !== false && normalizedFallbackId && normalizedSelectedAgentIds.includes(normalizedFallbackId)) {
            return normalizedFallbackId;
        }

        const blueprints = getClusterWorkModePresetMemberBlueprints(preset);
        const coordinatorIndex = blueprints.findIndex(blueprint => blueprint.isCoordinator);
        if (coordinatorIndex >= 0 && normalizedSelectedAgentIds[coordinatorIndex]) {
            return normalizedSelectedAgentIds[coordinatorIndex];
        }

        return normalizedSelectedAgentIds[0] || '';
    }

    function normalizeClusterRoundsInput(value, fallback = 1) {
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(Number(fallback) || 1)));
        }

        return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(parsedValue)));
    }

    function syncClusterRoundModeState() {
        const isUnlimited = Boolean(elements.clusterEditorRoundsUnlimited?.checked);
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.disabled = isUnlimited;
        }
        if (elements.clusterEditorStopConditionGroup) {
            elements.clusterEditorStopConditionGroup.classList.toggle('hidden', !isUnlimited);
        }
    }

    function getClusterRoundsSummaryLabel(roundsValue, runUntilConditionMet, stopCondition) {
        if (!runUntilConditionMet) {
            return t('clusters.rounds.value', { count: roundsValue }) || String(roundsValue);
        }

        const condition = String(stopCondition || '').trim();
        if (!condition) {
            return t('clusters.rounds.unlimited') || 'Unlimited rounds';
        }

        return t('clusters.rounds.untilCondition', { condition })
            || `Until: ${condition}`;
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
        syncClusterRoundModeState();
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
            : '';

        elements.clusterEditorCoordinatorAgent.innerHTML = [
            `<option value="">${escapeHtml(t('clusters.form.coordinatorAuto'))}</option>`,
            ...options.map(agent => `
            <option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}${agent.model ? ` (${escapeHtml(agent.model)})` : ''}</option>
        `)
        ].join('');
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
            const activation = resolveClusterMemberActivation(profile);
            const parentAgentId = resolveClusterMemberParentAgentId(profile, agentId, selectedAgentIds);
            const wakeKeywords = activation.keywords.join(', ');
            const parentOptions = [
                `<option value="">${escapeHtml(t('clusters.form.memberParentRoot'))}</option>`,
                ...selectedAgentIds
                    .filter(candidateId => candidateId !== agentId)
                    .map(candidateId => `
                        <option value="${escapeHtml(candidateId)}"${candidateId === parentAgentId ? ' selected' : ''}>
                            ${escapeHtml(resolveClusterAgentLabel(candidateId))}
                        </option>
                    `)
            ].join('');
            return `
                <section class="cluster-member-profile-card" data-cluster-member-profile="${escapeHtml(agentId)}">
                    <div class="cluster-member-profile-header">
                        <div>
                            <div class="cluster-member-profile-title">${escapeHtml(agent?.name || agentId)}</div>
                            <div class="cluster-member-profile-meta">${escapeHtml(agent?.model || agentId)}</div>
                        </div>
                        <div class="cluster-member-profile-badges">
                            <span class="cluster-member-profile-badge">${escapeHtml(t('clusters.form.memberProfiles'))}</span>
                        </div>
                    </div>
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
                    <div class="form-group">
                        <label for="cluster-member-parent-${escapeHtml(agentId)}">${escapeHtml(t('clusters.form.memberParent'))}</label>
                        <select
                            id="cluster-member-parent-${escapeHtml(agentId)}"
                            data-cluster-member-parent="${escapeHtml(agentId)}"
                        >
                            ${parentOptions}
                        </select>
                        <div class="form-hint">${escapeHtml(t('clusters.form.memberParentHint'))}</div>
                    </div>
                    <div class="form-group">
                        <label>${escapeHtml(t('clusters.form.memberWakeModes'))}</label>
                        <div class="cluster-member-mode-grid">
                            <label class="cluster-member-mode-option">
                                <input
                                    type="checkbox"
                                    data-cluster-member-mode="${escapeHtml(agentId)}"
                                    value="broadcast"
                                    ${activation.swarmModes.includes('broadcast') ? 'checked' : ''}
                                >
                                <span>${escapeHtml(t('clusters.form.memberWakeBroadcast'))}</span>
                            </label>
                            <label class="cluster-member-mode-option">
                                <input
                                    type="checkbox"
                                    data-cluster-member-mode="${escapeHtml(agentId)}"
                                    value="collaborate"
                                    ${activation.swarmModes.includes('collaborate') ? 'checked' : ''}
                                >
                                <span>${escapeHtml(t('clusters.form.memberWakeCollaborate'))}</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="cluster-member-keywords-${escapeHtml(agentId)}">${escapeHtml(t('clusters.form.memberWakeKeywords'))}</label>
                        <input
                            type="text"
                            id="cluster-member-keywords-${escapeHtml(agentId)}"
                            data-cluster-member-keywords="${escapeHtml(agentId)}"
                            value="${escapeHtml(wakeKeywords)}"
                            placeholder="${escapeHtml(t('clusters.form.memberWakeKeywordPlaceholder'))}"
                        >
                        <div class="form-hint">${escapeHtml(t('clusters.form.memberWakeKeywordsHint'))}</div>
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
            const parentAgentId = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-parent="${agentId}"]`)?.value || '').trim();
            const selectedModes = Array.from(elements.clusterEditorMemberProfiles?.querySelectorAll(`[data-cluster-member-mode="${agentId}"]:checked`) || [])
                .map(input => String(input.value || '').trim())
                .filter(mode => mode === 'broadcast' || mode === 'collaborate');
            const keywords = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-keywords="${agentId}"]`)?.value || '')
                .split(',')
                .map(keyword => keyword.trim())
                .filter(Boolean);
            const activation = normalizeClusterMemberActivation({
                swarmModes: selectedModes,
                keywords
            });

            if (!identity && !stance && !parentAgentId && !activation) {
                return;
            }

            profiles[agentId] = {
                ...(identity ? { identity } : {}),
                ...(stance ? { stance } : {}),
                ...(parentAgentId ? { parentAgentId } : {}),
                ...(activation ? { activation } : {})
            };
        });

        return profiles;
    }

    function syncClusterMemberCustomizationState(options = {}) {
        const selectedAgentIds = getSelectedClusterEditorAgentIds();
        const preset = getClusterWorkModePresetById(elements.clusterEditorPreset?.value);
        const sourceProfiles = options.memberProfiles || readClusterMemberProfilesFromEditor();
        const memberProfiles = options.applyPresetProfiles !== false
            ? buildClusterPresetMemberProfiles(selectedAgentIds, preset, {
                existingProfiles: sourceProfiles,
                preserveExisting: options.preserveExistingProfiles !== false
            })
            : sourceProfiles;
        const coordinatorAgentId = options.coordinatorAgentId !== undefined
            ? options.coordinatorAgentId
            : resolveClusterPresetCoordinatorAgentId(
                selectedAgentIds,
                preset,
                elements.clusterEditorCoordinatorAgent?.value || '',
                { preserveExisting: options.preserveExistingCoordinator !== false }
            );
        renderClusterCoordinatorOptions(selectedAgentIds, coordinatorAgentId);
        if (elements.clusterEditorCoordinatorAgent) {
            elements.clusterEditorCoordinatorAgent.value = coordinatorAgentId;
        }
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
        const runUntilConditionMet = Boolean(elements.clusterEditorRoundsUnlimited?.checked);
        const stopCondition = String(elements.clusterEditorStopCondition?.value || '').trim();
        const briefing = String(elements.clusterEditorBriefing?.value || '').trim();
        const coordinatorId = String(elements.clusterEditorCoordinatorAgent?.value || '').trim();
        const coordinatorLabel = coordinatorId ? resolveClusterAgentLabel(coordinatorId) : t('clusters.form.coordinatorAuto');
        const presetBlueprints = getClusterWorkModePresetMemberBlueprints(preset);
        const selectedAgentIds = getSelectedClusterEditorAgentIds();
        const presetBlueprintsHtml = presetBlueprints.length > 0
            ? `
                <div class="cluster-preset-blueprints">
                    <div class="cluster-preset-blueprints-label">${escapeHtml(t('clusters.preset.memberBlueprints'))}</div>
                    <div class="cluster-preset-blueprints-grid">
                        ${presetBlueprints.map((blueprint, index) => {
                            const assignedAgentId = selectedAgentIds[index] || '';
                            const assignedAgentLabel = assignedAgentId ? resolveClusterAgentLabel(assignedAgentId) : '';
                            const activation = normalizeClusterMemberActivation(blueprint.activation);
                            const resolvedActivation = {
                                swarmModes: activation?.swarmModes ? [...activation.swarmModes] : ['broadcast', 'collaborate'],
                                keywords: activation?.keywords ? [...activation.keywords] : []
                            };
                            const routeLabel = blueprint.parentId
                                ? `${t('clusters.preset.slotReportsTo')}: ${((presetBlueprints.find(item => item.id === blueprint.parentId) || {}).title || blueprint.parentId)}`
                                : t('clusters.preset.slotDirect');
                            const modeLabels = resolvedActivation.swarmModes.length > 0
                                ? resolvedActivation.swarmModes.map(mode => mode === 'broadcast' ? t('clusters.form.memberWakeBroadcast') : t('clusters.form.memberWakeCollaborate')).join(' / ')
                                : t('clusters.topology.sleeping');
                            return `
                                <div class="cluster-preset-blueprint-card">
                                    <div class="cluster-preset-blueprint-head">
                                        <div>
                                            <div class="cluster-preset-blueprint-title">${escapeHtml(blueprint.title)}</div>
                                            <div class="cluster-preset-blueprint-meta">${escapeHtml(routeLabel)}</div>
                                        </div>
                                        ${blueprint.isCoordinator ? `<span class="cluster-member-profile-badge">${escapeHtml(t('clusters.preset.slotCoordinator'))}</span>` : ''}
                                    </div>
                                    <div class="cluster-preset-blueprint-identity">${escapeHtml(blueprint.identity)}</div>
                                    <div class="cluster-preset-blueprint-stance">${escapeHtml(blueprint.stance)}</div>
                                    <div class="cluster-preset-blueprint-meta-row">${escapeHtml(`${t('clusters.preset.slotWakeModes')}: ${modeLabels}`)}</div>
                                    ${resolvedActivation.keywords.length > 0
                                        ? `<div class="cluster-preset-blueprint-meta-row">${escapeHtml(`${t('clusters.topology.keywordRule')}: ${resolvedActivation.keywords.join(', ')}`)}</div>`
                                        : ''}
                                    ${assignedAgentLabel
                                        ? `<div class="cluster-preset-blueprint-assigned">${escapeHtml(`${t('clusters.preset.slotAssigned')}: ${assignedAgentLabel}`)}</div>`
                                        : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `
            : '';

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
                    <div class="cluster-preset-summary-value">${escapeHtml(getClusterRoundsSummaryLabel(roundsValue, runUntilConditionMet, stopCondition))}</div>
                </div>
                <div class="cluster-preset-summary-item">
                    <div class="cluster-preset-summary-label">${escapeHtml(t('clusters.form.coordinator'))}</div>
                    <div class="cluster-preset-summary-value">${escapeHtml(coordinatorLabel)}</div>
                </div>
            </div>
            ${runUntilConditionMet && stopCondition
                ? `<p>${escapeHtml(`${t('clusters.form.stopCondition')}: ${stopCondition}`)}</p>`
                : ''}
            ${briefing ? `<p>${escapeHtml(briefing)}</p>` : ''}
            ${presetBlueprintsHtml}
        `;
    }

    function applyClusterPreset(presetId, options = {}) {
        const preset = getClusterWorkModePresetById(presetId);
        if (!preset) {
            return;
        }
        const selectedAgentIds = options.selectedAgentIds || getSelectedClusterEditorAgentIds();
        const memberProfiles = buildClusterPresetMemberProfiles(selectedAgentIds, preset, {
            existingProfiles: options.memberProfiles,
            preserveExisting: options.preserveExistingProfiles
        });
        const coordinatorAgentId = resolveClusterPresetCoordinatorAgentId(
            selectedAgentIds,
            preset,
            options.coordinatorAgentId,
            { preserveExisting: options.preserveExistingCoordinator }
        );

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
        if (elements.clusterEditorRoundsUnlimited) {
            elements.clusterEditorRoundsUnlimited.checked = false;
        }
        if (elements.clusterEditorStopCondition) {
            elements.clusterEditorStopCondition.value = '';
        }
        syncClusterRoundModeState();
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = preset.briefing || '';
        }
        renderClusterCoordinatorOptions(selectedAgentIds, coordinatorAgentId);
        if (elements.clusterEditorCoordinatorAgent) {
            elements.clusterEditorCoordinatorAgent.value = coordinatorAgentId;
        }
        renderClusterMemberProfiles(selectedAgentIds, memberProfiles);

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
        resetClusterBatchCreateInputs();
        applyClusterPreset(config.presetId, {
            selectedAgentIds,
            memberProfiles: config.memberProfiles || {},
            coordinatorAgentId: config.coordinatorAgentId || '',
            preserveExistingProfiles: true,
            preserveExistingCoordinator: true
        });

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
        if (elements.clusterEditorRoundsUnlimited) {
            elements.clusterEditorRoundsUnlimited.checked = Boolean(config.runUntilConditionMet);
        }
        if (elements.clusterEditorStopCondition) {
            elements.clusterEditorStopCondition.value = config.stopCondition || '';
        }
        syncClusterRoundModeState();
        if (elements.clusterEditorBriefing) {
            elements.clusterEditorBriefing.value = config.briefing || '';
        }
        renderClusterCoordinatorOptions(selectedAgentIds, config.coordinatorAgentId || '');
        if (elements.clusterEditorCoordinatorAgent) {
            elements.clusterEditorCoordinatorAgent.value = config.coordinatorAgentId || '';
        }
        renderClusterMemberProfiles(selectedAgentIds, config.memberProfiles || {});

        renderClusterPresetSummary();
        openModal(elements.modalClusterEditor);
    }

    function saveClusterEditor() {
        const clusterId = String(elements.clusterEditorId?.value || '').trim();
        const name = String(elements.clusterEditorName?.value || '').trim();
        const selectedAgentIds = Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);
        const createAgents = readClusterBatchAgentDrafts();

        if (!name) {
            showError(t('clusters.validationName'));
            return;
        }

        if (selectedAgentIds.length === 0 && createAgents.length === 0) {
            showError(t('clusters.validationAgents'));
            return;
        }

        if (createAgents.some(agent => !String(agent.model || '').trim())) {
            showError(t('agentBatch.validationModel'));
            return;
        }

        if (elements.clusterEditorRoundsUnlimited?.checked && !String(elements.clusterEditorStopCondition?.value || '').trim()) {
            showError(t('clusters.validationStopCondition'));
            return;
        }

        vscode.postMessage({
            type: 'saveCluster',
            clusterId: clusterId || undefined,
            data: {
                name,
                agentIds: selectedAgentIds,
                createAgents,
                workspaceConfig: {
                    presetId: elements.clusterEditorPreset?.value || 'implementation-squad',
                    collaborationStyle: elements.clusterEditorStyle?.value || 'leader-draft',
                    deliveryStyle: elements.clusterEditorDelivery?.value || 'balanced',
                    critiqueLevel: elements.clusterEditorCritique?.value || 'standard',
                    rounds: normalizeClusterRoundsInput(elements.clusterEditorRounds?.value || 2, 2),
                    runUntilConditionMet: Boolean(elements.clusterEditorRoundsUnlimited?.checked),
                    stopCondition: String(elements.clusterEditorStopCondition?.value || '').trim(),
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
        const coordinatorInfo = resolveClusterCoordinatorInfo(cluster);
        const preset = getClusterWorkModePresetById(config.presetId);
        elements.clusterWorkmodeSummary.innerHTML = [
            preset ? `<span class="cluster-workmode-chip">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</span>` : '',
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterStyleLabel(config.collaborationStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterDeliveryLabel(config.deliveryStyle))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterCritiqueLabel(config.critiqueLevel))}</span>`,
            `<span class="cluster-workmode-chip">${escapeHtml(getClusterRoundsSummaryLabel(config.rounds, config.runUntilConditionMet, config.stopCondition))}</span>`,
            coordinatorInfo.agentId
                ? `<span class="cluster-workmode-chip">${escapeHtml(`${t('clusters.form.coordinator')}: ${resolveClusterAgentLabel(coordinatorInfo.agentId)}${coordinatorInfo.isAuto ? ` (${t('clusters.topology.coordinatorAuto')})` : ''}`)}</span>`
                : ''
        ].filter(Boolean).join('');
    }

    function resolveClusterCoordinatorInfo(cluster) {
        const config = getClusterWorkModeConfig(cluster);
        const configuredAgentId = String(config.coordinatorAgentId || '').trim();
        if (configuredAgentId && cluster?.agentIds?.includes(configuredAgentId)) {
            return {
                agentId: configuredAgentId,
                isAuto: false
            };
        }

        return {
            agentId: Array.isArray(cluster?.agentIds) ? (cluster.agentIds[0] || '') : '',
            isAuto: true
        };
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

        const serverIndex = Array.isArray(state.serverClusters)
            ? state.serverClusters.findIndex(item => item.id === cluster.id)
            : -1;
        if (serverIndex >= 0) {
            state.serverClusters[serverIndex] = mergeClusterState(state.serverClusters[serverIndex], cluster);
        } else {
            state.serverClusters = [...(state.serverClusters || []), cluster];
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
