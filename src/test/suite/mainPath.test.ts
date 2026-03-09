import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { getAgentPresets } from '../../config/agentPresets';
import { AgentManager } from '../../managers/agentManager';
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
    LocalServiceConfig,
    mergeOpenClawAuthProfilesForSave,
    mergeOpenClawConfigForSave,
    OpenClawCliServiceConfig
} from '../../services/openclawConfig';
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

        const commands = new Set((manifest.contributes?.commands || []).map(item => item.command));
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
        assert.ok(openClawViews.some(view => view.id === 'openclawSidebar' && view.when === 'openclaw.enabled'));
        assert.ok(openClawViews.some(view => view.id === 'openclawTasks' && view.when === 'openclaw.enabled'));
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

        const usage = mapOpenClawUsage(sessionsUsage, null, undefined, {
            sessionModels: sessionHints,
            agentModels: new Map([['default', 'kimi-k2.5']]),
            defaultModel: 'kimi-k2.5'
        });

        assert.equal(usage.byModel['kimi-k2.5']?.requests, 1);
        assert.equal(usage.byModel['kimi-k2.5']?.tokens, 200);
        assert.equal(usage.byModel['unknown'], undefined);
        assert.equal(usage.byModel['moonshot'], undefined);
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

            service.updateConfig(openClawConfig);
            assert.equal(service.getMode(), 'openclaw');
            assert.equal(await service.checkConnection(), true, 'OpenClaw mode should connect');
            assert.equal(service.supportsCapability('agentEditing'), false);
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

            const openClawSession = await service.createChatSession(openClawAgent.id);
            const openClawResponse = await service.sendMessage(openClawSession.id, 'Summarize the OpenClaw path.');
            assert.equal(openClawResponse.role, 'assistant');
            assert.match(openClawResponse.content, /fake openclaw reply/i);

            const openClawUsage = await usageManager.getUsage();
            assert.equal(openClawUsage.totalRequests, 1);
            assert.equal(openClawUsage.byModel['fake-openclaw-model']?.requests, 1);

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
            assert.ok(viewState.tasks.some(item => item.id === task.id));

            await taskManager.deleteTask(task.id);
            assert.equal(await taskManager.getTask(task.id), null);
        } finally {
            setOpenClawCliCommandExecutorForTests(null);
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
    const server = http.createServer(async (request, response) => {
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
            .find(message => message.role === 'user')?.content || '';
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

    await new Promise<void>((resolve, reject) => {
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
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
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
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(stateDir, 'cron', 'jobs.json'), JSON.stringify({
        version: 1,
        jobs: []
    }, null, 2), 'utf8');

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
    return new Promise((resolve, reject) => {
        let buffer = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            buffer += chunk;
        });
        request.on('end', () => resolve(buffer));
        request.on('error', reject);
    });
}
