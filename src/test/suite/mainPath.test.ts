import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { getAgentPresets } from '../../config/agentPresets';
import { AgentManager, DuplicateAgentNameError } from '../../managers/agentManager';
import { ScheduledTaskManager } from '../../managers/scheduledTaskManager';
import { UsageManager } from '../../managers/usageManager';
import type {
    OpenClawSessionsListEntry,
    OpenClawSessionsUsageResult
} from '../../services/openclawCli';
import {
    buildSessionModelHints,
    mapOpenClawUsage
} from '../../services/openclaw/usageService';
import {
    GatewayServiceConfig,
    getBuiltInOpenClawAuthProviderIds,
    getBuiltInOpenClawDefaultModelsByProvider,
    LocalServiceConfig,
    mergeOpenClawAuthProfilesForSave,
    mergeOpenClawConfigForSave,
    OpenClawCliServiceConfig
} from '../../services/openclawConfig';
import { AgentPresetScaffolder } from '../../services/agentPresetScaffolder';
import { setOpenClawCliCommandExecutorForTests } from '../../services/openclawCli';
import { OpenClawService } from '../../services/openclawService';
import { createFakeOpenClawCommandExecutor } from '../fixtures/fakeOpenClawCli';

suite('OpenClaw Main Path', () => {
    test('keeps the activation and command manifest aligned with the main UI path', async () => {
        const manifestPath = path.resolve(__dirname, '../../../package.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
            activationEvents?: string[];
            contributes?: {
                commands?: Array<{ command?: string }>;
                views?: Record<string, Array<{ id?: string; when?: string }>>;
            };
        };

        assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
        assert.ok(manifest.activationEvents?.includes('onCommand:openclaw.openPanel'));

        const commands = new Set((manifest.contributes?.commands || []).map((item: any) => item.command));
        for (const command of [
            'openclaw.openPanel',
            'openclaw.newAgent',
            'openclaw.manageTasks',
            'openclaw.createTask',
            'openclaw.apiUsage'
        ]) {
            assert.ok(commands.has(command), `Expected command ${command} in package.json`);
        }

        const openClawViews = manifest.contributes?.views?.openclaw || [];
        assert.ok(openClawViews.some((view: any) => view.id === 'openclawSidebar' && view.when === 'openclaw.enabled'));
        assert.ok(openClawViews.some((view: any) => view.id === 'openclawTasks' && view.when === 'openclaw.enabled'));
    });

    test('maps OpenClaw usage back to the real model when session usage omits it', () => {
        const sessionKey = 'agent:default:main';
        const sessionsUsage: OpenClawSessionsUsageResult = {
            sessions: [{
                key: sessionKey,
                sessionId: 'session-1',
                agentId: 'default',
                modelProvider: 'moonshot',
                usage: {
                    input: 120,
                    output: 80,
                    totalTokens: 200,
                    totalCost: 0.4,
                    dailyBreakdown: [{
                        date: '2026-03-09',
                        tokens: 200,
                        cost: 0.4
                    }],
                    dailyMessageCounts: [{
                        date: '2026-03-09',
                        user: 1,
                        assistant: 1,
                        total: 2
                    }],
                    messageCounts: {
                        user: 1,
                        assistant: 1,
                        total: 2
                    }
                }
            }],
            aggregates: {
                byModel: [{
                    provider: 'moonshot',
                    model: 'kimi-k2.5',
                    count: 1,
                    totals: {
                        input: 120,
                        output: 80,
                        totalTokens: 200,
                        totalCost: 0.4
                    }
                }]
            }
        };
        const sessionHints = buildSessionModelHints([{
            key: sessionKey,
            sessionId: 'session-1',
            agentId: 'default',
            model: 'kimi-k2.5'
        } satisfies OpenClawSessionsListEntry]);

        const usage = mapOpenClawUsage(sessionsUsage, undefined, undefined, {
            sessionModels: sessionHints,
            agentModels: new Map([['default', 'kimi-k2.5']]),
            defaultModel: 'kimi-k2.5'
        });

        assert.equal(usage.byModel['kimi-k2.5']?.requests, 1);
        assert.equal(usage.byModel['kimi-k2.5']?.tokens, 200);
        assert.equal(usage.byModel['unknown'], undefined);
        assert.equal(usage.byModel['moonshot'], undefined);
    });

    test('ships the documented OpenClaw auth provider catalog for the setup UI', () => {
        const providers = getBuiltInOpenClawAuthProviderIds();
        const sortedProviders = [...providers].sort((left: any, right: any) => left.localeCompare(right));

        assert.deepEqual(providers, sortedProviders);
        assert.equal(new Set(providers).size, providers.length);

        for (const providerId of [
            'amazon-bedrock',
            'anthropic',
            'cloudflare-ai-gateway',
            'github-copilot',
            'google',
            'google-antigravity',
            'google-gemini-cli',
            'google-vertex',
            'groq',
            'kilocode',
            'kimi-coding',
            'lmstudio',
            'moonshot',
            'ollama',
            'openai',
            'openai-codex',
            'openrouter',
            'qwen-portal',
            'synthetic',
            'vercel-ai-gateway',
            'vllm',
            'xai',
            'zai'
        ]) {
            assert.ok(providers.includes(providerId), `Expected ${providerId} in built-in auth providers`);
        }

        assert.equal(providers.includes('deepgram'), false);
    });

    test('ships default model suggestions grouped by auth provider', () => {
        const suggestionsByProvider = getBuiltInOpenClawDefaultModelsByProvider();

        assert.deepEqual(suggestionsByProvider.openai, [
            'openai/gpt-5.4',
            'openai/gpt-5.4-pro',
            'openai/gpt-5-mini'
        ]);
        assert.deepEqual(suggestionsByProvider.anthropic, [
            'anthropic/claude-opus-4-6',
            'anthropic/claude-sonnet-4-6',
            'anthropic/claude-haiku-4-5'
        ]);
        assert.deepEqual(suggestionsByProvider.google, [
            'google/gemini-3.1-pro-preview',
            'google/gemini-3-flash-preview',
            'google/gemini-3.1-flash-lite-preview'
        ]);
        assert.deepEqual(suggestionsByProvider.moonshot, [
            'moonshot/kimi-k2.5',
            'moonshot/kimi-k2-0905-preview',
            'moonshot/kimi-k2-turbo-preview',
            'moonshot/kimi-k2-thinking',
            'moonshot/kimi-k2-thinking-turbo'
        ]);
        assert.deepEqual(suggestionsByProvider['qwen-portal'], [
            'qwen-portal/coder-model',
            'qwen-portal/vision-model'
        ]);

        assert.equal(Array.isArray(suggestionsByProvider.qianfan), true);
        assert.equal(suggestionsByProvider.qianfan.length, 0);
    });

    test('builds a runnable bug-hunter system prompt from the preset scaffolding files', async () => {
        const scaffolder = new AgentPresetScaffolder(
            path.resolve(__dirname, '../../..'),
            {} as OpenClawService
        );

        const systemPrompt = await scaffolder.buildSystemPrompt({
            presetId: 'bug-hunter',
            requestedName: 'bug-hunter',
            requestedModel: 'fake-model',
            systemPrompt: 'You are a debugging specialist.'
        });

        assert.ok(systemPrompt, 'Expected the bug-hunter preset to expand its system prompt');
        assert.match(systemPrompt || '', /maintain 1-3 ranked hypotheses/i);
        assert.match(systemPrompt || '', /fastest reproducer/i);
        assert.match(systemPrompt || '', /one next action only/i);
        assert.match(systemPrompt || '', /do not propose a broad rewrite/i);
    });

    test('builds a staged refactor-planner system prompt from the preset scaffolding files', async () => {
        const scaffolder = new AgentPresetScaffolder(
            path.resolve(__dirname, '../../..'),
            {} as OpenClawService
        );

        const systemPrompt = await scaffolder.buildSystemPrompt({
            presetId: 'refactor-planner',
            requestedName: 'refactor-planner',
            requestedModel: 'fake-model',
            systemPrompt: 'You plan safe refactors for existing systems.'
        });

        assert.ok(systemPrompt, 'Expected the refactor-planner preset to expand its system prompt');
        assert.match(systemPrompt || '', /small, reversible phases/i);
        assert.match(systemPrompt || '', /compatibility layers before hard cutovers/i);
        assert.match(systemPrompt || '', /verification gates/i);
        assert.match(systemPrompt || '', /rollback plan/i);
    });

    test('builds a findings-first code-review-guard system prompt from the preset scaffolding files', async () => {
        const scaffolder = new AgentPresetScaffolder(
            path.resolve(__dirname, '../../..'),
            {} as OpenClawService
        );

        const systemPrompt = await scaffolder.buildSystemPrompt({
            presetId: 'code-review-guard',
            requestedName: 'code-review-guard',
            requestedModel: 'fake-model',
            systemPrompt: 'You are a strict, low-noise code reviewer.'
        });

        assert.ok(systemPrompt, 'Expected the code-review-guard preset to expand its system prompt');
        assert.match(systemPrompt || '', /respond in this order/i);
        assert.match(systemPrompt || '', /highest-confidence issues/i);
        assert.match(systemPrompt || '', /Do not lead with style/i);
        assert.match(systemPrompt || '', /No findings\./i);
    });

    test('creates a preset-backed code-review-guard agent in local mode without requiring a workspace path', async () => {
        const localConfig: LocalServiceConfig = {
            mode: 'local',
            providers: [{
                id: 'fake-provider',
                baseUrl: 'http://127.0.0.1:1',
                api: 'openai-completions',
                apiKey: 'test-key',
                models: [{
                    id: 'fake-model',
                    name: 'Fake Model'
                }]
            }],
            sourceDescription: 'preset-local-test'
        };
        const service = new OpenClawService(localConfig);
        const agentManager = new AgentManager(
            service,
            new AgentPresetScaffolder(path.resolve(__dirname, '../../..'), service)
        );

        try {
            const agent = await agentManager.createAgent({
                name: 'Review Guard',
                model: 'fake-model',
                systemPrompt: 'You are a strict, low-noise code reviewer.',
                presetId: 'code-review-guard'
            });

            assert.equal(agent.name, 'Review Guard');
            assert.match(agent.systemPrompt || '', /respond in this order/i);
            assert.match(agent.systemPrompt || '', /Do not lead with style/i);
        } finally {
            agentManager.dispose();
            service.dispose();
        }
    });

    test('rejects creating an agent when another agent already has the same name', async () => {
        const localConfig: LocalServiceConfig = {
            mode: 'local',
            providers: [{
                id: 'fake-provider',
                baseUrl: 'http://127.0.0.1:1',
                api: 'openai-completions',
                apiKey: 'test-key',
                models: [{
                    id: 'fake-model',
                    name: 'Fake Model'
                }]
            }],
            sourceDescription: 'duplicate-agent-test'
        };
        const service = new OpenClawService(localConfig);
        const agentManager = new AgentManager(service);

        try {
            await agentManager.createAgent({
                name: 'Duplicate Name',
                model: 'fake-model',
                systemPrompt: 'First agent'
            });

            await assert.rejects(
                () => agentManager.createAgent({
                    name: 'duplicate name',
                    model: 'fake-model',
                    systemPrompt: 'Second agent'
                }),
                (error: unknown) => error instanceof DuplicateAgentNameError
            );
        } finally {
            agentManager.dispose();
            service.dispose();
        }
    });

    test('writes code-review-guard preset files for workspace-backed OpenClaw agents', async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-review-guard-'));
        const openClawConfig = await createFakeOpenClawConfig(stateDir);
        setOpenClawCliCommandExecutorForTests(createFakeOpenClawCommandExecutor());
        const service = new OpenClawService(openClawConfig);
        const agentManager = new AgentManager(
            service,
            new AgentPresetScaffolder(path.resolve(__dirname, '../../..'), service)
        );

        try {
            const agent = await agentManager.createAgent({
                name: 'Workspace Review Guard',
                model: 'fake-openclaw-model',
                systemPrompt: 'You are a strict, low-noise code reviewer.',
                presetId: 'code-review-guard'
            });
            const workspacePath = await service.resolveAgentFolderPath(agent);

            assert.ok(workspacePath, 'Expected the OpenClaw agent to have a workspace path');

            const [systemFile, soulFile] = await Promise.all([
                fs.readFile(path.join(workspacePath!, 'SYSTEM.md'), 'utf8'),
                fs.readFile(path.join(workspacePath!, 'SOUL.md'), 'utf8')
            ]);

            assert.match(systemFile, /Severity/i);
            assert.match(systemFile, /No findings\./i);
            assert.match(soulFile, /Evidence Standard/i);
        } finally {
            setOpenClawCliCommandExecutorForTests(undefined);
            agentManager.dispose();
            service.dispose();
            await fs.rm(stateDir, { recursive: true, force: true });
        }
    });

    test('marks an OpenClaw agent active during non-stream runs even without activity gateway events', async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-status-send-'));
        const openClawConfig = await createFakeOpenClawConfig(stateDir);
        setOpenClawCliCommandExecutorForTests(createFakeOpenClawCommandExecutor());
        const service = new OpenClawService(openClawConfig);
        const agentManager = new AgentManager(service);

        try {
            const [agent] = await agentManager.getAgents(true);
            assert.ok(agent, 'Expected an OpenClaw agent');

            const observedStatuses: string[] = [];
            agentManager.on('agentUpdated', (updatedAgent: any) => {
                if (updatedAgent.id === agent.id) {
                    observedStatuses.push(updatedAgent.status);
                }
            });

            const session = await service.createChatSession(agent.id);
            const response = await service.sendMessage(session.id, 'Check status transitions.');

            assert.equal(response.role, 'assistant');
            await wait(1300);
            assert.ok(observedStatuses.includes('active'));
            assert.equal(observedStatuses[observedStatuses.length - 1], 'idle');
        } finally {
            agentManager.dispose();
            service.dispose();
            setOpenClawCliCommandExecutorForTests(undefined);
            await fs.rm(stateDir, { recursive: true, force: true });
        }
    });

    test('marks an OpenClaw agent active during stream fallback runs when gateway streaming is unavailable', async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-status-stream-'));
        const openClawConfig = await createFakeOpenClawConfig(stateDir);
        setOpenClawCliCommandExecutorForTests(createFakeOpenClawCommandExecutor());
        const service = new OpenClawService(openClawConfig);
        const agentManager = new AgentManager(service);

        try {
            const [agent] = await agentManager.getAgents(true);
            assert.ok(agent, 'Expected an OpenClaw agent');

            const observedStatuses: string[] = [];
            agentManager.on('agentUpdated', (updatedAgent: any) => {
                if (updatedAgent.id === agent.id) {
                    observedStatuses.push(updatedAgent.status);
                }
            });

            const session = await service.createChatSession(agent.id);
            const chunks: string[] = [];
            for await (const chunk of service.streamMessage(session.id, 'Check stream status transitions.')) {
                if (chunk.content) {
                    chunks.push(chunk.content);
                }
            }

            assert.match(chunks.join(''), /Fake OpenClaw reply/i);
            await wait(1300);
            assert.ok(observedStatuses.includes('active'));
            assert.equal(observedStatuses[observedStatuses.length - 1], 'idle');
        } finally {
            agentManager.dispose();
            service.dispose();
            setOpenClawCliCommandExecutorForTests(undefined);
            await fs.rm(stateDir, { recursive: true, force: true });
        }
    });

    test('merges OpenClaw config edits without dropping unrelated fields', () => {
        const merged = mergeOpenClawConfigForSave({
            telemetry: {
                enabled: true
            },
            gateway: {
                auth: {
                    token: 'old-token'
                },
                extra: 'keep-me'
            },
            agents: {
                defaults: {
                    workspace: 'C:\\old-workspace',
                    model: {
                        secondary: 'keep-secondary'
                    }
                }
            }
        }, {
            gatewayPort: 19998,
            gatewayToken: 'new-token',
            defaultWorkspace: 'C:\\next-workspace',
            defaultModel: 'moonshot/kimi-k2.5'
        });

        assert.deepEqual((merged as any).telemetry, { enabled: true });
        assert.equal((merged as any).gateway.port, 19998);
        assert.equal((merged as any).gateway.auth.token, 'new-token');
        assert.equal((merged as any).gateway.extra, 'keep-me');
        assert.equal((merged as any).agents.defaults.workspace, 'C:\\next-workspace');
        assert.equal((merged as any).agents.defaults.model.primary, 'moonshot/kimi-k2.5');
        assert.equal((merged as any).agents.defaults.model.secondary, 'keep-secondary');
    });

    test('clears optional OpenClaw config fields when the editor saves blanks', () => {
        const merged = mergeOpenClawConfigForSave({
            gateway: {
                port: 18789,
                auth: {
                    token: 'old-token'
                }
            },
            agents: {
                defaults: {
                    workspace: 'C:\\workspace',
                    model: {
                        primary: 'moonshot/kimi-k2.5'
                    }
                }
            }
        }, {
            gatewayPort: 18789,
            gatewayToken: '',
            defaultWorkspace: '',
            defaultModel: ''
        });

        assert.equal((merged as any).gateway.port, 18789);
        assert.equal((merged as any).gateway.auth, undefined);
        assert.equal((merged as any).agents, undefined);
    });

    test('merges OpenClaw auth metadata and API keys without dropping unrelated entries', () => {
        const mergedConfig = mergeOpenClawConfigForSave({
            auth: {
                profiles: {
                    'moonshot:default': {
                        provider: 'moonshot',
                        mode: 'api_key'
                    }
                }
            }
        }, {
            gatewayPort: 18789,
            gatewayToken: '',
            defaultWorkspace: '',
            defaultModel: 'ollama/qwen3:8b',
            authProviderId: 'ollama',
            authApiKey: 'ollama-local'
        });
        const mergedAuthProfiles = mergeOpenClawAuthProfilesForSave({
            version: 1,
            profiles: {
                'moonshot:default': {
                    type: 'api_key',
                    provider: 'moonshot',
                    key: 'moonshot-secret'
                }
            },
            lastGood: {
                moonshot: 'moonshot:default'
            },
            usageStats: {
                'moonshot:default': {
                    errorCount: 0
                }
            }
        }, {
            gatewayPort: 18789,
            gatewayToken: '',
            defaultWorkspace: '',
            defaultModel: 'ollama/qwen3:8b',
            authProviderId: 'ollama',
            authApiKey: 'ollama-local'
        });

        assert.equal((mergedConfig as any).auth.profiles['moonshot:default'].provider, 'moonshot');
        assert.equal((mergedConfig as any).auth.profiles['ollama:default'].provider, 'ollama');
        assert.equal((mergedConfig as any).auth.profiles['ollama:default'].mode, 'api_key');

        assert.equal((mergedAuthProfiles as any).profiles['moonshot:default'].key, 'moonshot-secret');
        assert.equal((mergedAuthProfiles as any).profiles['ollama:default'].key, 'ollama-local');
        assert.equal((mergedAuthProfiles as any).lastGood.ollama, 'ollama:default');
        assert.equal((mergedAuthProfiles as any).usageStats['moonshot:default'].errorCount, 0);
    });

    test('clears saved OpenClaw auth API keys for the selected provider without touching others', () => {
        const mergedConfig = mergeOpenClawConfigForSave({
            auth: {
                profiles: {
                    'moonshot:default': {
                        provider: 'moonshot',
                        mode: 'api_key'
                    },
                    'ollama:default': {
                        provider: 'ollama',
                        mode: 'api_key'
                    }
                }
            }
        }, {
            gatewayPort: 18789,
            gatewayToken: '',
            defaultWorkspace: '',
            defaultModel: 'ollama/qwen3:8b',
            authProviderId: 'ollama',
            authApiKey: ''
        });
        const mergedAuthProfiles = mergeOpenClawAuthProfilesForSave({
            version: 1,
            profiles: {
                'moonshot:default': {
                    type: 'api_key',
                    provider: 'moonshot',
                    key: 'moonshot-secret'
                },
                'ollama:default': {
                    type: 'api_key',
                    provider: 'ollama',
                    key: 'ollama-local'
                }
            },
            lastGood: {
                moonshot: 'moonshot:default',
                ollama: 'ollama:default'
            }
        }, {
            gatewayPort: 18789,
            gatewayToken: '',
            defaultWorkspace: '',
            defaultModel: 'ollama/qwen3:8b',
            authProviderId: 'ollama',
            authApiKey: ''
        });

        assert.equal((mergedConfig as any).auth.profiles['moonshot:default'].provider, 'moonshot');
        assert.equal((mergedConfig as any).auth.profiles['ollama:default'], undefined);

        assert.equal((mergedAuthProfiles as any).profiles['moonshot:default'].key, 'moonshot-secret');
        assert.equal((mergedAuthProfiles as any).profiles['ollama:default'], undefined);
        assert.equal((mergedAuthProfiles as any).lastGood.moonshot, 'moonshot:default');
        assert.equal((mergedAuthProfiles as any).lastGood.ollama, undefined);
    });

    test('runs the primary smoke flow across local chat, usage, and scheduled tasks', async function() {
        this.timeout(120000);

        const localProvider = await startFakeLocalProvider();
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-smoke-'));
        const openClawConfig = await createFakeOpenClawConfig(stateDir);
        const fakeOpenClawExecutor = createFakeOpenClawCommandExecutor();
        const localConfig: LocalServiceConfig = {
            mode: 'local',
            providers: [{
                id: 'fake-provider',
                baseUrl: localProvider.baseUrl,
                api: 'openai-completions',
                apiKey: 'test-key',
                models: [{
                    id: 'fake-model',
                    name: 'Fake Model'
                }]
            }],
            sourceDescription: 'smoke-test'
        };

        setOpenClawCliCommandExecutorForTests(fakeOpenClawExecutor);

        const service = new OpenClawService(localConfig);
        const gatewayConfig: GatewayServiceConfig = {
            mode: 'gateway',
            gatewayUrl: 'http://127.0.0.1:19999',
            gatewayToken: '',
            sourceDescription: 'gateway-smoke'
        };
        const gatewayService = new OpenClawService(gatewayConfig);
        const agentManager = new AgentManager(service);
        const usageManager = new UsageManager(service);
        const taskManager = new ScheduledTaskManager(service);

        try {
            const presets = getAgentPresets();
            assert.ok(presets.length > 0, 'Expected built-in presets');
            for (const preset of presets) {
                assert.ok(preset.recommendedModel.trim(), `Preset ${preset.id} should declare a recommended model`);
                assert.ok(preset.failureSignals.trim(), `Preset ${preset.id} should declare failure signals`);
                assert.ok(preset.outputStandard.trim(), `Preset ${preset.id} should declare an output standard`);
            }

            assert.equal(gatewayService.supportsRemoteClusters(), true);
            assert.equal(gatewayService.supportsCapability('agentEditing'), true);
            assert.equal(gatewayService.supportsScheduledTasks(), false);
            assert.equal(gatewayService.supportsLiveSessionSync(), false);
            assert.equal(gatewayService.getModeCapabilities().clusterPersistence, 'remote');
            assert.ok(gatewayService.getModeCapabilityMatrix().length >= 6);

            assert.equal(await service.checkConnection(), true, 'Local mode should connect');
            assert.equal(service.getMode(), 'local');
            assert.equal(service.supportsCapability('agentEditing'), true);
            assert.equal(service.supportsScheduledTasks(), false);
            assert.equal(service.supportsLiveSessionSync(), false);
            assert.equal(service.getModeCapabilities().clusterPersistence, 'workspace');

            const agent = await agentManager.createAgent({
                name: 'Smoke Agent',
                model: 'fake-model',
                systemPrompt: 'You are a smoke test agent.'
            });
            assert.equal(agent.name, 'Smoke Agent');

            const session = await service.createChatSession(agent.id);
            const response = await service.sendMessage(session.id, 'Explain the current file.');
            assert.equal(response.role, 'assistant');
            assert.match(response.content, /fake response/i);

            const usage = await usageManager.getUsage();
            assert.equal(usage.totalRequests, 1);
            assert.equal(usage.byModel['fake-model']?.requests, 1);
            assert.equal(usage.byChannel?.chat?.requests, 1);

            service.updateConfig(openClawConfig);
            assert.equal(service.getMode(), 'openclaw');
            assert.equal(await service.checkConnection(), true, 'OpenClaw mode should connect');
            assert.equal(service.supportsCapability('agentEditing'), true);
            assert.equal(service.supportsScheduledTasks(), true);
            assert.equal(service.supportsLiveSessionSync(), true);
            assert.equal(service.getModeCapabilities().clusterPersistence, 'workspace');

            const openClawAgent = await agentManager.createAgent({
                name: 'Smoke OpenClaw Agent',
                model: 'fake-openclaw-model',
                systemPrompt: 'You are the OpenClaw smoke test agent.'
            });
            assert.equal(openClawAgent.name, 'Smoke OpenClaw Agent');
            assert.equal(openClawAgent.model, 'fake-openclaw-model');

            const updatedOpenClawAgent = await agentManager.updateAgent(openClawAgent.id, {
                name: 'Smoke OpenClaw Agent Updated',
                model: 'fake-openclaw-model-v2',
                systemPrompt: 'You are the updated OpenClaw smoke test agent.',
                temperature: 0.3,
                maxTokens: 2048
            });
            assert.equal(updatedOpenClawAgent.name, 'Smoke OpenClaw Agent Updated');
            assert.equal(updatedOpenClawAgent.model, 'fake-openclaw-model-v2');
            assert.equal(updatedOpenClawAgent.temperature, 0.3);
            assert.equal(updatedOpenClawAgent.maxTokens, 2048);

            const reloadedOpenClawAgent = await service.getAgent(openClawAgent.id);
            assert.equal(reloadedOpenClawAgent?.name, 'Smoke OpenClaw Agent Updated');
            assert.equal(reloadedOpenClawAgent?.model, 'fake-openclaw-model-v2');
            assert.equal(reloadedOpenClawAgent?.systemPrompt, 'You are the updated OpenClaw smoke test agent.');
            assert.equal(reloadedOpenClawAgent?.temperature, 0.3);
            assert.equal(reloadedOpenClawAgent?.maxTokens, 2048);

            const openClawSession = await service.createChatSession(openClawAgent.id);
            const openClawResponse = await service.sendMessage(openClawSession.id, 'Summarize the OpenClaw path.');
            assert.equal(openClawResponse.role, 'assistant');
            assert.match(openClawResponse.content, /fake openclaw reply/i);

            await service.abortSessionRun(openClawSession.id);
            const fakeState = JSON.parse(
                await fs.readFile(path.join(stateDir, '.openclaw-test-state.json'), 'utf8')
            ) as {
                abortedRuns?: Array<{ sessionKey?: string }>;
            };
            assert.ok(
                fakeState.abortedRuns?.some((item: any) => item.sessionKey === openClawSession.id),
                'Expected abortSessionRun to forward a stop request to OpenClaw'
            );

            const openClawUsage = await usageManager.getUsage();
            assert.equal(openClawUsage.totalRequests, 1);
            assert.equal(openClawUsage.byModel['fake-openclaw-model']?.requests, 1);
            assert.equal(openClawUsage.byChannel?.chat?.requests, 1);

            const task = await taskManager.createTask({
                name: 'Smoke Task',
                agentId: openClawAgent.id,
                scheduleKind: 'every',
                scheduleEvery: '15m',
                payloadKind: 'agentTurn',
                content: 'Summarize the last chat turn.',
                enabled: true
            });
            assert.ok(task.id, 'Task should be created');

            const updatedTask = await taskManager.updateTask(task.id, {
                name: 'Smoke Task Updated',
                scheduleKind: 'every',
                scheduleEvery: '30m',
                payloadKind: 'agentTurn',
                content: 'Summarize the last two chat turns.',
                enabled: true
            });
            assert.equal(updatedTask.name, 'Smoke Task Updated');

            const disabledTask = await taskManager.toggleTask(task.id, false);
            assert.equal(disabledTask.enabled, false);

            const enabledTask = await taskManager.toggleTask(task.id, true);
            assert.equal(enabledTask.enabled, true);

            const ranTask = await taskManager.runTask(task.id, 'manual');
            assert.equal(ranTask.lastRunStatus, 'success');
            assert.match(ranTask.lastRunSummary || '', /fake run completed/i);

            const viewState = await taskManager.getTaskViewState();
            assert.equal(viewState.available, true);
            assert.ok(viewState.tasks.some((item: any) => item.id === task.id));

            await taskManager.deleteTask(task.id);
            assert.equal(await taskManager.getTask(task.id), undefined);
        } finally {
            setOpenClawCliCommandExecutorForTests(undefined);
            taskManager.dispose();
            usageManager.dispose();
            agentManager.dispose();
            service.dispose();
            gatewayService.dispose();
            await localProvider.dispose();
            await fs.rm(stateDir, { recursive: true, force: true });
        }
    });
});

async function startFakeLocalProvider(): Promise<{
    baseUrl: string;
    dispose(): Promise<void>;
}> {
    const server = http.createServer(async (request: any, response: any) => {
        if (request.method !== 'POST' || request.url !== '/chat/completions') {
            response.writeHead(404);
            response.end();
            return;
        }

        const body = await readRequestBody(request);
        const payload = JSON.parse(body) as {
            messages?: Array<{ role?: string; content?: string }>;
            stream?: boolean;
            model?: string;
        };
        const userMessage = [...(payload.messages || [])]
            .reverse()
            .find((message: any) => message.role === 'user')?.content || '';
        const assistantText = `Fake response for: ${userMessage}`;

        if (payload.stream) {
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });

            const chunks = assistantText.split(' ');
            for (const chunk of chunks) {
                response.write(`data: ${JSON.stringify({
                    choices: [{
                        delta: {
                            content: `${chunk} `
                        }
                    }]
                })}\n\n`);
            }
            response.write('data: [DONE]\n\n');
            response.end();
            return;
        }

        response.writeHead(200, {
            'Content-Type': 'application/json'
        });
        response.end(JSON.stringify({
            id: 'chatcmpl-fake',
            choices: [{
                message: {
                    content: assistantText
                }
            }],
            usage: {
                prompt_tokens: 12,
                completion_tokens: 18,
                total_tokens: 30
            }
        }));
    });

    await new Promise<void>((resolve: any, reject: any) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to start fake local provider');
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        dispose: async () => {
            await new Promise<void>((resolve: any, reject: any) => {
                server.close((error: any) => error ? reject(error) : resolve());
            });
        }
    };
}

async function createFakeOpenClawConfig(stateDir: string): Promise<OpenClawCliServiceConfig> {
    const configPath = path.join(stateDir, 'openclaw.json');
    await fs.mkdir(path.join(stateDir, 'cron', 'runs'), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
        gateway: {
            port: 18789,
            auth: {
                token: ''
            }
        }
    }, undefined, 2), 'utf8');
    await fs.writeFile(path.join(stateDir, 'cron', 'jobs.json'), JSON.stringify({
        version: 1,
        jobs: []
    }, undefined, 2), 'utf8');

    return {
        mode: 'openclaw',
        cliEntryPath: path.resolve(__dirname, '../fixtures/fakeOpenClawCli.js'),
        nodePath: process.execPath,
        stateDir,
        configPath,
        gatewayUrl: 'ws://127.0.0.1:18789',
        gatewayToken: '',
        sourceDescription: configPath
    };
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve: any, reject: any) => {
        let buffer = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: any) => {
            buffer += chunk;
        });
        request.on('end', () => resolve(buffer));
        request.on('error', reject);
    });
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve: any) => setTimeout(resolve, ms));
}
