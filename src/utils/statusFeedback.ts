import * as vscode from 'vscode';

const STATUS_PREFIX = 'OpenClaw: ';

/**
 * 显示成功状态栏消息
 * @param message - 消息内容
 * @param timeoutMs - 超时时间（毫秒），默认为4000
 */
export function showSuccessStatus(message: string, timeoutMs: number = 4000): void {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }

    void vscode.window.setStatusBarMessage(`${STATUS_PREFIX}${normalized}`, timeoutMs);
}

/**
 * 显示警告状态栏消息
 * @param message - 消息内容
 * @param timeoutMs - 超时时间（毫秒），默认为6000
 */
export function showWarningStatus(message: string, timeoutMs: number = 6000): void {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }

    void vscode.window.setStatusBarMessage(`${STATUS_PREFIX}${normalized}`, timeoutMs);
}

/**
 * 显示警告通知弹窗
 * @param message - 消息内容
 */
export async function showWarningNotification(message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }

    await vscode.window.showWarningMessage(normalized);
}

/**
 * 在通知进度条中运行任务
 * @param title - 进度条标题
 * @param task - 要执行的任务
 * @returns 任务的执行结果
 */
export async function runWithNotificationProgress<T>(
    title: string,
    task: () => Thenable<T> | Promise<T>
): Promise<T> {
    const normalized = title.trim();
    if (!normalized) {
        return await task();
    }

    return await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: normalized,
            cancellable: false
        },
        async () => await task()
    );
}
