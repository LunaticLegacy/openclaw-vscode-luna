// OpenClaw Luna - Panel Agents
// 代理列表管理模块 - 处理代理列表渲染、文件夹管理、拖拽交互等功能
'use strict';

    /**
     * 应用代理操作按钮的可用状态
     * 根据是否有正在进行的代理变更操作来启用/禁用相关按钮
     * @returns {void}
     */
    function applyAgentActionAvailability() {
        const isBusy = Boolean(state.agentMutation?.pending);
        // 新建代理按钮始终可用
        if (elements.btnNewAgent) {
            elements.btnNewAgent.disabled = false;
        }
        // 刷新代理列表按钮在忙碌时禁用
        if (elements.btnRefreshAgents) {
            elements.btnRefreshAgents.disabled = isBusy;
        }
        // 新建文件夹按钮在忙碌时禁用
        if (elements.btnNewAgentFolder) {
            elements.btnNewAgentFolder.disabled = isBusy;
        }
        // 批量删除按钮在忙碌时禁用
        if (elements.btnBatchDeleteAgents) {
            elements.btnBatchDeleteAgents.disabled = isBusy;
        }
    }

    /**
     * 渲染代理变更操作的横幅提示
     * 显示删除中、创建中或错误状态的提示信息
     * @returns {string} 横幅的HTML字符串
     */
    function renderAgentMutationBanner() {
        const mutation = state.agentMutation;
        if (!mutation) {
            return '';
        }

        const targetName = mutation.agentName || mutation.agentId || 'agent';

        // 处理进行中的状态
        if (mutation.pending) {
            if (mutation.action === 'delete') {
                const label = t('agent.operationDeleting', { name: targetName });
                return `<div class="loading agent-mutation-banner">${escapeHtml(label)}</div>`;
            }

            return '';
        }

        // 处理错误状态
        if (mutation.success === false && mutation.error) {
            const label = mutation.action === 'delete'
                ? t('panel.failedDeleteAgent', { error: mutation.error })
                : t('newAgent.createFailed', { error: mutation.error });
            return `<div class="empty agent-mutation-banner-error">${escapeHtml(label)}</div>`;
        }

        return '';
    }

    /**
     * 规范化可见的换行符
     * 将各种换行符格式统一转换为\n，并处理转义的\n字符
     * @param {string} value - 原始字符串值
     * @returns {string} 规范化后的字符串
     */
    function normalizeVisibleNewlines(value) {
        return String(value || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\\n/g, '\n');
    }

    /**
     * 解析代理指示器状态
     * 将代理状态字符串转换为标准化的状态标识
     * @param {Object} agent - 代理对象
     * @returns {string} 状态标识（'active'/'offline'/'idle'）
     */
    function resolveAgentIndicatorStatus(agent) {
        const status = String(agent?.status || '').trim().toLowerCase();
        if (status === 'active' || status === 'offline') {
            return status;
        }

        return 'idle';
    }

    /**
     * 规范化代理文件夹数据
     * 验证并清理文件夹数据，确保字段类型正确
     * @param {Array<Object>} folderData - 原始文件夹数据数组
     * @returns {Array<Object>} 规范化后的文件夹数组
     */
    function normalizeAgentFolders(folderData) {
        return Array.isArray(folderData)
            ? folderData
                .filter(folder => folder && folder.id && folder.name)
                .map(folder => ({
                    id: String(folder.id),
                    name: String(folder.name),
                    agentIds: Array.isArray(folder.agentIds) ? folder.agentIds.map(id => String(id)) : [],
                    collapsed: Boolean(folder.collapsed)
                }))
            : [];
    }

    /**
     * 创建新的代理文件夹
     * 向扩展宿主发送创建文件夹请求
     * @returns {void}
     */
    function createAgentFolder() {
        vscode.postMessage({ type: 'promptCreateAgentFolder' });
    }

    /**
     * 重命名代理文件夹
     * @param {string} folderId - 文件夹ID
     * @returns {void}
     */
    function renameAgentFolder(folderId) {
        if (!folderId) {
            return;
        }

        vscode.postMessage({
            type: 'promptRenameAgentFolder',
            folderId
        });
    }

    /**
     * 删除代理文件夹
     * @param {string} folderId - 文件夹ID
     * @returns {void}
     */
    function deleteAgentFolder(folderId) {
        if (!folderId) {
            return;
        }

        vscode.postMessage({
            type: 'promptDeleteAgentFolder',
            folderId
        });
    }

    /**
     * 切换代理文件夹的折叠状态
     * @param {string} folderId - 文件夹ID
     * @param {boolean} collapsed - 是否折叠
     * @returns {void}
     */
    function toggleAgentFolder(folderId, collapsed) {
        vscode.postMessage({
            type: 'toggleAgentFolder',
            folderId,
            collapsed
        });
    }

    /**
     * 将代理移动到指定文件夹
     * @param {string} agentId - 代理ID
     * @param {string} folderId - 目标文件夹ID（空字符串表示移出所有文件夹）
     * @returns {void}
     */
    function moveAgentToFolder(agentId, folderId) {
        vscode.postMessage({
            type: 'moveAgentToFolder',
            agentId,
            folderId
        });
    }

    /**
     * 渲染单个代理项的HTML
     * @param {Object} agent - 代理对象
     * @param {Object} [options={}] - 渲染选项
     * @param {string} [options.folderId] - 代理所属的文件夹ID
     * @returns {string} 代理项的HTML字符串
     */
    function renderAgentItem(agent, options) {
        const currentFolderId = options?.folderId || '';
        // 检查是否支持代理编辑功能
        const canEditAgentSettings = supportsRuntimeCapability('agentEditing');
        const settingsTitle = canEditAgentSettings
            ? t('common.settings')
            : resolveCapabilityUnavailableMessage('agentEditing');

        return `
            <div
                class="agent-item ${agent.id === state.currentAgentId ? 'active' : ''}"
                data-id="${agent.id}"
                data-current-folder-id="${escapeHtml(currentFolderId)}"
                draggable="true"
            >
                <span class="agent-status status-${resolveAgentIndicatorStatus(agent)}"></span>
                <div class="agent-info">
                    <div class="agent-name">${escapeHtml(agent.name)}</div>
                    <div class="agent-model">${escapeHtml(agent.model)}</div>
                </div>
                <div class="agent-actions">
                    <button class="agent-action-btn" data-action="settings" title="${escapeHtml(settingsTitle)}" ${canEditAgentSettings ? '' : 'disabled aria-disabled="true"'}>&#9881;</button>
                    <button class="agent-action-btn" data-action="folder" title="${escapeHtml(t('common.openInExplorer'))}">&#128193;</button>
                </div>
            </div>
        `;
    }

    /**
     * 附加代理项的交互事件
     * 包括点击选择、拖拽、设置按钮等事件处理
     * @returns {void}
     */
    function attachAgentInteractions() {
        // 代理项点击和拖拽事件
        document.querySelectorAll('.agent-item').forEach(item => {
            // 点击选择代理（排除操作按钮区域）
            item.addEventListener('click', (e) => {
                if (e.target.closest('.agent-actions')) {
                    return;
                }

                const agentId = item.dataset.id;
                selectAgent(agentId);
            });

            // 拖拽开始
            item.addEventListener('dragstart', (e) => {
                const agentId = item.dataset.id;
                if (!agentId || !e.dataTransfer) {
                    return;
                }

                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/openclaw-agent-id', agentId);
                item.classList.add('dragging');
            });

            // 拖拽结束，清理样式
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                document.querySelectorAll('.drag-target-active').forEach(target => {
                    target.classList.remove('drag-target-active');
                });
            });
        });

        // 代理操作按钮事件
        document.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 如果按钮被禁用，显示功能不可用提示
                if (btn.disabled) {
                    showError(btn.title || resolveCapabilityUnavailableMessage('agentEditing'));
                    return;
                }

                const agentId = btn.closest('.agent-item')?.dataset.id;
                const action = btn.dataset.action;
                if (!agentId) {
                    return;
                }

                // 根据操作类型执行相应功能
                if (action === 'settings') {
                    vscode.postMessage({ type: 'openAgentSettings', agentId });
                } else if (action === 'folder') {
                    vscode.postMessage({ type: 'openAgentFolder', agentId });
                }
            });
        });

        // 文件夹折叠/展开切换
        document.querySelectorAll('[data-agent-folder-toggle]').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderId = toggle.getAttribute('data-agent-folder-toggle');
                const folder = state.agentFolders.find(item => item.id === folderId);
                if (folder) {
                    toggleAgentFolder(folderId, !folder.collapsed);
                }
            });
        });

        // 文件夹操作按钮（重命名、删除）
        document.querySelectorAll('[data-agent-folder-action]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderId = button.getAttribute('data-agent-folder-id');
                const action = button.getAttribute('data-agent-folder-action');
                if (!folderId || !action) {
                    return;
                }

                if (action === 'rename') {
                    renameAgentFolder(folderId);
                } else if (action === 'delete') {
                    deleteAgentFolder(folderId);
                }
            });
        });

        // 文件夹拖放区域
        document.querySelectorAll('[data-agent-folder-dropzone]').forEach(dropzone => {
            const folderId = dropzone.getAttribute('data-agent-folder-dropzone');
            
            // 拖拽经过时的视觉反馈
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('drag-target-active');
            });
            
            // 拖拽离开时的清理
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('drag-target-active');
            });
            
            // 放置代理到文件夹
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-target-active');
                const agentId = e.dataTransfer?.getData('text/openclaw-agent-id');
                if (!agentId) {
                    return;
                }

                moveAgentToFolder(agentId, folderId || null);
            });
        });
    }

    /**
     * 渲染代理列表
     * @param {Array<Object>} agentData - 代理数据数组
     * @param {Array<Object>} [folderData] - 文件夹数据数组（可选）
     * @returns {void}
     */
    function renderAgents(agentData, folderData) {
        // 更新状态
        state.agents = agentData;
        state.agentFolders = normalizeAgentFolders(folderData !== undefined ? folderData : state.agentFolders);
        
        // 渲染变更横幅和更新按钮状态
        const mutationBanner = renderAgentMutationBanner();
        applyAgentActionAvailability();

        // 空状态处理
        if (state.agents.length === 0) {
            elements.agentList.innerHTML = `${mutationBanner}<div class="empty">No agents yet. Create one!</div>`;
            if (state.viewMode === 'channel') {
                renderChannelWorkspace();
            }
            renderConsoleOverview();
            return;
        }

        // 构建代理映射表以便快速查找
        const agentMap = new Map(state.agents.map(agent => [agent.id, agent]));
        const assignedAgentIds = new Set();
        
        // 渲染文件夹及其中的代理
        const foldersMarkup = state.agentFolders.map(folder => {
            // 获取文件夹中的代理列表
            const folderAgents = folder.agentIds
                .map(agentId => agentMap.get(agentId))
                .filter(Boolean);
            folderAgents.forEach(agent => assignedAgentIds.add(agent.id));

            return `
                <div class="agent-folder-card" data-agent-folder-dropzone="${folder.id}">
                    <div class="agent-folder-header">
                        <button class="agent-folder-toggle" type="button" data-agent-folder-toggle="${folder.id}">
                            <span class="agent-folder-chevron">${folder.collapsed ? '&#9654;' : '&#9660;'}</span>
                            <span class="agent-folder-name">${escapeHtml(folder.name)}</span>
                            <span class="agent-folder-count">${folderAgents.length}</span>
                        </button>
                        <div class="agent-folder-actions">
                            <button class="agent-action-btn" type="button" data-agent-folder-action="rename" data-agent-folder-id="${folder.id}" title="${escapeHtml(t('common.edit'))}">📝</button>
                            <button class="agent-action-btn" type="button" data-agent-folder-action="delete" data-agent-folder-id="${folder.id}" title="${escapeHtml(t('common.delete'))}">🗃️</button>
                        </div>
                    </div>
                    <div class="agent-folder-body ${folder.collapsed ? 'hidden' : ''}">
                        ${folderAgents.length
                            ? folderAgents.map(agent => renderAgentItem(agent, { folderId: folder.id })).join('')
                            : `<div class="agent-folder-empty">${escapeHtml(t('sidebar.folderEmpty'))}</div>`}
                    </div>
                </div>
            `;
        }).join('');

        // 渲染未分组的代理
        const ungroupedAgents = state.agents.filter(agent => !assignedAgentIds.has(agent.id));
        const ungroupedMarkup = `
            <div class="agent-root-dropzone" data-agent-folder-dropzone="">
                <div class="agent-root-title">${escapeHtml(t('sidebar.ungrouped'))}</div>
                <div class="agent-root-body">
                    ${ungroupedAgents.length
                        ? ungroupedAgents.map(agent => renderAgentItem(agent)).join('')
                        : `<div class="agent-folder-empty">${escapeHtml(t('sidebar.ungroupedHint'))}</div>`}
                </div>
            </div>
        `;

        // 更新DOM并附加交互事件
        elements.agentList.innerHTML = `${mutationBanner}${ungroupedMarkup}${foldersMarkup}`;
        attachAgentInteractions();

        // 根据当前视图模式更新其他面板
        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        if (state.viewMode === 'clusters') {
            renderClusterWorkspace();
        }
        if (state.viewMode === 'channel') {
            renderChannelWorkspace();
        }
        if (elements.modalSkillMarket?.classList.contains('active')) {
            renderSkillMarket();
        }
        updateTaskFormFields();
        renderConsoleOverview();
    }

    /**
     * 更新或插入代理状态
     * 用于增量更新单个代理的信息
     * @param {Object} agent - 代理对象
     * @returns {void}
     */
    function upsertAgentState(agent) {
        if (!agent || !agent.id) {
            return;
        }

        // 查找代理在列表中的位置
        const index = state.agents.findIndex(item => item.id === agent.id);
        if (index >= 0) {
            // 更新现有代理
            state.agents[index] = {
                ...state.agents[index],
                ...agent
            };
        } else {
            // 添加新代理
            state.agents.push(agent);
        }

        // 重新渲染代理列表
        renderAgents([...state.agents], state.agentFolders);
    }
