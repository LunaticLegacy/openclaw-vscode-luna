import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import * as vscode from 'vscode';

import { getBuiltInOpenClawAuthProviderIds, getBuiltInOpenClawDefaultModelsByProvider } from './openclawConfig/builtins';
import {
    getStateDirCandidates,
    resolveCliEntryPath,
    resolveDetectedGatewayConfig,
    resolveNodePath,
    resolveOpenClawConfigStateDir
} from './openclawConfig/discovery';
import {
    buildOpenClawConfigEditorState,
    getOpenClawMainAuthProfilesPath,
    getOpenClawMainModelsPath,
    hasOpenClawAuthProfilesContent,
    mergeOpenClawAuthProfilesForSave,
    mergeOpenClawConfigForSave
} from './openclawConfig/editorState';
import { resolveOpenClawServiceConfigInternal } from './openclawConfig/serviceConfig';
import type {
    AuthProfilesFile,
    JsonRecord,
    ModelsFile,
    OpenClawConfigEditorState,
    OpenClawConfigEditorUpdate,
    OpenClawConfigFile,
    OpenClawRuntimeDiagnostics,
    ResolvedServiceConfig
} from './openclawConfig/types';
import {
    findFirstExistingPath,
    pathExists,
    readJsonFile,
    trimConfigPath
} from './openclawConfig/utils';

const execFileAsync = promisify(execFile);

export type {
    GatewayServiceConfig,
    JsonRecord,
    LocalModelConfig,
    LocalProviderConfig,
    LocalServiceConfig,
    OpenClawCliServiceConfig,
    OpenClawConfigEditorState,
    OpenClawConfigEditorUpdate,
    OpenClawRuntimeDiagnostics,
    ResolvedServiceConfig
} from './openclawConfig/types';
export {
    getBuiltInOpenClawAuthProviderIds,
    getBuiltInOpenClawDefaultModelsByProvider,
    hasOpenClawAuthProfilesContent,
    mergeOpenClawAuthProfilesForSave,
    mergeOpenClawConfigForSave
};

export async function resolveOpenClawServiceConfig(extensionPath: string): Promise<ResolvedServiceConfig> {
    return resolveOpenClawServiceConfigInternal(extensionPath);
}

export async function inspectOpenClawEnvironment(extensionPath: string): Promise<OpenClawRuntimeDiagnostics> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const configMode = config.get<'auto' | 'gateway' | 'local' | 'openclaw'>('configMode', 'auto');
    const configuredGatewayUrl = trimConfigPath(config.get<string>('gatewayUrl', '')) || '';
    const configuredGatewayToken = config.get<string>('gatewayToken', '').trim();
    const configuredStateDir = trimConfigPath(config.get<string>('stateDir', ''));
    const configuredCliPath = trimConfigPath(config.get<string>('cliPath', ''));
    const configuredNodePath = trimConfigPath(config.get<string>('nodePath', ''));

    const detectedStateDir = await findFirstExistingPath(getStateDirCandidates(config, extensionPath)) || undefined;
    const detectedConfigPath = detectedStateDir
        ? path.join(detectedStateDir, 'openclaw.json')
        : undefined;
    const cliEntryPath = await resolveCliEntryPath(config) || undefined;
    const nodePath = cliEntryPath ? resolveNodePath(config, cliEntryPath) || undefined : undefined;
    const detectedGateway = await resolveDetectedGatewayConfig(config, extensionPath);

    return {
        configMode,
        configuredGatewayUrl,
        configuredGatewayToken,
        configuredStateDir,
        configuredCliPath,
        configuredNodePath,
        detectedGatewayUrl: detectedGateway.gatewayUrl,
        detectedGatewayToken: detectedGateway.gatewayToken,
        detectedStateDir,
        detectedConfigPath,
        detectedCliEntryPath: cliEntryPath,
        detectedNodePath: nodePath,
        openClawInstalled: Boolean(cliEntryPath)
    };
}

export async function loadOpenClawConfigEditorState(extensionPath: string): Promise<OpenClawConfigEditorState> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const stateDir = await resolveOpenClawConfigStateDir(config, extensionPath);
    const configPath = path.join(stateDir, 'openclaw.json');
    const authProfilesPath = getOpenClawMainAuthProfilesPath(stateDir);
    const mainAgentModelsPath = getOpenClawMainModelsPath(stateDir);
    const openClawConfig = await readJsonFile<OpenClawConfigFile>(configPath);
    const authProfiles = await readJsonFile<AuthProfilesFile>(authProfilesPath);
    const mainAgentModels = await readJsonFile<ModelsFile>(mainAgentModelsPath);
    const exists = await pathExists(configPath);
    const authProfilesExists = await pathExists(authProfilesPath);

    return buildOpenClawConfigEditorState(
        stateDir,
        configPath,
        authProfilesPath,
        openClawConfig,
        authProfiles,
        mainAgentModels,
        exists,
        authProfilesExists
    );
}

export async function saveOpenClawConfigEditorState(
    extensionPath: string,
    update: OpenClawConfigEditorUpdate
): Promise<OpenClawConfigEditorState> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const stateDir = await resolveOpenClawConfigStateDir(config, extensionPath);
    const configPath = path.join(stateDir, 'openclaw.json');
    const authProfilesPath = getOpenClawMainAuthProfilesPath(stateDir);
    const mainAgentModelsPath = getOpenClawMainModelsPath(stateDir);
    const [existingConfig, existingAuthProfiles, mainAgentModels] = await Promise.all([
        readJsonFile<JsonRecord>(configPath),
        readJsonFile<AuthProfilesFile>(authProfilesPath),
        readJsonFile<ModelsFile>(mainAgentModelsPath)
    ]);
    const nextConfig = mergeOpenClawConfigForSave(existingConfig, update);
    const nextAuthProfiles = mergeOpenClawAuthProfilesForSave(existingAuthProfiles, update);
    const hasAuthProfiles = hasOpenClawAuthProfilesContent(nextAuthProfiles);

    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(authProfilesPath), { recursive: true });
    if (hasAuthProfiles) {
        await fs.writeFile(authProfilesPath, `${JSON.stringify(nextAuthProfiles, null, 2)}\n`, 'utf8');
    } else if (await pathExists(authProfilesPath)) {
        await fs.rm(authProfilesPath, { force: true });
    }

    return buildOpenClawConfigEditorState(
        stateDir,
        configPath,
        authProfilesPath,
        nextConfig as OpenClawConfigFile,
        hasAuthProfiles ? nextAuthProfiles : null,
        mainAgentModels,
        true,
        hasAuthProfiles
    );
}

export async function startOpenClawGateway(extensionPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const stateDir = await resolveOpenClawConfigStateDir(config, extensionPath);
    const configPath = path.join(stateDir, 'openclaw.json');
    const cliEntryPath = await resolveCliEntryPath(config);
    if (!cliEntryPath) {
        throw new Error('OpenClaw CLI was not detected.');
    }

    const nodePath = resolveNodePath(config, cliEntryPath);
    if (!nodePath) {
        throw new Error('Node.js executable for OpenClaw CLI was not detected.');
    }

    await execFileAsync(
        nodePath,
        [cliEntryPath, 'gateway', 'start', '--json'],
        {
            cwd: stateDir,
            env: {
                ...process.env,
                OPENCLAW_STATE_DIR: stateDir,
                OPENCLAW_CONFIG_PATH: configPath
            },
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
            windowsHide: true
        }
    );
}
