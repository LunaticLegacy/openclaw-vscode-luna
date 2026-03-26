// OpenClaw Luna - Panel Agent Forms
// 代理表单管理模块 - 处理代理创建、预设、技能市场、设置等功能
'use strict';

    /**
     * 选择指定代理并切换到聊天视图
     * @param {string} agentId - 代理的唯一标识符
     * @returns {void}
     */
    function selectAgent(agentId) {
        // 更新当前选中的代理ID
        state.currentAgentId = agentId;
        // 更新UI中高亮显示选中的代理项
        document.querySelectorAll('.agent-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === agentId);
        });

        // 如果当前不是聊天视图，则切换到聊天视图
        if (state.viewMode !== 'chat') {
            applyView('chat');
            vscode.postMessage({ type: 'switchView', view: 'chat' });
        }

        // 重新渲染控制台概览
        renderConsoleOverview();
        // 如果技能市场模态框处于打开状态，则重新渲染技能市场
        if (elements.modalSkillMarket?.classList.contains('active')) {
            renderSkillMarket();
        }
        // 通知扩展宿主选中了代理
        vscode.postMessage({ type: 'selectAgent', agentId });
    }

    /**
     * 安装指定的技能
     * @param {string} skillId - 技能的唯一标识符
     * @param {string} [hubId] - 技能来源的Hub ID（可选）
     * @returns {void}
     */
    function installSkill(skillId, hubId) {
        // 验证技能ID有效性
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }

        // 查找安装按钮并更新状态为"安装中"
        const installBtn = document.querySelector(`[data-skill-install="${escapeHtml(skillId)}"]`);
        if (installBtn) {
            const originalText = installBtn.textContent;
            installBtn.textContent = t('skillMarket.installing') || 'Installing...';
            installBtn.disabled = true;

            // 3秒后恢复按钮状态（防止长时间无响应）
            setTimeout(() => {
                if (installBtn) {
                    installBtn.textContent = originalText;
                    installBtn.disabled = false;
                }
            }, 3000);
        }

        // 向扩展宿主发送安装技能的消息
        vscode.postMessage({
            type: 'installSkill',
            skillId: skillId,
            hubId: hubId || null
        });
    }

    /**
     * 卸载指定的技能
     * @param {string} skillId - 技能的唯一标识符
     * @returns {void}
     */
    function uninstallSkill(skillId) {
        // 验证技能ID有效性
        if (!skillId) {
            showError('Invalid skill ID');
            return;
        }

        // 查找卸载按钮并更新状态为"卸载中"
        const uninstallBtn = document.querySelector(`[data-skill-uninstall="${escapeHtml(skillId)}"]`);
        if (uninstallBtn) {
            const originalText = uninstallBtn.textContent;
            uninstallBtn.textContent = t('skillMarket.uninstalling') || 'Uninstalling...';
            uninstallBtn.disabled = true;

            // 3秒后恢复按钮状态
            setTimeout(() => {
                if (uninstallBtn) {
                    uninstallBtn.textContent = originalText;
                    uninstallBtn.disabled = false;
                }
            }, 3000);
        }

        // 向扩展宿主发送卸载技能的消息
        vscode.postMessage({
            type: 'uninstallSkill',
            skillId: skillId
        });
    }

    /**
     * 打开新建代理的模态框
     * @returns {void}
     */
    function openNewAgentModal() {
        // 重置表单到初始状态
        resetNewAgentForm();
        // 打开模态框
        openModal(elements.modalNewAgent);
    }

    /**
     * 设置代理预设列表
     * @param {Array<Object>} presets - 代理预设数组，每个预设包含id、name、systemPrompt等属性
     * @returns {void}
     */
    function setAgentPresets(presets) {
        // 存储预设列表，确保是数组类型
        state.agentPresets = Array.isArray(presets) ? presets : [];

        // 如果当前选中的预设ID不在列表中，重置为自定义预设
        if (!state.agentPresets.some(preset => preset.id === state.newAgentPresetId)) {
            state.newAgentPresetId = CUSTOM_AGENT_PRESET_ID;
        }

        // 如果当前是预设模式且选中的是自定义预设，则自动应用第一个预设
        if (state.newAgentMode === 'preset' && state.newAgentPresetId === CUSTOM_AGENT_PRESET_ID && state.agentPresets[0]) {
            applySelectedAgentPreset(state.agentPresets[0].id, { resetToDefault: true });
            return;
        }

        // 重新渲染相关UI组件
        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
        renderAgentOnboarding();
    }

    /**
     * 根据ID获取代理预设
     * @param {string} presetId - 预设的唯一标识符
     * @returns {Object|null} 预设对象，如果不存在则返回null
     */
    function getAgentPresetById(presetId) {
        return state.agentPresets.find(preset => preset.id === presetId) || null;
    }

    /**
     * 获取当前选中的代理预设
     * @returns {Object|null} 当前选中的预设对象
     */
    function getSelectedAgentPreset() {
        return getAgentPresetById(state.newAgentPresetId);
    }

    /**
     * 获取当前选中的代理引导预设
     * @returns {Object|null} 当前选中的引导预设对象
     */
    function getSelectedAgentOnboardingPreset() {
        return getAgentPresetById(state.agentOnboardingPresetId);
    }

    /**
     * 渲染新建代理模式UI（预设模式/自定义模式/批量模式）
     * @returns {void}
     */
    function renderNewAgentMode() {
        // 判断当前模式
        const isPresetMode = state.newAgentMode === 'preset';
        const isBatchMode = state.newAgentMode === 'batch';

        // 更新模式按钮的激活状态
        elements.newAgentModeButtons?.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-new-agent-mode') === state.newAgentMode);
        });

        // 根据模式显示/隐藏对应的面板
        elements.newAgentPresetPanel?.classList.toggle('hidden', !isPresetMode);
        elements.newAgentSingleFields?.classList.toggle('hidden', isBatchMode);
        elements.newAgentBatchPanel?.classList.toggle('hidden', !isBatchMode);
        
        // 重新渲染相关UI
        renderNewAgentPresetGrid();
        renderNewAgentPresetDescription();
        renderBatchCreateAgentsStatus();
    }

    /**
     * 渲染代理预设选择网格
     * @returns {void}
     */
    function renderNewAgentPresetGrid() {
        // 检查DOM元素是否存在
        if (!elements.newAgentPresetGrid) {
            return;
        }

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 如果没有可用预设，显示空状态提示
        if (!state.agentPresets.length) {
            elements.newAgentPresetGrid.innerHTML = `
                <div class="new-agent-preset-empty">${escapeHtml(t('newAgent.preset.empty'))}</div>
            `;
            return;
        }

        // 渲染预设卡片网格
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

    /**
     * 渲染选中预设的详细描述面板
     * @returns {void}
     */
    function renderNewAgentPresetDescription() {
        if (!elements.newAgentPresetDescription) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = getSelectedAgentPreset();

        // 如果没有选中预设，显示画廊提示
        if (!preset) {
            elements.newAgentPresetDescription.innerHTML = `
                <div class="new-agent-preset-summary-label">${escapeHtml(t('newAgent.preset.galleryEyebrow'))}</div>
                <div class="new-agent-preset-summary-text">${escapeHtml(t('newAgent.preset.galleryHint'))}</div>
            `;
            return;
        }

        // 渲染预设详细信息
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

    /**
     * 渲染预设详情项的HTML
     * @param {string} label - 详情项的标签
     * @param {string} value - 详情项的值
     * @returns {string} 详情项的HTML字符串
     */
    function renderPresetSummaryDetail(label, value) {
        return `
            <div class="new-agent-preset-detail">
                <div class="new-agent-preset-detail-label">${escapeHtml(label)}</div>
                <div class="new-agent-preset-detail-value">${escapeHtml(value || '-')}</div>
            </div>
        `;
    }

    /**
     * 获取当前选中的代理对象
     * @returns {Object|null} 当前代理对象，如果没有则返回null
     */
    function resolveCurrentAgent() {
        return state.agents.find(agent => agent.id === state.currentAgentId) || null;
    }

    /**
     * 解析代理的系统提示词种子值
     * @param {Object} agent - 代理对象
     * @returns {string} 系统提示词，如果代理没有则返回默认提示词
     */
    function resolveOnboardingPromptSeed(agent) {
        // 优先使用代理的系统提示词
        const prompt = String(agent?.systemPrompt || '').trim();
        if (prompt) {
            return prompt;
        }

        // 如果没有则使用默认提示词
        const fallback = t('newAgent.defaultSystemPrompt');
        return fallback === 'newAgent.defaultSystemPrompt' ? 'You are a helpful assistant.' : fallback;
    }

    /**
     * 同步代理引导编辑的草稿状态
     * @param {Object} agent - 代理对象
     * @param {Object} [options={}] - 配置选项
     * @param {boolean} [options.forceReset] - 是否强制重置草稿
     * @returns {void}
     */
    function syncAgentOnboardingDraft(agent, options = {}) {
        const forceReset = options.forceReset === true;
        // 如果没有提供代理，清空草稿状态
        if (!agent) {
            state.agentOnboardingAgentId = null;
            state.agentOnboardingPresetId = '';
            state.agentOnboardingPrompt = '';
            state.agentOnboardingSaving = false;
            state.agentOnboardingStatus = null;
            return;
        }

        // 如果不是强制重置且代理ID未变，则跳过
        if (!forceReset && state.agentOnboardingAgentId === agent.id) {
            return;
        }

        // 获取提示词并尝试匹配预设
        const nextPrompt = resolveOnboardingPromptSeed(agent);
        const matchedPreset = state.agentPresets.find(preset => preset.systemPrompt === nextPrompt) || null;

        // 更新草稿状态
        state.agentOnboardingAgentId = agent.id;
        state.agentOnboardingPresetId = matchedPreset?.id || '';
        state.agentOnboardingPrompt = nextPrompt;
        state.agentOnboardingSaving = false;
        state.agentOnboardingStatus = null;
    }

    /**
     * 设置代理引导状态
     * @param {string} kind - 状态类型（'success'/'error'）
     * @param {string} text - 状态文本
     * @returns {void}
     */
    function setAgentOnboardingStatus(kind, text) {
        state.agentOnboardingStatus = text ? { kind, text } : null;
        renderAgentOnboarding();
    }

    /**
     * 渲染代理引导面板
     * @returns {void}
     */
    function renderAgentOnboarding() {
        if (!elements.agentOnboardingPanel) {
            return;
        }

        // 获取当前代理
        const agent = resolveCurrentAgent();
        if (!agent) {
            elements.agentOnboardingPanel.classList.add('hidden');
            return;
        }

        // 同步草稿状态
        syncAgentOnboardingDraft(agent);

        // 更新代理信息显示
        if (elements.agentOnboardingAgentName) {
            elements.agentOnboardingAgentName.textContent = agent.name || '-';
        }
        if (elements.agentOnboardingAgentModel) {
            elements.agentOnboardingAgentModel.textContent = agent.model || '-';
        }
        // 更新提示词输入框（避免不必要的DOM操作）
        if (elements.agentOnboardingPrompt && elements.agentOnboardingPrompt.value !== state.agentOnboardingPrompt) {
            elements.agentOnboardingPrompt.value = state.agentOnboardingPrompt || '';
        }

        // 渲染相关子组件
        renderAgentOnboardingPresetGrid();
        renderAgentOnboardingPresetSummary();
        renderAgentOnboardingStatus();

        // 更新按钮状态
        if (elements.btnSaveAgentOnboarding) {
            elements.btnSaveAgentOnboarding.disabled = state.agentOnboardingSaving;
        }
        if (elements.btnOpenAgentOnboardingSettings) {
            elements.btnOpenAgentOnboardingSettings.disabled = state.agentOnboardingSaving;
        }
    }

    /**
     * 渲染代理引导的预设选择网格
     * @returns {void}
     */
    function renderAgentOnboardingPresetGrid() {
        if (!elements.agentOnboardingPresetGrid) {
            return;
        }

        // 如果没有可用预设，显示空状态
        if (!state.agentPresets.length) {
            elements.agentOnboardingPresetGrid.innerHTML = `
                <div class="new-agent-preset-empty">${escapeHtml(t('newAgent.preset.empty'))}</div>
            `;
            return;
        }

        // 渲染预设卡片
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

    /**
     * 渲染代理引导的预设摘要信息
     * @returns {void}
     */
    function renderAgentOnboardingPresetSummary() {
        if (!elements.agentOnboardingPresetSummary) {
            return;
        }

        const preset = getSelectedAgentOnboardingPreset();
        // 如果没有选中预设，显示自定义提示
        if (!preset) {
            elements.agentOnboardingPresetSummary.innerHTML = `
                <div class="new-agent-preset-summary-label">${escapeHtml(t('agentOnboarding.customLabel'))}</div>
                <div class="new-agent-preset-summary-text">${escapeHtml(t('agentOnboarding.customHint'))}</div>
            `;
            return;
        }

        // 渲染预设摘要
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

    /**
     * 渲染代理引导状态提示
     * @returns {void}
     */
    function renderAgentOnboardingStatus() {
        if (!elements.agentOnboardingStatus) {
            return;
        }

        const status = state.agentOnboardingStatus;
        // 根据状态类型显示/隐藏并设置样式
        elements.agentOnboardingStatus.classList.toggle('hidden', !status);
        elements.agentOnboardingStatus.classList.toggle('success', status?.kind === 'success');
        elements.agentOnboardingStatus.classList.toggle('error', status?.kind === 'error');
        elements.agentOnboardingStatus.textContent = status?.text || '';
    }

    /**
     * 应用选中的代理引导预设
     * @param {string} presetId - 预设ID
     * @returns {void}
     */
    function applyAgentOnboardingPreset(presetId) {
        const preset = getAgentPresetById(presetId);
        if (!preset) {
            return;
        }

        // 更新草稿状态为选中的预设
        state.agentOnboardingPresetId = preset.id;
        state.agentOnboardingPrompt = preset.systemPrompt || '';
        state.agentOnboardingStatus = null;
        renderAgentOnboarding();
    }

    /**
     * 打开代理引导设置页面
     * @returns {void}
     */
    function openAgentOnboardingSettings() {
        const agent = resolveCurrentAgent();
        if (!agent) {
            return;
        }

        // 通知扩展宿主打开代理设置
        vscode.postMessage({ type: 'openAgentSettings', agentId: agent.id });
    }

    /**
     * 保存代理引导设置
     * @returns {void}
     */
    function saveAgentOnboarding() {
        const agent = resolveCurrentAgent();
        if (!agent) {
            return;
        }

        // 获取并验证提示词
        const nextPrompt = String(elements.agentOnboardingPrompt?.value || state.agentOnboardingPrompt || '').trim();
        if (!nextPrompt) {
            setAgentOnboardingStatus('error', t('agentOnboarding.promptRequired'));
            return;
        }

        // 更新保存状态
        state.agentOnboardingPrompt = nextPrompt;
        state.agentOnboardingSaving = true;
        setAgentOnboardingStatus('success', t('agentOnboarding.saving'));
        
        // 发送保存请求到扩展宿主
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

    /**
     * 设置新建代理的模式
     * @param {string} mode - 模式名称（'preset'/'batch'/'custom'）
     * @param {Object} [options={}] - 配置选项
     * @param {boolean} [options.resetToDefault=true] - 是否重置为默认值
     * @returns {void}
     */
    function setNewAgentMode(mode, options = { resetToDefault: true }) {
        // 规范化模式值
        const nextMode = mode === 'preset' ? 'preset' : mode === 'batch' ? 'batch' : 'custom';
        if (state.newAgentMode === nextMode) {
            renderNewAgentMode();
            return;
        }

        state.newAgentMode = nextMode;

        // 根据模式执行相应的初始化逻辑
        if (state.newAgentMode === 'preset') {
            // 预设模式：选中第一个可用预设或自定义
            const nextPresetId = getSelectedAgentPreset()?.id || state.agentPresets[0]?.id || CUSTOM_AGENT_PRESET_ID;
            if (nextPresetId !== CUSTOM_AGENT_PRESET_ID) {
                applySelectedAgentPreset(nextPresetId, { resetToDefault: true });
            } else {
                renderNewAgentMode();
            }
            return;
        }

        if (state.newAgentMode === 'batch') {
            // 批量模式：同步模型表单状态
            syncAgentModelFormState('batch');
            setBatchCreateAgentsStatus('info', t('agentBatch.saveHint'));
            renderNewAgentMode();
            return;
        }

        // 自定义模式：应用自定义预设
        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, {
            resetToDefault: options.resetToDefault !== false
        });
    }

    /**
     * 应用选中的代理预设
     * @param {string} presetId - 预设ID
     * @param {Object} [options={}] - 配置选项
     * @param {boolean} [options.resetToDefault=false] - 是否重置为默认值
     * @returns {void}
     */
    function applySelectedAgentPreset(presetId, options = { resetToDefault: false }) {
        state.newAgentPresetId = presetId || CUSTOM_AGENT_PRESET_ID;

        const preset = getSelectedAgentPreset();
        if (preset) {
            // 应用预设的默认值到表单
            if (elements.newAgentName) {
                elements.newAgentName.value = preset.defaultName;
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = preset.systemPrompt;
            }
            syncAgentModelFormState('new', preset.recommendedModel || '');
        } else if (options.resetToDefault) {
            // 重置为默认空值
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            if (elements.newAgentName) {
                elements.newAgentName.value = '';
            }
            if (elements.newAgentPrompt) {
                elements.newAgentPrompt.value = t('newAgent.defaultSystemPrompt');
            }
            syncAgentModelFormState('new');
        }

        // 重新渲染UI
        renderNewAgentMode();
        renderNewAgentPresetDescription();
    }

    /**
     * 重置新建代理表单
     * @returns {void}
     */
    function resetNewAgentForm() {
        elements.formNewAgent?.reset();
        state.newAgentMode = 'custom';
        // 清空批量创建相关字段
        if (elements.batchAgentNames) {
            elements.batchAgentNames.value = '';
        }
        if (elements.batchAgentPrompt) {
            elements.batchAgentPrompt.value = '';
        }
        syncAgentModelFormState('batch');
        setBatchCreateAgentsStatus('info', t('agentBatch.saveHint'));
        // 应用自定义预设
        applySelectedAgentPreset(CUSTOM_AGENT_PRESET_ID, { resetToDefault: true });
    }

    /**
     * 填充模型选择下拉框
     * @param {Array<string>} models - 可用模型列表
     * @returns {void}
     */
    function populateModelSelect(models) {
        state.availableModels = Array.isArray(models) ? models : [];
        // 同步所有相关表单的模型状态
        syncAgentModelFormState('new');
        syncAgentModelFormState('settings');
        syncAgentModelFormState('batch');
        syncAgentModelFormState('clusterBatch');
    }

    /**
     * 构建代理模型目录
     * @returns {Object} 包含providers和directModels的对象
     */
    function buildAgentModelCatalog() {
        // 收集所有模型引用（去重）
        const modelRefs = Array.from(new Set([
            ...(Array.isArray(state.availableModels) ? state.availableModels : []),
            ...((Array.isArray(state.agents) ? state.agents : []).map(agent => agent.model))
        ].map(modelRef => String(modelRef || '').trim()).filter(Boolean)));
        
        const providers = new Map();
        const directModels = [];

        // 分类模型：按提供商分组或直接模型
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

        // 规范化提供商数据（排序和去重）
        const normalizedProviders = Array.from(providers.entries())
            .map(([providerId, providerModels]) => [providerId, Array.from(new Set(providerModels)).sort((left, right) => left.localeCompare(right))])
            .sort((left, right) => left[0].localeCompare(right[0]));

        return {
            providers: normalizedProviders,
            directModels: Array.from(new Set(directModels)).sort((left, right) => left.localeCompare(right))
        };
    }

    /**
     * 解析代理模型引用字符串
     * @param {string} modelRef - 模型引用字符串（如"openai/gpt-4"或"gpt-4"）
     * @returns {Object} 包含providerId和modelName的对象
     */
    function parseAgentModelRef(modelRef) {
        const normalizedModelRef = String(modelRef || '').trim();
        if (!normalizedModelRef) {
            return {
                providerId: '',
                modelName: ''
            };
        }

        // 查找分隔符位置
        const slashIndex = normalizedModelRef.indexOf('/');
        if (slashIndex <= 0) {
            // 没有提供商前缀，返回完整字符串作为模型名
            return {
                providerId: '',
                modelName: normalizedModelRef
            };
        }

        // 分割提供商ID和模型名
        return {
            providerId: normalizedModelRef.slice(0, slashIndex).trim(),
            modelName: normalizedModelRef.slice(slashIndex + 1).trim()
        };
    }

    /**
     * 获取代理模型表单元素
     * @param {string} scope - 表单范围（'batch'/'clusterBatch'/'settings'/'new'）
     * @returns {Object} 包含provider、providerCustom、model、modelCustom的对象
     */
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

        // 根据scope返回对应的表单元素
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

    /**
     * 获取OpenClaw配置的认证提供商
     * @returns {string} 认证提供商ID
     */
    function getOpenClawConfigAuthProvider() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.authProviderId || '';
    }

    /**
     * 获取OpenClaw配置的默认模型
     * @returns {string} 默认模型名称
     */
    function getOpenClawConfigDefaultModel() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.defaultModel || '';
    }

    /**
     * 获取OpenClaw配置的模型建议列表
     * @returns {Object} 按提供商分组的模型建议
     */
    function getOpenClawConfigModelSuggestions() {
        const openClawConfig = state.runtime?.openClawConfig;
        return openClawConfig?.defaultModelSuggestionsByProvider || {};
    }

    /**
     * 渲染代理模型提供商选项
     * @param {string} scope - 表单范围
     * @param {string} [selectedModelRef=''] - 当前选中的模型引用
     * @returns {void}
     */
    function renderAgentModelProviderOptions(scope, selectedModelRef = '') {
        const refs = getAgentModelFormElements(scope);
        if (!refs.provider) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        
        // 从配置获取认证提供商列表
        const openClawConfig = state.runtime?.openClawConfig;
        const authProviders = Array.isArray(openClawConfig?.authProviders) ? openClawConfig.authProviders : [];
        const configProvider = openClawConfig?.authProviderId || '';
        
        // 解析当前模型以确定提供商
        const parsed = parseAgentModelRef(selectedModelRef);
        const currentProvider = parsed.providerId || configProvider || '';
        
        // 确定选中的提供商值
        const resolvedProviderValue = currentProvider && authProviders.includes(currentProvider)
            ? currentProvider
            : currentProvider
                ? CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE
                : authProviders[0] || '';

        // 渲染提供商下拉选项
        refs.provider.innerHTML = [
            `<option value="">${escapeHtml(t('agentSettings.modelProviderPlaceholder'))}</option>`,
            ...authProviders.map(providerId => `<option value="${escapeHtml(providerId)}">${escapeHtml(providerId)}</option>`),
            `<option value="${CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE}">${escapeHtml(t('agentSettings.modelProviderCustom'))}</option>`
        ].join('');
        
        refs.provider.value = resolvedProviderValue;

        // 如果是自定义提供商，填充自定义输入框
        if (resolvedProviderValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE && refs.providerCustom) {
            refs.providerCustom.value = currentProvider || '';
        }

        // 同步自定义提供商输入框的可见性
        syncAgentModelProviderCustomVisibility(scope, resolvedProviderValue);
        renderAgentModelOptions(scope, resolvedProviderValue, selectedModelRef);
    }

    /**
     * 渲染代理模型选项
     * @param {string} scope - 表单范围
     * @param {string} providerValue - 选中的提供商值
     * @param {string} [selectedModelRef=''] - 当前选中的模型引用
     * @returns {void}
     */
    function renderAgentModelOptions(scope, providerValue, selectedModelRef = '') {
        const refs = getAgentModelFormElements(scope);
        if (!refs.model) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : key => key;
        const selectedProviderValue = String(providerValue || refs.provider?.value || '').trim();
        
        // 从配置获取模型建议
        const suggestionsByProvider = getOpenClawConfigModelSuggestions();
        const configDefaultModel = getOpenClawConfigDefaultModel();
        
        // 获取选中提供商的可用模型
        let providerModels = [];
        if (selectedProviderValue && selectedProviderValue !== CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
            providerModels = Array.isArray(suggestionsByProvider[selectedProviderValue]) 
                ? suggestionsByProvider[selectedProviderValue] 
                : [];
        }
        
        // 从代理管理器获取匹配的可用模型
        const allAvailableModels = Array.isArray(state.availableModels) ? state.availableModels : [];
        const matchingModels = allAvailableModels.filter(modelRef => {
            if (!selectedProviderValue || selectedProviderValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
                return true;
            }
            return modelRef.startsWith(selectedProviderValue + '/');
        });
        
        // 合并建议列表和匹配模型，去重
        const mergedModels = Array.from(new Set([...providerModels, ...matchingModels]));
        
        // 解析当前模型
        const parsed = parseAgentModelRef(selectedModelRef);
        let customModelValue = '';
        
        // 确定要选中的模型值
        let resolvedModelValue = '';
        if (selectedModelRef && mergedModels.includes(selectedModelRef)) {
            // 使用代理当前模型（如果在列表中）
            resolvedModelValue = selectedModelRef;
        } else if (selectedModelRef && parsed.modelName) {
            // 使用自定义模型（如果代理的模型不在列表中）
            resolvedModelValue = CUSTOM_AGENT_MODEL_OPTION_VALUE;
            customModelValue = selectedModelRef;
        } else if (configDefaultModel && mergedModels.includes(configDefaultModel)) {
            // 回退到OpenClaw配置的默认模型
            resolvedModelValue = configDefaultModel;
        } else if (mergedModels.length > 0) {
            // 回退到第一个可用模型
            resolvedModelValue = mergedModels[0];
        }

        // 渲染模型下拉选项
        refs.model.innerHTML = [
            `<option value="">${escapeHtml(t('agentSettings.modelSelectPlaceholder'))}</option>`,
            ...mergedModels.map(modelRef => `<option value="${escapeHtml(modelRef)}">${escapeHtml(modelRef)}</option>`),
            `<option value="${CUSTOM_AGENT_MODEL_OPTION_VALUE}">${escapeHtml(t('agentSettings.modelCustom'))}</option>`
        ].join('');
        refs.model.value = resolvedModelValue;

        // 如果是自定义模型，填充自定义输入框
        if (resolvedModelValue === CUSTOM_AGENT_MODEL_OPTION_VALUE && refs.modelCustom) {
            refs.modelCustom.value = customModelValue || '';
        }

        // 同步自定义模型输入框的可见性
        syncAgentModelCustomVisibility(scope, resolvedModelValue);
    }

    /**
     * 同步代理模型提供商自定义输入框的可见性
     * @param {string} scope - 表单范围
     * @param {string} selectedProviderValue - 选中的提供商值
     * @returns {void}
     */
    function syncAgentModelProviderCustomVisibility(scope, selectedProviderValue) {
        const refs = getAgentModelFormElements(scope);
        if (!refs.providerCustom) {
            return;
        }

        // 判断是否显示自定义提供商输入框
        const shouldShowCustomProvider = (selectedProviderValue ?? refs.provider?.value ?? '') === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE;
        refs.providerCustom.classList.toggle('hidden', !shouldShowCustomProvider);
        refs.providerCustom.disabled = !shouldShowCustomProvider;

        // 如果不显示，清空输入框
        if (!shouldShowCustomProvider) {
            refs.providerCustom.value = '';
        }
    }

    /**
     * 同步代理模型自定义输入框的可见性
     * @param {string} scope - 表单范围
     * @param {string} selectedModelValue - 选中的模型值
     * @returns {void}
     */
    function syncAgentModelCustomVisibility(scope, selectedModelValue) {
        const refs = getAgentModelFormElements(scope);
        if (!refs.modelCustom) {
            return;
        }

        // 判断是否显示自定义模型输入框
        const shouldShowCustomModel = (selectedModelValue ?? refs.model?.value ?? '') === CUSTOM_AGENT_MODEL_OPTION_VALUE;
        refs.modelCustom.classList.toggle('hidden', !shouldShowCustomModel);
        refs.modelCustom.disabled = !shouldShowCustomModel;

        // 如果不显示，清空输入框
        if (!shouldShowCustomModel) {
            refs.modelCustom.value = '';
        }
    }

    /**
     * 同步代理模型表单状态
     * @param {string} scope - 表单范围
     * @param {string} [selectedModelRef] - 选中的模型引用
     * @returns {void}
     */
    function syncAgentModelFormState(scope, selectedModelRef) {
        renderAgentModelProviderOptions(scope, selectedModelRef || resolveAgentModelRefFromForm(scope));
    }

    /**
     * 处理代理模型提供商变更事件
     * @param {string} scope - 表单范围
     * @returns {void}
     */
    function handleAgentModelProviderChange(scope) {
        const refs = getAgentModelFormElements(scope);
        const providerValue = String(refs.provider?.value || '').trim();
        syncAgentModelProviderCustomVisibility(scope, providerValue);
        renderAgentModelOptions(scope, providerValue, '');
    }

    /**
     * 从表单解析代理模型引用
     * @param {string} scope - 表单范围
     * @returns {string} 模型引用字符串
     */
    function resolveAgentModelRefFromForm(scope) {
        const refs = getAgentModelFormElements(scope);
        const providerValue = String(refs.provider?.value || '').trim();
        const selectedModelValue = String(refs.model?.value || '').trim();

        // 如果是自定义模型，组合完整引用
        if (selectedModelValue === CUSTOM_AGENT_MODEL_OPTION_VALUE) {
            const customModel = String(refs.modelCustom?.value || '').trim();
            if (!customModel) {
                return '';
            }

            // 自定义提供商
            if (providerValue === CUSTOM_AGENT_MODEL_PROVIDER_OPTION_VALUE) {
                const customProvider = String(refs.providerCustom?.value || '').trim();
                return customProvider ? `${customProvider}/${customModel}` : customModel;
            }

            // 直接模型（无提供商）
            if (providerValue === DIRECT_AGENT_MODEL_PROVIDER_OPTION_VALUE || !providerValue) {
                return customModel;
            }

            // 组合提供商和模型
            return `${providerValue}/${customModel}`;
        }

        return selectedModelValue;
    }

    /**
     * 创建代理（支持单创建和批量创建）
     * @returns {void}
     */
    function createAgent() {
        // 批量创建模式
        if (state.newAgentMode === 'batch') {
            createAgentsBatch();
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const preset = state.newAgentMode === 'preset' ? getSelectedAgentPreset() : null;
        
        // 收集表单数据
        const data = {
            name: elements.newAgentName?.value?.trim() || '',
            model: resolveAgentModelRefFromForm('new'),
            systemPrompt: elements.newAgentPrompt?.value?.trim() || t('newAgent.defaultSystemPrompt'),
            presetId: preset?.id || undefined
        };

        // 验证预设模式必须选择预设
        if (state.newAgentMode === 'preset' && !preset) {
            showError(t('newAgent.preset.required'));
            return;
        }

        // 验证必填字段
        if (!data.name || !data.model) {
            return;
        }

        // 清除之前的变更计时器
        if (agentMutationTimer) {
            window.clearTimeout(agentMutationTimer);
            agentMutationTimer = null;
        }
        
        // 设置代理变更状态
        state.agentMutation = {
            action: 'create',
            pending: true,
            agentName: data.name,
            agentId: ''
        };
        renderAgents(state.agents);

        // 发送创建请求
        vscode.postMessage({ type: 'createAgent', data });
        closeAllModals();
        resetNewAgentForm();
    }

    /**
     * 解析批量代理名称（按行分割）
     * @param {string} value - 包含名称的文本
     * @returns {Array<string>} 去重后的名称数组
     */
    function parseBatchAgentNames(value) {
        return Array.from(new Set(
            String(value || '')
                .split(/\r?\n/g)
                .map(entry => entry.trim())
                .filter(Boolean)
        ));
    }

    /**
     * 设置批量创建代理的状态提示
     * @param {string} kind - 状态类型（'success'/'error'/'info'）
     * @param {string} text - 状态文本
     * @returns {void}
     */
    function setBatchCreateAgentsStatus(kind, text) {
        state.batchCreateAgentsStatus = text ? { kind, text } : null;
        renderBatchCreateAgentsStatus();
    }

    /**
     * 渲染批量创建代理的状态提示
     * @returns {void}
     */
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

    /**
     * 批量创建代理
     * @returns {void}
     */
    function createAgentsBatch() {
        // 解析表单数据
        const names = parseBatchAgentNames(elements.batchAgentNames?.value || '');
        const model = resolveAgentModelRefFromForm('batch');
        const systemPrompt = String(elements.batchAgentPrompt?.value || '').trim();

        // 验证名称列表
        if (names.length === 0) {
            setBatchCreateAgentsStatus('error', t('agentBatch.validationNames'));
            return;
        }

        // 验证模型
        if (!model) {
            setBatchCreateAgentsStatus('error', t('agentBatch.validationModel'));
            return;
        }

        // 设置保存状态
        state.batchCreateAgentsSaving = true;
        setBatchCreateAgentsStatus('success', t('agentBatch.pending'));
        
        // 发送批量创建请求
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

    /**
     * 读取集群批量创建代理的草稿数据
     * @returns {Array<Object>} 代理草稿对象数组
     */
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

    /**
     * 重置集群批量创建输入
     * @returns {void}
     */
    function resetClusterBatchCreateInputs() {
        if (elements.clusterBatchAgentNames) {
            elements.clusterBatchAgentNames.value = '';
        }
        if (elements.clusterBatchAgentPrompt) {
            elements.clusterBatchAgentPrompt.value = '';
        }
        syncAgentModelFormState('clusterBatch');
    }

    /**
     * 渲染代理技能选择器
     * @param {Array<string>} enabledSkills - 已启用的技能ID列表
     * @returns {void}
     */
    function renderAgentSkillsPicker(enabledSkills) {
        if (!elements.agentSkillsPicker) {
            return;
        }

        // 获取已选中的技能集合
        const selected = new Set(Array.isArray(enabledSkills) ? enabledSkills : []);
        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        
        // 如果没有可用技能，清空选择器
        if (skills.length === 0) {
            elements.agentSkillsPicker.innerHTML = '';
            return;
        }

        // 渲染技能复选框列表
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

    /**
     * 渲染代理技能链接列表
     * @returns {void}
     */
    function renderAgentSkillLinks() {
        if (!elements.agentSkillLinks) {
            return;
        }

        const skills = Array.isArray(state.aiSkills) ? state.aiSkills : [];
        if (skills.length === 0) {
            elements.agentSkillLinks.innerHTML = '';
            return;
        }

        // 去重收集技能下载链接
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

        // 渲染链接卡片
        elements.agentSkillLinks.innerHTML = Array.from(uniqueLinks.entries()).map(([url, entry]) => `
            <button type="button" class="btn skill-link-card" data-skill-url="${escapeHtml(url)}">
                <div class="skill-link-card-title">${escapeHtml(entry.label)}</div>
                <div class="skill-link-card-meta">${escapeHtml(entry.description)}</div>
            </button>
        `).join('');
    }

    /**
     * 打开技能市场模态框
     * @returns {void}
     */
    function openSkillMarket() {
        if (!elements.modalSkillMarket) {
            return;
        }

        // 如果数据未加载，先请求数据；否则直接渲染
        if (!state.skillMarketData) {
            refreshSkillMarket();
        } else {
            renderSkillMarket();
        }
        openModal(elements.modalSkillMarket);
    }

    /**
     * 刷新技能市场数据
     * @returns {Promise<void>}
     */
    async function refreshSkillMarket() {
        // 显示加载状态
        if (elements.skillMarketLoading) {
            elements.skillMarketLoading.classList.remove('hidden');
        }
        if (elements.skillMarketContent) {
            elements.skillMarketContent.classList.add('hidden');
        }

        // 向扩展宿主请求技能市场数据
        vscode.postMessage({ type: 'loadSkillMarket', filters: state.skillMarketFilters || {} });
    }

    /**
     * 渲染技能市场
     * @returns {void}
     */
    function renderSkillMarket() {
        if (!elements.skillMarketGrid) {
            return;
        }

        const t = window.OpenClawI18n?.t || ((key, args) => key);
        const overview = state.skillMarketData || { market: [], installed: [], hubs: [], errors: [] };
        const tab = state.skillMarketTab || 'market';
        const filters = state.skillMarketFilters || { query: '', category: 'all', tags: [], sortBy: 'popular', hubId: 'all' };
        
        // 分类标签映射
        const categoryLabelMap = {
            coding: 'skillMarket.categoryCoding',
            testing: 'skillMarket.categoryTesting',
            planning: 'skillMarket.categoryPlanning',
            analysis: 'skillMarket.categoryAnalysis',
            documentation: 'skillMarket.categoryDocumentation',
            communication: 'skillMarket.categoryCommunication',
            other: 'skillMarket.categoryOther'
        };

        // 获取当前代理和已启用技能
        const activeAgent = state.agents.find(a => a.id === state.currentAgentId);
        const enabledIds = new Set(activeAgent?.enabledSkills || []);

        // 根据当前标签页获取基础技能列表
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
                    // 为未知技能创建默认对象
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

        // 解析过滤器条件
        const normalizedQuery = String(filters.query || '').trim().toLowerCase();
        const selectedTags = Array.isArray(filters.tags) ? filters.tags : [];
        const selectedCategory = filters.category || 'all';
        const selectedHub = filters.hubId || 'all';

        /**
         * 过滤技能（完整过滤）
         * @param {Array<Object>} skills - 技能列表
         * @returns {Array<Object>} 过滤后的技能列表
         */
        const filterSkills = (skills) => {
            return skills.filter(skill => {
                // 搜索词过滤
                if (normalizedQuery) {
                    const haystack = `${skill.label || ''} ${skill.description || ''}`.toLowerCase();
                    const tagMatch = (skill.tags || []).some(tag => String(tag).toLowerCase().includes(normalizedQuery));
                    if (!haystack.includes(normalizedQuery) && !tagMatch) {
                        return false;
                    }
                }
                // Hub过滤
                if (selectedHub && selectedHub !== 'all') {
                    if ((skill.hubId || '') !== selectedHub) {
                        return false;
                    }
                }
                // 分类过滤
                if (selectedCategory && selectedCategory !== 'all' && skill.category !== selectedCategory) {
                    return false;
                }
                // 标签过滤
                if (selectedTags.length) {
                    const tagSet = new Set(skill.tags || []);
                    if (!selectedTags.some(tag => tagSet.has(tag))) {
                        return false;
                    }
                }
                return true;
            });
        };

        /**
         * 过滤分面技能（仅搜索词和Hub，用于侧边栏统计）
         * @param {Array<Object>} skills - 技能列表
         * @returns {Array<Object>} 过滤后的技能列表
         */
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

        // 应用过滤
        const facetSkills = filterFacetSkills(baseSkills.map(skill => ({ ...skill })));
        let visibleSkills = filterSkills(baseSkills);

        // 排序
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

        // 更新标签页激活状态
        document.querySelectorAll('.skill-market-tab').forEach(tabEl => {
            tabEl.classList.toggle('is-active', tabEl.getAttribute('data-tab') === tab);
        });

        // 更新副标题
        if (elements.skillMarketSubtitle) {
            const subtitleKey = tab === 'installed'
                ? 'skillMarket.subtitleInstalled'
                : tab === 'enabled'
                    ? 'skillMarket.subtitleEnabled'
                    : 'skillMarket.subtitleMarket';
            elements.skillMarketSubtitle.textContent = t(subtitleKey);
        }

        // 更新统计信息
        if (elements.skillMarketStats) {
            const total = tab === 'market' ? (overview.total || baseSkills.length) : baseSkills.length;
            const statsKey = tab === 'installed'
                ? 'skillMarket.statsInstalled'
                : tab === 'enabled'
                    ? 'skillMarket.statsEnabled'
                    : 'skillMarket.statsMarket';
            elements.skillMarketStats.textContent = t(statsKey, { showing: visibleSkills.length, total });
        }

        // 渲染Hub列表
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

        // 渲染分类列表
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

        // 渲染标签列表
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

        // 渲染状态/错误信息
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

        // 空状态处理
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

        // 格式化日期
        const formatDate = (value) => {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return date.toISOString().slice(0, 10);
        };

        // 渲染技能卡片网格
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

            // 构建徽章列表
            const badges = [];
            if (skill.sourceKind === 'built-in') badges.push({ key: 'built-in', label: t('skillMarket.badgeBuiltIn') });
            if (skill.sourceKind === 'custom') badges.push({ key: 'custom', label: t('skillMarket.badgeCustom') });
            if (skill.sourceKind === 'remote') badges.push({ key: 'remote', label: t('skillMarket.badgeRemote') });
            if (isInstalled && tab === 'market') badges.push({ key: 'installed', label: t('skillMarket.badgeInstalled') });
            if (isEnabled) badges.push({ key: 'enabled', label: t('skillMarket.badgeEnabled') });
            if (skill.updateAvailable) badges.push({ key: 'update', label: t('skillMarket.badgeUpdate') });

            // 是否显示卸载按钮
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

    /**
     * 为当前活动代理切换技能启用状态
     * @param {string} skillId - 技能ID
     * @returns {void}
     */
    function toggleSkillForActiveAgent(skillId) {
        const agent = state.agents.find(item => item.id === state.currentAgentId);
        if (!agent) {
            showError('Select an agent before changing skills.');
            return;
        }

        // 切换技能启用状态
        const current = new Set(Array.isArray(agent.enabledSkills) ? agent.enabledSkills : []);
        if (current.has(skillId)) {
            current.delete(skillId);
        } else {
            current.add(skillId);
        }

        // 更新代理状态
        const nextAgent = {
            ...agent,
            enabledSkills: Array.from(current)
        };
        upsertAgentState(nextAgent);
        renderSkillMarket();

        // 保存代理设置
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

    /**
     * 显示代理设置模态框
     * @param {Object} agent - 代理对象
     * @returns {void}
     */
    function showAgentSettings(agent) {
        // 检查是否支持代理编辑功能
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        const modal = document.getElementById('modal-agent-settings');
        if (!modal) return;
        
        // 获取表单字段元素
        const idField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        const skillsLabel = document.getElementById('settings-agent-skills-label');
        const skillLinksLabel = document.getElementById('settings-agent-skills-links-label');

        // 填充表单字段
        if (idField) idField.value = agent.id;
        if (nameField) nameField.value = agent.name;
        state.agentSettingsFormDirty = false;
        state.agentSettingsSaving = false;
        setAgentSettingsStatus('info', t('agentSettings.saveOnlyHint'));
        syncAgentModelFormState('settings', agent.model || '');
        if (promptField) promptField.value = agent.systemPrompt || '';
        
        // 设置温度滑块和显示值
        if (tempField) {
            tempField.value = agent.temperature || 0.7;
            const parent = tempField.parentElement;
            if (parent) {
                const valueDisplay = parent.querySelector('.range-value');
                if (valueDisplay) valueDisplay.textContent = tempField.value;
            }
        }
        
        if (maxTokensField) maxTokensField.value = agent.maxTokens || 4096;
        
        // 设置标签文本
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
        
        // 渲染技能选择器和技能链接
        renderAgentSkillsPicker(agent.enabledSkills || []);
        renderAgentSkillLinks();
        renderSkillMarket();
        
        openModal(modal);
    }

    /**
     * 设置代理设置状态
     * @param {string} kind - 状态类型（'success'/'error'/'info'）
     * @param {string} text - 状态文本
     * @returns {void}
     */
    function setAgentSettingsStatus(kind, text) {
        state.agentSettingsStatus = text ? { kind, text } : null;
        renderAgentSettingsStatus();
    }

    /**
     * 渲染代理设置状态提示
     * @returns {void}
     */
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

    /**
     * 标记代理设置为已修改状态
     * @returns {void}
     */
    function markAgentSettingsDirty() {
        // 只在设置模态框打开且未保存时标记
        if (!elements.modalAgentSettings?.classList.contains('active') || state.agentSettingsSaving) {
            return;
        }

        state.agentSettingsFormDirty = true;
        setAgentSettingsStatus('success', t('agentSettings.pendingSaveHint'));
    }

    /**
     * 保存代理设置
     * @returns {void}
     */
    function saveAgentSettings() {
        // 检查是否支持代理编辑功能
        if (!supportsRuntimeCapability('agentEditing')) {
            showError(resolveCapabilityUnavailableMessage('agentEditing'));
            return;
        }

        // 获取表单字段值
        const agentIdField = document.getElementById('settings-agent-id');
        const nameField = document.getElementById('settings-agent-name');
        const promptField = document.getElementById('settings-agent-prompt');
        const tempField = document.getElementById('settings-agent-temperature');
        const maxTokensField = document.getElementById('settings-agent-max-tokens');
        
        // 收集已启用的技能
        const enabledSkills = Array.from(elements.agentSkillsPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);
        
        const agentId = agentIdField ? agentIdField.value : '';
        const currentAgent = (Array.isArray(state.agents) ? state.agents : []).find(agent => agent.id === agentId) || null;
        
        // 构建设置对象
        const settings = {
            name: nameField ? nameField.value : '',
            model: resolveAgentModelRefFromForm('settings') || currentAgent?.model || '',
            systemPrompt: promptField ? promptField.value : '',
            temperature: tempField ? parseFloat(tempField.value) : 0.7,
            maxTokens: maxTokensField ? parseInt(maxTokensField.value) : 4096,
            enabledSkills
        };

        // 设置保存状态并发送请求
        state.agentSettingsSaving = true;
        setAgentSettingsStatus('success', t('agentSettings.saving'));
        vscode.postMessage({ type: 'saveAgentSettings', agentId, settings });
    }
