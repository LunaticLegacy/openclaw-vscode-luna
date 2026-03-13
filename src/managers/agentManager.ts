import { EventEmitter } from 'events';

import { t } from '../i18n';
import { AgentPresetScaffolder } from '../services/agentPresetScaffolder';
import { OpenClawService, Agent } from '../services/openclawService';

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

    constructor(service: OpenClawService, presetScaffolder?: AgentPresetScaffolder) {
        super();
        this.service = service;
        this.presetScaffolder = presetScaffolder;
        this.setupListeners();
    }

    private setupListeners() {
        this.service.on('agentCreated', (agent: Agent) => {
            const normalizedAgent = this.storeAgent(agent);
            this.emit('agentCreated', normalizedAgent);
        });

        this.service.on('agentUpdated', (agent: Agent) => {
            const normalizedAgent = this.storeAgent(agent);
            this.emit('agentUpdated', normalizedAgent);
        });

        this.service.on('agentDeleted', (agentId: string) => {
            this.agents.delete(agentId);
            this.runningAgentCounts.delete(agentId);
            this.reportedAgentStatuses.delete(agentId);
            if (this.activeAgentId === agentId) {
                this.activeAgentId = null;
            }
            this.emit('agentDeleted', agentId);
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
        } else {
            this.runningAgentCounts.delete(agentId);
        }

        const normalizedAgent = this.normalizeAgentStatus(agent);
        if (normalizedAgent.status === agent.status) {
            return false;
        }

        this.agents.set(agentId, normalizedAgent);
        this.emit('agentUpdated', normalizedAgent);
        return true;
    }

    private storeAgent(agent: Agent): Agent {
        this.reportedAgentStatuses.set(agent.id, agent.status);
        const normalizedAgent = this.normalizeAgentStatus(agent);
        this.agents.set(normalizedAgent.id, normalizedAgent);
        return normalizedAgent;
    }

    private normalizeAgentStatus(agent: Agent): Agent {
        const reportedStatus = this.reportedAgentStatuses.get(agent.id) || agent.status;
        if (reportedStatus === 'offline') {
            return {
                ...agent,
                status: 'offline'
            };
        }

        return {
            ...agent,
            status: (this.runningAgentCounts.get(agent.id) || 0) > 0 || reportedStatus === 'active'
                ? 'active'
                : 'idle'
        };
    }
}
