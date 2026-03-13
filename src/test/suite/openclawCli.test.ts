import * as assert from 'assert';
import { OpenClawCliRunner } from '../../services/openclawCli';
import type { OpenClawCliServiceConfig } from '../../services/openclawConfig';

suite('openclawCli', () => {
    test('parses JSON output even when stdout contains log lines before the payload', async () => {
        const config: OpenClawCliServiceConfig = {
            mode: 'openclaw',
            cliEntryPath: 'fake-cli.js',
            nodePath: process.execPath,
            stateDir: 'test-state',
            configPath: 'test-state/openclaw.json',
            gatewayUrl: 'ws://127.0.0.1:18789',
            gatewayToken: '',
            sourceDescription: 'test'
        };

        const runner = new OpenClawCliRunner(config, {
            executor: async () => ({
                stdout: [
                    '[qqbot:channel] listAccountIds: ["default"]',
                    '{',
                    '  "chat": {',
                    '    "qqbot": ["default"]',
                    '  }',
                    '}'
                ].join('\n'),
                stderr: ''
            })
        });

        const result = await runner.listChannels();
        assert.deepStrictEqual(result.chat, {
            qqbot: ['default']
        });
    });

    test('passes explicit gateway connection flags to cron commands', async () => {
        const config: OpenClawCliServiceConfig = {
            mode: 'openclaw',
            cliEntryPath: 'fake-cli.js',
            nodePath: process.execPath,
            stateDir: 'test-state',
            configPath: 'test-state/openclaw.json',
            gatewayUrl: 'http://127.0.0.1:18789',
            gatewayToken: 'test-token',
            sourceDescription: 'test'
        };
        const calls: string[][] = [];

        const runner = new OpenClawCliRunner(config, {
            executor: async ({ args }) => {
                calls.push(args);
                return {
                    stdout: '{"id":"job-1"}',
                    stderr: ''
                };
            }
        });

        await runner.addCronJob({
            name: 'demo',
            schedule: {
                kind: 'every',
                every: '10m'
            },
            sessionTarget: 'isolated',
            wakeMode: 'now',
            payload: {
                kind: 'agentTurn',
                message: 'hello'
            }
        });
        await runner.runCronJob('job-1');
        await runner.removeCronJob('job-1');

        assert.deepStrictEqual(calls[0], [
            'cron',
            'add',
            '--json',
            '--url',
            'ws://127.0.0.1:18789',
            '--token',
            'test-token',
            '--name',
            'demo',
            '--every',
            '10m',
            '--session',
            'isolated',
            '--wake',
            'now',
            '--message',
            'hello'
        ]);
        assert.deepStrictEqual(calls[1], [
            'cron',
            'run',
            '--url',
            'ws://127.0.0.1:18789',
            '--token',
            'test-token',
            'job-1'
        ]);
        assert.deepStrictEqual(calls[2], [
            'cron',
            'rm',
            '--url',
            'ws://127.0.0.1:18789',
            '--token',
            'test-token',
            'job-1'
        ]);
    });
});
