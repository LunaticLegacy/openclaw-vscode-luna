import * as assert from 'assert/strict';
import type { ChatMessage } from '../../services/openclawService';
import {
    buildClusterContextExportBundle,
    parseClusterSwarmReplayImport,
    resolveContextExportPath,
    type ClusterAgentContextExportBody,
    type ClusterSwarmContextExportBody
} from '../../panels/openclawPanel/contextExport';

suite('contextExport', () => {
    test('resolves export paths for readable and raw modes', () => {
        assert.equal(
            resolveContextExportPath('C:\\temp\\swarm-context.md', 'readable'),
            'C:\\temp\\swarm-context.md'
        );
        assert.equal(
            resolveContextExportPath('C:\\temp\\swarm-context.md', 'raw'),
            'C:\\temp\\swarm-context.json'
        );
        assert.equal(
            resolveContextExportPath('C:\\temp\\swarm-context.json', 'readable'),
            'C:\\temp\\swarm-context.md'
        );
    });

    test('renders agent readable export without raw internals', () => {
        const body: ClusterAgentContextExportBody = {
            exportedAt: '2026-03-14T00:00:00.000Z',
            kind: 'cluster-agent-context',
            cluster: {
                id: 'cluster-1',
                name: 'Swarm',
                agentIds: ['alpha', 'beta']
            },
            agent: {
                id: 'alpha',
                name: 'Alpha',
                model: 'gpt-test'
            },
            currentView: 'chat',
            messageCounts: {
                direct: 1,
                broadcast: 0,
                collaborate: 1
            },
            conversations: {
                direct: [createMessage('direct-1', 'assistant', 'Direct reply', {
                    displayName: 'Alpha',
                    parts: [{
                        type: 'thinking',
                        thinking: 'Reason through the direct reply.'
                    }]
                })],
                broadcast: [createMessage('lifecycle-1', 'system', 'Context was compacted during this run.', {
                    metadata: {
                        noticeType: 'lifecycle',
                        noticeKind: 'compression'
                    }
                })],
                collaborate: [createMessage('collab-1', 'assistant', 'Revision answer', {
                    displayName: 'Alpha',
                    contextLabel: 'Revision Round 1',
                    parts: [
                        {
                            type: 'toolCall',
                            name: 'search_docs',
                            arguments: { query: 'cluster export' }
                        },
                        {
                            type: 'toolResult',
                            name: 'search_docs',
                            result: 'Found export notes.',
                            details: { hits: 2 }
                        }
                    ],
                    metadata: {
                        swarmBatchId: 'batch-1'
                    }
                })]
            }
        };

        const bundle = buildClusterContextExportBundle('swarm-alpha-context', body);

        assert.equal(bundle.readableFileName, 'swarm-alpha-context.md');
        assert.equal(bundle.rawFileName, 'swarm-alpha-context.json');
        assert.doesNotMatch(bundle.readableMarkdown, /## Raw Context/);
        assert.doesNotMatch(bundle.readableMarkdown, /Reason through the direct reply\./);
        assert.doesNotMatch(bundle.readableMarkdown, /\*\*Tool Call: search_docs\*\*/);
        assert.doesNotMatch(bundle.readableMarkdown, /Context was compacted during this run\./);
        assert.match(bundle.readableMarkdown, /Direct reply/);
        assert.match(bundle.readableMarkdown, /Revision answer/);
    });

    test('renders swarm export markdown timeline', () => {
        const body: ClusterSwarmContextExportBody = {
            exportedAt: '2026-03-14T00:00:00.000Z',
            kind: 'cluster-swarm-context',
            cluster: {
                id: 'cluster-1',
                name: 'Swarm',
                agentIds: ['alpha', 'beta']
            },
            mode: 'collaborate',
            messageCount: 2,
            messages: [
                createMessage('msg-1', 'user', 'Plan the release', {
                    contextLabel: 'Collaborate'
                }),
                createMessage('msg-2', 'assistant', 'Final merged answer', {
                    displayName: 'Final Answer',
                    contextLabel: 'Coordinator: Alpha'
                })
            ]
        };

        const bundle = buildClusterContextExportBundle('swarm-collaborate-context', body);

        assert.match(bundle.readableMarkdown, /### Collaboration Timeline/);
        assert.match(bundle.readableMarkdown, /Final merged answer/);
        assert.match(bundle.readableMarkdown, /Coordinator: Alpha/);
    });

    test('parses swarm replay import and normalizes messages', () => {
        const replay = parseClusterSwarmReplayImport('C:\\temp\\swarm.json', JSON.stringify({
            exportedAt: '2026-03-14T00:00:00.000Z',
            kind: 'cluster-swarm-context',
            cluster: {
                id: 'cluster-1',
                name: 'Swarm',
                agentIds: ['alpha', 'beta']
            },
            mode: 'broadcast',
            messageCount: 3,
            messages: [
                createMessage('msg-1', 'user', 'Run the swarm'),
                createMessage('msg-2', 'assistant', 'Alpha reply', {
                    agentId: 'alpha',
                    metadata: {
                        swarmLatencyMs: 2300
                    }
                }),
                {
                    ignore: true
                }
            ]
        }));

        assert.equal(replay.sourcePath, 'C:\\temp\\swarm.json');
        assert.equal(replay.body.mode, 'broadcast');
        assert.equal(replay.body.messageCount, 2);
        assert.equal(replay.body.messages[1]?.agentId, 'alpha');
        assert.equal(replay.body.messages[1]?.metadata?.swarmLatencyMs, 2300);
    });

    test('rejects non-swarm replay imports', () => {
        assert.throws(
            () => parseClusterSwarmReplayImport('C:\\temp\\agent.json', JSON.stringify({
                kind: 'cluster-agent-context'
            })),
            /Only swarm context JSON exports can be replayed\./
        );
    });
});

function createMessage(
    id: string,
    role: ChatMessage['role'],
    content: string,
    overrides: Partial<ChatMessage> = {}
): ChatMessage {
    return {
        id,
        role,
        content,
        timestamp: '2026-03-14T00:00:00.000Z',
        ...overrides
    };
}
