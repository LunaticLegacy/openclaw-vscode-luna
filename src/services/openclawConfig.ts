import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface LocalModelConfig {
    id: string;
    name: string;
}

export interface LocalProviderConfig {
    id: string;
    baseUrl: string;
    api: string;
    apiKey: string;
    models: LocalModelConfig[];
}

export interface GatewayServiceConfig {
    mode: 'gateway';
    gatewayUrl: string;
    gatewayToken: string;
    sourceDescription: string;
}

export interface OpenClawCliServiceConfig {
    mode: 'openclaw';
    cliEntryPath: string;
    nodePath: string;
    stateDir: string;
    configPath: string;
    gatewayUrl?: string;
    gatewayToken?: string;
    defaultWorkspacePath?: string;
    defaultModel?: string;
    sourceDescription: string;
}

export interface LocalServiceConfig {
    mode: 'local';
    providers: LocalProviderConfig[];
    sourceDescription: string;
}

export type ResolvedServiceConfig =
    | GatewayServiceConfig
    | OpenClawCliServiceConfig
    | LocalServiceConfig;

interface AuthProfilesFile {
    profiles?: Record<string, {
        provider?: string;
        key?: string;
    }>;
    lastGood?: Record<string, string>;
}

interface ModelsFile {
    providers?: Record<string, {
        baseUrl?: string;
        api?: string;
        apiKey?: string;
        models?: Array<{
            id?: string;
            name?: string;
        }>;
    }>;
}

interface OpenClawConfigFile {
    gateway?: {
        port?: number;
        auth?: {
            token?: string;
        };
    };
    agents?: {
        defaults?: {
            workspace?: string;
            model?: {
                primary?: string;
            };
        };
    };
}

export async function resolveOpenClawServiceConfig(extensionPath: string): Promise<ResolvedServiceConfig> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const configMode = config.get<'auto' | 'gateway' | 'local' | 'openclaw'>('configMode', 'auto');

    const openClawCli = await resolveOpenClawCliConfig(config, extensionPath);
    const localConfig = await resolveLocalConfig(config, extensionPath);

    switch (configMode) {
        case 'openclaw':
            if (openClawCli) {
                return openClawCli;
            }
            break;
        case 'local':
            if (localConfig) {
                return localConfig;
            }
            break;
        case 'gateway':
            return resolveGatewayConfig(config);
        case 'auto':
        default:
            if (openClawCli) {
                return openClawCli;
            }
            if (localConfig) {
                return localConfig;
            }
            break;
    }

    return resolveGatewayConfig(config);
}

function resolveGatewayConfig(config: vscode.WorkspaceConfiguration): GatewayServiceConfig {
    return {
        mode: 'gateway',
        gatewayUrl: config.get<string>('gatewayUrl', 'http://localhost:3344'),
        gatewayToken: config.get<string>('gatewayToken', ''),
        sourceDescription: 'VS Code settings'
    };
}

async function resolveLocalConfig(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<LocalServiceConfig | null> {
    const authProfilesPath = await findFirstExistingPath(getAuthProfileCandidates(config, extensionPath));
    const modelsPath = await findFirstExistingPath(getModelsCandidates(config, extensionPath));

    const authProfiles = authProfilesPath ? await readJsonFile<AuthProfilesFile>(authProfilesPath) : null;
    const models = modelsPath ? await readJsonFile<ModelsFile>(modelsPath) : null;
    const providers = buildLocalProviders(authProfiles, models);

    if (providers.length === 0) {
        return null;
    }

    const sources = [authProfilesPath, modelsPath].filter((item): item is string => Boolean(item));
    return {
        mode: 'local',
        providers,
        sourceDescription: sources.join(', ')
    };
}

async function resolveOpenClawCliConfig(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<OpenClawCliServiceConfig | null> {
    const stateDir = await findFirstExistingPath(getStateDirCandidates(config, extensionPath));
    if (!stateDir) {
        return null;
    }

    const configPath = path.join(stateDir, 'openclaw.json');
    const openClawConfig = await readJsonFile<OpenClawConfigFile>(configPath);
    if (!openClawConfig) {
        return null;
    }

    const cliEntryPath = await resolveCliEntryPath(config);
    if (!cliEntryPath) {
        return null;
    }

    const nodePath = resolveNodePath(config, cliEntryPath);
    if (!nodePath) {
        return null;
    }

    const configuredGatewayUrl = trimConfigPath(config.get<string>('gatewayUrl', ''));
    const configuredGatewayToken = config.get<string>('gatewayToken', '').trim();
    const gatewayPort = openClawConfig.gateway?.port ?? 18789;
    const gatewayToken = configuredGatewayToken || openClawConfig.gateway?.auth?.token?.trim();

    return {
        mode: 'openclaw',
        cliEntryPath,
        nodePath,
        stateDir,
        configPath,
        gatewayUrl: configuredGatewayUrl || `ws://127.0.0.1:${gatewayPort}`,
        gatewayToken,
        defaultWorkspacePath: trimConfigPath(openClawConfig.agents?.defaults?.workspace),
        defaultModel: openClawConfig.agents?.defaults?.model?.primary?.trim(),
        sourceDescription: `${configPath}, ${cliEntryPath}`
    };
}

function buildLocalProviders(
    authProfiles: AuthProfilesFile | null,
    models: ModelsFile | null
): LocalProviderConfig[] {
    const providers: LocalProviderConfig[] = [];

    for (const [providerId, providerConfig] of Object.entries(models?.providers ?? {})) {
        const baseUrl = providerConfig.baseUrl?.trim();
        const apiKey = resolveProviderApiKey(providerId, authProfiles, providerConfig.apiKey);
        const modelsForProvider = (providerConfig.models ?? [])
            .filter(model => model.id)
            .map(model => ({
                id: model.id!,
                name: model.name?.trim() || model.id!
            }));

        if (!baseUrl || !apiKey || modelsForProvider.length === 0) {
            continue;
        }

        providers.push({
            id: providerId,
            baseUrl,
            api: providerConfig.api?.trim() || 'openai-completions',
            apiKey,
            models: modelsForProvider
        });
    }

    return providers;
}

function resolveProviderApiKey(
    providerId: string,
    authProfiles: AuthProfilesFile | null,
    fallbackApiKey?: string
): string {
    const profiles = authProfiles?.profiles ?? {};
    const preferredProfileId = authProfiles?.lastGood?.[providerId];

    if (preferredProfileId && profiles[preferredProfileId]?.key) {
        return profiles[preferredProfileId].key!;
    }

    for (const profile of Object.values(profiles)) {
        if (profile.provider === providerId && profile.key) {
            return profile.key;
        }
    }

    return fallbackApiKey?.trim() || '';
}

function getAuthProfileCandidates(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): string[] {
    const configuredPath = config.get<string>('authProfilesPath', '').trim();
    const candidates = new Set<string>();

    if (configuredPath) {
        candidates.add(configuredPath);
    }

    for (const base of getSearchBases(extensionPath)) {
        candidates.add(path.join(base, 'auth-profiles.json'));
        candidates.add(path.join(base, '.openclaw', 'auth-profiles.json'));
    }

    return Array.from(candidates);
}

function getModelsCandidates(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): string[] {
    const configuredPath = config.get<string>('modelsPath', '').trim();
    const candidates = new Set<string>();

    if (configuredPath) {
        candidates.add(configuredPath);
    }

    for (const base of getSearchBases(extensionPath)) {
        candidates.add(path.join(base, 'models.json'));
        candidates.add(path.join(base, '.openclaw', 'models.json'));
    }

    return Array.from(candidates);
}

function getSearchBases(extensionPath: string): string[] {
    const bases = new Set<string>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        addBaseAndParents(bases, folder.uri.fsPath, 2);
    }

    addBaseAndParents(bases, extensionPath, 3);
    addBaseAndParents(bases, os.homedir(), 1);
    addBaseAndParents(bases, path.join(os.homedir(), '.openclaw'), 0);

    return Array.from(bases);
}

function getStateDirCandidates(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): string[] {
    const configuredPath = trimConfigPath(config.get<string>('stateDir', ''));
    const candidates = new Set<string>();

    if (configuredPath) {
        candidates.add(configuredPath);
    }

    candidates.add(path.join(os.homedir(), '.openclaw'));

    for (const base of getSearchBases(extensionPath)) {
        candidates.add(path.join(base, '.openclaw'));
    }

    return Array.from(candidates);
}

async function resolveCliEntryPath(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const configuredPath = trimConfigPath(config.get<string>('cliPath', ''));
    if (configuredPath) {
        return normalizeCliEntryPath(configuredPath);
    }

    for (const candidate of getCliCandidates()) {
        const normalized = normalizeCliEntryPath(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return null;
}

function getCliCandidates(): string[] {
    const candidates = new Set<string>();
    const pathEnv = process.env.PATH || '';
    const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);

    for (const entry of pathEntries) {
        for (const executable of ['openclaw.cmd', 'openclaw.exe', 'openclaw']) {
            candidates.add(path.join(entry, executable));
        }
    }

    return Array.from(candidates);
}

function normalizeCliEntryPath(candidatePath: string): string | null {
    const resolvedPath = path.resolve(candidatePath);
    if (!fsSync.existsSync(resolvedPath)) {
        return null;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.mjs' || ext === '.js') {
        return resolvedPath;
    }

    const installDir = path.dirname(resolvedPath);
    const cliEntryPath = path.join(installDir, 'node_modules', 'openclaw', 'openclaw.mjs');
    return fsSync.existsSync(cliEntryPath) ? cliEntryPath : null;
}

function resolveNodePath(
    config: vscode.WorkspaceConfiguration,
    cliEntryPath: string
): string | null {
    const configuredPath = trimConfigPath(config.get<string>('nodePath', ''));
    if (configuredPath && fsSync.existsSync(configuredPath)) {
        return configuredPath;
    }

    const installDir = path.dirname(path.dirname(path.dirname(cliEntryPath)));
    const bundledNode = path.join(installDir, 'node.exe');
    if (fsSync.existsSync(bundledNode)) {
        return bundledNode;
    }

    const pathEnv = process.env.PATH || '';
    for (const entry of pathEnv.split(path.delimiter).filter(Boolean)) {
        for (const executable of ['node.exe', 'node']) {
            const candidate = path.join(entry, executable);
            if (fsSync.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

function trimConfigPath(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function addBaseAndParents(target: Set<string>, initialPath: string, maxDepth: number) {
    let current = path.resolve(initialPath);

    for (let depth = 0; depth <= maxDepth; depth += 1) {
        target.add(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
}

async function findFirstExistingPath(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function readJsonFile<T>(targetPath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(targetPath, 'utf8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}
