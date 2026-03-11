import * as path from 'path';

import { getBuiltInOpenClawAuthProviderIds, getBuiltInOpenClawDefaultModelsByProvider } from './builtins';
import type {
    AuthProfilesFile,
    JsonRecord,
    ModelsFile,
    OpenClawConfigEditorState,
    OpenClawConfigEditorUpdate,
    OpenClawConfigFile
} from './types';
import {
    cloneJsonRecord,
    ensureJsonRecord,
    normalizeGatewayPort,
    pruneEmptyObject,
    setOptionalString,
    trimConfigPath
} from './utils';

export function buildOpenClawConfigEditorState(
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
    const authProviderId = resolveInitialOpenClawAuthProviderId(authProfiles, mainAgentModels, defaultModel);
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

export function hasOpenClawAuthProfilesContent(authProfiles: AuthProfilesFile | null): boolean {
    return Boolean(
        authProfiles
        && (
            Object.keys(authProfiles.profiles || {}).length > 0
            || Object.keys(authProfiles.lastGood || {}).length > 0
            || Object.keys(authProfiles.usageStats || {}).length > 0
        )
    );
}

export function getOpenClawMainAuthProfilesPath(stateDir: string): string {
    return path.join(getOpenClawMainAgentDir(stateDir), 'auth-profiles.json');
}

export function getOpenClawMainModelsPath(stateDir: string): string {
    return path.join(getOpenClawMainAgentDir(stateDir), 'models.json');
}

function cloneAuthProfilesFile(value: AuthProfilesFile | null): AuthProfilesFile {
    return JSON.parse(JSON.stringify(value || {})) as AuthProfilesFile;
}

function getOpenClawMainAgentDir(stateDir: string): string {
    return path.join(stateDir, 'agents', 'main', 'agent');
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
    const providers = new Set<string>(getBuiltInOpenClawAuthProviderIds());

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
    defaultModel: string
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
