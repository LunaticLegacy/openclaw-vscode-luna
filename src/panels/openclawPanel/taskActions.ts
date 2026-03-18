import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { OpenClawBooleanCapabilityId } from '../../services/openclawService';
import type { ScheduledTaskManager } from '../../managers/scheduledTaskManager';
import { getCapabilityUnavailableMessage } from '../../utils/capabilitySupport';
import { runWithNotificationProgress, showSuccessStatus } from '../../utils/statusFeedback';

/**
 * Context interface for task action operations
 */
interface TaskActionContext {
    taskManager: ScheduledTaskManager;
    postMessage(message: Record<string, unknown>): void;
    ensureCapability(capabilityId: OpenClawBooleanCapabilityId): boolean;
    loadTasks(): Promise<void>;
}

/**
 * Loads the scheduled tasks and their view state
 * @param context - The task action context
 */
export async function loadTasks(context: TaskActionContext): Promise<void> {
    try {
        const viewState = await context.taskManager.getTaskViewState();
        context.postMessage({
            type: 'tasksLoaded',
            available: viewState.available,
            message: viewState.message,
            sourcePath: viewState.sourcePath,
            tasks: viewState.tasks
        });
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('panel.failedLoadTasks', { error: String(error) })
        });
    }
}

/**
 * Handles creating a new scheduled task
 * @param context - The task action context
 * @param data - The task creation data
 */
export async function handleCreateTask(context: TaskActionContext, data: any): Promise<void> {
    if (!context.ensureCapability('scheduledTasks')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
        return;
    }

    try {
        await runWithNotificationProgress(t('progress.savingTask'), async () => {
            await context.taskManager.createTask(data);
            await context.loadTasks();
        });
        showSuccessStatus(t('tasks.created'));
    } catch (error) {
        vscode.window.showErrorMessage(t('tasks.createFailed', { error: String(error) }));
    }
}

/**
 * Handles updating an existing scheduled task
 * @param context - The task action context
 * @param taskId - The ID of the task to update
 * @param data - The updated task data
 */
export async function handleUpdateTask(context: TaskActionContext, taskId: string, data: any): Promise<void> {
    if (!context.ensureCapability('scheduledTasks')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
        return;
    }

    try {
        await runWithNotificationProgress(t('progress.savingTask'), async () => {
            await context.taskManager.updateTask(taskId, data);
            await context.loadTasks();
        });
        showSuccessStatus(t('tasks.updated'));
    } catch (error) {
        vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
    }
}

/**
 * Handles deleting a scheduled task
 * @param context - The task action context
 * @param taskId - The ID of the task to delete
 */
export async function handleDeleteTask(context: TaskActionContext, taskId: string): Promise<void> {
    if (!context.ensureCapability('scheduledTasks')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
        return;
    }

    try {
        const task = await context.taskManager.getTask(taskId);
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
            await context.taskManager.deleteTask(taskId);
            await context.loadTasks();
        });
        showSuccessStatus(t('tasks.deleted'));
    } catch (error) {
        vscode.window.showErrorMessage(t('tasks.deleteFailed', { error: String(error) }));
    }
}

/**
 * Handles toggling a task's enabled state
 * @param context - The task action context
 * @param taskId - The ID of the task to toggle
 * @param enabled - Optional explicit enabled state
 */
export async function handleToggleTask(context: TaskActionContext, taskId: string, enabled?: boolean): Promise<void> {
    if (!context.ensureCapability('scheduledTasks')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
        return;
    }

    try {
        const task = await runWithNotificationProgress(t('progress.savingTask'), async () => {
            const nextTask = await context.taskManager.toggleTask(taskId, enabled);
            await context.loadTasks();
            return nextTask;
        });
        showSuccessStatus(task.enabled ? t('tasks.enabled') : t('tasks.disabled'));
    } catch (error) {
        vscode.window.showErrorMessage(t('tasks.updateFailed', { error: String(error) }));
    }
}

/**
 * Handles running a scheduled task manually
 * @param context - The task action context
 * @param taskId - The ID of the task to run
 */
export async function handleRunTask(context: TaskActionContext, taskId: string): Promise<void> {
    if (!context.ensureCapability('scheduledTasks')) {
        vscode.window.showErrorMessage(getCapabilityUnavailableMessage('scheduledTasks'));
        return;
    }

    try {
        await runWithNotificationProgress(t('progress.runningTask'), async () => {
            await context.taskManager.runTask(taskId, 'manual');
            await context.loadTasks();
        });
        showSuccessStatus(t('tasks.runTriggered'));
    } catch (error) {
        vscode.window.showErrorMessage(t('tasks.runFailed', { error: String(error) }));
    }
}
