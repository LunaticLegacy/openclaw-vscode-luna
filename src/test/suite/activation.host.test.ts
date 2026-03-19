import * as assert from 'assert/strict';
import * as vscode from 'vscode';

if ('extensions' in (vscode as unknown as Record<string, unknown>)) {
    suite('OpenClaw Extension Host', () => {
        test('activates the extension and exposes the primary command path', async () => {
            const extension = vscode.extensions.getExtension('lunaticlegacy.openclaw-vscode-luna');
            assert.ok(extension, 'Expected the extension under test to be installed');

            await extension.activate();
            assert.equal(extension.isActive, true);

            const commands = await vscode.commands.getCommands(true);
            for (const command of [
                'openclaw.openPanel',
                'openclaw.newAgent',
                'openclaw.manageTasks',
                'openclaw.apiUsage'
            ]) {
                assert.ok(commands.includes(command), `Expected command ${command} in the extension host`);
            }

            await assert.doesNotReject(async () => {
                await vscode.commands.executeCommand('openclaw.openPanel');
            });
        });
    });
}
