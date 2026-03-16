import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import { OpenClawService } from '../services/openclawService';
import {
    OpenClawCliRunner,
    OpenClawCronCommandSchedule,
    OpenClawCronCreateParams,
    OpenClawCronEditParams,
    OpenClawCronJob,
    OpenClawCronPayload,
    OpenClawCronRunRecord,
    OpenClawCronSchedule,
    OpenClawCronSessionTarget,
    OpenClawCronWakeMode
} from '../services/openclawCli';

export type ScheduledTaskRunStatus = 'idle' | 'running' | 'success' | 'failed';

export interface ScheduledTask {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun: boolean;
    createdAt: string;
    updatedAt: string;
    schedule: OpenClawCronSchedule;
    sessionTarget: OpenClawCronSessionTarget;
    wakeMode: OpenClawCronWakeMode;
    payload: OpenClawCronPayload;
    lastRunStatus: ScheduledTaskRunStatus;
    lastRunAt?: string;
    nextRunAt?: string;
    lastRunDurationMs?: number;
    lastRunSummary?: string;
    lastError?: string;
    consecutiveErrors: number;
    lastDeliveryStatus?: string;
}

export interface ScheduledTaskViewState {
    available: boolean;
    message?: string;
    sourcePath?: string;
    tasks: ScheduledTask[];
}

export interface CreateScheduledTaskParams {
    name?: string;
    description?: string;
    agentId?: string;
    scheduleKind?: 'every' | 'at' | 'cron';
    scheduleEvery?: string;
    scheduleAt?: string;
    scheduleCron?: string;
    scheduleTimezone?: string;
    sessionTarget?: OpenClawCronSessionTarget;
    wakeMode?: OpenClawCronWakeMode;
    payloadKind?: 'agentTurn' | 'systemEvent';
    content?: string;
    model?: string;
    timeoutSeconds?: number | string;
    enabled?: boolean;
    deleteAfterRun?: boolean;
}

export interface UpdateScheduledTaskParams extends CreateScheduledTaskParams {}

interface CronJobsFile {
    version?: number;
    jobs?: OpenClawCronJob[];
}

interface NormalizedTaskMutation {
    name: string;
    description?: string;
    agentId?: string;
    enabled: boolean;
    deleteAfterRun: boolean;
    schedule: OpenClawCronCommandSchedule;
    sessionTarget: OpenClawCronSessionTarget;
    wakeMode: OpenClawCronWakeMode;
    payload: OpenClawCronCreateParams['payload'];
}

export class ScheduledTaskManager extends EventEmitter {
    constructor(private readonly service: OpenClawService) {
        super();
    }

    public async getTaskViewState(): Promise<ScheduledTaskViewState> {
        const sourcePath = this.getSourcePath();
        if (!sourcePath) {
            return {
                available: false,
                message: t('tasks.unavailable'),
                tasks: []
            };
        }

        return {
            available: true,
            sourcePath,
            tasks: await this.loadTasks(sourcePath)
        };
    }

    public async getTasks(): Promise<ScheduledTask[]> {
        return (await this.getTaskViewState()).tasks;
    }

    public async getTask(taskId: string): Promise<ScheduledTask | null> {
        const tasks = await this.getTasks();
        return tasks.find(task => task.id === taskId) || null;
    }

    public async createTask(params: CreateScheduledTaskParams): Promise<ScheduledTask> {
        const runner = this.getRunner();
        const mutation = normalizeTaskMutation(params);
        const created = await runner.addCronJob({
            agentId: mutation.agentId,
            name: mutation.name,
            description: mutation.description,
            enabled: mutation.enabled,
            deleteAfterRun: mutation.deleteAfterRun,
            schedule: mutation.schedule,
            sessionTarget: mutation.sessionTarget,
            wakeMode: mutation.wakeMode,
            payload: mutation.payload
        });

        const createdId = extractString(created, ['jobId', 'id']);
        const tasks = await this.waitForTasks(items => {
            if (createdId) {
                return items.some(task => task.id === createdId);
            }

            return items.some(task => task.name === mutation.name);
        });
        const task = createdId
            ? tasks.find(item => item.id === createdId)
            : tasks.find(item => item.name === mutation.name);

        if (!task) {
            throw new Error(t('tasks.notFound', { taskId: createdId || mutation.name }));
        }

        this.emit('taskCreated', task);
        return task;
    }

    public async updateTask(taskId: string, params: UpdateScheduledTaskParams): Promise<ScheduledTask> {
        const existing = await this.getTask(taskId);
        if (!existing) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        const runner = this.getRunner();
        const mutation = normalizeTaskMutation(params, existing);
        const patch: OpenClawCronEditParams = {
            agentId: mutation.agentId,
            name: mutation.name,
            description: mutation.description,
            enabled: mutation.enabled,
            clearAgent: Boolean(existing.agentId && !mutation.agentId),
            deleteAfterRun: mutation.deleteAfterRun,
            schedule: mutation.schedule,
            sessionTarget: mutation.sessionTarget,
            wakeMode: mutation.wakeMode,
            payload: mutation.payload
        };

        await runner.editCronJob(taskId, patch);
        const task = await this.waitForTask(taskId, item => {
            return item.updatedAt !== existing.updatedAt
                || item.name !== existing.name
                || item.enabled !== existing.enabled;
        });

        this.emit('taskUpdated', task);
        return task;
    }

    public async toggleTask(taskId: string, enabled?: boolean): Promise<ScheduledTask> {
        const existing = await this.getTask(taskId);
        if (!existing) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        const nextEnabled = typeof enabled === 'boolean' ? enabled : !existing.enabled;
        const runner = this.getRunner();

        if (nextEnabled) {
            await runner.enableCronJob(taskId);
        } else {
            await runner.disableCronJob(taskId);
        }

        const task = await this.waitForTask(taskId, item => item.enabled === nextEnabled);
        this.emit('taskUpdated', task);
        return task;
    }

    public async deleteTask(taskId: string): Promise<void> {
        const existing = await this.getTask(taskId);
        if (!existing) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        await this.getRunner().removeCronJob(taskId);
        await this.waitForTasks(tasks => tasks.every(task => task.id !== taskId));
        this.emit('taskDeleted', taskId);
    }

    public async runTask(taskId: string, trigger: 'manual' | 'schedule' = 'manual'): Promise<ScheduledTask> {
        const existing = await this.getTask(taskId);
        if (!existing) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        const runningTask = {
            ...existing,
            lastRunStatus: 'running' as const
        };
        this.emit('taskRunStarted', runningTask, trigger);
        this.emit('taskUpdated', runningTask);

        await this.getRunner().runCronJob(taskId);
        const task = await this.waitForTask(taskId, item => {
            return item.lastRunAt !== existing.lastRunAt
                || item.nextRunAt !== existing.nextRunAt
                || item.lastRunSummary !== existing.lastRunSummary
                || item.lastError !== existing.lastError;
        }, 12, 350);

        this.emit('taskRunCompleted', task, trigger);
        this.emit('taskUpdated', task);
        return task;
    }

    public async refresh(): Promise<ScheduledTask[]> {
        return this.getTasks();
    }

    public dispose(): void {
        this.removeAllListeners();
    }

    private getSourcePath(): string | null {
        const config = this.service.getOpenClawConfig();
        if (!config) {
            return null;
        }

        return path.join(config.stateDir, 'cron', 'jobs.json');
    }

    private getRunner(): OpenClawCliRunner {
        const config = this.service.getOpenClawConfig();
        if (!config) {
            throw new Error(t('tasks.unavailable'));
        }

        return new OpenClawCliRunner(config);
    }

    private async waitForTask(
        taskId: string,
        predicate?: (task: ScheduledTask) => boolean,
        attempts: number = 8,
        delayMs: number = 200
    ): Promise<ScheduledTask> {
        let lastTask: ScheduledTask | null = null;

        const tasks = await this.waitForTasks(items => {
            const task = items.find(item => item.id === taskId) || null;
            lastTask = task;
            return Boolean(task && (!predicate || predicate(task)));
        }, attempts, delayMs);

        const task = tasks.find(item => item.id === taskId) || lastTask;
        if (!task) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        return task;
    }

    private async waitForTasks(
        predicate: (tasks: ScheduledTask[]) => boolean,
        attempts: number = 8,
        delayMs: number = 200
    ): Promise<ScheduledTask[]> {
        const sourcePath = this.getSourcePath();
        if (!sourcePath) {
            throw new Error(t('tasks.unavailable'));
        }

        let tasks: ScheduledTask[] = [];
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            tasks = await this.loadTasks(sourcePath);
            if (predicate(tasks)) {
                return tasks;
            }

            if (attempt < attempts - 1) {
                await delay(delayMs);
            }
        }

        return tasks;
    }

    private async loadTasks(sourcePath: string): Promise<ScheduledTask[]> {
        const jobsFile = await readJsonFile<CronJobsFile>(sourcePath);
        const jobs = jobsFile?.jobs || [];
        const runsDir = path.join(path.dirname(sourcePath), 'runs');
        const latestRuns = await readLatestRunRecords(runsDir, jobs.map(job => job.id));

        return sortTasks(jobs.map(job => normalizeTask(job, latestRuns.get(job.id))));
    }
}

function normalizeTask(job: OpenClawCronJob, latestRun: OpenClawCronRunRecord | undefined): ScheduledTask {
    return {
        id: job.id,
        agentId: normalizeOptionalText(job.agentId),
        sessionKey: normalizeOptionalText(job.sessionKey),
        name: job.name,
        description: normalizeOptionalText(job.description),
        enabled: job.enabled !== false,
        deleteAfterRun: Boolean(job.deleteAfterRun),
        createdAt: toIsoTimestamp(job.createdAtMs),
        updatedAt: toIsoTimestamp(job.updatedAtMs),
        schedule: job.schedule,
        sessionTarget: job.sessionTarget,
        wakeMode: job.wakeMode,
        payload: job.payload,
        lastRunStatus: normalizeRunStatus(job.state?.lastRunStatus || job.state?.lastStatus || latestRun?.status),
        lastRunAt: toOptionalIsoTimestamp(job.state?.lastRunAtMs ?? latestRun?.runAtMs),
        nextRunAt: toOptionalIsoTimestamp(job.state?.nextRunAtMs ?? latestRun?.nextRunAtMs),
        lastRunDurationMs: latestRun?.durationMs ?? job.state?.lastDurationMs,
        lastRunSummary: normalizeOptionalText(latestRun?.summary),
        lastError: normalizeOptionalText(latestRun?.error),
        consecutiveErrors: Math.max(0, job.state?.consecutiveErrors || 0),
        lastDeliveryStatus: normalizeOptionalText(latestRun?.deliveryStatus || job.state?.lastDeliveryStatus)
    };
}

function normalizeTaskMutation(
    input: CreateScheduledTaskParams | UpdateScheduledTaskParams,
    fallback?: ScheduledTask
): NormalizedTaskMutation {
    const payloadKind = normalizePayloadKind(input.payloadKind || fallback?.payload.kind);
    const name = normalizeRequiredText(input.name ?? fallback?.name, 'tasks.validation.nameRequired');
    const content = normalizeRequiredText(
        input.content ?? extractPayloadText(fallback?.payload),
        'tasks.validation.contentRequired'
    );

    const schedule = normalizeCommandSchedule(input, fallback);
    const sessionTarget = normalizeSessionTarget(input.sessionTarget || fallback?.sessionTarget, payloadKind);
    const wakeMode = normalizeWakeMode(input.wakeMode || fallback?.wakeMode);
    const deleteAfterRun = schedule.kind === 'at'
        ? Boolean(input.deleteAfterRun ?? fallback?.deleteAfterRun ?? true)
        : Boolean(input.deleteAfterRun ?? fallback?.deleteAfterRun ?? false);
    const enabled = input.enabled ?? fallback?.enabled ?? true;
    const description = normalizeOptionalText(input.description ?? fallback?.description);
    const agentId = normalizeOptionalText(input.agentId ?? fallback?.agentId);

    if (payloadKind === 'systemEvent') {
        return {
            name,
            description,
            agentId,
            enabled,
            deleteAfterRun,
            schedule,
            sessionTarget,
            wakeMode,
            payload: {
                kind: 'systemEvent',
                text: content
            }
        };
    }

    const timeoutSeconds = normalizeOptionalPositiveInteger(
        input.timeoutSeconds ?? extractTimeoutSeconds(fallback?.payload)
    );
    const model = normalizeOptionalText(input.model ?? extractPayloadModel(fallback?.payload));

    return {
        name,
        description,
        agentId,
        enabled,
        deleteAfterRun,
        schedule,
        sessionTarget,
        wakeMode,
        payload: {
            kind: 'agentTurn',
            message: content,
            model,
            timeoutSeconds
        }
    };
}

function normalizeCommandSchedule(
    input: CreateScheduledTaskParams | UpdateScheduledTaskParams,
    fallback?: ScheduledTask
): OpenClawCronCommandSchedule {
    const scheduleKind = input.scheduleKind || fallback?.schedule.kind || 'every';

    switch (scheduleKind) {
        case 'at': {
            const value = normalizeRequiredText(
                input.scheduleAt ?? toLocalDateTimeInputValue(extractScheduleAt(fallback?.schedule)),
                'tasks.validation.scheduleAtRequired'
            );
            const timestamp = Date.parse(value);
            if (!Number.isFinite(timestamp)) {
                throw new Error(t('tasks.validation.scheduleAtInvalid'));
            }

            return {
                kind: 'at',
                at: new Date(timestamp).toISOString()
            };
        }
        case 'cron':
            return {
                kind: 'cron',
                expr: normalizeRequiredText(
                    input.scheduleCron ?? extractScheduleCronExpr(fallback?.schedule),
                    'tasks.validation.scheduleCronRequired'
                ),
                tz: normalizeOptionalText(input.scheduleTimezone ?? extractScheduleCronTimezone(fallback?.schedule))
            };
        case 'every':
        default:
            return {
                kind: 'every',
                every: normalizeRequiredText(
                    input.scheduleEvery ?? formatDurationForInput(extractScheduleEveryMs(fallback?.schedule)),
                    'tasks.validation.scheduleEveryRequired'
                )
            };
    }
}

function normalizePayloadKind(value: string | undefined): 'agentTurn' | 'systemEvent' {
    return value === 'systemEvent' ? 'systemEvent' : 'agentTurn';
}

function normalizeSessionTarget(
    value: OpenClawCronSessionTarget | undefined,
    payloadKind: 'agentTurn' | 'systemEvent'
): OpenClawCronSessionTarget {
    if (value === 'main' || value === 'isolated') {
        return value;
    }

    return payloadKind === 'systemEvent' ? 'main' : 'isolated';
}

function normalizeWakeMode(value: OpenClawCronWakeMode | undefined): OpenClawCronWakeMode {
    return value === 'next-heartbeat' ? 'next-heartbeat' : 'now';
}

function normalizeRunStatus(value: string | undefined): ScheduledTaskRunStatus {
    switch ((value || '').trim().toLowerCase()) {
        case 'running':
        case 'in-progress':
            return 'running';
        case 'ok':
        case 'success':
        case 'completed':
            return 'success';
        case 'error':
        case 'failed':
        case 'failure':
        case 'timeout':
            return 'failed';
        default:
            return 'idle';
    }
}

function extractPayloadText(payload: OpenClawCronPayload | undefined): string | undefined {
    if (!payload) {
        return undefined;
    }

    return payload.kind === 'systemEvent' ? payload.text : payload.message;
}

function extractPayloadModel(payload: OpenClawCronPayload | undefined): string | undefined {
    if (!payload || payload.kind !== 'agentTurn') {
        return undefined;
    }

    return payload.model;
}

function extractTimeoutSeconds(payload: OpenClawCronPayload | undefined): number | undefined {
    if (!payload || payload.kind !== 'agentTurn') {
        return undefined;
    }

    return payload.timeoutSeconds;
}

function extractScheduleEveryMs(schedule: OpenClawCronSchedule | undefined): number | undefined {
    return schedule?.kind === 'every' ? schedule.everyMs : undefined;
}

function extractScheduleAt(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'at' ? schedule.at : undefined;
}

function extractScheduleCronExpr(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'cron' ? schedule.expr : undefined;
}

function extractScheduleCronTimezone(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'cron' ? schedule.tz : undefined;
}

async function readLatestRunRecords(
    runsDir: string,
    jobIds: string[]
): Promise<Map<string, OpenClawCronRunRecord>> {
    const entries = await Promise.all(jobIds.map(async jobId => {
        const record = await readLatestRunRecord(path.join(runsDir, `${jobId}.jsonl`));
        return record ? [jobId, record] as const : null;
    }));

    const records = new Map<string, OpenClawCronRunRecord>();
    for (const entry of entries) {
        if (!entry) {
            continue;
        }

        records.set(entry[0], entry[1]);
    }

    return records;
}

async function readLatestRunRecord(filePath: string): Promise<OpenClawCronRunRecord | null> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split(/\r?\n/);

        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index].trim();
            if (!line) {
                continue;
            }

            try {
                return JSON.parse(line) as OpenClawCronRunRecord;
            } catch {
                continue;
            }
        }

        return null;
    } catch (error) {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

async function readJsonFile<T>(targetPath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(targetPath, 'utf8');
        return JSON.parse(content) as T;
    } catch (error) {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
    return [...tasks].sort((left, right) => {
        if (left.enabled !== right.enabled) {
            return left.enabled ? -1 : 1;
        }

        const leftNext = parseTimestamp(left.nextRunAt) ?? Number.MAX_SAFE_INTEGER;
        const rightNext = parseTimestamp(right.nextRunAt) ?? Number.MAX_SAFE_INTEGER;
        if (leftNext !== rightNext) {
            return leftNext - rightNext;
        }

        return left.name.localeCompare(right.name);
    });
}

function normalizeRequiredText(value: string | undefined, errorKey: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(t(errorKey));
    }

    return normalized;
}

function normalizeOptionalText(value: string | undefined | null): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function normalizeOptionalPositiveInteger(value: string | number | undefined): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(t('tasks.validation.timeoutInvalid'));
    }

    return Math.max(1, Math.round(numeric));
}

function formatDurationForInput(value: number | undefined): string | undefined {
    if (!value || value < 1) {
        return undefined;
    }

    const candidates = [
        { unit: 'd', size: 86_400_000 },
        { unit: 'h', size: 3_600_000 },
        { unit: 'm', size: 60_000 },
        { unit: 's', size: 1_000 }
    ];

    for (const candidate of candidates) {
        if (value % candidate.size === 0) {
            return `${value / candidate.size}${candidate.unit}`;
        }
    }

    return `${Math.max(1, Math.round(value / 60_000))}m`;
}

function toLocalDateTimeInputValue(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoTimestamp(value: number): string {
    return new Date(value).toISOString();
}

function toOptionalIsoTimestamp(value: number | undefined): string | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? new Date(value).toISOString()
        : undefined;
}

function parseTimestamp(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractString(payload: unknown, keys: string[]): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const record = payload as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
