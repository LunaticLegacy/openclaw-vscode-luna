import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ChannelManager } from '../../managers/channelManager';

suite('channelManager', () => {
    test('persists channel configs and clears session when the bound agent changes', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-channel-manager-'));
        const storagePath = path.join(root, 'channels.json');
        const manager = new ChannelManager(storagePath);

        try {
            const created = await manager.createChannel({
                name: 'Release Review',
                agentId: 'agent-a',
                description: 'Review release readiness.'
            });

            assert.equal(created.name, 'Release Review');
            assert.equal(created.agentId, 'agent-a');
            assert.equal(created.description, 'Review release readiness.');
            assert.equal(created.sessionId, undefined);

            const withSession = await manager.setChannelSessionId(created.id, 'session-1');
            assert.equal(withSession.sessionId, 'session-1');

            const reloadedManager = new ChannelManager(storagePath);
            try {
                const [persisted] = await reloadedManager.getChannels();
                assert.equal(persisted.id, created.id);
                assert.equal(persisted.sessionId, 'session-1');

                const updated = await reloadedManager.updateChannel(created.id, {
                    agentId: 'agent-b'
                });
                assert.equal(updated.agentId, 'agent-b');
                assert.equal(updated.sessionId, undefined);
            } finally {
                reloadedManager.dispose();
            }

            const finalManager = new ChannelManager(storagePath);
            try {
                const [finalChannel] = await finalManager.getChannels();
                assert.equal(finalChannel.agentId, 'agent-b');
                assert.equal(finalChannel.sessionId, undefined);
            } finally {
                finalManager.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
