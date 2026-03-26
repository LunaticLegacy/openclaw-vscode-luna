import { EventEmitter } from 'events';

import { t } from '../i18n';
import { AgentPresetScaffolder } from '../services/agentPresetScaffolder';
import { OpenClawService, Agent } from '../services/openclawService';

const MIN_ACTIVE_DISPLAY_MS = 1200;

export interface CreateAgentParams {
    name: string;
    model: string;
    systemPrompt?: string;
    presetId?: string;
    enabledSkills?: string[];
}

export interface UpdateAgentParams {
    name?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    enabledSkills?: string[];
}

/**
 * 智能体名称重复错误
 */
export class DuplicateAgentNameError extends Error {
    public readonly agentName: string;

    /**
     * 创建错误实例
     * @param agentName - 重复的智能体名称
     */
    constructor(agentName: string) {
        super(t('newAgent.duplicateName', { name: agentName }));
        this.name = 'DuplicateAgentNameError';
        this.agentName = agentName;
    }
}

/**
 * 检查错误是否为重复智能体名称错误
 * @param error - 未知错误
 * @returns 是否为 DuplicateAgentNameError
 */
export function isDuplicateAgentNameError(error: unknown): error is DuplicateAgentNameError {
    return error instanceof DuplicateAgentNameError;
}

/**
 * 智能体管理器，负责管理智能体的生命周期、状态同步和活跃状态跟踪
 * 
 * @emits agentCreated - 当智能体被创建时触发
 * @emits agentUpdated - 当智能体被更新时触发
 * @emits agentDeleted - 当智能体被删除时触发
 * @emits activeAgentChanged - 当活跃智能体改变时触发
 * 
 * @example
 * ```typescript
 * const manager = new AgentManager(service, presetScaffolder);
 * const agents = await manager.getAgents();
 * ```
 */
export class AgentManager extends EventEmitter {
    private service: OpenClawService;
    private presetScaffolder?: AgentPresetScaffolder;
    private agents: Map<string, Agent> = new Map();
    private activeAgentId: string | undefined = undefined;
    private runningAgentCounts: Map<string, number> = new Map();
    private reportedAgentStatuses: Map<string, Agent['status']> = new Map();
    private activeDisplayUntil: Map<string, number> = new Map();
    private activeReleaseTimers: Map<string, NodeJS.Timeout> = new Map();
    private serviceConnected: boolean;

    /**
     * 创建 AgentManager 实例
     * @param service - OpenClaw 服务实例
     * @param presetScaffolder - 可选的预设脚手架服务
     */
    constructor(service: OpenClawService, presetScaffolder?: AgentPresetScaffolder) {
        super();
        this.service = service;
        this.presetScaffolder = presetScaffolder;
        this.serviceConnected = service.isConnected();
        this.setupListeners();
    }

    /**
     * 设置服务事件监听器
     */
    private setupListeners() {
        this.service.on('agentCreated', (agent: Agent) => {
            const normalizedAgent = this.storeAgent(agent);
            this.emit('agentCreated', normalizedAgent);
        });

        this.service.on('agentUpdated', (agent: Agent) => {
            const previousAgent = this.agents.get(agent.id) || undefined;
            const normalizedAgent = this.storeAgent(agent);
            if (previousAgent && areAgentsEquivalent(previousAgent, normalizedAgent)) {
                return;
            }
            this.emit('agentUpdated', normalizedAgent);
        });

        this.service.on('agentDeleted', (agentId: string) => {
            this.agents.delete(agentId);
            this.runningAgentCounts.delete(agentId);
            this.reportedAgentStatuses.delete(agentId);
            this.activeDisplayUntil.delete(agentId);
            this.clearActiveReleaseTimer(agentId);
            if (this.activeAgentId === agentId) {
                this.activeAgentId = undefined;
            }
            this.emit('agentDeleted', agentId);
        });

        this.service.on('connectionChange', (connected: boolean) => {
            if (connected === this.serviceConnected) {
                return;
            }

            this.serviceConnected = connected;
            this.republishAgentStatuses();
        });
    }

    /**
     * 获取智能体列表
     * 
     * @param refresh - 是否强制从服务器刷新
     * @returns 智能体列表
     */
    public async getAgents(refresh: boolean = false): Promise<Agent[]> {
        if (refresh || this.agents.size === 0) {
            // 如果强制更新或需要归零，则清除一次agent
            const agents = await this.service.getAgents();
            this.agents.clear();
            this.reportedAgentStatuses.clear();
            // 对于每一个agent执行保存
            agents.forEach((agent: any) => this.storeAgent(agent));
        }
        return Array.from(this.agents.values());
    }

    /**
     * 获取指定智能体
     * 
     * @param agentId - 智能体ID
     * @returns 智能体对象或 undefined
     */
    public async getAgent(agentId: string): Promise<Agent | undefined> {
        if (this.agents.has(agentId)) {
            return this.agents.get(agentId)!;
        }

        const agent = await this.service.getAgent(agentId);
        if (agent) {
            return this.storeAgent(agent);
        }
        return agent;
    }

    /**
     * 创建新智能体
     * 
     * @param params - 创建智能体参数
     * @returns 创建的智能体
     * @throws DuplicateAgentNameError - 当智能体名称重复时抛出
     */
    public async createAgent(params: CreateAgentParams): Promise<Agent> {
        const trimmedName = params.name.trim();
        const existingAgents = await this.getAgents(true);
        const hasDuplicateName = existingAgents.some((agent: any) =>
            agent.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
        );

        if (hasDuplicateName) {
            throw new DuplicateAgentNameError(trimmedName);
        }

        const systemPrompt = params.presetId && this.presetScaffolder
            ? await this.presetScaffolder.buildSystemPrompt({
                presetId: params.presetId,
                requestedName: trimmedName,
                requestedModel: params.model,
                systemPrompt: params.systemPrompt
            })
            : params.systemPrompt;
        const agent = await this.service.createAgent({
            name: trimmedName,
            model: params.model,
            systemPrompt,
            enabledSkills: params.enabledSkills
        });
        if (params.presetId && this.presetScaffolder) {
            try {
                await this.presetScaffolder.applyPresetFiles(agent, {
                    presetId: params.presetId,
                    requestedName: trimmedName,
                    requestedModel: params.model,
                    systemPrompt
                });
            } catch (error) {
                try {
                    await this.service.deleteAgent(agent.id);
                } catch {
                    // Ignore rollback failures and surface the preset scaffold error.
                }
                throw error;
            }
        }
        return this.storeAgent(agent);
    }

    /**
     * 更新智能体
     * 
     * @param agentId - 智能体ID
     * @param params - 更新参数
     * @returns 更新后的智能体
     */
    public async updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = await this.service.updateAgent(agentId, params);
        return this.storeAgent(agent);
    }

    /**
     * 删除智能体
     * 
     * @param agentId - 智能体ID
     * @returns Promise<void>
     */
    public async deleteAgent(agentId: string): Promise<void> {
        await this.service.deleteAgent(agentId);
        this.agents.delete(agentId);
        this.runningAgentCounts.delete(agentId);
        this.reportedAgentStatuses.delete(agentId);
        if (this.activeAgentId === agentId) {
            this.activeAgentId = undefined;
        }
    }

    /**
     * 获取当前活跃的智能体
     * 
     * @returns 活跃的智能体或 undefined
     */
    public getActiveAgent(): Agent | undefined {
        if (!this.activeAgentId) {
            return undefined;
        }
        return this.agents.get(this.activeAgentId) || undefined;
    }

    /**
     * 设置活跃智能体
     * 
     * @param agentId - 智能体ID
     * @returns 是否设置成功
     */
    public setActiveAgent(agentId: string): boolean {
        if (this.agents.has(agentId)) {
            this.activeAgentId = agentId;
            this.emit('activeAgentChanged', agentId);
            return true;
        }
        return false;
    }

    /**
     * 获取活跃智能体的ID
     * 
     * @returns 活跃智能体ID或 undefined
     */
    public getActiveAgentId(): string | undefined {
        return this.activeAgentId;
    }

    /**
     * 开始智能体运行
     * 
     * @param agentId - 智能体ID
     * @returns 是否成功更新状态
     */
    public beginAgentRun(agentId: string): boolean {
        return this.updateAgentRunState(agentId, 1);
    }

    /**
     * 结束智能体运行
     * 
     * @param agentId - 智能体ID
     * @returns 是否成功更新状态
     */
    public endAgentRun(agentId: string): boolean {
        return this.updateAgentRunState(agentId, -1);
    }

    /**
     * 获取智能体总数
     * 
     * @returns 智能体数量
     */
    public getAgentCount(): number {
        return this.agents.size;
    }

    /**
     * 获取活跃状态智能体数量
     * 
     * @returns 活跃智能体数量
     */
    public getActiveAgentCount(): number {
        return Array.from(this.agents.values()).filter((a: any) => a.status === 'active').length;
    }

    /**
     * 搜索智能体
     * 
     * @param query - 搜索关键词
     * @returns 匹配的智能体列表
     */
    public searchAgents(query: string): Agent[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.agents.values()).filter((agent: any) =>
            agent.name.toLowerCase().includes(lowerQuery)
            || agent.model.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * 按模型筛选智能体
     * 
     * @param model - 模型名称
     * @returns 匹配的智能体列表
     */
    public getAgentsByModel(model: string): Agent[] {
        return Array.from(this.agents.values()).filter((agent: any) =>
            agent.model.toLowerCase() === model.toLowerCase()
        );
    }

    /**
     * 刷新智能体列表
     * 
     * @returns 刷新后的智能体列表
     */
    public async refresh(): Promise<Agent[]> {
        return this.getAgents(true);
    }

    /**
     * 释放资源
     */
    public dispose() {
        this.removeAllListeners();
        this.agents.clear();
        this.activeAgentId = undefined;
        this.runningAgentCounts.clear();
        this.reportedAgentStatuses.clear();
        this.activeDisplayUntil.clear();
        for (const timer of this.activeReleaseTimers.values()) {
            clearTimeout(timer);
        }
        this.activeReleaseTimers.clear();
    }

    /**
     * 更新智能体运行状态
     * @param agentId - 智能体ID
     * @param delta - 运行计数变化量
     * @returns 是否成功更新
     */
    private updateAgentRunState(agentId: string, delta: 1 | -1): boolean {
        const agent = this.agents.get(agentId);
        if (!agent || agent.status === 'offline') {
            return false;
        }

        const previousCount = this.runningAgentCounts.get(agentId) || 0;
        const nextCount = Math.max(0, previousCount + delta);
        if (nextCount > 0) {
            this.runningAgentCounts.set(agentId, nextCount);
            this.markAgentActiveDisplay(agentId);
        } else {
            this.runningAgentCounts.delete(agentId);
            this.scheduleActiveRelease(agentId);
        }

        const normalizedAgent = this.normalizeAgentStatus(agent);
        if (normalizedAgent.status !== agent.status) {
            this.agents.set(agentId, normalizedAgent);
            this.emit('agentUpdated', normalizedAgent);
        }

        return previousCount !== nextCount;
    }

    /**
     * 保存智能体数据到本地缓存
     * @param agent - 智能体对象
     * @returns 规范化后的智能体对象
     */
    private storeAgent(agent: Agent): Agent {
        this.reportedAgentStatuses.set(agent.id, agent.status);
        if (agent.status === 'active') {
            this.markAgentActiveDisplay(agent.id);
        } else if (agent.status === 'offline') {
            this.activeDisplayUntil.delete(agent.id);
            this.clearActiveReleaseTimer(agent.id);
        } else {
            this.scheduleActiveRelease(agent.id);
        }
        const normalizedAgent = this.normalizeAgentStatus(agent);
        this.agents.set(normalizedAgent.id, normalizedAgent);
        return normalizedAgent;
    }

    /**
     * 规范化智能体状态
     * @param agent - 智能体对象
     * @returns 规范化后的智能体对象
     */
    private normalizeAgentStatus(agent: Agent): Agent {
        if (!this.serviceConnected) {
            this.activeDisplayUntil.delete(agent.id);
            this.clearActiveReleaseTimer(agent.id);
            return {
                ...agent,
                status: 'offline'
            };
        }

        const reportedStatus = this.reportedAgentStatuses.get(agent.id) || agent.status;
        if (reportedStatus === 'offline') {
            this.activeDisplayUntil.delete(agent.id);
            this.clearActiveReleaseTimer(agent.id);
            return {
                ...agent,
                status: 'offline'
            };
        }

        const hasTrackedRun = (this.runningAgentCounts.get(agent.id) || 0) > 0;
        // Treat backend/local "active" reports as display latches, not sticky state.
        // Otherwise a missing idle event leaves the indicator green indefinitely.
        const shouldStayActive = hasTrackedRun || this.isAgentInDisplayLatch(agent.id);
        if (shouldStayActive) {
            this.scheduleActiveRelease(agent.id);
        }

        return {
            ...agent,
            status: shouldStayActive ? 'active' : 'idle'
        };
    }

    /**
     * 重新发布所有智能体状态
     */
    private republishAgentStatuses(): void {
        for (const [agentId, agent] of this.agents.entries()) {
            const normalizedAgent = this.normalizeAgentStatus(agent);
            if (normalizedAgent.status === agent.status) {
                continue;
            }

            this.agents.set(agentId, normalizedAgent);
            this.emit('agentUpdated', normalizedAgent);
        }
    }

    /**
     * 标记智能体活跃显示状态
     * @param agentId - 智能体ID
     */
    private markAgentActiveDisplay(agentId: string): void {
        this.activeDisplayUntil.set(agentId, Date.now() + MIN_ACTIVE_DISPLAY_MS);
        this.scheduleActiveRelease(agentId);
    }

    /**
     * 检查智能体是否处于显示锁定状态
     * @param agentId - 智能体ID
     * @returns 是否处于锁定状态
     */
    private isAgentInDisplayLatch(agentId: string): boolean {
        return (this.activeDisplayUntil.get(agentId) || 0) > Date.now();
    }

    /**
     * 计划活跃状态释放
     * @param agentId - 智能体ID
     */
    private scheduleActiveRelease(agentId: string): void {
        this.clearActiveReleaseTimer(agentId);

        const releaseAt = this.activeDisplayUntil.get(agentId) || 0;
        if (releaseAt <= Date.now()) {
            this.activeDisplayUntil.delete(agentId);
            return;
        }

        const delayMs = Math.max(0, releaseAt - Date.now());
        this.activeReleaseTimers.set(agentId, setTimeout(() => {
            this.activeReleaseTimers.delete(agentId);
            const agent = this.agents.get(agentId);
            if (!agent) {
                this.activeDisplayUntil.delete(agentId);
                return;
            }

            if (this.isAgentInDisplayLatch(agentId)) {
                this.scheduleActiveRelease(agentId);
                return;
            }

            this.activeDisplayUntil.delete(agentId);
            const normalizedAgent = this.normalizeAgentStatus(agent);
            if (normalizedAgent.status === agent.status) {
                return;
            }

            this.agents.set(agentId, normalizedAgent);
            this.emit('agentUpdated', normalizedAgent);
        }, delayMs));
    }

    /**
     * 清除活跃状态释放定时器
     * @param agentId - 智能体ID
     */
    private clearActiveReleaseTimer(agentId: string): void {
        const timer = this.activeReleaseTimers.get(agentId);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.activeReleaseTimers.delete(agentId);
    }
}

/**
 * 比较两个智能体是否相等
 * @param left - 左侧智能体
 * @param right - 右侧智能体
 * @returns 是否相等
 */
function areAgentsEquivalent(left: Agent, right: Agent): boolean {
    return left.id === right.id
        && left.name === right.name
        && left.model === right.model
        && left.status === right.status
        && left.systemPrompt === right.systemPrompt
        && left.temperature === right.temperature
        && left.maxTokens === right.maxTokens
        && left.workspacePath === right.workspacePath
        && left.createdAt === right.createdAt
        && left.lastActive === right.lastActive
        && left.isDefault === right.isDefault
        && left.providerId === right.providerId
        && left.baseUrl === right.baseUrl
        && left.api === right.api
        && left.apiKey === right.apiKey
        && JSON.stringify(left.enabledSkills || []) === JSON.stringify(right.enabledSkills || []);
}
