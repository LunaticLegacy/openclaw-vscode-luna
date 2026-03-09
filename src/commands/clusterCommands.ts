import * as vscode from 'vscode';
import { t } from '../i18n';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { resolveClusterId } from './helpers';

export function registerClusterCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.viewClusters', async (clusterArg?: any) => {
            const selectedClusterId = resolveClusterId(clusterArg);
            const clusters = await runtime.clusterManager.getClusters();

            if (clusters.length === 0) {
                const createNew = await vscode.window.showInformationMessage(
                    t('clusters.noneFound'),
                    t('common.yes'),
                    t('common.no')
                );

                if (createNew === t('common.yes')) {
                    await vscode.commands.executeCommand('openclaw.createCluster');
                }
                return;
            }

            runtime.showPanel().showClusterView(clusters, selectedClusterId);
        }),
        vscode.commands.registerCommand('openclaw.createCluster', async () => {
            const name = await vscode.window.showInputBox({
                prompt: t('clusters.promptName'),
                placeHolder: t('clusters.placeholderName')
            });

            if (!name) {
                return;
            }

            const agents = await runtime.agentManager.getAgents();
            if (agents.length === 0) {
                vscode.window.showErrorMessage(t('clusters.createAgentFirst'));
                return;
            }

            const selectedAgents = await vscode.window.showQuickPick(
                agents.map(agent => ({ label: agent.name, picked: false, agentId: agent.id })),
                {
                    placeHolder: t('clusters.selectAgents'),
                    canPickMany: true
                }
            );

            if (!selectedAgents || selectedAgents.length === 0) {
                return;
            }

            try {
                await runtime.clusterManager.createCluster({
                    name,
                    agentIds: selectedAgents.map(agent => agent.agentId)
                });

                vscode.window.showInformationMessage(t('clusters.created', { name }));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('clusters.createFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.deleteCluster', async (clusterArg: any) => {
            try {
                let clusterId = resolveClusterId(clusterArg);
                if (!clusterId) {
                    const clusters = await runtime.clusterManager.getClusters();
                    if (clusters.length === 0) {
                        vscode.window.showInformationMessage(t('clusters.noneFound'));
                        return;
                    }

                    const selectedCluster = await vscode.window.showQuickPick(
                        clusters.map(cluster => ({
                            label: cluster.name,
                            description: t('clusterTree.agentsCount', { count: cluster.agentIds.length }),
                            clusterId: cluster.id
                        })),
                        {
                            placeHolder: t('clusters.selectClusterToDelete')
                        }
                    );

                    if (!selectedCluster) {
                        return;
                    }

                    clusterId = selectedCluster.clusterId;
                }

                const cluster = await runtime.clusterManager.getCluster(clusterId);
                if (!cluster) {
                    vscode.window.showErrorMessage(t('clusterManager.notFound', { clusterId }));
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    t('clusters.deleteConfirm', { name: cluster.name }),
                    { modal: true },
                    t('common.delete')
                );

                if (confirm !== t('common.delete')) {
                    return;
                }

                await runtime.clusterManager.deleteCluster(clusterId);
                vscode.window.showInformationMessage(t('clusters.deleted', { name: cluster.name }));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('clusters.deleteFailed', { error: String(error) }));
            }
        })
    );
}
