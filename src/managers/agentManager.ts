import { t } from '../i18n';
import { OpenClawService, Agent } from '../services/openclawService';
import { EventEmitter } from 'events';
import { AgentPresetScaffolder } from '../services/agentPresetScaffolder';

export interface CreateAgentParams {
    name: string;
    model: string;
    systemPrompt?: string;
    presetId?: string;
}

export interface UpdateAgentParams {
    name?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
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

    constructor(service: OpenClawService, presetScaffolder?: AgentPresetScaffolder) {
        super();
        this.service = service;
        this.presetScaffolder = presetScaffolder;
        this.setupListeners();
    }

    private setupListeners() {
        this.service.on('agentCreated', (agent: Agent) => {
            this.agents.set(agent.id, agent);
            this.emit('agentCreated', agent);
        });

        this.service.on('agentUpdated', (agent: Agent) => {
            this.agents.set(agent.id, agent);
            this.emit('agentUpdated', agent);
        });

        this.service.on('agentDeleted', (agentId: string) => {
            this.agents.delete(agentId);
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
            agents.forEach(agent => this.agents.set(agent.id, agent));
        }
        return Array.from(this.agents.values());
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        // 先查本地缓存
        if (this.agents.has(agentId)) {
            return this.agents.get(agentId)!;
        }
        
        // 从服务器获取
        const agent = await this.service.getAgent(agentId);
        if (agent) {
            this.agents.set(agentId, agent);
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
            systemPrompt
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
        this.agents.set(agent.id, agent);
        return agent;
    }

    public async updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = await this.service.updateAgent(agentId, params);
        this.agents.set(agentId, agent);
        return agent;
    }

    public async deleteAgent(agentId: string): Promise<void> {
        await this.service.deleteAgent(agentId);
        this.agents.delete(agentId);
        if (this.activeAgentId === agentId) {
            this.activeAgentId = null;
        }
    }

    public getActiveAgent(): Agent | null {
        if (!this.activeAgentId) return null;
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

    public getAgentCount(): number {
        return this.agents.size;
    }

    public getActiveAgentCount(): number {
        return Array.from(this.agents.values()).filter(a => a.status === 'active').length;
    }

    public searchAgents(query: string): Agent[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.agents.values()).filter(agent =>
            agent.name.toLowerCase().includes(lowerQuery) ||
            agent.model.toLowerCase().includes(lowerQuery)
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
    }
}
