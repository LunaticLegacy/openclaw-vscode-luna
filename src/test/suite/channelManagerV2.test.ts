import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ChannelManagerV2 } from '../../managers/channelManagerV2';
import type { CreateChannelParams, ChannelConfig } from '../../types/channel';

suite('channelManagerV2', () => {
    let root: string;
    let storagePath: string;
    let manager: ChannelManagerV2;

    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-vscode-channel-v2-'));
        storagePath = path.join(root, 'channels.json');
        manager = new ChannelManagerV2(storagePath);
    });

    teardown(async () => {
        manager.dispose();
        await fs.rm(root, { recursive: true, force: true });
    });

    test('creates a root-level channel', async () => {
        const channel = await manager.createChannel({
            name: 'Test Channel',
            agentId: 'agent-1',
        });

        assert.equal(channel.name, 'Test Channel');
        assert.equal(channel.type, 'standard');
        assert.equal(channel.parentId, undefined);
        assert.equal(channel.order, 0);
        assert.equal(channel.childrenIds.length, 0);
    });

    test('creates a child channel (thread)', async () => {
        const parent = await manager.createChannel({
            name: 'Parent',
            agentId: 'agent-1',
        });

        const child = await manager.createChannel({
            name: 'Child Thread',
            agentId: 'agent-1',
            parentId: parent.id,
            type: 'thread',
        });

        assert.equal(child.parentId, parent.id);
        assert.equal(child.type, 'thread');
        
        // Verify parent's children list
        const updatedParent = await manager.getChannel(parent.id);
        assert.ok(updatedParent?.childrenIds.includes(child.id));
    });

    test('builds correct channel tree', async () => {
        // Create hierarchy:
        // Root1
        //   Child1
        //   Child2
        //     GrandChild
        // Root2
        
        const root1 = await manager.createChannel({ name: 'Root1', agentId: 'a1' });
        const root2 = await manager.createChannel({ name: 'Root2', agentId: 'a1' });
        const child1 = await manager.createChannel({ name: 'Child1', agentId: 'a1', parentId: root1.id });
        const child2 = await manager.createChannel({ name: 'Child2', agentId: 'a1', parentId: root1.id });
        const grandchild = await manager.createChannel({ name: 'GrandChild', agentId: 'a1', parentId: child2.id });

        const tree = await manager.getChannelTree();

        // Check roots
        assert.equal(tree.roots.length, 2);
        assert.ok(tree.roots.some((r: any) => r.id === root1.id));
        assert.ok(tree.roots.some((r: any) => r.id === root2.id));

        // Check tree structure
        const root1Node = tree.roots.find((r: any) => r.id === root1.id)!;
        assert.equal(root1Node.children.length, 2);
        assert.ok(root1Node.children.some((c: any) => c.id === child1.id));
        assert.ok(root1Node.children.some((c: any) => c.id === child2.id));

        const child2Node = root1Node.children.find((c: any) => c.id === child2.id)!;
        assert.equal(child2Node.children.length, 1);
        assert.equal(child2Node.children[0].id, grandchild.id);

        // Check all map
        assert.equal(tree.all.size, 5);
    });

    test('moves channel to new parent', async () => {
        const parent1 = await manager.createChannel({ name: 'Parent1', agentId: 'a1' });
        const parent2 = await manager.createChannel({ name: 'Parent2', agentId: 'a1' });
        const child = await manager.createChannel({ name: 'Child', agentId: 'a1', parentId: parent1.id });

        // Move child from parent1 to parent2
        await manager.moveChannel({ channelId: child.id, newParentId: parent2.id });

        const updatedChild = await manager.getChannel(child.id);
        assert.equal(updatedChild?.parentId, parent2.id);

        // Verify old parent no longer has child
        const updatedParent1 = await manager.getChannel(parent1.id);
        assert.ok(!updatedParent1?.childrenIds.includes(child.id));

        // Verify new parent has child
        const updatedParent2 = await manager.getChannel(parent2.id);
        assert.ok(updatedParent2?.childrenIds.includes(child.id));
    });

    test('prevents circular reference on move', async () => {
        const parent = await manager.createChannel({ name: 'Parent', agentId: 'a1' });
        const child = await manager.createChannel({ name: 'Child', agentId: 'a1', parentId: parent.id });

        // Try to move parent into child (circular)
        try {
            await manager.updateChannel(parent.id, { parentId: child.id });
            assert.fail('Should have thrown circular reference error');
        } catch (error) {
            assert.ok((error as Error).message.includes('circular'));
        }
    });

    test('swaps channel order', async () => {
        const channel1 = await manager.createChannel({ name: 'Channel1', agentId: 'a1' });
        const channel2 = await manager.createChannel({ name: 'Channel2', agentId: 'a1' });

        assert.equal(channel1.order, 0);
        assert.equal(channel2.order, 1);

        await manager.swapOrder(channel1.id, channel2.id);

        const updated1 = await manager.getChannel(channel1.id);
        const updated2 = await manager.getChannel(channel2.id);

        assert.equal(updated1?.order, 1);
        assert.equal(updated2?.order, 0);
    });

    test('archives and unarchives channel', async () => {
        const channel = await manager.createChannel({ name: 'ToArchive', agentId: 'a1' });
        
        assert.ok(!channel.archivedAt);

        const archived = await manager.archiveChannel(channel.id);
        assert.ok(archived.archivedAt);

        // Archived channels should not appear in getChannels
        const channels = await manager.getChannels();
        assert.ok(!channels.some((c: any) => c.id === channel.id));

        const unarchived = await manager.unarchiveChannel(channel.id);
        assert.ok(!unarchived.archivedAt);

        const channelsAfter = await manager.getChannels();
        assert.ok(channelsAfter.some((c: any) => c.id === channel.id));
    });

    test('deletes channel with children (move to root)', async () => {
        const parent = await manager.createChannel({ name: 'Parent', agentId: 'a1' });
        const child = await manager.createChannel({ name: 'Child', agentId: 'a1', parentId: parent.id });

        const result = await manager.deleteChannel(parent.id);

        assert.ok(result.deletedIds.includes(parent.id));
        assert.ok(result.movedIds.includes(child.id));

        // Child should now be at root level
        const updatedChild = await manager.getChannel(child.id);
        assert.equal(updatedChild?.parentId, undefined);
    });

    test('deletes channel recursively', async () => {
        const parent = await manager.createChannel({ name: 'Parent', agentId: 'a1' });
        const child = await manager.createChannel({ name: 'Child', agentId: 'a1', parentId: parent.id });
        const grandchild = await manager.createChannel({ name: 'GrandChild', agentId: 'a1', parentId: child.id });

        const result = await manager.deleteChannel(parent.id, { recursive: true });

        assert.equal(result.deletedIds.length, 3);
        assert.ok(result.deletedIds.includes(parent.id));
        assert.ok(result.deletedIds.includes(child.id));
        assert.ok(result.deletedIds.includes(grandchild.id));
        assert.equal(result.movedIds.length, 0);
    });

    test('inherits agent from parent', async () => {
        const parent = await manager.createChannel({ name: 'Parent', agentId: 'parent-agent' });
        const child = await manager.createChannel({ 
            name: 'Child', 
            agentId: 'child-agent',
            parentId: parent.id,
            inheritAgent: true 
        });

        // Child has its own agent but inherits
        assert.equal(child.agentId, 'child-agent');
        assert.equal(child.inheritAgent, true);

        // But effective agent should be parent's
        const effectiveAgent = manager.getEffectiveAgentId(child.id);
        assert.equal(effectiveAgent, 'parent-agent');

        // If child doesn't inherit, effective agent should be its own
        const nonInheritingChild = await manager.createChannel({
            name: 'NonInheriting',
            agentId: 'own-agent',
            parentId: parent.id,
            inheritAgent: false,
        });
        const effectiveOwn = manager.getEffectiveAgentId(nonInheritingChild.id);
        assert.equal(effectiveOwn, 'own-agent');
    });

    test('persists and reloads channel data', async () => {
        const channel = await manager.createChannel({
            name: 'Persistent',
            agentId: 'a1',
            description: 'Test description',
        });

        // Create new manager instance pointing to same file
        const manager2 = new ChannelManagerV2(storagePath);
        
        const channels = await manager2.getChannels();
        const loaded = channels.find((c: any) => c.id === channel.id);

        assert.ok(loaded);
        assert.equal(loaded?.name, 'Persistent');
        assert.equal(loaded?.description, 'Test description');
        assert.equal(loaded?.type, 'standard');

        manager2.dispose();
    });

    test('sets aggregate config', async () => {
        const channel = await manager.createChannel({ name: 'Aggregator', agentId: 'a1' });
        
        const source1 = await manager.createChannel({ name: 'Source1', agentId: 'a1' });
        const source2 = await manager.createChannel({ name: 'Source2', agentId: 'a1' });

        const updated = await manager.setAggregateConfig(channel.id, {
            sourceIds: [source1.id, source2.id],
            transform: 'ai-summarize',
            schedule: 'hourly',
            maxItems: 25,
        });

        assert.equal(updated.type, 'aggregate');
        assert.ok(updated.aggregateConfig);
        assert.equal(updated.aggregateConfig?.sourceIds.length, 2);
        assert.equal(updated.aggregateConfig?.transform, 'ai-summarize');
    });

    test('sets external config', async () => {
        const channel = await manager.createChannel({ name: 'External', agentId: 'a1' });

        const updated = await manager.setExternalConfig(channel.id, {
            provider: 'rss',
            name: 'My RSS Feed',
            enabled: true,
            credentials: {},
            config: { type: 'rss', url: 'https://example.com/feed.xml', fetchFullContent: false },
            sync: { interval: 60, status: 'idle' },
            processing: { deduplicate: true, summarize: false },
        });

        assert.equal(updated.type, 'external');
        assert.ok(updated.externalConfig);
        assert.equal(updated.externalConfig?.provider, 'rss');
    });
});
