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

export interface AuthProfilesFile {
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

export interface ModelsFile {
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

export interface OpenClawConfigFile {
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

export type JsonRecord = Record<string, unknown>;
