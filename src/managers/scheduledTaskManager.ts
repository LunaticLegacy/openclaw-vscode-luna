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

/**
 * 计划任务运行状态
 */
export type ScheduledTaskRunStatus = 'idle' | 'running' | 'success' | 'failed';

/**
 * 计划任务接口
 */
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

/**
 * 计划任务视图状态接口
 */
export interface ScheduledTaskViewState {
    available: boolean;
    message?: string;
    sourcePath?: string;
    tasks: ScheduledTask[];
}

/**
 * 创建计划任务参数
 */
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

/**
 * 更新计划任务参数
 */
export interface UpdateScheduledTaskParams extends CreateScheduledTaskParams {}

/**
 * Cron 任务文件结构
 */
interface CronJobsFile {
    version?: number;
    jobs?: OpenClawCronJob[];
}

/**
 * 规范化的任务变更
 */
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

/**
 * 计划任务管理器，负责管理定时任务的创建、更新、删除和执行
 * 
 * @emits taskCreated - 当任务被创建时触发
 * @emits taskUpdated - 当任务被更新时触发
 * @emits taskDeleted - 当任务被删除时触发
 * @emits taskRunStarted - 当任务开始运行时触发
 * @emits taskRunCompleted - 当任务运行完成时触发
 * 
 * @example
 * ```typescript
 * const manager = new ScheduledTaskManager(service);
 * const task = await manager.createTask({ name: 'Daily Report', scheduleKind: 'every', scheduleEvery: '1d' });
 * ```
 */
export class ScheduledTaskManager extends EventEmitter {
    private readonly service: OpenClawService; // OpenClaw 服务实例

    /**
     * 创建 ScheduledTaskManager 实例
     * @param service - OpenClaw 服务实例
     */
    constructor(service: OpenClawService) {
        super();
        this.service = service;
    }

    /**
     * 获取任务视图状态
     * 
     * @returns 任务视图状态
     */
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

    /**
     * 获取所有任务
     * 
     * @returns 任务列表
     */
    public async getTasks(): Promise<ScheduledTask[]> {
        return (await this.getTaskViewState()).tasks;
    }

    /**
     * 获取指定任务
     * 
     * @param taskId - 任务ID
     * @returns 任务对象或 undefined
     */
    public async getTask(taskId: string): Promise<ScheduledTask | undefined> {
        const tasks = await this.getTasks();
        return tasks.find((task: any) => task.id === taskId) || undefined;
    }

    /**
     * 创建新任务
     * 
     * @param params - 创建任务参数
     * @returns 创建的任务
     * @throws Error - 当创建失败时抛出
     */
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
        const tasks = await this.waitForTasks((items: any) => {
            if (createdId) {
                return items.some((task: any) => task.id === createdId);
            }

            return items.some((task: any) => task.name === mutation.name);
        });
        const task = createdId
            ? tasks.find((item: any) => item.id === createdId)
            : tasks.find((item: any) => item.name === mutation.name);

        if (!task) {
            throw new Error(t('tasks.notFound', { taskId: createdId || mutation.name }));
        }

        this.emit('taskCreated', task);
        return task;
    }

    /**
     * 更新任务
     * 
     * @param taskId - 任务ID
     * @param params - 更新参数
     * @returns 更新后的任务
     * @throws Error - 当任务不存在时抛出
     */
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
        const task = await this.waitForTask(taskId, (item: any) => {
            return item.updatedAt !== existing.updatedAt
                || item.name !== existing.name
                || item.enabled !== existing.enabled;
        });

        this.emit('taskUpdated', task);
        return task;
    }

    /**
     * 切换任务启用状态
     * 
     * @param taskId - 任务ID
     * @param enabled - 目标状态，未指定则切换
     * @returns 更新后的任务
     * @throws Error - 当任务不存在时抛出
     */
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

        const task = await this.waitForTask(taskId, (item: any) => item.enabled === nextEnabled);
        this.emit('taskUpdated', task);
        return task;
    }

    /**
     * 删除任务
     * 
     * @param taskId - 任务ID
     * @returns Promise<void>
     * @throws Error - 当任务不存在时抛出
     */
    public async deleteTask(taskId: string): Promise<void> {
        const existing = await this.getTask(taskId);
        if (!existing) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        await this.getRunner().removeCronJob(taskId);
        await this.waitForTasks((tasks: any) => tasks.every((task: any) => task.id !== taskId));
        this.emit('taskDeleted', taskId);
    }

    /**
     * 运行任务
     * 
     * @param taskId - 任务ID
     * @param trigger - 触发方式
     * @returns 运行后的任务
     * @throws Error - 当任务不存在时抛出
     */
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
        const task = await this.waitForTask(taskId, (item: any) => {
            return item.lastRunAt !== existing.lastRunAt
                || item.nextRunAt !== existing.nextRunAt
                || item.lastRunSummary !== existing.lastRunSummary
                || item.lastError !== existing.lastError;
        }, 12, 350);

        this.emit('taskRunCompleted', task, trigger);
        this.emit('taskUpdated', task);
        return task;
    }

    /**
     * 刷新任务列表
     * 
     * @returns 刷新后的任务列表
     */
    public async refresh(): Promise<ScheduledTask[]> {
        return this.getTasks();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.removeAllListeners();
    }

    /**
     * 获取源文件路径
     * @returns 源文件路径或 undefined
     */
    private getSourcePath(): string | undefined {
        const config = this.service.getOpenClawConfig();
        if (!config) {
            return undefined;
        }

        return path.join(config.stateDir, 'cron', 'jobs.json');
    }

    /**
     * 获取 CLI Runner
     * @returns OpenClawCliRunner 实例
     * @throws Error - 当配置不可用时抛出
     */
    private getRunner(): OpenClawCliRunner {
        const config = this.service.getOpenClawConfig();
        if (!config) {
            throw new Error(t('tasks.unavailable'));
        }

        return new OpenClawCliRunner(config);
    }

    /**
     * 等待指定任务满足条件
     * @param taskId - 任务ID
     * @param predicate - 条件函数
     * @param attempts - 尝试次数
     * @param delayMs - 延迟毫秒
     * @returns 满足条件的任务
     * @throws Error - 当任务未找到时抛出
     */
    private async waitForTask(
        taskId: string,
        predicate?: (task: ScheduledTask) => boolean,
        attempts: number = 8,
        delayMs: number = 200
    ): Promise<ScheduledTask> {
        let lastTask: ScheduledTask | undefined = undefined;

        const tasks = await this.waitForTasks((items: any) => {
            const task = items.find((item: any) => item.id === taskId) || undefined;
            lastTask = task;
            return Boolean(task && (!predicate || predicate(task)));
        }, attempts, delayMs);

        const task = tasks.find((item: any) => item.id === taskId) || lastTask;
        if (!task) {
            throw new Error(t('tasks.notFound', { taskId }));
        }

        return task;
    }

    /**
     * 等待任务列表满足条件
     * @param predicate - 条件函数
     * @param attempts - 尝试次数
     * @param delayMs - 延迟毫秒
     * @returns 任务列表
     * @throws Error - 当源路径不可用时抛出
     */
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

    /**
     * 加载任务列表
     * @param sourcePath - 源文件路径
     * @returns 任务列表
     */
    private async loadTasks(sourcePath: string): Promise<ScheduledTask[]> {
        const jobsFile = await readJsonFile<CronJobsFile>(sourcePath);
        const jobs = jobsFile?.jobs || [];
        const runsDir = path.join(path.dirname(sourcePath), 'runs');
        const latestRuns = await readLatestRunRecords(runsDir, jobs.map((job: any) => job.id));

        return sortTasks(jobs.map((job: any) => normalizeTask(job, latestRuns.get(job.id))));
    }
}

/**
 * 规范化任务
 * @param job - Cron 任务
 * @param latestRun - 最新运行记录
 * @returns 规范化的计划任务
 */
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

/**
 * 规范化任务变更
 * @param input - 输入参数
 * @param fallback - 回退任务
 * @returns 规范化的任务变更
 */
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

/**
 * 规范化命令调度
 * @param input - 输入参数
 * @param fallback - 回退任务
 * @returns 规范化的调度配置
 */
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

/**
 * 规范化 Payload 类型
 * @param value - 输入值
 * @returns 规范化后的 payload 类型
 */
function normalizePayloadKind(value: string | undefined): 'agentTurn' | 'systemEvent' {
    return value === 'systemEvent' ? 'systemEvent' : 'agentTurn';
}

/**
 * 规范化会话目标
 * @param value - 输入值
 * @param payloadKind - payload 类型
 * @returns 规范化的会话目标
 */
function normalizeSessionTarget(
    value: OpenClawCronSessionTarget | undefined,
    payloadKind: 'agentTurn' | 'systemEvent'
): OpenClawCronSessionTarget {
    if (value === 'main' || value === 'isolated') {
        return value;
    }

    return payloadKind === 'systemEvent' ? 'main' : 'isolated';
}

/**
 * 规范化唤醒模式
 * @param value - 输入值
 * @returns 规范化的唤醒模式
 */
function normalizeWakeMode(value: OpenClawCronWakeMode | undefined): OpenClawCronWakeMode {
    return value === 'next-heartbeat' ? 'next-heartbeat' : 'now';
}

/**
 * 规范化运行状态
 * @param value - 输入值
 * @returns 规范化的运行状态
 */
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

/**
 * 提取 Payload 文本
 * @param payload - payload 对象
 * @returns 文本内容
 */
function extractPayloadText(payload: OpenClawCronPayload | undefined): string | undefined {
    if (!payload) {
        return undefined;
    }

    return payload.kind === 'systemEvent' ? payload.text : payload.message;
}

/**
 * 提取 Payload 模型
 * @param payload - payload 对象
 * @returns 模型名称
 */
function extractPayloadModel(payload: OpenClawCronPayload | undefined): string | undefined {
    if (!payload || payload.kind !== 'agentTurn') {
        return undefined;
    }

    return payload.model;
}

/**
 * 提取超时秒数
 * @param payload - payload 对象
 * @returns 超时秒数
 */
function extractTimeoutSeconds(payload: OpenClawCronPayload | undefined): number | undefined {
    if (!payload || payload.kind !== 'agentTurn') {
        return undefined;
    }

    return payload.timeoutSeconds;
}

/**
 * 提取调度间隔毫秒
 * @param schedule - 调度配置
 * @returns 间隔毫秒数
 */
function extractScheduleEveryMs(schedule: OpenClawCronSchedule | undefined): number | undefined {
    return schedule?.kind === 'every' ? schedule.everyMs : undefined;
}

/**
 * 提取调度时间点
 * @param schedule - 调度配置
 * @returns 时间点
 */
function extractScheduleAt(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'at' ? schedule.at : undefined;
}

/**
 * 提取 Cron 表达式
 * @param schedule - 调度配置
 * @returns Cron 表达式
 */
function extractScheduleCronExpr(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'cron' ? schedule.expr : undefined;
}

/**
 * 提取 Cron 时区
 * @param schedule - 调度配置
 * @returns 时区
 */
function extractScheduleCronTimezone(schedule: OpenClawCronSchedule | undefined): string | undefined {
    return schedule?.kind === 'cron' ? schedule.tz : undefined;
}

/**
 * 读取最新运行记录
 * @param runsDir - 运行记录目录
 * @param jobIds - 任务ID列表
 * @returns 最新运行记录映射
 */
async function readLatestRunRecords(
    runsDir: string,
    jobIds: string[]
): Promise<Map<string, OpenClawCronRunRecord>> {
    const entries = await Promise.all(jobIds.map(async (jobId: any) => {
        const record = await readLatestRunRecord(path.join(runsDir, `${jobId}.jsonl`));
        return record ? [jobId, record] as const : undefined;
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

/**
 * 读取单个任务的最新运行记录
 * @param filePath - 文件路径
 * @returns 最新运行记录或 undefined
 */
async function readLatestRunRecord(filePath: string): Promise<OpenClawCronRunRecord | undefined> {
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

        return undefined;
    } catch (error) {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === 'ENOENT') {
            return undefined;
        }

        throw error;
    }
}

/**
 * 读取 JSON 文件
 * @param targetPath - 文件路径
 * @returns 解析后的对象或 undefined
 */
async function readJsonFile<T>(targetPath: string): Promise<T | undefined> {
    try {
        const content = await fs.readFile(targetPath, 'utf8');
        return JSON.parse(content) as T;
    } catch (error) {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === 'ENOENT') {
            return undefined;
        }

        throw error;
    }
}

/**
 * 排序任务
 * @param tasks - 任务列表
 * @returns 排序后的任务列表
 */
function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
    return [...tasks].sort((left: any, right: any) => {
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

/**
 * 规范化必填文本
 * @param value - 输入值
 * @param errorKey - 错误消息键
 * @returns 规范化后的文本
 * @throws Error - 当值为空时抛出
 */
function normalizeRequiredText(value: string | undefined, errorKey: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(t(errorKey));
    }

    return normalized;
}

/**
 * 规范化可选文本
 * @param value - 输入值
 * @returns 规范化后的文本或 undefined
 */
function normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

/**
 * 规范化可选正整数
 * @param value - 输入值
 * @returns 规范化后的整数或 undefined
 * @throws Error - 当值无效时抛出
 */
function normalizeOptionalPositiveInteger(value: string | number | undefined): number | undefined {
    if (value === undefined || value === undefined || value === '') {
        return undefined;
    }

    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(t('tasks.validation.timeoutInvalid'));
    }

    return Math.max(1, Math.round(numeric));
}

/**
 * 格式化持续时间为输入值
 * @param value - 毫秒数
 * @returns 格式化后的字符串
 */
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

/**
 * 转换为本地日期时间输入值
 * @param value - ISO 日期字符串
 * @returns 本地日期时间字符串
 */
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

/**
 * 转换为 ISO 时间戳
 * @param value - 毫秒时间戳
 * @returns ISO 字符串
 */
function toIsoTimestamp(value: number): string {
    return new Date(value).toISOString();
}

/**
 * 转换为可选的 ISO 时间戳
 * @param value - 毫秒时间戳
 * @returns ISO 字符串或 undefined
 */
function toOptionalIsoTimestamp(value: number | undefined): string | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? new Date(value).toISOString()
        : undefined;
}

/**
 * 解析时间戳
 * @param value - 日期字符串
 * @returns 毫秒时间戳或 undefined
 */
function parseTimestamp(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 提取字符串
 * @param payload - 对象
 * @param keys - 键列表
 * @returns 字符串值或 undefined
 */
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

/**
 * 延迟
 * @param ms - 毫秒数
 * @returns Promise
 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve: any) => setTimeout(resolve, ms));
}
