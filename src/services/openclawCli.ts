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
