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
});
