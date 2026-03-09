import * as vscode from 'vscode';

const STATUS_PREFIX = 'OpenClaw: ';

export function showSuccessStatus(message: string, timeoutMs: number = 4000): void {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }

    void vscode.window.setStatusBarMessage(`${STATUS_PREFIX}${normalized}`, timeoutMs);
}
