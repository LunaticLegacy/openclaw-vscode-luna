import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    OpenClawCliCommandExecutor,
    OpenClawCronRunRecord
} from '../../services/openclawCli';
import { formatLocalDateKey } from '../../utils/dateKey';

type CronSchedule =
    | { kind: 'every'; everyMs: number }
    | { kind: 'at'; at: string }
    | { kind: 'cron'; expr: string; tz?: string };

type CronPayload =
    | { kind: 'systemEvent'; text: string }
    | { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number };

interface CronJobRecord {
    id: string;
    agentId?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: CronSchedule;
    sessionTarget: 'main' | 'isolated';
    wakeMode: 'now' | 'next-heartbeat';
    payload: CronPayload;
    state?: {
        lastRunAtMs?: number;
        nextRunAtMs?: number;
        lastRunStatus?: string;
        lastStatus?: string;
        lastDurationMs?: number;
        lastDeliveryStatus?: string;
        consecutiveErrors?: number;
    };
}

interface CronJobsFile {
    version: number;
    jobs: CronJobRecord[];
}

interface FakeAgentRecord {
    id: string;
    name: string;
    workspace: string;
    agentDir: string;
    model?: string;
    createdAtMs: number;
    isDefault?: boolean;
}

interface FakeSessionRecord {
    key: string;
    sessionId: string;
    agentId: string;
    updatedAt: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
    messageCountUser: number;
    messageCountAssistant: number;
}

interface FakeState {
    agents: FakeAgentRecord[];
    sessions: FakeSessionRecord[];
}

interface FakeCommandResult {
    stdout: string;
    stderr: string;
}

const FAKE_STATE_FILE = '.openclaw-test-state.json';
const DEFAULT_AGENT_ID = 'default';
const DEFAULT_MODEL = 'fake-openclaw-model';

export function createFakeOpenClawCommandExecutor(): OpenClawCliCommandExecutor {
    return async ({ config, args }) => executeFakeOpenClawCommand(args, config.stateDir);
}

export async function executeFakeOpenClawCommand(
    args: string[],
    stateDir: string
): Promise<FakeCommandResult> {
    await ensureStateDirs(stateDir);

    if (args[0] === 'gateway' && args[1] === 'call') {
        return handleGatewayCall(args.slice(2), stateDir);
    }

    if (args[0] === 'cron') {
        return handleCronCommand(args.slice(1), stateDir);
    }

    if (args[0] === 'agents' && args[1] === 'list') {
        const state = await readState(stateDir);
        return jsonResult(state.agents.map(agent => ({
            id: agent.id,
            name: agent.name,
            workspace: agent.workspace,
            agentDir: agent.agentDir,
            model: agent.model,
            isDefault: agent.isDefault
        })));
    }

    if (args[0] === 'agents' && args[1] === 'add') {
        return handleAgentAdd(args.slice(2), stateDir);
    }

    if (args[0] === 'agents' && args[1] === 'delete') {
        return handleAgentDelete(args.slice(2), stateDir);
    }

    throw new Error(`Unsupported fake OpenClaw CLI command: ${args.join(' ')}`);
}

async function handleGatewayCall(args: string[], stateDir: string): Promise<FakeCommandResult> {
    const method = args[0];
    const params = readJsonFlag<Record<string, unknown>>(args, '--params') || {};
    const state = await readState(stateDir);

    switch (method) {
        case 'health':
            return jsonResult({ status: 'ok' });
        case 'agents.list':
            return jsonResult({
                defaultId: DEFAULT_AGENT_ID,
                mainKey: 'main',
                agents: state.agents.map(agent => ({
                    id: agent.id,
                    name: agent.name
                }))
            });
        case 'sessions.list':
            return jsonResult({
                sessions: state.sessions
                    .slice()
                    .sort((left, right) => right.updatedAt - left.updatedAt)
                    .map(session => ({
                        key: session.key,
                        sessionId: session.sessionId,
                        updatedAt: session.updatedAt,
                        agentId: session.agentId,
                        model: session.model,
                        modelProvider: 'fake-provider',
                        inputTokens: session.inputTokens,
                        outputTokens: session.outputTokens,
                        totalTokens: session.totalTokens
                    }))
            });
        case 'chat.history':
            return jsonResult({
                messages: await readSessionMessages(stateDir, extractString(params.sessionKey))
            });
        case 'chat.send':
            return handleChatSend(stateDir, state, {
                sessionKey: extractString(params.sessionKey) || `agent:${DEFAULT_AGENT_ID}:main`,
                message: extractString(params.message) || ''
            });
        case 'sessions.usage':
            return jsonResult(buildSessionsUsagePayload(state.sessions));
        case 'usage.cost':
            return jsonResult(buildUsageCostPayload(state.sessions));
        default:
            throw new Error(`Unsupported fake gateway method: ${method} @ ${stateDir}`);
    }
}

async function handleChatSend(
    stateDir: string,
    state: FakeState,
    payload: { sessionKey: string; message: string }
): Promise<FakeCommandResult> {
    const now = Date.now();
    const agentId = extractAgentIdFromSessionKey(payload.sessionKey) || DEFAULT_AGENT_ID;
    const agent = state.agents.find(item => item.id === agentId) || createDefaultAgent(stateDir);
    if (!state.agents.some(item => item.id === agent.id)) {
        state.agents.push(agent);
    }

    let session = state.sessions.find(item => item.key === payload.sessionKey);
    if (!session) {
        session = {
            key: payload.sessionKey,
            sessionId: `${agentId}-${now}`,
            agentId,
            updatedAt: now,
            model: agent.model || DEFAULT_MODEL,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            totalCost: 0,
            messageCountUser: 0,
            messageCountAssistant: 0
        };
        state.sessions.push(session);
    }

    const promptTokens = Math.max(8, Math.ceil(payload.message.length / 4));
    const completionTokens = Math.max(12, Math.ceil(promptTokens * 1.5));
    const totalTokens = promptTokens + completionTokens;
    const totalCost = Number(((totalTokens / 1000) * 0.002).toFixed(6));
    const assistantText = `Fake OpenClaw reply for: ${payload.message}`;
    const userTimestamp = new Date(now).toISOString();
    const assistantTimestamp = new Date(now + 1).toISOString();
    const sessionLogDir = path.join(stateDir, 'agents', sanitizeId(agentId), 'sessions');
    const sessionLogPath = path.join(sessionLogDir, `${session.sessionId}.jsonl`);

    await fs.mkdir(sessionLogDir, { recursive: true });
    await fs.appendFile(sessionLogPath, [
        JSON.stringify({
            type: 'message',
            id: `${session.sessionId}:user:${now}`,
            timestamp: userTimestamp,
            message: {
                role: 'user',
                content: payload.message,
                timestamp: userTimestamp
            }
        }),
        JSON.stringify({
            type: 'message',
            id: `${session.sessionId}:assistant:${now + 1}`,
            timestamp: assistantTimestamp,
            message: {
                role: 'assistant',
                content: assistantText,
                timestamp: assistantTimestamp
            }
        }),
        ''
    ].join('\n'), 'utf8');

    session.updatedAt = now + 1;
    session.model = agent.model || DEFAULT_MODEL;
    session.inputTokens += promptTokens;
    session.outputTokens += completionTokens;
    session.totalTokens += totalTokens;
    session.totalCost = Number((session.totalCost + totalCost).toFixed(6));
    session.messageCountUser += 1;
    session.messageCountAssistant += 1;

    await writeState(stateDir, state);

    return jsonResult({
        status: 'final',
        message: {
            role: 'assistant',
            content: assistantText
        },
        usage: {
            input: promptTokens,
            output: completionTokens,
            totalTokens
        }
    });
}

async function handleAgentAdd(args: string[], stateDir: string): Promise<FakeCommandResult> {
    const name = args[0] || 'agent';
    const model = readFlagValue(args, '--model') || DEFAULT_MODEL;
    const workspace = readFlagValue(args, '--workspace')
        || path.join(stateDir, 'workspace', sanitizeId(name));
    const agentId = sanitizeId(name);
    const agentDir = path.join(stateDir, 'agents', agentId);
    const state = await readState(stateDir);
    const now = Date.now();
    const existing = state.agents.find(item => item.id === agentId);

    const agent: FakeAgentRecord = {
        id: agentId,
        name,
        workspace,
        agentDir,
        model,
        createdAtMs: existing?.createdAtMs || now,
        isDefault: agentId === DEFAULT_AGENT_ID
    };

    if (existing) {
        Object.assign(existing, agent);
    } else {
        state.agents.push(agent);
    }

    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(path.join(agentDir, 'sessions'), { recursive: true });
    await writeState(stateDir, state);
    return jsonResult({ id: agentId, agentId });
}

async function handleAgentDelete(args: string[], stateDir: string): Promise<FakeCommandResult> {
    const agentId = sanitizeId(args[0] || '');
    const state = await readState(stateDir);
    state.agents = state.agents.filter(item => item.id !== agentId);
    state.sessions = state.sessions.filter(item => item.agentId !== agentId);
    await writeState(stateDir, state);
    return jsonResult({ ok: true });
}

async function handleCronCommand(args: string[], stateDir: string): Promise<FakeCommandResult> {
    const action = args[0];
    const jobsFilePath = path.join(stateDir, 'cron', 'jobs.json');
    const jobsFile = await readJobsFile(jobsFilePath);

    switch (action) {
        case 'add': {
            const name = readFlagValue(args, '--name') || 'task';
            const now = Date.now();
            const jobId = `job-${slugify(name)}-${now}`;
            const schedule = readSchedule(args);
            const job: CronJobRecord = {
                id: jobId,
                agentId: readFlagValue(args, '--agent'),
                name,
                description: readFlagValue(args, '--description'),
                enabled: !args.includes('--disabled'),
                deleteAfterRun: args.includes('--delete-after-run'),
                createdAtMs: now,
                updatedAtMs: now,
                schedule,
                sessionTarget: (readFlagValue(args, '--session') as 'main' | 'isolated' | undefined) || 'isolated',
                wakeMode: (readFlagValue(args, '--wake') as 'now' | 'next-heartbeat' | undefined) || 'now',
                payload: readPayload(args),
                state: {
                    nextRunAtMs: computeNextRunAt(schedule, now),
                    lastRunStatus: 'idle',
                    lastStatus: 'idle',
                    consecutiveErrors: 0
                }
            };

            jobsFile.jobs.push(job);
            await writeJobsFile(jobsFilePath, jobsFile);
            return jsonResult({ jobId });
        }
        case 'edit': {
            const jobId = args[1];
            const job = jobsFile.jobs.find(item => item.id === jobId);
            if (!job) {
                throw new Error(`Job not found: ${jobId}`);
            }

            job.agentId = args.includes('--clear-agent')
                ? undefined
                : readFlagValue(args, '--agent') ?? job.agentId;
            job.name = readFlagValue(args, '--name') || job.name;
            job.description = readFlagValue(args, '--description') ?? job.description;
            if (args.includes('--enable')) {
                job.enabled = true;
            }
            if (args.includes('--disable')) {
                job.enabled = false;
            }
            if (args.includes('--delete-after-run')) {
                job.deleteAfterRun = true;
            }
            if (args.includes('--keep-after-run')) {
                job.deleteAfterRun = false;
            }
            if (hasAnyFlag(args, ['--every', '--at', '--cron'])) {
                job.schedule = readSchedule(args);
                job.state = {
                    ...job.state,
                    nextRunAtMs: computeNextRunAt(job.schedule, Date.now())
                };
            }
            job.sessionTarget = (readFlagValue(args, '--session') as 'main' | 'isolated' | undefined) || job.sessionTarget;
            job.wakeMode = (readFlagValue(args, '--wake') as 'now' | 'next-heartbeat' | undefined) || job.wakeMode;
            if (hasAnyFlag(args, ['--system-event', '--message'])) {
                job.payload = readPayload(args);
            }
            job.updatedAtMs = Date.now();

            await writeJobsFile(jobsFilePath, jobsFile);
            return emptyResult();
        }
        case 'enable':
        case 'disable': {
            const jobId = args[1];
            const job = jobsFile.jobs.find(item => item.id === jobId);
            if (!job) {
                throw new Error(`Job not found: ${jobId}`);
            }

            job.enabled = action === 'enable';
            job.updatedAtMs = Date.now();
            await writeJobsFile(jobsFilePath, jobsFile);
            return emptyResult();
        }
        case 'run': {
            const jobId = args[1];
            const job = jobsFile.jobs.find(item => item.id === jobId);
            if (!job) {
                throw new Error(`Job not found: ${jobId}`);
            }

            const now = Date.now();
            job.updatedAtMs = now;
            job.state = {
                ...job.state,
                lastRunAtMs: now,
                nextRunAtMs: computeNextRunAt(job.schedule, now),
                lastRunStatus: 'success',
                lastStatus: 'success',
                lastDurationMs: 120,
                lastDeliveryStatus: 'delivered',
                consecutiveErrors: 0
            };

            await writeJobsFile(jobsFilePath, jobsFile);
            const runRecord: OpenClawCronRunRecord = {
                ts: now,
                jobId,
                action: 'run',
                status: 'success',
                summary: 'Fake run completed',
                delivered: true,
                deliveryStatus: 'delivered',
                runAtMs: now,
                nextRunAtMs: computeNextRunAt(job.schedule, now),
                durationMs: 120
            };
            const runsDir = path.join(stateDir, 'cron', 'runs');
            await fs.appendFile(path.join(runsDir, `${jobId}.jsonl`), `${JSON.stringify(runRecord)}\n`, 'utf8');
            return emptyResult();
        }
        case 'rm': {
            const jobId = args[1];
            jobsFile.jobs = jobsFile.jobs.filter(item => item.id !== jobId);
            await writeJobsFile(jobsFilePath, jobsFile);
            return emptyResult();
        }
        default:
            throw new Error(`Unsupported cron action: ${action}`);
    }
}

async function ensureStateDirs(stateDir: string): Promise<void> {
    await fs.mkdir(path.join(stateDir, 'cron', 'runs'), { recursive: true });
    const state = await readState(stateDir);
    if (!state.agents.some(agent => agent.id === DEFAULT_AGENT_ID)) {
        state.agents.unshift(createDefaultAgent(stateDir));
        await writeState(stateDir, state);
    }
}

async function readState(stateDir: string): Promise<FakeState> {
    const statePath = path.join(stateDir, FAKE_STATE_FILE);

    try {
        const content = await fs.readFile(statePath, 'utf8');
        const parsed = JSON.parse(content) as Partial<FakeState>;
        return {
            agents: Array.isArray(parsed.agents) ? parsed.agents : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
        };
    } catch {
        return {
            agents: [],
            sessions: []
        };
    }
}

async function writeState(stateDir: string, state: FakeState): Promise<void> {
    await fs.writeFile(
        path.join(stateDir, FAKE_STATE_FILE),
        JSON.stringify(state, null, 2),
        'utf8'
    );
}

function createDefaultAgent(stateDir: string): FakeAgentRecord {
    return {
        id: DEFAULT_AGENT_ID,
        name: 'Default',
        workspace: path.join(stateDir, 'workspace', DEFAULT_AGENT_ID),
        agentDir: path.join(stateDir, 'agents', DEFAULT_AGENT_ID),
        model: DEFAULT_MODEL,
        createdAtMs: Date.now(),
        isDefault: true
    };
}

async function readSessionMessages(
    stateDir: string,
    sessionKey: string | undefined
): Promise<Array<{ role: string; content: string; timestamp: string }>> {
    if (!sessionKey) {
        return [];
    }

    const state = await readState(stateDir);
    const session = state.sessions.find(item => item.key === sessionKey);
    if (!session) {
        return [];
    }

    try {
        const content = await fs.readFile(
            path.join(stateDir, 'agents', sanitizeId(session.agentId), 'sessions', `${session.sessionId}.jsonl`),
            'utf8'
        );
        return content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                try {
                    return JSON.parse(line) as {
                        message?: {
                            role?: string;
                            content?: string;
                            timestamp?: string;
                        };
                    };
                } catch {
                    return null;
                }
            })
            .filter((entry): entry is { message: { role?: string; content?: string; timestamp?: string } } => Boolean(entry?.message))
            .map(entry => ({
                role: entry.message.role || 'assistant',
                content: entry.message.content || '',
                timestamp: entry.message.timestamp || new Date().toISOString()
            }));
    } catch {
        return [];
    }
}

function buildSessionsUsagePayload(sessions: FakeSessionRecord[]): Record<string, unknown> {
    const date = formatLocalDateKey();
    const totalUserMessages = sessions.reduce((sum, session) => sum + session.messageCountUser, 0);
    const totalAssistantMessages = sessions.reduce((sum, session) => sum + session.messageCountAssistant, 0);

    return {
        updatedAt: Date.now(),
        sessions: sessions.map(session => ({
            key: session.key,
            sessionId: session.sessionId,
            updatedAt: session.updatedAt,
            agentId: session.agentId,
            channel: 'chat',
            modelProvider: 'fake-provider',
            model: session.model,
            usage: {
                input: session.inputTokens,
                output: session.outputTokens,
                totalTokens: session.totalTokens,
                totalCost: session.totalCost,
                dailyBreakdown: [{
                    date,
                    tokens: session.totalTokens,
                    cost: session.totalCost
                }],
                dailyMessageCounts: [{
                    date,
                    total: session.messageCountUser + session.messageCountAssistant,
                    user: session.messageCountUser,
                    assistant: session.messageCountAssistant,
                    errors: 0
                }],
                messageCounts: {
                    total: session.messageCountUser + session.messageCountAssistant,
                    user: session.messageCountUser,
                    assistant: session.messageCountAssistant,
                    errors: 0
                }
            }
        })),
        aggregates: {
            messages: {
                total: totalUserMessages + totalAssistantMessages,
                user: totalUserMessages,
                assistant: totalAssistantMessages,
                errors: 0
            }
        }
    };
}

function buildUsageCostPayload(sessions: FakeSessionRecord[]): Record<string, unknown> {
    const date = formatLocalDateKey();
    const totals = sessions.reduce((accumulator, session) => {
        accumulator.input += session.inputTokens;
        accumulator.output += session.outputTokens;
        accumulator.totalTokens += session.totalTokens;
        accumulator.totalCost = Number((accumulator.totalCost + session.totalCost).toFixed(6));
        return accumulator;
    }, {
        input: 0,
        output: 0,
        totalTokens: 0,
        totalCost: 0
    });

    return {
        daily: [{
            date,
            input: totals.input,
            output: totals.output,
            totalTokens: totals.totalTokens,
            totalCost: totals.totalCost
        }],
        totals
    };
}

async function readJobsFile(filePath: string): Promise<CronJobsFile> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content) as CronJobsFile;
        return {
            version: parsed.version || 1,
            jobs: parsed.jobs || []
        };
    } catch {
        return {
            version: 1,
            jobs: []
        };
    }
}

async function writeJobsFile(filePath: string, payload: CronJobsFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readSchedule(args: string[]): CronSchedule {
    const every = readFlagValue(args, '--every');
    if (every) {
        return {
            kind: 'every',
            everyMs: parseDuration(every)
        };
    }

    const at = readFlagValue(args, '--at');
    if (at) {
        return {
            kind: 'at',
            at
        };
    }

    const expr = readFlagValue(args, '--cron');
    if (expr) {
        return {
            kind: 'cron',
            expr,
            tz: readFlagValue(args, '--tz')
        };
    }

    return {
        kind: 'every',
        everyMs: 600000
    };
}

function readPayload(args: string[]): CronPayload {
    const systemEvent = readFlagValue(args, '--system-event');
    if (systemEvent) {
        return {
            kind: 'systemEvent',
            text: systemEvent
        };
    }

    const timeoutSeconds = readFlagValue(args, '--timeout-seconds');
    return {
        kind: 'agentTurn',
        message: readFlagValue(args, '--message') || '',
        model: readFlagValue(args, '--model'),
        timeoutSeconds: timeoutSeconds ? Number(timeoutSeconds) : undefined
    };
}

function readFlagValue(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0 || index === args.length - 1) {
        return undefined;
    }

    return args[index + 1];
}

function readJsonFlag<T>(args: string[], flag: string): T | undefined {
    const value = readFlagValue(args, flag);
    if (!value) {
        return undefined;
    }

    return JSON.parse(value) as T;
}

function hasAnyFlag(args: string[], flags: string[]): boolean {
    return flags.some(flag => args.includes(flag));
}

function computeNextRunAt(schedule: CronSchedule, now: number): number {
    switch (schedule.kind) {
        case 'at': {
            const parsed = Date.parse(schedule.at);
            return Number.isFinite(parsed) ? parsed : now + 60000;
        }
        case 'cron':
            return now + 3600000;
        case 'every':
        default:
            return now + schedule.everyMs;
    }
}

function parseDuration(value: string): number {
    const normalized = value.trim().toLowerCase();
    const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
        return 600000;
    }

    const amount = Number(match[1]);
    switch (match[2]) {
        case 'ms':
            return amount;
        case 's':
            return amount * 1000;
        case 'm':
            return amount * 60000;
        case 'h':
            return amount * 3600000;
        case 'd':
            return amount * 86400000;
        default:
            return 600000;
    }
}

function extractAgentIdFromSessionKey(sessionKey: string): string | null {
    const parts = sessionKey.trim().split(':').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'agent') {
        return null;
    }

    return sanitizeId(parts[1]);
}

function extractString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : undefined;
}

function sanitizeId(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent';
}

function slugify(value: string): string {
    return sanitizeId(value);
}

function jsonResult(value: unknown): FakeCommandResult {
    return {
        stdout: `${JSON.stringify(value)}\n`,
        stderr: ''
    };
}

function emptyResult(): FakeCommandResult {
    return {
        stdout: '',
        stderr: ''
    };
}

async function main(): Promise<void> {
    const result = await executeFakeOpenClawCommand(
        process.argv.slice(2),
        process.env.OPENCLAW_STATE_DIR || process.cwd()
    );

    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
}

if (require.main === module) {
    void main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exit(1);
    });
}
