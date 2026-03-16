import * as vscode from 'vscode';
import { t } from '../i18n';
import { OpenClawExtensionRuntime } from '../extension/runtime';
import { getCapabilityUnavailableMessage, isServiceCapabilityAvailable } from '../utils/capabilitySupport';
import { runWithNotificationProgress, showSuccessStatus } from '../utils/statusFeedback';
import { resolveTaskId } from './helpers';

export function registerTaskCommands(
    context: vscode.ExtensionContext,
    runtime: OpenClawExtensionRuntime
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.manageTasks', () => {
            runtime.showPanel().showTaskView();
        }),
        vscode.commands.registerCommand('openclaw.createTask', async () => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            await runtime.showPanel().showTaskEditor();
        }),
        vscode.commands.registerCommand('openclaw.editTask', async (taskArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            const taskId = resolveTaskId(taskArg);
            await runtime.showPanel().showTaskEditor(taskId);
        }),
        vscode.commands.registerCommand('openclaw.toggleTask', async (taskArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            const taskId = resolveTaskId(taskArg);
            if (!taskId) {
                vscode.window.showErrorMessage(t('tasks.selectionRequired'));
                return;
            }

            try {
                const task = await runWithNotificationProgress(t('progress.savingTask'), async () =>
                    await runtime.taskManager.toggleTask(taskId)
                );
                showSuccessStatus(task.enabled ? t('tasks.enabled') : t('tasks.disabled'));
                runtime.taskTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.runTask', async (taskArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            const taskId = resolveTaskId(taskArg);
            if (!taskId) {
                vscode.window.showErrorMessage(t('tasks.selectionRequired'));
                return;
            }

            try {
                await runWithNotificationProgress(t('progress.runningTask'), async () => {
                    await runtime.taskManager.runTask(taskId, 'manual');
                });
                showSuccessStatus(t('tasks.runTriggered'));
                runtime.taskTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('tasks.runFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.deleteTask', async (taskArg: any) => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            const taskId = resolveTaskId(taskArg);
            if (!taskId) {
                vscode.window.showErrorMessage(t('tasks.selectionRequired'));
                return;
            }

            try {
                const task = await runtime.taskManager.getTask(taskId);
                if (!task) {
                    vscode.window.showErrorMessage(t('tasks.notFound', { taskId }));
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    t('tasks.deleteConfirm', { name: task.name }),
                    { modal: true },
                    t('common.delete')
                );

                if (confirm !== t('common.delete')) {
                    return;
                }

                await runWithNotificationProgress(t('progress.deletingTask'), async () => {
                    await runtime.taskManager.deleteTask(taskId);
                });
                showSuccessStatus(t('tasks.deleted'));
                runtime.taskTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(t('tasks.deleteFailed', { error: String(error) }));
            }
        }),
        vscode.commands.registerCommand('openclaw.refreshTasks', async () => {
            if (!isServiceCapabilityAvailable(runtime.service, 'scheduledTasks')) {
                vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
                return;
            }

            try {
                await runWithNotificationProgress(t('progress.loadingTasks'), async () => {
                    await runtime.taskManager.refresh();
                });
                runtime.taskTreeProvider.refresh();
                showSuccessStatus(t('tasks.refreshed'));
            } catch (error) {
                vscode.window.showErrorMessage(t('tasks.refreshFailed', { error: String(error) }));
            }
        })
    );
}
