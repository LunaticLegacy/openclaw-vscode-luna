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

export interface OpenClawRuntimeDiagnostics {
    configMode: 'auto' | 'gateway' | 'local' | 'openclaw';
    configuredGatewayUrl: string;
    configuredGatewayToken: string;
    configuredStateDir?: string;
    configuredCliPath?: string;
    configuredNodePath?: string;
    detectedGatewayUrl?: string;
    detectedGatewayToken?: string;
    detectedStateDir?: string;
    detectedConfigPath?: string;
    detectedCliEntryPath?: string;
    detectedNodePath?: string;
    openClawInstalled: boolean;
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
    const explicitModeHints = getExplicitModeHints(config);

    const openClawCli = await resolveOpenClawCliConfig(config, extensionPath);
    const localConfig = await resolveLocalConfig(config, extensionPath);
    const gatewayConfig = await resolveGatewayConfig(config, extensionPath);

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
            return gatewayConfig;
        case 'auto':
        default:
            if (explicitModeHints.gateway) {
                return gatewayConfig;
            }
            if (explicitModeHints.openclaw && openClawCli) {
                return openClawCli;
            }
            if (explicitModeHints.local && localConfig) {
                return localConfig;
            }
            if (openClawCli) {
                return openClawCli;
            }
            if (localConfig) {
                return localConfig;
            }
            break;
    }

    return gatewayConfig;
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

async function resolveGatewayConfig(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<GatewayServiceConfig> {
    const configuredGatewayUrl = trimConfigPath(config.get<string>('gatewayUrl', ''));
    const configuredGatewayToken = config.get<string>('gatewayToken', '').trim();
    const detectedGateway = await resolveDetectedGatewayConfig(config, extensionPath);
    const sourceDescription = joinSourceDescriptions(
        configuredGatewayUrl || configuredGatewayToken ? 'VS Code settings' : undefined,
        detectedGateway.sourceDescription
    ) || 'VS Code settings';

    return {
        mode: 'gateway',
        gatewayUrl: configuredGatewayUrl || detectedGateway.gatewayUrl || 'http://127.0.0.1:18789',
        gatewayToken: configuredGatewayToken || detectedGateway.gatewayToken || '',
        sourceDescription
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

async function resolveDetectedGatewayConfig(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<{
    gatewayUrl?: string;
    gatewayToken?: string;
    sourceDescription?: string;
}> {
    const envGatewayUrl = trimConfigPath(
        process.env.OPENCLAW_GATEWAY_URL
        || process.env.OPENCLAW_GATEWAY_HTTP_URL
    );
    const envGatewayToken = trimConfigPath(
        process.env.OPENCLAW_GATEWAY_TOKEN
        || process.env.OPENCLAW_GATEWAY_AUTH_TOKEN
    );

    const stateDir = await findFirstExistingPath(getStateDirCandidates(config, extensionPath));
    const configPath = stateDir ? path.join(stateDir, 'openclaw.json') : null;
    const openClawConfig = configPath ? await readJsonFile<OpenClawConfigFile>(configPath) : null;
    const detectedGatewayUrl = openClawConfig
        ? `http://127.0.0.1:${openClawConfig.gateway?.port ?? 18789}`
        : undefined;
    const detectedGatewayToken = trimConfigPath(openClawConfig?.gateway?.auth?.token);

    return {
        gatewayUrl: envGatewayUrl || detectedGatewayUrl,
        gatewayToken: envGatewayToken || detectedGatewayToken,
        sourceDescription: joinSourceDescriptions(
            envGatewayUrl || envGatewayToken ? 'Environment variables' : undefined,
            openClawConfig ? configPath || undefined : undefined
        )
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

    for (const envBase of getEnvironmentSearchBases()) {
        addBaseAndParents(bases, envBase, 1);
    }

    return Array.from(bases);
}

function getStateDirCandidates(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): string[] {
    const configuredPath = trimConfigPath(config.get<string>('stateDir', '') || process.env.OPENCLAW_STATE_DIR);
    const candidates = new Set<string>();

    if (configuredPath) {
        candidates.add(configuredPath);
    }

    candidates.add(path.join(os.homedir(), '.openclaw'));
    for (const candidate of getWellKnownStateDirCandidates()) {
        candidates.add(candidate);
    }

    for (const base of getSearchBases(extensionPath)) {
        candidates.add(path.join(base, '.openclaw'));
    }

    return Array.from(candidates);
}

async function resolveCliEntryPath(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const configuredPath = trimConfigPath(config.get<string>('cliPath', '') || process.env.OPENCLAW_CLI_PATH || process.env.OPENCLAW_CLI);
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

    for (const candidate of getWellKnownCliCandidates()) {
        candidates.add(candidate);
    }

    return Array.from(candidates);
}

function normalizeCliEntryPath(candidatePath: string): string | null {
    const resolvedPath = path.resolve(candidatePath);
    if (!fsSync.existsSync(resolvedPath)) {
        return null;
    }

    const stat = fsSync.statSync(resolvedPath);
    if (stat.isDirectory()) {
        for (const candidate of getCliEntryCandidatesFromInstallRoot(resolvedPath)) {
            if (fsSync.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.mjs' || ext === '.js' || ext === '.cjs') {
        return resolvedPath;
    }

    const shimEntryPath = extractCliEntryFromShim(resolvedPath);
    if (shimEntryPath) {
        return shimEntryPath;
    }

    for (const candidate of getCliEntryCandidatesFromInstallRoot(path.dirname(resolvedPath))) {
        if (fsSync.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveNodePath(
    config: vscode.WorkspaceConfiguration,
    cliEntryPath: string
): string | null {
    const configuredPath = trimConfigPath(config.get<string>('nodePath', '') || process.env.OPENCLAW_NODE_PATH);
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

function getExplicitModeHints(config: vscode.WorkspaceConfiguration): {
    gateway: boolean;
    local: boolean;
    openclaw: boolean;
} {
    return {
        gateway: hasExplicitSetting(config, 'gatewayUrl') || hasExplicitSetting(config, 'gatewayToken'),
        local: hasExplicitSetting(config, 'authProfilesPath') || hasExplicitSetting(config, 'modelsPath'),
        openclaw: hasExplicitSetting(config, 'stateDir')
            || hasExplicitSetting(config, 'cliPath')
            || hasExplicitSetting(config, 'nodePath')
    };
}

function hasExplicitSetting(config: vscode.WorkspaceConfiguration, key: string): boolean {
    const inspection = config.inspect(key) as Record<string, unknown> | undefined;
    if (!inspection) {
        return false;
    }

    for (const field of [
        'globalValue',
        'workspaceValue',
        'workspaceFolderValue',
        'globalLanguageValue',
        'workspaceLanguageValue',
        'workspaceFolderLanguageValue'
    ]) {
        if (inspection[field] !== undefined) {
            return true;
        }
    }

    return false;
}

function joinSourceDescriptions(...values: Array<string | undefined>): string {
    return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
        .join(', ');
}

function getEnvironmentSearchBases(): string[] {
    const bases = new Set<string>();

    for (const value of [
        process.env.APPDATA,
        process.env.LOCALAPPDATA,
        process.env.XDG_CONFIG_HOME,
        process.env.XDG_DATA_HOME,
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.ProgramData
    ]) {
        const trimmed = trimConfigPath(value);
        if (trimmed) {
            bases.add(trimmed);
        }
    }

    return Array.from(bases);
}

function getWellKnownStateDirCandidates(): string[] {
    const candidates = new Set<string>();

    for (const value of [
        process.env.OPENCLAW_STATE_DIR,
        process.env.OPENCLAW_HOME
    ]) {
        const trimmed = trimConfigPath(value);
        if (trimmed) {
            candidates.add(trimmed);
        }
    }

    for (const base of getEnvironmentSearchBases()) {
        candidates.add(path.join(base, 'OpenClaw'));
        candidates.add(path.join(base, 'openclaw'));
        candidates.add(path.join(base, '.openclaw'));
    }

    candidates.add(path.join(os.homedir(), '.config', 'openclaw'));
    candidates.add(path.join(os.homedir(), '.local', 'share', 'openclaw'));

    return Array.from(candidates);
}

function getWellKnownCliCandidates(): string[] {
    const candidates = new Set<string>();
    const homeDir = os.homedir();

    for (const value of [
        process.env.OPENCLAW_CLI,
        process.env.OPENCLAW_CLI_PATH
    ]) {
        const trimmed = trimConfigPath(value);
        if (trimmed) {
            candidates.add(trimmed);
        }
    }

    for (const executable of ['openclaw.cmd', 'openclaw.exe', 'openclaw']) {
        for (const base of [
            process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : undefined,
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : undefined,
            process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs') : undefined,
            process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs') : undefined,
            path.join(homeDir, '.volta', 'bin'),
            path.join(homeDir, '.bun', 'bin')
        ]) {
            const trimmedBase = trimConfigPath(base);
            if (trimmedBase) {
                candidates.add(path.join(trimmedBase, executable));
            }
        }
    }

    return Array.from(candidates);
}

function getCliEntryCandidatesFromInstallRoot(installRoot: string): string[] {
    return [
        path.join(installRoot, 'node_modules', 'openclaw', 'openclaw.mjs'),
        path.join(installRoot, 'node_modules', 'openclaw', 'openclaw.js'),
        path.join(installRoot, 'node_modules', 'openclaw', 'openclaw.cjs'),
        path.join(installRoot, 'node_modules', 'openclaw', 'dist', 'cli.mjs'),
        path.join(installRoot, 'node_modules', 'openclaw', 'dist', 'cli.js'),
        path.join(installRoot, '..', 'lib', 'node_modules', 'openclaw', 'openclaw.mjs'),
        path.join(installRoot, '..', 'lib', 'node_modules', 'openclaw', 'openclaw.js'),
        path.join(installRoot, '..', 'lib', 'node_modules', 'openclaw', 'openclaw.cjs'),
        path.join(installRoot, '..', 'lib', 'node_modules', 'openclaw', 'dist', 'cli.mjs'),
        path.join(installRoot, '..', 'lib', 'node_modules', 'openclaw', 'dist', 'cli.js')
    ];
}

function extractCliEntryFromShim(shimPath: string): string | null {
    try {
        const content = fsSync.readFileSync(shimPath, 'utf8');
        const matches = content.matchAll(/((?:%~?dp0%?|(?:\$|\$\{)basedir\}?|__dirname)?[^"'`\r\n]*node_modules[\\/]+openclaw[\\/]+(?:openclaw|dist[\\/]+cli)\.(?:mjs|js|cjs))/gi);

        for (const match of matches) {
            const target = resolveShimTargetPath(shimPath, match[1]);
            if (target && fsSync.existsSync(target)) {
                return target;
            }
        }
    } catch {
        return null;
    }

    return null;
}

function resolveShimTargetPath(shimPath: string, rawTarget: string): string | null {
    const normalizedTarget = rawTarget
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/^%~?dp0%?[\\/]/i, '')
        .replace(/^(?:\$|\$\{)basedir\}?[/\\]/i, '')
        .replace(/^__dirname[/\\]/i, '');

    if (!normalizedTarget) {
        return null;
    }

    if (path.isAbsolute(normalizedTarget)) {
        return normalizedTarget;
    }

    return path.resolve(path.dirname(shimPath), normalizedTarget);
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
