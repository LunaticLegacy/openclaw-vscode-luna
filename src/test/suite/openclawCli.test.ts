import * as assert from 'assert';
import WebSocket, { RawData } from 'ws';
import { OpenClawCliRunner } from '../../services/openclawCli';
import type { OpenClawCliServiceConfig } from '../../services/openclawConfig';
import type { WebSocketServerOptions } from '../../types/test';
const WebSocketServer = require('ws').Server as new (options: WebSocketServerOptions) => {
    address(): { port: number } | string | undefined;
    on(event: 'connection', listener: (socket: WebSocket) => void): unknown;
    close(callback: () => void): void;
};

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
            executor: async ({ args }: any) => {
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

    test('falls back to direct gateway websocket calls when chat params exceed Windows command length', async () => {
        const server = new WebSocketServer({ port: 0 });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Failed to allocate test websocket server');
        }

        const requests: Array<{ method?: string; params?: Record<string, unknown> }> = [];
        server.on('connection', (socket: WebSocket) => {
            socket.send(JSON.stringify({
                type: 'event',
                event: 'connect.challenge',
                payload: { nonce: 'test-nonce' }
            }));

            socket.on('message', (raw: RawData) => {
                const message = JSON.parse(String(raw)) as {
                    id: string;
                    method?: string;
                    params?: Record<string, unknown>;
                };

                if (message.method === 'connect') {
                    socket.send(JSON.stringify({
                        type: 'res',
                        id: message.id,
                        ok: true,
                        payload: { type: 'hello-ok' }
                    }));
                    return;
                }

                requests.push({
                    method: message.method,
                    params: message.params
                });
                socket.send(JSON.stringify({
                    type: 'res',
                    id: message.id,
                    ok: true,
                    payload: {
                        status: 'final',
                        echoedLength: String(message.params?.message || '').length
                    }
                }));
            });
        });

        const config: OpenClawCliServiceConfig = {
            mode: 'openclaw',
            cliEntryPath: 'fake-cli.js',
            nodePath: process.execPath,
            stateDir: 'test-state',
            configPath: 'test-state/openclaw.json',
            gatewayUrl: `ws://127.0.0.1:${address.port}`,
            gatewayToken: 'test-token',
            sourceDescription: 'test'
        };
        let executorCalled = false;
        const runner = new OpenClawCliRunner(config, {
            executor: async () => {
                executorCalled = true;
                throw new Error('CLI executor should not be used for oversized gateway payloads');
            }
        });

        try {
            const longMessage = 'x'.repeat(12000);
            const result = await runner.sendChat('agent:test:main', longMessage);

            assert.equal(executorCalled, false);
            assert.equal(requests.length, 1);
            assert.equal(requests[0]?.method, 'chat.send');
            assert.equal(requests[0]?.params?.sessionKey, 'agent:test:main');
            assert.equal(requests[0]?.params?.message, longMessage);
            assert.deepStrictEqual(result, {
                status: 'final',
                echoedLength: 12000
            });
        } finally {
            await new Promise<void>((resolve: any) => server.close(() => resolve()));
        }
    });
});
