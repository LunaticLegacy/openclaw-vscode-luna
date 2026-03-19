import * as vscode from 'vscode';
import { t } from '../i18n';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { showSuccessStatus } from '../utils/statusFeedback';
import { resolveClusterId } from './helpers';

/**
 * 注册集群相关命令
 * @param context - VSCode 扩展上下文
 * @param runtime - 扩展运行时实例
 * @returns 无返回值
 */
export function registerClusterCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.viewClusters', async (clusterArg?: any) => {
            const selectedClusterId = resolveClusterId(clusterArg);
            const clusters = await runtime.clusterManager.getClusters();

            runtime.showPanel().showClusterView(clusters, selectedClusterId);
        }),
        vscode.commands.registerCommand('openclaw.createCluster', async () => {
            const panel = runtime.showPanel();
            const agents = await runtime.agentManager.getAgents();
            if (agents.length === 0) {
                vscode.window.showErrorMessage(t('clusters.createAgentFirst'));
                return;
            }

            const clusters = await runtime.clusterManager.getClusters();
            panel.showClusterView(clusters);
            panel.showClusterEditor();
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
                showSuccessStatus(t('clusters.deleted', { name: cluster.name }));
                runtime.sidebarTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('clusters.deleteFailed', { error: String(error) }));
            }
        })
    );
}
