// OpenClaw Luna - Panel Agent Forms
'use strict';

    function selectAgent(agentId) {
        state.currentAgentId = agentId;
        document.querySelectorAll('.agent-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === agentId);
        });

        if (state.viewMode !== 'chat') {
            applyView('chat');
            vscode.postMessage({ type: 'switchView', view: 'chat' });
        }
        
        renderConsoleOverview();
        vscode.postMessage({ type: 'selectAgent', agentId });
    }

    function openNewAgentModal() {
        resetNewAgentForm();
        openModal(elements.modalNewAgent);
    }

    function setAgentPresets(presets) {
        state.agentPresets = Array.isArray(presets) ? presets : [];

        if (!state.agentPresets.some(preset => preset.id === state.newAgentPresetId)) {
            state.newAgentPresetId = CUSTOM_AGENT_PRESET_ID;
        }

        if (state.newAgentMode === 'preset' && state.newAgentPresetId === CUSTOM_AGENT_PRESET_ID && state.agentPresets[0]) {
            applySelectedAgentPreset(state.agentPresets[0].id, { resetToDefault: true });
            return;
        }

        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
    }

    function getSelectedAgentPreset() {
        return state.agentPresets.find(preset => preset.id === state.newAgentPresetId) || null;
    }

    function renderNewAgentMode() {
        const isPresetMode = state.newAgentMode === 'preset';

        elements.newAgentModeButtons?.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-new-agent-mode') === state.newAgentMode);
        });

        elements.newAgentPresetPanel?.classList.toggle('hidden', !isPresetMode);
        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
    }

    function renderNewAgentPresetGrid() {
        if (!elements.newAgentPresetGrid) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        if (!state.agentPresets.length) {
            elements.newAgentPresetGrid.innerHTML = `
                <div class="new-agent-preset-empty">${escapeHtml(t('newAgent.preset.empty'))}</div>
            `;
            return;
        }

        elements.newAgentPresetGrid.innerHTML = state.agentPresets.map((preset) => {
            const isSelected = preset.id === state.newAgentPresetId;
            return `
                <button
                    type="button"
                    class="new-agent-preset-card${isSelected ? ' selected' : ''}"
                    data-agent-preset-card="true"
                    data-agent-preset-id="${escapeHtml(preset.id)}"
                >
                    <span class="new-agent-preset-card-badge">${escapeHtml(preset.badge || preset.defaultName)}</span>
                    <div class="new-agent-preset-card-name">${escapeHtml(preset.defaultName)}</div>
                    <div class="new-agent-preset-card-title">${escapeHtml(preset.label)}</div>
                    <div class="new-agent-preset-card-description">${escapeHtml(preset.description)}</div>
                </button>
            `;
        }).join('');
    }

    function renderNewAgentPresetDescription() {
        if (!elements.newAgentPresetDescription) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = getSelectedAgentPreset();

        if (!preset) {
            elements.newAgentPresetDescription.innerHTML = `
                <div class="new-agent-preset-summary-label">${escapeHtml(t('newAgent.preset.galleryEyebrow'))}</div>
                <div class="new-agent-preset-summary-text">${escapeHtml(t('newAgent.preset.galleryHint'))}</div>
            `;
            return;
        }

        elements.newAgentPresetDescription.innerHTML = `
            <div class="new-agent-preset-summary-label">${escapeHtml(t('newAgent.preset.selected'))}</div>
            <div class="new-agent-preset-summary-head">
                <div class="new-agent-preset-summary-title">${escapeHtml(preset.label)}</div>
                <span class="new-agent-preset-summary-badge">${escapeHtml(preset.badge || preset.defaultName)}</span>
            </div>
            <div class="new-agent-preset-summary-grid">
                ${renderPresetSummaryDetail(t('newAgent.preset.useWhen'), preset.description)}
                ${renderPresetSummaryDetail(t('newAgent.preset.recommendedModel'), preset.recommendedModel)}
                ${renderPresetSummaryDetail(t('newAgent.preset.failureSignals'), preset.failureSignals)}
                ${renderPresetSummaryDetail(t('newAgent.preset.outputStandard'), preset.outputStandard)}
            </div>
        `;
    }

    function renderPresetSummaryDetail(label, value) {
        return `
            <div class="new-agent-preset-detail">
                <div class="new-agent-preset-detail-label">${escapeHtml(label)}</div>
                <div class="new-agent-preset-detail-value">${escapeHtml(value || '-')}</div>
            </div>
        `;
    }

    function setNewAgentMode(mode, options = { resetToDefault: true }) {
        const nextMode = mode === 'preset' ? 'preset' : 'custom';
        if (state.newAgentMode === nextMode) {
            renderNewAgentMode();
            return;
        }

        state.newAgentMode = nextMode;

        if (state.newAgentMode === 'preset') {
            const nextPresetId = getSelectedAgentPreset()?.id || state.agentPresets[0]?.id || CUSTOM_AGENT_PRESET_ID;
            if (nextPresetId !== CUSTOM_AGENT_PRESET_ID) {
                applySelectedAgentPreset(nextPresetId, { resetToDefault: true });
            } else {
                renderNewAgentMode();
            }
            return;
        }

        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, {
            resetToDefault: options.resetToDefault !== false
        });
    }

    function applySelectedAgentPreset(presetId, options = { resetToDefault: false }) {
        state.newAgentPresetId = presetId || CUSTOM_AGENT_PRESET_ID;

        const preset = getSelectedAgentPreset();
        if (preset) {
            if (elements.newAgentName) {
                elements.newAgentName.value = preset.defaultName;
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = preset.systemPrompt;
            }
        } else if (options.resetToDefault) {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            if (elements.newAgentName) {
                elements.newAgentName.value = '';
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = t('newAgent.defaultSystemPrompt');
            }
        }

        renderNewAgentMode();
        renderNewAgentPresetDescription();
    }

    function resetNewAgentForm() {
        elements.formNewAgent?.reset();
        state.newAgentMode = 'custom';
        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, { resetToDefault: true });
    }

    // Populate model select dropdown
    function populateModelSelect(models) {
        const modelSelect = elements.newAgentModel;
        if (!modelSelect) return;
        
        modelSelect.innerHTML = '';
        
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = 'default';
            option.textContent = 'default';
            modelSelect.appendChild(option);
            return;
        }
        
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
    }

    // Create agent
    function createAgent() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = state.newAgentMode === 'preset' ? getSelectedAgentPreset() : null;
        const data = {
            name: elements.newAgentName?.value?.trim() || '',
            model: elements.newAgentModel?.value?.trim() || '',
            systemPrompt: elements.newAgentPrompt?.value?.trim() || t('newAgent.defaultSystemPrompt'),
            presetId: preset?.id || undefined
        };

        if (state.newAgentMode === 'preset' && !preset) {
            showError(t('newAgent.preset.required'));
            return;
        }

        if (!data.name || !data.model) {
            return;
        }

        if (agentMutationTimer) {
            window.clearTimeout(agentMutationTimer);
            agentMutationTimer = null;
        }
        state.agentMutation = {
            action: 'create',
            pending: true,
            agentName: data.name,
            agentId: ''
        };
        renderAgents(state.agents);

        vscode.postMessage({ type: 'createAgent', data });
        closeAllModals();
        resetNewAgentForm();
    }

    // Show agent settings
    function renderAgentSkillsPicker(enabledSkills) {
        if (!elements.agentSkillsPicker) {
            return;
        }

        const selected = new Set(Array.isArray(enabledSkills) ? enabledSkills : []);
        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        if (skills.length === 0) {
            elements.agentSkillsPicker.innerHTML = '';
            return;
        }

        elements.agentSkillsPicker.innerHTML = skills.map(skill => `
            <label class="cluster-agent-option">
                <input type="checkbox" value="${escapeHtml(skill.id)}"${selected.has(skill.id) ? ' checked' : ''}>
                <div>
                    <div class="cluster-agent-option-title">${escapeHtml(skill.label || skill.id)}</div>
                    <div class="cluster-agent-option-meta">${escapeHtml(skill.description || '')}</div>
                </div>
            </label>
        `).join('');
    }

    function renderAgentSkillLinks() {
        if (!elements.agentSkillLinks) {
            return;
        }

        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        if (skills.length === 0) {
            elements.agentSkillLinks.innerHTML = '';
            return;
        }

        const uniqueLinks = new Map();
        skills.forEach(skill => {
            const url = String(skill.downloadUrl || '').trim();
            if (!url || uniqueLinks.has(url)) {
                return;
            }
            const defaultLinkLabel = t('agentSettings.skills.downloadLink');
            const defaultLinkDescription = t('agentSettings.skills.downloadHint');
            uniqueLinks.set(url, {
                label: skill.linkLabel || (defaultLinkLabel === 'agentSettings.skills.downloadLink' ? 'Skill Download Address' : defaultLinkLabel),
                description: skill.linkDescription || (defaultLinkDescription === 'agentSettings.skills.downloadHint' ? 'Open the skill catalog or repository in your browser.' : defaultLinkDescription)
            });
        });

        elements.agentSkillLinks.innerHTML = Array.from(uniqueLinks.entries()).map(([url, entry]) => `
            <button type="button" class="btn skill-link-card" data-skill-url="${escapeHtml(url)}">
                <div class="skill-link-card-title">${escapeHtml(entry.label)}</div>
                <div class="skill-link-card-meta">${escapeHtml(entry.description)}</div>
            </button>
        `).join('');
    }

    function showAgentSettings(agent) {
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        const modal = document.getElementById('modal-agent-settings');
        if (!modal) return;
        
        const idField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        const skillsLabel = document.getElementById('settings-agent-skills-label');
        const skillLinksLabel = document.getElementById('settings-agent-skills-links-label');

        if (idField) idField.value = agent.id;
        if (nameField) nameField.value = agent.name;
        if (promptField) promptField.value = agent.systemPrompt || '';
        if (tempField) {
            tempField.value = agent.temperature || 0.7;
            // Update range value display
            const parent = tempField.parentElement;
            if (parent) {
                const valueDisplay = parent.querySelector('.range-value');
                if (valueDisplay) valueDisplay.textContent = tempField.value;
            }
        }
        if (maxTokensField) maxTokensField.value = agent.maxTokens || 4096;
        if (skillsLabel) {
            const label = t('agentSettings.skills.label');
            skillsLabel.textContent = label === 'agentSettings.skills.label' ? 'AI Skills' : label;
        }
        if (skillLinksLabel) {
            const label = t('agentSettings.skills.resources');
            skillLinksLabel.textContent = label === 'agentSettings.skills.resources' ? 'Skill Resources' : label;
        }
        if (elements.agentSkillsHint) {
            const hint = t('agentSettings.skills.hint');
            elements.agentSkillsHint.textContent = hint === 'agentSettings.skills.hint'
                ? 'Enable the skills this agent should apply during reasoning and response generation.'
                : hint;
        }
        renderAgentSkillsPicker(agent.enabledSkills || []);
        renderAgentSkillLinks();
        
        openModal(modal);
    }

    // Save agent settings
    function saveAgentSettings() {
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        const agentIdField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        const enabledSkills = Array.from(elements.agentSkillsPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);
        
        const agentId = agentIdField ? agentIdField.value : '';
        const settings = {
            name: nameField ? nameField.value : '',
            systemPrompt: promptField ? promptField.value : '',
            temperature: tempField ? parseFloat(tempField.value) : 0.7,
            maxTokens: maxTokensField ? parseInt(maxTokensField.value) : 4096,
            enabledSkills
        };
        
        vscode.postMessage({ type: 'saveAgentSettings', agentId, settings });
        closeAllModals();
    }

