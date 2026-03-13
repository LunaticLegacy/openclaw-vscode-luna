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

export class DuplicateAgentNameError extends Error {
    public readonly agentName: string;

    constructor(agentName: string) {
        super(t('newAgent.duplicateName', { name: agentName }));
        this.name = 'DuplicateAgentNameError';
        this.agentName = agentName;
    }
}

export function isDuplicateAgentNameError(error: unknown): error is DuplicateAgentNameError {
    return error instanceof DuplicateAgentNameError;
}

export class AgentManager extends EventEmitter {
    private service: OpenClawService;
    private presetScaffolder?: AgentPresetScaffolder;
    private agents: Map<string, Agent> = new Map();
    private activeAgentId: string | null = null;
    private runningAgentCounts: Map<string, number> = new Map();
    private reportedAgentStatuses: Map<string, Agent['status']> = new Map();
    private activeDisplayUntil: Map<string, number> = new Map();
    private activeReleaseTimers: Map<string, NodeJS.Timeout> = new Map();
    private serviceConnected: boolean;

    constructor(service: OpenClawService, presetScaffolder?: AgentPresetScaffolder) {
        super();
        this.service = service;
        this.presetScaffolder = presetScaffolder;
        this.serviceConnected = service.isConnected();
        this.setupListeners();
    }

    private setupListeners() {
        this.service.on('agentCreated', (agent: Agent) => {
            const normalizedAgent = this.storeAgent(agent);
            this.emit('agentCreated', normalizedAgent);
        });

        this.service.on('agentUpdated', (agent: Agent) => {
            const previousAgent = this.agents.get(agent.id) || null;
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
                this.activeAgentId = null;
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

    public async getAgents(refresh: boolean = false): Promise<Agent[]> {
        if (refresh || this.agents.size === 0) {
            const agents = await this.service.getAgents();
            this.agents.clear();
            this.reportedAgentStatuses.clear();
            agents.forEach(agent => this.storeAgent(agent));
        }
        return Array.from(this.agents.values());
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        if (this.agents.has(agentId)) {
            return this.agents.get(agentId)!;
        }

        const agent = await this.service.getAgent(agentId);
        if (agent) {
            return this.storeAgent(agent);
        }
        return agent;
    }

    public async createAgent(params: CreateAgentParams): Promise<Agent> {
        const trimmedName = params.name.trim();
        const existingAgents = await this.getAgents(true);
        const hasDuplicateName = existingAgents.some(agent =>
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

    public async updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = await this.service.updateAgent(agentId, params);
        return this.storeAgent(agent);
    }

    public async deleteAgent(agentId: string): Promise<void> {
        await this.service.deleteAgent(agentId);
        this.agents.delete(agentId);
        this.runningAgentCounts.delete(agentId);
        this.reportedAgentStatuses.delete(agentId);
        if (this.activeAgentId === agentId) {
            this.activeAgentId = null;
        }
    }

    public getActiveAgent(): Agent | null {
        if (!this.activeAgentId) {
            return null;
        }
        return this.agents.get(this.activeAgentId) || null;
    }

    public setActiveAgent(agentId: string): boolean {
        if (this.agents.has(agentId)) {
            this.activeAgentId = agentId;
            this.emit('activeAgentChanged', agentId);
            return true;
        }
        return false;
    }

    public getActiveAgentId(): string | null {
        return this.activeAgentId;
    }

    public beginAgentRun(agentId: string): boolean {
        return this.updateAgentRunState(agentId, 1);
    }

    public endAgentRun(agentId: string): boolean {
        return this.updateAgentRunState(agentId, -1);
    }

    public getAgentCount(): number {
        return this.agents.size;
    }

    public getActiveAgentCount(): number {
        return Array.from(this.agents.values()).filter(a => a.status === 'active').length;
    }

    public searchAgents(query: string): Agent[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.agents.values()).filter(agent =>
            agent.name.toLowerCase().includes(lowerQuery)
            || agent.model.toLowerCase().includes(lowerQuery)
        );
    }

    public getAgentsByModel(model: string): Agent[] {
        return Array.from(this.agents.values()).filter(agent =>
            agent.model.toLowerCase() === model.toLowerCase()
        );
    }

    public async refresh(): Promise<Agent[]> {
        return this.getAgents(true);
    }

    public dispose() {
        this.removeAllListeners();
        this.agents.clear();
        this.activeAgentId = null;
        this.runningAgentCounts.clear();
        this.reportedAgentStatuses.clear();
        this.activeDisplayUntil.clear();
        for (const timer of this.activeReleaseTimers.values()) {
            clearTimeout(timer);
        }
        this.activeReleaseTimers.clear();
    }

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
        const shouldStayActive = reportedStatus === 'active' || hasTrackedRun || this.isAgentInDisplayLatch(agent.id);
        if (shouldStayActive) {
            this.scheduleActiveRelease(agent.id);
        }

        return {
            ...agent,
            status: shouldStayActive ? 'active' : 'idle'
        };
    }

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

    private markAgentActiveDisplay(agentId: string): void {
        this.activeDisplayUntil.set(agentId, Date.now() + MIN_ACTIVE_DISPLAY_MS);
        this.scheduleActiveRelease(agentId);
    }

    private isAgentInDisplayLatch(agentId: string): boolean {
        return (this.activeDisplayUntil.get(agentId) || 0) > Date.now();
    }

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

    private clearActiveReleaseTimer(agentId: string): void {
        const timer = this.activeReleaseTimers.get(agentId);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.activeReleaseTimers.delete(agentId);
    }
}

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
