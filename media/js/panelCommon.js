/**
 * OpenClaw Luna - Panel Common Utilities
 * OpenClaw Luna 面板公共工具模块
 * 
 * 该模块提供面板中使用的各种公共工具函数，包括：
 * - HTML转义处理
 * - 使用率数据窗口构建
 * - 频道使用统计
 * - 数据聚合计算
 * - 数字和货币格式化
 */
(function() {
    'use strict';

    /**
     * 将文本中的HTML特殊字符转义为安全字符串
     * 用于防止XSS攻击，将 < > & " 等字符转换为对应的HTML实体
     * 
     * @param {string} text - 需要转义的原始文本
     * @returns {string} 转义后的安全HTML字符串
     * @example
     * escapeHtml('<script>alert("xss")</script>') 
     * // 返回: '&lt;script&gt;alert("xss")&lt;/script&gt;'
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 构建使用率数据窗口
     * 根据指定的天数窗口聚合使用率统计数据
     * 
     * @param {Object} usage - 原始使用率数据对象
     * @param {number} usage.totalRequests - 总请求数
     * @param {number} usage.totalTokens - 总Token数
     * @param {number} usage.cost - 总成本
     * @param {string} usage.currencySymbol - 货币符号
     * @param {Object} usage.byDay - 按天统计的数据
     * @param {Object} usage.byModel - 按模型统计的数据
     * @param {Object} usage.byModelByDay - 按模型和天统计的数据
     * @param {number} days - 统计窗口天数（如7天或30天）
     * @returns {Object} 构建好的使用率窗口数据
     * @returns {Array} returns.days - 每天的统计数据数组 [date, data]
     * @returns {Object} returns.byModel - 按模型聚合的统计数据
     * @returns {string} returns.currencySymbol - 货币符号
     * @returns {number} returns.totalRequests - 总请求数
     * @returns {number} returns.totalTokens - 总Token数
     * @returns {number} returns.totalCost - 总成本
     */
    function buildUsageWindow(usage, days) {
        // 确保数据安全：提供默认值防止undefined错误
        const safeUsage = usage || {
            totalRequests: 0,
            totalTokens: 0,
            cost: 0,
            currencySymbol: '$',
            byDay: {},
            byModel: {},
            byModelByDay: {}
        };
        
        // 生成最近N天的日期键值数组
        const dayKeys = buildRecentDateKeys(days);
        
        // 将每天的日期键映射为包含实际数据的条目
        const dayEntries = dayKeys.map(date => {
            const data = safeUsage.byDay?.[date] || { requests: 0, tokens: 0, cost: 0 };
            return [date, data];
        });

        // 聚合所有天的总计数据
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

        // 返回完整的窗口统计数据
        return {
            days: dayEntries,
            byModel: aggregateUsageModelsByWindow(safeUsage, dayKeys),
            currencySymbol: safeUsage.currencySymbol || '$',
            ...totals
        };
    }

    /**
     * 构建频道使用统计窗口
     * 按频道聚合使用率数据并排序
     * 
     * @param {Object} usage - 原始使用率数据对象
     * @param {Object} usage.byChannel - 按频道统计的数据
     * @param {Object} usage.byChannelByDay - 按频道和天统计的数据
     * @param {number} days - 统计窗口天数
     * @returns {Object} 构建好的频道使用统计
     * @returns {Array} returns.channels - 频道统计数据数组，按Token使用量降序排序
     * @returns {number} returns.totalChannels - 频道总数
     * @returns {string} returns.dominantChannel - 使用量最大的频道名
     * @returns {number} returns.dominantRequests - 主导频道的请求数
     * @returns {number} returns.dominantTokens - 主导频道的Token数
     */
    function buildChannelWindow(usage, days) {
        // 确保数据安全
        const safeUsage = usage || {
            totalRequests: 0,
            totalTokens: 0,
            cost: 0,
            currencySymbol: '$',
            byDay: {},
            byChannel: {},
            byChannelByDay: {}
        };
        
        // 生成日期键值并聚合频道数据
        const dayKeys = buildRecentDateKeys(days);
        
        // 将聚合后的频道数据转换为数组并按使用量排序
        const channels = Object.entries(aggregateUsageChannelsByWindow(safeUsage, dayKeys))
            .map(([channel, data]) => ({
                channel,
                requests: data.requests || 0,
                tokens: data.tokens || 0,
                cost: data.cost || 0
            }))
            .sort((left, right) => {
                // 优先按Token使用量排序
                if (right.tokens !== left.tokens) {
                    return right.tokens - left.tokens;
                }
                // 其次按请求数排序
                if (right.requests !== left.requests) {
                    return right.requests - left.requests;
                }
                // 最后按成本排序
                return right.cost - left.cost;
            });

        // 计算所有频道的总计数据
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
            dominantChannel: channels[0]?.channel || '',  // 使用量最大的频道
            dominantRequests: channels[0]?.requests || 0,
            dominantTokens: channels[0]?.tokens || 0,
            currencySymbol: safeUsage.currencySymbol || '$',
            ...totals
        };
    }

    /**
     * 按时间窗口聚合模型使用数据
     * 优先使用byModelByDay数据（如果存在），否则回退到byModel
     * 
     * @param {Object} usage - 使用率数据对象
     * @param {Object} usage.byModelByDay - 按模型和天统计的详细数据
     * @param {Object} usage.byModel - 按模型统计的汇总数据
     * @param {string[]} dayKeys - 日期键值数组（格式：YYYY-MM-DD）
     * @returns {Object} 按模型聚合的统计数据 { modelName: { requests, tokens, cost } }
     */
    function aggregateUsageModelsByWindow(usage, dayKeys) {
        const aggregated = {};
        const byModelByDay = usage?.byModelByDay;

        // 如果有按天按模型的详细数据，则在指定窗口内聚合
        if (byModelByDay && Object.keys(byModelByDay).length > 0) {
            dayKeys.forEach(date => {
                const dayModels = byModelByDay[date] || {};
                Object.entries(dayModels).forEach(([model, data]) => {
                    // 初始化模型统计对象
                    if (!aggregated[model]) {
                        aggregated[model] = { requests: 0, tokens: 0, cost: 0 };
                    }

                    // 累加当天的数据
                    aggregated[model].requests += data.requests || 0;
                    aggregated[model].tokens += data.tokens || 0;
                    aggregated[model].cost += data.cost || 0;
                });
            });

            return aggregated;
        }

        // 如果没有按天数据，直接返回汇总数据
        return usage?.byModel || {};
    }

    /**
     * 按时间窗口聚合频道使用数据
     * 支持多种数据格式的回退策略
     * 
     * @param {Object} usage - 使用率数据对象
     * @param {Object} usage.byChannelByDay - 按频道和天统计的数据
     * @param {Object} usage.byChannel - 按频道统计的数据
     * @param {Object} usage.byDay - 按天统计的数据
     * @param {string[]} dayKeys - 日期键值数组
     * @returns {Object} 按频道聚合的统计数据
     */
    function aggregateUsageChannelsByWindow(usage, dayKeys) {
        const aggregated = {};
        const byChannelByDay = usage?.byChannelByDay;

        // 策略1：使用byChannelByDay详细数据进行窗口聚合
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

        // 策略2：使用byChannel汇总数据
        if (usage?.byChannel && Object.keys(usage.byChannel).length > 0) {
            return usage.byChannel;
        }

        // 策略3：从byDay数据计算回退值
        const fallbackTotals = Object.entries(usage?.byDay || {})
            .filter(([date]) => dayKeys.includes(date))
            .reduce((acc, [, data]) => {
                acc.requests += data.requests || 0;
                acc.tokens += data.tokens || 0;
                acc.cost += data.cost || 0;
                return acc;
            }, { requests: 0, tokens: 0, cost: 0 });

        // 如果有数据，将所有内容归为'chat'频道
        if (fallbackTotals.requests > 0 || fallbackTotals.tokens > 0 || fallbackTotals.cost > 0) {
            return { chat: fallbackTotals };
        }

        // 策略4：使用全局总计作为最后的回退
        if ((usage?.totalRequests || 0) > 0 || (usage?.totalTokens || 0) > 0 || (usage?.cost || 0) > 0) {
            return {
                chat: {
                    requests: usage.totalRequests || 0,
                    tokens: usage.totalTokens || 0,
                    cost: usage.cost || 0
                }
            };
        }

        // 没有任何数据时返回空对象
        return {};
    }

    /**
     * 构建最近N天的日期键值数组
     * 生成从今天往前推N天的日期字符串数组（格式：YYYY-MM-DD）
     * 
     * @param {number} days - 天数
     * @returns {string[]} 日期键值数组，按时间升序排列
     * @example
     * buildRecentDateKeys(3) 
     * // 假设今天是2024-01-15，返回: ['2024-01-13', '2024-01-14', '2024-01-15']
     */
    function buildRecentDateKeys(days) {
        const result = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);  // 清除时间部分，只保留日期

        // 从今天往前推(days-1)天，生成日期数组
        for (let offset = days - 1; offset >= 0; offset -= 1) {
            const date = new Date(today);
            date.setDate(today.getDate() - offset);
            result.push(formatLocalDateKey(date));
        }

        return result;
    }

    /**
     * 将Date对象格式化为本地日期键值字符串
     * 格式：YYYY-MM-DD
     * 
     * @param {Date} date - Date对象
     * @returns {string} 格式化后的日期字符串
     */
    function formatLocalDateKey(date) {
        const year = date.getFullYear();
        // 月份和日期需要补零
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 计算使用率柱状图的高度
     * 将数值映射到0-120px的高度范围内，最小高度为4px
     * 
     * @param {number} value - 当前值
     * @param {number} maxValue - 最大值（用于归一化）
     * @returns {number} 计算后的高度（像素值）
     */
    function computeUsageBarHeight(value, maxValue) {
        // 无最大值或无效值时返回最小高度
        if (!maxValue || value <= 0) {
            return 4;
        }

        // 计算比例并限制在4-120px范围内
        return Math.max(4, Math.min((value / maxValue) * 120, 120));
    }

    /**
     * 将大数字格式化为紧凑表示
     * 超过1000显示为K，超过1000000显示为M
     * 
     * @param {number} n - 需要格式化的数字
     * @returns {string} 格式化后的字符串
     * @example
     * formatCompactNumber(1500)   // '1.5K'
     * formatCompactNumber(2500000) // '2.5M'
     * formatCompactNumber(999)    // '999'
     */
    function formatCompactNumber(n) {
        return n >= 1000000 
            ? (n / 1000000).toFixed(1) + 'M' 
            : n >= 1000 
                ? (n / 1000).toFixed(1) + 'K' 
                : String(n);
    }

    /**
     * 格式化货币金额
     * 保留4位小数并添加货币符号
     * 
     * @param {number} value - 金额数值
     * @param {string} symbol - 货币符号（默认为$）
     * @returns {string} 格式化后的货币字符串
     * @example
     * formatUsageCurrency(12.3456, '$') // '$12.3456'
     */
    function formatUsageCurrency(value, symbol) {
        return `${symbol || '$'}${Number(value || 0).toFixed(4)}`;
    }

    /**
     * 将工具函数暴露到全局作用域
     * 通过window.OpenClawPanelCommon对象供其他模块使用
     */
    window.OpenClawPanelCommon = {
        escapeHtml,           // HTML转义
        buildUsageWindow,     // 构建使用率窗口
        buildChannelWindow,   // 构建频道使用窗口
        computeUsageBarHeight, // 计算柱状图高度
        formatCompactNumber,  // 格式化大数字
        formatUsageCurrency   // 格式化货币
    };
})();
