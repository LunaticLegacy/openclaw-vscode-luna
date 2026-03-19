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

    function installSkill(skillId) {
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }
        
        // Show installing status
        const installBtn = document.querySelector(`[data-skill-install="${escapeHtml(skillId)}"]`);
        if (installBtn) {
            const originalText = installBtn.textContent;
            installBtn.textContent = t('skillMarket.installing') || 'Installing...';
            installBtn.disabled = true;
            
            // Restore button after installation
            setTimeout(() => {
                if (installBtn) {
                    installBtn.textContent = originalText;
                    installBtn.disabled = false;
                }
            }, 3000);
        }
        
        vscode.postMessage({ 
            type: 'installSkill', 
            skillId: skillId 
        });
    }

    function installSkill(skillId) {
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }
        
        // Show installing status
        const installBtn = document.querySelector(`[data-skill-install="${escapeHtml(skillId)}"]`);
        if (installBtn) {
            const originalText = installBtn.textContent;
            installBtn.textContent = t('skillMarket.installing') || 'Installing...';
            installBtn.disabled = true;
            
            // Restore button after installation
            setTimeout(() => {
                if (installBtn) {
                    installBtn.textContent = originalText;
                    installBtn.disabled = false;
                }
            }, 3000);
        }
        
        vscode.postMessage({ 
            type: 'installSkill', 
            skillId: skillId 
        });
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
                label: skill.linkLabel || (defaultLinkLabel === 'agentSettings.skills.downloadLink' ? 'Browse SkillMarket.cc' : defaultLinkLabel),
                description: skill.linkDescription || (defaultLinkDescription === 'agentSettings.skills.downloadHint' ? 'Open the public SkillMarket catalog in your browser.' : defaultLinkDescription)
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

        renderSkillMarket();
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
        vscode.postMessage({ type: 'loadSkillMarket' });
    }

    function renderSkillMarket() {
        if (!elements.skillMarketGrid) {
            return;
        }

        const t = window.OpenClawI18n?.t || ((key, args) => key);
        const tab = state.skillMarketTab || 'market';
        const filters = state.skillMarketFilters || { query: '', category: 'all', sortBy: 'popular' };
        
        // Get skills based on current tab
        let skills = [];
        if (tab === 'market') {
            skills = state.skillMarketData?.skills || state.aiSkills || [];
        } else if (tab === 'installed') {
            skills = state.skillMarketInstalled || state.aiSkills || [];
        } else if (tab === 'enabled') {
            const activeAgent = state.agents.find(a => a.id === state.currentAgentId);
            const enabledIds = new Set(activeAgent?.enabledSkills || []);
            skills = (state.aiSkills || []).filter(s => enabledIds.has(s.id));
        }

        // Apply filters
        if (filters.query) {
            const query = filters.query.toLowerCase();
            skills = skills.filter(s => 
                (s.label || '').toLowerCase().includes(query) ||
                (s.description || '').toLowerCase().includes(query) ||
                (s.tags || []).some(t => t.toLowerCase().includes(query))
            );
        }

        if (filters.category && filters.category !== 'all') {
            skills = skills.filter(s => s.category === filters.category);
        }

        // Update subtitle
        if (elements.skillMarketSubtitle) {
            elements.skillMarketSubtitle.textContent = t('skillMarket.subtitle');
        }

        // Update stats
        if (elements.skillMarketStats) {
            const total = state.skillMarketData?.total || skills.length;
            elements.skillMarketStats.textContent = t('skillMarket.showingSkills', { showing: skills.length, total });
        }

        // Show/hide empty state
        if (skills.length === 0) {
            if (elements.skillMarketEmpty) elements.skillMarketEmpty.classList.remove('hidden');
            if (elements.skillMarketGrid) elements.skillMarketGrid.classList.add('hidden');
            return;
        }

        if (elements.skillMarketEmpty) elements.skillMarketEmpty.classList.add('hidden');
        if (elements.skillMarketGrid) elements.skillMarketGrid.classList.remove('hidden');

        // Render skills grid
        const activeAgent = state.agents.find(a => a.id === state.currentAgentId);
        const enabledIds = new Set(activeAgent?.enabledSkills || []);

        elements.skillMarketGrid.innerHTML = skills.map(skill => {
            const isEnabled = enabledIds.has(skill.id);
            const isInstalled = skill.isInstalled || skill.source === 'built-in';
            const rating = skill.rating || 0;
            const downloads = skill.downloads || 0;
            
            return `
                <article class="skill-market-card">
                    <div class="skill-market-card-header">
                        <div>
                            <div class="skill-market-card-title">${escapeHtml(skill.label || skill.id)}</div>
                            <div class="skill-market-card-meta">
                                <span class="skill-market-card-category">${escapeHtml(skill.category || 'Other')}</span>
                                ${rating ? `<span class="skill-market-card-rating"><span class="skill-market-card-rating-star">&#9733;</span> ${rating}</span>` : ''}
                                ${downloads ? `<span class="skill-market-card-downloads">${downloads.toLocaleString()} ${t('skillMarket.downloads', { count: downloads }).split(' ')[1]}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="skill-market-card-description">${escapeHtml(skill.description || '')}</div>
                    <div class="skill-market-card-tags">
                        ${(skill.tags || []).slice(0, 4).map(tag => 
                            `<span class="skill-market-card-tag">${escapeHtml(tag)}</span>`
                        ).join('')}
                    </div>
                    <div class="skill-market-card-actions">
                        ${tab === 'market' ? `
                            <button type="button" class="btn ${isInstalled ? 'btn-secondary' : 'btn-primary'} btn-small" 
                                ${isInstalled ? '' : `data-skill-install="${escapeHtml(skill.id)}"`}>
                                ${isInstalled ? t('skillMarket.installed') : t('skillMarket.install')}
                            </button>
                        ` : ''}
                        ${tab !== 'market' ? `
                            <button type="button" class="btn ${isEnabled ? 'btn-secondary' : 'btn-primary'} btn-small" 
                                data-skill-toggle="${escapeHtml(skill.id)}">
                                ${isEnabled ? t('skillMarket.disable') : t('skillMarket.enable')}
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