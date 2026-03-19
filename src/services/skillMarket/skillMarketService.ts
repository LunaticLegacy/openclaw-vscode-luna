// Skill Market - Service
import * as vscode from 'vscode';
import axios from 'axios';
import { EventEmitter } from 'events';
import {
    SkillDefinition,
    SkillSearchFilters,
    SkillInstallResult,
    SkillMarketOverview,
    SkillHubDefinition,
    SkillHubStatus,
    SkillCategory,
    SkillSourceKind
} from './types';
import { LocalSkillRegistry } from './localSkillRegistry';

const REQUEST_TIMEOUT = 10000;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DEFAULT_HUBS: SkillHubDefinition[] = [
    {
        id: 'skillmarket',
        name: 'SkillMarket.cc',
        url: 'https://skillmarket.cc',
        apiUrl: 'https://skillmarket.cc/api/v1'
    }
];

interface HubSkillResponse {
    skills?: any[];
    items?: any[];
    total?: number;
    data?: any[];
}

class RemoteSkillHubProvider {
    constructor(private hub: SkillHubDefinition) {}

    public getHub(): SkillHubDefinition {
        return this.hub;
    }

    public async fetchSkills(filters: SkillSearchFilters): Promise<SkillDefinition[]> {
        const category = filters.category;
        const params: Record<string, string | number | undefined> = {
            q: filters.query || undefined,
            category: category && String(category) !== 'all' ? category : undefined,
            tags: filters.tags?.length ? filters.tags.join(',') : undefined,
            sort: filters.sortBy && filters.sortBy !== 'installed' ? filters.sortBy : undefined,
            page: 1,
            limit: 100
        };

        const response = await axios.get<HubSkillResponse>(`${this.hub.apiUrl}/skills`, {
            params,
            timeout: REQUEST_TIMEOUT
        });

        const payload = response.data;
        const rawSkills = payload.skills || payload.items || payload.data || [];

        return rawSkills
            .map(skill => this.normalizeRemoteSkill(skill))
            .filter((skill): skill is SkillDefinition => Boolean(skill));
    }

    public async fetchSkillDetails(skillId: string): Promise<SkillDefinition | null> {
        const response = await axios.get<any>(`${this.hub.apiUrl}/skills/${skillId}`, {
            timeout: REQUEST_TIMEOUT
        });
        return this.normalizeRemoteSkill(response.data);
    }

    public normalizeRemoteSkill(raw: any): SkillDefinition | null {
        if (!raw) {
            return null;
        }

        const id = String(raw.id || raw.slug || '').trim();
        if (!id) {
            return null;
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
}

export class SkillMarketService extends EventEmitter {
    private registry: LocalSkillRegistry;
    private hubProviders: RemoteSkillHubProvider[] = [];
    private cache: Map<string, SkillMarketOverview> = new Map();
    private cacheExpiry: Map<string, number> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        super();
        this.registry = new LocalSkillRegistry(context);
        this.hubProviders = this.loadHubDefinitions().map(def => new RemoteSkillHubProvider(def));
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
            hubProviders.map(provider => provider.fetchSkills(filters || {}))
        );

        let marketSkills: SkillDefinition[] = [];
        hubResults.forEach((result, index) => {
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
        const installedIndex = new Map(installedSkills.map(skill => [this.getSkillKey(skill), skill]));
        const installedById = new Map(installedSkills.map(skill => [skill.id, skill]));

        marketSkills = marketSkills.map(skill => {
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
        const dedupedMarket = marketSkills.filter(skill => {
            const key = `${skill.hubId || 'hub'}:${skill.id}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
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

    public async getSkillDetails(skillId: string, hubId?: string | null): Promise<SkillDefinition | null> {
        if (!skillId) {
            return null;
        }

        const installed = await this.getInstalledSkillInventory();
        const localMatch = installed.find(skill => skill.id === skillId);
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
        return localMatch || null;
    }

    public async installSkill(skill: SkillDefinition): Promise<SkillInstallResult> {
        if (!skill) {
            return { success: false, skill, error: 'Skill not provided' };
        }

        const installed = await this.getInstalledSkillInventory();
        const existing = installed.find(item => item.id === skill.id);
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
                const response = await axios.get<any>(skill.downloadUrl, { timeout: REQUEST_TIMEOUT });
                if (response?.data && typeof response.data === 'object') {
                    const hubProvider = this.hubProviders.find(p => p.getHub().id === skill.hubId);
                    if (hubProvider) {
                        const normalized = hubProvider.normalizeRemoteSkill(response.data);
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
            } catch {
                // Download failed or not JSON; fall back to provided metadata
            }

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
            const target = installed.find(skill => skill.id === skillId);
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
    }

    private async getInstalledSkillInventory(): Promise<SkillDefinition[]> {
        const builtIn = this.registry.getBuiltInSkills().map(skill => ({
            ...skill,
            sourceKind: 'built-in' as SkillSourceKind,
            isInstalled: true
        }));
        const custom = this.registry.getCustomSkills().map(skill => ({
            ...skill,
            sourceKind: 'custom' as SkillSourceKind,
            isInstalled: true
        }));
        const installed = (await this.registry.listInstalledSkills()).map(skill => ({
            ...skill,
            sourceKind: (skill.source === 'custom' ? 'custom' : 'installed') as SkillSourceKind,
            isInstalled: true
        }));

        const hubIndex = new Map(this.hubProviders.map(provider => [provider.getHub().id, provider.getHub()]));
        const all = [...installed, ...custom, ...builtIn].map(skill => {
            if (skill.hubId && hubIndex.has(skill.hubId)) {
                const hub = hubIndex.get(skill.hubId)!;
                return { ...skill, hubName: skill.hubName || hub.name, hubUrl: skill.hubUrl || hub.url };
            }
            return skill;
        });

        const seen = new Set<string>();
        return all.filter(skill => {
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

    private getHubProviders(hubId?: string): RemoteSkillHubProvider[] {
        if (!hubId || hubId === 'all') {
            return [...this.hubProviders];
        }
        return this.hubProviders.filter(provider => provider.getHub().id === hubId);
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
            .filter(hub => hub && hub.id && hub.apiUrl)
            .map(hub => ({
                id: String(hub.id).trim(),
                name: String(hub.name || hub.id).trim(),
                url: String(hub.url || '').trim() || String(hub.apiUrl || '').replace(/\/api\/.*/, ''),
                apiUrl: String(hub.apiUrl || '').trim(),
                enabled: hub.enabled !== false
            }))
            .filter(hub => hub.id && hub.apiUrl && hub.enabled !== false);

        if (normalized.length === 0) {
            return DEFAULT_HUBS;
        }
        return normalized;
    }
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

function normalizeTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .map(tag => String(tag || '').trim())
        .filter(Boolean);
}

function buildCategoryCounts(skills: SkillDefinition[]): { id: SkillCategory; count: number }[] {
    const counts = new Map<SkillCategory, number>();
    skills.forEach(skill => {
        const category = skill.category || 'other';
        counts.set(category, (counts.get(category) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
}

function buildTagCounts(skills: SkillDefinition[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    skills.forEach(skill => {
        (skill.tags || []).forEach(tag => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });
    });
    return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
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
    const parse = (value: string) => value.split(/[^0-9]+/).map(num => parseInt(num || '0', 10));
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
