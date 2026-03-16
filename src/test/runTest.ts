import Module = require('module');
import { run } from './suite/index';

installVscodeStub();

async function main(): Promise<void> {
    try {
        await run();
    } catch (error) {
        console.error('Failed to run OpenClaw extension tests.', error);
        process.exit(1);
    }
}

void main();

function installVscodeStub(): void {
    const moduleCtor = Module as typeof Module & {
        _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
    };
    const originalLoad = moduleCtor._load;
    const vscodeStub = createVscodeStub();

    moduleCtor._load = function(request, parent, isMain) {
        if (request === 'vscode') {
            return vscodeStub;
        }

        return originalLoad.call(this, request, parent, isMain);
    };
}

function createVscodeStub(): Record<string, unknown> {
    const disposable = { dispose() { return undefined; } };

    return {
        env: {
            language: 'en'
        },
        commands: {
            executeCommand: async () => undefined,
            registerCommand: () => disposable,
            getCommands: async () => []
        },
        workspace: {
            workspaceFile: undefined,
            workspaceFolders: undefined,
            fs: {
                stat: async () => undefined,
                createDirectory: async () => undefined
            },
            getConfiguration: () => ({
                get: <T>(_key: string, defaultValue?: T) => defaultValue,
                update: async () => undefined,
                inspect: () => undefined
            }),
            onDidChangeConfiguration: () => disposable
        },
        window: {
            setStatusBarMessage: () => disposable,
            showInformationMessage: async () => undefined,
            showWarningMessage: async () => undefined,
            showErrorMessage: async () => undefined,
            withProgress: async (
                _options: unknown,
                task: (progress: { report(value: { message?: string; increment?: number }): void }) => Promise<unknown>
            ) => await task({ report: () => undefined }),
            createStatusBarItem: () => ({
                text: '',
                tooltip: '',
                command: '',
                show() { return undefined; },
                dispose() { return undefined; }
            })
        },
        StatusBarAlignment: {
            Left: 1,
            Right: 2
        },
        ProgressLocation: {
            SourceControl: 1,
            Window: 10,
            Notification: 15
        },
        ConfigurationTarget: {
            Global: 1,
            Workspace: 2,
            WorkspaceFolder: 3
        }
    };
}
