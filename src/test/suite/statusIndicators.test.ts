import * as assert from 'assert/strict';
import { AgentManager } from '../../managers/agentManager';
import { getAgentStatusIndicator, getClusterStatusIndicator } from '../../providers/statusIndicators';
import { LocalServiceConfig } from '../../services/openclawConfig';
import { OpenClawService } from '../../services/openclawService';

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('Status Indicators', () => {
    test('uses a queued warning color for idle agents', () => {
        assert.deepEqual(getAgentStatusIndicator('idle'), {
            iconId: 'circle-outline',
            colorId: 'testing.iconQueued'
        });
        assert.deepEqual(getAgentStatusIndicator('active'), {
            iconId: 'circle-filled',
            colorId: 'testing.iconPassed'
        });
        assert.deepEqual(getAgentStatusIndicator('offline'), {
            iconId: 'circle-slash',
            colorId: 'disabledForeground'
        });
    });

    test('keeps cluster indicators on the active/inactive palette', () => {
        assert.deepEqual(getClusterStatusIndicator('active'), {
            iconId: 'server',
            colorId: 'testing.iconPassed'
        });
        assert.deepEqual(getClusterStatusIndicator('inactive'), {
            iconId: 'server',
            colorId: 'disabledForeground'
        });
    });

    test('starts local agents idle and only marks them active during a tracked run', async () => {
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
            sourceDescription: 'status-indicator-test'
        };
        const service = new OpenClawService(localConfig);
        const agentManager = new AgentManager(service);

        try {
            const [agent] = await agentManager.getAgents(true);
            assert.ok(agent, 'Expected one local agent');
            assert.equal(agent.status, 'idle');

            assert.equal(agentManager.beginAgentRun(agent.id), true);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'active');

            assert.equal(agentManager.endAgentRun(agent.id), true);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'active');
            await wait(1300);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'idle');

            const created = await agentManager.createAgent({
                name: 'Custom Local Agent',
                model: 'fake-model',
                systemPrompt: 'You are a local test agent.'
            });
            assert.equal(created.status, 'idle');
        } finally {
            agentManager.dispose();
            service.dispose();
        }
    });

    test('uses offline, idle, and active as a connection-aware state machine', async () => {
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
            sourceDescription: 'status-state-machine-test'
        };
        const service = new OpenClawService(localConfig);
        const agentManager = new AgentManager(service);

        try {
            const [agent] = await agentManager.getAgents(true);
            assert.ok(agent, 'Expected one local agent');

            (service as unknown as { emit(event: string, value: boolean): void }).emit('connectionChange', false);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'offline');

            assert.equal(agentManager.beginAgentRun(agent.id), false);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'offline');

            (service as unknown as { emit(event: string, value: boolean): void }).emit('connectionChange', true);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'idle');

            assert.equal(agentManager.beginAgentRun(agent.id), true);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'active');

            assert.equal(agentManager.endAgentRun(agent.id), true);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'active');
            await wait(1300);
            assert.equal((await agentManager.getAgent(agent.id))?.status, 'idle');
        } finally {
            agentManager.dispose();
            service.dispose();
        }
    });
});
