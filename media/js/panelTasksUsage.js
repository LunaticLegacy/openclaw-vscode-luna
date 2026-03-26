// OpenClaw Luna - Panel Tasks and Usage
// 任务和用量统计模块 - 处理任务管理、用量统计、频道分析等功能
'use strict';

    /**
     * 填充任务代理选项下拉框
     * @param {string} [selectedAgentId] - 当前选中的代理ID
     * @returns {void}
     */
    function populateTaskAgentOptions(selectedAgentId) {
        const select = document.getElementById('task-agent-id');
        if (!select) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 默认选项：使用系统默认代理
        const options = [{
            value: '',
            label: t('tasks.form.agentDefault')
        }];

        // 添加所有代理作为选项
        state.agents.forEach(agent => {
            options.push({
                value: agent.id,
                label: `${agent.name} (${agent.model})`
            });
        });

        // 如果选中的代理ID不在列表中，添加一个占位选项（可能代理已被删除）
        if (selectedAgentId && !options.some(option => option.value === selectedAgentId)) {
            options.push({
                value: selectedAgentId,
                label: selectedAgentId
            });
        }

        // 渲染选项
        select.innerHTML = options.map(option => `
            <option value="${escapeHtml(option.value)}"${option.value === (selectedAgentId || '') ? ' selected' : ''}>
                ${escapeHtml(option.label)}
            </option>
        `).join('');
    }

    /**
     * 提取任务内容
     * 根据任务负载类型提取显示文本
     * @param {Object} task - 任务对象
     * @returns {string} 任务内容文本
     */
    function extractTaskContent(task) {
        if (!task || !task.payload) {
            return '';
        }

        // 系统事件类型任务显示text字段，其他类型显示message字段
        return task.payload.kind === 'systemEvent'
            ? (task.payload.text || '')
            : (task.payload.message || '');
    }

    /**
     * 格式化任务调度信息
     * @param {Object} task - 任务对象
     * @returns {string} 格式化的调度信息字符串
     */
    function formatTaskSchedule(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!task || !task.schedule) {
            return '-';
        }

        // 定时执行（指定时间点）
        if (task.schedule.kind === 'at') {
            return `${t('tasks.form.scheduleAt')}: ${formatTaskDateTime(task.schedule.at)}`;
        }

        // Cron表达式执行
        if (task.schedule.kind === 'cron') {
            return task.schedule.tz
                ? `${task.schedule.expr} (${task.schedule.tz})`
                : task.schedule.expr;
        }

        // 定期执行（间隔毫秒数）
        return formatEveryDuration(task.schedule.everyMs);
    }

    /**
     * 将毫秒数格式化为人类可读的持续时间
     * @param {number} value - 毫秒数
     * @returns {string} 格式化后的持续时间字符串（如"1d"、"2h"、"30m"）
     */
    function formatEveryDuration(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '-';
        }

        // 按天、小时、分钟、秒、毫秒依次转换
        if (value % 86400000 === 0) {
            return `${value / 86400000}d`;
        }

        if (value % 3600000 === 0) {
            return `${value / 3600000}h`;
        }

        if (value % 60000 === 0) {
            return `${value / 60000}m`;
        }

        if (value % 1000 === 0) {
            return `${value / 1000}s`;
        }

        return `${value}ms`;
    }

    /**
     * 将日期值转换为datetime-local输入框的格式
     * @param {string|number|Date} value - 日期值
     * @returns {string} datetime-local格式字符串（YYYY-MM-DDTHH:mm）
     */
    function toDateTimeLocalValue(value) {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        // 构建datetime-local格式
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    /**
     * 渲染任务列表
     * @param {Array<Object>} tasks - 任务数组
     * @param {boolean} [available=true] - 任务功能是否可用
     * @param {string} [message] - 不可用时的提示消息
     * @param {string} [sourcePath] - 任务源文件路径
     * @returns {void}
     */
    function renderTasks(tasks, available = state.tasksAvailable, message = state.tasksMessage, sourcePath = state.tasksSourcePath) {
        // 更新状态
        state.tasks = Array.isArray(tasks) ? tasks : [];
        state.tasksAvailable = available !== false;
        state.tasksLoaded = true;
        state.tasksMessage = message || '';
        state.tasksSourcePath = sourcePath || '';
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        // 更新创建任务按钮状态
        if (elements.btnCreateTask) {
            elements.btnCreateTask.disabled = !state.tasksAvailable;
            elements.btnCreateTask.title = state.tasksAvailable
                ? ''
                : resolveCapabilityUnavailableMessage('scheduledTasks');
        }

        // 显示任务源路径
        if (elements.tasksSource) {
            elements.tasksSource.textContent = state.tasksSourcePath
                ? `${t('tasks.source')}: ${state.tasksSourcePath}`
                : '';
        }

        // 如果任务列表元素不存在，只更新控制台概览
        if (!elements.tasksList) {
            renderConsoleOverview();
            return;
        }

        // 功能不可用时显示提示
        if (!state.tasksAvailable) {
            elements.tasksList.innerHTML = `
                <div class="task-card unavailable">
                    <div class="task-summary">
                        <div class="task-summary-label">${escapeHtml(t('tasks.status.label'))}</div>
                        <div class="task-summary-text">${escapeHtml(state.tasksMessage || t('tasks.unavailable'))}</div>
                    </div>
                </div>
            `;
            renderConsoleOverview();
            return;
        }

        // 空任务列表状态
        if (state.tasks.length === 0) {
            elements.tasksList.innerHTML = `<div class="empty">${t('tasks.empty')}</div>`;
            renderConsoleOverview();
            return;
        }

        // 渲染任务卡片列表
        elements.tasksList.innerHTML = state.tasks.map(task => renderTaskCard(task)).join('');
        renderConsoleOverview();
    }

    /**
     * 渲染单个任务卡片
     * @param {Object} task - 任务对象
     * @returns {string} 任务卡片的HTML字符串
     */
    function renderTaskCard(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 确定任务显示状态
        const effectiveStatus = task.enabled ? (task.lastRunStatus || 'idle') : 'disabled';
        const targetLabel = resolveTaskAgentLabel(task.agentId);
        const scheduleLabel = formatTaskSchedule(task);
        const nextRunLabel = task.enabled && task.nextRunAt
            ? formatTaskDateTime(task.nextRunAt)
            : t('tasks.status.disabled');
        const lastRunLabel = task.lastRunAt
            ? formatTaskDateTime(task.lastRunAt)
            : '-';
        const resultText = task.lastError || task.lastRunSummary || '-';
        const payloadKindLabel = task.payload?.kind === 'systemEvent'
            ? t('tasks.form.payloadSystemEvent')
            : t('tasks.form.payloadAgentTurn');
        const resultTitle = task.lastError
            ? t('tasks.lastError', { error: '' }).replace(/:\s*$/, '')
            : t('tasks.lastResult', { summary: '' }).replace(/:\s*$/, '');
        
        return `
            <div class="task-card ${escapeHtml(effectiveStatus)}">
                <div class="task-card-header">
                    <div class="task-card-title-wrap">
                        <h4>${escapeHtml(task.name)}</h4>
                        <div class="task-card-target">${escapeHtml(targetLabel)}</div>
                    </div>
                    <span class="task-status ${escapeHtml(effectiveStatus)}">${escapeHtml(t(`tasks.status.${effectiveStatus}`))}</span>
                </div>
                ${task.description ? `
                    <div class="task-summary">
                        <div class="task-summary-label">${escapeHtml(t('tasks.description'))}</div>
                        <div class="task-summary-text">${escapeHtml(task.description)}</div>
                    </div>
                ` : ''}
                <div class="task-meta">
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.schedule'))}</div>
                        <div class="task-meta-value">${escapeHtml(scheduleLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.nextRunAt', { time: '' }).replace(/:\s*$/, ''))}</div>
                        <div class="task-meta-value">${escapeHtml(nextRunLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.lastRunAt', { time: '' }).replace(/:\s*$/, ''))}</div>
                        <div class="task-meta-value">${escapeHtml(lastRunLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.target'))}</div>
                        <div class="task-meta-value">${escapeHtml(targetLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.payloadKind'))}</div>
                        <div class="task-meta-value">${escapeHtml(payloadKindLabel)}</div>
                    </div>
                    <div class="task-meta-item">
                        <div class="task-meta-label">${escapeHtml(t('tasks.wakeMode'))}</div>
                        <div class="task-meta-value">${escapeHtml(t(task.wakeMode === 'next-heartbeat' ? 'tasks.form.wakeModeNextHeartbeat' : 'tasks.form.wakeModeNow'))}</div>
                    </div>
                </div>
                <div class="task-summary">
                    <div class="task-summary-label">${escapeHtml(resultTitle)}</div>
                    <div class="task-summary-text">${escapeHtml(resultText)}</div>
                </div>
                <details class="task-prompt">
                    <summary>${escapeHtml(t('tasks.form.content'))}</summary>
                    <pre>${escapeHtml(extractTaskContent(task) || '-')}</pre>
                </details>
                <div class="task-actions">
                    <button class="btn btn-small" data-task-action="run" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('tasks.runNow'))}</button>
                    <button class="btn btn-small" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('common.edit'))}</button>
                    <button class="btn btn-small btn-secondary" data-task-action="toggle" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.enabled ? t('tasks.disable') : t('tasks.enable'))}</button>
                    <button class="btn btn-small btn-secondary" data-task-action="delete" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t('common.delete'))}</button>
                </div>
            </div>
        `;
    }

    /**
     * 解析遗留任务目标标签（兼容旧格式）
     * @param {Object} task - 任务对象
     * @returns {string} 目标标签字符串
     */
    function resolveLegacyTaskTargetLabel(task) {
        if (!task) {
            return '-';
        }

        // 集群目标
        if (task.targetType === 'cluster') {
            const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
            const cluster = state.clusters.find(item => item.id === task.targetId);
            const clusterName = cluster ? cluster.name : task.targetId;
            const modeKey = task.action === 'collaborate'
                ? 'tasks.form.actionCollaborate'
                : 'tasks.form.actionBroadcast';
            return `${clusterName} · ${t(modeKey)}`;
        }

        return resolveAgentLabel(task.targetId);
    }

    /**
     * 解析任务目标标签
     * @param {Object} task - 任务对象
     * @returns {string} 目标标签字符串
     */
    function resolveTaskTargetLabel(task) {
        return resolveTaskAgentLabel(task?.agentId);
    }

    /**
     * 切换任务启用/禁用状态
     * @param {string} taskId - 任务ID
     * @returns {void}
     */
    function toggleTask(taskId) {
        const task = state.tasks.find(item => item.id === taskId);
        vscode.postMessage({
            type: 'toggleTask',
            taskId,
            enabled: task ? !task.enabled : undefined
        });
    }

    /**
     * 立即运行任务
     * @param {string} taskId - 任务ID
     * @returns {void}
     */
    function runTask(taskId) {
        vscode.postMessage({
            type: 'runTask',
            taskId
        });
    }

    /**
     * 删除任务
     * @param {string} taskId - 任务ID
     * @returns {void}
     */
    function deleteTask(taskId) {
        vscode.postMessage({
            type: 'deleteTask',
            taskId
        });
    }

    /**
     * 格式化任务日期时间
     * @param {string|number|Date} value - 日期值
     * @returns {string} 本地化日期时间字符串
     */
    function formatTaskDateTime(value) {
        if (!value) {
            return '-';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString();
    }

    /**
     * 渲染用量统计
     * @param {Object} usage - 用量数据对象
     * @returns {void}
     */
    function renderUsage(usage) {
        state.latestUsage = usage || null;
        
        // 构建用量时间窗口数据
        const usageWindow = buildUsageWindow(state.latestUsage, state.usagePeriodDays);
        
        // 获取显示元素
        const requestsEl = document.getElementById('usage-requests');
        const tokensEl = document.getElementById('usage-tokens');
        const costEl = document.getElementById('usage-cost');
        
        // 翻译函数（处理带变量的翻译）
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        // 更新概览数值
        if (requestsEl) requestsEl.textContent = usageWindow.totalRequests.toLocaleString();
        if (tokensEl) tokensEl.textContent = formatCompactNumber(usageWindow.totalTokens);
        if (costEl) costEl.textContent = formatUsageCurrency(usageWindow.totalCost, usageWindow.currencySymbol);

        // 更新时间段按钮激活状态
        if (elements.usagePeriodButtons) {
            elements.usagePeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-usage-period')) === state.usagePeriodDays);
            });
        }
        
        // 更新标题和说明文字
        if (elements.usagePeriodCaption) {
            elements.usagePeriodCaption.textContent = t('usage.showingPeriod', { days: state.usagePeriodDays });
        }
        if (elements.usageChartTitle) {
            elements.usageChartTitle.textContent = t('usage.dailyUsagePeriod', { days: state.usagePeriodDays });
        }
        if (elements.modelChartTitle) {
            elements.modelChartTitle.textContent = t('usage.byModelPeriod', { days: state.usagePeriodDays });
        }

        // 渲染每日用量柱状图
        const chartContainer = document.getElementById('usage-chart');
        if (chartContainer) {
            const maxTokens = usageWindow.days.reduce((max, [, data]) => Math.max(max, data.tokens || 0), 0);
            const hasUsageData = usageWindow.days.some(([, data]) => (data.tokens || 0) > 0 || (data.requests || 0) > 0 || (data.cost || 0) > 0);
            
            if (hasUsageData) {
                chartContainer.innerHTML = usageWindow.days.map(([date, data]) => `
                    <div class="bar-item">
                        <div
                            class="bar"
                            style="height: ${computeUsageBarHeight(data.tokens || 0, maxTokens)}px"
                            title="${escapeHtml(buildDailyUsageBarTooltip(t, date, data, usageWindow.currencySymbol))}"
                            aria-label="${escapeHtml(buildDailyUsageBarTooltip(t, date, data, usageWindow.currencySymbol))}"
                        ></div>
                        <div class="bar-label">${date.slice(5)}</div>
                    </div>
                `).join('');
            } else {
                chartContainer.innerHTML = `<div class="empty">${escapeHtml(t('usage.noData'))}</div>`;
            }
        }

        // 渲染模型用量分布图
        const modelChart = document.getElementById('model-chart');
        if (modelChart) {
            const models = Object.entries(usageWindow.byModel || {}).sort(([, left], [, right]) => (right.tokens || 0) - (left.tokens || 0));
            if (models.length > 0 && usageWindow.totalTokens > 0) {
                modelChart.innerHTML = models.map(([model, data]) => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(model)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((data.tokens || 0) / usageWindow.totalTokens * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${formatCompactNumber(data.tokens || 0)} tokens</div>
                    </div>
                `).join('');
            } else {
                modelChart.innerHTML = `<div class="empty">${escapeHtml(t('usage.noModelData'))}</div>`;
            }
        }
    }

    /**
     * 渲染频道统计
     * @param {Object} usage - 用量数据对象（包含频道信息）
     * @returns {void}
     */
    function renderChannel(usage) {
        state.latestUsage = usage || null;
        
        // 构建频道时间窗口数据
        const channelWindow = buildChannelWindow(state.latestUsage, state.channelPeriodDays);
        
        // 获取显示元素
        const activeCountEl = document.getElementById('channel-active-count');
        const topNameEl = document.getElementById('channel-top-name');
        const topTokensEl = document.getElementById('channel-top-tokens');
        const topRequestsEl = document.getElementById('channel-top-requests');
        
        // 翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        // 更新概览数值
        if (activeCountEl) activeCountEl.textContent = channelWindow.totalChannels.toLocaleString();
        if (topNameEl) topNameEl.textContent = channelWindow.dominantChannel || t('channel.none');
        if (topTokensEl) topTokensEl.textContent = formatCompactNumber(channelWindow.dominantTokens);
        if (topRequestsEl) topRequestsEl.textContent = channelWindow.dominantRequests.toLocaleString();

        // 更新时间段按钮激活状态
        if (elements.channelPeriodButtons) {
            elements.channelPeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-channel-period')) === state.channelPeriodDays);
            });
        }
        
        // 更新标题和说明文字
        if (elements.channelPeriodCaption) {
            elements.channelPeriodCaption.textContent = t('channel.showingPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelChartTitle) {
            elements.channelChartTitle.textContent = t('channel.byTokensPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelRequestsTitle) {
            elements.channelRequestsTitle.textContent = t('channel.byRequestsPeriod', { days: state.channelPeriodDays });
        }

        // 渲染频道Token用量分布图
        const channelChart = document.getElementById('channel-chart');
        if (channelChart) {
            if (channelWindow.channels.length > 0 && channelWindow.totalTokens > 0) {
                channelChart.innerHTML = channelWindow.channels.map(channel => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(channel.channel)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((channel.tokens || 0) / channelWindow.totalTokens * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${formatCompactNumber(channel.tokens || 0)} tokens</div>
                    </div>
                `).join('');
            } else {
                channelChart.innerHTML = `<div class="empty">${escapeHtml(t('channel.noData'))}</div>`;
            }
        }

        // 渲染频道请求量分布图
        const requestsChart = document.getElementById('channel-requests-chart');
        if (requestsChart) {
            if (channelWindow.channels.length > 0 && channelWindow.totalRequests > 0) {
                requestsChart.innerHTML = channelWindow.channels.map(channel => `
                    <div class="model-item">
                        <div class="model-name">${escapeHtml(channel.channel)}</div>
                        <div class="model-bar-container">
                            <div class="model-bar" style="width: ${Math.min((channel.requests || 0) / channelWindow.totalRequests * 100, 100)}%"></div>
                        </div>
                        <div class="model-value">${(channel.requests || 0).toLocaleString()} req</div>
                    </div>
                `).join('');
            } else {
                requestsChart.innerHTML = `<div class="empty">${escapeHtml(t('channel.noData'))}</div>`;
            }
        }
    }

    /**
     * 构建每日用量柱状图的提示文本
     * @param {Function} t - 翻译函数
     * @param {string} date - 日期字符串
     * @param {Object} data - 用量数据
     * @param {string} currencySymbol - 货币符号
     * @returns {string} 提示文本
     */
    function buildDailyUsageBarTooltip(t, date, data, currencySymbol) {
        return [
            date,
            `${t('usage.totalTokens')}: ${(data.tokens || 0).toLocaleString()}`,
            `${t('usage.totalRequests')}: ${(data.requests || 0).toLocaleString()}`,
            `${t('usage.estimatedCost')}: ${formatUsageCurrency(data.cost || 0, currencySymbol)}`
        ].join(' • ');
    }

    /**
     * 设置用量统计时间段
     * @param {number} days - 天数（7或30）
     * @returns {void}
     */
    function setUsagePeriod(days) {
        if ((days !== 7 && days !== 30) || state.usagePeriodDays === days) {
            return;
        }

        state.usagePeriodDays = days;
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
    }

    /**
     * 设置频道统计时间段
     * @param {number} days - 天数（7或30）
     * @returns {void}
     */
    function setChannelPeriod(days) {
        if ((days !== 7 && days !== 30) || state.channelPeriodDays === days) {
            return;
        }

        state.channelPeriodDays = days;
        if (state.latestUsage) {
            renderChannel(state.latestUsage);
        }
    }

    /**
     * 构建用量时间窗口数据
     * 委托给通用模块处理
     * @param {Object} usage - 用量数据
     * @param {number} days - 天数
     * @returns {Object} 用量窗口数据
     */
    function buildUsageWindow(usage, days) {
        return window.OpenClawPanelCommon.buildUsageWindow(usage, days);
    }

    /**
     * 构建频道时间窗口数据
     * 委托给通用模块处理
     * @param {Object} usage - 用量数据
     * @param {number} days - 天数
     * @returns {Object} 频道窗口数据
     */
    function buildChannelWindow(usage, days) {
        return window.OpenClawPanelCommon.buildChannelWindow(usage, days);
    }

    /**
     * 计算用量柱状图的高度
     * 委托给通用模块处理
     * @param {number} value - 当前值
     * @param {number} maxValue - 最大值
     * @returns {number} 计算后的高度（像素）
     */
    function computeUsageBarHeight(value, maxValue) {
        return window.OpenClawPanelCommon.computeUsageBarHeight(value, maxValue);
    }

    /**
     * 格式化紧凑数字（如1.2k、3.4M）
     * 委托给通用模块处理
     * @param {number} n - 数字
     * @returns {string} 格式化后的字符串
     */
    function formatCompactNumber(n) {
        return window.OpenClawPanelCommon.formatCompactNumber(n);
    }

    /**
     * 格式化用量货币
     * 委托给通用模块处理
     * @param {number} value - 金额值
     * @param {string} symbol - 货币符号
     * @returns {string} 格式化后的货币字符串
     */
    function formatUsageCurrency(value, symbol) {
        return window.OpenClawPanelCommon.formatUsageCurrency(value, symbol);
    }
