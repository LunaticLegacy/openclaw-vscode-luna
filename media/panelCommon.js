(function() {
    'use strict';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function buildUsageWindow(usage, days) {
        const safeUsage = usage || {
            totalRequests: 0,
            totalTokens: 0,
            cost: 0,
            currencySymbol: '$',
            byDay: {},
            byModel: {},
            byModelByDay: {}
        };
        const dayKeys = buildRecentDateKeys(days);
        const dayEntries = dayKeys.map(date => {
            const data = safeUsage.byDay?.[date] || { requests: 0, tokens: 0, cost: 0 };
            return [date, data];
        });

        const totals = dayEntries.reduce((acc, [, data]) => {
            acc.totalRequests += data.requests || 0;
            acc.totalTokens += data.tokens || 0;
            acc.totalCost += data.cost || 0;
            return acc;
        }, {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0
        });

        return {
            days: dayEntries,
            byModel: aggregateUsageModelsByWindow(safeUsage, dayKeys),
            currencySymbol: safeUsage.currencySymbol || '$',
            ...totals
        };
    }

    function buildChannelWindow(usage, days) {
        const safeUsage = usage || {
            totalRequests: 0,
            totalTokens: 0,
            cost: 0,
            currencySymbol: '$',
            byDay: {},
            byChannel: {},
            byChannelByDay: {}
        };
        const dayKeys = buildRecentDateKeys(days);
        const channels = Object.entries(aggregateUsageChannelsByWindow(safeUsage, dayKeys))
            .map(([channel, data]) => ({
                channel,
                requests: data.requests || 0,
                tokens: data.tokens || 0,
                cost: data.cost || 0
            }))
            .sort((left, right) => {
                if (right.tokens !== left.tokens) {
                    return right.tokens - left.tokens;
                }

                if (right.requests !== left.requests) {
                    return right.requests - left.requests;
                }

                return right.cost - left.cost;
            });

        const totals = channels.reduce((acc, channel) => {
            acc.totalRequests += channel.requests;
            acc.totalTokens += channel.tokens;
            acc.totalCost += channel.cost;
            return acc;
        }, {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0
        });

        return {
            channels,
            totalChannels: channels.length,
            dominantChannel: channels[0]?.channel || '',
            dominantRequests: channels[0]?.requests || 0,
            dominantTokens: channels[0]?.tokens || 0,
            currencySymbol: safeUsage.currencySymbol || '$',
            ...totals
        };
    }

    function aggregateUsageModelsByWindow(usage, dayKeys) {
        const aggregated = {};
        const byModelByDay = usage?.byModelByDay;

        if (byModelByDay && Object.keys(byModelByDay).length > 0) {
            dayKeys.forEach(date => {
                const dayModels = byModelByDay[date] || {};
                Object.entries(dayModels).forEach(([model, data]) => {
                    if (!aggregated[model]) {
                        aggregated[model] = { requests: 0, tokens: 0, cost: 0 };
                    }

                    aggregated[model].requests += data.requests || 0;
                    aggregated[model].tokens += data.tokens || 0;
                    aggregated[model].cost += data.cost || 0;
                });
            });

            return aggregated;
        }

        return usage?.byModel || {};
    }

    function aggregateUsageChannelsByWindow(usage, dayKeys) {
        const aggregated = {};
        const byChannelByDay = usage?.byChannelByDay;

        if (byChannelByDay && Object.keys(byChannelByDay).length > 0) {
            dayKeys.forEach(date => {
                const dayChannels = byChannelByDay[date] || {};
                Object.entries(dayChannels).forEach(([channel, data]) => {
                    if (!aggregated[channel]) {
                        aggregated[channel] = { requests: 0, tokens: 0, cost: 0 };
                    }

                    aggregated[channel].requests += data.requests || 0;
                    aggregated[channel].tokens += data.tokens || 0;
                    aggregated[channel].cost += data.cost || 0;
                });
            });

            return aggregated;
        }

        if (usage?.byChannel && Object.keys(usage.byChannel).length > 0) {
            return usage.byChannel;
        }

        const fallbackTotals = Object.entries(usage?.byDay || {})
            .filter(([date]) => dayKeys.includes(date))
            .reduce((acc, [, data]) => {
                acc.requests += data.requests || 0;
                acc.tokens += data.tokens || 0;
                acc.cost += data.cost || 0;
                return acc;
            }, { requests: 0, tokens: 0, cost: 0 });

        if (fallbackTotals.requests > 0 || fallbackTotals.tokens > 0 || fallbackTotals.cost > 0) {
            return { chat: fallbackTotals };
        }

        if ((usage?.totalRequests || 0) > 0 || (usage?.totalTokens || 0) > 0 || (usage?.cost || 0) > 0) {
            return {
                chat: {
                    requests: usage.totalRequests || 0,
                    tokens: usage.totalTokens || 0,
                    cost: usage.cost || 0
                }
            };
        }

        return {};
    }

    function buildRecentDateKeys(days) {
        const result = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let offset = days - 1; offset >= 0; offset -= 1) {
            const date = new Date(today);
            date.setDate(today.getDate() - offset);
            result.push(formatLocalDateKey(date));
        }

        return result;
    }

    function formatLocalDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function computeUsageBarHeight(value, maxValue) {
        if (!maxValue || value <= 0) {
            return 4;
        }

        return Math.max(4, Math.min((value / maxValue) * 120, 120));
    }

    function formatCompactNumber(n) {
        return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
    }

    function formatUsageCurrency(value, symbol) {
        return `${symbol || '$'}${Number(value || 0).toFixed(4)}`;
    }

    window.OpenClawPanelCommon = {
        escapeHtml,
        buildUsageWindow,
        buildChannelWindow,
        computeUsageBarHeight,
        formatCompactNumber,
        formatUsageCurrency
    };
})();
