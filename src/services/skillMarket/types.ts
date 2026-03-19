// Skill Market - Types

export type SkillSource = 'built-in' | 'marketplace' | 'custom';

export type SkillSourceKind = 'remote' | 'built-in' | 'installed' | 'custom';

export type SkillCategory = 
    | 'coding' 
    | 'analysis' 
    | 'planning' 
    | 'communication' 
    | 'testing'
    | 'documentation'
    | 'other';

export interface SkillAuthor {
    name: string;
    url?: string;
    avatar?: string;
}

export interface SkillDefinition {
    id: string;
    label: string;
    description: string;
    prompt: string;
    category: SkillCategory;
    tags: string[];
    source: SkillSource;
    sourceKind?: SkillSourceKind;
    hubId?: string;
    hubName?: string;
    hubUrl?: string;
    author?: SkillAuthor;
    version: string;
    downloads: number;
    rating?: number;
    createdAt: string;
    updatedAt: string;
    downloadUrl: string;
    homepage?: string;
    readme?: string;
    examples?: string[];
    
    // Local state
    isInstalled?: boolean;
    isEnabled?: boolean;
    installedAt?: string;
    localPath?: string;
    installedVersion?: string;
    updateAvailable?: boolean;
}

export interface SkillMarketListing {
    skills: SkillDefinition[];
    total: number;
    page: number;
    pageSize: number;
    categories: { id: SkillCategory; count: number }[];
    tags: { name: string; count: number }[];
}

export interface SkillSearchFilters {
    query?: string;
    category?: SkillCategory;
    tags?: string[];
    source?: SkillSource;
    sortBy?: 'popular' | 'updated' | 'rating' | 'name' | 'installed';
    hubId?: string;
}

export interface SkillInstallResult {
    success: boolean;
    skill: SkillDefinition;
    error?: string;
}

export interface SkillMarketProvider {
    id: string;
    name: string;
    url: string;
    isAvailable: boolean;
}

export interface SkillHubDefinition {
    id: string;
    name: string;
    url: string;
    apiUrl: string;
    enabled?: boolean;
}

export interface SkillHubStatus {
    id: string;
    name: string;
    url: string;
    apiUrl?: string;
    status: 'ok' | 'error';
    error?: string;
}

export interface SkillMarketOverview {
    market: SkillDefinition[];
    installed: SkillDefinition[];
    total: number;
    categories: { id: SkillCategory; count: number }[];
    tags: { name: string; count: number }[];
    hubs: SkillHubStatus[];
    errors: string[];
}
