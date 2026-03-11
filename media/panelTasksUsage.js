// OpenClaw Luna - Panel Tasks and Usage
'use strict';

    function populateTaskAgentOptions(selectedAgentId) {
        const select = document.getElementById('task-agent-id');
        if (!select) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const options = [{
            value: '',
            label: t('tasks.form.agentDefault')
        }];

        state.agents.forEach(agent => {
            options.push({
                value: agent.id,
                label: `${agent.name} (${agent.model})`
            });
        });

        if (selectedAgentId && !options.some(option => option.value === selectedAgentId)) {
            options.push({
                value: selectedAgentId,
                label: selectedAgentId
            });
        }

        select.innerHTML = options.map(option => `
            <option value="${escapeHtml(option.value)}"${option.value === (selectedAgentId || '') ? ' selected' : ''}>
                ${escapeHtml(option.label)}
            </option>
        `).join('');
    }

    function extractTaskContent(task) {
        if (!task || !task.payload) {
            return '';
        }

        return task.payload.kind === 'systemEvent'
            ? (task.payload.text || '')
            : (task.payload.message || '');
    }

    function formatTaskSchedule(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        if (!task || !task.schedule) {
            return '-';
        }

        if (task.schedule.kind === 'at') {
            return `${t('tasks.form.scheduleAt')}: ${formatTaskDateTime(task.schedule.at)}`;
        }

        if (task.schedule.kind === 'cron') {
            return task.schedule.tz
                ? `${task.schedule.expr} (${task.schedule.tz})`
                : task.schedule.expr;
        }

        return formatEveryDuration(task.schedule.everyMs);
    }

    function formatEveryDuration(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '-';
        }

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

    function toDateTimeLocalValue(value) {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    function renderTasks(tasks, available = state.tasksAvailable, message = state.tasksMessage, sourcePath = state.tasksSourcePath) {
        state.tasks = Array.isArray(tasks) ? tasks : [];
        state.tasksAvailable = available !== false;
        state.tasksLoaded = true;
        state.tasksMessage = message || '';
        state.tasksSourcePath = sourcePath || '';
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;

        if (elements.btnCreateTask) {
            elements.btnCreateTask.disabled = !state.tasksAvailable;
            elements.btnCreateTask.title = state.tasksAvailable
                ? ''
                : resolveCapabilityUnavailableMessage('scheduledTasks');
        }

        if (elements.tasksSource) {
            elements.tasksSource.textContent = state.tasksSourcePath
                ? `${t('tasks.source')}: ${state.tasksSourcePath}`
                : '';
        }

        if (!elements.tasksList) {
            renderConsoleOverview();
            return;
        }

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

        if (state.tasks.length === 0) {
            elements.tasksList.innerHTML = `<div class="empty">${t('tasks.empty')}</div>`;
            renderConsoleOverview();
            return;
        }

        elements.tasksList.innerHTML = state.tasks.map(task => renderTaskCard(task)).join('');
        renderConsoleOverview();
    }

    function renderTaskCard(task) {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
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

    function resolveLegacyTaskTargetLabel(task) {
        if (!task) {
            return '-';
        }

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

    function resolveTaskTargetLabel(task) {
        return resolveTaskAgentLabel(task?.agentId);
    }

    function toggleTask(taskId) {
        const task = state.tasks.find(item => item.id === taskId);
        vscode.postMessage({
            type: 'toggleTask',
            taskId,
            enabled: task ? !task.enabled : undefined
        });
    }

    function runTask(taskId) {
        vscode.postMessage({
            type: 'runTask',
            taskId
        });
    }

    function deleteTask(taskId) {
        vscode.postMessage({
            type: 'deleteTask',
            taskId
        });
    }

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

    // Render usage
    function renderUsage(usage) {
        state.latestUsage = usage || null;
        const usageWindow = buildUsageWindow(state.latestUsage, state.usagePeriodDays);
        const requestsEl = document.getElementById('usage-requests');
        const tokensEl = document.getElementById('usage-tokens');
        const costEl = document.getElementById('usage-cost');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        if (requestsEl) requestsEl.textContent = usageWindow.totalRequests.toLocaleString();
        if (tokensEl) tokensEl.textContent = formatCompactNumber(usageWindow.totalTokens);
        if (costEl) costEl.textContent = formatUsageCurrency(usageWindow.totalCost, usageWindow.currencySymbol);

        if (elements.usagePeriodButtons) {
            elements.usagePeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-usage-period')) === state.usagePeriodDays);
            });
        }
        if (elements.usagePeriodCaption) {
            elements.usagePeriodCaption.textContent = t('usage.showingPeriod', { days: state.usagePeriodDays });
        }
        if (elements.usageChartTitle) {
            elements.usageChartTitle.textContent = t('usage.dailyUsagePeriod', { days: state.usagePeriodDays });
        }
        if (elements.modelChartTitle) {
            elements.modelChartTitle.textContent = t('usage.byModelPeriod', { days: state.usagePeriodDays });
        }

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

    function renderChannel(usage) {
        state.latestUsage = usage || null;
        const channelWindow = buildChannelWindow(state.latestUsage, state.channelPeriodDays);
        const activeCountEl = document.getElementById('channel-active-count');
        const topNameEl = document.getElementById('channel-top-name');
        const topTokensEl = document.getElementById('channel-top-tokens');
        const topRequestsEl = document.getElementById('channel-top-requests');
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key, vars) => {
            if (vars && typeof vars.days !== 'undefined') {
                return `${key} ${vars.days}`;
            }
            return key;
        };

        if (activeCountEl) activeCountEl.textContent = channelWindow.totalChannels.toLocaleString();
        if (topNameEl) topNameEl.textContent = channelWindow.dominantChannel || t('channel.none');
        if (topTokensEl) topTokensEl.textContent = formatCompactNumber(channelWindow.dominantTokens);
        if (topRequestsEl) topRequestsEl.textContent = channelWindow.dominantRequests.toLocaleString();

        if (elements.channelPeriodButtons) {
            elements.channelPeriodButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.getAttribute('data-channel-period')) === state.channelPeriodDays);
            });
        }
        if (elements.channelPeriodCaption) {
            elements.channelPeriodCaption.textContent = t('channel.showingPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelChartTitle) {
            elements.channelChartTitle.textContent = t('channel.byTokensPeriod', { days: state.channelPeriodDays });
        }
        if (elements.channelRequestsTitle) {
            elements.channelRequestsTitle.textContent = t('channel.byRequestsPeriod', { days: state.channelPeriodDays });
        }

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

    function buildDailyUsageBarTooltip(t, date, data, currencySymbol) {
        return [
            date,
            `${t('usage.totalTokens')}: ${(data.tokens || 0).toLocaleString()}`,
            `${t('usage.totalRequests')}: ${(data.requests || 0).toLocaleString()}`,
            `${t('usage.estimatedCost')}: ${formatUsageCurrency(data.cost || 0, currencySymbol)}`
        ].join(' • ');
    }

    function setUsagePeriod(days) {
        if ((days !== 7 && days !== 30) || state.usagePeriodDays === days) {
            return;
        }

        state.usagePeriodDays = days;
        if (state.latestUsage) {
            renderUsage(state.latestUsage);
        }
    }

    function setChannelPeriod(days) {
        if ((days !== 7 && days !== 30) || state.channelPeriodDays === days) {
            return;
        }

        state.channelPeriodDays = days;
        if (state.latestUsage) {
            renderChannel(state.latestUsage);
        }
    }

    function buildUsageWindow(usage, days) {
        return window.OpenClawPanelCommon.buildUsageWindow(usage, days);
    }

    function buildChannelWindow(usage, days) {
        return window.OpenClawPanelCommon.buildChannelWindow(usage, days);
    }

    function computeUsageBarHeight(value, maxValue) {
        return window.OpenClawPanelCommon.computeUsageBarHeight(value, maxValue);
    }

    function formatCompactNumber(n) {
        return window.OpenClawPanelCommon.formatCompactNumber(n);
    }

    function formatUsageCurrency(value, symbol) {
        return window.OpenClawPanelCommon.formatUsageCurrency(value, symbol);
    }

