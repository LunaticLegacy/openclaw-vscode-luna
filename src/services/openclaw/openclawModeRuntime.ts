import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../../i18n';
import { OpenClawCliServiceConfig } from '../openclawConfig';
import {
    OpenClawAgentRecord,
    OpenClawCliRunner,
    OpenClawChannelsListResult,
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
    CreateAgentParams,
    DiscoveredChannel,
    RealtimeUsageSnapshot,
    SendMessageOptions,
    ServiceEventSink,
    StreamChunk,
    UpdateAgentParams
} from './types';

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

interface OpenClawAgentSettingsRecord {
    name?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

const OPENCLAW_AGENT_SETTINGS_FILE = '.openclaw-vscode-agent.json';
const OPENCLAW_SYSTEM_PROMPT_FILE = 'SYSTEM.md';
const OPENCLAW_IDENTITY_FILE = 'IDENTITY.md';

export class OpenClawModeRuntime {
    private readonly runner: OpenClawCliRunner;
    private readonly activeGatewayRuns = new Map<string, { runId: string; abortPromise?: Promise<void> }>();
    private defaultAgentId: string | null = null;
    private mainKey: string | null = null;
    private sessionKeysByAgent: Map<string, string> = new Map();
    private sessionEntriesByKey: Map<string, OpenClawSessionsListEntry> = new Map();
    private snapshotCache: CachedOpenClawAgentsSnapshot | null = null;
    private snapshotPromise: Promise<OpenClawAgentsSnapshot> | null = null;

    constructor(
        private readonly config: OpenClawCliServiceConfig,
        private readonly emitEvent: ServiceEventSink
    ) {
        this.runner = new OpenClawCliRunner(config);
    }

    public async checkConnection(): Promise<boolean> {
        try {
            await this.runner.health();
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
            maxTokens: normalizeOptionalInteger(params.maxTokens) ?? currentSettings.maxTokens ?? agent.maxTokens
        };

        await writeOpenClawAgentSettings(workspacePath, mergedSettings);

        if (params.systemPrompt !== undefined) {
            await fs.writeFile(
                path.join(workspacePath, OPENCLAW_SYSTEM_PROMPT_FILE),
                params.systemPrompt,
                'utf8'
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
            maxTokens: mergedSettings.maxTokens
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

    public async createChatSession(agentId: string): Promise<ChatSession> {
        const sessionKey = await this.resolveSessionKey(agentId);
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
    }

    public async *streamMessage(
        sessionId: string,
        message: string
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const historyBefore = await this.readSessionMessages(sessionId).catch(() => []);
        const knownIds = new Set(historyBefore.map(item => item.id));

        try {
            yield* this.streamMessageViaGateway(sessionId, message, knownIds);
            return;
        } catch {
            yield* this.streamMessageFromSessionLog(sessionId, message, knownIds);
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
        this.activeGatewayRuns.clear();
        this.defaultAgentId = null;
        this.mainKey = null;
        this.sessionKeysByAgent.clear();
        this.sessionEntriesByKey.clear();
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
                status: id === defaultAgentId ? 'active' : 'idle',
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
            status: record.id === defaultAgentId ? 'active' : 'idle',
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
            maxTokens: settings.maxTokens ?? agent.maxTokens
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

    private async *streamMessageViaGateway(
        sessionKey: string,
        message: string,
        knownIds: Set<string>
    ): AsyncGenerator<StreamChunk, void, unknown> {
        if (!this.config.gatewayUrl) {
            throw new Error('OpenClaw gateway URL is not configured');
        }

        const gatewayClient = new OpenClawGatewayClient({
            url: this.config.gatewayUrl,
            token: this.config.gatewayToken,
            timeoutMs: 30000,
            caps: ['tool-events'],
            clientId: 'gateway-client',
            clientDisplayName: 'OpenClaw VS Code',
            clientVersion: 'vscode-plugin'
        });

        const events: GatewayEventFrame[] = [];
        let wakeNextEvent: (() => void) | null = null;
        let streamError: Error | null = null;
        let dispatched = false;
        let runId = '';
        let assistantText = '';
        let thinkingText = '';
        let thinkingOpen = false;

        const queueEvent = (event: GatewayEventFrame) => {
            events.push(event);
            const wake = wakeNextEvent;
            wakeNextEvent = null;
            wake?.();
        };

        const onEvent = (event: GatewayEventFrame) => {
            if (event.event !== 'chat' && event.event !== 'agent') {
                return;
            }

            queueEvent(event);
        };

        const onError = (error: unknown) => {
            streamError = error instanceof Error ? error : new Error(String(error));
            const wake = wakeNextEvent;
            wakeNextEvent = null;
            wake?.();
        };

        const nextEvent = async (): Promise<GatewayEventFrame> => {
            while (events.length === 0) {
                if (streamError) {
                    throw streamError;
                }

                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        if (wakeNextEvent === wake) {
                            wakeNextEvent = null;
                        }
                        reject(new Error('Timed out waiting for gateway stream event'));
                    }, 30000);

                    const wake = () => {
                        clearTimeout(timer);
                        resolve();
                    };

                    wakeNextEvent = wake;
                });
            }

            return events.shift()!;
        };

        gatewayClient.on('event', onEvent);
        gatewayClient.on('error', onError);

        try {
            await gatewayClient.connect();

            const started = await gatewayClient.request<{
                runId?: string;
                status?: string;
            }>('chat.send', {
                sessionKey,
                message,
                deliver: false,
                idempotencyKey: crypto.randomUUID()
            }, {
                timeoutMs: 30000
            });

            dispatched = true;
            runId = typeof started.runId === 'string' && started.runId.trim()
                ? started.runId.trim()
                : '';

            if (!runId) {
                throw new Error('Gateway chat.send did not return a runId');
            }

            this.activeGatewayRuns.set(sessionKey, { runId });

            while (true) {
                const event = await nextEvent();
                const payload = event.payload && typeof event.payload === 'object'
                    ? event.payload as Record<string, unknown>
                    : null;

                if (!payload || payload.runId !== runId) {
                    continue;
                }

                if (event.event === 'agent') {
                    const stream = typeof payload.stream === 'string' ? payload.stream : '';

                    if (stream === 'thinking') {
                        const data = payload.data && typeof payload.data === 'object'
                            ? payload.data as Record<string, unknown>
                            : {};
                        const fullThinking = typeof data.text === 'string' ? data.text : '';
                        const deltaThinking = typeof data.delta === 'string'
                            ? data.delta
                            : fullThinking.startsWith(thinkingText)
                                ? fullThinking.slice(thinkingText.length)
                                : fullThinking;

                        thinkingText = fullThinking || thinkingText;
                        if (!deltaThinking) {
                            continue;
                        }

                        yield {
                            content: thinkingOpen ? deltaThinking : `<thinking>${deltaThinking}`,
                            done: false
                        };
                        thinkingOpen = true;
                        continue;
                    }

                    if (thinkingOpen && (stream === 'assistant' || stream === 'tool' || stream === 'lifecycle')) {
                        thinkingOpen = false;
                        thinkingText = '';
                        yield {
                            content: '</thinking>',
                            done: false
                        };
                    }

                    if (stream === 'tool') {
                        const transientMessage = normalizeOpenClawGatewayToolEvent(sessionKey, payload);
                        if (transientMessage) {
                            yield {
                                content: '',
                                done: false,
                                message: transientMessage
                            };
                        }
                        continue;
                    }

                    if (stream === 'lifecycle') {
                        const lifecycleMessage = normalizeOpenClawGatewayLifecycleEvent(sessionKey, payload);
                        if (lifecycleMessage) {
                            yield {
                                content: '',
                                done: false,
                                message: lifecycleMessage
                            };
                        }

                        const data = payload.data && typeof payload.data === 'object'
                            ? payload.data as Record<string, unknown>
                            : {};
                        if (data.phase === 'error') {
                            throw new Error(typeof data.error === 'string' ? data.error : 'OpenClaw agent run failed');
                        }
                    }

                    continue;
                }

                if (thinkingOpen) {
                    thinkingOpen = false;
                    thinkingText = '';
                    yield {
                        content: '</thinking>',
                        done: false
                    };
                }

                const state = typeof payload.state === 'string' ? payload.state : '';
                const messageText = extractTextContent((payload.message as { content?: unknown } | undefined)?.content);
                const deltaText = messageText
                    ? messageText.startsWith(assistantText)
                        ? messageText.slice(assistantText.length)
                        : messageText
                    : '';

                if (messageText) {
                    assistantText = messageText;
                }

                if (deltaText) {
                    yield {
                        content: deltaText,
                        done: false
                    };
                }

                if (state === 'error') {
                    throw new Error(typeof payload.errorMessage === 'string' ? payload.errorMessage : 'OpenClaw chat stream failed');
                }

                if (state === 'aborted') {
                    throw new Error('OpenClaw chat stream aborted');
                }

                if (state === 'final') {
                    yield {
                        content: '',
                        done: true
                    };
                    return;
                }
            }
        } catch (error) {
            if (!dispatched) {
                throw error;
            }

            const streamFailure = error instanceof Error ? error : new Error(String(error));
            if (thinkingOpen) {
                thinkingOpen = false;
                thinkingText = '';
                yield {
                    content: '</thinking>',
                    done: false
                };
            }

            const fallbackAssistant = await this.waitForAssistantMessage(sessionKey, knownIds, 120000);
            if (!fallbackAssistant && !assistantText) {
                throw streamFailure;
            }

            if (fallbackAssistant?.content) {
                const deltaText = fallbackAssistant.content.startsWith(assistantText)
                    ? fallbackAssistant.content.slice(assistantText.length)
                    : fallbackAssistant.content;

                if (deltaText) {
                    yield {
                        content: deltaText,
                        done: false
                    };
                }
            }

            yield {
                content: '',
                done: true
            };
        } finally {
            const activeRun = this.activeGatewayRuns.get(sessionKey);
            if (activeRun?.runId === runId && !activeRun.abortPromise) {
                this.activeGatewayRuns.delete(sessionKey);
            }
            gatewayClient.off('event', onEvent);
            gatewayClient.off('error', onError);
            gatewayClient.dispose();
        }
    }

    private async *streamMessageFromSessionLog(
        sessionKey: string,
        message: string,
        knownIds: Set<string>
    ): AsyncGenerator<StreamChunk, void, unknown> {
        let responsePayload: Record<string, unknown> | null = null;
        let requestError: unknown = null;
        let requestCompleted = false;
        let requestCompletedAt = 0;
        let finalAssistantSeen = false;

        const requestPromise = this.runner.sendChat(sessionKey, message)
            .then(result => {
                responsePayload = result;
                requestCompleted = true;
                requestCompletedAt = Date.now();
                return result;
            })
            .catch(error => {
                requestError = error;
                requestCompleted = true;
                requestCompletedAt = Date.now();
                throw error;
            });

        while (!requestCompleted || Date.now() - requestCompletedAt < 2500) {
            const currentMessages = await this.readSessionMessages(sessionKey).catch(() => []);
            const newMessages = currentMessages.filter(item => !knownIds.has(item.id));

            for (const newMessage of newMessages) {
                knownIds.add(newMessage.id);
                if (isFinalOpenClawAssistantMessage(newMessage)) {
                    finalAssistantSeen = true;
                }

                yield {
                    content: newMessage.role === 'assistant' ? newMessage.content : '',
                    done: false,
                    tokenCount: newMessage.tokenCount,
                    message: newMessage
                };
            }

            if (requestCompleted) {
                if (requestError) {
                    break;
                }

                if (finalAssistantSeen) {
                    break;
                }
            }

            await delay(200);
        }

        try {
            await requestPromise;
        } catch {
            throw requestError;
        }

        if (!finalAssistantSeen && responsePayload) {
            const fallbackAssistant = extractAssistantMessageFromPayload(responsePayload, sessionKey);
            if (fallbackAssistant && !knownIds.has(fallbackAssistant.id)) {
                yield {
                    content: fallbackAssistant.content,
                    done: false,
                    tokenCount: fallbackAssistant.tokenCount,
                    message: fallbackAssistant
                };
            }
        }

        yield {
            content: '',
            done: true
        };
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

    private invalidateSnapshotCache(): void {
        this.snapshotCache = null;
        this.snapshotPromise = null;
    }
}

function mapDiscoveredChannels(result: OpenClawChannelsListResult | null): DiscoveredChannel[] {
    if (!result?.chat || typeof result.chat !== 'object') {
        return [];
    }

    const channels: DiscoveredChannel[] = [];
    for (const [providerId, accounts] of Object.entries(result.chat)) {
        if (!Array.isArray(accounts)) {
            continue;
        }

        for (const rawAccountId of accounts) {
            const accountId = String(rawAccountId || '').trim();
            if (!accountId) {
                continue;
            }

            const name = formatDiscoveredChannelName(providerId, accountId);
            channels.push({
                id: `openclaw:${providerId}:${accountId}`,
                name,
                source: 'openclaw',
                providerId,
                accountId,
                description: `${providerId}/${accountId}`
            });
        }
    }

    return channels.sort((left, right) => left.name.localeCompare(right.name));
}

function formatDiscoveredChannelName(providerId: string, accountId: string): string {
    const normalizedProvider = String(providerId || '').trim();
    const normalizedAccount = String(accountId || '').trim();
    const providerLabel = normalizedProvider
        .split(/[-_]+/)
        .filter(Boolean)
        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');

    return `${providerLabel || 'Channel'} ${normalizedAccount}`;
}

async function readOpenClawAgentSettings(workspacePath: string): Promise<OpenClawAgentSettingsRecord> {
    try {
        const content = await fs.readFile(path.join(workspacePath, OPENCLAW_AGENT_SETTINGS_FILE), 'utf8');
        const parsed = JSON.parse(content) as OpenClawAgentSettingsRecord;
        return {
            name: normalizeOptionalString(parsed.name),
            model: normalizeOptionalString(parsed.model),
            systemPrompt: parsed.systemPrompt !== undefined ? String(parsed.systemPrompt) : undefined,
            temperature: normalizeOptionalNumber(parsed.temperature),
            maxTokens: normalizeOptionalInteger(parsed.maxTokens)
        };
    } catch {
        return {};
    }
}

async function writeOpenClawAgentSettings(
    workspacePath: string,
    settings: OpenClawAgentSettingsRecord
): Promise<void> {
    const payload: OpenClawAgentSettingsRecord = {};

    if (settings.name) {
        payload.name = settings.name;
    }
    if (settings.model) {
        payload.model = settings.model;
    }
    if (settings.systemPrompt !== undefined) {
        payload.systemPrompt = settings.systemPrompt;
    }
    if (settings.temperature !== undefined) {
        payload.temperature = settings.temperature;
    }
    if (settings.maxTokens !== undefined) {
        payload.maxTokens = settings.maxTokens;
    }

    await fs.writeFile(
        path.join(workspacePath, OPENCLAW_AGENT_SETTINGS_FILE),
        JSON.stringify(payload, null, 2),
        'utf8'
    );
}

async function readOpenClawSystemPrompt(workspacePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(path.join(workspacePath, OPENCLAW_SYSTEM_PROMPT_FILE), 'utf8');
    } catch {
        return undefined;
    }
}

async function updateOpenClawIdentityFile(
    workspacePath: string,
    values: { agentId: string; name: string; model: string }
): Promise<void> {
    const targetPath = path.join(workspacePath, OPENCLAW_IDENTITY_FILE);
    let content: string;

    try {
        content = await fs.readFile(targetPath, 'utf8');
    } catch {
        content = [
            '# IDENTITY.md - Who Am I?',
            '',
            `- Name: ${values.name}`,
            `- Agent ID: ${values.agentId}`,
            `- Model: ${values.model}`,
            ''
        ].join('\n');
        await fs.writeFile(targetPath, content, 'utf8');
        return;
    }

    const updates: Array<[RegExp, string]> = [
        [/^- Name:\s*.*$/m, `- Name: ${values.name}`],
        [/^- Agent ID:\s*.*$/m, `- Agent ID: ${values.agentId}`],
        [/^- Model:\s*.*$/m, `- Model: ${values.model}`]
    ];

    let nextContent = content;
    for (const [pattern, replacement] of updates) {
        if (pattern.test(nextContent)) {
            nextContent = nextContent.replace(pattern, replacement);
        } else {
            nextContent = `${nextContent.trimEnd()}\n${replacement}\n`;
        }
    }

    if (nextContent !== content) {
        await fs.writeFile(targetPath, nextContent, 'utf8');
    }
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }

    return value;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
    const normalized = normalizeOptionalNumber(value);
    if (normalized === undefined) {
        return undefined;
    }

    return Math.max(1, Math.round(normalized));
}
