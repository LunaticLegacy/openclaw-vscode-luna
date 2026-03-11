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
    }

    function renderAgentMutationBanner() {
        const mutation = state.agentMutation;
        if (!mutation) {
            return '';
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const targetName = mutation.agentName || mutation.agentId || 'agent';

        if (mutation.pending) {
            if (mutation.action === 'delete') {
                const label = t('agent.operationDeleting', { name: targetName });
                return `<div class="loading agent-mutation-banner">${escapeHtml(label)}</div>`;
            }

            // Creating status is shown in VS Code's notification progress UI.
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
        if (agent?.id && state.currentAgentId === agent.id) {
            return 'active';
        }

        return 'idle';
    }

    // Render agents
    function renderAgents(agentData) {
        state.agents = agentData;
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
        
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (k) => k;
        const canEditAgentSettings = supportsRuntimeCapability('agentEditing');
        const settingsTitle = canEditAgentSettings
            ? t('common.settings')
            : resolveCapabilityUnavailableMessage('agentEditing');
        
        elements.agentList.innerHTML = `${mutationBanner}${state.agents.map(agent => `
            <div class="agent-item ${agent.id === state.currentAgentId ? 'active' : ''}" data-id="${agent.id}">
                <span class="agent-status status-${resolveAgentIndicatorStatus(agent)}"></span>
                <div class="agent-info">
                    <div class="agent-name">${escapeHtml(agent.name)}</div>
                    <div class="agent-model">${escapeHtml(agent.model)}</div>
                </div>
                <div class="agent-actions">
                    <button class="agent-action-btn" data-action="settings" title="${escapeHtml(settingsTitle)}" ${canEditAgentSettings ? '' : 'disabled aria-disabled="true"'}>⚙️</button>
                    <button class="agent-action-btn" data-action="folder" title="${t('common.openInExplorer')}">📁</button>
                </div>
            </div>
        `).join('')}`;
        
        document.querySelectorAll('.agent-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.agent-actions')) return;
                const agentId = item.dataset.id;
                selectAgent(agentId);
            });
        });
        
        // Agent action buttons
        document.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.disabled) {
                    showError(btn.title || resolveCapabilityUnavailableMessage('agentEditing'));
                    return;
                }
                const agentId = btn.closest('.agent-item').dataset.id;
                const action = btn.dataset.action;
                
                if (action === 'settings') {
                    vscode.postMessage({ type: 'openAgentSettings', agentId });
                } else if (action === 'folder') {
                    vscode.postMessage({ type: 'openAgentFolder', agentId });
                }
            });
        });

        if (state.viewMode === 'tasks') {
            renderTasks(state.tasks);
        }
        if (state.viewMode === 'clusters') {
            renderClusterWorkspace();
        }
        if (state.viewMode === 'channel') {
            renderChannelWorkspace();
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

        renderAgents([...state.agents]);
    }

