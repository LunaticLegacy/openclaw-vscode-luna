// OpenClaw Luna - Panel Agents
'use strict';

    function applyAgentActionAvailability() {
        const isBusy = Boolean(state.agentMutation?.pending);
        if (elements.btnNewAgent) {
            elements.btnNewAgent.disabled = isBusy;
        }
        if (elements.btnRefreshAgents) {
            elements.btnRefreshAgents.disabled = isBusy;
        }
        if (elements.btnNewAgentFolder) {
            elements.btnNewAgentFolder.disabled = isBusy;
        }
        if (elements.btnBatchDeleteAgents) {
            elements.btnBatchDeleteAgents.disabled = isBusy;
        }
    }

    function renderAgentMutationBanner() {
        const mutation = state.agentMutation;
        if (!mutation) {
            return '';
        }

        const targetName = mutation.agentName || mutation.agentId || 'agent';

        if (mutation.pending) {
            if (mutation.action === 'delete') {
                const label = t('agent.operationDeleting', { name: targetName });
                return `<div class="loading agent-mutation-banner">${escapeHtml(label)}</div>`;
            }

            return '';
        }

        if (mutation.success === false && mutation.error) {
            const label = mutation.action === 'delete'
                ? t('panel.failedDeleteAgent', { error: mutation.error })
                : t('newAgent.createFailed', { error: mutation.error });
            return `<div class="empty agent-mutation-banner-error">${escapeHtml(label)}</div>`;
        }

        return '';
    }

    function normalizeVisibleNewlines(value) {
        return String(value || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\\n/g, '\n');
    }

    function resolveAgentIndicatorStatus(agent) {
        const status = String(agent?.status || '').trim().toLowerCase();
        if (status === 'active' || status === 'offline') {
            return status;
        }

        return 'idle';
    }

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

    function createAgentFolder() {
        vscode.postMessage({ type: 'promptCreateAgentFolder' });
    }

    function renameAgentFolder(folderId) {
        if (!folderId) {
            return;
        }

        vscode.postMessage({
            type: 'promptRenameAgentFolder',
            folderId
        });
    }

    function deleteAgentFolder(folderId) {
        if (!folderId) {
            return;
        }

        vscode.postMessage({
            type: 'promptDeleteAgentFolder',
            folderId
        });
    }

    function toggleAgentFolder(folderId, collapsed) {
        vscode.postMessage({
            type: 'toggleAgentFolder',
            folderId,
            collapsed
        });
    }

    function moveAgentToFolder(agentId, folderId) {
        vscode.postMessage({
            type: 'moveAgentToFolder',
            agentId,
            folderId
        });
    }

    function renderAgentItem(agent, options) {
        const currentFolderId = options?.folderId || '';
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

    function attachAgentInteractions() {
        document.querySelectorAll('.agent-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.agent-actions')) {
                    return;
                }

                const agentId = item.dataset.id;
                selectAgent(agentId);
            });

            item.addEventListener('dragstart', (e) => {
                const agentId = item.dataset.id;
                if (!agentId || !e.dataTransfer) {
                    return;
                }

                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/openclaw-agent-id', agentId);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                document.querySelectorAll('.drag-target-active').forEach(target => {
                    target.classList.remove('drag-target-active');
                });
            });
        });

        document.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.disabled) {
                    showError(btn.title || resolveCapabilityUnavailableMessage('agentEditing'));
                    return;
                }

                const agentId = btn.closest('.agent-item')?.dataset.id;
                const action = btn.dataset.action;
                if (!agentId) {
                    return;
                }

                if (action === 'settings') {
                    vscode.postMessage({ type: 'openAgentSettings', agentId });
                } else if (action === 'folder') {
                    vscode.postMessage({ type: 'openAgentFolder', agentId });
                }
            });
        });

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

        document.querySelectorAll('[data-agent-folder-dropzone]').forEach(dropzone => {
            const folderId = dropzone.getAttribute('data-agent-folder-dropzone');
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('drag-target-active');
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('drag-target-active');
            });
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

    function renderAgents(agentData, folderData) {
        state.agents = agentData;
        state.agentFolders = normalizeAgentFolders(folderData !== undefined ? folderData : state.agentFolders);
        const mutationBanner = renderAgentMutationBanner();
        applyAgentActionAvailability();

        if (state.agents.length === 0) {
            elements.agentList.innerHTML = `${mutationBanner}<div class="empty">No agents yet. Create one!</div>`;
            if (state.viewMode === 'channel') {
                renderChannelWorkspace();
            }
            renderConsoleOverview();
            return;
        }

        const agentMap = new Map(state.agents.map(agent => [agent.id, agent]));
        const assignedAgentIds = new Set();
        const foldersMarkup = state.agentFolders.map(folder => {
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

        elements.agentList.innerHTML = `${mutationBanner}${ungroupedMarkup}${foldersMarkup}`;
        attachAgentInteractions();

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

    function upsertAgentState(agent) {
        if (!agent || !agent.id) {
            return;
        }

        const index = state.agents.findIndex(item => item.id === agent.id);
        if (index >= 0) {
            state.agents[index] = {
                ...state.agents[index],
                ...agent
            };
        } else {
            state.agents.push(agent);
        }

        renderAgents([...state.agents], state.agentFolders);
    }
