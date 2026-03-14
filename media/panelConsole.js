// OpenClaw Luna - Panel Console
'use strict';

    function updateOpenClawConfigEntryState() {
        if (!elements.btnOpenClawConfigEntry) {
            return;
        }

        elements.btnOpenClawConfigEntry.classList.toggle('active', hasChatContent() && state.chatHomePinned);
    }

    function focusOpenClawConfig() {
        window.setTimeout(() => {
            if (elements.openclawGatewayPort && !elements.consoleOpenClawConfigPanel?.classList.contains('hidden')) {
                elements.openclawGatewayPort.focus();
                if (typeof elements.openclawGatewayPort.select === 'function') {
                    elements.openclawGatewayPort.select();
                }
            }
        }, 0);
    }

    function openConsoleHome() {
        const hadChatContent = hasChatContent();
        switchView('chat');
        state.forceSetupPanel = true;
        state.chatHomePinned = hadChatContent;
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();

        if (elements.chatHome) {
            elements.chatHome.scrollTop = 0;
        }

        window.setTimeout(() => {
            elements.connectionConfigMode?.focus();
        }, 0);
    }

    function toggleOpenClawConfigEntry() {
        const hadChatContent = hasChatContent();
        switchView('chat');
        state.forceSetupPanel = false;
        state.chatHomePinned = hadChatContent ? !state.chatHomePinned : false;
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();

        if (!hadChatContent || state.chatHomePinned) {
            focusOpenClawConfig();
        }
    }

    function getRuntimeDiagnostics() {
        return state.runtime.diagnostics || null;
    }

    function getOpenClawConfigState() {
        return state.runtime.openClawConfig || null;
    }

    function hasDetectedGateway(diagnostics) {
        return Boolean(diagnostics?.detectedGatewayUrl || diagnostics?.detectedGatewayToken);
    }

    function resolveConnectionFormState(diagnostics) {
        return {
            configMode: diagnostics?.configMode || 'auto',
            gatewayUrl: diagnostics?.configuredGatewayUrl || diagnostics?.detectedGatewayUrl || DEFAULT_GATEWAY_URL,
            gatewayToken: diagnostics?.configuredGatewayToken || diagnostics?.detectedGatewayToken || ''
        };
    }

    function syncConnectionForm(force = false) {
        if (!elements.connectionConfigMode || !elements.connectionGatewayUrl || !elements.connectionGatewayToken) {
            return;
        }

        if (state.connectionFormDirty && !force) {
            updateDetectedGatewayButton();
            return;
        }

        const formState = resolveConnectionFormState(getRuntimeDiagnostics());
        elements.connectionConfigMode.value = formState.configMode;
        elements.connectionGatewayUrl.value = formState.gatewayUrl;
        elements.connectionGatewayToken.value = formState.gatewayToken;
        updateDetectedGatewayButton();
    }

    function updateDetectedGatewayButton() {
        if (!elements.btnUseDetectedGateway) {
            return;
        }

        elements.btnUseDetectedGateway.disabled = !hasDetectedGateway(getRuntimeDiagnostics());
    }

    function collectConnectionSettings() {
        return {
            configMode: elements.connectionConfigMode?.value || 'auto',
            gatewayUrl: elements.connectionGatewayUrl?.value?.trim() || '',
            gatewayToken: elements.connectionGatewayToken?.value?.trim() || ''
        };
    }

    function saveConnectionSettings() {
        state.connectionSettingsStatus = null;
        renderConnectionSetupStatus();
        vscode.postMessage({
            type: 'saveConnectionSettings',
            settings: collectConnectionSettings()
        });
    }

    function exportRuntimeLogs() {
        vscode.postMessage({
            type: 'exportRuntimeLogs'
        });
    }

    function applyDetectedGatewayValues() {
        const diagnostics = getRuntimeDiagnostics();
        if (!hasDetectedGateway(diagnostics)) {
            return;
        }

        if (elements.connectionConfigMode) {
            elements.connectionConfigMode.value = 'gateway';
        }
        if (elements.connectionGatewayUrl && diagnostics?.detectedGatewayUrl) {
            elements.connectionGatewayUrl.value = diagnostics.detectedGatewayUrl;
        }
        if (elements.connectionGatewayToken) {
            elements.connectionGatewayToken.value = diagnostics?.detectedGatewayToken || '';
        }

        state.connectionFormDirty = true;
        state.connectionSettingsStatus = null;
        renderConnectionSetup();
    }

    function setConnectionSetupStatus(kind, text) {
        window.OpenClawPanelFeedback.setConnectionSetupStatus(state, elements, kind, text);
    }

    function renderConnectionSetupStatus() {
        window.OpenClawPanelFeedback.renderConnectionSetupStatus(state, elements);
    }

    function setInstallGuideStatus(kind, text) {
        state.installGuideStatus = text ? { kind, text } : null;
        renderInstallGuideStatus();
    }

    function renderInstallGuideStatus() {
        if (!elements.installGuideStatus) {
            return;
        }

        const status = state.installGuideStatus;
        elements.installGuideStatus.classList.toggle('hidden', !status);
        elements.installGuideStatus.classList.toggle('success', status?.kind === 'success');
        elements.installGuideStatus.classList.toggle('error', status?.kind === 'error');
        elements.installGuideStatus.textContent = status?.text || '';
    }

    function resolveConnectionHint(t, diagnostics) {
        if (diagnostics?.detectedGatewayUrl) {
            const source = diagnostics.detectedConfigPath || diagnostics.detectedStateDir || '';
            if (source) {
                return t('setup.hintDetectedGatewayWithSource', {
                    url: diagnostics.detectedGatewayUrl,
                    source
                });
            }

            return t('setup.hintDetectedGateway', {
                url: diagnostics.detectedGatewayUrl
            });
        }

        if (diagnostics?.configuredGatewayUrl) {
            return t('setup.hintConfiguredGateway', {
                url: diagnostics.configuredGatewayUrl
            });
        }

        return t('setup.hintNoGatewayDetected', {
            defaultUrl: DEFAULT_GATEWAY_URL
        });
    }

    function resolveInstallGuideState(t, diagnostics) {
        if (diagnostics?.openClawInstalled) {
            return t('setup.installStateDetected', {
                path: diagnostics.detectedCliEntryPath || diagnostics.detectedNodePath || ''
            });
        }

        return t('setup.installStateNotDetected');
    }

    function renderInstallGuideCard(t, diagnostics, showSetupPanel) {
        const isInstalled = Boolean(diagnostics?.openClawInstalled);

        if (elements.consoleInstallGuide) {
            elements.consoleInstallGuide.classList.toggle('hidden', !showSetupPanel);
        }
        if (!showSetupPanel) {
            return;
        }

        if (elements.installGuideTitle) {
            elements.installGuideTitle.textContent = t(isInstalled ? 'setup.startTitle' : 'setup.installTitle');
        }
        if (elements.installGuideSummary) {
            elements.installGuideSummary.textContent = t(isInstalled ? 'setup.startSummary' : 'setup.installSummary');
        }
        if (elements.installGuideState) {
            elements.installGuideState.textContent = resolveInstallGuideState(t, diagnostics);
        }
        if (elements.installCommand) {
            elements.installCommand.textContent = INSTALL_COMMAND;
        }
        if (elements.onboardCommand) {
            elements.onboardCommand.textContent = ONBOARD_COMMAND;
        }
        if (elements.startCommand) {
            elements.startCommand.textContent = START_OPENCLAW_COMMAND;
        }
        if (elements.installCommandBlock) {
            elements.installCommandBlock.classList.toggle('hidden', isInstalled);
        }
        if (elements.onboardCommandBlock) {
            elements.onboardCommandBlock.classList.toggle('hidden', isInstalled);
        }
        if (elements.startCommandBlock) {
            elements.startCommandBlock.classList.toggle('hidden', !isInstalled);
        }
        if (elements.btnStartOpenClaw) {
            elements.btnStartOpenClaw.classList.toggle('hidden', !isInstalled);
            elements.btnStartOpenClaw.disabled = !isInstalled || state.installGuideBusy;
        }
        if (elements.installGuideFootnote) {
            elements.installGuideFootnote.textContent = t(isInstalled ? 'setup.startStepRetry' : 'setup.installStepRetry');
        }

        renderInstallGuideStatus();
    }

    function startOpenClaw() {
        state.installGuideBusy = true;
        setInstallGuideStatus(null, '');
        renderConnectionSetup();
        vscode.postMessage({ type: 'startOpenClaw' });
    }

    function renderConnectionSetup() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (!vars) {
                return key;
            }
            return Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);
        };
        const diagnostics = getRuntimeDiagnostics();
        const showSetupPanel = state.forceSetupPanel || !state.runtime.connected || state.agents.length === 0;

        if (elements.consoleSetupPanel) {
            elements.consoleSetupPanel.classList.toggle('hidden', !showSetupPanel);
        }

        syncConnectionForm();

        if (elements.connectionSettingsHint) {
            elements.connectionSettingsHint.textContent = resolveConnectionHint(t, diagnostics);
        }

        renderInstallGuideCard(t, diagnostics, showSetupPanel);

        renderConnectionSetupStatus();
    }

    function shouldShowOpenClawConfigPanel() {
        const diagnostics = getRuntimeDiagnostics();
        return Boolean(
            getOpenClawConfigState()
            || diagnostics?.configMode === 'openclaw'
            || diagnostics?.configuredStateDir
            || diagnostics?.detectedStateDir
            || diagnostics?.openClawInstalled
        );
    }

    function resolveOpenClawConfigFormState() {
        const openClawConfig = getOpenClawConfigState();
        const diagnostics = getRuntimeDiagnostics();
        return {
            stateDir: openClawConfig?.stateDir || diagnostics?.configuredStateDir || diagnostics?.detectedStateDir || '',
            configPath: openClawConfig?.configPath || diagnostics?.detectedConfigPath || '',
            authProfilesPath: openClawConfig?.authProfilesPath || '',
            gatewayPort: String(openClawConfig?.gatewayPort || 18789),
            gatewayToken: openClawConfig?.gatewayToken || '',
            defaultWorkspace: openClawConfig?.defaultWorkspace || '',
            defaultModel: openClawConfig?.defaultModel || '',
            authProviderId: openClawConfig?.authProviderId || '',
            authApiKey: openClawConfig?.authApiKey || '',
            authProviders: Array.isArray(openClawConfig?.authProviders) ? openClawConfig.authProviders : [],
            defaultModelSuggestionsByProvider: openClawConfig?.defaultModelSuggestionsByProvider || {}
        };
    }

    function inferOpenClawProviderIdFromModel(modelRef) {
        const normalizedModelRef = String(modelRef || '').trim();
        if (!normalizedModelRef) {
            return '';
        }

        const slashIndex = normalizedModelRef.indexOf('/');
        if (slashIndex <= 0) {
            return '';
        }

        return normalizedModelRef.slice(0, slashIndex).trim();
    }

    function resolveOpenClawAuthProviderIdFromForm() {
        const selectedProviderId = elements.openclawAuthProvider?.value?.trim() || '';
        if (selectedProviderId === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE) {
            return elements.openclawAuthProviderCustom?.value?.trim() || '';
        }

        return selectedProviderId;
    }

    function resolveOpenClawDefaultModelFromForm() {
        const selectedModelRef = elements.openclawDefaultModel?.value?.trim() || '';
        if (selectedModelRef === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE) {
            return elements.openclawDefaultModelCustom?.value?.trim() || '';
        }

        return selectedModelRef;
    }

    function syncOpenClawAuthProviderCustomVisibility(selectedProviderId) {
        if (!elements.openclawAuthProviderCustom) {
            return;
        }

        const nextValue = selectedProviderId ?? (elements.openclawAuthProvider?.value?.trim() || '');
        const shouldShowCustomProvider = nextValue === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE;

        elements.openclawAuthProviderCustom.classList.toggle('hidden', !shouldShowCustomProvider);
        elements.openclawAuthProviderCustom.disabled = !shouldShowCustomProvider;

        if (!shouldShowCustomProvider) {
            elements.openclawAuthProviderCustom.value = '';
        }
    }

    function syncOpenClawDefaultModelCustomVisibility(selectedModelRef) {
        if (!elements.openclawDefaultModelCustom) {
            return;
        }

        const nextValue = selectedModelRef ?? (elements.openclawDefaultModel?.value?.trim() || '');
        const shouldShowCustomModel = nextValue === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE;

        elements.openclawDefaultModelCustom.classList.toggle('hidden', !shouldShowCustomModel);
        elements.openclawDefaultModelCustom.disabled = !shouldShowCustomModel;

        if (!shouldShowCustomModel) {
            elements.openclawDefaultModelCustom.value = '';
        }
    }

    function refreshOpenClawDefaultModelOptions() {
        const formState = resolveOpenClawConfigFormState();
        renderOpenClawDefaultModelOptions(
            formState.defaultModelSuggestionsByProvider,
            resolveOpenClawAuthProviderIdFromForm() || inferOpenClawProviderIdFromModel(resolveOpenClawDefaultModelFromForm()),
            resolveOpenClawDefaultModelFromForm()
        );
    }

    function syncOpenClawConfigForm(force = false) {
        if (
            !elements.openclawStateDir
            || !elements.openclawConfigPath
            || !elements.openclawAuthProfilesPath
            || !elements.openclawGatewayPort
            || !elements.openclawGatewayToken
            || !elements.openclawDefaultWorkspace
            || !elements.openclawDefaultModel
            || !elements.openclawDefaultModelCustom
            || !elements.openclawAuthProvider
            || !elements.openclawAuthProviderCustom
            || !elements.openclawAuthApiKey
        ) {
            return;
        }

        if (state.openClawConfigFormDirty && !force) {
            return;
        }

        const formState = resolveOpenClawConfigFormState();
        elements.openclawStateDir.value = formState.stateDir;
        elements.openclawConfigPath.value = formState.configPath;
        elements.openclawAuthProfilesPath.value = formState.authProfilesPath;
        elements.openclawGatewayPort.value = formState.gatewayPort;
        elements.openclawGatewayToken.value = formState.gatewayToken;
        elements.openclawDefaultWorkspace.value = formState.defaultWorkspace;
        elements.openclawAuthApiKey.value = formState.authApiKey;
        renderOpenClawAuthProviderOptions(formState.authProviders, formState.authProviderId);
        renderOpenClawDefaultModelOptions(
            formState.defaultModelSuggestionsByProvider,
            formState.authProviderId || inferOpenClawProviderIdFromModel(formState.defaultModel),
            formState.defaultModel
        );
    }

    function collectOpenClawConfigSettings() {
        return {
            gatewayPort: elements.openclawGatewayPort?.value?.trim() || '',
            gatewayToken: elements.openclawGatewayToken?.value?.trim() || '',
            defaultWorkspace: elements.openclawDefaultWorkspace?.value?.trim() || '',
            defaultModel: resolveOpenClawDefaultModelFromForm(),
            authProviderId: resolveOpenClawAuthProviderIdFromForm(),
            authApiKey: elements.openclawAuthApiKey?.value?.trim() || ''
        };
    }

    function validateOpenClawConfigSettings(settings) {
        const gatewayPort = Number(settings.gatewayPort);
        if (!Number.isInteger(gatewayPort) || gatewayPort <= 0 || gatewayPort > 65535) {
            return {
                ok: false,
                message: window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.invalidPort') : 'Gateway port must be an integer between 1 and 65535.'
            };
        }

        if (settings.authApiKey && !settings.authProviderId) {
            return {
                ok: false,
                message: window.OpenClawI18n ? window.OpenClawI18n.t('setup.openclawConfig.authProviderRequired') : 'Choose or enter a provider before saving an API key.'
            };
        }

        return {
            ok: true,
            settings: {
                gatewayPort,
                gatewayToken: settings.gatewayToken,
                defaultWorkspace: settings.defaultWorkspace,
                defaultModel: settings.defaultModel,
                authProviderId: settings.authProviderId,
                authApiKey: settings.authApiKey
            }
        };
    }

    function saveOpenClawConfig() {
        state.openClawConfigStatus = null;
        renderOpenClawConfigStatus();
        const validation = validateOpenClawConfigSettings(collectOpenClawConfigSettings());
        if (!validation.ok) {
            setOpenClawConfigStatus('error', validation.message);
            return;
        }

        vscode.postMessage({
            type: 'saveOpenClawConfig',
            settings: validation.settings
        });
    }

    function setOpenClawConfigStatus(kind, text) {
        state.openClawConfigStatus = text ? { kind, text } : null;
        renderOpenClawConfigStatus();
    }

    function renderOpenClawConfigStatus() {
        if (!elements.openclawConfigStatus) {
            return;
        }

        const status = state.openClawConfigStatus;
        elements.openclawConfigStatus.classList.toggle('hidden', !status);
        elements.openclawConfigStatus.classList.toggle('success', status?.kind === 'success');
        elements.openclawConfigStatus.classList.toggle('error', status?.kind === 'error');
        elements.openclawConfigStatus.textContent = status?.text || '';
    }

    function resolveOpenClawConfigHint(t, openClawConfig) {
        if (!openClawConfig) {
            return t('setup.openclawConfig.hintUnavailable');
        }

        if (openClawConfig.exists && openClawConfig.authProfilesExists) {
            return t('setup.openclawConfig.hintExistingWithAuth', {
                path: openClawConfig.configPath,
                authPath: openClawConfig.authProfilesPath
            });
        }

        if (openClawConfig.exists) {
            return t('setup.openclawConfig.hintExisting', {
                path: openClawConfig.configPath
            });
        }

        if (openClawConfig.authProfilesExists) {
            return t('setup.openclawConfig.hintCreateWithAuth', {
                path: openClawConfig.configPath,
                authPath: openClawConfig.authProfilesPath
            });
        }

        return t('setup.openclawConfig.hintCreate', {
            path: openClawConfig.configPath
        });
    }

    function renderOpenClawAuthProviderOptions(authProviders, selectedProviderId = '') {
        if (!elements.openclawAuthProvider) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const normalizedProviderIds = Array.from(new Set((authProviders || [])
            .map(providerId => String(providerId || '').trim())
            .filter(Boolean)))
            .sort((left, right) => left.localeCompare(right));
        const resolvedSelectedProviderId = selectedProviderId && normalizedProviderIds.includes(selectedProviderId)
            ? selectedProviderId
            : selectedProviderId
                ? CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE
                : '';

        elements.openclawAuthProvider.innerHTML = [
            `<option value="">${escapeHtml(t('setup.openclawConfig.authProviderSelectPlaceholder'))}</option>`,
            ...normalizedProviderIds.map(providerId => `<option value="${escapeHtml(providerId)}">${escapeHtml(providerId)}</option>`),
            `<option value="${CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE}">${escapeHtml(t('setup.openclawConfig.authProviderCustomOption'))}</option>`
        ].join('');
        elements.openclawAuthProvider.value = resolvedSelectedProviderId;

        if (resolvedSelectedProviderId === CUSTOM_OPENCLAW_AUTH_PROVIDER_OPTION_VALUE && elements.openclawAuthProviderCustom) {
            elements.openclawAuthProviderCustom.value = selectedProviderId;
        }

        syncOpenClawAuthProviderCustomVisibility(resolvedSelectedProviderId);
    }

    function renderOpenClawDefaultModelOptions(defaultModelSuggestionsByProvider, providerId, selectedModelRef = '') {
        if (!elements.openclawDefaultModel) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const resolvedProviderId = String(providerId || '').trim();
        const providerSuggestions = Array.from(new Set((defaultModelSuggestionsByProvider?.[resolvedProviderId] || [])
            .map(modelRef => String(modelRef || '').trim())
            .filter(Boolean)));
        const resolvedSelectedModelRef = selectedModelRef && providerSuggestions.includes(selectedModelRef)
            ? selectedModelRef
            : selectedModelRef
                ? CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE
                : '';

        elements.openclawDefaultModel.innerHTML = [
            `<option value="">${escapeHtml(t('setup.openclawConfig.defaultModelSelectPlaceholder'))}</option>`,
            ...providerSuggestions.map(modelRef => `<option value="${escapeHtml(modelRef)}">${escapeHtml(modelRef)}</option>`),
            `<option value="${CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE}">${escapeHtml(t('setup.openclawConfig.defaultModelCustomOption'))}</option>`
        ].join('');
        elements.openclawDefaultModel.value = resolvedSelectedModelRef;

        if (resolvedSelectedModelRef === CUSTOM_OPENCLAW_DEFAULT_MODEL_OPTION_VALUE && elements.openclawDefaultModelCustom) {
            elements.openclawDefaultModelCustom.value = selectedModelRef;
        }

        syncOpenClawDefaultModelCustomVisibility(resolvedSelectedModelRef);
    }

    function renderOpenClawConfig() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (!vars) {
                return key;
            }
            return Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);
        };
        const shouldShow = shouldShowOpenClawConfigPanel();
        const openClawConfig = getOpenClawConfigState();

        if (elements.consoleOpenClawConfigPanel) {
            elements.consoleOpenClawConfigPanel.classList.toggle('hidden', !shouldShow);
        }

        if (!shouldShow) {
            return;
        }

        syncOpenClawConfigForm();

        if (elements.openclawConfigHint) {
            elements.openclawConfigHint.textContent = resolveOpenClawConfigHint(t, openClawConfig);
        }

        renderOpenClawConfigStatus();
    }

    async function copySetupCommand(kind) {
        const command = kind === 'onboard'
            ? ONBOARD_COMMAND
            : kind === 'start'
                ? START_OPENCLAW_COMMAND
                : INSTALL_COMMAND;

        try {
            await copyTextToClipboard(command);
            setConnectionSetupStatus(
                'success',
                (window.OpenClawI18n ? window.OpenClawI18n.t('setup.statusCopied') : 'Copied command to clipboard.')
            );
        } catch (error) {
            setConnectionSetupStatus(
                'error',
                String(error instanceof Error ? error.message : error)
            );
        }
    }

    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const copied = document.execCommand('copy');
            if (!copied) {
                throw new Error('Copy command failed.');
            }
        } finally {
            textarea.remove();
        }
    }

    function resolveRuntimeModeLabel(t) {
        switch (state.runtime.mode) {
            case 'openclaw':
                return t('console.mode.openclaw');
            case 'local':
                return t('console.mode.local');
            case 'gateway':
            default:
                return t('console.mode.gateway');
        }
    }

    function updateConnectionBadge() {
        if (!elements.connectionStatus || !elements.connectionLabel || !elements.connectionCaption || !elements.connectionPill) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const connected = Boolean(state.runtime.connected);
        const statusKey = connected ? 'console.connected' : 'console.disconnected';
        const modeLabel = resolveRuntimeModeLabel(t);

        elements.connectionStatus.classList.toggle('online', connected);
        elements.connectionStatus.classList.toggle('offline', !connected);
        elements.connectionPill.classList.toggle('online', connected);
        elements.connectionPill.classList.toggle('offline', !connected);
        elements.connectionLabel.textContent = t(statusKey);
        elements.connectionCaption.textContent = state.runtime.sourceDescription || modeLabel;
    }

    function supportsRuntimeCapability(capabilityId) {
        return Boolean(state.runtime.capabilities?.supports?.[capabilityId]);
    }

    function resolveCapabilityUnavailableMessage(capabilityId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        switch (capabilityId) {
            case 'agentEditing':
                return t('capability.unavailable.agentEditing');
            case 'scheduledTasks':
                return t('capability.unavailable.scheduledTasks');
            case 'liveSessionSync':
                return t('capability.unavailable.liveSessionSync');
            case 'swarmWorkspace':
                return t('capability.unavailable.swarmWorkspace');
            default:
                return t('capability.unavailable.generic', { capability: capabilityId });
        }
    }

    function renderCapabilityMatrix() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const capabilities = state.runtime.capabilities || null;
        const matrix = Array.isArray(state.runtime.capabilityMatrix) ? state.runtime.capabilityMatrix : [];
        const currentMode = state.runtime.mode || 'gateway';

        if (elements.consoleCapabilityTitle) {
            elements.consoleCapabilityTitle.textContent = capabilities?.currentModeTitleKey
                ? t(capabilities.currentModeTitleKey)
                : resolveRuntimeModeLabel(t);
        }

        if (elements.consoleCapabilityBody) {
            elements.consoleCapabilityBody.textContent = capabilities?.currentModeBodyKey
                ? t(capabilities.currentModeBodyKey)
                : resolveRuntimeModeLabel(t);
        }

        if (!elements.consoleCapabilityMatrix) {
            return;
        }

        elements.consoleCapabilityMatrix.innerHTML = matrix.map(row => {
            const title = t(row.titleKey);
            const summary = t(row.summaryKey);
            const cells = ['gateway', 'openclaw', 'local'].map(mode => {
                const cell = row.modes?.[mode] || { support: 'unavailable', noteKey: '' };
                const supportLabel = t(`capability.support.${cell.support}`);
                const note = cell.noteKey ? t(cell.noteKey) : '';
                return `
                    <td class="console-capability-cell ${escapeHtml(cell.support)}${mode === currentMode ? ' current' : ''}">
                        <span class="capability-support-badge ${escapeHtml(cell.support)}">${escapeHtml(supportLabel)}</span>
                        <div class="capability-support-note">${escapeHtml(note)}</div>
                    </td>
                `;
            }).join('');

            return `
                <tr>
                    <th scope="row">
                        <div class="capability-row-title">${escapeHtml(title)}</div>
                    </th>
                    <td>
                        <div class="capability-row-summary">${escapeHtml(summary)}</div>
                    </td>
                    ${cells}
                </tr>
            `;
        }).join('');
    }

    function renderConsoleOverview() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const modeLabel = resolveRuntimeModeLabel(t);
        const selectedAgent = state.agents.find(agent => agent.id === state.currentAgentId) || null;

        if (elements.consoleSummary) {
            if (state.agents.length === 0) {
                elements.consoleSummary.textContent = t('console.summaryNoAgents');
            } else if (state.runtime.connected) {
                elements.consoleSummary.textContent = t('console.summaryConnected', { mode: modeLabel });
            } else {
                elements.consoleSummary.textContent = t('console.summaryDisconnected', { mode: modeLabel });
            }
        }

        if (elements.consoleConnectionValue) {
            elements.consoleConnectionValue.textContent = t(state.runtime.connected ? 'console.connected' : 'console.disconnected');
        }
        if (elements.consoleConnectionMeta) {
            elements.consoleConnectionMeta.textContent = state.runtime.sourceDescription || modeLabel;
        }

        if (elements.consoleModeValue) {
            elements.consoleModeValue.textContent = modeLabel;
        }
        if (elements.consoleModeMeta) {
            elements.consoleModeMeta.textContent = state.runtime.capabilities?.currentModeTitleKey
                ? t(state.runtime.capabilities.currentModeTitleKey)
                : t(state.runtime.supportsLiveSync ? 'console.liveSync' : 'console.liveSyncDisabled');
        }

        if (elements.consoleAgentsValue) {
            elements.consoleAgentsValue.textContent = String(state.agents.length);
        }
        if (elements.consoleAgentsMeta) {
            elements.consoleAgentsMeta.textContent = selectedAgent
                ? t('console.currentAgent', { name: selectedAgent.name })
                : t('sidebar.noAgents');
        }

        if (elements.consoleTasksValue) {
            if (!state.runtime.supportsTasks) {
                elements.consoleTasksValue.textContent = t('console.unavailable');
            } else if (!state.tasksLoaded) {
                elements.consoleTasksValue.textContent = t('common.loading');
            } else {
                elements.consoleTasksValue.textContent = String(state.tasks.length);
            }
        }
        if (elements.consoleTasksMeta) {
            if (!state.runtime.supportsTasks) {
                elements.consoleTasksMeta.textContent = t('console.requiresCli');
            } else if (!state.tasksLoaded) {
                elements.consoleTasksMeta.textContent = t('tasks.note');
            } else if (state.tasks.length === 0) {
                elements.consoleTasksMeta.textContent = t('tasks.empty');
            } else {
                elements.consoleTasksMeta.textContent = t('console.tasksReady', { count: state.tasks.length });
            }
        }

        if (elements.consoleNextSteps) {
            elements.consoleNextSteps.innerHTML = buildConsoleSteps(t).map((step, index) => `
                <div class="console-step">
                    <span class="console-step-index">${index + 1}</span>
                    <div class="console-step-copy">
                        <div class="console-step-title">${escapeHtml(step.title)}</div>
                        <div class="console-step-text">${escapeHtml(step.text)}</div>
                    </div>
                </div>
            `).join('');
        }

        syncAgentOnboardingDraft(selectedAgent);
        renderAgentOnboarding();
        renderCapabilityMatrix();
        renderConnectionSetup();
        renderOpenClawConfig();
        updateChatHomeVisibility();
    }

    function buildConsoleSteps(t) {
        const steps = [];

        if (!state.runtime.connected) {
            steps.push({
                title: t('console.stepCheckConnectionTitle'),
                text: t('console.stepCheckConnection')
            });
        }

        if (state.agents.length === 0) {
            steps.push({
                title: t('console.stepCreateAgentTitle'),
                text: t('console.stepCreateAgent')
            });
        } else {
            steps.push({
                title: t('console.stepSendMessageTitle'),
                text: t('console.stepSendMessage')
            });
        }

        if (!state.runtime.supportsTasks) {
            steps.push({
                title: t('console.stepEnableTasksTitle'),
                text: t('console.stepEnableTasks')
            });
        } else {
            steps.push({
                title: t('console.stepScheduleTitle'),
                text: t('console.stepSchedule')
            });
        }

        steps.push(state.clusters.length === 0 ? {
            title: t('console.stepCreateClusterTitle'),
            text: t('console.stepCreateCluster')
        } : {
            title: t('console.stepCompareAgentsTitle'),
            text: t('console.stepCompareAgents')
        });

        return steps.slice(0, 4);
    }

    function updateChatHomeVisibility() {
        if (!elements.chatHome || !elements.chatMessages) {
            return;
        }

        const hasMessages = hasChatContent();
        const showOnboarding = shouldShowAgentOnboarding(hasMessages);
        if (!hasMessages) {
            state.chatHomePinned = false;
        }

        elements.chatHome.classList.toggle('hidden', hasMessages && !state.chatHomePinned);
        elements.agentOnboardingPanel?.classList.toggle('hidden', !showOnboarding);
        elements.chatConsoleHomeContent?.classList.toggle('hidden', showOnboarding);
        updateOpenClawConfigEntryState();
    }

    function shouldShowAgentOnboarding(hasMessages = hasChatContent()) {
        if (hasMessages) {
            return false;
        }

        if (!state.runtime.connected || state.forceSetupPanel || state.agents.length === 0) {
            return false;
        }

        return Boolean(state.agents.find(agent => agent.id === state.currentAgentId));
    }

    // Send message
