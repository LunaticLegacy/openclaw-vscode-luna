import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentFolderManager } from '../../managers/agentFolderManager';

suite('agentFolderManager', () => {
    test('persists folders and moves agents between grouped and ungrouped state', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-agent-folder-manager-'));
        const storagePath = path.join(root, 'agent-folders.json');
        const manager = new AgentFolderManager(storagePath);

        try {
            const delivery = await manager.createFolder('Delivery');
            const review = await manager.createFolder('Review');

            await manager.moveAgentToFolder('agent-a', delivery.id);
            await manager.moveAgentToFolder('agent-b', delivery.id);
            await manager.moveAgentToFolder('agent-a', review.id);
            await manager.setFolderCollapsed(review.id, true);

            let folders = await manager.getFolders();
            const deliveryFolder = folders.find(folder => folder.id === delivery.id);
            const reviewFolder = folders.find(folder => folder.id === review.id);

            assert.deepEqual(deliveryFolder?.agentIds, ['agent-b']);
            assert.deepEqual(reviewFolder?.agentIds, ['agent-a']);
            assert.equal(reviewFolder?.collapsed, true);

            const reloaded = new AgentFolderManager(storagePath);
            try {
                await reloaded.pruneMissingAgents(['agent-a']);
                folders = await reloaded.getFolders();
                const prunedDelivery = folders.find(folder => folder.id === delivery.id);
                const prunedReview = folders.find(folder => folder.id === review.id);

                assert.deepEqual(prunedDelivery?.agentIds, []);
                assert.deepEqual(prunedReview?.agentIds, ['agent-a']);

                await reloaded.moveAgentToFolder('agent-a', null);
                folders = await reloaded.getFolders();
                const clearedReview = folders.find(folder => folder.id === review.id);
                assert.deepEqual(clearedReview?.agentIds, []);
            } finally {
                reloaded.dispose();
            }
        } finally {
            manager.dispose();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
