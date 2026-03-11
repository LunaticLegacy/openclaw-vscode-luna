import * as vscode from 'vscode';

const STATUS_PREFIX = 'OpenClaw: ';

export function showSuccessStatus(message: string, timeoutMs: number = 4000): void {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }

    void vscode.window.setStatusBarMessage(`${STATUS_PREFIX}${normalized}`, timeoutMs);
}

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
