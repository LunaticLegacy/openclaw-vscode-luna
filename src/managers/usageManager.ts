import { OpenClawService, APIUsage } from '../services/openclawService';
import { EventEmitter } from 'events';
import { formatLocalDateKey } from '../utils/dateKey';

/**
 * 使用统计指标接口
 */
export interface UsageMetrics {
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
    requestsToday: number;
    tokensToday: number;
}

/**
 * 使用趋势接口
 */
export interface UsageTrend {
    date: string;
    requests: number;
    tokens: number;
    cost: number;
}

/**
 * 使用量管理器，负责管理 API 使用统计和缓存
 * 
 * @emits usageUpdated - 当使用数据更新时触发
 * @emits usageInvalidated - 当缓存失效时触发
 * 
 * @example
 * ```typescript
 * const manager = new UsageManager(service);
 * const usage = await manager.getUsage();
 * const metrics = manager.getMetrics();
 * ```
 */
export class UsageManager extends EventEmitter {
    private service: OpenClawService; // OpenClaw 服务实例
    private cachedUsage: APIUsage | undefined = undefined; // 缓存的使用量数据
    private lastFetch: number = 0; // 最近一次拉取时间戳
    private cacheDuration: number = 60000; // 缓存有效期（毫秒）
    private readonly handleUsageChanged = () => this.invalidate(); // 使用量变更事件处理器
    private readonly handleConnectionChange = () => this.invalidate(); // 连接状态变更处理器

    /**
     * 创建 UsageManager 实例
     * @param service - OpenClaw 服务实例
     */
    constructor(service: OpenClawService) {
        super();
        this.service = service;
        this.service.on('usageChanged', this.handleUsageChanged);
        this.service.on('connectionChange', this.handleConnectionChange);
    }

    /**
     * 获取使用量数据
     * 
     * @param forceRefresh - 是否强制刷新缓存
     * @returns API 使用量数据
     */
    public async getUsage(forceRefresh: boolean = false): Promise<APIUsage> {
        const now = Date.now();
        
        if (!forceRefresh && this.cachedUsage && (now - this.lastFetch) < this.cacheDuration) {
            return this.cachedUsage;
        }

        try {
            const usage = await this.service.getUsage();
            this.cachedUsage = usage;
            this.lastFetch = now;
            this.emit('usageUpdated', usage);
            return usage;
        } catch (error) {
            if (this.cachedUsage) {
                return this.cachedUsage;
            }
            throw error;
        }
    }

    /**
     * 获取实时指标
     * 
     * @returns 实时使用指标
     */
    public async getRealtimeMetrics(): Promise<{
        activeSessions: number;
        requestsPerMinute: number;
        tokensPerMinute: number;
    }> {
        return this.service.getRealtimeUsage();
    }

    /**
     * 获取指定智能体的使用量
     * 
     * @param agentId - 智能体ID
     * @returns 该智能体的使用量数据
     */
    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        return this.service.getUsageByAgent(agentId);
    }

    /**
     * 获取汇总指标
     * 
     * @returns 使用统计指标
     */
    public getMetrics(): UsageMetrics {
        if (!this.cachedUsage) {
            return {
                totalRequests: 0,
                totalTokens: 0,
                promptTokens: 0,
                completionTokens: 0,
                estimatedCost: 0,
                requestsToday: 0,
                tokensToday: 0
            };
        }

        const usage = this.cachedUsage;
        const today = formatLocalDateKey();
        const todayStats = usage.byDay[today] || { requests: 0, tokens: 0 };

        return {
            totalRequests: usage.totalRequests,
            totalTokens: usage.totalTokens,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            estimatedCost: usage.cost,
            requestsToday: todayStats.requests,
            tokensToday: todayStats.tokens
        };
    }

    /**
     * 获取使用趋势
     * 
     * @param days - 天数
     * @returns 使用趋势列表
     */
    public getTrends(days: number = 7): UsageTrend[] {
        if (!this.cachedUsage) {
            return [];
        }

        const trends: UsageTrend[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = formatLocalDateKey(date);
            
            const dayStats = this.cachedUsage.byDay[dateStr] || { requests: 0, tokens: 0 };
            
            trends.push({
                date: dateStr,
                requests: dayStats.requests,
                tokens: dayStats.tokens,
                cost: dayStats.cost ?? this.estimateCost(dayStats.tokens)
            });
        }

        return trends;
    }

    /**
     * 获取模型使用分布
     * 
     * @returns 模型使用分布列表
     */
    public getModelBreakdown(): Array<{
        model: string;
        requests: number;
        tokens: number;
        cost: number;
        percentage: number;
    }> {
        if (!this.cachedUsage) {
            return [];
        }

        const totalTokens = this.cachedUsage.totalTokens;
        const entries = Object.entries(this.cachedUsage.byModel);

        return entries.map(([model, stats]: any) => ({
            model,
            requests: stats.requests,
            tokens: stats.tokens,
            cost: stats.cost,
            percentage: totalTokens > 0 ? (stats.tokens / totalTokens) * 100 : 0
        })).sort((a: any, b: any) => b.tokens - a.tokens);
    }

    /**
     * 获取使用量最高的智能体
     * 
     * @param limit - 限制数量
     * @returns 智能体使用列表
     */
    public getTopAgents(limit: number = 5): Array<{
        agentId: string;
        requests: number;
        tokens: number;
    }> {
        // This would require additional API support
        // Returning mock data for now
        return [];
    }

    /**
     * 格式化 Token 数量
     * 
     * @param count - Token 数量
     * @returns 格式化后的字符串
     */
    public formatTokenCount(count: number): string {
        if (count >= 1_000_000) {
            return `${(count / 1_000_000).toFixed(1)}M`;
        } else if (count >= 1_000) {
            return `${(count / 1_000).toFixed(1)}K`;
        }
        return count.toString();
    }

    /**
     * 格式化成本
     * 
     * @param cost - 成本值
     * @returns 格式化后的成本字符串
     */
    public formatCost(cost: number): string {
        const symbol = this.cachedUsage?.currencySymbol || '$';
        return `${symbol}${cost.toFixed(4)}`;
    }

    /**
     * 估算成本
     * @param tokens - Token 数量
     * @returns 估算成本
     */
    private estimateCost(tokens: number): number {
        // Rough estimate: $0.002 per 1K tokens
        return (tokens / 1000) * 0.002;
    }

    /**
     * 刷新使用量数据
     * 
     * @returns 刷新后的使用量数据
     */
    public async refresh(): Promise<APIUsage> {
        return this.getUsage(true);
    }

    /**
     * 使缓存失效
     */
    public invalidate(): void {
        this.cachedUsage = undefined;
        this.lastFetch = 0;
        this.emit('usageInvalidated');
    }

    /**
     * 释放资源
     */
    public dispose() {
        this.service.off('usageChanged', this.handleUsageChanged);
        this.service.off('connectionChange', this.handleConnectionChange);
        this.removeAllListeners();
        this.cachedUsage = undefined;
    }
}
