import * as assert from 'assert/strict';
import { handlePanelMessage } from '../../panels/openclawPanel/messageRouter';

suite('messageRouter', () => {
    test('forwards selected swarm run id during cluster conversation export', async () => {
        const exportCalls: any[] = [];
        const context = createMessageRouterContext({
            exportClusterConversation: async (options: any) => {
                exportCalls.push(options);
            }
        });

        await handlePanelMessage(context as any, {
            type: 'exportClusterConversation',
            clusterId: 'cluster-1',
            targetKind: 'swarm',
            exportKind: 'raw',
            mode: 'collaborate',
            swarmRunId: 'run-9'
        });

        assert.deepEqual(exportCalls, [{
            clusterId: 'cluster-1',
            targetKind: 'swarm',
            exportKind: 'raw',
            mode: 'collaborate',
            swarmRunId: 'run-9',
            agentId: undefined,
            agentViewMode: 'chat'
        }]);
    });
});

function createMessageRouterContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const noop = async () => undefined;
    return {
        issueTrackerUrl: '',
        setWebviewReady: () => undefined,
        flushPendingMessages: () => undefined,
        postRuntimeState: () => undefined,
        refreshRuntimeState: noop,
        isInitialDataLoaded: () => true,
        setInitialDataLoaded: () => undefined,
        loadAgents: noop,
        loadChannels: noop,
        loadClusters: noop,
        loadTasks: noop,
        loadUsage: noop,
        handleSendMessage: noop,
        handleStopActiveRun: () => undefined,
        activateAgent: noop,
        loadClusterSwarmMessages: noop,
        loadClusterAgentMessages: noop,
        loadClusterAgentSwarmMessages: noop,
        exportClusterConversation: noop,
        exportClusterSwarm: noop,
        importClusterSwarm: noop,
        importClusterReplay: noop,
        exportRuntimeLogs: noop,
        clearChat: () => undefined,
        refreshAgents: noop,
        handleCreateAgent: noop,
        handleCreateAgentsBatch: noop,
        showClusterEditor: () => undefined,
        handleSaveCluster: noop,
        handleCreateClusterFromMemberPreset: noop,
        activateChannel: noop,
        refreshActiveChannelMessages: noop,
        handleCreateChannel: noop,
        handleUpdateChannel: noop,
        handleDeleteChannel: noop,
        handleSendChannelMessage: noop,
        handleAddAgentsToCluster: noop,
        handleRemoveAgentsFromCluster: noop,
        handleDeleteAgent: noop,
        promptDeleteAgentsBatch: noop,
        promptCreateAgentFolder: noop,
        promptRenameAgentFolder: noop,
        promptDeleteAgentFolder: noop,
        handleCreateAgentFolder: noop,
        handleRenameAgentFolder: noop,
        handleDeleteAgentFolder: noop,
        handleToggleAgentFolder: noop,
        handleMoveAgentToFolder: noop,
        handleCreateTask: noop,
        handleUpdateTask: noop,
        handleDeleteTask: noop,
        handleToggleTask: noop,
        handleRunTask: noop,
        setViewMode: () => undefined,
        getCurrentChannelId: () => undefined,
        handleBroadcast: noop,
        promptBroadcastToCluster: noop,
        handleCollaborate: noop,
        handleClusterAgentMessage: noop,
        handleClusterAgentSessionCommand: noop,
        promptCollaborateCluster: noop,
        handleSaveAgentSettings: noop,
        handleRetryConnection: noop,
        handleStartOpenClaw: noop,
        handleSaveConnectionSettings: noop,
        handleSaveOpenClawConfig: noop,
        loadSkillMarket: noop,
        refreshSkillMarket: noop,
        installSkill: noop,
        uninstallSkill: noop,
        toggleSkillForAgent: noop,
        refreshMemoryStatus: noop,
        openMemoryRoot: noop,
        exportMemoryBundle: noop,
        importMemoryBundle: noop,
        ...overrides
    };
}
