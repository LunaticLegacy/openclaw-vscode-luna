import { OpenClawService, APIUsage } from '../services/openclawService';
import { EventEmitter } from 'events';

export interface UsageMetrics {
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
    requestsToday: number;
    tokensToday: number;
}

export interface UsageTrend {
    date: string;
    requests: number;
    tokens: number;
    cost: number;
}

export class UsageManager extends EventEmitter {
    private service: OpenClawService;
    private cachedUsage: APIUsage | null = null;
    private lastFetch: number = 0;
    private cacheDuration: number = 60000; // 1 minute cache

    constructor(service: OpenClawService) {
        super();
        this.service = service;
    }

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

    public async getRealtimeMetrics(): Promise<{
        activeSessions: number;
        requestsPerMinute: number;
        tokensPerMinute: number;
    }> {
        return this.service.getRealtimeUsage();
    }

    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        return this.service.getUsageByAgent(agentId);
    }

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
        const today = new Date().toISOString().split('T')[0];
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

    public getTrends(days: number = 7): UsageTrend[] {
        if (!this.cachedUsage) {
            return [];
        }

        const trends: UsageTrend[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
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

        return entries.map(([model, stats]) => ({
            model,
            requests: stats.requests,
            tokens: stats.tokens,
            cost: stats.cost,
            percentage: totalTokens > 0 ? (stats.tokens / totalTokens) * 100 : 0
        })).sort((a, b) => b.tokens - a.tokens);
    }

    public getTopAgents(limit: number = 5): Array<{
        agentId: string;
        requests: number;
        tokens: number;
    }> {
        // This would require additional API support
        // Returning mock data for now
        return [];
    }

    public formatTokenCount(count: number): string {
        if (count >= 1_000_000) {
            return `${(count / 1_000_000).toFixed(1)}M`;
        } else if (count >= 1_000) {
            return `${(count / 1_000).toFixed(1)}K`;
        }
        return count.toString();
    }

    public formatCost(cost: number): string {
        const symbol = this.cachedUsage?.currencySymbol || '$';
        return `${symbol}${cost.toFixed(4)}`;
    }

    private estimateCost(tokens: number): number {
        // Rough estimate: $0.002 per 1K tokens
        return (tokens / 1000) * 0.002;
    }

    public async refresh(): Promise<APIUsage> {
        return this.getUsage(true);
    }

    public dispose() {
        this.removeAllListeners();
        this.cachedUsage = null;
    }
}
