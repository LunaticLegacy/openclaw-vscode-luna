import {
    OpenClawSessionsUsageResult,
    OpenClawUsageCostResult
} from '../openclawCli';
import {
    APIUsage,
    LocalAgent,
    RealtimeUsageSnapshot
} from './types';

export class LocalUsageService {
    private usage: APIUsage = createEmptyUsage();
    private usageByAgent: Map<string, APIUsage> = new Map();
    private requestTimestamps: number[] = [];

    public initialize(agentHints: Array<{ agentId: string; providerId: string; model: string }>, globalHints: string[]): void {
        this.usage = createEmptyUsage(inferCurrencyFromHints(globalHints));
        this.usageByAgent.clear();
        this.requestTimestamps = [];

        for (const hint of agentHints) {
            this.usageByAgent.set(
                hint.agentId,
                createEmptyUsage(inferCurrencyFromHints([hint.providerId, hint.model]))
            );
        }
    }

    public attachAgent(agent: LocalAgent): void {
        this.usageByAgent.set(
            agent.id,
            createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model]))
        );
    }

    public deleteAgent(agentId: string): void {
        this.usageByAgent.delete(agentId);
    }

    public getUsage(): APIUsage {
        return cloneUsage(this.usage);
    }

    public getUsageByAgent(agentId: string): APIUsage {
        return cloneUsage(this.usageByAgent.get(agentId) || createEmptyUsage());
    }

    public getRealtimeUsage(activeSessions: number): RealtimeUsageSnapshot {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 60000);
        return {
            activeSessions,
            requestsPerMinute: this.requestTimestamps.length,
            tokensPerMinute: Math.round(this.usage.totalTokens)
        };
    }

    public recordRequest(
        agent: LocalAgent,
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
        }
    ): void {
        const promptTokens = usage?.prompt_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const totalTokens = usage?.total_tokens || promptTokens + completionTokens;
        const cost = estimateFallbackCost(promptTokens, completionTokens);
        const today = new Date().toISOString().split('T')[0];

        updateUsageAggregate(this.usage, agent.model, today, promptTokens, completionTokens, totalTokens, cost);

        const agentUsage = this.usageByAgent.get(agent.id)
            || createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model]));
        updateUsageAggregate(agentUsage, agent.model, today, promptTokens, completionTokens, totalTokens, cost);
        this.usageByAgent.set(agent.id, agentUsage);
        this.requestTimestamps.push(Date.now());
    }

    public reset(): void {
        this.usage = createEmptyUsage();
        this.usageByAgent.clear();
        this.requestTimestamps = [];
    }
}

export function createEmptyUsage(currency?: { code: string; symbol: string }): APIUsage {
    return {
        totalRequests: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        currency: currency?.code,
        currencySymbol: currency?.symbol,
        byModel: {},
        byModelByDay: {},
        byDay: {}
    };
}

export function cloneUsage(usage: APIUsage): APIUsage {
    return {
        totalRequests: usage.totalRequests,
        totalTokens: usage.totalTokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cost: usage.cost,
        currency: usage.currency,
        currencySymbol: usage.currencySymbol,
        byModel: JSON.parse(JSON.stringify(usage.byModel)),
        byModelByDay: JSON.parse(JSON.stringify(usage.byModelByDay || {})),
        byDay: JSON.parse(JSON.stringify(usage.byDay))
    };
}

export function mapOpenClawUsage(
    sessionsUsage: OpenClawSessionsUsageResult,
    usageCost: OpenClawUsageCostResult | null,
    agentId?: string
): APIUsage {
    const sessions = (sessionsUsage.sessions || []).filter(session => !agentId || session.agentId === agentId);
    const currency = inferCurrencyFromHints(
        sessions.flatMap(session => [session.modelProvider || '', session.model || ''])
    );
    const usage = createEmptyUsage(currency);

    for (const session of sessions) {
        const sessionUsage = session.usage;
        const promptTokens = sessionUsage?.input || 0;
        const completionTokens = sessionUsage?.output || 0;
        const totalTokens = sessionUsage?.totalTokens || promptTokens + completionTokens;
        const totalCost = sessionUsage?.totalCost || 0;
        const requestCount = sessionUsage?.messageCounts?.user
            || sessionUsage?.messageCounts?.total
            || 0;
        const modelKey = session.model || session.modelProvider || 'unknown';

        usage.totalRequests += requestCount;
        usage.promptTokens += promptTokens;
        usage.completionTokens += completionTokens;
        usage.totalTokens += totalTokens;
        usage.cost += totalCost;

        const modelStats = usage.byModel[modelKey] || { requests: 0, tokens: 0, cost: 0 };
        modelStats.requests += requestCount;
        modelStats.tokens += totalTokens;
        modelStats.cost += totalCost;
        usage.byModel[modelKey] = modelStats;

        const requestsByDay = new Map<string, number>();
        for (const messageCounts of sessionUsage?.dailyMessageCounts || []) {
            const date = messageCounts.date?.trim();
            if (!date) {
                continue;
            }

            requestsByDay.set(date, (requestsByDay.get(date) || 0) + (messageCounts.user || messageCounts.total || 0));
        }

        for (const daily of sessionUsage?.dailyBreakdown || []) {
            const date = daily.date?.trim();
            if (!date) {
                continue;
            }

            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            dayStats.tokens += daily.tokens || 0;
            dayStats.cost = (dayStats.cost || 0) + (daily.cost || 0);
            dayStats.requests += requestsByDay.get(date) || 0;
            usage.byDay[date] = dayStats;

            const modelByDay = usage.byModelByDay ||= {};
            modelByDay[date] ||= {};
            const dayModelStats = modelByDay[date][modelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayModelStats.tokens += daily.tokens || 0;
            dayModelStats.cost += daily.cost || 0;
            dayModelStats.requests += requestsByDay.get(date) || 0;
            modelByDay[date][modelKey] = dayModelStats;
            requestsByDay.delete(date);
        }

        for (const [date, requests] of requestsByDay.entries()) {
            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            dayStats.requests += requests;
            usage.byDay[date] = dayStats;

            const modelByDay = usage.byModelByDay ||= {};
            modelByDay[date] ||= {};
            const dayModelStats = modelByDay[date][modelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayModelStats.requests += requests;
            modelByDay[date][modelKey] = dayModelStats;
        }
    }

    if (!agentId) {
        const totals = usageCost?.totals;
        if (typeof totals?.input === 'number') {
            usage.promptTokens = totals.input;
        }
        if (typeof totals?.output === 'number') {
            usage.completionTokens = totals.output;
        }
        if (typeof totals?.totalTokens === 'number') {
            usage.totalTokens = totals.totalTokens;
        }
        if (typeof totals?.totalCost === 'number') {
            usage.cost = totals.totalCost;
        }

        for (const day of usageCost?.daily || []) {
            const date = day.date?.trim();
            if (!date) {
                continue;
            }

            const dayStats = usage.byDay[date] || { requests: 0, tokens: 0, cost: 0 };
            if (typeof day.totalTokens === 'number') {
                dayStats.tokens = day.totalTokens;
            }
            if (typeof day.totalCost === 'number') {
                dayStats.cost = day.totalCost;
            }
            usage.byDay[date] = dayStats;
        }
    }

    if (usage.totalRequests === 0) {
        usage.totalRequests = sessionsUsage.aggregates?.messages?.user
            || sessionsUsage.aggregates?.messages?.total
            || 0;
    }

    return usage;
}

export function inferCurrencyFromHints(hints: string[]): { code: string; symbol: string } | undefined {
    const normalized = hints
        .map(hint => hint.trim().toLowerCase())
        .filter(Boolean);

    if (normalized.length > 0 && normalized.every(hint => hint.includes('moonshot') || hint.includes('kimi'))) {
        return { code: 'CNY', symbol: '¥' };
    }

    return undefined;
}

export function uniqueModelNames(values: Array<string | undefined | null>): string[] {
    const models: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const model = value?.trim();
        if (!model || seen.has(model)) {
            continue;
        }

        seen.add(model);
        models.push(model);
    }

    return models;
}

function estimateFallbackCost(promptTokens: number, completionTokens: number): number {
    return ((promptTokens + completionTokens) / 1000) * 0.002;
}

function updateUsageAggregate(
    usage: APIUsage,
    model: string,
    day: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    cost: number
): void {
    usage.totalRequests += 1;
    usage.promptTokens += promptTokens;
    usage.completionTokens += completionTokens;
    usage.totalTokens += totalTokens;
    usage.cost += cost;
    usage.byDay[day] = {
        requests: (usage.byDay[day]?.requests || 0) + 1,
        tokens: (usage.byDay[day]?.tokens || 0) + totalTokens,
        cost: (usage.byDay[day]?.cost || 0) + cost
    };
    usage.byModel[model] = {
        requests: (usage.byModel[model]?.requests || 0) + 1,
        tokens: (usage.byModel[model]?.tokens || 0) + totalTokens,
        cost: (usage.byModel[model]?.cost || 0) + cost
    };
    const usageByModelDay = usage.byModelByDay ||= {};
    usageByModelDay[day] ||= {};
    usageByModelDay[day][model] = {
        requests: (usageByModelDay[day][model]?.requests || 0) + 1,
        tokens: (usageByModelDay[day][model]?.tokens || 0) + totalTokens,
        cost: (usageByModelDay[day][model]?.cost || 0) + cost
    };
}
