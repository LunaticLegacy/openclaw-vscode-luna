import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
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

export interface OpenClawConfigEditorState {
    stateDir: string;
    configPath: string;
    exists: boolean;
    authProfilesPath: string;
    authProfilesExists: boolean;
    authProviderId: string;
    authApiKey: string;
    authProviders: string[];
    defaultModelSuggestionsByProvider: Record<string, string[]>;
    gatewayPort: number;
    gatewayToken: string;
    defaultWorkspace: string;
    defaultModel: string;
    sourceDescription: string;
}

export interface OpenClawConfigEditorUpdate {
    gatewayPort: number;
    gatewayToken?: string;
    defaultWorkspace?: string;
    defaultModel?: string;
    authProviderId?: string;
    authApiKey?: string;
}

export type ResolvedServiceConfig =
    | GatewayServiceConfig
    | OpenClawCliServiceConfig
    | LocalServiceConfig;

const DEFAULT_OPENCLAW_GATEWAY_PORT = 18789;
const execFileAsync = promisify(execFile);

// Based on OpenClaw's provider docs and model-provider catalog.
export const BUILTIN_OPENCLAW_AUTH_PROVIDER_IDS: readonly string[] = Object.freeze([
    'amazon-bedrock',
    'anthropic',
    'byteplus',
    'byteplus-plan',
    'cerebras',
    'cloudflare-ai-gateway',
    'gemini',
    'github-copilot',
    'google',
    'google-antigravity',
    'google-gemini-cli',
    'google-vertex',
    'groq',
    'huggingface',
    'kilocode',
    'kimi-coding',
    'litellm',
    'lmstudio',
    'minimax',
    'mistral',
    'moonshot',
    'nvidia',
    'ollama',
    'openai',
    'openai-codex',
    'opencode',
    'openrouter',
    'qianfan',
    'qwen-portal',
    'synthetic',
    'together',
    'venice',
    'vercel-ai-gateway',
    'vllm',
    'volcengine',
    'volcengine-plan',
    'xai',
    'xiaomi',
    'zai'
]);

export function getBuiltInOpenClawAuthProviderIds(): string[] {
    return [...BUILTIN_OPENCLAW_AUTH_PROVIDER_IDS];
}

function freezeStringList(values: string[]): readonly string[] {
    return Object.freeze(values);
}

const BUILTIN_OPENCLAW_DEFAULT_MODELS_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'amazon-bedrock': freezeStringList([
        'amazon-bedrock/us.anthropic.claude-opus-4-6-v1:0'
    ]),
    anthropic: freezeStringList([
        'anthropic/claude-opus-4-6',
        'anthropic/claude-sonnet-4-6',
        'anthropic/claude-haiku-4-5'
    ]),
    byteplus: freezeStringList([
        'byteplus/seed-1-8-251228',
        'byteplus/kimi-k2-5-260127',
        'byteplus/glm-4-7-251222'
    ]),
    'byteplus-plan': freezeStringList([
        'byteplus-plan/ark-code-latest',
        'byteplus-plan/doubao-seed-code',
        'byteplus-plan/kimi-k2.5',
        'byteplus-plan/kimi-k2-thinking',
        'byteplus-plan/glm-4.7'
    ]),
    cerebras: freezeStringList([
        'cerebras/zai-glm-4.7',
        'cerebras/zai-glm-4.6'
    ]),
    'cloudflare-ai-gateway': freezeStringList([
        'cloudflare-ai-gateway/claude-sonnet-4-5'
    ]),
    gemini: freezeStringList([
        'google/gemini-3.1-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite-preview'
    ]),
    'github-copilot': freezeStringList([
        'github-copilot/gpt-4o',
        'github-copilot/gpt-4.1'
    ]),
    google: freezeStringList([
        'google/gemini-3.1-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite-preview'
    ]),
    'google-antigravity': freezeStringList([
        'google-antigravity/claude-opus-4-6-thinking',
        'google-antigravity/gemini-3-flash'
    ]),
    'google-gemini-cli': freezeStringList([]),
    'google-vertex': freezeStringList([
        'google-vertex/gemini-3.1-pro-preview',
        'google-vertex/gemini-3-flash-preview'
    ]),
    groq: freezeStringList([]),
    huggingface: freezeStringList([
        'huggingface/deepseek-ai/DeepSeek-R1',
        'huggingface/deepseek-ai/DeepSeek-V3.2',
        'huggingface/Qwen/Qwen3-8B',
        'huggingface/meta-llama/Llama-3.3-70B-Instruct'
    ]),
    kilocode: freezeStringList([
        'kilocode/kilo/auto',
        'kilocode/anthropic/claude-sonnet-4',
        'kilocode/openai/gpt-5.2',
        'kilocode/google/gemini-3-pro-preview'
    ]),
    'kimi-coding': freezeStringList([
        'kimi-coding/k2p5'
    ]),
    litellm: freezeStringList([
        'litellm/claude-opus-4-6',
        'litellm/gpt-4o'
    ]),
    lmstudio: freezeStringList([
        'lmstudio/minimax-m2.5-gs32'
    ]),
    minimax: freezeStringList([
        'minimax/MiniMax-M2.5',
        'minimax/MiniMax-M2.5-highspeed'
    ]),
    mistral: freezeStringList([
        'mistral/mistral-large-latest'
    ]),
    moonshot: freezeStringList([
        'moonshot/kimi-k2.5',
        'moonshot/kimi-k2-0905-preview',
        'moonshot/kimi-k2-turbo-preview',
        'moonshot/kimi-k2-thinking',
        'moonshot/kimi-k2-thinking-turbo'
    ]),
    nvidia: freezeStringList([
        'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
        'nvidia/meta/llama-3.3-70b-instruct',
        'nvidia/nvidia/mistral-nemo-minitron-8b-8k-instruct'
    ]),
    ollama: freezeStringList([
        'ollama/gpt-oss:20b',
        'ollama/llama3.3',
        'ollama/qwen2.5-coder:32b',
        'ollama/deepseek-r1:32b'
    ]),
    opencode: freezeStringList([
        'opencode/claude-opus-4-6'
    ]),
    openai: freezeStringList([
        'openai/gpt-5.4',
        'openai/gpt-5.4-pro',
        'openai/gpt-5-mini'
    ]),
    'openai-codex': freezeStringList([
        'openai-codex/gpt-5.4'
    ]),
    openrouter: freezeStringList([
        'openrouter/anthropic/claude-sonnet-4-5',
        'openrouter/google/gemini-2.0-flash-vision:free',
        'openrouter/meta-llama/llama-3.3-70b-instruct:free'
    ]),
    qianfan: freezeStringList([]),
    'qwen-portal': freezeStringList([
        'qwen-portal/coder-model',
        'qwen-portal/vision-model'
    ]),
    synthetic: freezeStringList([
        'synthetic/hf:MiniMaxAI/MiniMax-M2.5'
    ]),
    together: freezeStringList([
        'together/moonshotai/Kimi-K2.5',
        'together/deepseek-ai/DeepSeek-V3.1'
    ]),
    venice: freezeStringList([
        'venice/kimi-k2-5',
        'venice/claude-opus-4-6',
        'venice/venice-uncensored',
        'venice/qwen3-vl-235b-a22b',
        'venice/qwen3-coder-480b-a35b-instruct'
    ]),
    'vercel-ai-gateway': freezeStringList([
        'vercel-ai-gateway/anthropic/claude-opus-4.6'
    ]),
    vllm: freezeStringList([]),
    volcengine: freezeStringList([
        'volcengine/doubao-seed-1-8-251228',
        'volcengine/doubao-seed-code-preview-251028',
        'volcengine/kimi-k2-5-260127',
        'volcengine/glm-4-7-251222',
        'volcengine/deepseek-v3-2-251201'
    ]),
    'volcengine-plan': freezeStringList([
        'volcengine-plan/ark-code-latest',
        'volcengine-plan/doubao-seed-code',
        'volcengine-plan/kimi-k2.5',
        'volcengine-plan/kimi-k2-thinking',
        'volcengine-plan/glm-4.7'
    ]),
    xai: freezeStringList([
        'xai/grok-4'
    ]),
    xiaomi: freezeStringList([
        'xiaomi/mimo-v2-flash'
    ]),
    zai: freezeStringList([
        'zai/glm-5',
        'zai/glm-4.7',
        'zai/glm-4.6'
    ])
});

export function getBuiltInOpenClawDefaultModelsByProvider(): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(BUILTIN_OPENCLAW_DEFAULT_MODELS_BY_PROVIDER)
            .map(([providerId, modelRefs]) => [providerId, [...modelRefs]])
    );
}

interface AuthProfilesFile {
    version?: number;
    profiles?: Record<string, {
        type?: string;
        provider?: string;
        key?: string;
    }>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, {
        errorCount?: number;
        lastFailureAt?: number;
        lastUsed?: number;
    }>;
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
    auth?: {
        profiles?: Record<string, {
            provider?: string;
            mode?: string;
        }>;
    };
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

type JsonRecord = Record<string, unknown>;

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
            if (explicitModeHints.openclaw && openClawCli) {
                return openClawCli;
            }
            if (explicitModeHints.local && localConfig) {
                return localConfig;
            }
            // In auto mode we prefer richer local runtimes when available.
            // Users who want to force the gateway can select `gateway` explicitly.
            if (openClawCli) {
                return openClawCli;
            }
            if (localConfig) {
                return localConfig;
            }
            if (explicitModeHints.gateway) {
                return gatewayConfig;
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
        true
        ,
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

export function mergeOpenClawConfigForSave(
    existing: JsonRecord | null,
    update: OpenClawConfigEditorUpdate
): JsonRecord {
    const nextConfig = cloneJsonRecord(existing);
    const gateway = ensureJsonRecord(nextConfig, 'gateway');
    const auth = ensureJsonRecord(gateway, 'auth');
    const agents = ensureJsonRecord(nextConfig, 'agents');
    const defaults = ensureJsonRecord(agents, 'defaults');
    const model = ensureJsonRecord(defaults, 'model');

    gateway.port = normalizeGatewayPort(update.gatewayPort);
    setOptionalString(auth, 'token', update.gatewayToken);
    setOptionalString(defaults, 'workspace', update.defaultWorkspace, { trimAsPath: true });
    setOptionalString(model, 'primary', update.defaultModel);
    applyOpenClawAuthProfileMetadata(nextConfig, update);

    pruneEmptyObject(gateway, 'auth');
    pruneEmptyObject(defaults, 'model');
    pruneEmptyObject(agents, 'defaults');
    pruneEmptyObject(nextConfig, 'agents');

    return nextConfig;
}

export function mergeOpenClawAuthProfilesForSave(
    existing: AuthProfilesFile | null,
    update: OpenClawConfigEditorUpdate
): AuthProfilesFile {
    const nextAuthProfiles = cloneAuthProfilesFile(existing);
    const providerId = normalizeAuthProviderId(update);

    if (!providerId) {
        return nextAuthProfiles;
    }

    const profileId = resolveAuthProfileId(nextAuthProfiles, providerId);
    const profiles = nextAuthProfiles.profiles || (nextAuthProfiles.profiles = {});
    const lastGood = nextAuthProfiles.lastGood || (nextAuthProfiles.lastGood = {});
    const normalizedApiKey = update.authApiKey?.trim() || '';

    if (normalizedApiKey) {
        profiles[profileId] = {
            ...profiles[profileId],
            type: 'api_key',
            provider: providerId,
            key: normalizedApiKey
        };
        lastGood[providerId] = profileId;
        nextAuthProfiles.version = nextAuthProfiles.version || 1;
        return nextAuthProfiles;
    }

    delete profiles[profileId];
    if (lastGood[providerId] === profileId) {
        const fallbackProfileId = Object.entries(profiles)
            .find(([, profile]) => profile?.provider?.trim() === providerId)?.[0];
        if (fallbackProfileId) {
            lastGood[providerId] = fallbackProfileId;
        } else {
            delete lastGood[providerId];
        }
    }

    pruneEmptyObject(nextAuthProfiles as JsonRecord, 'profiles');
    pruneEmptyObject(nextAuthProfiles as JsonRecord, 'lastGood');
    pruneEmptyObject(nextAuthProfiles as JsonRecord, 'usageStats');

    if (nextAuthProfiles.version !== undefined && !hasOpenClawAuthProfilesContent(nextAuthProfiles)) {
        delete nextAuthProfiles.version;
    }

    return nextAuthProfiles;
}

async function resolveGatewayConfig(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<GatewayServiceConfig> {
    const configuredGatewayUrl = toHttpGatewayUrl(trimConfigPath(config.get<string>('gatewayUrl', '')));
    const configuredGatewayToken = config.get<string>('gatewayToken', '').trim();
    const detectedGateway = await resolveDetectedGatewayConfig(config, extensionPath);
    const sourceDescription = joinSourceDescriptions(
        configuredGatewayUrl || configuredGatewayToken ? 'VS Code settings' : undefined,
        detectedGateway.sourceDescription
    ) || 'VS Code settings';

    return {
        mode: 'gateway',
        gatewayUrl: configuredGatewayUrl || toHttpGatewayUrl(detectedGateway.gatewayUrl) || 'http://127.0.0.1:18789',
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
    const gatewayPort = normalizeGatewayPort(openClawConfig.gateway?.port);
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
        ? `http://127.0.0.1:${normalizeGatewayPort(openClawConfig.gateway?.port)}`
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

async function resolveOpenClawConfigStateDir(
    config: vscode.WorkspaceConfiguration,
    extensionPath: string
): Promise<string> {
    const configuredStateDir = trimConfigPath(config.get<string>('stateDir', '') || process.env.OPENCLAW_STATE_DIR);
    if (configuredStateDir) {
        return configuredStateDir;
    }

    const detectedStateDir = await findFirstExistingPath(getStateDirCandidates(config, extensionPath));
    if (detectedStateDir) {
        return detectedStateDir;
    }

    return path.join(os.homedir(), '.openclaw');
}

function buildOpenClawConfigEditorState(
    stateDir: string,
    configPath: string,
    authProfilesPath: string,
    openClawConfig: OpenClawConfigFile | null,
    authProfiles: AuthProfilesFile | null,
    mainAgentModels: ModelsFile | null,
    exists: boolean,
    authProfilesExists: boolean
): OpenClawConfigEditorState {
    const defaultModel = openClawConfig?.agents?.defaults?.model?.primary?.trim() || '';
    const authProviders = collectOpenClawAuthProviders(authProfiles, mainAgentModels, defaultModel);
    const authProviderId = resolveInitialOpenClawAuthProviderId(authProfiles, mainAgentModels, defaultModel, authProviders);
    const defaultModelSuggestionsByProvider = collectOpenClawDefaultModelSuggestionsByProvider(mainAgentModels, defaultModel);

    return {
        stateDir,
        configPath,
        exists,
        authProfilesPath,
        authProfilesExists,
        authProviderId,
        authApiKey: resolveOpenClawAuthApiKey(authProfiles, mainAgentModels, authProviderId),
        authProviders,
        defaultModelSuggestionsByProvider,
        gatewayPort: normalizeGatewayPort(openClawConfig?.gateway?.port),
        gatewayToken: openClawConfig?.gateway?.auth?.token?.trim() || '',
        defaultWorkspace: trimConfigPath(openClawConfig?.agents?.defaults?.workspace) || '',
        defaultModel,
        sourceDescription: exists ? configPath : `Will create ${configPath}`
    };
}

function normalizeGatewayPort(value: number | undefined): number {
    if (Number.isInteger(value) && value! > 0 && value! <= 65535) {
        return value!;
    }

    return DEFAULT_OPENCLAW_GATEWAY_PORT;
}

function cloneJsonRecord(value: JsonRecord | null): JsonRecord {
    return JSON.parse(JSON.stringify(value || {})) as JsonRecord;
}

function cloneAuthProfilesFile(value: AuthProfilesFile | null): AuthProfilesFile {
    return JSON.parse(JSON.stringify(value || {})) as AuthProfilesFile;
}

function ensureJsonRecord(parent: JsonRecord, key: string): JsonRecord {
    const current = parent[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
        return current as JsonRecord;
    }

    const next: JsonRecord = {};
    parent[key] = next;
    return next;
}

function setOptionalString(
    parent: JsonRecord,
    key: string,
    value: string | undefined,
    options: { trimAsPath?: boolean } = {}
): void {
    const normalized = options.trimAsPath
        ? trimConfigPath(value)
        : value?.trim();

    if (normalized) {
        parent[key] = normalized;
        return;
    }

    delete parent[key];
}

function pruneEmptyObject(parent: JsonRecord, key: string): void {
    const current = parent[key];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return;
    }

    if (Object.keys(current as JsonRecord).length === 0) {
        delete parent[key];
    }
}

function getOpenClawMainAgentDir(stateDir: string): string {
    return path.join(stateDir, 'agents', 'main', 'agent');
}

function getOpenClawMainAuthProfilesPath(stateDir: string): string {
    return path.join(getOpenClawMainAgentDir(stateDir), 'auth-profiles.json');
}

function getOpenClawMainModelsPath(stateDir: string): string {
    return path.join(getOpenClawMainAgentDir(stateDir), 'models.json');
}

function applyOpenClawAuthProfileMetadata(
    nextConfig: JsonRecord,
    update: OpenClawConfigEditorUpdate
): void {
    const providerId = normalizeAuthProviderId(update);
    if (!providerId) {
        return;
    }

    const auth = ensureJsonRecord(nextConfig, 'auth');
    const profiles = ensureJsonRecord(auth, 'profiles');
    const profileId = `${providerId}:default`;
    const normalizedApiKey = update.authApiKey?.trim() || '';

    if (normalizedApiKey) {
        profiles[profileId] = {
            provider: providerId,
            mode: 'api_key'
        };
        return;
    }

    delete profiles[profileId];
    pruneEmptyObject(auth, 'profiles');
    pruneEmptyObject(nextConfig, 'auth');
}

function collectOpenClawAuthProviders(
    authProfiles: AuthProfilesFile | null,
    mainAgentModels: ModelsFile | null,
    defaultModel: string
): string[] {
    const providers = new Set<string>(BUILTIN_OPENCLAW_AUTH_PROVIDER_IDS);

    for (const providerId of Object.keys(mainAgentModels?.providers || {})) {
        const normalized = normalizeProviderId(providerId);
        if (normalized) {
            providers.add(normalized);
        }
    }

    for (const profile of Object.values(authProfiles?.profiles || {})) {
        const normalized = normalizeProviderId(profile?.provider);
        if (normalized) {
            providers.add(normalized);
        }
    }

    const defaultProviderId = inferProviderIdFromModel(defaultModel);
    if (defaultProviderId) {
        providers.add(defaultProviderId);
    }

    return Array.from(providers).sort((left, right) => left.localeCompare(right));
}

function collectOpenClawDefaultModelSuggestionsByProvider(
    mainAgentModels: ModelsFile | null,
    defaultModel: string
): Record<string, string[]> {
    const suggestionsByProvider = getBuiltInOpenClawDefaultModelsByProvider();

    for (const [providerId, providerConfig] of Object.entries(mainAgentModels?.providers || {})) {
        const normalizedProviderId = normalizeProviderId(providerId);
        if (!normalizedProviderId) {
            continue;
        }

        const dynamicModelRefs = (providerConfig.models || [])
            .map(modelConfig => buildQualifiedModelRef(normalizedProviderId, modelConfig?.id))
            .filter((modelRef): modelRef is string => Boolean(modelRef));

        suggestionsByProvider[normalizedProviderId] = dedupeStringList([
            ...(suggestionsByProvider[normalizedProviderId] || []),
            ...dynamicModelRefs
        ]);
    }

    const normalizedDefaultModel = defaultModel.trim();
    const defaultProviderId = inferProviderIdFromModel(normalizedDefaultModel);
    if (defaultProviderId && normalizedDefaultModel) {
        suggestionsByProvider[defaultProviderId] = dedupeStringList([
            ...(suggestionsByProvider[defaultProviderId] || []),
            normalizedDefaultModel
        ]);
    }

    return suggestionsByProvider;
}

function buildQualifiedModelRef(providerId: string, modelId: string | undefined): string | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedModelId = modelId?.trim();
    if (!normalizedProviderId || !normalizedModelId) {
        return undefined;
    }

    if (normalizedModelId.startsWith(`${normalizedProviderId}/`)) {
        return normalizedModelId;
    }

    return `${normalizedProviderId}/${normalizedModelId}`;
}

function dedupeStringList(values: string[]): string[] {
    const seen = new Set<string>();
    const uniqueValues: string[] = [];

    for (const value of values) {
        const normalizedValue = value.trim();
        if (!normalizedValue || seen.has(normalizedValue)) {
            continue;
        }

        seen.add(normalizedValue);
        uniqueValues.push(normalizedValue);
    }

    return uniqueValues;
}

function resolveInitialOpenClawAuthProviderId(
    authProfiles: AuthProfilesFile | null,
    mainAgentModels: ModelsFile | null,
    defaultModel: string,
    authProviders: string[]
): string {
    const defaultProviderId = inferProviderIdFromModel(defaultModel);
    if (defaultProviderId) {
        return defaultProviderId;
    }

    const lastGoodProviderId = Object.keys(authProfiles?.lastGood || {})
        .map(providerId => normalizeProviderId(providerId))
        .find((providerId): providerId is string => Boolean(providerId));
    if (lastGoodProviderId) {
        return lastGoodProviderId;
    }

    const authProfileProviderId = Object.values(authProfiles?.profiles || {})
        .map(profile => normalizeProviderId(profile?.provider))
        .find((providerId): providerId is string => Boolean(providerId));
    if (authProfileProviderId) {
        return authProfileProviderId;
    }

    const modelProviderId = Object.keys(mainAgentModels?.providers || {})
        .map(providerId => normalizeProviderId(providerId))
        .find((providerId): providerId is string => Boolean(providerId));
    if (modelProviderId) {
        return modelProviderId;
    }

    return '';
}

function resolveOpenClawAuthApiKey(
    authProfiles: AuthProfilesFile | null,
    mainAgentModels: ModelsFile | null,
    providerId: string
): string {
    const normalizedProviderId = normalizeProviderId(providerId);
    if (!normalizedProviderId) {
        return '';
    }

    const profileId = resolveAuthProfileId(authProfiles, normalizedProviderId);
    const authProfileKey = authProfiles?.profiles?.[profileId]?.key?.trim();
    if (authProfileKey) {
        return authProfileKey;
    }

    return mainAgentModels?.providers?.[normalizedProviderId]?.apiKey?.trim() || '';
}

function resolveAuthProfileId(
    authProfiles: AuthProfilesFile | null,
    providerId: string
): string {
    const normalizedProviderId = normalizeProviderId(providerId) || providerId.trim();
    const preferredProfileId = authProfiles?.lastGood?.[normalizedProviderId]?.trim();
    if (preferredProfileId) {
        return preferredProfileId;
    }

    const matchingProfileId = Object.entries(authProfiles?.profiles || {})
        .find(([, profile]) => profile?.provider?.trim() === normalizedProviderId)?.[0];
    if (matchingProfileId) {
        return matchingProfileId;
    }

    return `${normalizedProviderId}:default`;
}

function hasOpenClawAuthProfilesContent(authProfiles: AuthProfilesFile | null): boolean {
    return Boolean(
        authProfiles
        && (
            Object.keys(authProfiles.profiles || {}).length > 0
            || Object.keys(authProfiles.lastGood || {}).length > 0
            || Object.keys(authProfiles.usageStats || {}).length > 0
        )
    );
}

function normalizeAuthProviderId(update: OpenClawConfigEditorUpdate): string | undefined {
    const explicitProviderId = normalizeProviderId(update.authProviderId);
    if (explicitProviderId) {
        return explicitProviderId;
    }

    return inferProviderIdFromModel(update.defaultModel);
}

function inferProviderIdFromModel(model: string | undefined): string | undefined {
    const normalizedModel = model?.trim();
    if (!normalizedModel) {
        return undefined;
    }

    const slashIndex = normalizedModel.indexOf('/');
    if (slashIndex <= 0) {
        return undefined;
    }

    return normalizeProviderId(normalizedModel.slice(0, slashIndex));
}

function normalizeProviderId(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
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

function toHttpGatewayUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    if (trimmed.startsWith('ws://')) {
        return `http://${trimmed.slice('ws://'.length)}`;
    }

    if (trimmed.startsWith('wss://')) {
        return `https://${trimmed.slice('wss://'.length)}`;
    }

    return trimmed;
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
