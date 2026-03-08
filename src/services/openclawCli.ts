import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import { OpenClawCliServiceConfig } from './openclawConfig';

const execFileAsync = promisify(execFile);

interface OpenClawCliRunnerOptions {
    timeoutMs?: number;
}

export interface OpenClawAgentRecord {
    id: string;
    name?: string;
    workspace?: string;
    agentDir?: string;
    model?: string;
    bindings?: number;
    isDefault?: boolean;
    routes?: string[];
}

export interface OpenClawGatewayAgentsResult {
    defaultId?: string;
    mainKey?: string;
    scope?: string;
    agents?: Array<{
        id?: string;
        name?: string;
    }>;
}

export interface OpenClawSessionsListEntry {
    key: string;
    sessionId?: string;
    updatedAt?: number;
    agentId?: string;
    model?: string;
    modelProvider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

export interface OpenClawSessionsListResult {
    path?: string;
    count?: number;
    defaults?: {
        modelProvider?: string;
        model?: string;
        contextTokens?: number;
    };
    sessions?: OpenClawSessionsListEntry[];
}

export interface OpenClawChatHistoryMessage {
    role?: string;
    content?: unknown;
    text?: string;
    timestamp?: number | string;
    [key: string]: unknown;
}

export interface OpenClawChatHistoryResult {
    sessionKey?: string;
    sessionId?: string;
    messages?: OpenClawChatHistoryMessage[];
    thinkingLevel?: string;
}

export interface OpenClawAgentIdentity {
    agentId?: string;
    name?: string;
    avatar?: string;
}

export interface OpenClawTokenTotals {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    totalCost?: number;
    inputCost?: number;
    outputCost?: number;
    cacheReadCost?: number;
    cacheWriteCost?: number;
    missingCostEntries?: number;
}

export interface OpenClawSessionsUsageEntry {
    key: string;
    sessionId?: string;
    updatedAt?: number;
    agentId?: string;
    channel?: string;
    modelProvider?: string;
    model?: string;
    usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens?: number;
        totalCost?: number;
        dailyBreakdown?: Array<{
            date?: string;
            tokens?: number;
            cost?: number;
        }>;
        dailyMessageCounts?: Array<{
            date?: string;
            total?: number;
            user?: number;
            assistant?: number;
            errors?: number;
        }>;
        messageCounts?: {
            total?: number;
            user?: number;
            assistant?: number;
            errors?: number;
        };
    };
}

export interface OpenClawSessionsUsageResult {
    updatedAt?: number;
    startDate?: string;
    endDate?: string;
    sessions?: OpenClawSessionsUsageEntry[];
    totals?: OpenClawTokenTotals;
    aggregates?: {
        messages?: {
            total?: number;
            user?: number;
            assistant?: number;
            errors?: number;
        };
        byModel?: Array<{
            provider?: string;
            model?: string;
            count?: number;
            totals?: OpenClawTokenTotals;
        }>;
        byAgent?: Array<{
            agentId?: string;
            totals?: OpenClawTokenTotals;
        }>;
        daily?: Array<{
            date?: string;
            tokens?: number;
            cost?: number;
            messages?: number;
            errors?: number;
        }>;
        modelDaily?: Array<{
            date?: string;
            provider?: string;
            model?: string;
            count?: number;
            tokens?: number;
            cost?: number;
        }>;
    };
}

export interface OpenClawUsageCostResult {
    updatedAt?: number;
    days?: number;
    daily?: Array<{
        date?: string;
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens?: number;
        totalCost?: number;
        inputCost?: number;
        outputCost?: number;
        cacheReadCost?: number;
        cacheWriteCost?: number;
        missingCostEntries?: number;
    }>;
    totals?: OpenClawTokenTotals;
}

export type OpenClawCronSessionTarget = 'main' | 'isolated';
export type OpenClawCronWakeMode = 'now' | 'next-heartbeat';
export type OpenClawCronThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export type OpenClawCronSchedule =
    | {
        kind: 'at';
        at: string;
    }
    | {
        kind: 'every';
        everyMs: number;
        anchorMs?: number;
    }
    | {
        kind: 'cron';
        expr: string;
        tz?: string;
        staggerMs?: number;
    };

export type OpenClawCronPayload =
    | {
        kind: 'systemEvent';
        text: string;
    }
    | {
        kind: 'agentTurn';
        message: string;
        model?: string;
        timeoutSeconds?: number;
        thinking?: OpenClawCronThinkingLevel;
    };

export interface OpenClawCronJobState {
    lastRunAtMs?: number;
    nextRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    lastDurationMs?: number;
    lastDeliveryStatus?: string;
    consecutiveErrors?: number;
    lastDelivered?: boolean;
}

export interface OpenClawCronJob {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: OpenClawCronSchedule;
    sessionTarget: OpenClawCronSessionTarget;
    wakeMode: OpenClawCronWakeMode;
    payload: OpenClawCronPayload;
    delivery?: Record<string, unknown>;
    failureAlert?: false | Record<string, unknown>;
    state?: OpenClawCronJobState;
}

export interface OpenClawCronRunRecord {
    ts?: number;
    jobId?: string;
    action?: string;
    status?: string;
    summary?: string;
    error?: string;
    delivered?: boolean;
    deliveryStatus?: string;
    sessionId?: string;
    sessionKey?: string;
    runAtMs?: number;
    durationMs?: number;
    nextRunAtMs?: number;
    model?: string;
    provider?: string;
}

export type OpenClawCronCommandSchedule =
    | {
        kind: 'at';
        at: string;
    }
    | {
        kind: 'every';
        every: string;
    }
    | {
        kind: 'cron';
        expr: string;
        tz?: string;
    };

export type OpenClawCronCommandPayload =
    | {
        kind: 'systemEvent';
        text: string;
    }
    | {
        kind: 'agentTurn';
        message: string;
        model?: string;
        timeoutSeconds?: number;
        thinking?: OpenClawCronThinkingLevel;
    };

export interface OpenClawCronCreateParams {
    agentId?: string;
    name: string;
    description?: string;
    enabled?: boolean;
    deleteAfterRun?: boolean;
    schedule: OpenClawCronCommandSchedule;
    sessionTarget: OpenClawCronSessionTarget;
    wakeMode: OpenClawCronWakeMode;
    payload: OpenClawCronCommandPayload;
}

export interface OpenClawCronEditParams {
    agentId?: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    clearAgent?: boolean;
    deleteAfterRun?: boolean;
    schedule?: OpenClawCronCommandSchedule;
    sessionTarget?: OpenClawCronSessionTarget;
    wakeMode?: OpenClawCronWakeMode;
    payload?: OpenClawCronCommandPayload;
}

export class OpenClawCliRunner {
    private readonly timeoutMs: number;

    constructor(
        private readonly config: OpenClawCliServiceConfig,
        options: OpenClawCliRunnerOptions = {}
    ) {
        this.timeoutMs = options.timeoutMs ?? 120000;
    }

    public async health(): Promise<Record<string, unknown>> {
        return this.gatewayCall<Record<string, unknown>>('health');
    }

    public async listAgents(): Promise<OpenClawAgentRecord[]> {
        return this.execJson<OpenClawAgentRecord[]>(['agents', 'list', '--json']);
    }

    public async listGatewayAgents(): Promise<OpenClawGatewayAgentsResult> {
        return this.gatewayCall<OpenClawGatewayAgentsResult>('agents.list');
    }

    public async listSessions(): Promise<OpenClawSessionsListResult> {
        return this.gatewayCall<OpenClawSessionsListResult>('sessions.list');
    }

    public async getChatHistory(sessionKey: string, limit: number = 200): Promise<OpenClawChatHistoryResult> {
        return this.gatewayCall<OpenClawChatHistoryResult>('chat.history', {
            sessionKey,
            limit
        });
    }

    public async sendChat(sessionKey: string, message: string): Promise<Record<string, unknown>> {
        return this.gatewayCall<Record<string, unknown>>(
            'chat.send',
            {
                sessionKey,
                message,
                deliver: false,
                idempotencyKey: crypto.randomUUID()
            },
            { expectFinal: true }
        );
    }

    public async getAgentIdentity(sessionKey: string): Promise<OpenClawAgentIdentity> {
        return this.gatewayCall<OpenClawAgentIdentity>('agent.identity.get', {
            sessionKey
        });
    }

    public async getSessionsUsage(params: Record<string, unknown>): Promise<OpenClawSessionsUsageResult> {
        return this.gatewayCall<OpenClawSessionsUsageResult>('sessions.usage', params);
    }

    public async getUsageCost(params: Record<string, unknown>): Promise<OpenClawUsageCostResult> {
        return this.gatewayCall<OpenClawUsageCostResult>('usage.cost', params);
    }

    public async deleteAgent(agentId: string): Promise<Record<string, unknown> | undefined> {
        return this.execJson<Record<string, unknown>>([
            'agents',
            'delete',
            agentId,
            '--force',
            '--json'
        ]);
    }

    public async createAgent(name: string, model?: string): Promise<Record<string, unknown> | undefined> {
        const workspacePath = this.resolveAgentWorkspacePath(name);
        const args = [
            'agents',
            'add',
            name,
            '--workspace',
            workspacePath,
            '--non-interactive',
            '--json'
        ];

        if (model) {
            args.push('--model', model);
        } else if (this.config.defaultModel) {
            args.push('--model', this.config.defaultModel);
        }

        return this.execJson<Record<string, unknown>>(args);
    }

    public async addCronJob(params: OpenClawCronCreateParams): Promise<Record<string, unknown> | undefined> {
        const args = ['cron', 'add', '--json'];
        appendCronAddArgs(args, params);
        return this.execJson<Record<string, unknown>>(args);
    }

    public async editCronJob(jobId: string, params: OpenClawCronEditParams): Promise<void> {
        const args = ['cron', 'edit', jobId];
        appendCronEditArgs(args, params);
        await this.execVoid(args);
    }

    public async enableCronJob(jobId: string): Promise<void> {
        await this.execVoid(['cron', 'enable', jobId]);
    }

    public async disableCronJob(jobId: string): Promise<void> {
        await this.execVoid(['cron', 'disable', jobId]);
    }

    public async runCronJob(jobId: string): Promise<void> {
        await this.execVoid(['cron', 'run', jobId]);
    }

    public async removeCronJob(jobId: string): Promise<void> {
        await this.execVoid(['cron', 'rm', jobId]);
    }

    private async gatewayCall<T>(
        method: string,
        params: Record<string, unknown> = {},
        options: { expectFinal?: boolean } = {}
    ): Promise<T> {
        const args = ['gateway', 'call', method];

        if (this.config.gatewayUrl) {
            args.push('--url', toWebSocketUrl(this.config.gatewayUrl));
            if (this.config.gatewayToken) {
                args.push('--token', this.config.gatewayToken);
            }
        }

        if (options.expectFinal) {
            args.push('--expect-final');
        }

        args.push('--params', JSON.stringify(params), '--json');
        return this.execJson<T>(args);
    }

    private async execJson<T>(args: string[]): Promise<T> {
        const { stdout, stderr } = await this.exec(args);
        const output = stdout.trim();
        if (!output) {
            const errorOutput = stderr.trim();
            if (errorOutput) {
                throw new Error(errorOutput);
            }

            return undefined as T;
        }

        try {
            return JSON.parse(output) as T;
        } catch (error) {
            const message = stderr.trim() || `Invalid OpenClaw JSON output: ${output.slice(0, 500)}`;
            throw new Error(`${message}${error ? ` (${String(error)})` : ''}`);
        }
    }

    private async execVoid(args: string[]): Promise<void> {
        await this.exec(args);
    }

    private async exec(args: string[]): Promise<{ stdout: string; stderr: string }> {
        const { stdout, stderr } = await execFileAsync(
            this.config.nodePath,
            [this.config.cliEntryPath, ...args],
            {
                cwd: this.config.stateDir,
                env: this.buildEnv(),
                maxBuffer: 50 * 1024 * 1024,
                timeout: this.timeoutMs,
                windowsHide: true
            }
        );

        return {
            stdout,
            stderr
        };
    }

    private buildEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            OPENCLAW_STATE_DIR: this.config.stateDir,
            OPENCLAW_CONFIG_PATH: this.config.configPath
        };

        if (this.config.gatewayToken) {
            env.OPENCLAW_GATEWAY_TOKEN = this.config.gatewayToken;
        }

        return env;
    }

    private resolveAgentWorkspacePath(agentId: string): string {
        const safeAgentId = sanitizeAgentId(agentId);
        if (!this.config.defaultWorkspacePath) {
            return path.join(this.config.stateDir, 'workspace', safeAgentId);
        }

        return path.join(path.dirname(this.config.defaultWorkspacePath), 'agents', safeAgentId);
    }
}

function toWebSocketUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return trimmed;
    }

    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
        return trimmed;
    }

    if (trimmed.startsWith('http://')) {
        return `ws://${trimmed.slice('http://'.length)}`;
    }

    if (trimmed.startsWith('https://')) {
        return `wss://${trimmed.slice('https://'.length)}`;
    }

    return trimmed;
}

function sanitizeAgentId(value: string): string {
    const trimmed = value.trim().toLowerCase();
    const normalized = trimmed.replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    return normalized.replace(/^-|-$/g, '') || 'agent';
}

function appendCronAddArgs(target: string[], params: OpenClawCronCreateParams): void {
    appendFlagValue(target, '--agent', params.agentId);
    appendFlagValue(target, '--name', params.name);
    appendFlagValue(target, '--description', params.description);

    if (params.enabled === false) {
        target.push('--disabled');
    }

    if (params.deleteAfterRun !== undefined) {
        target.push(params.deleteAfterRun ? '--delete-after-run' : '--keep-after-run');
    }

    appendCronScheduleArgs(target, params.schedule);
    appendFlagValue(target, '--session', params.sessionTarget);
    appendFlagValue(target, '--wake', params.wakeMode);
    appendCronPayloadArgs(target, params.payload);
}

function appendCronEditArgs(target: string[], params: OpenClawCronEditParams): void {
    if (params.clearAgent) {
        target.push('--clear-agent');
    }

    appendFlagValue(target, '--agent', params.agentId);
    appendFlagValue(target, '--name', params.name);
    appendFlagValue(target, '--description', params.description);

    if (params.enabled !== undefined) {
        target.push(params.enabled ? '--enable' : '--disable');
    }

    if (params.deleteAfterRun !== undefined) {
        target.push(params.deleteAfterRun ? '--delete-after-run' : '--keep-after-run');
    }

    if (params.schedule) {
        appendCronScheduleArgs(target, params.schedule);
    }

    appendFlagValue(target, '--session', params.sessionTarget);
    appendFlagValue(target, '--wake', params.wakeMode);
    appendCronPayloadArgs(target, params.payload);
}

function appendCronScheduleArgs(target: string[], schedule: OpenClawCronCommandSchedule): void {
    switch (schedule.kind) {
        case 'at':
            target.push('--at', schedule.at);
            break;
        case 'every':
            target.push('--every', schedule.every);
            break;
        case 'cron':
            target.push('--cron', schedule.expr);
            appendFlagValue(target, '--tz', schedule.tz);
            break;
    }
}

function appendCronPayloadArgs(target: string[], payload: OpenClawCronCommandPayload | undefined): void {
    if (!payload) {
        return;
    }

    if (payload.kind === 'systemEvent') {
        appendFlagValue(target, '--system-event', payload.text);
        return;
    }

    appendFlagValue(target, '--message', payload.message);
    appendFlagValue(target, '--model', payload.model);
    appendFlagValue(target, '--thinking', payload.thinking);

    if (typeof payload.timeoutSeconds === 'number' && Number.isFinite(payload.timeoutSeconds)) {
        target.push('--timeout-seconds', String(Math.max(1, Math.round(payload.timeoutSeconds))));
    }
}

function appendFlagValue(target: string[], flag: string, value: string | undefined): void {
    const normalized = value?.trim();
    if (!normalized) {
        return;
    }

    target.push(flag, normalized);
}
