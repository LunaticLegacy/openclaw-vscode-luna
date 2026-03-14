import * as vscode from 'vscode';

import { t } from '../../i18n';
import {
    inspectOpenClawEnvironment,
    loadOpenClawConfigEditorState,
    OpenClawConfigEditorState,
    OpenClawRuntimeDiagnostics,
    resolveOpenClawServiceConfig,
    saveOpenClawConfigEditorState,
    startOpenClawGateway
} from '../../services/openclawConfig';
import type { OpenClawService } from '../../services/openclawService';
import { runWithNotificationProgress } from '../../utils/statusFeedback';
import { delay } from './helpers';

interface RuntimeActionContext {
    service: OpenClawService;
    extensionPath: string;
    postMessage(message: Record<string, unknown>): void;
    getRuntimeDiagnostics(): OpenClawRuntimeDiagnostics | null;
    setRuntimeDiagnostics(value: OpenClawRuntimeDiagnostics | null): void;
    getOpenClawConfigState(): OpenClawConfigEditorState | null;
    setOpenClawConfigState(value: OpenClawConfigEditorState | null): void;
    loadAgents(): Promise<void>;
    loadClusters(): Promise<void>;
    loadTasks(): Promise<void>;
}

const OPENCLAW_STARTUP_TIMEOUT_MS = 30000;
const OPENCLAW_STARTUP_POLL_INTERVAL_MS = 500;

async function waitForServiceConnection(
    service: OpenClawService,
    timeoutMs: number = OPENCLAW_STARTUP_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await service.checkConnection()) {
            return;
        }

        await delay(OPENCLAW_STARTUP_POLL_INTERVAL_MS);
    }

    throw new Error(`OpenClaw gateway did not become ready within ${Math.ceil(timeoutMs / 1000)}s.`);
}

export function postRuntimeState(context: RuntimeActionContext): void {
    const mode = context.service.getMode();
    const capabilities = context.service.getModeCapabilities();
    context.postMessage({
        type: 'runtimeState',
        connected: context.service.isConnected(),
        mode,
        sourceDescription: context.service.getSourceDescription(),
        supportsTasks: capabilities.supports.scheduledTasks,
        supportsLiveSync: capabilities.supports.liveSessionSync,
        capabilities,
        capabilityMatrix: context.service.getModeCapabilityMatrix(),
        diagnostics: context.getRuntimeDiagnostics(),
        openClawConfig: context.getOpenClawConfigState()
    });
}

export async function refreshRuntimeState(context: RuntimeActionContext): Promise<void> {
    try {
        await context.service.checkConnection();
    } catch {
        // Ignore transient connection probe errors. The panel already renders the current status.
    }

    try {
        context.setRuntimeDiagnostics(await inspectOpenClawEnvironment(context.extensionPath));
    } catch {
        // Ignore diagnostics failures and keep the last known values.
    }

    try {
        context.setOpenClawConfigState(await loadOpenClawConfigEditorState(context.extensionPath));
    } catch {
        // Ignore config editor failures and keep the last known values.
    } finally {
        postRuntimeState(context);
    }
}

export async function handleRetryConnection(context: RuntimeActionContext): Promise<void> {
    try {
        await runWithNotificationProgress(t('progress.retryingConnection'), async () => {
            const nextConfig = await resolveOpenClawServiceConfig(context.extensionPath);
            context.service.updateConfig(nextConfig);
            await refreshRuntimeState(context);
            await Promise.all([
                context.loadAgents(),
                context.loadClusters(),
                context.loadTasks()
            ]);
        });
    } catch (error) {
        console.error('Failed to retry OpenClaw connection.', error);
        context.postMessage({
            type: 'error',
            message: t('service.connectFailed')
        });
    }
}

export async function handleSaveConnectionSettings(
    context: RuntimeActionContext,
    settings: {
        configMode?: 'auto' | 'gateway' | 'local' | 'openclaw';
        gatewayUrl?: string;
        gatewayToken?: string;
    }
): Promise<void> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const hasWorkspaceTarget = Boolean(vscode.workspace.workspaceFile) || (vscode.workspace.workspaceFolders?.length || 0) > 0;
    const target = hasWorkspaceTarget
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    try {
        await runWithNotificationProgress(t('progress.savingConnectionSettings'), async () => {
            await config.update('configMode', settings.configMode || 'openclaw', target);
            await config.update('gatewayUrl', settings.gatewayUrl?.trim() || '', target);
            await config.update('gatewayToken', settings.gatewayToken?.trim() || '', target);

            const nextConfig = await resolveOpenClawServiceConfig(context.extensionPath);
            context.service.updateConfig(nextConfig);
            await refreshRuntimeState(context);
            await Promise.all([
                context.loadAgents(),
                context.loadClusters(),
                context.loadTasks()
            ]);
        });

        context.postMessage({
            type: 'connectionSettingsSaved'
        });
    } catch (error) {
        console.error('Failed to save OpenClaw connection settings.', error);
        context.postMessage({
            type: 'connectionSettingsSaveFailed',
            message: t('service.connectFailed')
        });
    }
}

export async function handleSaveOpenClawConfig(
    context: RuntimeActionContext,
    settings: {
        gatewayPort?: number | string;
        gatewayToken?: string;
        defaultWorkspace?: string;
        defaultModel?: string;
        authProviderId?: string;
        authApiKey?: string;
    }
): Promise<void> {
    const gatewayPort = Number(settings.gatewayPort);
    if (!Number.isInteger(gatewayPort) || gatewayPort <= 0 || gatewayPort > 65535) {
        context.postMessage({
            type: 'openClawConfigSaveFailed',
            message: t('setup.openclawConfig.invalidPort')
        });
        return;
    }

    try {
        await runWithNotificationProgress(t('progress.savingConfig'), async () => {
            context.setOpenClawConfigState(await saveOpenClawConfigEditorState(context.extensionPath, {
                gatewayPort,
                gatewayToken: settings.gatewayToken,
                defaultWorkspace: settings.defaultWorkspace,
                defaultModel: settings.defaultModel,
                authProviderId: settings.authProviderId,
                authApiKey: settings.authApiKey
            }));

            const nextConfig = await resolveOpenClawServiceConfig(context.extensionPath);
            context.service.updateConfig(nextConfig);
            await refreshRuntimeState(context);
            await Promise.all([
                context.loadAgents(),
                context.loadClusters(),
                context.loadTasks()
            ]);
        });

        context.postMessage({
            type: 'openClawConfigSaved'
        });
    } catch (error) {
        console.error('Failed to save OpenClaw config.', error);
        context.postMessage({
            type: 'openClawConfigSaveFailed',
            message: t('setup.openclawConfig.statusSaveFailed')
        });
    }
}

export async function handleStartOpenClaw(context: RuntimeActionContext): Promise<void> {
    try {
        await runWithNotificationProgress(t('progress.startingOpenClaw'), async () => {
            await startOpenClawGateway(context.extensionPath);

            const nextConfig = await resolveOpenClawServiceConfig(context.extensionPath);
            context.service.updateConfig(nextConfig);
            await waitForServiceConnection(context.service);
            await refreshRuntimeState(context);
            await Promise.all([
                context.loadAgents(),
                context.loadClusters(),
                context.loadTasks()
            ]);
        });

        context.postMessage({
            type: 'openClawStartSucceeded'
        });
    } catch (error) {
        console.error('Failed to start OpenClaw gateway.', error);
        context.postMessage({
            type: 'openClawStartFailed',
            message: t('setup.startStatusFailed', { error: String(error) })
        });
    }
}
