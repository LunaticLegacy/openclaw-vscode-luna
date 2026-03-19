// OpenClaw Luna - Panel Channels V2 (Hierarchical)
'use strict';

(function() {
    // ===== State =====
    const channelState = {
        channels: [],
        channelTree: null,
        currentChannelId: null,
        expandedIds: new Set(),
        channelDraft: null,
        channelLoading: false,
        channelSending: false,
        channelMessages: [],
        currentChannelThinking: null,
    };

    let isBulkRenderingChannel = false;
    let activeChannelTraceContainer = null;
    const renderedChannelMessageIds = new Set();

    // ===== Channel Tree Rendering =====

    function renderChannelTree(treeData, selectedChannelId) {
        channelState.channels = treeData.channels || [];
        channelState.channelTree = treeData.tree || null;
        channelState.channelsLoaded = true;

        if (selectedChannelId && findChannelInTree(treeData.tree, selectedChannelId)) {
            channelState.currentChannelId = selectedChannelId;
            channelState.channelDraft = null;
        }

        renderChannelList();
        renderChannelWorkspace();
    }

    function renderChannelList() {
        const listEl = elements.channelList;
        if (!listEl) return;

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        if (!channelState.channelsLoaded) {
            listEl.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (!channelState.channelTree || channelState.channelTree.roots.length === 0) {
            listEl.innerHTML = `<div class="empty">${escapeHtml(t('channel.listEmpty'))}</div>`;
            return;
        }

        // Build tree HTML
        listEl.innerHTML = channelState.channelTree.roots
            .map(node => renderChannelNode(node))
            .join('');

        // Attach event listeners
        attachChannelNodeListeners();
    }

    function renderChannelNode(node, depth = 0) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = node;
        const isExpanded = channelState.expandedIds.has(channel.id);
        const isSelected = channel.id === channelState.currentChannelId && !channelState.channelDraft;
        const hasChildren = node.children && node.children.length > 0;
        
        const indent = depth * 16;
        const icon = getChannelTypeIcon(channel.type);
        const statusIcon = getChannelStatusIcon(channel);

        let html = `
            <div class="channel-tree-node ${isSelected ? 'active' : ''}" 
                 data-channel-id="${escapeHtml(channel.id)}"
                 style="padding-left: ${12 + indent}px">
                
                <div class="channel-node-row">
                    ${hasChildren ? `
                        <button class="channel-expand-btn ${isExpanded ? 'expanded' : ''}" 
                                data-channel-id="${escapeHtml(channel.id)}"
                                title="${isExpanded ? t('channel.collapse') : t('channel.expand')}">
                            <span class="expand-icon">▶</span>
                        </button>
                    ` : '<span class="channel-expand-placeholder"></span>'}
                    
                    <div class="channel-node-content">
                        <span class="channel-icon">${icon}</span>
                        <span class="channel-name">${escapeHtml(channel.name)}</span>
                        ${statusIcon}
                    </div>
                    
                    <button class="channel-menu-btn" data-channel-id="${escapeHtml(channel.id)}" title="${t('common.more')}">
                        ⋯
                    </button>
                </div>
            </div>
        `;

        // Render children if expanded
        if (hasChildren && isExpanded) {
            html += node.children
                .map(child => renderChannelNode(child, depth + 1))
                .join('');
        }

        return html;
    }

    function getChannelTypeIcon(type) {
        const icons = {
            'root': '📁',
            'standard': '💬',
            'thread': '📎',
            'aggregate': '📊',
            'external': '📡',
        };
        return icons[type] || '💬';
    }

    function getChannelStatusIcon(channel) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        if (channel.archivedAt) {
            return `<span class="channel-status" title="${t('channel.archived')}">📦</span>`;
        }
        if (channel.type === 'external' && channel.externalConfig) {
            const status = channel.externalConfig.sync.status;
            if (status === 'syncing') return `<span class="channel-status syncing" title="${t('channel.syncing')}">↻</span>`;
            if (status === 'error') return `<span class="channel-status error" title="${channel.externalConfig.sync.lastError}">⚠️</span>`;
        }
        if (channel.type === 'aggregate') {
            return `<span class="channel-status" title="${t('channel.aggregate')}">★</span>`;
        }
        return '';
    }

    function findChannelInTree(tree, channelId) {
        if (!tree) return null;
        
        for (const root of tree.roots) {
            const found = findChannelNode(root, channelId);
            if (found) return found;
        }
        return null;
    }

    function findChannelNode(node, channelId) {
        if (node.id === channelId) return node;
        
        for (const child of node.children || []) {
            const found = findChannelNode(child, channelId);
            if (found) return found;
        }
        return null;
    }

    // ===== Event Handlers =====

    function attachChannelNodeListeners() {
        // Channel selection
        document.querySelectorAll('.channel-node-content').forEach(el => {
            el.addEventListener('click', (e) => {
                const node = (e.currentTarget).closest('.channel-tree-node');
                const channelId = node?.getAttribute('data-channel-id');
                if (channelId) {
                    selectChannel(channelId);
                }
            });
        });

        // Expand/collapse
        document.querySelectorAll('.channel-expand-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const channelId = el.getAttribute('data-channel-id');
                if (channelId) {
                    toggleChannelExpand(channelId);
                }
            });
        });

        // Menu button
        document.querySelectorAll('.channel-menu-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const channelId = el.getAttribute('data-channel-id');
                if (channelId) {
                    showChannelContextMenu(channelId, el);
                }
            });
        });
    }

    function toggleChannelExpand(channelId) {
        if (channelState.expandedIds.has(channelId)) {
            channelState.expandedIds.delete(channelId);
        } else {
            channelState.expandedIds.add(channelId);
        }
        renderChannelList();
    }

    function showChannelContextMenu(channelId, buttonEl) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        if (!channel) return;

        const menuItems = [];

        // Common actions
        menuItems.push(
            { label: t('channel.newSubchannel'), action: 'newSubchannel', icon: '➕' },
            { label: t('channel.edit'), action: 'edit', icon: '✏️' }
        );

        // Type-specific actions
        if (channel.type !== 'external') {
            menuItems.push({ label: t('channel.setAsAggregate'), action: 'setAggregate', icon: '📊' });
        }
        if (channel.type !== 'aggregate') {
            menuItems.push({ label: t('channel.addExternalSource'), action: 'addExternal', icon: '📡' });
        }

        menuItems.push({ type: 'separator' });

        // Move actions
        menuItems.push(
            { label: t('channel.moveUp'), action: 'moveUp', icon: '⬆️' },
            { label: t('channel.moveDown'), action: 'moveDown', icon: '⬇️' },
            { label: t('channel.moveTo'), action: 'moveTo', icon: '📂' }
        );

        menuItems.push({ type: 'separator' });

        // Archive/Delete
        if (channel.archivedAt) {
            menuItems.push({ label: t('channel.unarchive'), action: 'unarchive', icon: '📦' });
        } else {
            menuItems.push({ label: t('channel.archive'), action: 'archive', icon: '📦' });
        }
        menuItems.push({ label: t('channel.delete'), action: 'delete', icon: '🗑️', danger: true });

        // Render menu
        const menu = document.createElement('div');
        menu.className = 'channel-context-menu';
        menu.innerHTML = menuItems.map(item => {
            if (item.type === 'separator') return '<hr>';
            return `
                <button class="channel-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">
                    <span class="menu-icon">${item.icon}</span>
                    <span>${escapeHtml(item.label)}</span>
                </button>
            `;
        }).join('');

        // Position menu
        const rect = buttonEl.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;

        document.body.appendChild(menu);

        // Handle clicks
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.channel-menu-item');
            if (item) {
                const action = item.getAttribute('data-action');
                handleChannelMenuAction(channelId, action);
            }
            menu.remove();
        });

        // Close on outside click
        setTimeout(() => {
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    function handleChannelMenuAction(channelId, action) {
        const actions = {
            newSubchannel: () => startNewChannelDraft({ parentId: channelId }),
            edit: () => { /* Already handled by selecting */ },
            setAggregate: () => vscode.postMessage({ type: 'setChannelAggregate', channelId }),
            addExternal: () => showExternalSourceModal(channelId),
            moveUp: () => vscode.postMessage({ type: 'moveChannel', channelId, direction: 'up' }),
            moveDown: () => vscode.postMessage({ type: 'moveChannel', channelId, direction: 'down' }),
            moveTo: () => showMoveChannelModal(channelId),
            archive: () => vscode.postMessage({ type: 'archiveChannel', channelId }),
            unarchive: () => vscode.postMessage({ type: 'unarchiveChannel', channelId }),
            delete: () => confirmDeleteChannel(channelId),
        };

        if (actions[action]) {
            actions[action]();
        }
    }

    // ===== Modals =====

    function showExternalSourceModal(channelId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${t('channel.externalSource.title')}</h3>
                
                <div class="form-group">
                    <label>${t('channel.externalSource.provider')}</label>
                    <select id="external-provider">
                        <option value="rss">RSS Feed</option>
                        <option value="youtube">YouTube</option>
                        <option value="github">GitHub</option>
                        <option value="webhook">Webhook</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>${t('channel.externalSource.name')}</label>
                    <input type="text" id="external-name" placeholder="My Data Source">
                </div>

                <div class="form-group" id="rss-config">
                    <label>${t('channel.externalSource.rssUrl')}</label>
                    <input type="url" id="external-rss-url" placeholder="https://example.com/feed.xml">
                </div>

                <div class="form-group hidden" id="youtube-config">
                    <label>${t('channel.externalSource.youtubeChannel')}</label>
                    <input type="text" id="external-youtube-channel" placeholder="Channel ID">
                </div>

                <div class="form-group hidden" id="github-config">
                    <label>${t('channel.externalSource.githubRepos')}</label>
                    <input type="text" id="external-github-repos" placeholder="owner/repo, owner/repo2">
                </div>

                <div class="form-group">
                    <label>${t('channel.externalSource.apiKey')}</label>
                    <input type="password" id="external-api-key" placeholder="Optional API Key">
                </div>

                <div class="form-group">
                    <label>${t('channel.externalSource.syncInterval')}</label>
                    <select id="external-sync-interval">
                        <option value="15">15 minutes</option>
                        <option value="60" selected>1 hour</option>
                        <option value="360">6 hours</option>
                        <option value="1440">24 hours</option>
                    </select>
                </div>

                <div class="form-actions">
                    <button class="btn modal-cancel">${t('common.cancel')}</button>
                    <button class="btn btn-primary" id="btn-save-external">${t('common.save')}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Provider switch
        const providerSelect = modal.querySelector('#external-provider');
        providerSelect.addEventListener('change', (e) => {
            const provider = e.target.value;
            modal.querySelector('#rss-config').classList.toggle('hidden', provider !== 'rss');
            modal.querySelector('#youtube-config').classList.toggle('hidden', provider !== 'youtube');
            modal.querySelector('#github-config').classList.toggle('hidden', provider !== 'github');
        });

        // Save
        modal.querySelector('#btn-save-external').addEventListener('click', () => {
            const provider = providerSelect.value;
            const config = {
                channelId,
                provider,
                name: modal.querySelector('#external-name').value,
                apiKey: modal.querySelector('#external-api-key').value,
                syncInterval: parseInt(modal.querySelector('#external-sync-interval').value),
            };

            // Add provider-specific config
            if (provider === 'rss') {
                config.rssUrl = modal.querySelector('#external-rss-url').value;
            } else if (provider === 'youtube') {
                config.youtubeChannelId = modal.querySelector('#external-youtube-channel').value;
            } else if (provider === 'github') {
                config.githubRepos = modal.querySelector('#external-github-repos').value.split(',').map(s => s.trim());
            }

            vscode.postMessage({ type: 'configureExternalSource', ...config });
            modal.remove();
        });

        // Cancel
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    function showMoveChannelModal(channelId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        
        // Build parent options (excluding self and descendants)
        const validParents = channelState.channels.filter(c => 
            c.id !== channelId && 
            c.type !== 'thread' && // Can't move into a thread
            !isDescendant(channelId, c.id)
        );

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${t('channel.moveTo')}</h3>
                <p>${t('channel.moveToDescription', { name: channel?.name })}</p>
                
                <div class="form-group">
                    <label>${t('channel.selectParent')}</label>
                    <select id="move-parent-id">
                        <option value="">${t('channel.rootLevel')}</option>
                        ${validParents.map(c => `
                            <option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>
                        `).join('')}
                    </select>
                </div>

                <div class="form-actions">
                    <button class="btn modal-cancel">${t('common.cancel')}</button>
                    <button class="btn btn-primary" id="btn-confirm-move">${t('common.move')}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#btn-confirm-move').addEventListener('click', () => {
            const newParentId = modal.querySelector('#move-parent-id').value || undefined;
            vscode.postMessage({ type: 'moveChannel', channelId, newParentId });
            modal.remove();
        });

        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    function isDescendant(parentId, childId) {
        const child = channelState.channels.find(c => c.id === childId);
        if (!child) return false;
        if (child.parentId === parentId) return true;
        if (child.parentId) return isDescendant(parentId, child.parentId);
        return false;
    }

    function confirmDeleteChannel(channelId) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => k => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        if (!channel) return;

        const hasChildren = channel.childrenIds?.length > 0;
        
        let message = t('channel.deleteConfirm', { name: channel.name });
        if (hasChildren) {
            message += '\n\n' + t('channel.deleteHasChildren');
        }

        if (confirm(message)) {
            vscode.postMessage({ 
                type: 'deleteChannel', 
                channelId,
                recursive: hasChildren ? confirm(t('channel.deleteRecursiveConfirm')) : false,
                moveChildrenToParent: hasChildren ? true : false,
            });
        }
    }

    // ===== Channel Operations =====

    function startNewChannelDraft(options = {}) {
        channelState.channelDraft = {
            name: '',
            agentId: state.agents[0]?.id || '',
            description: '',
            parentId: options.parentId,
            type: options.parentId ? 'thread' : 'standard',
        };
        channelState.currentChannelId = null;
        channelState.channelMessages = [];
        channelState.channelLoading = false;
        resetTransientChannelState();
        renderChannelWorkspace();

        if (options.focus !== false) {
            window.setTimeout(() => {
                elements.channelName?.focus();
            }, 0);
        }
    }

    function selectChannel(channelId) {
        if (!channelId || (channelId === channelState.currentChannelId && !channelState.channelDraft)) {
            return;
        }

        // Auto-expand selected channel's parents
        const channel = channelState.channels.find(c => c.id === channelId);
        if (channel?.parentId) {
            channelState.expandedIds.add(channel.parentId);
        }

        channelState.channelDraft = null;
        channelState.currentChannelId = channelId;
        channelState.channelMessages = [];
        channelState.channelLoading = true;
        resetTransientChannelState();
        renderChannelList();
        renderChannelWorkspace();
        
        vscode.postMessage({
            type: 'selectChannel',
            channelId
        });
    }

    // ===== Workspace & Chat (Reused from V1 with updates) =====

    function renderChannelWorkspace() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const isDraft = Boolean(channelState.channelDraft);
        const formData = channelState.channelDraft || channel;
        const hasWorkspace = Boolean(formData);

        if (elements.channelEmptyState) {
            elements.channelEmptyState.classList.toggle('hidden', hasWorkspace);
        }
        if (elements.channelWorkspace) {
            elements.channelWorkspace.classList.toggle('hidden', !hasWorkspace);
        }
        if (elements.channelChatShell) {
            elements.channelChatShell.classList.toggle('hidden', !hasWorkspace);
        }

        if (!hasWorkspace || !formData) {
            renderChannelList();
            return;
        }

        const agentId = formData.agentId || state.agents[0]?.id || '';
        const agent = resolveAgent(agentId);

        if (elements.channelEditorTitle) {
            elements.channelEditorTitle.textContent = isDraft
                ? t('channel.editorTitleNew')
                : t('channel.editorTitleExisting', { name: formData.name });
        }
        if (elements.channelEditorSummary) {
            elements.channelEditorSummary.textContent = isDraft
                ? t('channel.editorSummaryNew')
                : t('channel.editorSummaryExisting');
        }

        // Populate type selector
        populateChannelTypeSelector(formData.type);
        
        // Populate parent selector for drafts
        populateChannelParentSelector(formData.parentId, isDraft);

        populateChannelAgentOptions(agentId);

        if (elements.channelName) {
            elements.channelName.value = formData.name || '';
        }
        if (elements.channelDescription) {
            elements.channelDescription.value = formData.description || '';
        }
        if (elements.channelAgentId) {
            elements.channelAgentId.value = agentId;
        }
        if (elements.btnDeleteChannel) {
            elements.btnDeleteChannel.disabled = isDraft;
        }

        // Show type-specific config
        renderChannelTypeConfig(channel);

        if (elements.channelChatTitle) {
            elements.channelChatTitle.textContent = isDraft
                ? t('channel.chatTitleDraft')
                : t('channel.chatTitleNamed', { name: formData.name });
        }

        renderChannelConversation();
        updateChannelInputState();
        renderChannelList();
    }

    function populateChannelTypeSelector(selectedType) {
        const select = document.getElementById('channel-type');
        if (!select) return;

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        const types = [
            { value: 'standard', label: t('channel.type.standard') },
            { value: 'thread', label: t('channel.type.thread') },
            { value: 'aggregate', label: t('channel.type.aggregate') },
            { value: 'external', label: t('channel.type.external') },
        ];

        select.innerHTML = types.map(t => 
            `<option value="${t.value}" ${t.value === selectedType ? 'selected' : ''}>${t.label}</option>`
        ).join('');
    }

    function populateChannelParentSelector(selectedParentId, isDraft) {
        const select = document.getElementById('channel-parent-id');
        if (!select) return;

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // Only show if in draft mode
        select.disabled = !isDraft;
        
        const validParents = channelState.channels.filter(c => 
            c.type !== 'thread' && !c.archivedAt
        );

        select.innerHTML = `
            <option value="">${t('channel.rootLevel')}</option>
            ${validParents.map(c => `
                <option value="${escapeHtml(c.id)}" ${c.id === selectedParentId ? 'selected' : ''}>
                    ${escapeHtml(c.name)}
                </option>
            `).join('')}
        `;
    }

    function renderChannelTypeConfig(channel) {
        const container = document.getElementById('channel-type-config');
        if (!container || !channel) return;

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        switch (channel.type) {
            case 'aggregate':
                container.innerHTML = `
                    <div class="channel-config-section">
                        <h4>${t('channel.aggregateConfig.title')}</h4>
                        <div class="form-group">
                            <label>${t('channel.aggregateConfig.sources')}</label>
                            <div class="channel-source-picker">
                                ${channelState.channels
                                    .filter(c => c.id !== channel.id && !c.archivedAt)
                                    .map(c => `
                                        <label class="checkbox-label">
                                            <input type="checkbox" value="${c.id}" 
                                                ${channel.aggregateConfig?.sourceIds?.includes(c.id) ? 'checked' : ''}>
                                            ${escapeHtml(c.name)}
                                        </label>
                                    `).join('')}
                            </div>
                        </div>
                        <div class="form-group">
                            <label>${t('channel.aggregateConfig.transform')}</label>
                            <select id="aggregate-transform">
                                <option value="none">${t('channel.aggregateTransform.none')}</option>
                                <option value="summary">${t('channel.aggregateTransform.summary')}</option>
                                <option value="ai-summarize">${t('channel.aggregateTransform.ai')}</option>
                            </select>
                        </div>
                    </div>
                `;
                break;

            case 'external':
                const sync = channel.externalConfig?.sync;
                container.innerHTML = `
                    <div class="channel-config-section">
                        <h4>${t('channel.externalConfig.title')}</h4>
                        <div class="external-source-info">
                            <p><strong>${t('channel.externalConfig.provider')}:</strong> ${channel.externalConfig?.provider}</p>
                            <p><strong>${t('channel.externalConfig.status')}:</strong> 
                                <span class="sync-status ${sync?.status}">${sync?.status}</span>
                            </p>
                            ${sync?.lastSyncAt ? `<p><strong>${t('channel.externalConfig.lastSync')}:</strong> ${new Date(sync.lastSyncAt).toLocaleString()}</p>` : ''}
                            ${sync?.lastError ? `<p class="sync-error"><strong>${t('channel.externalConfig.error')}:</strong> ${sync.lastError}</p>` : ''}
                        </div>
                        <button class="btn btn-secondary" id="btn-sync-now">${t('channel.externalConfig.syncNow')}</button>
                        <button class="btn btn-secondary" id="btn-edit-source">${t('channel.externalConfig.edit')}</button>
                    </div>
                `;
                
                container.querySelector('#btn-sync-now')?.addEventListener('click', () => {
                    vscode.postMessage({ type: 'syncExternalChannel', channelId: channel.id });
                });
                break;

            default:
                container.innerHTML = '';
        }
    }

    // ===== Chat Functions (Mostly unchanged from V1) =====

    function renderChannelConversation() {
        if (!elements.channelMessages) return;

        resetTransientChannelState();
        renderedChannelMessageIds.clear();
        elements.channelMessages.innerHTML = '';

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const draft = channelState.channelDraft;

        if (channelState.channelLoading) {
            elements.channelMessages.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (draft) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.unsavedHint'))}</div>`;
            return;
        }

        if (!channel) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.selectHint'))}</div>`;
            return;
        }

        if (!resolveChannelAgent(channel)) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.missingAgentHint'))}</div>`;
            return;
        }

        if (channelState.channelMessages.length === 0) {
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.emptyConversation'))}</div>`;
            return;
        }

        isBulkRenderingChannel = true;
        channelState.channelMessages.forEach(message => addChannelMessage(message));
        isBulkRenderingChannel = false;
        scrollChannelToBottom();
    }

    // ... (Keep remaining chat functions from V1: populateChannelAgentOptions, 
    // getCurrentChannel, resolveAgent, resolveChannelAgent, saveChannelConfig, 
    // updateChannelInputState, sendChannelMessage, etc.)

    // ===== Message Handlers =====

    function handleChannelsLoadedV2(message) {
        renderChannelTree(message, message.selectedChannelId);
    }

    function handleChannelTreeUpdate(message) {
        channelState.channels = message.channels || [];
        channelState.channelTree = message.tree || null;
        renderChannelList();
    }

    function handleChannelExpanded(message) {
        if (message.expanded) {
            channelState.expandedIds.add(message.channelId);
        } else {
            channelState.expandedIds.delete(message.channelId);
        }
        renderChannelList();
    }

    // ===== Initialization =====

    function initChannelsV2() {
        // Register message handlers
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'channelsLoadedV2':
                    handleChannelsLoadedV2(message);
                    break;
                case 'channelTreeUpdate':
                    handleChannelTreeUpdate(message);
                    break;
                case 'channelExpanded':
                    handleChannelExpanded(message);
                    break;
                // ... other handlers
            }
        });

        // Expose functions for panel.js
        window.OpenClawChannelsV2 = {
            renderChannelTree,
            startNewChannelDraft,
            selectChannel,
            saveChannelConfig,
            sendChannelMessage,
            stopChannelRun,
        };
    }

    // Initialize
    initChannelsV2();
})();
