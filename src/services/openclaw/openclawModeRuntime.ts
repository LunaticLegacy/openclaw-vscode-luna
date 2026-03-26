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
    RuntimeNotice,
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
import type { GatewayClientCloseEvent, LoadAgentsSnapshotOptions } from '../../types/serviceParams';

interface OpenClawAgentsSnapshot {
    agents: Agent[];
    defaultAgentId: string | undefined;
    mainKey: string | undefined;
    sessionKeysByAgent: Map<string, string>;
}

interface CachedOpenClawAgentsSnapshot {
    expiresAt: number;
    value: OpenClawAgentsSnapshot;
}

interface CachedSessionHistoryEntry {
    filePath: string;
    mtimeMs: number;
    size: number;
    limit: number;
    messages: ChatMessage[];
}

/**
 * Runtime implementation for OpenClaw mode operation.
 * Manages agents, chat sessions, and communication with the OpenClaw CLI.
 */
export class OpenClawModeRuntime {
    private readonly runner: OpenClawCliRunner;
    private readonly activeGatewayRuns = new Map<string, { runId: string; abortPromise?: Promise<void> }>();
    private readonly backendActiveRunsByAgent = new Map<string, Set<string>>();
    private readonly backendActiveRunsBySession = new Map<string, Set<string>>();
    private readonly backendRunIds = new Map<string, { agentId: string; sessionKey: string }>();
    private readonly lastKnownAgents = new Map<string, Agent>();
    private readonly seenRuntimeNoticeKeys = new Set<string>();
    private defaultAgentId: string | undefined = undefined;
    private mainKey: string | undefined = undefined;
    private sessionKeysByAgent: Map<string, string> = new Map();
    private sessionEntriesByKey: Map<string, OpenClawSessionsListEntry> = new Map();
    private snapshotCache: CachedOpenClawAgentsSnapshot | undefined = undefined;
    private snapshotPromise: Promise<OpenClawAgentsSnapshot> | undefined = undefined;
    private activityGatewayClient: OpenClawGatewayClient | undefined = undefined;
    private activityGatewayConnectPromise: Promise<void> | undefined = undefined;
    private activityGatewayReconnectTimer: NodeJS.Timeout | undefined = undefined;
    private readonly sessionHistoryCache = new Map<string, CachedSessionHistoryEntry>();
    private disposed = false;

    /**
     * Creates a new OpenClawModeRuntime instance.
     * @param config - OpenClaw CLI service configuration
     * @param emitEvent - Event sink for service events
     */
    constructor(
        private readonly config: OpenClawCliServiceConfig,
        private readonly emitEvent: ServiceEventSink
    ) {
        this.runner = new OpenClawCliRunner(config);
        void this.ensureActivityGatewayConnection();
    }

    /**
     * Checks if the OpenClaw CLI connection is healthy.
     * @returns True if connection is successful
     */
    public async checkConnection(): Promise<boolean> {
        try {
            await this.runner.health();
            void this.ensureActivityGatewayConnection();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the preferred (default) agent ID.
     * @returns The default agent ID or undefined
     */
    public async getPreferredAgentId(): Promise<string | undefined> {
        const snapshot = await this.loadAgentsSnapshot();
        return snapshot.defaultAgentId;
    }

    /**
     * Gets all available agents.
     * @returns Array of agents
     */
    public async getAgents(): Promise<Agent[]> {
        const snapshot = await this.loadAgentsSnapshot();
        return snapshot.agents;
    }

    /**
     * Gets unique model names from agents.
     * @param agents - Optional agent list to extract models from
     * @returns Array of unique model names
     */
    public async getAvailableModels(agents?: Agent[]): Promise<string[]> {
        const sourceAgents = agents || (await this.loadAgentsSnapshot()).agents;
        return uniqueModelNames([
            this.config.defaultModel,
            ...sourceAgents.map((agent: any) => agent.model)
        ]);
    }

    /**
     * Gets a specific agent by ID.
     * @param agentId - The agent ID to look up
     * @returns The agent or undefined if not found
     */
    public async getAgent(agentId: string): Promise<Agent | undefined> {
        const agents = await this.getAgents();
        return agents.find((agent: any) => agent.id === agentId) || undefined;
    }

    /**
     * Resolves the workspace folder path for an agent.
     * @param agentOrId - Agent ID or agent object
     * @returns The workspace path or undefined
     */
    public async resolveAgentFolderPath(agentOrId: string | Agent): Promise<string | undefined> {
        const agent = typeof agentOrId === 'string'
            ? await this.getAgent(agentOrId)
            : agentOrId;

        if (!agent) {
            return undefined;
        }

        return agent.workspacePath?.trim() || inferOpenClawWorkspacePath(agent.id, this.config);
    }

    /**
     * Creates a new agent.
     * @param params - Agent creation parameters
     * @returns The created agent
     */
    public async createAgent(params: CreateAgentParams): Promise<Agent> {
        const created = await this.runner.createAgent(params.name, params.model);
        this.invalidateSnapshotCache();
        const createdAgentId = extractString(created, ['id', 'agentId']);
        const agents = await this.getAgents();
        const agent = agents.find((item: any) => item.id === createdAgentId)
            || agents.find((item: any) => item.name === params.name)
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

    /**
     * Updates an existing agent.
     * @param agentId - The agent ID to update
     * @param params - Update parameters
     * @returns The updated agent
     */
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

    /**
     * Deletes an agent.
     * @param agentId - The agent ID to delete
     */
    public async deleteAgent(agentId: string): Promise<void> {
        await this.runner.deleteAgent(agentId);
        this.invalidateSnapshotCache();
        this.sessionKeysByAgent.delete(agentId);
        if (this.defaultAgentId === agentId) {
            this.defaultAgentId = undefined;
        }
        this.emitEvent('agentDeleted', agentId);
    }

    /**
     * Creates a new chat session for an agent.
     * @param agentId - The agent ID
     * @param options - Optional session creation options
     * @returns The chat session
     */
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

    /**
     * Sends a message and returns the complete response.
     * @param sessionId - The session ID
     * @param message - The message content
     * @param _options - Optional send options (unused)
     * @returns The assistant's response message
     */
    public async sendMessage(
        sessionId: string,
        message: string,
        _options?: SendMessageOptions
    ): Promise<ChatMessage> {
        return this.withObservedFallbackRun(sessionId, async () => {
            const historyBefore = await this.readSessionMessages(sessionId).catch(() => []);
            const knownIds = new Set(historyBefore.map((item: any) => item.id));
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

    /**
     * Sends a message and streams the response.
     * @param sessionId - The session ID
     * @param message - The message content
     * @returns Async generator of stream chunks
     */
    public async *streamMessage(
        sessionId: string,
        message: string
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const historyBefore = await this.readSessionMessages(sessionId).catch(() => []);
        const knownIds = new Set(historyBefore.map((item: any) => item.id));

        try {
            for await (const chunk of streamMessageViaGateway({
                config: this.config,
                runner: this.runner,
                activeGatewayRuns: this.activeGatewayRuns,
                handleObservedRunStart: this.handleObservedRunStart.bind(this),
                handleObservedRunStop: this.handleObservedRunStop.bind(this),
                readSessionMessages: this.readSessionMessages.bind(this),
                waitForAssistantMessage: this.waitForAssistantMessage.bind(this)
            }, sessionId, message, knownIds)) {
                this.publishRuntimeNoticeFromMessage(chunk.message, sessionId);
                yield chunk;
            }
            return;
        } catch {
            for await (const chunk of streamMessageFromSessionLog({
                config: this.config,
                runner: this.runner,
                activeGatewayRuns: this.activeGatewayRuns,
                handleObservedRunStart: this.handleObservedRunStart.bind(this),
                handleObservedRunStop: this.handleObservedRunStop.bind(this),
                readSessionMessages: this.readSessionMessages.bind(this),
                waitForAssistantMessage: this.waitForAssistantMessage.bind(this)
            }, sessionId, message, knownIds)) {
                this.publishRuntimeNoticeFromMessage(chunk.message, sessionId);
                yield chunk;
            }
        }
    }

    /**
     * Gets the chat history for a session.
     * @param sessionId - The session ID
     * @returns Array of chat messages
     */
    public async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
        const fileMessages = await this.readSessionMessages(sessionId);
        if (fileMessages.length > 0) {
            return fileMessages;
        }

        const response = await this.runner.getChatHistory(sessionId, 200);
        return normalizeOpenClawChatHistory(response.messages || [], sessionId);
    }

    /**
     * Gets the live chat history for a session.
     * @param sessionId - The session ID
     * @returns Array of chat messages
     */
    public async getLiveChatHistory(sessionId: string): Promise<ChatMessage[]> {
        return this.readSessionMessages(sessionId).catch(() => []);
    }

    /**
     * Clears the chat history for a session.
     * @returns Empty promise (no-op for OpenClaw mode)
     */
    public clearChatHistory(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Aborts any active run for a session.
     * @param sessionId - The session ID to abort
     */
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

    /**
     * Checks if a session has an active run.
     * @param sessionId - The session ID to check
     * @returns True if an active run exists
     */
    public hasActiveRun(sessionId: string): boolean {
        const normalizedSessionId = sessionId.trim();
        return normalizedSessionId
            ? this.activeGatewayRuns.has(normalizedSessionId)
                || (this.backendActiveRunsBySession.get(normalizedSessionId)?.size || 0) > 0
            : false;
    }

    /**
     * Gets overall API usage statistics.
     * @returns API usage data
     */
    public async getUsage(): Promise<APIUsage> {
        return this.getOpenClawUsage();
    }

    /**
     * Gets real-time usage snapshot.
     * @returns Realtime usage statistics
     */
    public async getRealtimeUsage(): Promise<RealtimeUsageSnapshot> {
        const sessions = (await this.runner.listSessions()).sessions || [];
        const now = Date.now();
        const recentSessions = sessions.filter((session: any) => {
            const updatedAt = session.updatedAt || 0;
            return updatedAt > 0 && now - updatedAt < 60000;
        });

        return {
            activeSessions: sessions.length,
            requestsPerMinute: recentSessions.length,
            tokensPerMinute: recentSessions.reduce((sum: any, session: any) => sum + (session.totalTokens || 0), 0)
        };
    }

    /**
     * Gets usage statistics for a specific agent.
     * @param agentId - The agent ID
     * @returns API usage data for the agent
     */
    public async getUsageByAgent(agentId: string): Promise<APIUsage> {
        return this.getOpenClawUsage(agentId);
    }

    /**
     * Gets the current runtime configuration.
     * @returns The OpenClaw CLI service configuration
     */
    public getConfig(): OpenClawCliServiceConfig {
        return this.config;
    }

    /**
     * Gets discovered channels from OpenClaw.
     * @returns Array of discovered channels
     */
    public async getDiscoveredChannels(): Promise<DiscoveredChannel[]> {
        const result = await this.runner.listChannels().catch(() => undefined);
        return mapDiscoveredChannels(result);
    }

    /**
     * Disposes of the runtime and cleans up resources.
     */
    public dispose(): void {
        this.disposed = true;
        this.activeGatewayRuns.clear();
        this.backendActiveRunsByAgent.clear();
        this.backendActiveRunsBySession.clear();
        this.backendRunIds.clear();
        this.lastKnownAgents.clear();
        this.seenRuntimeNoticeKeys.clear();
        this.defaultAgentId = undefined;
        this.mainKey = undefined;
        this.sessionKeysByAgent.clear();
        this.sessionEntriesByKey.clear();
        this.sessionHistoryCache.clear();
        if (this.activityGatewayReconnectTimer) {
            clearTimeout(this.activityGatewayReconnectTimer);
            this.activityGatewayReconnectTimer = undefined;
        }
        this.activityGatewayConnectPromise = undefined;
        this.activityGatewayClient?.dispose();
        this.activityGatewayClient = undefined;
        this.invalidateSnapshotCache();
    }

    /**
     * Loads the agents snapshot, using cache if available.
     * @param options - Optional loading options
     * @returns The agents snapshot
     */
    private async loadAgentsSnapshot(options: LoadAgentsSnapshotOptions = {}): Promise<OpenClawAgentsSnapshot> {
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
                    this.snapshotPromise = undefined;
                }
            });

        this.snapshotPromise = loadPromise;
        return loadPromise;
    }

    /**
     * Loads the agents snapshot from scratch.
     * @param metadataTimeoutMs - Timeout for metadata requests
     * @returns The agents snapshot
     */
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
                .filter((session: any) => session.key)
                .map((session: any) => [session.key, session] as const)
        );
        const sessionKeysByAgent = buildSessionKeyMap(sessionsResult.sessions || []);
        const defaultAgentId = resolvePreferredAgentId(records, gatewayAgents, sessionKeysByAgent);
        const gatewayNames = new Map(
            (gatewayAgents.agents || [])
                .filter((item: any) => item.id)
                .map((item: any) => [item.id!, item.name?.trim() || item.id!])
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
            agents: agents.sort((left: any, right: any) => {
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
        snapshot.agents.forEach((agent: any) => this.lastKnownAgents.set(agent.id, agent));

        return snapshot;
    }

    /**
     * Maps an OpenClaw agent record to an Agent object.
     * @param record - The OpenClaw agent record
     * @param gatewayNames - Map of gateway agent names
     * @param defaultAgentId - The default agent ID
     * @param sessionKeysByAgent - Map of session keys by agent
     * @param now - Current timestamp string
     * @returns The mapped Agent
     */
    private async mapAgentRecord(
        record: OpenClawAgentRecord,
        gatewayNames: Map<string, string>,
        defaultAgentId: string | undefined,
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

    /**
     * Applies stored agent settings from workspace files.
     * @param agent - The agent to apply settings to
     * @returns The agent with applied settings
     */
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

    /**
     * Resolves the session key for an agent.
     * @param agentId - The agent ID
     * @returns The session key
     */
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

    /**
     * Reads messages from a session log file.
     * @param sessionKey - The session key
     * @param limit - Maximum number of messages to read
     * @returns Array of chat messages
     */
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
            const stats = await fs.stat(sessionFilePath);
            const cached = this.sessionHistoryCache.get(sessionKey);
            if (cached
                && cached.filePath === sessionFilePath
                && cached.mtimeMs === stats.mtimeMs
                && cached.size === stats.size
                && cached.limit >= limit) {
                return cloneRuntimeChatMessages(limitMessages(cached.messages, limit));
            }

            const content = await fs.readFile(sessionFilePath, 'utf8');
            const messages = normalizeOpenClawSessionLog(content, sessionKey, agentId, limit);
            this.sessionHistoryCache.set(sessionKey, {
                filePath: sessionFilePath,
                mtimeMs: stats.mtimeMs,
                size: stats.size,
                limit,
                messages: cloneRuntimeChatMessages(messages)
            });
            return messages;
        } catch (error) {
            const maybeNodeError = error as NodeJS.ErrnoException;
            if (maybeNodeError.code === 'ENOENT') {
                this.sessionHistoryCache.delete(sessionKey);
                return [];
            }

            throw error;
        }
    }

    /**
     * Resolves the session entry for a session key.
     * @param sessionKey - The session key
     * @returns The session entry or undefined
     */
    private async resolveSessionEntry(sessionKey: string): Promise<OpenClawSessionsListEntry | undefined> {
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
                .filter((session: any) => session.key)
                .map((session: any) => [session.key, session] as const)
        );

        return this.sessionEntriesByKey.get(sessionKey) || undefined;
    }

    /**
     * Waits for a new assistant message to appear in the session.
     * @param sessionKey - The session key
     * @param knownIds - Set of already known message IDs
     * @param timeoutMs - Timeout in milliseconds
     * @returns The assistant message or undefined if timeout
     */
    private async waitForAssistantMessage(
        sessionKey: string,
        knownIds: Set<string>,
        timeoutMs: number
    ): Promise<ChatMessage | undefined> {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const messages = await this.readSessionMessages(sessionKey).catch(() => []);
            const assistant = [...messages]
                .reverse()
                .find((message: any) => !knownIds.has(message.id) && isFinalOpenClawAssistantMessage(message));

            if (assistant) {
                return assistant;
            }

            await delay(150);
        }

        return undefined;
    }

    /**
     * Gets OpenClaw usage statistics.
     * @param agentId - Optional agent ID to filter by
     * @returns API usage data
     */
    private async getOpenClawUsage(agentId?: string): Promise<APIUsage> {
        const sessionsUsagePromise = this.runner.getSessionsUsage({
            limit: 1000,
            includeContextWeight: true
        });
        const costPromise = agentId
            ? Promise.resolve<OpenClawUsageCostResult | undefined>(undefined)
            : this.runner.getUsageCost({}).then((result: any) => result).catch(() => undefined);
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
                .filter((agent: any) => agent.id && agent.model)
                .map((agent: any) => [agent.id, agent.model] as const)
        );

        return mapOpenClawUsage(sessionsUsage, usageCost, agentId, {
            sessionModels,
            agentModels,
            defaultModel: this.config.defaultModel
        });
    }

    /**
     * Ensures connection to the activity gateway.
     */
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
            clientDisplayName: 'OpenClaw Luna Activity Monitor',
            clientVersion: 'vscode-plugin',
            caps: ['tool-events']
        });
        this.activityGatewayClient = client;

        const connectPromise = client.connect()
            .catch(() => {
                if (this.activityGatewayClient === client) {
                    this.activityGatewayClient = undefined;
                }
                this.scheduleActivityGatewayReconnect();
            })
            .finally(() => {
                if (this.activityGatewayConnectPromise === connectPromise) {
                    this.activityGatewayConnectPromise = undefined;
                }
            });
        this.activityGatewayConnectPromise = connectPromise;

        client.on('event', (event: GatewayEventFrame) => {
            this.handleActivityGatewayEvent(event);
        });
        client.on('error', () => {
            this.scheduleActivityGatewayReconnect();
        });
        client.on('close', (event: GatewayClientCloseEvent) => {
            if (this.activityGatewayClient === client) {
                this.activityGatewayClient = undefined;
            }
            if (!event?.intentional) {
                this.scheduleActivityGatewayReconnect();
            }
        });

        await connectPromise;
    }

    /**
     * Schedules a reconnection to the activity gateway.
     */
    private scheduleActivityGatewayReconnect(): void {
        if (this.disposed || !this.config.gatewayUrl || this.activityGatewayReconnectTimer) {
            return;
        }

        this.activityGatewayReconnectTimer = setTimeout(() => {
            this.activityGatewayReconnectTimer = undefined;
            if (!this.activityGatewayClient) {
                void this.ensureActivityGatewayConnection();
            }
        }, 3000);
    }

    /**
     * Handles events from the activity gateway.
     * @param event - The gateway event frame
     */
    private handleActivityGatewayEvent(event: GatewayEventFrame): void {
        if (event.event !== 'agent' && event.event !== 'chat') {
            return;
        }

        const payload = event.payload && typeof event.payload === 'object'
            ? event.payload as Record<string, unknown>
            : undefined;
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

        this.publishRuntimeNoticeFromLifecyclePayload(sessionKey, payload);

        if (isActiveActivityState(state)) {
            this.markBackendRunActive(agentId, sessionKey, runId);
            return;
        }

        if (isInactiveActivityState(state)) {
            this.markBackendRunInactive(agentId, sessionKey, runId);
        }
    }

    /**
     * Extracts the agent ID from an activity event payload.
     * @param payload - The event payload
     * @param sessionKey - The session key
     * @returns The agent ID or undefined
     */
    private extractActivityAgentId(payload: Record<string, unknown>, sessionKey: string): string | undefined {
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

        return undefined;
    }

    /**
     * Extracts the session key from an activity event payload.
     * @param payload - The event payload
     * @returns The session key
     */
    private extractActivitySessionKey(payload: Record<string, unknown>): string {
        return this.extractActivityValue(payload, 'sessionKey');
    }

    /**
     * Extracts the run ID from an activity event payload.
     * @param payload - The event payload
     * @param sessionKey - The session key
     * @param agentId - The agent ID
     * @returns The run ID
     */
    private extractActivityRunId(payload: Record<string, unknown>, sessionKey: string, agentId: string): string {
        return this.extractActivityValue(payload, 'runId') || `${sessionKey || agentId}:backend-run`;
    }

    /**
     * Extracts the activity state from an event payload.
     * @param payload - The event payload
     * @returns The activity state
     */
    private extractActivityState(payload: Record<string, unknown>): string {
        return (this.extractActivityNestedValue(payload, 'state') || this.extractActivityNestedValue(payload, 'phase')).toLowerCase();
    }

    /**
     * Extracts a value from an activity event payload.
     * @param payload - The event payload
     * @param key - The key to extract
     * @returns The extracted value
     */
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

    /**
     * Extracts a nested value from an activity event payload.
     * @param payload - The event payload
     * @param key - The key to extract
     * @returns The extracted value
     */
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

    /**
     * Marks a backend run as active.
     * @param agentId - The agent ID
     * @param sessionKey - The session key
     * @param runId - The run ID
     */
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

    /**
     * Marks a backend run as inactive.
     * @param agentId - The agent ID
     * @param sessionKey - The session key
     * @param runId - The run ID
     */
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

    /**
     * Adds an active run to the tracking map.
     * @param target - The tracking map
     * @param key - The key to add under
     * @param runId - The run ID to add
     */
    private addActiveRun(target: Map<string, Set<string>>, key: string, runId: string): void {
        const runs = target.get(key) || new Set<string>();
        runs.add(runId);
        target.set(key, runs);
    }

    /**
     * Removes an active run from the tracking map.
     * @param target - The tracking map
     * @param key - The key to remove from
     * @param runId - The run ID to remove
     */
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

    /**
     * Resolves the runtime status for an agent.
     * @param agentId - The agent ID
     * @returns The agent status
     */
    private resolveRuntimeAgentStatus(agentId: string): Agent['status'] {
        return this.isAgentCurrentlyActive(agentId) ? 'active' : 'idle';
    }

    /**
     * Checks if an agent is currently active.
     * @param agentId - The agent ID
     * @returns True if the agent is active
     */
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

    /**
     * Publishes an agent status change event.
     * @param agentId - The agent ID
     */
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

    /**
     * Handles the start of an observed run.
     * @param sessionKey - The session key
     * @param runId - The run ID
     */
    private handleObservedRunStart(sessionKey: string, runId: string): void {
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return;
        }

        this.markBackendRunActive(agentId, sessionKey, runId);
    }

    /**
     * Handles the stop of an observed run.
     * @param sessionKey - The session key
     * @param runId - The run ID
     */
    private handleObservedRunStop(sessionKey: string, runId: string): void {
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return;
        }

        this.markBackendRunInactive(agentId, sessionKey, runId);
    }

    /**
     * Wraps an operation with observed run tracking.
     * @param sessionKey - The session key
     * @param operation - The operation to wrap
     * @returns The operation result
     */
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

    /**
     * Invalidates the agents snapshot cache.
     */
    private invalidateSnapshotCache(): void {
        this.snapshotCache = undefined;
        this.snapshotPromise = undefined;
    }

    /**
     * Publishes runtime notices from a lifecycle payload.
     * @param sessionKey - The session key
     * @param payload - The lifecycle payload
     */
    private publishRuntimeNoticeFromLifecyclePayload(sessionKey: string, payload: Record<string, unknown>): void {
        const lifecycleMessage = normalizeOpenClawGatewayLifecycleEvent(sessionKey, payload);
        this.publishRuntimeNoticeFromMessage(lifecycleMessage, sessionKey);
    }

    /**
     * Publishes runtime notices from a message.
     * @param message - The message to publish from
     * @param sessionId - The session ID
     */
    private publishRuntimeNoticeFromMessage(message: ChatMessage | undefined, sessionId?: string): void {
        if (!message || message.metadata?.noticeType !== 'lifecycle') {
            return;
        }

        const kind = typeof message.metadata?.noticeKind === 'string'
            ? message.metadata.noticeKind
            : '';
        if (kind !== 'fallback' && kind !== 'compression') {
            return;
        }

        const noticeKey = String(message.id || `${kind}:${message.agentId || ''}:${message.content}`);
        if (this.seenRuntimeNoticeKeys.has(noticeKey)) {
            return;
        }
        this.seenRuntimeNoticeKeys.add(noticeKey);

        const notice: RuntimeNotice = {
            kind,
            message: message.content,
            agentId: message.agentId,
            sessionId: sessionId?.trim() || undefined,
            phase: typeof message.metadata?.phase === 'string' ? message.metadata.phase : undefined
        };
        this.emitEvent('runtimeNotice', notice);
    }
}

/**
 * Checks if a state represents an active activity.
 * @param value - The state value to check
 * @returns True if the state is active
 */
export function isActiveActivityState(value: string): boolean {
    return [
        'accepted',
        'start',
        'started',
        'running',
        'streaming',
        'in_flight',
        'compact',
        'compaction',
        'compacting',
        'compress',
        'compressed',
        'compressing',
        'compression',
        'context_refresh',
        'context-refresh',
        'refreshing_context',
        'rollback',
        'rolling_back',
        'rolling-back',
        'rewind',
        'rewinding',
        'revert',
        'reverting'
    ].includes(value);
}

/**
 * Checks if a state represents an inactive activity.
 * @param value - The state value to check
 * @returns True if the state is inactive
 */
export function isInactiveActivityState(value: string): boolean {
    return ['abort', 'aborted', 'cancelled', 'complete', 'completed', 'done', 'end', 'ended', 'error', 'failed', 'stop', 'stopped', 'timeout'].includes(value);
}

function limitMessages(messages: ChatMessage[], limit: number): ChatMessage[] {
    if (limit <= 0 || messages.length <= limit) {
        return messages;
    }

    return messages.slice(-limit);
}

function cloneRuntimeChatMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((message: any) => ({
        ...message,
        parts: Array.isArray(message?.parts)
            ? message.parts.map((part: any) => ({ ...part }))
            : message.parts,
        metadata: message?.metadata && typeof message.metadata === 'object'
            ? { ...message.metadata }
            : message.metadata
    }));
}
