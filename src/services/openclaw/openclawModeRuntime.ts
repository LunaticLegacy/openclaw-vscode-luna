import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizeEnabledSkills } from '../../config/aiSkills';
import { t } from '../../i18n';
import { OpenClawCliServiceConfig } from '../openclawConfig';
import {
    OpenClawAgentRecord,
    OpenClawCliRunner,
    OpenClawGatewayAgentsResult,
    OpenClawSessionsListEntry,
    OpenClawSessionsListResult,
    OpenClawUsageCostResult
} from '../openclawCli';
import {
    GatewayEventFrame,
    OpenClawGatewayClient
} from '../openclawGatewayClient';
import {
    buildSessionKeyMap,
    delay,
    extractAssistantMessageFromPayload,
    extractString,
    extractTextContent,
    inferOpenClawWorkspacePath,
    isFinalOpenClawAssistantMessage,
    normalizeOpenClawChatHistory,
    normalizeOpenClawGatewayLifecycleEvent,
    normalizeOpenClawGatewayToolEvent,
    normalizeOpenClawSessionLog,
    parseAgentIdFromSessionKey,
    resolveOpenClawRecordWorkspacePath,
    resolvePreferredAgentId,
    sanitizeAgentName,
    withTimeout
} from './helpers';
import {
    buildSessionModelHints,
    mapOpenClawUsage,
    uniqueModelNames
} from './usageService';
import {
    Agent,
    APIUsage,
    ChatMessage,
    ChatSession,
    CreateChatSessionOptions,
    CreateAgentParams,
    DiscoveredChannel,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    ServiceEventSink,
    StreamChunk,
    UpdateAgentParams
} from './types';
import {
    composeAgentSystemPrompt,
    mapDiscoveredChannels,
    normalizeOptionalInteger,
    normalizeOptionalNumber,
    normalizeOptionalString,
    OpenClawAgentSettingsRecord,
    readOpenClawAgentSettings,
    readOpenClawSystemPrompt,
    updateOpenClawIdentityFile,
    writeOpenClawSystemPrompt,
    writeOpenClawAgentSettings
} from './openclawModeRuntimeSupport';
import {
    streamMessageFromSessionLog,
    streamMessageViaGateway
} from './openclawModeRuntimeStreaming';

interface OpenClawAgentsSnapshot {
    agents: Agent[];
    defaultAgentId: string | null;
    mainKey: string | null;
    sessionKeysByAgent: Map<string, string>;
}

interface CachedOpenClawAgentsSnapshot {
    expiresAt: number;
    value: OpenClawAgentsSnapshot;
}

export class OpenClawModeRuntime {
    private readonly runner: OpenClawCliRunner;
    private readonly activeGatewayRuns = new Map<string, { runId: string; abortPromise?: Promise<void> }>();
    private readonly backendActiveRunsByAgent = new Map<string, Set<string>>();
    private readonly backendActiveRunsBySession = new Map<string, Set<string>>();
    private readonly backendRunIds = new Map<string, { agentId: string; sessionKey: string }>();
    private readonly lastKnownAgents = new Map<string, Agent>();
    private defaultAgentId: string | null = null;
    private mainKey: string | null = null;
    private sessionKeysByAgent: Map<string, string> = new Map();
    private sessionEntriesByKey: Map<string, OpenClawSessionsListEntry> = new Map();
    private snapshotCache: CachedOpenClawAgentsSnapshot | null = null;
    private snapshotPromise: Promise<OpenClawAgentsSnapshot> | null = null;
    private activityGatewayClient: OpenClawGatewayClient | null = null;
    private activityGatewayConnectPromise: Promise<void> | null = null;
    private activityGatewayReconnectTimer: NodeJS.Timeout | null = null;
    private disposed = false;

    constructor(
        private readonly config: OpenClawCliServiceConfig,
        private readonly emitEvent: ServiceEventSink
    ) {
        this.runner = new OpenClawCliRunner(config);
        void this.ensureActivityGatewayConnection();
    }

    public async checkConnection(): Promise<boolean> {
        try {
            await this.runner.health();
            void this.ensureActivityGatewayConnection();
            return true;
        } catch {
            return false;
        }
    }

    public async getPreferredAgentId(): Promise<string | null> {
        const snapshot = await this.loadAgentsSnapshot();
        return snapshot.defaultAgentId;
    }

    public async getAgents(): Promise<Agent[]> {
        const snapshot = await this.loadAgentsSnapshot();
        return snapshot.agents;
    }

    public async getAvailableModels(agents?: Agent[]): Promise<string[]> {
        const sourceAgents = agents || (await this.loadAgentsSnapshot()).agents;
        return uniqueModelNames([
            this.config.defaultModel,
            ...sourceAgents.map(agent => agent.model)
        ]);
    }

    public async getAgent(agentId: string): Promise<Agent | null> {
        const agents = await this.getAgents();
        return agents.find(agent => agent.id === agentId) || null;
    }

    public async resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        const agent = typeof agentOrId === 'string'
            ? await this.getAgent(agentOrId)
            : agentOrId;

        if (!agent) {
            return undefined;
        }

        return agent.workspacePath?.trim() || inferOpenClawWorkspacePath(agent.id, this.config);
    }

    public async createAgent(params: CreateAgentParams): Promise<Agent> {
        const created = await this.runner.createAgent(params.name, params.model);
        this.invalidateSnapshotCache();
        const createdAgentId = extractString(created, ['id', 'agentId']);
        const agents = await this.getAgents();
        const agent = agents.find(item => item.id === createdAgentId)
            || agents.find(item => item.name === params.name)
            || {
                id: createdAgentId || sanitizeAgentName(params.name),
                name: params.name,
                model: params.model,
                status: 'idle' as const,
                createdAt: new Date().toISOString(),
                workspacePath: inferOpenClawWorkspacePath(createdAgentId || params.name, this.config)
            };

        this.emitEvent('agentCreated', agent);
        return agent;
    }

    public async updateAgent(agentId: string, params: UpdateAgentParams): Promise<Agent> {
        const agent = await this.getAgent(agentId);
        if (!agent) {
            throw new Error(t('service.agentNotFound'));
        }

        const workspacePath = await this.resolveAgentFolderPath(agent);
        if (!workspacePath) {
            throw new Error(t('agentSettings.noWorkspace'));
        }

        await fs.mkdir(workspacePath, { recursive: true });

        const currentSettings = await readOpenClawAgentSettings(workspacePath);
        const mergedSettings: OpenClawAgentSettingsRecord = {
            ...currentSettings,
            name: normalizeOptionalString(params.name) ?? currentSettings.name ?? agent.name,
            model: normalizeOptionalString(params.model) ?? currentSettings.model ?? agent.model,
            systemPrompt: params.systemPrompt !== undefined
                ? params.systemPrompt
                : currentSettings.systemPrompt ?? agent.systemPrompt,
            temperature: normalizeOptionalNumber(params.temperature) ?? currentSettings.temperature ?? agent.temperature,
            maxTokens: normalizeOptionalInteger(params.maxTokens) ?? currentSettings.maxTokens ?? agent.maxTokens,
            enabledSkills: params.enabledSkills !== undefined
                ? normalizeEnabledSkills(params.enabledSkills)
                : currentSettings.enabledSkills ?? agent.enabledSkills ?? []
        };

        await writeOpenClawAgentSettings(workspacePath, mergedSettings);

        if (params.systemPrompt !== undefined || params.enabledSkills !== undefined) {
            await writeOpenClawSystemPrompt(
                workspacePath,
                composeAgentSystemPrompt(mergedSettings.systemPrompt, mergedSettings.enabledSkills),
            );
        }

        await updateOpenClawIdentityFile(workspacePath, {
            agentId: agent.id,
            name: mergedSettings.name || agent.name,
            model: mergedSettings.model || agent.model
        });

        this.invalidateSnapshotCache();

        const updatedAgent: Agent = {
            ...agent,
            name: mergedSettings.name || agent.name,
            model: mergedSettings.model || agent.model,
            systemPrompt: mergedSettings.systemPrompt,
            temperature: mergedSettings.temperature,
            maxTokens: mergedSettings.maxTokens,
            enabledSkills: mergedSettings.enabledSkills
        };

        this.emitEvent('agentUpdated', updatedAgent);
        return updatedAgent;
    }

    public async deleteAgent(agentId: string): Promise<void> {
        await this.runner.deleteAgent(agentId);
        this.invalidateSnapshotCache();
        this.sessionKeysByAgent.delete(agentId);
        if (this.defaultAgentId === agentId) {
            this.defaultAgentId = null;
        }
        this.emitEvent('agentDeleted', agentId);
    }

    public async createChatSession(agentId: string, options: CreateChatSessionOptions = {}): Promise<ChatSession> {
        const sessionKey = String(options.sessionId || '').trim() || await this.resolveSessionKey(agentId);
        const history = await this.getChatHistory(sessionKey).catch(() => []);
        const now = new Date().toISOString();
        return {
            id: sessionKey,
            agentId,
            messages: history,
            createdAt: history[0]?.timestamp || now,
            updatedAt: history[history.length - 1]?.timestamp || now
        };
    }

    public async sendMessage(
        sessionId: string,
        message: string,
        _options?: SendMessageOptions
    ): Promise<ChatMessage> {
        return this.withObservedFallbackRun(sessionId, async () => {
            const historyBefore = await this.readSessionMessages(sessionId).catch(() => []);
            const knownIds = new Set(historyBefore.map(item => item.id));
            const result = await this.runner.sendChat(sessionId, message);
            const latestAssistant = await this.waitForAssistantMessage(sessionId, knownIds, 4000);
            return latestAssistant
                || extractAssistantMessageFromPayload(result, sessionId)
                || {
                    id: `${sessionId}:${Date.now()}`,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date().toISOString(),
                    agentId: parseAgentIdFromSessionKey(sessionId) || undefined
                };
        });
    }

    public async *streamMessage(
        sessionId: string,
        message: string
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const historyBefore = await this.readSessionMessages(sessionId).catch(() => []);
        const knownIds = new Set(historyBefore.map(item => item.id));

        try {
            yield* streamMessageViaGateway({
                config: this.config,
                runner: this.runner,
                activeGatewayRuns: this.activeGatewayRuns,
                handleObservedRunStart: this.handleObservedRunStart.bind(this),
                handleObservedRunStop: this.handleObservedRunStop.bind(this),
                readSessionMessages: this.readSessionMessages.bind(this),
                waitForAssistantMessage: this.waitForAssistantMessage.bind(this)
            }, sessionId, message, knownIds);
            return;
        } catch {
            yield* streamMessageFromSessionLog({
                config: this.config,
                runner: this.runner,
                activeGatewayRuns: this.activeGatewayRuns,
                handleObservedRunStart: this.handleObservedRunStart.bind(this),
                handleObservedRunStop: this.handleObservedRunStop.bind(this),
                readSessionMessages: this.readSessionMessages.bind(this),
                waitForAssistantMessage: this.waitForAssistantMessage.bind(this)
            }, sessionId, message, knownIds);
        }
    }

    public async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        const fileMessages = await this.readSessionMessages(sessionId);
        if (fileMessages.length > 0) {
            return fileMessages;
        }

        const response = await this.runner.getChatHistory(sessionId, 200);
        return normalizeOpenClawChatHistory(response.messages || [], sessionId);
    }

    public async getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return this.readSessionMessages(sessionId).catch(() => []);
    }

    public clearChatHistory(): Promise<void> {
        return Promise.resolve();
    }

    public async abortSessionRun(sessionId: string): Promise<void> {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
            return;
        }

        const activeRun = this.activeGatewayRuns.get(normalizedSessionId);
        if (activeRun?.abortPromise) {
            await activeRun.abortPromise;
            return;
        }

        const abortPromise: Promise<void> = this.runner.abortChat(normalizedSessionId, activeRun?.runId)
            .then(() => undefined)
            .catch(() => undefined);
        if (activeRun) {
            activeRun.abortPromise = abortPromise;
        } else {
            this.activeGatewayRuns.set(normalizedSessionId, {
                runId: '',
                abortPromise
            });
        }

        try {
            await abortPromise;
        } finally {
            const currentRun = this.activeGatewayRuns.get(normalizedSessionId);
            if (currentRun?.abortPromise === abortPromise) {
                this.activeGatewayRuns.delete(normalizedSessionId);
            }
        }
    }

    public hasActiveRun(sessionId: string): boolean {
        const normalizedSessionId = sessionId.trim();
        return normalizedSessionId
            ? this.activeGatewayRuns.has(normalizedSessionId)
                || (this.backendActiveRunsBySession.get(normalizedSessionId)?.size || 0) > 0
            : false;
    }

    public async getUsage(): Promise<APIUsage> {
        return this.getOpenClawUsage();
    }

    public async getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        const sessions = (await this.runner.listSessions()).sessions || [];
        const now = Date.now();
        const recentSessions = sessions.filter(session => {
            const updatedAt = session.updatedAt || 0;
            return updatedAt > 0 && now - updatedAt < 60000;
        });

        return {
            activeSessions: sessions.length,
            requestsPerMinute: recentSessions.length,
            tokensPerMinute: recentSessions.reduce((sum, session) => sum + (session.totalTokens || 0), 0)
        };
    }

    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        return this.getOpenClawUsage(agentId);
    }

    public getConfig(): OpenClawCliServiceConfig {
        return this.config;
    }

    public async getDiscoveredChannels(): Promise<DiscoveredChannel[]> {
        const result = await this.runner.listChannels().catch(() => null);
        return mapDiscoveredChannels(result);
    }

    public dispose(): void {
        this.disposed = true;
        this.activeGatewayRuns.clear();
        this.backendActiveRunsByAgent.clear();
        this.backendActiveRunsBySession.clear();
        this.backendRunIds.clear();
        this.lastKnownAgents.clear();
        this.defaultAgentId = null;
        this.mainKey = null;
        this.sessionKeysByAgent.clear();
        this.sessionEntriesByKey.clear();
        if (this.activityGatewayReconnectTimer) {
            clearTimeout(this.activityGatewayReconnectTimer);
            this.activityGatewayReconnectTimer = null;
        }
        this.activityGatewayConnectPromise = null;
        this.activityGatewayClient?.dispose();
        this.activityGatewayClient = null;
        this.invalidateSnapshotCache();
    }

    private async loadAgentsSnapshot(
        options: { forceRefresh?: boolean; metadataTimeoutMs?: number } = {}
    ): Promise<OpenClawAgentsSnapshot> {
        const { forceRefresh = false, metadataTimeoutMs = 2500 } = options;

        if (!forceRefresh) {
            const cached = this.snapshotCache;
            if (cached && cached.expiresAt > Date.now()) {
                return cached.value;
            }

            if (this.snapshotPromise) {
                return this.snapshotPromise;
            }
        }

        const loadPromise = this.loadAgentsSnapshotUncached(metadataTimeoutMs)
            .finally(() => {
                if (this.snapshotPromise === loadPromise) {
                    this.snapshotPromise = null;
                }
            });

        this.snapshotPromise = loadPromise;
        return loadPromise;
    }

    private async loadAgentsSnapshotUncached(metadataTimeoutMs: number): Promise<OpenClawAgentsSnapshot> {
        const [records, gatewayAgents, sessionsResult] = await Promise.all([
            this.runner.listAgents(),
            withTimeout<OpenClawGatewayAgentsResult>(
                this.runner.listGatewayAgents().catch((): OpenClawGatewayAgentsResult => ({})),
                metadataTimeoutMs,
                {}
            ),
            withTimeout<OpenClawSessionsListResult>(
                this.runner.listSessions().catch(() => ({ sessions: [] as OpenClawSessionsListEntry[] })),
                metadataTimeoutMs,
                { sessions: [] as OpenClawSessionsListEntry[] }
            )
        ]);

        this.sessionEntriesByKey = new Map(
            (sessionsResult.sessions || [])
                .filter(session => session.key)
                .map(session => [session.key, session] as const)
        );
        const sessionKeysByAgent = buildSessionKeyMap(sessionsResult.sessions || []);
        const defaultAgentId = resolvePreferredAgentId(records, gatewayAgents, sessionKeysByAgent);
        const gatewayNames = new Map(
            (gatewayAgents.agents || [])
                .filter(item => item.id)
                .map(item => [item.id!, item.name?.trim() || item.id!])
        );
        const now = new Date().toISOString();
        const agents: Agent[] = [];
        const seen = new Set<string>();

        for (const record of records) {
            if (!record.id) {
                continue;
            }

            seen.add(record.id);
            agents.push(await this.mapAgentRecord(record, gatewayNames, defaultAgentId, sessionKeysByAgent, now));
        }

        for (const [id, name] of gatewayNames.entries()) {
            if (seen.has(id)) {
                continue;
            }

            agents.push(await this.applyStoredAgentSettings({
                id,
                name,
                model: this.config.defaultModel || 'openclaw',
                status: this.resolveRuntimeAgentStatus(id),
                createdAt: now,
                lastActive: sessionKeysByAgent.has(id) ? now : undefined,
                isDefault: id === defaultAgentId,
                workspacePath: inferOpenClawWorkspacePath(id, this.config)
            }));
        }

        this.defaultAgentId = defaultAgentId;
        this.mainKey = gatewayAgents.mainKey?.trim() || this.mainKey || 'main';
        this.sessionKeysByAgent = sessionKeysByAgent;

        const snapshot = {
            agents: agents.sort((left, right) => {
                if (left.status !== right.status) {
                    return left.status === 'active' ? -1 : 1;
                }
                return left.name.localeCompare(right.name);
            }),
            defaultAgentId,
            mainKey: this.mainKey,
            sessionKeysByAgent
        };

        this.snapshotCache = {
            value: snapshot,
            expiresAt: Date.now() + 5000
        };
        this.lastKnownAgents.clear();
        snapshot.agents.forEach(agent => this.lastKnownAgents.set(agent.id, agent));

        return snapshot;
    }

    private async mapAgentRecord(
        record: OpenClawAgentRecord,
        gatewayNames: Map<string, string>,
        defaultAgentId: string | null,
        sessionKeysByAgent: Map<string, string>,
        now: string
    ): Promise<Agent> {
        return this.applyStoredAgentSettings({
            id: record.id,
            name: record.name?.trim() || gatewayNames.get(record.id) || record.id,
            model: record.model?.trim() || this.config.defaultModel || 'openclaw',
            status: this.resolveRuntimeAgentStatus(record.id),
            createdAt: now,
            lastActive: sessionKeysByAgent.has(record.id) ? now : undefined,
            isDefault: Boolean(record.isDefault || record.id === defaultAgentId),
            workspacePath: resolveOpenClawRecordWorkspacePath(record, this.config)
        });
    }

    private async applyStoredAgentSettings(agent: Agent): Promise<Agent> {
        const workspacePath = agent.workspacePath?.trim();
        if (!workspacePath) {
            return agent;
        }

        const [settings, systemPrompt] = await Promise.all([
            readOpenClawAgentSettings(workspacePath),
            readOpenClawSystemPrompt(workspacePath)
        ]);

        return {
            ...agent,
            name: settings.name || agent.name,
            model: settings.model || agent.model,
            systemPrompt: settings.systemPrompt ?? systemPrompt ?? agent.systemPrompt,
            temperature: settings.temperature ?? agent.temperature,
            maxTokens: settings.maxTokens ?? agent.maxTokens,
            enabledSkills: settings.enabledSkills ?? agent.enabledSkills ?? []
        };
    }

    private async resolveSessionKey(agentId: string): Promise<string> {
        const cached = this.sessionKeysByAgent.get(agentId);
        if (cached) {
            return cached;
        }

        const snapshot = await this.loadAgentsSnapshot();
        const resolved = snapshot.sessionKeysByAgent.get(agentId);
        if (resolved) {
            return resolved;
        }

        const sessionKey = `agent:${agentId}:${snapshot.mainKey?.trim() || this.mainKey || 'main'}`;
        this.sessionKeysByAgent.set(agentId, sessionKey);
        return sessionKey;
    }

    private async readSessionMessages(sessionKey: string, limit: number = 200): Promise<ChatMessage[]> {
        const sessionEntry = await this.resolveSessionEntry(sessionKey);
        if (!sessionEntry?.sessionId) {
            return [];
        }

        const agentId = sessionEntry.agentId || parseAgentIdFromSessionKey(sessionKey) || undefined;
        if (!agentId) {
            return [];
        }

        const sessionFilePath = path.join(
            this.config.stateDir,
            'agents',
            sanitizeAgentName(agentId),
            'sessions',
            `${sessionEntry.sessionId}.jsonl`
        );

        try {
            const content = await fs.readFile(sessionFilePath, 'utf8');
            return normalizeOpenClawSessionLog(content, sessionKey, agentId, limit);
        } catch (error) {
            const maybeNodeError = error as NodeJS.ErrnoException;
            if (maybeNodeError.code === 'ENOENT') {
                return [];
            }

            throw error;
        }
    }

    private async resolveSessionEntry(sessionKey: string): Promise<OpenClawSessionsListEntry | null> {
        const cached = this.sessionEntriesByKey.get(sessionKey);
        if (cached) {
            return cached;
        }

        await this.loadAgentsSnapshot();
        const fromSnapshot = this.sessionEntriesByKey.get(sessionKey);
        if (fromSnapshot) {
            return fromSnapshot;
        }

        const sessionsResult = await this.runner.listSessions().catch(() => ({ sessions: [] as OpenClawSessionsListEntry[] }));
        this.sessionEntriesByKey = new Map(
            (sessionsResult.sessions || [])
                .filter(session => session.key)
                .map(session => [session.key, session] as const)
        );

        return this.sessionEntriesByKey.get(sessionKey) || null;
    }

    private async waitForAssistantMessage(
        sessionKey: string,
        knownIds: Set<string>,
        timeoutMs: number
    ): Promise<ChatMessage | null> {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const messages = await this.readSessionMessages(sessionKey).catch(() => []);
            const assistant = [...messages]
                .reverse()
                .find(message => !knownIds.has(message.id) && isFinalOpenClawAssistantMessage(message));

            if (assistant) {
                return assistant;
            }

            await delay(150);
        }

        return null;
    }

    private async getOpenClawUsage(agentId?: string): Promise<APIUsage> {
        const sessionsUsagePromise = this.runner.getSessionsUsage({
            limit: 1000,
            includeContextWeight: true
        });
        const costPromise = agentId
            ? Promise.resolve<OpenClawUsageCostResult | null>(null)
            : this.runner.getUsageCost({}).then(result => result).catch(() => null);
        const sessionListPromise = this.runner.listSessions().catch(() => ({ sessions: [] as OpenClawSessionsListEntry[] }));
        const agentsPromise = this.getAgents().catch(() => [] as Agent[]);
        const [sessionsUsage, usageCost, sessionList, agents] = await Promise.all([
            sessionsUsagePromise,
            costPromise,
            sessionListPromise,
            agentsPromise
        ]);
        const sessionModels = buildSessionModelHints(sessionList.sessions || []);
        const agentModels = new Map(
            agents
                .filter(agent => agent.id && agent.model)
                .map(agent => [agent.id, agent.model] as const)
        );

        return mapOpenClawUsage(sessionsUsage, usageCost, agentId, {
            sessionModels,
            agentModels,
            defaultModel: this.config.defaultModel
        });
    }

    private async ensureActivityGatewayConnection(): Promise<void> {
        if (this.disposed || !this.config.gatewayUrl) {
            return;
        }

        if (this.activityGatewayClient) {
            return;
        }

        if (this.activityGatewayConnectPromise) {
            return this.activityGatewayConnectPromise;
        }

        const client = new OpenClawGatewayClient({
            url: this.config.gatewayUrl,
            token: this.config.gatewayToken,
            timeoutMs: 30000,
            clientId: 'openclaw-luna-activity-monitor',
            clientDisplayName: 'OpenClaw Luna Activity Monitor',
            clientVersion: 'vscode-plugin',
            caps: ['tool-events']
        });
        this.activityGatewayClient = client;

        const connectPromise = client.connect()
            .catch(() => {
                if (this.activityGatewayClient === client) {
                    this.activityGatewayClient = null;
                }
                this.scheduleActivityGatewayReconnect();
            })
            .finally(() => {
                if (this.activityGatewayConnectPromise === connectPromise) {
                    this.activityGatewayConnectPromise = null;
                }
            });
        this.activityGatewayConnectPromise = connectPromise;

        client.on('event', (event: GatewayEventFrame) => {
            this.handleActivityGatewayEvent(event);
        });
        client.on('error', () => {
            this.scheduleActivityGatewayReconnect();
        });
        client.on('close', (event: { intentional?: boolean }) => {
            if (this.activityGatewayClient === client) {
                this.activityGatewayClient = null;
            }
            if (!event?.intentional) {
                this.scheduleActivityGatewayReconnect();
            }
        });

        await connectPromise;
    }

    private scheduleActivityGatewayReconnect(): void {
        if (this.disposed || !this.config.gatewayUrl || this.activityGatewayReconnectTimer) {
            return;
        }

        this.activityGatewayReconnectTimer = setTimeout(() => {
            this.activityGatewayReconnectTimer = null;
            if (!this.activityGatewayClient) {
                void this.ensureActivityGatewayConnection();
            }
        }, 3000);
    }

    private handleActivityGatewayEvent(event: GatewayEventFrame): void {
        if (event.event !== 'agent' && event.event !== 'chat') {
            return;
        }

        const payload = event.payload && typeof event.payload === 'object'
            ? event.payload as Record<string, unknown>
            : null;
        if (!payload) {
            return;
        }

        const state = this.extractActivityState(payload);
        if (!state) {
            return;
        }

        const sessionKey = this.extractActivitySessionKey(payload);
        const agentId = this.extractActivityAgentId(payload, sessionKey);
        if (!agentId) {
            return;
        }

        const runId = this.extractActivityRunId(payload, sessionKey, agentId);
        if (!runId) {
            return;
        }

        if (isActiveActivityState(state)) {
            this.markBackendRunActive(agentId, sessionKey, runId);
            return;
        }

        if (isInactiveActivityState(state)) {
            this.markBackendRunInactive(agentId, sessionKey, runId);
        }
    }

    private extractActivityAgentId(payload: Record<string, unknown>, sessionKey: string): string | null {
        const directAgentId = this.extractActivityValue(payload, 'agentId');
        if (directAgentId) {
            return directAgentId;
        }

        if (sessionKey) {
            return parseAgentIdFromSessionKey(sessionKey);
        }

        const runId = this.extractActivityValue(payload, 'runId');
        if (runId) {
            const cached = this.backendRunIds.get(runId);
            if (cached?.agentId) {
                return cached.agentId;
            }

            for (const [activeSessionKey, activeRun] of this.activeGatewayRuns.entries()) {
                if (activeRun.runId === runId) {
                    return parseAgentIdFromSessionKey(activeSessionKey);
                }
            }
        }

        return null;
    }

    private extractActivitySessionKey(payload: Record<string, unknown>): string {
        return this.extractActivityValue(payload, 'sessionKey');
    }

    private extractActivityRunId(payload: Record<string, unknown>, sessionKey: string, agentId: string): string {
        return this.extractActivityValue(payload, 'runId') || `${sessionKey || agentId}:backend-run`;
    }

    private extractActivityState(payload: Record<string, unknown>): string {
        return (this.extractActivityNestedValue(payload, 'state') || this.extractActivityNestedValue(payload, 'phase')).toLowerCase();
    }

    private extractActivityValue(payload: Record<string, unknown>, key: string): string {
        const direct = payload[key];
        if (typeof direct === 'string' && direct.trim()) {
            return direct.trim();
        }

        const data = payload.data;
        if (data && typeof data === 'object') {
            const nested = (data as Record<string, unknown>)[key];
            if (typeof nested === 'string' && nested.trim()) {
                return nested.trim();
            }
        }

        return '';
    }

    private extractActivityNestedValue(payload: Record<string, unknown>, key: string): string {
        const direct = payload[key];
        if (typeof direct === 'string' && direct.trim()) {
            return direct.trim();
        }

        const data = payload.data;
        if (data && typeof data === 'object') {
            const nested = (data as Record<string, unknown>)[key];
            if (typeof nested === 'string' && nested.trim()) {
                return nested.trim();
            }
        }

        return '';
    }

    private markBackendRunActive(agentId: string, sessionKey: string, runId: string): void {
        const wasActive = this.isAgentCurrentlyActive(agentId);
        this.backendRunIds.set(runId, { agentId, sessionKey });
        this.addActiveRun(this.backendActiveRunsByAgent, agentId, runId);
        if (sessionKey) {
            this.addActiveRun(this.backendActiveRunsBySession, sessionKey, runId);
        }

        if (!wasActive && this.isAgentCurrentlyActive(agentId)) {
            this.publishAgentStatusChange(agentId);
        }
    }

    private markBackendRunInactive(agentId: string, sessionKey: string, runId: string): void {
        const cached = this.backendRunIds.get(runId);
        const resolvedAgentId = cached?.agentId || agentId;
        const resolvedSessionKey = cached?.sessionKey || sessionKey;
        const wasActive = this.isAgentCurrentlyActive(resolvedAgentId);

        this.backendRunIds.delete(runId);
        this.removeActiveRun(this.backendActiveRunsByAgent, resolvedAgentId, runId);
        if (resolvedSessionKey) {
            this.removeActiveRun(this.backendActiveRunsBySession, resolvedSessionKey, runId);
        }

        if (wasActive && !this.isAgentCurrentlyActive(resolvedAgentId)) {
            this.publishAgentStatusChange(resolvedAgentId);
        }
    }

    private addActiveRun(target: Map<string, Set<string>>, key: string, runId: string): void {
        const runs = target.get(key) || new Set<string>();
        runs.add(runId);
        target.set(key, runs);
    }

    private removeActiveRun(target: Map<string, Set<string>>, key: string, runId: string): void {
        const runs = target.get(key);
        if (!runs) {
            return;
        }

        runs.delete(runId);
        if (runs.size === 0) {
            target.delete(key);
        }
    }

    private resolveRuntimeAgentStatus(agentId: string): Agent['status'] {
        return this.isAgentCurrentlyActive(agentId) ? 'active' : 'idle';
    }

    private isAgentCurrentlyActive(agentId: string): boolean {
        if ((this.backendActiveRunsByAgent.get(agentId)?.size || 0) > 0) {
            return true;
        }

        for (const sessionKey of this.activeGatewayRuns.keys()) {
            if (parseAgentIdFromSessionKey(sessionKey) === agentId) {
                return true;
            }
        }

        return false;
    }

    private publishAgentStatusChange(agentId: string): void {
        this.invalidateSnapshotCache();
        const existingAgent = this.lastKnownAgents.get(agentId);
        if (!existingAgent) {
            return;
        }

        const nextStatus = this.resolveRuntimeAgentStatus(agentId);
        if (existingAgent.status === nextStatus) {
            return;
        }

        const updatedAgent: Agent = {
            ...existingAgent,
            status: nextStatus
        };
        this.lastKnownAgents.set(agentId, updatedAgent);
        this.emitEvent('agentUpdated', updatedAgent);
    }

    private handleObservedRunStart(sessionKey: string, runId: string): void {
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return;
        }

        this.markBackendRunActive(agentId, sessionKey, runId);
    }

    private handleObservedRunStop(sessionKey: string, runId: string): void {
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return;
        }

        this.markBackendRunInactive(agentId, sessionKey, runId);
    }

    private async withObservedFallbackRun<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return operation();
        }

        const runId = `${sessionKey}:fallback:${Date.now()}`;
        this.markBackendRunActive(agentId, sessionKey, runId);

        try {
            return await operation();
        } finally {
            this.markBackendRunInactive(agentId, sessionKey, runId);
        }
    }

    private invalidateSnapshotCache(): void {
        this.snapshotCache = null;
        this.snapshotPromise = null;
    }
}

function isActiveActivityState(value: string): boolean {
    return ['accepted', 'start', 'started', 'running', 'streaming', 'in_flight'].includes(value);
}

function isInactiveActivityState(value: string): boolean {
    return ['abort', 'aborted', 'cancelled', 'complete', 'completed', 'done', 'end', 'ended', 'error', 'failed', 'stop', 'stopped', 'timeout'].includes(value);
}
