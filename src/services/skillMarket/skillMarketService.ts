// Skill Market - Service
import * as vscode from 'vscode';
import axios, { type AxiosRequestConfig } from 'axios';
import { EventEmitter } from 'events';
import {
    SkillDefinition,
    SkillSearchFilters,
    SkillInstallResult,
    SkillInstallProgress,
    SkillMarketOverview,
    SkillHubDefinition,
    SkillHubStatus,
    SkillCategory,
    SkillSourceKind
} from './types';
import type { SkillInstallOptions } from '../../types/serviceParams';
import { LocalSkillRegistry } from './localSkillRegistry';

const REQUEST_TIMEOUT = 10000;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DEFAULT_HUBS: SkillHubDefinition[] = [
    {
        id: 'skillsllm',
        name: 'SkillsLLM',
        url: 'https://skillsllm.com',
        apiUrl: 'https://skillsllm.com/api'
    },
    {
        id: 'skillhub',
        name: 'Tencent SkillHub',
        url: 'https://skillhub.tencent.com',
        apiUrl: 'https://lightmake.site/api'
    }
];

type HubProviderKind = 'skillsllm' | 'tencent-skillhub' | 'generic';

class RemoteSkillHubProvider {
    private providerKind: HubProviderKind;

    constructor(private hub: SkillHubDefinition) {
        this.providerKind = resolveProviderKind(hub);
    }

    public getHub(): SkillHubDefinition {
        return this.hub;
    }

    public async fetchSkills(filters: SkillSearchFilters): Promise<SkillDefinition[]> {
        const { requestUrl, params } = this.buildFetchRequest(filters || {});

        const response = await axios.get<any>(
            requestUrl,
            withProxyConfig({ params }, requestUrl)
        );

        const rawSkills = this.extractRawSkills(response.data);

        return rawSkills
            .map((skill: any) => this.normalizeRemoteSkill(skill))
            .filter((skill: any): skill is SkillDefinition => Boolean(skill));
    }

    public async fetchSkillDetails(skillId: string): Promise<SkillDefinition | undefined> {
        if (!skillId) {
            return undefined;
        }

        if (this.providerKind === 'skillsllm' || this.providerKind === 'tencent-skillhub') {
            const fallback = await this.fetchSkills({ query: skillId });
            return fallback.find((skill: any) => skill.id === skillId) || undefined;
        }

        const requestUrl = `${this.hub.apiUrl}/skills/${skillId}`;
        const response = await axios.get<any>(requestUrl, withProxyConfig({}, requestUrl));
        return this.normalizeRemoteSkill(response.data);
    }

    public normalizeRemoteSkill(raw: any): SkillDefinition | undefined {
        if (!this.providerKind) {
            this.providerKind = resolveProviderKind(this.hub);
        }

        if (this.providerKind === 'skillsllm') {
            return normalizeSkillsLLMSkill(raw, this.hub);
        }

        if (this.providerKind === 'tencent-skillhub') {
            return normalizeTencentSkill(raw, this.hub);
        }

        if (!raw) {
            return undefined;
        }

        const id = String(raw.id || raw.slug || '').trim();
        if (!id) {
            return undefined;
        }

        const label = String(raw.label || raw.name || raw.title || id).trim();
        const description = String(raw.description || raw.summary || '').trim();
        const prompt = String(raw.prompt || raw.systemPrompt || raw.instructions || '').trim();
        const category = normalizeCategory(raw.category || raw.type || 'other');
        const tags = normalizeTags(raw.tags || raw.keywords || []);
        const version = String(raw.version || raw.release || '1.0.0');
        const downloads = Number(raw.downloads || raw.installs || raw.downloadCount || 0);
        const rating = typeof raw.rating === 'number' ? raw.rating : undefined;
        const createdAt = String(raw.createdAt || raw.created || raw.publishedAt || raw.updatedAt || new Date().toISOString());
        const updatedAt = String(raw.updatedAt || raw.modifiedAt || raw.updated || createdAt);
        const downloadUrl = String(raw.downloadUrl || raw.download || raw.packageUrl || raw.url || '').trim();

        const authorRaw = raw.author || raw.publisher;
        const author = authorRaw
            ? {
                name: String(authorRaw.name || authorRaw).trim(),
                url: authorRaw.url,
                avatar: authorRaw.avatar
            }
            : undefined;

        return {
            id,
            label,
            description,
            prompt,
            category,
            tags,
            source: 'marketplace',
            sourceKind: 'remote',
            hubId: this.hub.id,
            hubName: this.hub.name,
            hubUrl: this.hub.url,
            author,
            version,
            downloads,
            rating,
            createdAt,
            updatedAt,
            downloadUrl,
            homepage: raw.homepage || raw.website,
            readme: raw.readme,
            examples: Array.isArray(raw.examples) ? raw.examples : undefined
        };
    }

    private buildFetchRequest(filters: SkillSearchFilters): { requestUrl: string; params: Record<string, string | number | undefined> } {
        if (!this.providerKind) {
            this.providerKind = resolveProviderKind(this.hub);
        }

        const requestUrl = `${this.hub.apiUrl}/skills`;

        if (this.providerKind === 'skillsllm') {
            return {
                requestUrl,
                params: {
                    q: filters.query || undefined,
                    page: 1,
                    limit: 100
                }
            };
        }

        if (this.providerKind === 'tencent-skillhub') {
            const sort = mapTencentSort(filters.sortBy);
            return {
                requestUrl,
                params: {
                    keyword: filters.query || undefined,
                    page: 1,
                    pageSize: 100,
                    sortBy: sort?.field,
                    order: sort?.order
                }
            };
        }

        const category = filters.category;
        return {
            requestUrl,
            params: {
                q: filters.query || undefined,
                category: category && String(category) !== 'all' ? category : undefined,
                tags: filters.tags?.length ? filters.tags.join(',') : undefined,
                sort: filters.sortBy && filters.sortBy !== 'installed' ? filters.sortBy : undefined,
                page: 1,
                limit: 100
            }
        };
    }

    private extractRawSkills(payload: any): any[] {
        if (!this.providerKind) {
            this.providerKind = resolveProviderKind(this.hub);
        }

        if (this.providerKind === 'skillsllm') {
            if (payload && Array.isArray(payload.skills)) {
                return payload.skills;
            }
            return [];
        }

        if (this.providerKind === 'tencent-skillhub') {
            if (payload && payload.code !== 0) {
                const message = payload.message ? String(payload.message) : 'Skill hub returned an error';
                throw new Error(message);
            }
            if (payload && payload.data && Array.isArray(payload.data.skills)) {
                return payload.data.skills;
            }
            return [];
        }

        if (!payload) {
            return [];
        }
        if (Array.isArray(payload.skills)) return payload.skills;
        if (Array.isArray(payload.items)) return payload.items;
        if (Array.isArray(payload.data)) return payload.data;
        return [];
    }
}

export class SkillMarketService extends EventEmitter {
    private registry: LocalSkillRegistry;
    private hubProviders: RemoteSkillHubProvider[] = [];
    private cache: Map<string, SkillMarketOverview> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private marketIndex: Map<string, SkillDefinition> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        super();
        this.registry = new LocalSkillRegistry(context);
        this.hubProviders = this.loadHubDefinitions().map((def: any) => new RemoteSkillHubProvider(def));
    }

    public async searchSkills(filters: SkillSearchFilters): Promise<SkillMarketOverview> {
        const cacheKey = JSON.stringify(filters || {});
        if (this.isCacheValid(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        const hubProviders = this.getHubProviders(filters?.hubId);
        const hubStatuses: SkillHubStatus[] = [];
        const errors: string[] = [];

        const hubResults = await Promise.allSettled(
            hubProviders.map((provider: any) => provider.fetchSkills(filters || {}))
        );

        let marketSkills: SkillDefinition[] = [];
        hubResults.forEach((result: any, index: any) => {
            const provider = hubProviders[index];
            const hub = provider.getHub();
            if (result.status === 'fulfilled') {
                hubStatuses.push({
                    id: hub.id,
                    name: hub.name,
                    url: hub.url,
                    apiUrl: hub.apiUrl,
                    status: 'ok'
                });
                marketSkills = marketSkills.concat(result.value);
            } else {
                const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason || 'Unknown error');
                hubStatuses.push({
                    id: hub.id,
                    name: hub.name,
                    url: hub.url,
                    apiUrl: hub.apiUrl,
                    status: 'error',
                    error: errorMessage
                });
                errors.push(`Failed to load ${hub.name}.`);
            }
        });

        const installedSkills = await this.getInstalledSkillInventory();
        const installedIndex = new Map(installedSkills.map((skill: any) => [this.getSkillKey(skill), skill]));
        const installedById = new Map(installedSkills.map((skill: any) => [skill.id, skill]));

        marketSkills = marketSkills.map((skill: any) => {
            const match = installedIndex.get(this.getSkillKey(skill)) || installedById.get(skill.id);
            const updateAvailable = match ? isVersionNewer(skill.version, match.version) : false;
            return {
                ...skill,
                isInstalled: Boolean(match),
                installedAt: match?.installedAt,
                installedVersion: match?.version,
                updateAvailable
            };
        });

        // Deduplicate by hub+id to avoid duplicates per hub
        const seen = new Set<string>();
        const dedupedMarket = marketSkills.filter((skill: any) => {
            const key = `${skill.hubId || 'hub'}:${skill.id}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });

        dedupedMarket.forEach((skill: any) => {
            this.marketIndex.set(this.getSkillKey(skill), skill);
        });

        const categories = buildCategoryCounts(dedupedMarket);
        const tags = buildTagCounts(dedupedMarket);

        const overview: SkillMarketOverview = {
            market: dedupedMarket,
            installed: installedSkills,
            total: dedupedMarket.length,
            categories,
            tags,
            hubs: hubStatuses,
            errors
        };

        this.setCache(cacheKey, overview);
        return overview;
    }

    public async getSkillDetails(skillId: string, hubId?: string): Promise<SkillDefinition | undefined> {
        if (!skillId) {
            return undefined;
        }

        const cached = this.marketIndex.get(this.getSkillKeyForLookup(skillId, hubId || undefined));
        if (cached) {
            return cached;
        }

        const installed = await this.getInstalledSkillInventory();
        const localMatch = installed.find((skill: any) => skill.id === skillId);
        if (localMatch && !hubId) {
            return localMatch;
        }

        const providers = this.getHubProviders(hubId || undefined);
        for (const provider of providers) {
            try {
                const detail = await provider.fetchSkillDetails(skillId);
                if (detail) {
                    return detail;
                }
            } catch {
                // ignore and continue
            }
        }
        return localMatch || undefined;
    }

    public async installSkill(skill: SkillDefinition, options?: SkillInstallOptions): Promise<SkillInstallResult> {
        if (!skill) {
            return { success: false, skill, error: 'Skill not provided' };
        }

        const installed = await this.getInstalledSkillInventory();
        const existing = installed.find((item: any) => item.id === skill.id);
        if (existing) {
            return { success: true, skill: existing };
        }

        if (!skill.downloadUrl) {
            return { success: false, skill, error: 'Skill download URL missing' };
        }

        try {
            this.emit('installStart', skill);

            let downloadedSkill = skill;
            try {
                const response = await axios.get<NodeJS.ReadableStream>(skill.downloadUrl, withProxyConfig({
                    responseType: 'stream'
                }, skill.downloadUrl));
                const downloadedBytes = { value: 0 };
                const totalBytes = parseContentLengthHeader(response?.headers?.['content-length']);
                let bytesAtLastTick = 0;
                let lastReportedAt = Date.now();
                let pendingProgress = false;
                let latestBytesPerSecond = 0;
                const notifyProgress = () => {
                    pendingProgress = false;
                    const percent = totalBytes && totalBytes > 0
                        ? Math.max(0, Math.min(100, (downloadedBytes.value / totalBytes) * 100))
                        : undefined;
                    options?.onProgress?.({
                        phase: 'downloading',
                        downloadedBytes: downloadedBytes.value,
                        totalBytes: totalBytes || undefined,
                        bytesPerSecond: latestBytesPerSecond || undefined,
                        percent
                    });
                };
                const speedTimer = setInterval(() => {
                    const now = Date.now();
                    const elapsedSeconds = Math.max(1, (now - lastReportedAt) / 1000);
                    latestBytesPerSecond = Math.max(0, Math.round((downloadedBytes.value - bytesAtLastTick) / elapsedSeconds));
                    bytesAtLastTick = downloadedBytes.value;
                    lastReportedAt = now;
                    notifyProgress();
                }, 1000);
                speedTimer.unref?.();

                const chunks: Buffer[] = [];
                const stream = response.data;
                if (!stream) {
                    throw new Error('Empty download stream');
                }

                try {
                    await new Promise<void>((resolve: any, reject: any) => {
                        stream.on('data', (chunk: Buffer | string) => {
                            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                            chunks.push(buffer);
                            downloadedBytes.value += buffer.length;
                            pendingProgress = true;
                        });
                        stream.on('end', resolve);
                        stream.on('error', reject);
                    });
                } finally {
                    clearInterval(speedTimer);
                }

                if (pendingProgress || downloadedBytes.value > 0) {
                    const now = Date.now();
                    const elapsedSeconds = Math.max(0.001, (now - lastReportedAt) / 1000);
                    latestBytesPerSecond = Math.max(0, Math.round((downloadedBytes.value - bytesAtLastTick) / elapsedSeconds));
                    notifyProgress();
                }

                const bodyBuffer = Buffer.concat(chunks);
                const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
                const bodyText = bodyBuffer.toString('utf8');
                if (contentType.includes('json') || looksLikeJson(bodyText)) {
                    const rawPayload = JSON.parse(bodyText);
                    if (rawPayload && typeof rawPayload === 'object') {
                        const hubProvider = this.hubProviders.find((p: any) => p.getHub().id === skill.hubId);
                        if (hubProvider) {
                            const normalized = hubProvider.normalizeRemoteSkill(rawPayload);
                            if (normalized) {
                                downloadedSkill = {
                                    ...normalized,
                                    hubId: skill.hubId,
                                    hubName: skill.hubName,
                                    hubUrl: skill.hubUrl
                                };
                            }
                        }
                    }
                }
            } catch {
                // Download failed or not JSON; fall back to provided metadata
            }

            options?.onProgress?.({
                phase: 'importing',
                downloadedBytes: 0,
                percent: 100
            });
            await this.registry.importSkill(downloadedSkill);
            this.emit('installComplete', downloadedSkill);
            return { success: true, skill: downloadedSkill };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.emit('installError', skill, errorMessage);
            return { success: false, skill, error: errorMessage };
        }
    }

    public async uninstallSkill(skillId: string): Promise<boolean> {
        try {
            const installed = await this.getInstalledSkillInventory();
            const target = installed.find((skill: any) => skill.id === skillId);
            if (!target) {
                return false;
            }
            if (target.sourceKind === 'built-in') {
                return false;
            }
            const success = await this.registry.removeInstalledSkill(skillId);
            if (success) {
                this.emit('uninstall', skillId);
            }
            return success;
        } catch {
            return false;
        }
    }

    public clearCache(): void {
        this.cache.clear();
        this.cacheExpiry.clear();
        this.marketIndex.clear();
    }

    private async getInstalledSkillInventory(): Promise<SkillDefinition[]> {
        const builtIn = this.registry.getBuiltInSkills().map((skill: any) => ({
            ...skill,
            sourceKind: 'built-in' as SkillSourceKind,
            isInstalled: true
        }));
        const custom = this.registry.getCustomSkills().map((skill: any) => ({
            ...skill,
            sourceKind: 'custom' as SkillSourceKind,
            isInstalled: true
        }));
        const installed = (await this.registry.listInstalledSkills()).map((skill: any) => ({
            ...skill,
            sourceKind: (skill.source === 'custom' ? 'custom' : 'installed') as SkillSourceKind,
            isInstalled: true
        }));

        const hubIndex = new Map(this.hubProviders.map((provider: any) => [provider.getHub().id, provider.getHub()]));
        const all = [...installed, ...custom, ...builtIn].map((skill: any) => {
            if (skill.hubId && hubIndex.has(skill.hubId)) {
                const hub = hubIndex.get(skill.hubId)!;
                return { ...skill, hubName: skill.hubName || hub.name, hubUrl: skill.hubUrl || hub.url };
            }
            return skill;
        });

        const seen = new Set<string>();
        return all.filter((skill: any) => {
            const key = this.getSkillKey(skill);
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    private getSkillKey(skill: SkillDefinition): string {
        return skill.hubId ? `${skill.hubId}:${skill.id}` : skill.id;
    }

    private getSkillKeyForLookup(skillId: string, hubId?: string): string {
        return hubId ? `${hubId}:${skillId}` : skillId;
    }

    private getHubProviders(hubId?: string): RemoteSkillHubProvider[] {
        if (!hubId || hubId === 'all') {
            return [...this.hubProviders];
        }
        return this.hubProviders.filter((provider: any) => provider.getHub().id === hubId);
    }

    private isCacheValid(key: string): boolean {
        const expiry = this.cacheExpiry.get(key);
        if (!expiry) return false;
        return Date.now() < expiry;
    }

    private setCache(key: string, overview: SkillMarketOverview): void {
        this.cache.set(key, overview);
        this.cacheExpiry.set(key, Date.now() + CACHE_TTL);
    }

    private loadHubDefinitions(): SkillHubDefinition[] {
        const fromConfig = vscode.workspace.getConfiguration('openclaw').get<SkillHubDefinition[]>('skillHubs', []);
        const fromEnv = parseHubEnv(process.env.OPENCLAW_SKILL_HUBS);
        const combined = [...fromConfig, ...fromEnv].filter(Boolean);
        const normalized = combined
            .filter((hub: any) => hub && hub.id && hub.apiUrl)
            .map((hub: any) => ({
                id: String(hub.id).trim(),
                name: String(hub.name || hub.id).trim(),
                url: String(hub.url || '').trim() || String(hub.apiUrl || '').replace(/\/api\/.*/, ''),
                apiUrl: String(hub.apiUrl || '').trim(),
                enabled: hub.enabled !== false
            }))
            .filter((hub: any) => hub.id && hub.apiUrl && hub.enabled !== false);

        if (normalized.length === 0) {
            return DEFAULT_HUBS;
        }
        return normalized;
    }
}

function parseContentLengthHeader(value: unknown): number | undefined {
    const normalized = Array.isArray(value) ? value[0] : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function looksLikeJson(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function normalizeCategory(value: string): SkillCategory {
    const normalized = String(value || '').toLowerCase();
    switch (normalized) {
        case 'coding':
        case 'analysis':
        case 'planning':
        case 'communication':
        case 'testing':
        case 'documentation':
            return normalized as SkillCategory;
        default:
            return 'other';
    }
}

function resolveProviderKind(hub: SkillHubDefinition): HubProviderKind {
    const api = String(hub.apiUrl || '').toLowerCase();
    const url = String(hub.url || '').toLowerCase();
    const id = String(hub.id || '').toLowerCase();

    if (api.includes('skillsllm.com') || url.includes('skillsllm.com') || id.includes('skillsllm')) {
        return 'skillsllm';
    }
    if (api.includes('lightmake.site') || url.includes('skillhub.tencent.com') || id.includes('skillhub')) {
        return 'tencent-skillhub';
    }
    return 'generic';
}

function normalizeSkillsLLMSkill(raw: any, hub: SkillHubDefinition): SkillDefinition | undefined {
    if (!raw) {
        return undefined;
    }

    const id = String(raw.slug || raw.id || '').trim();
    if (!id) {
        return undefined;
    }

    const label = String(raw.name || raw.title || id).trim();
    const description = String(raw.description || raw.descriptionOriginal || '').trim();
    const prompt = String(raw.prompt || raw.systemPrompt || raw.instructions || raw.skillMdContent || raw.description || '').trim();
    const category = mapSkillsLLMCategory(raw.category?.slug || raw.category?.name || raw.categoryId || raw.category || 'other');
    const tags = normalizeTags(raw.topics || raw.tags || []);
    const version = String(raw.version || '1.0.0');
    const downloads = Number(raw.downloads || raw.installs || raw.stars || raw.forks || 0);
    const createdAt = ensureIsoDate(raw.createdAt || raw.updatedAt || raw.lastSynced);
    const updatedAt = ensureIsoDate(raw.updatedAt || raw.lastSynced || raw.createdAt);
    const downloadUrl = String(raw.repoUrl || raw.homepage || raw.website || '').trim();
    const homepage = raw.homepage || raw.website || raw.repoUrl;

    const author = raw.repoOwner
        ? {
            name: String(raw.repoOwner).trim(),
            url: raw.repoUrl,
            avatar: raw.ownerAvatar
        }
        : undefined;

    return {
        id,
        label,
        description,
        prompt,
        category,
        tags,
        source: 'marketplace',
        sourceKind: 'remote',
        hubId: hub.id,
        hubName: hub.name,
        hubUrl: hub.url,
        author,
        version,
        downloads,
        rating: typeof raw.rating === 'number' ? raw.rating : undefined,
        createdAt,
        updatedAt,
        downloadUrl,
        homepage,
        readme: raw.readmeContent
    };
}

function normalizeTencentSkill(raw: any, hub: SkillHubDefinition): SkillDefinition | undefined {
    if (!raw) {
        return undefined;
    }

    const id = String(raw.slug || raw.id || '').trim();
    if (!id) {
        return undefined;
    }

    const label = String(raw.name || raw.title || id).trim();
    const description = String(raw.description_zh || raw.description || '').trim();
    const prompt = String(raw.prompt || raw.systemPrompt || raw.instructions || raw.description_zh || raw.description || '').trim();
    const category = mapTencentCategory(raw.category || raw.type || 'other');
    const tags = normalizeTags(raw.tags || []);
    const version = String(raw.version || '1.0.0');
    const downloads = Number(raw.downloads || raw.installs || raw.score || 0);
    const updatedAt = ensureIsoDate(raw.updated_at || raw.updatedAt || raw.updatedAtMs);
    const createdAt = ensureIsoDate(raw.created_at || raw.createdAt || updatedAt);
    const downloadUrl = id ? `https://lightmake.site/api/v1/download?slug=${encodeURIComponent(id)}` : '';
    const homepage = raw.homepage || raw.website;

    const author = raw.ownerName
        ? {
            name: String(raw.ownerName).trim(),
            url: raw.ownerUrl
        }
        : undefined;

    return {
        id,
        label,
        description,
        prompt,
        category,
        tags,
        source: 'marketplace',
        sourceKind: 'remote',
        hubId: hub.id,
        hubName: hub.name,
        hubUrl: hub.url,
        author,
        version,
        downloads,
        rating: typeof raw.rating === 'number' ? raw.rating : undefined,
        createdAt,
        updatedAt,
        downloadUrl,
        homepage,
        readme: raw.readme
    };
}

function mapSkillsLLMCategory(value: string): SkillCategory {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('mcp')) {
        return 'coding';
    }
    if (normalized.includes('agent')) {
        return 'analysis';
    }
    if (normalized.includes('workflow')) {
        return 'planning';
    }
    return normalizeCategory(normalized);
}

function mapTencentCategory(value: string): SkillCategory {
    const normalized = String(value || '').toLowerCase();
    switch (normalized) {
        case 'developer-tools':
            return 'coding';
        case 'data-analysis':
            return 'analysis';
        case 'ai-intelligence':
            return 'analysis';
        case 'productivity':
            return 'planning';
        case 'content-creation':
            return 'communication';
        case 'security-compliance':
            return 'analysis';
        case 'utility':
            return 'other';
        default:
            return normalizeCategory(normalized);
    }
}

function mapTencentSort(sortBy?: SkillSearchFilters['sortBy']): { field: string; order: 'asc' | 'desc' } | undefined {
    switch (sortBy) {
        case 'updated':
            return { field: 'updated_at', order: 'desc' };
        case 'name':
            return { field: 'name', order: 'asc' };
        case 'rating':
            return { field: 'stars', order: 'desc' };
        case 'installed':
            return { field: 'installs', order: 'desc' };
        case 'popular':
        default:
            return { field: 'score', order: 'desc' };
    }
}

function withProxyConfig(config: AxiosRequestConfig, _requestUrl: string): AxiosRequestConfig {
    const httpConfig = vscode.workspace.getConfiguration('http');
    const proxySupport = String(httpConfig.get('proxySupport', 'override')).toLowerCase();
    const proxySetting = httpConfig.get<string>('proxy') || undefined;
    const envProxy = process.env.HTTPS_PROXY
        || process.env.HTTP_PROXY
        || process.env.https_proxy
        || process.env.http_proxy
        || undefined;
    const proxyUrl = proxySupport === 'off'
        ? undefined
        : (proxySetting || (proxySupport === 'override' ? undefined : envProxy));

    const baseConfig: AxiosRequestConfig = {
        timeout: REQUEST_TIMEOUT,
        headers: { Accept: 'application/json', ...(config.headers || {}) },
        ...config
    };

    if (!proxyUrl) {
        return baseConfig;
    }

    try {
        const parsed = new URL(proxyUrl);
        const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
        const proxy = {
            host: parsed.hostname,
            port,
            protocol: parsed.protocol.replace(':', ''),
            auth: parsed.username
                ? {
                    username: decodeURIComponent(parsed.username),
                    password: decodeURIComponent(parsed.password)
                }
                : undefined
        };
        return { ...baseConfig, proxy };
    } catch {
        return baseConfig;
    }
}

function normalizeTags(tags: unknown): string[] {
    if (Array.isArray(tags)) {
        return tags
            .map((tag: any) => String(tag || '').trim())
            .filter(Boolean);
    }
    if (typeof tags === 'string') {
        return tags
            .split(/[,|]/)
            .map((tag: any) => String(tag || '').trim())
            .filter(Boolean);
    }
    return [];
}

function ensureIsoDate(value: any): string {
    if (!value) {
        return new Date().toISOString();
    }
    if (typeof value === 'number') {
        const dt = new Date(value);
        return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
    }
    const parsed = Date.parse(String(value));
    if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
}

function buildCategoryCounts(skills: SkillDefinition[]): { id: SkillCategory; count: number }[] {
    const counts = new Map<SkillCategory, number>();
    skills.forEach((skill: any) => {
        const category = skill.category || 'other';
        counts.set(category, (counts.get(category) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([id, count]: any) => ({ id, count }))
        .sort((a: any, b: any) => b.count - a.count);
}

function buildTagCounts(skills: SkillDefinition[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    skills.forEach((skill: any) => {
        (skill.tags || []).forEach((tag: any) => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });
    });
    return Array.from(counts.entries())
        .map(([name, count]: any) => ({ name, count }))
        .sort((a: any, b: any) => b.count - a.count);
}

function parseHubEnv(raw?: string): SkillHubDefinition[] {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        return [];
    }
    return [];
}

function isVersionNewer(remote?: string, installed?: string): boolean {
    if (!remote || !installed) {
        return false;
    }
    const parse = (value: string) => value.split(/[^0-9]+/).map((num: any) => parseInt(num || '0', 10));
    const remoteParts = parse(remote);
    const installedParts = parse(installed);
    const maxLen = Math.max(remoteParts.length, installedParts.length);
    for (let i = 0; i < maxLen; i += 1) {
        const a = remoteParts[i] || 0;
        const b = installedParts[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return false;
}
