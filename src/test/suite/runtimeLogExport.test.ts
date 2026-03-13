import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
    collectRuntimeLogFiles,
    redactRuntimeExportSecrets
} from '../../services/openclawConfig/runtimeLogExport';

suite('runtimeLogExport', () => {
    test('redacts nested runtime secrets', () => {
        const input = {
            gatewayToken: 'secret-token',
            nested: {
                api_key: 'abc123',
                password: 'pw',
                visible: 'value'
            },
            list: [
                { token: 'hidden' },
                { normal: 'keep' }
            ]
        };

        const redacted = redactRuntimeExportSecrets(input);

        assert.equal(redacted.gatewayToken, '[REDACTED]');
        assert.equal(redacted.nested.api_key, '[REDACTED]');
        assert.equal(redacted.nested.password, '[REDACTED]');
        assert.equal(redacted.nested.visible, 'value');
        assert.equal(redacted.list[0].token, '[REDACTED]');
        assert.equal(redacted.list[1].normal, 'keep');
    });

    test('collects runtime logs while excluding agent session transcripts', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-runtime-logs-'));

        try {
            await fs.mkdir(path.join(root, 'logs'), { recursive: true });
            await fs.mkdir(path.join(root, 'cron'), { recursive: true });
            await fs.mkdir(path.join(root, 'agents', 'alpha', 'sessions'), { recursive: true });
            await fs.writeFile(path.join(root, 'logs', 'gateway.log'), 'gateway log', 'utf8');
            await fs.writeFile(path.join(root, 'cron', 'jobs.json'), '{"jobs":[]}', 'utf8');
            await fs.writeFile(path.join(root, 'notes.txt'), 'note', 'utf8');
            await fs.writeFile(path.join(root, 'agents', 'alpha', 'sessions', 's1.jsonl'), '{"role":"assistant"}\n', 'utf8');

            const result = await collectRuntimeLogFiles(root, {
                maxFiles: 10,
                maxScannedEntries: 50
            });

            assert.equal(result.scannedRoot, root);
            assert.deepEqual(
                result.files.map(entry => entry.path).sort(),
                ['cron/jobs.json', 'logs/gateway.log', 'notes.txt']
            );
            assert.equal(result.files.some(entry => entry.path.includes('/sessions/')), false);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
