import {
    OpenClawSessionsUsageEntry,
    OpenClawSessionsListEntry,
    OpenClawSessionsUsageResult,
    OpenClawUsageCostResult
} from '../openclawCli';
import { formatLocalDateKey } from '../../utils/dateKey';
import {
    APIUsage,
    LocalAgent,
    RealtimeUsageSnapshot
} from './types';

/**
 * Service for tracking local mode API usage statistics.
 */
export class LocalUsageService {
    private usage: APIUsage = createEmptyUsage();
    private usageByAgent: Map<string, APIUsage> = new Map();
    private requestTimestamps: number[] = [];

    /**
     * Initializes the usage service with agent and global hints.
     * @param agentHints - Array of agent hints with IDs and model info
     * @param globalHints - Global hints for currency inference
     */
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

    /**
     * Attaches an agent for usage tracking.
     * @param agent - The local agent to attach
     */
    public attachAgent(agent: LocalAgent): void {
        this.usageByAgent.set(
            agent.id,
            createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model]))
        );
    }

    /**
     * Removes an agent from usage tracking.
     * @param agentId - The agent ID to remove
     */
    public deleteAgent(agentId: string): void {
        this.usageByAgent.delete(agentId);
    }

    /**
     * Gets overall usage statistics.
     * @returns The API usage data
     */
    public getUsage(): APIUsage {
        return cloneUsage(this.usage);
    }

    /**
     * Gets usage statistics for a specific agent.
     * @param agentId - The agent ID
     * @returns The agent's API usage data
     */
    public getUsageByAgent(agentId: string): APIUsage {
        return cloneUsage(this.usageByAgent.get(agentId) || createEmptyUsage());
    }

    /**
     * Gets real-time usage snapshot.
     * @param activeSessions - Number of active sessions
     * @returns Realtime usage statistics
     */
    public getRealtimeUsage(activeSessions: number): RealtimeUsageSnapshot {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 60000);
        return {
            activeSessions,
            requestsPerMinute: this.requestTimestamps.length,
            tokensPerMinute: Math.round(this.usage.totalTokens)
        };
    }

    /**
     * Records a request with optional usage data.
     * @param agent - The local agent making the request
     * @param usage - Optional usage data from the response
     */
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
        const today = formatLocalDateKey();

        updateUsageAggregate(this.usage, agent.model, today, promptTokens, completionTokens, totalTokens, cost);

        const agentUsage = this.usageByAgent.get(agent.id)
            || createEmptyUsage(inferCurrencyFromHints([agent.providerId, agent.model]));
        updateUsageAggregate(agentUsage, agent.model, today, promptTokens, completionTokens, totalTokens, cost);
        this.usageByAgent.set(agent.id, agentUsage);
        this.requestTimestamps.push(Date.now());
    }

    /**
     * Resets all usage statistics.
     */
    public reset(): void {
        this.usage = createEmptyUsage();
        this.usageByAgent.clear();
        this.requestTimestamps = [];
    }
}

/**
 * Creates an empty usage object.
 * @param currency - Optional currency info
 * @returns The empty API usage object
 */
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
        byChannel: {},
        byChannelByDay: {},
        byDay: {}
    };
}

/**
 * Creates a deep clone of usage data.
 * @param usage - The usage data to clone
 * @returns The cloned usage data
 */
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
        byChannel: JSON.parse(JSON.stringify(usage.byChannel || {})),
        byChannelByDay: JSON.parse(JSON.stringify(usage.byChannelByDay || {})),
        byDay: JSON.parse(JSON.stringify(usage.byDay))
    };
}

/**
 * Maps OpenClaw sessions usage to API usage format.
 * @param sessionsUsage - The sessions usage result from OpenClaw
 * @param usageCost - The usage cost result
 * @param agentId - Optional agent ID to filter by
 * @param modelHints - Hints for model resolution
 * @returns The mapped API usage
 */
export function mapOpenClawUsage(
    sessionsUsage: OpenClawSessionsUsageResult,
    usageCost: OpenClawUsageCostResult | null,
    agentId?: string,
    modelHints: {
        sessionModels?: Map<string, string>;
        agentModels?: Map<string, string>;
        defaultModel?: string;
    } = {}
): APIUsage {
    const sessions = (sessionsUsage.sessions || []).filter(session => !agentId || session.agentId === agentId);
    const currency = inferCurrencyFromHints(
        sessions.flatMap(session => [session.modelProvider || '', session.model || ''])
    );
    const usage = createEmptyUsage(currency);
    const fallbackWindowModel = resolveFallbackWindowModel(sessionsUsage, modelHints.defaultModel);

    for (const session of sessions) {
        const sessionUsage = session.usage;
        const promptTokens = sessionUsage?.input || 0;
        const completionTokens = sessionUsage?.output || 0;
        const totalTokens = sessionUsage?.totalTokens || promptTokens + completionTokens;
        const totalCost = sessionUsage?.totalCost || 0;
        const requestCount = sessionUsage?.messageCounts?.user
            || sessionUsage?.messageCounts?.total
            || 0;
        const modelKey = resolveUsageModelKey(session, modelHints, fallbackWindowModel);
        const channelKey = resolveUsageChannelKey(session);

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

        const channelStats = usage.byChannel ||= {};
        const resolvedChannelStats = channelStats[channelKey] || { requests: 0, tokens: 0, cost: 0 };
        resolvedChannelStats.requests += requestCount;
        resolvedChannelStats.tokens += totalTokens;
        resolvedChannelStats.cost += totalCost;
        channelStats[channelKey] = resolvedChannelStats;

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

            const channelByDay = usage.byChannelByDay ||= {};
            channelByDay[date] ||= {};
            const dayChannelStats = channelByDay[date][channelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayChannelStats.tokens += daily.tokens || 0;
            dayChannelStats.cost += daily.cost || 0;
            dayChannelStats.requests += requestsByDay.get(date) || 0;
            channelByDay[date][channelKey] = dayChannelStats;
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

            const channelByDay = usage.byChannelByDay ||= {};
            channelByDay[date] ||= {};
            const dayChannelStats = channelByDay[date][channelKey] || { requests: 0, tokens: 0, cost: 0 };
            dayChannelStats.requests += requests;
            channelByDay[date][channelKey] = dayChannelStats;
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

/**
 * Builds model hints map from sessions list.
 * @param sessions - Array of session entries
 * @returns Map of session keys/IDs to model names
 */
export function buildSessionModelHints(sessions: OpenClawSessionsListEntry[]): Map<string, string> {
    const hints = new Map<string, string>();

    for (const session of sessions) {
        const model = normalizeUsageModelName(session.model);
        if (!model) {
            continue;
        }

        const sessionKey = session.key?.trim();
        if (sessionKey) {
            hints.set(sessionKey, model);
        }

        const sessionId = session.sessionId?.trim();
        if (sessionId) {
            hints.set(sessionId, model);
        }
    }

    return hints;
}

/**
 * Infers currency from provider/model hints.
 * @param hints - Array of hint strings
 * @returns Currency info or undefined
 */
export function inferCurrencyFromHints(hints: string[]): { code: string; symbol: string } | undefined {
    const normalized = hints
        .map(hint => hint.trim().toLowerCase())
        .filter(Boolean);

    if (normalized.length > 0 && normalized.every(hint => hint.includes('moonshot') || hint.includes('kimi'))) {
        return { code: 'CNY', symbol: '¥' };
    }

    return undefined;
}

/**
 * Gets unique model names from a list.
 * @param values - Array of model name values
 * @returns Array of unique model names
 */
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

/**
 * Estimates fallback cost from token counts.
 * @param promptTokens - Number of prompt tokens
 * @param completionTokens - Number of completion tokens
 * @returns Estimated cost
 */
function estimateFallbackCost(promptTokens: number, completionTokens: number): number {
    return ((promptTokens + completionTokens) / 1000) * 0.002;
}

/**
 * Resolves the model key for usage tracking.
 * @param session - The session usage entry
 * @param modelHints - Hints for model resolution
 * @param fallbackWindowModel - Fallback model name
 * @returns The resolved model key
 */
function resolveUsageModelKey(
    session: OpenClawSessionsUsageEntry,
    modelHints: {
        sessionModels?: Map<string, string>;
        agentModels?: Map<string, string>;
    },
    fallbackWindowModel?: string
): string {
    const sessionKey = session.key?.trim() || '';
    const sessionId = session.sessionId?.trim() || '';
    const agentId = session.agentId?.trim() || '';
    const directModel = normalizeUsageModelName(session.model);
    const hintedModel = directModel
        || modelHints.sessionModels?.get(sessionKey)
        || modelHints.sessionModels?.get(sessionId)
        || modelHints.agentModels?.get(agentId)
        || fallbackWindowModel;

    return hintedModel || 'unknown';
}

/**
 * Resolves the channel key for usage tracking.
 * @param session - The session usage entry
 * @returns The channel key
 */
function resolveUsageChannelKey(session: OpenClawSessionsUsageEntry): string {
    const normalized = session.channel?.trim().toLowerCase();
    return normalized || 'chat';
}

/**
 * Resolves the fallback window model from sessions usage.
 * @param sessionsUsage - The sessions usage result
 * @param defaultModel - Default model name
 * @returns The fallback model or undefined
 */
function resolveFallbackWindowModel(
    sessionsUsage: OpenClawSessionsUsageResult,
    defaultModel?: string
): string | undefined {
    const aggregateModels = collectKnownUsageModels(sessionsUsage);
    if (aggregateModels.length === 1) {
        return aggregateModels[0];
    }

    return normalizeUsageModelName(defaultModel);
}

/**
 * Collects known model names from usage data.
 * @param sessionsUsage - The sessions usage result
 * @returns Array of known model names
 */
function collectKnownUsageModels(sessionsUsage: OpenClawSessionsUsageResult): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    const pushModel = (value: string | undefined) => {
        const normalized = normalizeUsageModelName(value);
        if (!normalized || seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        result.push(normalized);
    };

    for (const session of sessionsUsage.sessions || []) {
        pushModel(session.model);
    }

    for (const entry of sessionsUsage.aggregates?.byModel || []) {
        pushModel(entry.model);
    }

    for (const entry of sessionsUsage.aggregates?.modelDaily || []) {
        pushModel(entry.model);
    }

    return result;
}

/**
 * Normalizes a usage model name.
 * @param value - The model name value
 * @returns The normalized model name or undefined
 */
function normalizeUsageModelName(value: string | undefined | null): string | undefined {
    const normalized = value?.trim();
    if (!normalized) {
        return undefined;
    }

    if (normalized.toLowerCase() === 'unknown') {
        return undefined;
    }

    return normalized;
}

/**
 * Updates usage aggregate with new data.
 * @param usage - The usage object to update
 * @param model - The model name
 * @param day - The day key
 * @param promptTokens - Number of prompt tokens
 * @param completionTokens - Number of completion tokens
 * @param totalTokens - Total token count
 * @param cost - The cost amount
 */
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

    const usageByChannel = usage.byChannel ||= {};
    usageByChannel.chat = {
        requests: (usageByChannel.chat?.requests || 0) + 1,
        tokens: (usageByChannel.chat?.tokens || 0) + totalTokens,
        cost: (usageByChannel.chat?.cost || 0) + cost
    };

    const usageByChannelDay = usage.byChannelByDay ||= {};
    usageByChannelDay[day] ||= {};
    usageByChannelDay[day].chat = {
        requests: (usageByChannelDay[day].chat?.requests || 0) + 1,
        tokens: (usageByChannelDay[day].chat?.tokens || 0) + totalTokens,
        cost: (usageByChannelDay[day].chat?.cost || 0) + cost
    };
}
