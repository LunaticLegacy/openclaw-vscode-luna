// OpenClaw Luna - Panel Clusters
// 集群管理面板 - 负责集群的创建、编辑、配置管理以及工作模式设置
'use strict';

    /**
     * 根据ID获取集群工作模式预设
     * 如果找不到指定预设，返回默认预设或第一个可用预设
     * @param {string} presetId - 预设ID
     * @returns {Object|null} 预设对象
     */
    function getClusterWorkModePresetById(presetId) {
        const normalizedPresetId = String(presetId || '').trim();
        const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
        return presets.find(preset => preset.id === normalizedPresetId)
            || presets.find(preset => preset.id === 'implementation-squad')
            || presets[0]
            || null;
    }

    /**
     * 获取默认集群工作模式配置
     * 使用implementation-squad预设作为基础，创建默认配置对象
     * @returns {Object} 默认配置对象
     */
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

    /**
     * 获取集群工作模式预设的成员蓝图列表
     * 过滤并规范化预设中的成员蓝图定义
     * @param {Object} preset - 预设对象
     * @returns {Array} 规范化后的蓝图数组
     */
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

    /**
     * 获取集群工作模式配置
     * 合并预设默认值和集群中保存的配置
     * @param {Object} cluster - 集群对象
     * @returns {Object} 完整配置对象
     */
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
            // 验证并选择有效的协作风格
            collaborationStyle: ['debate', 'round-robin', 'review-board', 'leader-draft'].includes(config.collaborationStyle)
                ? config.collaborationStyle
                : base.collaborationStyle,
            // 验证并选择有效的交付风格
            deliveryStyle: ['fast', 'balanced', 'deep'].includes(config.deliveryStyle)
                ? config.deliveryStyle
                : base.deliveryStyle,
            // 验证并选择有效的批评级别
            critiqueLevel: ['minimal', 'standard', 'aggressive'].includes(config.critiqueLevel)
                ? config.critiqueLevel
                : base.critiqueLevel,
            rounds: normalizeClusterRoundsInput(config.rounds, base.rounds || 1),
            // 仅在设置了停止条件时启用条件运行
            runUntilConditionMet: Boolean(config.runUntilConditionMet && String(config.stopCondition || '').trim()),
            stopCondition: typeof config.stopCondition === 'string' ? config.stopCondition.trim() : '',
            briefing: typeof config.briefing === 'string' && config.briefing.trim()
                ? config.briefing.trim()
                : (base.briefing || ''),
            coordinatorAgentId: typeof config.coordinatorAgentId === 'string' ? config.coordinatorAgentId.trim() : '',
            memberProfiles: normalizeClusterMemberProfiles(config.memberProfiles)
        };
    }

    /**
     * 规范化集群成员配置文件
     * 过滤无效数据并标准化字段格式
     * @param {*} value - 原始配置值
     * @returns {Object} 规范化后的配置对象
     */
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
        const presetIdentityId = String(profile.presetIdentityId || '').trim();
        const activation = normalizeClusterMemberActivation(profile.activation);
        // 跳过完全空的配置
        if (!normalizedAgentId || (!identity && !stance && !parentAgentId && !presetIdentityId && !activation)) {
            return;
        }

        // 只包含非空字段
        normalized[normalizedAgentId] = {
            ...(identity ? { identity } : {}),
            ...(stance ? { stance } : {}),
            ...(parentAgentId ? { parentAgentId } : {}),
            ...(presetIdentityId ? { presetIdentityId } : {}),
            ...(activation ? { activation } : {})
        };
        });

        return normalized;
    }

    /**
     * 规范化集群成员激活配置
     * 标准化swarm模式和关键词配置
     * @param {*} value - 原始激活配置
     * @returns {Object|undefined} 规范化后的配置或undefined
     */
    function normalizeClusterMemberActivation(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        // 过滤并去重有效的swarm模式
        const swarmModes = Array.isArray(value.swarmModes)
            ? Array.from(new Set(value.swarmModes.filter(mode => mode === 'broadcast' || mode === 'collaborate')))
            : undefined;
        // 过滤并去重关键词
        const keywords = Array.isArray(value.keywords)
            ? Array.from(new Set(
                value.keywords
                    .map(keyword => String(keyword || '').trim())
                    .filter(Boolean)
            ))
            : undefined;

        // 如果都没有有效值，返回空swarmModes或undefined
        if ((!swarmModes || swarmModes.length === 0) && (!keywords || keywords.length === 0)) {
            return swarmModes ? { swarmModes: [] } : undefined;
        }

        return {
            ...(swarmModes ? { swarmModes } : {}),
            ...(keywords && keywords.length > 0 ? { keywords } : {})
        };
    }

    /**
     * 解析集群成员激活配置
     * 提供默认值填充
     * @param {Object} profile - 成员配置文件
     * @returns {Object} 解析后的激活配置
     */
    function resolveClusterMemberActivation(profile) {
        const activation = normalizeClusterMemberActivation(profile?.activation);
        return {
            swarmModes: activation?.swarmModes ? [...activation.swarmModes] : ['broadcast', 'collaborate'],
            keywords: activation?.keywords ? [...activation.keywords] : []
        };
    }

    /**
     * 解析集群成员父Agent ID
     * 验证父Agent是否在已选列表中且不会形成自引用
     * @param {Object} profile - 成员配置文件
     * @param {string} agentId - 当前Agent ID
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     * @returns {string} 父Agent ID或空字符串
     */
    function resolveClusterMemberParentAgentId(profile, agentId, selectedAgentIds) {
        const normalizedParentId = String(profile?.parentAgentId || '').trim();
        if (!normalizedParentId || normalizedParentId === agentId) {
            return '';
        }

        return Array.isArray(selectedAgentIds) && selectedAgentIds.includes(normalizedParentId)
            ? normalizedParentId
            : '';
    }

    /**
     * 获取身份预设列表
     * @returns {Array} 身份预设数组
     */
    function getIdentityPresets() {
        return Array.isArray(state.identityPresets) ? state.identityPresets : [];
    }

    /**
     * 根据ID解析身份预设
     * @param {string} presetId - 预设ID
     * @returns {Object|null} 预设对象
     */
    function resolveIdentityPresetById(presetId) {
        const normalizedId = String(presetId || '').trim();
        if (!normalizedId) {
            return null;
        }
        return getIdentityPresets().find(preset => String(preset?.id || '').trim() === normalizedId) || null;
    }

    /**
     * 解析身份预设显示标签
     * 优先使用翻译键，其次使用名称，最后使用ID
     * @param {Object} preset - 预设对象
     * @returns {string} 显示标签
     */
    function resolveIdentityPresetLabel(preset) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!preset || typeof preset !== 'object') {
            return '';
        }
        const key = String(preset.nameKey || '').trim();
        const name = String(preset.name || '').trim();
        return key ? (t(key) || key) : (name || String(preset.id || '').trim());
    }

    /**
     * 应用集群成员身份预设
     * 将预设中的身份、立场和关键词应用到编辑器表单
     * @param {string} agentId - Agent ID
     * @param {string} presetId - 预设ID
     */
    function applyClusterMemberIdentityPreset(agentId, presetId) {
        if (!elements.clusterEditorMemberProfiles) {
            return;
        }
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return;
        }
        const preset = resolveIdentityPresetById(presetId);
        if (!preset) {
            return;
        }

        // 查找对应的输入元素
        const identityInput = elements.clusterEditorMemberProfiles.querySelector(
            `[data-cluster-member-identity="${normalizedAgentId}"]`
        );
        const stanceInput = elements.clusterEditorMemberProfiles.querySelector(
            `[data-cluster-member-stance="${normalizedAgentId}"]`
        );
        const keywordsInput = elements.clusterEditorMemberProfiles.querySelector(
            `[data-cluster-member-keywords="${normalizedAgentId}"]`
        );

        // 应用预设值
        if (identityInput && typeof preset.identity === 'string') {
            identityInput.value = preset.identity;
        }
        if (stanceInput && typeof preset.stance === 'string') {
            stanceInput.value = preset.stance;
        }
        if (keywordsInput && Array.isArray(preset.wakeKeywords) && preset.wakeKeywords.length > 0) {
            keywordsInput.value = preset.wakeKeywords.join(', ');
        }
    }

    /**
     * 构建基于预设的成员配置文件
     * 根据预设蓝图为每个已选Agent生成配置文件
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     * @param {Object} preset - 预设对象
     * @param {Object} options - 选项
     * @param {Object} options.existingProfiles - 现有配置文件
     * @param {boolean} options.preserveExisting - 是否保留现有配置
     * @returns {Object} 成员配置文件对象
     */
    function buildClusterPresetMemberProfiles(selectedAgentIds, preset, options = {}) {
        const normalizedSelectedAgentIds = Array.isArray(selectedAgentIds) ? selectedAgentIds.map(agentId => String(agentId || '').trim()).filter(Boolean) : [];
        const existingProfiles = normalizeClusterMemberProfiles(options.existingProfiles);
        const blueprints = getClusterWorkModePresetMemberBlueprints(preset);
        const slotAgentIdByBlueprintId = new Map();

        // 建立蓝图ID到Agent ID的映射（按位置分配）
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
                // 没有蓝图时保留现有配置（如果允许）
                if (existingProfile && options.preserveExisting !== false) {
                    profiles[agentId] = existingProfile;
                }
                return;
            }

            // 根据蓝图生成配置
            const generatedProfile = {
                ...(blueprint.identity ? { identity: blueprint.identity } : {}),
                ...(blueprint.stance ? { stance: blueprint.stance } : {}),
                ...(blueprint.parentId && slotAgentIdByBlueprintId.get(blueprint.parentId)
                    ? { parentAgentId: slotAgentIdByBlueprintId.get(blueprint.parentId) }
                    : {}),
                ...(blueprint.activation ? { activation: blueprint.activation } : {})
            };

            // 选择保留现有配置或应用生成的配置
            profiles[agentId] = options.preserveExisting !== false && existingProfile
                ? existingProfile
                : generatedProfile;
        });

        return normalizeClusterMemberProfiles(profiles);
    }

    /**
     * 解析集群预设协调者Agent ID
     * 根据预设蓝图确定哪个Agent应作为协调者
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     * @param {Object} preset - 预设对象
     * @param {string} fallbackCoordinatorAgentId - 回退协调者ID
     * @param {Object} options - 选项
     * @param {boolean} options.preserveExisting - 是否保留现有设置
     * @returns {string} 协调者Agent ID
     */
    function resolveClusterPresetCoordinatorAgentId(selectedAgentIds, preset, fallbackCoordinatorAgentId, options = {}) {
        const normalizedSelectedAgentIds = Array.isArray(selectedAgentIds) ? selectedAgentIds.map(agentId => String(agentId || '').trim()).filter(Boolean) : [];
        const normalizedFallbackId = String(fallbackCoordinatorAgentId || '').trim();
        // 优先保留现有设置
        if (options.preserveExisting !== false && normalizedFallbackId && normalizedSelectedAgentIds.includes(normalizedFallbackId)) {
            return normalizedFallbackId;
        }

        // 从预设蓝图中查找标记为协调者的位置
        const blueprints = getClusterWorkModePresetMemberBlueprints(preset);
        const coordinatorIndex = blueprints.findIndex(blueprint => blueprint.isCoordinator);
        if (coordinatorIndex >= 0 && normalizedSelectedAgentIds[coordinatorIndex]) {
            return normalizedSelectedAgentIds[coordinatorIndex];
        }

        // 默认返回第一个Agent
        return normalizedSelectedAgentIds[0] || '';
    }

    /**
     * 规范化集群轮次输入
     * 确保轮次数在有效范围内（1到MAX_CLUSTER_ROUNDS）
     * @param {*} value - 输入值
     * @param {number} fallback - 回退值
     * @returns {number} 规范化后的轮次数
     */
    function normalizeClusterRoundsInput(value, fallback = 1) {
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(Number(fallback) || 1)));
        }

        return Math.max(1, Math.min(MAX_CLUSTER_ROUNDS, Math.round(parsedValue)));
    }

    /**
     * 同步集群轮次模式状态
     * 根据"无限轮次"复选框的状态更新相关表单元素
     */
    function syncClusterRoundModeState() {
        const isUnlimited = Boolean(elements.clusterEditorRoundsUnlimited?.checked);
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.disabled = isUnlimited;
        }
        if (elements.clusterEditorStopConditionGroup) {
            elements.clusterEditorStopConditionGroup.classList.toggle('hidden', !isUnlimited);
        }
    }

    /**
     * 获取集群轮次摘要标签
     * @param {number} roundsValue - 轮次数值
     * @param {boolean} runUntilConditionMet - 是否运行到条件满足
     * @param {string} stopCondition - 停止条件
     * @returns {string} 摘要标签
     */
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

    /**
     * 填充集群编辑器选项
     * 加载预设、风格、交付方式和批评级别等下拉选项
     */
    function populateClusterEditorOptions() {
        // 加载预设选项
        if (elements.clusterEditorPreset) {
            const presets = Array.isArray(state.clusterWorkModePresets) ? state.clusterWorkModePresets : [];
            elements.clusterEditorPreset.innerHTML = presets.map(preset => `
                <option value="${escapeHtml(preset.id)}">${escapeHtml(t(`clusters.preset.${preset.id}.label`) || preset.id)}</option>
            `).join('');
        }

        // 加载协作风格选项
        if (elements.clusterEditorStyle) {
            elements.clusterEditorStyle.innerHTML = [
                ['debate', t('clusters.style.debate')],
                ['round-robin', t('clusters.style.roundRobin')],
                ['review-board', t('clusters.style.reviewBoard')],
                ['leader-draft', t('clusters.style.leaderDraft')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        // 加载交付风格选项
        if (elements.clusterEditorDelivery) {
            elements.clusterEditorDelivery.innerHTML = [
                ['fast', t('clusters.delivery.fast')],
                ['balanced', t('clusters.delivery.balanced')],
                ['deep', t('clusters.delivery.deep')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        // 加载批评级别选项
        if (elements.clusterEditorCritique) {
            elements.clusterEditorCritique.innerHTML = [
                ['minimal', t('clusters.critique.minimal')],
                ['standard', t('clusters.critique.standard')],
                ['aggressive', t('clusters.critique.aggressive')]
            ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        }

        // 设置轮次输入范围
        if (elements.clusterEditorRounds) {
            elements.clusterEditorRounds.min = '1';
            elements.clusterEditorRounds.step = '1';
            elements.clusterEditorRounds.value = String(normalizeClusterRoundsInput(elements.clusterEditorRounds.value || 2, 2));
        }
        syncClusterRoundModeState();
    }

    /**
     * 渲染集群Agent选择器
     * 显示所有可用Agent的复选框列表
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     */
    function renderClusterAgentPicker(selectedAgentIds) {
        if (!elements.clusterEditorAgentPicker) {
            return;
        }

        // 没有Agent时显示提示
        if (!Array.isArray(state.agents) || state.agents.length === 0) {
            elements.clusterEditorAgentPicker.innerHTML = `<div class="cluster-agent-picker-empty">${escapeHtml(t('clusters.createAgentFirst'))}</div>`;
            return;
        }

        const selected = new Set(Array.isArray(selectedAgentIds) ? selectedAgentIds : []);
        elements.clusterEditorAgentPicker.innerHTML = state.agents.map(agent => {
            const isSelected = selected.has(agent.id);
            return `
                <label class="cluster-agent-option${isSelected ? ' is-selected' : ''}" data-agent-id="${escapeHtml(agent.id)}">
                    <input type="checkbox" value="${escapeHtml(agent.id)}"${isSelected ? ' checked' : ''}>
                    <div class="cluster-agent-option-body">
                        <div class="cluster-agent-option-title">${escapeHtml(agent.name)}</div>
                        <div class="cluster-agent-option-meta">${escapeHtml(agent.model || agent.id)}</div>
                    </div>
                </label>
            `;
        }).join('');

        syncClusterAgentPickerRowState();
    }

    /**
     * 同步集群Agent选择器行状态
     * 根据复选框状态更新行的选中样式
     */
    function syncClusterAgentPickerRowState() {
        if (!elements.clusterEditorAgentPicker) {
            return;
        }

        const rows = Array.from(elements.clusterEditorAgentPicker.querySelectorAll('.cluster-agent-option'));
        rows.forEach(row => {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (!(checkbox instanceof HTMLInputElement)) {
                row.classList.remove('is-selected');
                return;
            }
            row.classList.toggle('is-selected', checkbox.checked);
        });
    }

    /**
     * 获取编辑器中选中的Agent ID列表
     * @returns {Array} Agent ID数组
     */
    function getSelectedClusterEditorAgentIds() {
        return Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => String(input.value || '').trim())
            .filter(Boolean);
    }

    /**
     * 渲染集群协调者选项
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     * @param {string} coordinatorAgentId - 当前协调者Agent ID
     */
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

    /**
     * 渲染集群成员配置文件编辑器
     * 为每个已选Agent显示详细的配置表单
     * @param {Array} selectedAgentIds - 已选Agent ID列表
     * @param {Object} memberProfiles - 成员配置文件对象
     */
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
            const presetIdentityId = String(profile.presetIdentityId || '').trim();
            const identityPresets = getIdentityPresets();
            // 检查预设是否存在
            const hasPresetIdentity = presetIdentityId
                ? identityPresets.some(preset => String(preset?.id || '').trim() === presetIdentityId)
                : false;
            // 预设不存在时显示原始值
            const missingPresetOption = presetIdentityId && !hasPresetIdentity
                ? `<option value="${escapeHtml(presetIdentityId)}" selected>${escapeHtml(presetIdentityId)}</option>`
                : '';
            // 构建父Agent选项（排除自身）
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
                        <label for="cluster-member-preset-identity-${escapeHtml(agentId)}">${escapeHtml(t('clusters.form.memberPresetIdentity'))}</label>
                        <select
                            id="cluster-member-preset-identity-${escapeHtml(agentId)}"
                            data-cluster-member-preset-identity="${escapeHtml(agentId)}"
                        >
                            <option value="">${escapeHtml(t('common.none'))}</option>
                            ${missingPresetOption}
                            ${identityPresets.map(preset => `
                                <option value="${escapeHtml(preset.id)}"${preset.id === presetIdentityId ? ' selected' : ''}>
                                    ${escapeHtml(resolveIdentityPresetLabel(preset))}
                                </option>
                            `).join('')}
                        </select>
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

    /**
     * 从编辑器读取集群成员配置文件
     * 收集表单中所有Agent的配置信息
     * @returns {Object} 成员配置文件对象
     */
    function readClusterMemberProfilesFromEditor() {
        const profiles = {};
        const selectedAgentIds = getSelectedClusterEditorAgentIds();

        selectedAgentIds.forEach(agentId => {
            const identity = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-identity="${agentId}"]`)?.value || '').trim();
            const stance = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-stance="${agentId}"]`)?.value || '').trim();
            const parentAgentId = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-parent="${agentId}"]`)?.value || '').trim();
            const presetIdentityId = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-preset-identity="${agentId}"]`)?.value || '').trim();
            // 收集选中的激活模式
            const selectedModes = Array.from(elements.clusterEditorMemberProfiles?.querySelectorAll(`[data-cluster-member-mode="${agentId}"]:checked`) || [])
                .map(input => String(input.value || '').trim())
                .filter(mode => mode === 'broadcast' || mode === 'collaborate');
            // 解析关键词
            const keywords = String(elements.clusterEditorMemberProfiles?.querySelector(`[data-cluster-member-keywords="${agentId}"]`)?.value || '')
                .split(',')
                .map(keyword => keyword.trim())
                .filter(Boolean);
            const activation = normalizeClusterMemberActivation({
                swarmModes: selectedModes,
                keywords
            });

            // 跳过完全空的配置
            if (!identity && !stance && !parentAgentId && !presetIdentityId && !activation) {
                return;
            }

            profiles[agentId] = {
                ...(identity ? { identity } : {}),
                ...(stance ? { stance } : {}),
                ...(parentAgentId ? { parentAgentId } : {}),
                ...(presetIdentityId ? { presetIdentityId } : {}),
                ...(activation ? { activation } : {})
            };
        });

        return profiles;
    }

    /**
     * 同步集群成员自定义状态
     * 根据当前选择更新协调者选项和成员配置
     * @param {Object} options - 选项
     * @param {Object} options.memberProfiles - 成员配置文件
     * @param {boolean} options.applyPresetProfiles - 是否应用预设配置
     * @param {boolean} options.preserveExistingProfiles - 是否保留现有配置
     * @param {string} options.coordinatorAgentId - 协调者Agent ID
     * @param {boolean} options.preserveExistingCoordinator - 是否保留现有协调者
     */
    function syncClusterMemberCustomizationState(options = {}) {
        const selectedAgentIds = getSelectedClusterEditorAgentIds();
        const preset = getClusterWorkModePresetById(elements.clusterEditorPreset?.value);
        const sourceProfiles = options.memberProfiles || readClusterMemberProfilesFromEditor();
        // 应用预设配置或保留现有配置
        const memberProfiles = options.applyPresetProfiles !== false
            ? buildClusterPresetMemberProfiles(selectedAgentIds, preset, {
                existingProfiles: sourceProfiles,
                preserveExisting: options.preserveExistingProfiles !== false
            })
            : sourceProfiles;
        // 解析协调者
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

    /**
     * 渲染集群预设摘要
     * 显示当前选择的预设和各配置项的摘要信息
     */
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
        // 构建蓝图信息HTML
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

    /**
     * 应用集群预设
     * 将预设的配置值应用到编辑器表单
     * @param {string} presetId - 预设ID
     * @param {Object} options - 选项
     * @param {Array} options.selectedAgentIds - 已选Agent ID列表
     * @param {Object} options.memberProfiles - 成员配置文件
     * @param {string} options.coordinatorAgentId - 协调者Agent ID
     * @param {boolean} options.preserveExistingProfiles - 是否保留现有配置
     * @param {boolean} options.preserveExistingCoordinator - 是否保留现有协调者
     */
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

        // 应用预设值到表单
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

    /**
     * 打开集群编辑器
     * 根据集群ID加载现有配置或准备新建集群
     * @param {string} clusterId - 集群ID（为空则创建新集群）
     */
    function openClusterEditor(clusterId) {
        applyView('clusters');
        populateClusterEditorOptions();

        const cluster = clusterId
            ? state.clusters.find(item => item.id === clusterId) || null
            : null;
        const config = getClusterWorkModeConfig(cluster);
        // 新建集群时默认选择前3个Agent
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

        // 应用集群的自定义配置值
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

    /**
     * 保存集群编辑器内容
     * 验证表单数据并发送保存消息到主进程
     */
    function saveClusterEditor() {
        const clusterId = String(elements.clusterEditorId?.value || '').trim();
        const name = String(elements.clusterEditorName?.value || '').trim();
        const selectedAgentIds = Array.from(elements.clusterEditorAgentPicker?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map(input => input.value)
            .filter(Boolean);
        const createAgents = readClusterBatchAgentDrafts();

        // 表单验证
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

    /**
     * 渲染集群工作模式摘要
     * 在工作区顶部显示当前集群的配置摘要芯片
     * @param {Object} cluster - 集群对象
     */
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

    /**
     * 解析集群协调者信息
     * 返回协调者Agent ID和是否自动选择
     * @param {Object} cluster - 集群对象
     * @returns {Object} 协调者信息对象
     */
    function resolveClusterCoordinatorInfo(cluster) {
        const config = getClusterWorkModeConfig(cluster);
        const configuredAgentId = String(config.coordinatorAgentId || '').trim();
        // 优先使用配置的协调者，如果有效
        if (configuredAgentId && cluster?.agentIds?.includes(configuredAgentId)) {
            return {
                agentId: configuredAgentId,
                isAuto: false
            };
        }

        // 默认使用第一个Agent作为协调者
        return {
            agentId: Array.isArray(cluster?.agentIds) ? (cluster.agentIds[0] || '') : '',
            isAuto: true
        };
    }

    /**
     * 合并集群状态
     * 将现有集群状态与新集群数据合并，保留本地状态和配置
     * @param {Object} existingCluster - 现有集群对象
     * @param {Object} nextCluster - 新集群数据
     * @returns {Object} 合并后的集群对象
     */
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

    /**
     * 获取集群风格标签
     * @param {string} value - 风格值
     * @returns {string} 本地化标签
     */
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

    /**
     * 获取集群交付风格标签
     * @param {string} value - 交付风格值
     * @returns {string} 本地化标签
     */
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

    /**
     * 获取集群批评级别标签
     * @param {string} value - 批评级别值
     * @returns {string} 本地化标签
     */
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

    /**
     * 更新或插入集群状态
     * 更新服务器集群列表和本地集群列表中的集群数据
     * @param {Object} cluster - 集群对象
     * @param {Object} options - 选项
     * @param {boolean} options.select - 是否选中新集群
     */
    function upsertClusterState(cluster, options = {}) {
        if (!cluster || !cluster.id) {
            return;
        }

        // 更新服务器集群列表
        const serverIndex = Array.isArray(state.serverClusters)
            ? state.serverClusters.findIndex(item => item.id === cluster.id)
            : -1;
        if (serverIndex >= 0) {
            state.serverClusters[serverIndex] = mergeClusterState(state.serverClusters[serverIndex], cluster);
        } else {
            state.serverClusters = [...(state.serverClusters || []), cluster];
        }

        // 更新本地集群列表
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
