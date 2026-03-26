import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import { OpenClawCliServiceConfig } from './openclawConfig';
import { OpenClawGatewayClient } from './openclawGatewayClient';

const execFileAsync = promisify(execFile);
const SAFE_WINDOWS_COMMAND_LINE_LENGTH = 8000;

interface OpenClawCliRunnerOptions {
    timeoutMs?: number;
    executor?: OpenClawCliCommandExecutor;
}

export interface OpenClawCliCommandExecution {
    config: OpenClawCliServiceConfig;
    args: string[];
    timeoutMs: number;
}

export type OpenClawCliCommandExecutor = (
    execution: OpenClawCliCommandExecution
) => Promise<{ stdout: string; stderr: string }>;

let sharedCommandExecutor: OpenClawCliCommandExecutor | undefined = undefined;

/**
 * 设置测试用的 CLI 命令执行器
 * @param executor - 命令执行器，undefined 表示重置为默认
 */
export function setOpenClawCliCommandExecutorForTests(
    executor: OpenClawCliCommandExecutor | undefined
): void {
    sharedCommandExecutor = executor;
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

export interface OpenClawChannelsListResult {
    chat?: Record<string, string[]>;
    auth?: Array<Record<string, unknown>>;
    usage?: Record<string, unknown>;
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

/**
 * OpenClaw CLI 运行器类
 * 
 * 提供执行 OpenClaw CLI 命令的封装，支持 Gateway 调用、智能体管理、定时任务管理等功能
 * 
 * @example
 * ```typescript
 * const runner = new OpenClawCliRunner(config);
 * const agents = await runner.listAgents();
 * ```
 */
export class OpenClawCliRunner {
    private readonly timeoutMs: number;
    private readonly executor: OpenClawCliCommandExecutor;

    /**
     * 创建 CLI 运行器实例
     * @param config - OpenClaw CLI 服务配置
     * @param options - 运行器选项
     */
    constructor(
        private readonly config: OpenClawCliServiceConfig,
        options: OpenClawCliRunnerOptions = {}
    ) {
        this.timeoutMs = options.timeoutMs ?? 120000;
        this.executor = options.executor || sharedCommandExecutor || defaultCommandExecutor;
    }

    /**
     * 检查 Gateway 健康状态
     * @returns 健康状态信息
     */
    public async health(): Promise<Record<string, unknown>> {
        return this.gatewayCall<Record<string, unknown>>('health');
    }

    /**
     * 获取智能体列表
     * @returns 智能体记录数组
     */
    public async listAgents(): Promise<OpenClawAgentRecord[]> {
        return this.execJson<OpenClawAgentRecord[]>(['agents', 'list', '--json']);
    }

    /**
     * 获取 Gateway 管理的智能体列表
     * @returns Gateway 智能体结果
     */
    public async listGatewayAgents(): Promise<OpenClawGatewayAgentsResult> {
        return this.gatewayCall<OpenClawGatewayAgentsResult>('agents.list');
    }

    /**
     * 获取会话列表
     * @returns 会话列表结果
     */
    public async listSessions(): Promise<OpenClawSessionsListResult> {
        return this.gatewayCall<OpenClawSessionsListResult>('sessions.list');
    }

    /**
     * 获取聊天历史
     * @param sessionKey - 会话键
     * @param limit - 返回的最大消息数，默认 200
     * @returns 聊天历史结果
     */
    public async getChatHistory(sessionKey: string, limit: number = 200): Promise<OpenClawChatHistoryResult> {
        return this.gatewayCall<OpenClawChatHistoryResult>('chat.history', {
            sessionKey,
            limit
        });
    }

    /**
     * 发送聊天消息
     * @param sessionKey - 会话键
     * @param message - 消息内容
     * @returns 发送结果
     */
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

    /**
     * 中止聊天会话
     * @param sessionKey - 会话键
     * @param runId - 可选的运行 ID
     * @returns 中止结果
     */
    public async abortChat(sessionKey: string, runId?: string): Promise<Record<string, unknown>> {
        const params: Record<string, unknown> = { sessionKey };
        if (runId?.trim()) {
            params.runId = runId.trim();
        }

        return this.gatewayCall<Record<string, unknown>>('chat.abort', params);
    }

    /**
     * 获取智能体身份信息
     * @param sessionKey - 会话键
     * @returns 智能体身份信息
     */
    public async getAgentIdentity(sessionKey: string): Promise<OpenClawAgentIdentity> {
        return this.gatewayCall<OpenClawAgentIdentity>('agent.identity.get', {
            sessionKey
        });
    }

    /**
     * 获取会话使用量统计
     * @param params - 查询参数
     * @returns 会话使用量结果
     */
    public async getSessionsUsage(params: Record<string, unknown>): Promise<OpenClawSessionsUsageResult> {
        return this.gatewayCall<OpenClawSessionsUsageResult>('sessions.usage', params);
    }

    /**
     * 获取使用成本统计
     * @param params - 查询参数
     * @returns 成本统计结果
     */
    public async getUsageCost(params: Record<string, unknown>): Promise<OpenClawUsageCostResult> {
        return this.gatewayCall<OpenClawUsageCostResult>('usage.cost', params);
    }

    /**
     * 获取频道列表
     * @returns 频道列表结果
     */
    public async listChannels(): Promise<OpenClawChannelsListResult> {
        return this.execJson<OpenClawChannelsListResult>(['channels', 'list', '--json']);
    }

    /**
     * 删除智能体
     * @param agentId - 智能体 ID
     * @returns 删除结果
     */
    public async deleteAgent(agentId: string): Promise<Record<string, unknown> | undefined> {
        return this.execJson<Record<string, unknown>>([
            'agents',
            'delete',
            agentId,
            '--force',
            '--json'
        ]);
    }

    /**
     * 创建智能体
     * @param name - 智能体名称
     * @param model - 可选的模型名称
     * @returns 创建结果
     */
    public async createAgent(name: string, model?: string): Promise<Record<string, unknown>> {
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

    /**
     * 添加定时任务
     * @param params - 创建定时任务参数
     * @returns 创建结果
     */
    public async addCronJob(params: OpenClawCronCreateParams): Promise<Record<string, unknown> | undefined> {
        const args = ['cron', 'add', '--json'];
        appendGatewayConnectionArgs(args, this.config);
        appendCronAddArgs(args, params);
        return this.execJson<Record<string, unknown>>(args);
    }

    /**
     * 编辑定时任务
     * @param jobId - 任务 ID
     * @param params - 编辑参数
     */
    public async editCronJob(jobId: string, params: OpenClawCronEditParams): Promise<void> {
        const args = ['cron', 'edit'];
        appendGatewayConnectionArgs(args, this.config);
        args.push(jobId);
        appendCronEditArgs(args, params);
        await this.execVoid(args);
    }

    /**
     * 启用定时任务
     * @param jobId - 任务 ID
     */
    public async enableCronJob(jobId: string): Promise<void> {
        const args = ['cron', 'enable'];
        appendGatewayConnectionArgs(args, this.config);
        args.push(jobId);
        await this.execVoid(args);
    }

    /**
     * 禁用定时任务
     * @param jobId - 任务 ID
     */
    public async disableCronJob(jobId: string): Promise<void> {
        const args = ['cron', 'disable'];
        appendGatewayConnectionArgs(args, this.config);
        args.push(jobId);
        await this.execVoid(args);
    }

    /**
     * 立即运行定时任务
     * @param jobId - 任务 ID
     */
    public async runCronJob(jobId: string): Promise<void> {
        const args = ['cron', 'run'];
        appendGatewayConnectionArgs(args, this.config);
        args.push(jobId);
        await this.execVoid(args);
    }

    /**
     * 移除定时任务
     * @param jobId - 任务 ID
     */
    public async removeCronJob(jobId: string): Promise<void> {
        const args = ['cron', 'rm'];
        appendGatewayConnectionArgs(args, this.config);
        args.push(jobId);
        await this.execVoid(args);
    }

    /**
     * 执行 Gateway 调用
     * @param method - 调用方法名
     * @param params - 调用参数
     * @param options - 调用选项
     * @returns 调用结果
     */
    private async gatewayCall<T>(
        method: string,
        params: Record<string, unknown> = {},
        options: { expectFinal?: boolean } = {}
    ): Promise<T> {
        if (this.shouldUseDirectGatewayCall(method, params, options)) {
            return this.gatewayCallViaClient<T>(method, params, options);
        }

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

    /**
     * 判断是否应使用直接 Gateway 调用
     * @param method - 调用方法名
     * @param params - 调用参数
     * @param options - 调用选项
     * @returns 是否使用直接调用
     */
    private shouldUseDirectGatewayCall(
        method: string,
        params: Record<string, unknown>,
        options: { expectFinal?: boolean }
    ): boolean {
        if (!this.config.gatewayUrl) {
            return false;
        }

        const estimatedLength = estimateGatewayCallCommandLength(this.config, method, params, options);
        return estimatedLength > SAFE_WINDOWS_COMMAND_LINE_LENGTH;
    }

    /**
     * 通过客户端执行 Gateway 调用
     * @param method - 调用方法名
     * @param params - 调用参数
     * @param options - 调用选项
     * @returns 调用结果
     */
    private async gatewayCallViaClient<T>(
        method: string,
        params: Record<string, unknown>,
        options: { expectFinal?: boolean }
    ): Promise<T> {
        if (!this.config.gatewayUrl) {
            throw new Error('OpenClaw gateway URL is not configured');
        }

        const client = new OpenClawGatewayClient({
            url: this.config.gatewayUrl,
            token: this.config.gatewayToken,
            timeoutMs: this.timeoutMs,
            clientDisplayName: 'OpenClaw Luna',
            clientVersion: 'vscode-plugin'
        });

        try {
            await client.connect();
            return await client.request<T>(method, params, {
                expectFinal: options.expectFinal === true,
                timeoutMs: this.timeoutMs
            });
        } finally {
            client.dispose();
        }
    }

    /**
     * 执行 CLI 命令并解析 JSON 输出
     * @param args - 命令参数
     * @returns 解析后的 JSON 结果
     */
    private async execJson<T>(args: string[]): Promise<T> {
        const { stdout, stderr } = await this.exec(args);
        const output = extractJsonPayload(stdout).trim();
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

    /**
     * 执行 CLI 命令（无返回值）
     * @param args - 命令参数
     */
    private async execVoid(args: string[]): Promise<void> {
        await this.exec(args);
    }

    /**
     * 执行 CLI 命令
     * @param args - 命令参数
     * @returns 命令输出
     */
    private async exec(args: string[]): Promise<{ stdout: string; stderr: string }> {
        return this.executor({
            config: this.config,
            args,
            timeoutMs: this.timeoutMs
        });
    }

    /**
     * 解析智能体工作目录路径
     * @param agentId - 智能体 ID
     * @returns 工作目录路径
     */
    private resolveAgentWorkspacePath(agentId: string): string {
        const safeAgentId = sanitizeAgentId(agentId);
        if (!this.config.defaultWorkspacePath) {
            return path.join(this.config.stateDir, 'workspace', safeAgentId);
        }

        return path.join(path.dirname(this.config.defaultWorkspacePath), 'agents', safeAgentId);
    }
}

function extractJsonPayload(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return '';
    }

    if (looksLikeStandaloneJson(trimmed)) {
        return trimmed;
    }

    const lines = trimmed.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const candidate = lines.slice(index).join('\n').trim();
        if (looksLikeStandaloneJson(candidate)) {
            return candidate;
        }
    }

    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    const start = [objectStart, arrayStart]
        .filter((index: any) => index >= 0)
        .sort((left: any, right: any) => left - right)[0];

    return start >= 0 ? trimmed.slice(start).trim() : trimmed;
}

function looksLikeStandaloneJson(value: string): boolean {
    if (!value.startsWith('{') && !value.startsWith('[')) {
        return false;
    }

    try {
        JSON.parse(value);
        return true;
    } catch {
        return false;
    }
}

const defaultCommandExecutor: OpenClawCliCommandExecutor = async ({ config, args, timeoutMs }: any) => {
    // Check for potential ENAMETOOLONG error by validating argument length
    const fullCommandLine = [config.nodePath, config.cliEntryPath, ...args].join(' ');
    
    // On Windows, command line length is limited to approximately 8191 characters
    if (fullCommandLine.length > SAFE_WINDOWS_COMMAND_LINE_LENGTH) {
        throw new Error(`Command line too long (${fullCommandLine.length} chars). Consider shortening paths or arguments.`);
    }
    
    // Validate path lengths as well
    const pathsToCheck = [
        config.nodePath,
        config.cliEntryPath,
        config.stateDir,
        config.configPath,
        config.defaultWorkspacePath
    ];
    
    for (const path of pathsToCheck) {
        if (path && path.length > 255) {  // Typical filesystem path limits
            console.warn(`Potentially long path detected: ${path.substring(0, 100)}... (${path.length} chars)`);
        }
    }
    
    try {
        const { stdout, stderr } = await execFileAsync(
            config.nodePath,
            [config.cliEntryPath, ...args],
            {
                cwd: config.stateDir,
                env: buildRunnerEnv(config),
                maxBuffer: 50 * 1024 * 1024,
                timeout: timeoutMs,
                windowsHide: true
            }
        );

        return {
            stdout,
            stderr
        };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'ENAMETOOLONG') {
            // Handle the ENAMETOOLONG error specifically
            throw new Error(`Command line too long: ${fullCommandLine.substring(0, 200)}... Reduce path lengths or arguments.`);
        }
        // Re-throw other errors
        throw error;
    }
};

function estimateGatewayCallCommandLength(
    config: OpenClawCliServiceConfig,
    method: string,
    params: Record<string, unknown>,
    options: { expectFinal?: boolean }
): number {
    const args = ['gateway', 'call', method];

    if (config.gatewayUrl) {
        args.push('--url', toWebSocketUrl(config.gatewayUrl));
        if (config.gatewayToken) {
            args.push('--token', config.gatewayToken);
        }
    }

    if (options.expectFinal) {
        args.push('--expect-final');
    }

    args.push('--params', JSON.stringify(params), '--json');
    return [config.nodePath, config.cliEntryPath, ...args].join(' ').length;
}

function buildRunnerEnv(config: OpenClawCliServiceConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCLAW_STATE_DIR: config.stateDir,
        OPENCLAW_CONFIG_PATH: config.configPath,
        // Suppress WARN level logs (like "Failed to discover Ollama models") to prevent 
        // excessive disk I/O. Only ERROR and higher severity logs will be written.
        // This prevents model-provider discovery failures from continuously filling the log file.
        OPENCLAW_LOG_LEVEL: 'error',
        LOG_LEVEL: 'error'
    };

    if (config.gatewayToken) {
        env.OPENCLAW_GATEWAY_TOKEN = config.gatewayToken;
    }

    return env;
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
    const sanitized = normalized.replace(/^-|-$/g, '') || 'agent';
    
    // Ensure the agent ID doesn't exceed reasonable length to prevent path issues on Windows
    // Keep it under 100 characters to avoid path length issues when combined with other path elements
    return sanitized.length > 100 ? sanitized.substring(0, 100) : sanitized;
}

function appendGatewayConnectionArgs(target: string[], config: OpenClawCliServiceConfig): void {
    if (config.gatewayUrl) {
        target.push('--url', toWebSocketUrl(config.gatewayUrl));
    }

    if (config.gatewayToken) {
        target.push('--token', config.gatewayToken);
    }
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
