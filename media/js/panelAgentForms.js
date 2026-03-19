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
        if (elements.modalSkillMarket?.classList.contains('active')) {
            renderSkillMarket();
        }
        vscode.postMessage({ type: 'selectAgent', agentId });
    }

    function installSkill(skillId, hubId) {
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }

        const installBtn = document.querySelector(`[data-skill-install="${escapeHtml(skillId)}"]`);
        if (installBtn) {
            const originalText = installBtn.textContent;
            installBtn.textContent = t('skillMarket.installing') || 'Installing...';
            installBtn.disabled = true;

            setTimeout(() => {
                if (installBtn) {
                    installBtn.textContent = originalText;
                    installBtn.disabled = false;
                }
            }, 3000);
        }

        vscode.postMessage({
            type: 'installSkill',
            skillId: skillId,
            hubId: hubId || null
        });
    }

    function uninstallSkill(skillId) {
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }

        const uninstallBtn = document.querySelector(`[data-skill-uninstall="${escapeHtml(skillId)}"]`);
        if (uninstallBtn) {
            const originalText = uninstallBtn.textContent;
            uninstallBtn.textContent = t('skillMarket.uninstalling') || 'Uninstalling...';
            uninstallBtn.disabled = true;

            setTimeout(() => {
                if (uninstallBtn) {
                    uninstallBtn.textContent = originalText;
                    uninstallBtn.disabled = false;
                }
            }, 3000);
        }

        vscode.postMessage({
            type: 'uninstallSkill',
            skillId: skillId
        });
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
        renderAgentOnboarding();
    }

    function getAgentPresetById(presetId) {
        return state.agentPresets.find(preset => preset.id === presetId) || null;
    }

    function getSelectedAgentPreset() {
        return getAgentPresetById(state.newAgentPresetId);
    }

    function getSelectedAgentOnboardingPreset() {
        return getAgentPresetById(state.agentOnboardingPresetId);
    }

    function renderNewAgentMode() {
        const isPresetMode = state.newAgentMode === 'preset';
        const isBatchMode = state.newAgentMode === 'batch';

        elements.newAgentModeButtons?.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-new-agent-mode') === state.newAgentMode);
        });

        elements.newAgentPresetPanel?.classList.toggle('hidden', !isPresetMode);
        elements.newAgentSingleFields?.classList.toggle('hidden', isBatchMode);
        elements.newAgentBatchPanel?.classList.toggle('hidden', !isBatchMode);
        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
        renderBatchCreateAgentsStatus();
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

    function resolveCurrentAgent() {
        return state.agents.find(agent => agent.id === state.currentAgentId) || null;
    }

    function resolveOnboardingPromptSeed(agent) {
        const prompt = String(agent?.systemPrompt || '').trim();
        if (prompt) {
            return prompt;
        }

        const fallback = t('newAgent.defaultSystemPrompt');
        return fallback === 'newAgent.defaultSystemPrompt' ? 'You are a helpful assistant.' : fallback;
    }

    function syncAgentOnboardingDraft(agent, options = {}) {
        const forceReset = options.forceReset === true;
        if (!agent) {
            state.agentOnboardingAgentId = null;
            state.agentOnboardingPresetId = '';
            state.agentOnboardingPrompt = '';
            state.agentOnboardingSaving = false;
            state.agentOnboardingStatus = null;
            return;
        }

        if (!forceReset && state.agentOnboardingAgentId === agent.id) {
            return;
        }

        const nextPrompt = resolveOnboardingPromptSeed(agent);
        const matchedPreset = state.agentPresets.find(preset => preset.systemPrompt === nextPrompt) || null;

        state.agentOnboardingAgentId = agent.id;
        state.agentOnboardingPresetId = matchedPreset?.id || '';
        state.agentOnboardingPrompt = nextPrompt;
        state.agentOnboardingSaving = false;
        state.agentOnboardingStatus = null;
    }

    function setAgentOnboardingStatus(kind, text) {
        state.agentOnboardingStatus = text ? { kind, text } : null;
        renderAgentOnboarding();
    }

    function renderAgentOnboarding() {
        if (!elements.agentOnboardingPanel) {
            return;
        }

        const agent = resolveCurrentAgent();
        if (!agent) {
            elements.agentOnboardingPanel.classList.add('hidden');
            return;
        }

        syncAgentOnboardingDraft(agent);

        if (elements.agentOnboardingAgentName) {
            elements.agentOnboardingAgentName.textContent = agent.name || '-';
        }
        if (elements.agentOnboardingAgentModel) {
            elements.agentOnboardingAgentModel.textContent = agent.model || '-';
        }
        if (elements.agentOnboardingPrompt && elements.agentOnboardingPrompt.value !== state.agentOnboardingPrompt) {
            elements.agentOnboardingPrompt.value = state.agentOnboardingPrompt || '';
        }

        renderAgentOnboardingPresetGrid();
        renderAgentOnboardingPresetSummary();
        renderAgentOnboardingStatus();

        if (elements.btnSaveAgentOnboarding) {
            elements.btnSaveAgentOnboarding.disabled = state.agentOnboardingSaving;
        }
        if (elements.btnOpenAgentOnboardingSettings) {
            elements.btnOpenAgentOnboardingSettings.disabled = state.agentOnboardingSaving;
        }
    }

    function renderAgentOnboardingPresetGrid() {
        if (!elements.agentOnboardingPresetGrid) {
            return;
        }

        if (!state.agentPresets.length) {
            elements.agentOnboardingPresetGrid.innerHTML = `
                <div class="new-agent-preset-empty">${escapeHtml(t('newAgent.preset.empty'))}</div>
            `;
            return;
        }

        elements.agentOnboardingPresetGrid.innerHTML = state.agentPresets.map((preset) => {
            const isSelected = preset.id === state.agentOnboardingPresetId;
            return `
                <button
                    type="button"
                    class="new-agent-preset-card${isSelected ? ' selected' : ''}"
                    data-agent-onboarding-preset-id="${escapeHtml(preset.id)}"
                >
                    <span class="new-agent-preset-card-badge">${escapeHtml(preset.badge || preset.defaultName)}</span>
                    <div class="new-agent-preset-card-name">${escapeHtml(preset.defaultName)}</div>
                    <div class="new-agent-preset-card-title">${escapeHtml(preset.label)}</div>
                    <div class="new-agent-preset-card-description">${escapeHtml(preset.description)}</div>
                </button>
            `;
        }).join('');
    }

    function renderAgentOnboardingPresetSummary() {
        if (!elements.agentOnboardingPresetSummary) {
            return;
        }

        const preset = getSelectedAgentOnboardingPreset();
        if (!preset) {
            elements.agentOnboardingPresetSummary.innerHTML = `
                <div class="new-agent-preset-summary-label">${escapeHtml(t('agentOnboarding.customLabel'))}</div>
                <div class="new-agent-preset-summary-text">${escapeHtml(t('agentOnboarding.customHint'))}</div>
            `;
            return;
        }

        elements.agentOnboardingPresetSummary.innerHTML = `
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

    function renderAgentOnboardingStatus() {
        if (!elements.agentOnboardingStatus) {
            return;
        }

        const status = state.agentOnboardingStatus;
        elements.agentOnboardingStatus.classList.toggle('hidden', !status);
        elements.agentOnboardingStatus.classList.toggle('success', status?.kind === 'success');
        elements.agentOnboardingStatus.classList.toggle('error', status?.kind === 'error');
        elements.agentOnboardingStatus.textContent = status?.text || '';
    }

    function applyAgentOnboardingPreset(presetId) {
        const preset = getAgentPresetById(presetId);
        if (!preset) {
            return;
        }

        state.agentOnboardingPresetId = preset.id;
        state.agentOnboardingPrompt = preset.systemPrompt || '';
        state.agentOnboardingStatus = null;
        renderAgentOnboarding();
    }

    function openAgentOnboardingSettings() {
        const agent = resolveCurrentAgent();
        if (!agent) {
            return;
        }

        vscode.postMessage({ type: 'openAgentSettings', agentId: agent.id });
    }

    function saveAgentOnboarding() {
        const agent = resolveCurrentAgent();
        if (!agent) {
            return;
        }

        const nextPrompt = String(elements.agentOnboardingPrompt?.value || state.agentOnboardingPrompt || '').trim();
        if (!nextPrompt) {
            setAgentOnboardingStatus('error', t('agentOnboarding.promptRequired'));
            return;
        }

        state.agentOnboardingPrompt = nextPrompt;
        state.agentOnboardingSaving = true;
        setAgentOnboardingStatus('success', t('agentOnboarding.saving'));
        vscode.postMessage({
            type: 'saveAgentSettings',
            agentId: agent.id,
            settings: {
                name: agent.name,
                model: agent.model,
                systemPrompt: nextPrompt,
                temperature: agent.temperature ?? 0.7,
                maxTokens: agent.maxTokens ?? 4096,
                enabledSkills: Array.isArray(agent.enabledSkills) ? agent.enabledSkills : []
            }
        });
    }

    function setNewAgentMode(mode, options = { resetToDefault: true }) {
        const nextMode = mode === 'preset' ? 'preset' : mode === 'batch' ? 'batch' : 'custom';
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

        if (state.newAgentMode === 'batch') {
            syncAgentModelFormState('batch');
            setBatchCreateAgentsStatus('info', t('agentBatch.saveHint'));
            renderNewAgentMode();
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
            syncAgentModelFormState('new', preset.recommendedModel || '');
        } else if (options.resetToDefault) {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            if (elements.newAgentName) {
                elements.newAgentName.value = '';
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = t('newAgent.defaultSystemPrompt');
            }
            syncAgentModelFormState('new');
        }

        renderNewAgentMode();
        renderNewAgentPresetDescription();
    }

    function resetNewAgentForm() {
        elements.formNewAgent?.reset();
        state.newAgentMode = 'custom';
        if (elements.batchAgentNames) {
            elements.batchAgentNames.value = '';
        }
        if (elements.batchAgentPrompt) {
            elements.batchAgentPrompt.value = '';
        }
        syncAgentModelFormState('batch');
        setBatchCreateAgentsStatus('info', t('agentBatch.saveHint'));
        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, { resetToDefault: true });
    }

    // Populate model select dropdown
    function populateModelSelect(models) {
        state.availableModels = Array.isArray(models) ? models : [];
        syncAgentModelFormState('new');
        syncAgentModelFormState('settings');
        syncAgentModelFormState('batch');
        syncAgentModelFormState('clusterBatch');
    }

    function buildAgentModelCatalog() {
        const modelRefs = Array.from(new Set([
            ...(Array.isArray(state.availableModels) ? state.availableModels : []),
            ...((Array.isArray(state.agents) ? state.agents : []).map(agent => agent.model))
        ].map(modelRef => String(modelRef || '').trim()).filter(Boolean)));
        const providers = new Map();
        const directModels = [];

        modelRefs.forEach(modelRef => {
            const parsed = parseAgentModelRef(modelRef);
            if (parsed.providerId) {
                const current = providers.get(parsed.providerId) || [];
                current.push(modelRef);
                providers.set(parsed.providerId, current);
                return;
            }

            directModels.push(modelRef);
        });

        const normalizedProviders = Array.from(providers.entries())
            .map(([providerId, providerModels]) => [providerId, Array.from(new Set(providerModels)).sort((left, right) => left.localeCompare(right))])
            .sort((left, right) => left[0].localeCompare(right[0]));

        return {
            providers: normalizedProviders,
            directModels: Array.from(new Set(directModels)).sort((left, right) => left.localeCompare(right))
        };
    }

    function parseAgentModelRef(modelRef) {
        const normalizedModelRef = String(modelRef || '').trim();
        if (!normalizedModelRef) {
            return {
                providerId: '',
                modelName: ''
            };
        }

        const slashIndex = normalizedModelRef.indexOf('/');
        if (slashIndex <= 0) {
            return {
                providerId: '',
                modelName: normalizedModelRef
            };
        }

        return {
            providerId: normalizedModelRef.slice(0, slashIndex).trim(),
            modelName: normalizedModelRef.slice(slashIndex + 1).trim()
        };
    }

    function getAgentModelFormElements(scope) {
        if (scope === 'batch') {
            return {
                provider: elements.batchAgentModelProvider,
                providerCustom: elements.batchAgentModelProviderCustom,
                model: elements.batchAgentModel,
                modelCustom: elements.batchAgentModelCustom
            };
        }

        if (scope === 'clusterBatch') {
            return {
                provider: elements.clusterBatchAgentModelProvider,
                providerCustom: elements.clusterBatchAgentModelProviderCustom,
                model: elements.clusterBatchAgentModel,
                modelCustom: elements.clusterBatchAgentModelCustom
            };
        }

        return scope === 'settings'
            ? {
                provider: elements.settingsAgentModelProvider,
                providerCustom: elements.settingsAgentModelProviderCustom,
                model: elements.settingsAgentModel,
                modelCustom: elements.settingsAgentModelCustom
            }
            : {
                provider: elements.newAgentModelProvider,
                providerCustom: elements.newAgentModelProviderCustom,
                model: elements.newAgentModel,
                modelCustom: elements.newAgentModelCustom
            };
    }

    function getOpenClawConfigAuthProvider() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.authProviderId || '';
    }

    function getOpenClawConfigDefaultModel() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.defaultModel || '';
    }

    function getOpenClawConfigModelSuggestions() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.defaultModelSuggestionsByProvider || {};
    }

    function renderAgentModelProviderOptions(scope, selectedModelRef = '') {
        const refs = getAgentModelFormElements(scope);
        if (!refs.provider) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        
        // Get auth providers from OpenClaw Config
        const openClawConfig = state.runtime?.openClawConfig;
        const authProviders = Array.isArray(openClawConfig?.authProviders) ? openClawConfig.authProviders : [];
        const configProvider = openClawConfig?.authProviderId || '';
        
        // Parse current model to determine provider
        const parsed = parseAgentModelRef(selectedModelRef);
        const currentProvider = parsed.providerId || configProvider || '';
        
        // Determine the selected provider value
        const resolvedProviderValue = currentProvider && authProviders.includes(currentProvider)
            ? currentProvider
            : currentProvider
                ? CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE
                : authProviders[0] || '';

        refs.provider.innerHTML = [
            `<option value="">${escapeHtml(t('agentSettings.modelProviderPlaceholder'))}</option>`,
            ...authProviders.map(providerId => `<option value="${escapeHtml(providerId)}">${escapeHtml(providerId)}</option>`),
            `<option value="${CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE}">${escapeHtml(t('agentSettings.modelProviderCustom'))}</option>`
        ].join('');
        
        refs.provider.value = resolvedProviderValue;

        if (resolvedProviderValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE && refs.providerCustom) {
            refs.providerCustom.value = currentProvider || '';
        }

        syncAgentModelProviderCustomVisibility(scope, resolvedProviderValue);
        renderAgentModelOptions(scope, resolvedProviderValue, selectedModelRef);
    }

    function renderAgentModelOptions(scope, providerValue, selectedModelRef = '') {
        const refs = getAgentModelFormElements(scope);
        if (!refs.model) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const selectedProviderValue = String(providerValue || refs.provider?.value || '').trim();
        
        // Get model suggestions from OpenClaw Config based on provider
        const suggestionsByProvider = getOpenClawConfigModelSuggestions();
        const configDefaultModel = getOpenClawConfigDefaultModel();
        
        // Get available models for the selected provider
        let providerModels = [];
        if (selectedProviderValue && selectedProviderValue !== CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
            providerModels = Array.isArray(suggestionsByProvider[selectedProviderValue]) 
                ? suggestionsByProvider[selectedProviderValue] 
                : [];
        }
        
        // Also include available models from agent manager if they match the provider
        const allAvailableModels = Array.isArray(state.availableModels) ? state.availableModels : [];
        const matchingModels = allAvailableModels.filter(modelRef => {
            if (!selectedProviderValue || selectedProviderValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
                return true;
            }
            return modelRef.startsWith(selectedProviderValue + '/');
        });
        
        // Merge suggestions and matching models, remove duplicates
        const mergedModels = Array.from(new Set([...providerModels, ...matchingModels]));
        
        // Parse current model
        const parsed = parseAgentModelRef(selectedModelRef);
        let customModelValue = '';
        
        // Determine the model to select
        let resolvedModelValue = '';
        if (selectedModelRef && mergedModels.includes(selectedModelRef)) {
            // Use the agent's current model if it's in the list
            resolvedModelValue = selectedModelRef;
        } else if (selectedModelRef && parsed.modelName) {
            // Use custom model if agent has a model not in the list
            resolvedModelValue = CUSTOM_AGENT_MODEL_OPTION_VALUE;
            customModelValue = selectedModelRef;
        } else if (configDefaultModel && mergedModels.includes(configDefaultModel)) {
            // Fall back to OpenClaw Config default model
            resolvedModelValue = configDefaultModel;
        } else if (mergedModels.length > 0) {
            // Fall back to first available model
            resolvedModelValue = mergedModels[0];
        }

        refs.model.innerHTML = [
            `<option value="">${escapeHtml(t('agentSettings.modelSelectPlaceholder'))}</option>`,
            ...mergedModels.map(modelRef => `<option value="${escapeHtml(modelRef)}">${escapeHtml(modelRef)}</option>`),
            `<option value="${CUSTOM_AGENT_MODEL_OPTION_VALUE}">${escapeHtml(t('agentSettings.modelCustom'))}</option>`
        ].join('');
        refs.model.value = resolvedModelValue;

        if (resolvedModelValue === CUSTOM_AGENT_MODEL_OPTION_VALUE && refs.modelCustom) {
            refs.modelCustom.value = customModelValue || '';
        }

        syncAgentModelCustomVisibility(scope, resolvedModelValue);
    }

    function syncAgentModelProviderCustomVisibility(scope, selectedProviderValue) {
        const refs = getAgentModelFormElements(scope);
        if (!refs.providerCustom) {
            return;
        }

        const shouldShowCustomProvider = (selectedProviderValue ?? refs.provider?.value ?? '') === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE;
        refs.providerCustom.classList.toggle('hidden', !shouldShowCustomProvider);
        refs.providerCustom.disabled = !shouldShowCustomProvider;

        if (!shouldShowCustomProvider) {
            refs.providerCustom.value = '';
        }
    }

    function syncAgentModelCustomVisibility(scope, selectedModelValue) {
        const refs = getAgentModelFormElements(scope);
        if (!refs.modelCustom) {
            return;
        }

        const shouldShowCustomModel = (selectedModelValue ?? refs.model?.value ?? '') === CUSTOM_AGENT_MODEL_OPTION_VALUE;
        refs.modelCustom.classList.toggle('hidden', !shouldShowCustomModel);
        refs.modelCustom.disabled = !shouldShowCustomModel;

        if (!shouldShowCustomModel) {
            refs.modelCustom.value = '';
        }
    }

    function syncAgentModelFormState(scope, selectedModelRef) {
        renderAgentModelProviderOptions(scope, selectedModelRef || resolveAgentModelRefFromForm(scope));
    }

    function handleAgentModelProviderChange(scope) {
        const refs = getAgentModelFormElements(scope);
        const providerValue = String(refs.provider?.value || '').trim();
        syncAgentModelProviderCustomVisibility(scope, providerValue);
        renderAgentModelOptions(scope, providerValue, '');
    }

    function resolveAgentModelRefFromForm(scope) {
        const refs = getAgentModelFormElements(scope);
        const providerValue = String(refs.provider?.value || '').trim();
        const selectedModelValue = String(refs.model?.value || '').trim();

        if (selectedModelValue === CUSTOM_AGENT_MODEL_OPTION_VALUE) {
            const customModel = String(refs.modelCustom?.value || '').trim();
            if (!customModel) {
                return '';
            }

            if (providerValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
                const customProvider = String(refs.providerCustom?.value || '').trim();
                return customProvider ? `${customProvider}/${customModel}` : customModel;
            }

            if (providerValue === DIRECT_AGENT_MODEL_PROVIDER_OPTION_VALUE || !providerValue) {
                return customModel;
            }

            return `${providerValue}/${customModel}`;
        }

        return selectedModelValue;
    }

    // Create agent
    function createAgent() {
        if (state.newAgentMode === 'batch') {
            createAgentsBatch();
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = state.newAgentMode === 'preset' ? getSelectedAgentPreset() : null;
        const data = {
            name: elements.newAgentName?.value?.trim() || '',
            model: resolveAgentModelRefFromForm('new'),
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

    function parseBatchAgentNames(value) {
        return Array.from(new Set(
            String(value || '')
                .split(/\r?\n/g)
                .map(entry => entry.trim())
                .filter(Boolean)
        ));
    }

    function setBatchCreateAgentsStatus(kind, text) {
        state.batchCreateAgentsStatus = text ? { kind, text } : null;
        renderBatchCreateAgentsStatus();
    }

    function renderBatchCreateAgentsStatus() {
        if (!elements.batchAgentFormStatus) {
            return;
        }

        const status = state.batchCreateAgentsStatus;
        elements.batchAgentFormStatus.classList.toggle('hidden', !status);
        elements.batchAgentFormStatus.classList.toggle('success', status?.kind === 'success');
        elements.batchAgentFormStatus.classList.toggle('error', status?.kind === 'error');
        elements.batchAgentFormStatus.textContent = status?.text || '';
    }

    function createAgentsBatch() {
        const names = parseBatchAgentNames(elements.batchAgentNames?.value || '');
        const model = resolveAgentModelRefFromForm('batch');
        const systemPrompt = String(elements.batchAgentPrompt?.value || '').trim();

        if (names.length === 0) {
            setBatchCreateAgentsStatus('error', t('agentBatch.validationNames'));
            return;
        }

        if (!model) {
            setBatchCreateAgentsStatus('error', t('agentBatch.validationModel'));
            return;
        }

        state.batchCreateAgentsSaving = true;
        setBatchCreateAgentsStatus('success', t('agentBatch.pending'));
        vscode.postMessage({
            type: 'createAgentsBatch',
            data: {
                agents: names.map(name => ({
                    name,
                    model,
                    systemPrompt: systemPrompt || t('newAgent.defaultSystemPrompt')
                }))
            }
        });
    }

    function readClusterBatchAgentDrafts() {
        const names = parseBatchAgentNames(elements.clusterBatchAgentNames?.value || '');
        const model = resolveAgentModelRefFromForm('clusterBatch');
        const systemPrompt = String(elements.clusterBatchAgentPrompt?.value || '').trim();

        if (names.length === 0) {
            return [];
        }

        return names.map(name => ({
            name,
            model,
            systemPrompt: systemPrompt || t('newAgent.defaultSystemPrompt')
        }));
    }

    function resetClusterBatchCreateInputs() {
        if (elements.clusterBatchAgentNames) {
            elements.clusterBatchAgentNames.value = '';
        }
        if (elements.clusterBatchAgentPrompt) {
            elements.clusterBatchAgentPrompt.value = '';
        }
        syncAgentModelFormState('clusterBatch');
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
                label: skill.linkLabel || (defaultLinkLabel === 'agentSettings.skills.downloadLink' ? 'Browse Skill Hubs' : defaultLinkLabel),
                description: skill.linkDescription || (defaultLinkDescription === 'agentSettings.skills.downloadHint' ? 'Open a public skill hub catalog in your browser.' : defaultLinkDescription)
            });
        });

        elements.agentSkillLinks.innerHTML = Array.from(uniqueLinks.entries()).map(([url, entry]) => `
            <button type="button" class="btn skill-link-card" data-skill-url="${escapeHtml(url)}">
                <div class="skill-link-card-title">${escapeHtml(entry.label)}</div>
                <div class="skill-link-card-meta">${escapeHtml(entry.description)}</div>
            </button>
        `).join('');
    }

    function openSkillMarket() {
        if (!elements.modalSkillMarket) {
            return;
        }

        if (!state.skillMarketData) {
            refreshSkillMarket();
        } else {
            renderSkillMarket();
        }
        openModal(elements.modalSkillMarket);
    }

    async function refreshSkillMarket() {
        if (elements.skillMarketLoading) {
            elements.skillMarketLoading.classList.remove('hidden');
        }
        if (elements.skillMarketContent) {
            elements.skillMarketContent.classList.add('hidden');
        }

        // Request skills from extension host
        vscode.postMessage({ type: 'loadSkillMarket', filters: state.skillMarketFilters || {} });
    }

    function renderSkillMarket() {
        if (!elements.skillMarketGrid) {
            return;
        }

        const t = window.OpenClawI18n?.t || ((key, args) => key);
        const overview = state.skillMarketData || { market: [], installed: [], hubs: [], errors: [] };
        const tab = state.skillMarketTab || 'market';
        const filters = state.skillMarketFilters || { query: '', category: 'all', tags: [], sortBy: 'popular', hubId: 'all' };
        const categoryLabelMap = {
            coding: 'skillMarket.categoryCoding',
            testing: 'skillMarket.categoryTesting',
            planning: 'skillMarket.categoryPlanning',
            analysis: 'skillMarket.categoryAnalysis',
            documentation: 'skillMarket.categoryDocumentation',
            communication: 'skillMarket.categoryCommunication',
            other: 'skillMarket.categoryOther'
        };

        const activeAgent = state.agents.find(a => a.id === state.currentAgentId);
        const enabledIds = new Set(activeAgent?.enabledSkills || []);

        const baseSkills = (() => {
            if (tab === 'market') return Array.isArray(overview.market) ? overview.market : [];
            if (tab === 'installed') return Array.isArray(overview.installed) ? overview.installed : [];
            if (tab === 'enabled') {
                const installed = Array.isArray(overview.installed) ? overview.installed : [];
                const known = new Map(installed.map(skill => [skill.id, skill]));
                const enabled = [];
                enabledIds.forEach(id => {
                    if (known.has(id)) {
                        enabled.push(known.get(id));
                        return;
                    }
                    enabled.push({
                        id,
                        label: id,
                        description: '',
                        prompt: '',
                        category: 'other',
                        tags: [],
                        source: 'custom',
                        sourceKind: 'custom',
                        version: '1.0.0',
                        downloads: 0,
                        createdAt: '',
                        updatedAt: '',
                        downloadUrl: ''
                    });
                });
                return enabled;
            }
            return [];
        })();

        const normalizedQuery = String(filters.query || '').trim().toLowerCase();
        const selectedTags = Array.isArray(filters.tags) ? filters.tags : [];
        const selectedCategory = filters.category || 'all';
        const selectedHub = filters.hubId || 'all';

        const filterSkills = (skills) => {
            return skills.filter(skill => {
                if (normalizedQuery) {
                    const haystack = `${skill.label || ''} ${skill.description || ''}`.toLowerCase();
                    const tagMatch = (skill.tags || []).some(tag => String(tag).toLowerCase().includes(normalizedQuery));
                    if (!haystack.includes(normalizedQuery) && !tagMatch) {
                        return false;
                    }
                }
                if (selectedHub && selectedHub !== 'all') {
                    if ((skill.hubId || '') !== selectedHub) {
                        return false;
                    }
                }
                if (selectedCategory && selectedCategory !== 'all' && skill.category !== selectedCategory) {
                    return false;
                }
                if (selectedTags.length) {
                    const tagSet = new Set(skill.tags || []);
                    if (!selectedTags.some(tag => tagSet.has(tag))) {
                        return false;
                    }
                }
                return true;
            });
        };

        const filterFacetSkills = (skills) => {
            return skills.filter(skill => {
                if (normalizedQuery) {
                    const haystack = `${skill.label || ''} ${skill.description || ''}`.toLowerCase();
                    const tagMatch = (skill.tags || []).some(tag => String(tag).toLowerCase().includes(normalizedQuery));
                    if (!haystack.includes(normalizedQuery) && !tagMatch) {
                        return false;
                    }
                }
                if (selectedHub && selectedHub !== 'all') {
                    if ((skill.hubId || '') !== selectedHub) {
                        return false;
                    }
                }
                return true;
            });
        };

        const facetSkills = filterFacetSkills(baseSkills.map(skill => ({ ...skill })));
        let visibleSkills = filterSkills(baseSkills);

        const sortBy = filters.sortBy || 'popular';
        const parseDate = (value) => {
            const ts = Date.parse(value || '');
            return Number.isNaN(ts) ? 0 : ts;
        };
        visibleSkills.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return String(a.label || '').localeCompare(String(b.label || ''));
                case 'updated':
                    return parseDate(b.updatedAt) - parseDate(a.updatedAt);
                case 'installed':
                    return parseDate(b.installedAt) - parseDate(a.installedAt);
                case 'rating':
                    return (b.rating || 0) - (a.rating || 0);
                case 'popular':
                default:
                    return (b.downloads || 0) - (a.downloads || 0);
            }
        });

        // Update tabs active state
        document.querySelectorAll('.skill-market-tab').forEach(tabEl => {
            tabEl.classList.toggle('is-active', tabEl.getAttribute('data-tab') === tab);
        });

        // Update subtitle
        if (elements.skillMarketSubtitle) {
            const subtitleKey = tab === 'installed'
                ? 'skillMarket.subtitleInstalled'
                : tab === 'enabled'
                    ? 'skillMarket.subtitleEnabled'
                    : 'skillMarket.subtitleMarket';
            elements.skillMarketSubtitle.textContent = t(subtitleKey);
        }

        // Update stats
        if (elements.skillMarketStats) {
            const total = tab === 'market' ? (overview.total || baseSkills.length) : baseSkills.length;
            const statsKey = tab === 'installed'
                ? 'skillMarket.statsInstalled'
                : tab === 'enabled'
                    ? 'skillMarket.statsEnabled'
                    : 'skillMarket.statsMarket';
            elements.skillMarketStats.textContent = t(statsKey, { showing: visibleSkills.length, total });
        }

        // Render hubs
        if (elements.skillMarketHubs) {
            const hubs = Array.isArray(overview.hubs) ? overview.hubs : [];
            const allLabel = t('skillMarket.hubAll');
            const hubButtons = [
                `<button type="button" class="skill-market-hub${selectedHub === 'all' ? ' is-active' : ''}" data-hub="all">${escapeHtml(allLabel)}</button>`
            ];
            hubs.forEach(hub => {
                const statusClass = hub.status === 'error' ? ' is-error' : ' is-ok';
                hubButtons.push(`
                    <button type="button" class="skill-market-hub${statusClass}${selectedHub === hub.id ? ' is-active' : ''}" data-hub="${escapeHtml(hub.id)}">
                        <span class="skill-market-hub-dot"></span>
                        <span>${escapeHtml(hub.name)}</span>
                    </button>
                `);
            });
            elements.skillMarketHubs.innerHTML = hubButtons.join('');
        }

        // Render categories
        if (elements.skillMarketCategories) {
            const categoryCounts = new Map();
            facetSkills.forEach(skill => {
                const category = skill.category || 'other';
                categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
            });
            const categoryButtons = [];
            categoryButtons.push(`
                <button type="button" class="skill-market-chip${selectedCategory === 'all' ? ' is-active' : ''}" data-category="all">
                    <span>${escapeHtml(t('skillMarket.categoryAll'))}</span>
                    <span class="skill-market-chip-count">${facetSkills.length}</span>
                </button>
            `);
            Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]).forEach(([category, count]) => {
                const labelKey = categoryLabelMap[category] || 'skillMarket.categoryOther';
                categoryButtons.push(`
                    <button type="button" class="skill-market-chip${selectedCategory === category ? ' is-active' : ''}" data-category="${escapeHtml(category)}">
                        <span>${escapeHtml(t(labelKey))}</span>
                        <span class="skill-market-chip-count">${count}</span>
                    </button>
                `);
            });
            elements.skillMarketCategories.innerHTML = categoryButtons.join('');
        }

        // Render tags
        if (elements.skillMarketTags) {
            const tagCounts = new Map();
            facetSkills.forEach(skill => {
                (skill.tags || []).forEach(tag => {
                    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                });
            });
            const tagButtons = Array.from(tagCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 24)
                .map(([tag, count]) => `
                    <button type="button" class="skill-market-tag${selectedTags.includes(tag) ? ' is-active' : ''}" data-tag="${escapeHtml(tag)}">
                        <span>${escapeHtml(tag)}</span>
                        <span class="skill-market-chip-count">${count}</span>
                    </button>
                `);
            elements.skillMarketTags.innerHTML = tagButtons.join('');
        }

        // Render status/errors
        if (elements.skillMarketStatus) {
            const hubErrors = (overview.hubs || []).filter(hub => hub.status === 'error');
            if (hubErrors.length === 0 && (!overview.errors || overview.errors.length === 0)) {
                elements.skillMarketStatus.innerHTML = '';
                elements.skillMarketStatus.classList.add('hidden');
            } else {
                const errorItems = [];
                hubErrors.forEach(hub => {
                    errorItems.push(t('skillMarket.hubFailed', { name: hub.name }));
                });
                (overview.errors || []).forEach(error => {
                    errorItems.push(String(error));
                });
                elements.skillMarketStatus.innerHTML = `
                    <div class="skill-market-status is-error">
                        <span class="skill-market-status-label">${escapeHtml(t('skillMarket.statusIssue'))}</span>
                        <div class="skill-market-status-details">${errorItems.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
                    </div>
                `;
                elements.skillMarketStatus.classList.remove('hidden');
            }
        }

        // Empty state
        if (visibleSkills.length === 0) {
            if (elements.skillMarketEmpty) elements.skillMarketEmpty.classList.remove('hidden');
            if (elements.skillMarketGrid) elements.skillMarketGrid.classList.add('hidden');
            const emptyTitle = tab === 'installed'
                ? t('skillMarket.emptyInstalled')
                : tab === 'enabled'
                    ? t('skillMarket.emptyEnabled')
                    : t('skillMarket.emptyMarket');
            const emptyHint = tab === 'installed'
                ? t('skillMarket.emptyInstalledHint')
                : tab === 'enabled'
                    ? t('skillMarket.emptyEnabledHint')
                    : t('skillMarket.emptyMarketHint');
            const emptyTitleEl = document.getElementById('skill-market-empty-title');
            const emptyHintEl = document.getElementById('skill-market-empty-hint');
            if (emptyTitleEl) emptyTitleEl.textContent = emptyTitle;
            if (emptyHintEl) emptyHintEl.textContent = emptyHint;
            return;
        }

        if (elements.skillMarketEmpty) elements.skillMarketEmpty.classList.add('hidden');
        if (elements.skillMarketGrid) elements.skillMarketGrid.classList.remove('hidden');

        const formatDate = (value) => {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return date.toISOString().slice(0, 10);
        };

        elements.skillMarketGrid.innerHTML = visibleSkills.map(skill => {
            const isEnabled = enabledIds.has(skill.id);
            const isInstalled = Boolean(skill.isInstalled) || skill.sourceKind === 'built-in' || skill.sourceKind === 'installed' || skill.source === 'built-in';
            const rating = skill.rating || 0;
            const downloads = skill.downloads || 0;
            const downloadsLabel = t('skillMarket.downloads', { count: downloads });
            const downloadsText = downloadsLabel === 'skillMarket.downloads'
                ? `${downloads.toLocaleString()} downloads`
                : downloadsLabel;
            const hubLabel = skill.hubName || (skill.sourceKind === 'built-in' ? t('skillMarket.badgeBuiltIn') : '') || t('skillMarket.sourceUnknown');
            const categoryLabelKey = categoryLabelMap[skill.category] || 'skillMarket.categoryOther';
            const categoryLabel = t(categoryLabelKey);
            const version = skill.version ? `v${skill.version}` : '';
            const updatedAt = formatDate(skill.updatedAt);

            const badges = [];
            if (skill.sourceKind === 'built-in') badges.push({ key: 'built-in', label: t('skillMarket.badgeBuiltIn') });
            if (skill.sourceKind === 'custom') badges.push({ key: 'custom', label: t('skillMarket.badgeCustom') });
            if (skill.sourceKind === 'remote') badges.push({ key: 'remote', label: t('skillMarket.badgeRemote') });
            if (isInstalled && tab === 'market') badges.push({ key: 'installed', label: t('skillMarket.badgeInstalled') });
            if (isEnabled) badges.push({ key: 'enabled', label: t('skillMarket.badgeEnabled') });
            if (skill.updateAvailable) badges.push({ key: 'update', label: t('skillMarket.badgeUpdate') });

            const showUninstall = tab !== 'market' && skill.sourceKind === 'installed';

            return `
                <article class="skill-market-card">
                    <div class="skill-market-card-header">
                        <div class="skill-market-card-title-row">
                            <div>
                                <div class="skill-market-card-title">${escapeHtml(skill.label || skill.id)}</div>
                                <div class="skill-market-card-meta">
                                    <span class="skill-market-card-category">${escapeHtml(categoryLabel)}</span>
                                    ${hubLabel ? `<span class="skill-market-card-source">${escapeHtml(hubLabel)}</span>` : ''}
                                    ${version ? `<span class="skill-market-card-version">${escapeHtml(version)}</span>` : ''}
                                    ${updatedAt ? `<span class="skill-market-card-updated">${escapeHtml(t('skillMarket.updatedAt', { date: updatedAt }))}</span>` : ''}
                                </div>
                            </div>
                            <div class="skill-market-card-badges">
                                ${badges.map(badge => `<span class="skill-market-badge is-${badge.key}">${escapeHtml(badge.label)}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="skill-market-card-description">${escapeHtml(skill.description || '')}</div>
                    <div class="skill-market-card-tags">
                        ${(skill.tags || []).slice(0, 6).map(tag =>
                            `<span class="skill-market-card-tag">${escapeHtml(tag)}</span>`
                        ).join('')}
                    </div>
                    <div class="skill-market-card-metrics">
                        ${rating ? `<span class="skill-market-card-rating"><span class="skill-market-card-rating-star">&#9733;</span> ${rating.toFixed(1)}</span>` : ''}
                        ${downloads ? `<span class="skill-market-card-downloads">${escapeHtml(downloadsText)}</span>` : ''}
                        ${skill.author?.name ? `<span class="skill-market-card-author">${escapeHtml(t('skillMarket.byAuthor', { name: skill.author.name }))}</span>` : ''}
                    </div>
                    <div class="skill-market-card-actions">
                        ${tab === 'market' ? `
                            <button type="button" class="btn ${isInstalled ? 'btn-secondary' : 'btn-primary'} btn-small" 
                                ${isInstalled ? 'disabled' : `data-skill-install="${escapeHtml(skill.id)}" data-skill-hub="${escapeHtml(skill.hubId || '')}"`}>
                                ${isInstalled ? t('skillMarket.installed') : t('skillMarket.install')}
                            </button>
                        ` : ''}
                        ${tab !== 'market' ? `
                            <button type="button" class="btn ${isEnabled ? 'btn-secondary' : 'btn-primary'} btn-small" 
                                data-skill-toggle="${escapeHtml(skill.id)}">
                                ${isEnabled ? t('skillMarket.disable') : t('skillMarket.enable')}
                            </button>
                        ` : ''}
                        ${showUninstall ? `
                            <button type="button" class="btn btn-tertiary btn-small" data-skill-uninstall="${escapeHtml(skill.id)}">
                                ${t('skillMarket.uninstall')}
                            </button>
                        ` : ''}
                    </div>
                </article>
            `;
        }).join('');
    }

    function toggleSkillForActiveAgent(skillId) {
        const agent = state.agents.find(item => item.id === state.currentAgentId);
        if (!agent) {
            showError('Select an agent before changing skills.');
            return;
        }

        const current = new Set(Array.isArray(agent.enabledSkills) ? agent.enabledSkills : []);
        if (current.has(skillId)) {
            current.delete(skillId);
        } else {
            current.add(skillId);
        }

        const nextAgent = {
            ...agent,
            enabledSkills: Array.from(current)
        };
        upsertAgentState(nextAgent);
        renderSkillMarket();

        vscode.postMessage({
            type: 'saveAgentSettings',
            agentId: agent.id,
            settings: {
                name: agent.name,
                systemPrompt: agent.systemPrompt || '',
                temperature: agent.temperature ?? 0.7,
                maxTokens: agent.maxTokens ?? 4096,
                enabledSkills: nextAgent.enabledSkills
            }
        });
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
        state.agentSettingsFormDirty = false;
        state.agentSettingsSaving = false;
        setAgentSettingsStatus('info', t('agentSettings.saveOnlyHint'));
        syncAgentModelFormState('settings', agent.model || '');
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
            skillLinksLabel.textContent = label === 'agentSettings.skills.resources' ? 'SkillMarket Links' : label;
        }
        if (elements.agentSkillsHint) {
            const hint = t('agentSettings.skills.hint');
            elements.agentSkillsHint.textContent = hint === 'agentSettings.skills.hint'
                ? 'Enable the skills this agent should apply during reasoning and response generation.'
                : hint;
        }
        renderAgentSkillsPicker(agent.enabledSkills || []);
        renderAgentSkillLinks();
        renderSkillMarket();
        
        openModal(modal);
    }

    function setAgentSettingsStatus(kind, text) {
        state.agentSettingsStatus = text ? { kind, text } : null;
        renderAgentSettingsStatus();
    }

    function renderAgentSettingsStatus() {
        if (!elements.settingsAgentFormStatus) {
            return;
        }

        const status = state.agentSettingsStatus;
        elements.settingsAgentFormStatus.classList.toggle('hidden', !status);
        elements.settingsAgentFormStatus.classList.toggle('success', status?.kind === 'success');
        elements.settingsAgentFormStatus.classList.toggle('error', status?.kind === 'error');
        elements.settingsAgentFormStatus.textContent = status?.text || '';
    }

    function markAgentSettingsDirty() {
        if (!elements.modalAgentSettings?.classList.contains('active') || state.agentSettingsSaving) {
            return;
        }

        state.agentSettingsFormDirty = true;
        setAgentSettingsStatus('success', t('agentSettings.pendingSaveHint'));
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
        const currentAgent = (Array.isArray(state.agents) ? state.agents : []).find(agent => agent.id === agentId) || null;
        const settings = {
            name: nameField ? nameField.value : '',
            model: resolveAgentModelRefFromForm('settings') || currentAgent?.model || '',
            systemPrompt: promptField ? promptField.value : '',
            temperature: tempField ? parseFloat(tempField.value) : 0.7,
            maxTokens: maxTokensField ? parseInt(maxTokensField.value) : 4096,
            enabledSkills
        };

        state.agentSettingsSaving = true;
        setAgentSettingsStatus('success', t('agentSettings.saving'));
        vscode.postMessage({ type: 'saveAgentSettings', agentId, settings });
    }
