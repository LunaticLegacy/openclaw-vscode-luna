// OpenClaw Luna - Panel Channels V2 (Hierarchical)
// 频道面板V2模块 - 支持层次化树形结构的频道管理
'use strict';

(function() {
    // ===== State =====
    // 频道状态对象，存储所有频道相关的状态数据
    const channelState = {
        channels: [],           // 频道列表数据
        channelTree: null,      // 频道树形结构
        currentChannelId: null, // 当前选中的频道ID
        expandedIds: new Set(), // 已展开的频道ID集合
        channelDraft: null,     // 频道草稿数据
        channelLoading: false,  // 频道消息加载状态
        channelSending: false,  // 消息发送状态
        channelMessages: [],    // 当前频道的消息列表
        currentChannelThinking: null, // 思考指示器元素
    };

    // 批量渲染标志，避免频繁滚动
    let isBulkRenderingChannel = false;
    // 当前活动的追踪容器，用于工具调用链
    let activeChannelTraceContainer = null;
    // 已渲染消息ID集合，用于去重
    const renderedChannelMessageIds = new Set();

    // ===== Channel Tree Rendering =====
    // 频道树形渲染相关函数

    /**
     * 渲染频道树
     * 接收树形数据并更新界面
     * 
     * @param {Object} treeData - 树形数据对象
     * @param {Array} treeData.channels - 频道列表
     * @param {Object} treeData.tree - 树形结构
     * @param {string|null} selectedChannelId - 当前选中的频道ID
     */
    function renderChannelTree(treeData, selectedChannelId) {
        // 更新状态数据
        channelState.channels = treeData.channels || [];
        channelState.channelTree = treeData.tree || null;
        channelState.channelsLoaded = true;

        // 如果指定了选中的频道ID且在树中存在，则设置为当前频道
        if (selectedChannelId && findChannelInTree(treeData.tree, selectedChannelId)) {
            channelState.currentChannelId = selectedChannelId;
            channelState.channelDraft = null;
        }

        // 渲染列表和工作区
        renderChannelList();
        renderChannelWorkspace();
    }

    /**
     * 渲染频道列表
     * 根据树形结构生成频道列表HTML
     */
    function renderChannelList() {
        const listEl = elements.channelList;
        if (!listEl) return;

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 数据未加载完成，显示加载中
        if (!channelState.channelsLoaded) {
            listEl.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        // 树为空，显示空状态
        if (!channelState.channelTree || channelState.channelTree.roots.length === 0) {
            listEl.innerHTML = `<div class="empty">${escapeHtml(t('channel.listEmpty'))}</div>`;
            return;
        }

        // 构建树形HTML，从根节点开始递归渲染
        listEl.innerHTML = channelState.channelTree.roots
            .map(node => renderChannelNode(node))
            .join('');

        // 绑定事件监听器
        attachChannelNodeListeners();
    }

    /**
     * 渲染频道节点
     * 递归渲染单个频道节点及其子节点
     * 
     * @param {Object} node - 频道节点数据
     * @param {number} depth - 节点深度，用于计算缩进
     * @returns {string} 节点HTML字符串
     */
    function renderChannelNode(node, depth = 0) {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = node;
        
        // 判断节点状态
        const isExpanded = channelState.expandedIds.has(channel.id);
        const isSelected = channel.id === channelState.currentChannelId && !channelState.channelDraft;
        const hasChildren = node.children && node.children.length > 0;
        
        // 计算缩进（每级16像素）
        const indent = depth * 16;
        // 获取频道类型图标和状态图标
        const icon = getChannelTypeIcon(channel.type);
        const statusIcon = getChannelStatusIcon(channel);

        // 构建节点HTML
        let html = `
            <div class="channel-tree-node ${isSelected ? 'active' : ''}" 
                 data-channel-id="${escapeHtml(channel.id)}"
                 style="padding-left: ${12 + indent}px">
                
                <div class="channel-node-row">
                    <!-- 展开/折叠按钮（有子节点时显示） -->
                    ${hasChildren ? `
                        <button class="channel-expand-btn ${isExpanded ? 'expanded' : ''}" 
                                data-channel-id="${escapeHtml(channel.id)}"
                                title="${isExpanded ? t('channel.collapse') : t('channel.expand')}">
                            <span class="expand-icon">▶</span>
                        </button>
                    ` : '<span class="channel-expand-placeholder"></span>'}
                    
                    <!-- 频道内容区域（点击选择频道） -->
                    <div class="channel-node-content">
                        <span class="channel-icon">${icon}</span>
                        <span class="channel-name">${escapeHtml(channel.name)}</span>
                        ${statusIcon}
                    </div>
                    
                    <!-- 更多操作菜单按钮 -->
                    <button class="channel-menu-btn" data-channel-id="${escapeHtml(channel.id)}" title="${t('common.more')}">
                        ⋯
                    </button>
                </div>
            </div>
        `;

        // 如果已展开且存在子节点，递归渲染子节点
        if (hasChildren && isExpanded) {
            html += node.children
                .map(child => renderChannelNode(child, depth + 1))
                .join('');
        }

        return html;
    }

    /**
     * 获取频道类型图标
     * 根据频道类型返回对应的emoji图标
     * 
     * @param {string} type - 频道类型（root/standard/thread/aggregate/external）
     * @returns {string} 图标emoji
     */
    function getChannelTypeIcon(type) {
        const icons = {
            'root': '📁',       // 根频道
            'standard': '💬',   // 标准频道
            'thread': '📎',     // 线程/子频道
            'aggregate': '📊',  // 聚合频道
            'external': '📡',   // 外部源频道
        };
        return icons[type] || '💬';
    }

    /**
     * 获取频道状态图标
     * 根据频道的各种状态返回对应的图标
     * 
     * @param {Object} channel - 频道对象
     * @returns {string} 状态图标HTML
     */
    function getChannelStatusIcon(channel) {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 已归档频道显示归档图标
        if (channel.archivedAt) {
            return `<span class="channel-status" title="${t('channel.archived')}">📦</span>`;
        }
        
        // 外部频道的同步状态
        if (channel.type === 'external' && channel.externalConfig) {
            const status = channel.externalConfig.sync.status;
            if (status === 'syncing') return `<span class="channel-status syncing" title="${t('channel.syncing')}">↻</span>`;
            if (status === 'error') return `<span class="channel-status error" title="${channel.externalConfig.sync.lastError}">⚠️</span>`;
        }
        
        // 聚合频道显示星标
        if (channel.type === 'aggregate') {
            return `<span class="channel-status" title="${t('channel.aggregate')}">★</span>`;
        }
        return '';
    }

    /**
     * 在树中查找频道
     * 遍历树的所有根节点查找指定频道
     * 
     * @param {Object} tree - 树形结构对象
     * @param {string} channelId - 要查找的频道ID
     * @returns {Object|null} 找到的频道节点
     */
    function findChannelInTree(tree, channelId) {
        if (!tree) return null;
        
        // 遍历所有根节点
        for (const root of tree.roots) {
            const found = findChannelNode(root, channelId);
            if (found) return found;
        }
        return null;
    }

    /**
     * 递归查找频道节点
     * 深度优先搜索指定ID的节点
     * 
     * @param {Object} node - 当前节点
     * @param {string} channelId - 要查找的频道ID
     * @returns {Object|null} 找到的节点
     */
    function findChannelNode(node, channelId) {
        if (node.id === channelId) return node;
        
        // 递归搜索子节点
        for (const child of node.children || []) {
            const found = findChannelNode(child, channelId);
            if (found) return found;
        }
        return null;
    }

    // ===== Event Handlers =====
    // 事件处理器

    /**
     * 绑定频道节点事件监听器
     * 为频道选择、展开/折叠、菜单按钮绑定点击事件
     */
    function attachChannelNodeListeners() {
        // 频道选择事件
        document.querySelectorAll('.channel-node-content').forEach(el => {
            el.addEventListener('click', (e) => {
                const node = (e.currentTarget).closest('.channel-tree-node');
                const channelId = node?.getAttribute('data-channel-id');
                if (channelId) {
                    selectChannel(channelId);
                }
            });
        });

        // 展开/折叠按钮事件
        document.querySelectorAll('.channel-expand-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡，避免触发选择
                const channelId = el.getAttribute('data-channel-id');
                if (channelId) {
                    toggleChannelExpand(channelId);
                }
            });
        });

        // 菜单按钮事件
        document.querySelectorAll('.channel-menu-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡
                const channelId = el.getAttribute('data-channel-id');
                if (channelId) {
                    showChannelContextMenu(channelId, el);
                }
            });
        });
    }

    /**
     * 切换频道展开/折叠状态
     * 
     * @param {string} channelId - 频道ID
     */
    function toggleChannelExpand(channelId) {
        if (channelState.expandedIds.has(channelId)) {
            channelState.expandedIds.delete(channelId);
        } else {
            channelState.expandedIds.add(channelId);
        }
        renderChannelList();
    }

    /**
     * 显示频道上下文菜单
     * 在指定按钮位置显示操作菜单
     * 
     * @param {string} channelId - 频道ID
     * @param {HTMLElement} buttonEl - 触发菜单的按钮元素
     */
    function showChannelContextMenu(channelId, buttonEl) {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        if (!channel) return;

        // 构建菜单项列表
        const menuItems = [];

        // 通用操作
        menuItems.push(
            { label: t('channel.newSubchannel'), action: 'newSubchannel', icon: '➕' },
            { label: t('channel.edit'), action: 'edit', icon: '✏️' }
        );

        // 类型特定的操作
        if (channel.type !== 'external') {
            menuItems.push({ label: t('channel.setAsAggregate'), action: 'setAggregate', icon: '📊' });
        }
        if (channel.type !== 'aggregate') {
            menuItems.push({ label: t('channel.addExternalSource'), action: 'addExternal', icon: '📡' });
        }

        menuItems.push({ type: 'separator' });

        // 移动操作
        menuItems.push(
            { label: t('channel.moveUp'), action: 'moveUp', icon: '⬆️' },
            { label: t('channel.moveDown'), action: 'moveDown', icon: '⬇️' },
            { label: t('channel.moveTo'), action: 'moveTo', icon: '📂' }
        );

        menuItems.push({ type: 'separator' });

        // 归档/删除操作
        if (channel.archivedAt) {
            menuItems.push({ label: t('channel.unarchive'), action: 'unarchive', icon: '📦' });
        } else {
            menuItems.push({ label: t('channel.archive'), action: 'archive', icon: '📦' });
        }
        menuItems.push({ label: t('channel.delete'), action: 'delete', icon: '🗑️', danger: true });

        // 渲染菜单HTML
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

        // 定位菜单到按钮下方
        const rect = buttonEl.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;

        document.body.appendChild(menu);

        // 处理菜单项点击
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.channel-menu-item');
            if (item) {
                const action = item.getAttribute('data-action');
                handleChannelMenuAction(channelId, action);
            }
            menu.remove();
        });

        // 点击外部关闭菜单
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

    /**
     * 处理频道菜单操作
     * 根据操作类型执行相应的功能
     * 
     * @param {string} channelId - 频道ID
     * @param {string} action - 操作类型
     */
    function handleChannelMenuAction(channelId, action) {
        // 操作映射表
        const actions = {
            newSubchannel: () => startNewChannelDraft({ parentId: channelId }),
            edit: () => { /* 编辑操作已由选择频道处理 */ },
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
    // 模态对话框

    /**
     * 显示外部源配置模态框
     * 用于配置RSS、YouTube、GitHub等外部数据源
     * 
     * @param {string} channelId - 频道ID
     */
    function showExternalSourceModal(channelId) {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${t('channel.externalSource.title')}</h3>
                
                <!-- 提供商选择 -->
                <div class="form-group">
                    <label>${t('channel.externalSource.provider')}</label>
                    <select id="external-provider">
                        <option value="rss">RSS Feed</option>
                        <option value="youtube">YouTube</option>
                        <option value="github">GitHub</option>
                        <option value="webhook">Webhook</option>
                    </select>
                </div>

                <!-- 名称输入 -->
                <div class="form-group">
                    <label>${t('channel.externalSource.name')}</label>
                    <input type="text" id="external-name" placeholder="My Data Source">
                </div>

                <!-- RSS配置（默认显示） -->
                <div class="form-group" id="rss-config">
                    <label>${t('channel.externalSource.rssUrl')}</label>
                    <input type="url" id="external-rss-url" placeholder="https://example.com/feed.xml">
                </div>

                <!-- YouTube配置（默认隐藏） -->
                <div class="form-group hidden" id="youtube-config">
                    <label>${t('channel.externalSource.youtubeChannel')}</label>
                    <input type="text" id="external-youtube-channel" placeholder="Channel ID">
                </div>

                <!-- GitHub配置（默认隐藏） -->
                <div class="form-group hidden" id="github-config">
                    <label>${t('channel.externalSource.githubRepos')}</label>
                    <input type="text" id="external-github-repos" placeholder="owner/repo, owner/repo2">
                </div>

                <!-- API密钥输入 -->
                <div class="form-group">
                    <label>${t('channel.externalSource.apiKey')}</label>
                    <input type="password" id="external-api-key" placeholder="Optional API Key">
                </div>

                <!-- 同步间隔选择 -->
                <div class="form-group">
                    <label>${t('channel.externalSource.syncInterval')}</label>
                    <select id="external-sync-interval">
                        <option value="15">15 minutes</option>
                        <option value="60" selected>1 hour</option>
                        <option value="360">6 hours</option>
                        <option value="1440">24 hours</option>
                    </select>
                </div>

                <!-- 操作按钮 -->
                <div class="form-actions">
                    <button class="btn modal-cancel">${t('common.cancel')}</button>
                    <button class="btn btn-primary" id="btn-save-external">${t('common.save')}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 提供商切换逻辑：根据选择显示/隐藏对应的配置项
        const providerSelect = modal.querySelector('#external-provider');
        providerSelect.addEventListener('change', (e) => {
            const provider = e.target.value;
            modal.querySelector('#rss-config').classList.toggle('hidden', provider !== 'rss');
            modal.querySelector('#youtube-config').classList.toggle('hidden', provider !== 'youtube');
            modal.querySelector('#github-config').classList.toggle('hidden', provider !== 'github');
        });

        // 保存配置
        modal.querySelector('#btn-save-external').addEventListener('click', () => {
            const provider = providerSelect.value;
            const config = {
                channelId,
                provider,
                name: modal.querySelector('#external-name').value,
                apiKey: modal.querySelector('#external-api-key').value,
                syncInterval: parseInt(modal.querySelector('#external-sync-interval').value),
            };

            // 根据提供商添加特定配置
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

        // 取消按钮
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * 显示移动频道模态框
     * 用于将频道移动到其他父级下
     * 
     * @param {string} channelId - 要移动的频道ID
     */
    function showMoveChannelModal(channelId) {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        
        // 构建有效的父级选项（排除自身和后代）
        const validParents = channelState.channels.filter(c => 
            c.id !== channelId && 
            c.type !== 'thread' && // 不能移动到线程内
            !isDescendant(channelId, c.id)
        );

        // 创建模态框
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

        // 确认移动
        modal.querySelector('#btn-confirm-move').addEventListener('click', () => {
            const newParentId = modal.querySelector('#move-parent-id').value || undefined;
            vscode.postMessage({ type: 'moveChannel', channelId, newParentId });
            modal.remove();
        });

        // 取消按钮
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * 检查是否为后代节点
     * 判断childId是否是parentId的后代
     * 
     * @param {string} parentId - 父节点ID
     * @param {string} childId - 待检查的节点ID
     * @returns {boolean} 是否为后代
     */
    function isDescendant(parentId, childId) {
        const child = channelState.channels.find(c => c.id === childId);
        if (!child) return false;
        // 直接子节点
        if (child.parentId === parentId) return true;
        // 递归检查父节点的父节点
        if (child.parentId) return isDescendant(parentId, child.parentId);
        return false;
    }

    /**
     * 确认删除频道
     * 显示确认对话框并处理删除操作
     * 
     * @param {string} channelId - 要删除的频道ID
     */
    function confirmDeleteChannel(channelId) {
        // 获取国际化翻译函数（修复翻译函数调用）
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = channelState.channels.find(c => c.id === channelId);
        if (!channel) return;

        // 检查是否有子频道
        const hasChildren = channel.childrenIds?.length > 0;
        
        // 构建确认消息
        let message = t('channel.deleteConfirm', { name: channel.name });
        if (hasChildren) {
            message += '\n\n' + t('channel.deleteHasChildren');
        }

        // 显示确认对话框
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
    // 频道操作

    /**
     * 开始创建新频道草稿
     * 初始化草稿状态并根据选项设置父级
     * 
     * @param {Object} options - 配置选项
     * @param {string} [options.parentId] - 父频道ID，如指定则创建子频道
     * @param {boolean} [options.focus] - 是否聚焦到名称输入框，默认为true
     */
    function startNewChannelDraft(options = {}) {
        // 初始化草稿数据
        channelState.channelDraft = {
            name: '',
            agentId: state.agents[0]?.id || '', // 默认使用第一个Agent
            description: '',
            parentId: options.parentId,
            type: options.parentId ? 'thread' : 'standard', // 有父级则为线程类型
        };
        // 重置相关状态
        channelState.currentChannelId = null;
        channelState.channelMessages = [];
        channelState.channelLoading = false;
        resetTransientChannelState();
        renderChannelWorkspace();

        // 根据配置决定是否聚焦
        if (options.focus !== false) {
            window.setTimeout(() => {
                elements.channelName?.focus();
            }, 0);
        }
    }

    /**
     * 选择指定频道
     * 切换当前频道并自动展开其父级
     * 
     * @param {string} channelId - 要选择的频道ID
     */
    function selectChannel(channelId) {
        // 检查是否已选中
        if (!channelId || (channelId === channelState.currentChannelId && !channelState.channelDraft)) {
            return;
        }

        // 自动展开选中频道的父级
        const channel = channelState.channels.find(c => c.id === channelId);
        if (channel?.parentId) {
            channelState.expandedIds.add(channel.parentId);
        }

        // 重置状态
        channelState.channelDraft = null;
        channelState.currentChannelId = channelId;
        channelState.channelMessages = [];
        channelState.channelLoading = true;
        resetTransientChannelState();
        renderChannelList();
        renderChannelWorkspace();
        
        // 向VSCode发送选择消息
        vscode.postMessage({
            type: 'selectChannel',
            channelId
        });
    }

    // ===== Workspace & Chat (Reused from V1 with updates) =====
    // 工作区和聊天（从V1复用并更新）

    /**
     * 渲染频道工作区
     * 根据当前选中的频道或草稿状态，渲染编辑器和聊天界面
     */
    function renderChannelWorkspace() {
        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const isDraft = Boolean(channelState.channelDraft);
        const formData = channelState.channelDraft || channel;
        const hasWorkspace = Boolean(formData);

        // 控制空状态和工作区的显示/隐藏
        if (elements.channelEmptyState) {
            elements.channelEmptyState.classList.toggle('hidden', hasWorkspace);
        }
        if (elements.channelWorkspace) {
            elements.channelWorkspace.classList.toggle('hidden', !hasWorkspace);
        }
        if (elements.channelChatShell) {
            elements.channelChatShell.classList.toggle('hidden', !hasWorkspace);
        }

        // 如果没有工作区数据，只渲染列表后返回
        if (!hasWorkspace || !formData) {
            renderChannelList();
            return;
        }

        // 解析Agent信息
        const agentId = formData.agentId || state.agents[0]?.id || '';
        const agent = resolveAgent(agentId);

        // 设置编辑器标题和摘要
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

        // 填充类型选择器
        populateChannelTypeSelector(formData.type);
        
        // 填充父级选择器（仅草稿模式）
        populateChannelParentSelector(formData.parentId, isDraft);

        // 填充Agent选项
        populateChannelAgentOptions(agentId);

        // 填充表单字段
        if (elements.channelName) {
            elements.channelName.value = formData.name || '';
        }
        if (elements.channelDescription) {
            elements.channelDescription.value = formData.description || '';
        }
        if (elements.channelAgentId) {
            elements.channelAgentId.value = agentId;
        }
        // 草稿状态禁用删除按钮
        if (elements.btnDeleteChannel) {
            elements.btnDeleteChannel.disabled = isDraft;
        }

        // 显示类型特定的配置
        renderChannelTypeConfig(channel);

        // 设置聊天区域标题
        if (elements.channelChatTitle) {
            elements.channelChatTitle.textContent = isDraft
                ? t('channel.chatTitleDraft')
                : t('channel.chatTitleNamed', { name: formData.name });
        }

        // 渲染对话内容和更新输入状态
        renderChannelConversation();
        updateChannelInputState();
        renderChannelList();
    }

    /**
     * 填充频道类型选择器
     * 
     * @param {string} selectedType - 当前选中的类型
     */
    function populateChannelTypeSelector(selectedType) {
        const select = document.getElementById('channel-type');
        if (!select) return;

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 定义可用的频道类型
        const types = [
            { value: 'standard', label: t('channel.type.standard') },
            { value: 'thread', label: t('channel.type.thread') },
            { value: 'aggregate', label: t('channel.type.aggregate') },
            { value: 'external', label: t('channel.type.external') },
        ];

        // 生成选项HTML
        select.innerHTML = types.map(t => 
            `<option value="${t.value}" ${t.value === selectedType ? 'selected' : ''}>${t.label}</option>`
        ).join('');
    }

    /**
     * 填充频道父级选择器
     * 
     * @param {string} selectedParentId - 当前选中的父级ID
     * @param {boolean} isDraft - 是否为草稿模式
     */
    function populateChannelParentSelector(selectedParentId, isDraft) {
        const select = document.getElementById('channel-parent-id');
        if (!select) return;

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 仅在草稿模式下可编辑
        select.disabled = !isDraft;
        
        // 过滤有效的父级选项（排除线程和已归档频道）
        const validParents = channelState.channels.filter(c => 
            c.type !== 'thread' && !c.archivedAt
        );

        // 生成选项HTML
        select.innerHTML = `
            <option value="">${t('channel.rootLevel')}</option>
            ${validParents.map(c => `
                <option value="${escapeHtml(c.id)}" ${c.id === selectedParentId ? 'selected' : ''}>
                    ${escapeHtml(c.name)}
                </option>
            `).join('')}
        `;
    }

    /**
     * 渲染频道类型配置
     * 根据频道类型显示特定的配置界面
     * 
     * @param {Object} channel - 频道对象
     */
    function renderChannelTypeConfig(channel) {
        const container = document.getElementById('channel-type-config');
        if (!container || !channel) return;

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 根据频道类型渲染不同的配置界面
        switch (channel.type) {
            case 'aggregate':
                // 聚合频道配置：选择源频道和转换方式
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
                // 外部频道配置：显示同步状态和信息
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
                
                // 绑定立即同步按钮事件
                container.querySelector('#btn-sync-now')?.addEventListener('click', () => {
                    vscode.postMessage({ type: 'syncExternalChannel', channelId: channel.id });
                });
                break;

            default:
                // 其他类型不显示特殊配置
                container.innerHTML = '';
        }
    }

    // ===== Chat Functions (Mostly unchanged from V1) =====
    // 聊天功能（大部分从V1复用）

    /**
     * 渲染频道对话内容
     * 清空消息容器并根据当前状态重新渲染所有消息
     */
    function renderChannelConversation() {
        // 检查消息容器是否存在
        if (!elements.channelMessages) return;

        // 重置临时状态并清空消息容器
        resetTransientChannelState();
        renderedChannelMessageIds.clear();
        elements.channelMessages.innerHTML = '';

        // 获取国际化翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const draft = channelState.channelDraft;

        // 根据当前状态显示不同的提示信息
        if (channelState.channelLoading) {
            // 加载中状态
            elements.channelMessages.innerHTML = `<div class="loading">${escapeHtml(t('common.loading'))}</div>`;
            return;
        }

        if (draft) {
            // 草稿状态：提示用户先保存频道
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.unsavedHint'))}</div>`;
            return;
        }

        if (!channel) {
            // 未选择频道状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.selectHint'))}</div>`;
            return;
        }

        if (!resolveChannelAgent(channel)) {
            // Agent缺失状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.missingAgentHint'))}</div>`;
            return;
        }

        if (channelState.channelMessages.length === 0) {
            // 空对话状态
            elements.channelMessages.innerHTML = `<div class="empty">${escapeHtml(t('channel.emptyConversation'))}</div>`;
            return;
        }

        // 批量渲染消息
        isBulkRenderingChannel = true;
        channelState.channelMessages.forEach(message => addChannelMessage(message));
        isBulkRenderingChannel = false;
        scrollChannelToBottom();
    }

    // ... (Keep remaining chat functions from V1: populateChannelAgentOptions, 
    // getCurrentChannel, resolveAgent, resolveChannelAgent, saveChannelConfig, 
    // updateChannelInputState, sendChannelMessage, etc.)
    // 注：以下函数从V1版本复用，功能保持一致
    
    /**
     * 填充频道Agent选项下拉框
     * 
     * @param {string} selectedAgentId - 当前选中的Agent ID
     */
    function populateChannelAgentOptions(selectedAgentId) {
        if (!elements.channelAgentId) return;

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 没有可用Agent时的处理
        if (state.agents.length === 0) {
            elements.channelAgentId.innerHTML = `<option value="">${escapeHtml(t('sidebar.noAgents'))}</option>`;
            elements.channelAgentId.disabled = true;
            return;
        }

        // 检查选中的Agent是否存在于列表中
        const hasSelectedAgent = state.agents.some(agent => agent.id === selectedAgentId);
        
        // 生成Agent选项HTML
        const options = state.agents.map(agent => `
            <option value="${escapeHtml(agent.id)}">${escapeHtml(`${agent.name} · ${agent.model}`)}</option>
        `);

        // 如果选中的Agent不在列表中，添加一个缺失提示选项
        if (selectedAgentId && !hasSelectedAgent) {
            options.unshift(`<option value="${escapeHtml(selectedAgentId)}">${escapeHtml(t('channel.listMetaMissingAgent', { agentId: selectedAgentId }))}</option>`);
        }

        // 更新下拉框
        elements.channelAgentId.disabled = false;
        elements.channelAgentId.innerHTML = options.join('');
        elements.channelAgentId.value = selectedAgentId && (hasSelectedAgent || selectedAgentId)
            ? selectedAgentId
            : state.agents[0]?.id || '';
    }

    /**
     * 获取当前选中的频道
     * 
     * @returns {Object|null} 当前频道对象，未选中则返回null
     */
    function getCurrentChannel() {
        if (!channelState.currentChannelId) {
            return null;
        }
        return channelState.channels.find(channel => channel.id === channelState.currentChannelId) || null;
    }

    /**
     * 根据ID解析Agent
     * 
     * @param {string} agentId - Agent ID
     * @returns {Object|null} Agent对象，未找到则返回null
     */
    function resolveAgent(agentId) {
        if (!agentId) {
            return null;
        }
        return state.agents.find(agent => agent.id === agentId) || null;
    }

    /**
     * 解析频道关联的Agent
     * 优先使用频道绑定的Agent，若无则使用第一个可用Agent
     * 
     * @param {Object} channel - 频道对象
     * @returns {Object|null} Agent对象
     */
    function resolveChannelAgent(channel) {
        if (!channel) {
            return null;
        }
        return resolveAgent(channel.agentId) || state.agents[0] || null;
    }

    /**
     * 保存频道配置
     * 收集表单数据并发送到VSCode
     */
    function saveChannelConfig() {
        const payload = {
            name: normalizeOutgoingMessage(elements.channelName?.value || ''),
            agentId: elements.channelAgentId?.value || '',
            description: normalizeOutgoingMessage(elements.channelDescription?.value || '')
        };

        // 草稿状态：创建新频道
        if (channelState.channelDraft) {
            vscode.postMessage({
                type: 'createChannel',
                data: payload
            });
            return;
        }

        // 检查当前频道ID是否存在
        if (!channelState.currentChannelId) {
            return;
        }

        // 更新现有频道
        vscode.postMessage({
            type: 'updateChannel',
            channelId: channelState.currentChannelId,
            data: payload
        });
    }

    /**
     * 更新频道输入框状态
     * 根据当前状态启用或禁用输入框并更新提示信息
     */
    function updateChannelInputState() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const channel = getCurrentChannel();
        const agent = channel ? resolveChannelAgent(channel) : null;

        let disabled = false;
        let hint = '';

        // 根据不同状态确定输入框状态和提示
        if (channelState.channelDraft) {
            disabled = true;
            hint = t('channel.unsavedHint');
        } else if (!channel) {
            disabled = true;
            hint = t('channel.selectHint');
        } else if (!agent) {
            disabled = true;
            hint = t('channel.missingAgentHint');
        } else if (channelState.channelLoading) {
            disabled = true;
            hint = t('common.loading');
        } else if (channelState.channelSending) {
            disabled = true;
            hint = t('chat.thinking');
        } else {
            hint = t('channel.chatHintReady', { agent: agent.name });
        }

        // 更新UI元素
        if (elements.channelChatHint) {
            elements.channelChatHint.textContent = hint;
        }
        if (elements.channelMessageInput) {
            elements.channelMessageInput.disabled = disabled;
        }
        if (elements.btnSendChannel) {
            elements.btnSendChannel.disabled = disabled;
        }
        if (elements.btnStopChannel) {
            elements.btnStopChannel.classList.toggle('hidden', !channelState.channelSending);
            elements.btnStopChannel.disabled = !channelState.channelSending;
        }
    }

    /**
     * 发送频道消息
     * 验证状态后将用户消息添加到界面并发送到VSCode
     */
    function sendChannelMessage() {
        // 获取并规范化输入内容
        const content = normalizeOutgoingMessage(elements.channelMessageInput?.value || '');

        // 检查草稿状态
        if (channelState.channelDraft) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.unsavedHint') : 'Save the channel first.');
            return;
        }

        // 检查频道是否已选择
        const channel = getCurrentChannel();
        if (!channel) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.selectHint') : 'Select a channel first.');
            return;
        }

        // 检查Agent是否可用
        if (!resolveChannelAgent(channel)) {
            showChannelError(window.OpenClawI18n ? window.OpenClawI18n.t('channel.missingAgentHint') : 'Bind this channel to an available agent first.');
            return;
        }

        // 检查内容是否为空或正在发送/加载中
        if (!content.trim() || channelState.channelSending || channelState.channelLoading) {
            return;
        }

        // 清空输入框
        if (elements.channelMessageInput) {
            elements.channelMessageInput.value = '';
        }

        // 更新发送状态并添加用户消息
        channelState.channelSending = true;
        addChannelMessage({
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });
        
        // 显示思考指示器并更新输入状态
        showChannelThinkingIndicator();
        updateChannelInputState();

        // 向VSCode发送消息
        vscode.postMessage({
            type: 'sendChannelMessage',
            channelId: channel.id,
            content
        });
    }

    /**
     * 显示频道思考指示器
     * 在消息列表底部显示AI正在思考的动画
     */
    function showChannelThinkingIndicator() {
        if (!elements.channelMessages) return;

        // 清除已有的思考指示器
        clearChannelThinkingIndicator();
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 创建思考指示器元素
        const div = document.createElement('div');
        div.className = 'message message-thinking thinking-indicator';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${t('chat.thinking')}</span>
                <span class="thinking-dots">
                    <span></span><span></span><span></span>
                </span>
            </div>
            <div class="thinking-content">
                <div class="thinking-line">${t('thinking.started')}</div>
            </div>
        `;

        elements.channelMessages.appendChild(div);
        scrollChannelToBottom();
        channelState.currentChannelThinking = div;
    }

    /**
     * 清除频道思考指示器
     * 移除正在显示的思考动画元素
     */
    function clearChannelThinkingIndicator() {
        if (!channelState.currentChannelThinking) {
            return;
        }
        channelState.currentChannelThinking.remove();
        channelState.currentChannelThinking = null;
    }

    /**
     * 重置频道临时状态
     * 清除思考指示器和相关状态标志
     */
    function resetTransientChannelState() {
        clearChannelThinkingIndicator();
        activeChannelTraceContainer = null;
        channelState.channelSending = false;
        updateChannelInputState();
    }

    /**
     * 停止频道运行
     * 发送停止消息到VSCode并重置临时状态
     */
    function stopChannelRun() {
        if (!channelState.channelSending) {
            return;
        }
        resetTransientChannelState();
        vscode.postMessage({
            type: 'stopActiveRun',
            scope: 'channel',
            channelId: channelState.currentChannelId
        });
    }

    /**
     * 添加频道消息到界面
     * 根据消息类型决定如何渲染（独立消息或追踪消息）
     * 
     * @param {Object} msg - 消息对象
     */
    function addChannelMessage(msg) {
        // 验证消息和容器
        if (!msg || !elements.channelMessages) return;
        // 避免重复渲染同一消息
        if (rememberRenderedMessageId(msg, renderedChannelMessageIds)) return;
        // 根据规则决定是否隐藏消息
        if (shouldHideMessage(msg)) return;

        // 助手或工具消息清除思考指示器
        if ((msg.role === 'assistant' || msg.role === 'tool') && channelState.currentChannelThinking) {
            clearChannelThinkingIndicator();
        }

        // 用户消息：重置追踪容器并渲染为独立消息
        if (msg.role === 'user') {
            activeChannelTraceContainer = null;
            appendStandaloneChannelMessage(msg);
            return;
        }

        // 检查是否应该追加到现有追踪容器
        if (shouldAppendToTrace(msg)) {
            appendChannelTraceMessage(msg);
            return;
        }

        // 其他情况：渲染为独立消息
        activeChannelTraceContainer = null;
        appendStandaloneChannelMessage(msg);
    }

    /**
     * 追加独立频道消息
     * 创建完整的消息元素并添加到消息列表
     * 
     * @param {Object} msg - 消息对象
     */
    function appendStandaloneChannelMessage(msg) {
        // 创建消息元素
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;

        // 格式化时间和Token信息
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const tokenInfo = msg.tokenCount ? `<span class="token-count">${msg.tokenCount} tokens</span>` : '';
        const rendered = renderMessageContent(msg);

        // 设置消息HTML内容
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${getMessageRoleLabel(msg)}</span>
                <span class="message-time">${time}</span>
                ${tokenInfo}
            </div>
            ${rendered}
        `;

        // 添加到消息容器
        elements.channelMessages.appendChild(div);
        // 非批量渲染模式下滚动到底部
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        // 助手消息（非工具使用）完成时重置发送状态
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            channelState.channelSending = false;
            updateChannelInputState();
        }
    }

    /**
     * 追加频道追踪消息
     * 将消息追加到当前的追踪容器中（用于工具调用链）
     * 
     * @param {Object} msg - 消息对象
     */
    function appendChannelTraceMessage(msg) {
        // 获取或创建追踪容器
        const container = getOrCreateChannelTraceContainer(msg);
        const body = container.querySelector('.trace-body');
        if (!body) return;

        // 创建追踪段落元素
        const segment = document.createElement('div');
        segment.className = `trace-segment trace-segment-${msg.role}`;
        segment.innerHTML = renderTraceSegment(msg);
        body.appendChild(segment);
        
        // 非批量渲染模式下滚动到底部
        if (!isBulkRenderingChannel) {
            scrollChannelToBottom();
        }

        // 助手消息（非工具使用）完成时重置状态
        if (msg.role === 'assistant' && !isToolUseMessage(msg)) {
            activeChannelTraceContainer = null;
            channelState.channelSending = false;
            updateChannelInputState();
        }
    }

    /**
     * 获取或创建频道追踪容器
     * 用于存放一系列相关的工具调用和响应
     * 
     * @param {Object} msg - 消息对象
     * @returns {HTMLElement} 追踪容器元素
     */
    function getOrCreateChannelTraceContainer(msg) {
        // 如果已有连接的容器，直接返回
        if (activeChannelTraceContainer?.isConnected) {
            return activeChannelTraceContainer;
        }

        // 创建新的追踪容器
        const div = document.createElement('div');
        div.className = 'message message-assistant message-trace';
        div.innerHTML = `
            <div class="message-header">
                <span class="message-role">${window.OpenClawI18n ? window.OpenClawI18n.t('chat.roleAssistant') : 'Assistant'}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="trace-body"></div>
        `;

        elements.channelMessages.appendChild(div);
        activeChannelTraceContainer = div;
        return div;
    }

    /**
     * 滚动频道消息到底部
     * 将消息容器的滚动条滚动到最底部
     */
    function scrollChannelToBottom() {
        if (!elements.channelMessages) return;
        elements.channelMessages.scrollTop = elements.channelMessages.scrollHeight;
    }

    /**
     * 显示频道错误信息
     * 在消息区域显示错误提示
     * 
     * @param {string} msg - 错误消息内容
     */
    function showChannelError(msg) {
        if (!elements.channelMessages) return;
        window.OpenClawPanelFeedback.showChatError(elements.channelMessages, msg, scrollChannelToBottom);
    }

    // ===== Message Handlers =====
    // 消息处理器

    /**
     * 处理频道树加载完成消息
     * 
     * @param {Object} message - 消息对象，包含频道树数据
     */
    function handleChannelsLoadedV2(message) {
        renderChannelTree(message, message.selectedChannelId);
    }

    /**
     * 处理频道树更新消息
     * 
     * @param {Object} message - 消息对象，包含更新后的频道数据
     */
    function handleChannelTreeUpdate(message) {
        channelState.channels = message.channels || [];
        channelState.channelTree = message.tree || null;
        renderChannelList();
    }

    /**
     * 处理频道展开/折叠消息
     * 
     * @param {Object} message - 消息对象，包含展开状态
     * @param {string} message.channelId - 频道ID
     * @param {boolean} message.expanded - 是否展开
     */
    function handleChannelExpanded(message) {
        if (message.expanded) {
            channelState.expandedIds.add(message.channelId);
        } else {
            channelState.expandedIds.delete(message.channelId);
        }
        renderChannelList();
    }

    // ===== Initialization =====
    // 初始化

    /**
     * 初始化频道V2模块
     * 注册消息处理器并暴露公共API
     */
    function initChannelsV2() {
        // 注册消息处理器
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
                // 其他消息处理器...
            }
        });

        // 向panel.js暴露公共函数
        window.OpenClawChannelsV2 = {
            renderChannelTree,
            startNewChannelDraft,
            selectChannel,
            saveChannelConfig,
            sendChannelMessage,
            stopChannelRun,
        };
    }

    // 初始化模块
    initChannelsV2();
})();
