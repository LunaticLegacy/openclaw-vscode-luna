// Skill Market - Local Skill Registry
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SkillDefinition, SkillCategory } from './types';
import { EventEmitter } from 'events';

const BUILT_IN_SKILLS: SkillDefinition[] = [
    {
        id: 'code-review',
        label: 'Code Review',
        description: 'Find high-signal bugs, regressions, missing tests, and user-visible risks first.',
        prompt: 'Review code with a findings-first mindset. Prioritize correctness, regressions, security, and missing tests over style.',
        category: 'coding',
        tags: ['review', 'quality', 'bugs', 'security'],
        source: 'built-in',
        version: '1.0.0',
        downloads: 0,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        downloadUrl: '',
        isInstalled: true,
        isEnabled: false
    },
    {
        id: 'debugging',
        label: 'Debugging',
        description: 'Converge on the fastest reproducer, strongest signal, and smallest safe fix.',
        prompt: 'Run a compact debug loop: restate the symptom, rank hypotheses, pick one high-signal probe, and avoid broad rewrites before verification.',
        category: 'coding',
        tags: ['debug', 'troubleshoot', 'fix'],
        source: 'built-in',
        version: '1.0.0',
        downloads: 0,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        downloadUrl: '',
        isInstalled: true,
        isEnabled: false
    },
    {
        id: 'refactor-planning',
        label: 'Refactor Planning',
        description: 'Plan staged, reversible refactors with rollback and verification gates.',
        prompt: 'Favor small, reversible phases. Include dependency impact, rollback points, and verification gates for each stage.',
        category: 'planning',
        tags: ['refactor', 'architecture', 'migration'],
        source: 'built-in',
        version: '1.0.0',
        downloads: 0,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        downloadUrl: '',
        isInstalled: true,
        isEnabled: false
    },
    {
        id: 'api-design',
        label: 'API Design',
        description: 'Design contracts with explicit schema, examples, compatibility, and error models.',
        prompt: 'Keep request and response schemas, examples, authentication, versioning, and error models internally consistent. Call out breaking changes explicitly.',
        category: 'planning',
        tags: ['api', 'design', 'contract'],
        source: 'built-in',
        version: '1.0.0',
        downloads: 0,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        downloadUrl: '',
        isInstalled: true,
        isEnabled: false
    },
    {
        id: 'test-authoring',
        label: 'Test Authoring',
        description: 'Add focused tests that cover the real behavioral risk without brittle noise.',
        prompt: 'Write the smallest stable tests that cover the intended behavior and key edge cases. Prefer risk coverage over raw coverage count.',
        category: 'testing',
        tags: ['testing', 'tdd', 'coverage'],
        source: 'built-in',
        version: '1.0.0',
        downloads: 0,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        downloadUrl: '',
        isInstalled: true,
        isEnabled: false
    }
];

interface SkillState {
    isEnabled: boolean;
    enabledForAgents: string[]; // agent IDs
}

interface StoredSkillMetadata {
    id?: string;
    label?: string;
    description?: string;
    prompt?: string;
    category?: SkillCategory;
    tags?: string[];
    source?: string;
    hubId?: string;
    hubName?: string;
    hubUrl?: string;
    version?: string;
    downloads?: number;
    installedAt?: string;
    homepage?: string;
}

const SKILL_METADATA_FILE = '.openclaw-skill.json';

export class LocalSkillRegistry extends EventEmitter {
    private skillStates: Map<string, SkillState> = new Map();
    private customSkills: Map<string, SkillDefinition> = new Map();
    private stateKey = 'skillMarket.states';
    private customSkillsKey = 'skillMarket.customSkills';

    constructor(private context: vscode.ExtensionContext) {
        super();
        this.loadStates();
        this.loadCustomSkills();
    }

    /**
     * Get all available skills (built-in + installed + custom)
     */
    public async getAllSkills(): Promise<SkillDefinition[]> {
        const installed = await this.getInstalledSkills();
        const custom = Array.from(this.customSkills.values());
        
        // Combine all skills
        const allSkills = [
            ...BUILT_IN_SKILLS.map((s: any) => this.enrichWithState(s)),
            ...installed.map((s: any) => this.enrichWithState(s)),
            ...custom.map((s: any) => this.enrichWithState(s))
        ];

        // Remove duplicates (by id), preferring installed/custom over built-in
        const seen = new Set<string>();
        return allSkills.filter((s: any) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
        });
    }

    /**
     * Get built-in skills
     */
    public getBuiltInSkills(): SkillDefinition[] {
        return BUILT_IN_SKILLS.map((skill: any) => ({ ...skill }));
    }

    /**
     * Get custom skills
     */
    public getCustomSkills(): SkillDefinition[] {
        return Array.from(this.customSkills.values()).map((skill: any) => ({ ...skill }));
    }

    /**
     * Get installed skills from storage
     */
    public async listInstalledSkills(): Promise<SkillDefinition[]> {
        return this.getInstalledSkills();
    }

    /**
     * Get skills enabled for a specific agent
     */
    public getEnabledSkillsForAgent(agentId: string): SkillDefinition[] {
        const installedSkills = Array.from(this.customSkills.values());
        const allSkills = [...BUILT_IN_SKILLS, ...installedSkills];
        return allSkills
            .filter((s: any) => {
                const state = this.skillStates.get(s.id);
                return state?.isEnabled || state?.enabledForAgents?.includes(agentId);
            })
            .map((s: any) => ({ ...s, isEnabled: true }));
    }

    /**
     * Enable/disable skill globally or for specific agent
     */
    public setSkillEnabled(skillId: string, enabled: boolean, agentId?: string): void {
        const state = this.skillStates.get(skillId) || { isEnabled: false, enabledForAgents: [] };
        
        if (agentId) {
            // Toggle for specific agent
            if (enabled) {
                if (!state.enabledForAgents.includes(agentId)) {
                    state.enabledForAgents.push(agentId);
                }
            } else {
                state.enabledForAgents = state.enabledForAgents.filter((id: any) => id !== agentId);
            }
        } else {
            // Global toggle
            state.isEnabled = enabled;
        }

        this.skillStates.set(skillId, state);
        this.saveStates();
        this.emit('skillStateChanged', skillId, state);
    }

    /**
     * Check if skill is enabled
     */
    public isSkillEnabled(skillId: string, agentId?: string): boolean {
        const state = this.skillStates.get(skillId);
        if (!state) return false;
        
        if (agentId) {
            return state.isEnabled || state.enabledForAgents.includes(agentId);
        }
        return state.isEnabled;
    }

    /**
     * Add custom skill
     */
    public addCustomSkill(skill: Omit<SkillDefinition, 'source' | 'isInstalled'>): SkillDefinition {
        const fullSkill: SkillDefinition = {
            ...skill,
            source: 'custom',
            isInstalled: true,
            isEnabled: false
        };

        this.customSkills.set(skill.id, fullSkill);
        this.saveCustomSkills();
        this.emit('customSkillAdded', fullSkill);
        return fullSkill;
    }

    /**
     * Remove custom skill
     */
    public removeCustomSkill(skillId: string): boolean {
        const existed = this.customSkills.delete(skillId);
        if (existed) {
            this.skillStates.delete(skillId);
            this.saveCustomSkills();
            this.saveStates();
            this.emit('customSkillRemoved', skillId);
        }
        return existed;
    }

    /**
     * Import skill from marketplace to local
     */
    public async importSkill(skill: SkillDefinition): Promise<void> {
        const skillsDir = await this.resolveOpenClawSkillsDir();
        await fs.mkdir(skillsDir, { recursive: true });

        const skillFolderName = this.buildInstalledSkillFolderName(skill);
        const skillDir = path.join(skillsDir, skillFolderName);
        await fs.mkdir(skillDir, { recursive: true });

        const skillData: SkillDefinition = {
            ...skill,
            isInstalled: true,
            isEnabled: false,
            installedAt: new Date().toISOString(),
            localPath: skillDir
        };
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), this.buildInstalledSkillMarkdown(skillData), 'utf8');
        await fs.writeFile(
            path.join(skillDir, SKILL_METADATA_FILE),
            JSON.stringify({
                id: skillData.id,
                label: skillData.label,
                description: skillData.description,
                prompt: skillData.prompt,
                category: skillData.category,
                tags: skillData.tags,
                source: skillData.source,
                hubId: skillData.hubId,
                hubName: skillData.hubName,
                hubUrl: skillData.hubUrl,
                version: skillData.version,
                downloads: skillData.downloads,
                installedAt: skillData.installedAt,
                homepage: skillData.homepage
            } as StoredSkillMetadata, undefined, 2),
            'utf8'
        );

        this.emit('skillImported', skillData);
    }

    /**
     * Remove an installed skill by id
     */
    public async removeInstalledSkill(skillId: string): Promise<boolean> {
        try {
            const installedSkills = await this.getInstalledSkills();
            const target = installedSkills.find((skill: any) => skill.id === skillId);
            if (!target?.localPath) {
                return false;
            }
            await fs.rm(target.localPath, { recursive: true, force: true });
            this.skillStates.delete(skillId);
            this.saveStates();
            this.emit('skillRemoved', skillId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get installed skills from storage
     */
    private async getInstalledSkills(): Promise<SkillDefinition[]> {
        try {
            const skillsDir = await this.resolveOpenClawSkillsDir();

            try {
                await fs.stat(skillsDir);
            } catch {
                return [];
            }

            const entries = await fs.readdir(skillsDir, { withFileTypes: true });
            const skills: SkillDefinition[] = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const skill = await this.readInstalledSkillFromDirectory(path.join(skillsDir, entry.name), entry.name);
                if (skill) {
                    skills.push(skill);
                }
            }

            return skills;
        } catch {
            return [];
        }
    }

    /**
     * Build prompt appendix from enabled skills
     */
    public buildSkillPromptAppendix(agentId: string): string {
        const enabledSkills = this.getEnabledSkillsForAgent(agentId);
        
        if (enabledSkills.length === 0) {
            return '';
        }

        const skillPrompts = enabledSkills
            .map((skill: any) => `- ${skill.label}: ${skill.prompt}`);

        return [
            '',
            'Enabled AI skills:',
            ...skillPrompts
        ].join('\n');
    }

    /**
     * Get all categories with counts
     */
    public async getCategories(): Promise<{ id: SkillCategory; count: number }[]> {
        const skills = await this.getAllSkills();
        const counts = new Map<SkillCategory, number>();
        
        skills.forEach((s: any) => {
            counts.set(s.category, (counts.get(s.category) || 0) + 1);
        });

        return Array.from(counts.entries())
            .map(([id, count]: any) => ({ id, count }))
            .sort((a: any, b: any) => b.count - a.count);
    }

    /**
     * Get all tags with counts
     */
    public async getTags(): Promise<{ name: string; count: number }[]> {
        const skills = await this.getAllSkills();
        const counts = new Map<string, number>();
        
        skills.forEach((s: any) => {
            s.tags.forEach((t: any) => {
                counts.set(t, (counts.get(t) || 0) + 1);
            });
        });

        return Array.from(counts.entries())
            .map(([name, count]: any) => ({ name, count }))
            .sort((a: any, b: any) => b.count - a.count);
    }

    private enrichWithState(skill: SkillDefinition): SkillDefinition {
        const state = this.skillStates.get(skill.id);
        return {
            ...skill,
            isEnabled: state?.isEnabled || false
        };
    }

    private loadStates(): void {
        try {
            const data = this.context.globalState.get<Record<string, SkillState>>(this.stateKey);
            if (data) {
                this.skillStates = new Map(Object.entries(data));
            }
        } catch {
            // Ignore load errors
        }
    }

    private saveStates(): void {
        try {
            const data = Object.fromEntries(this.skillStates);
            this.context.globalState.update(this.stateKey, data);
        } catch {
            // Ignore save errors
        }
    }

    private loadCustomSkills(): void {
        try {
            const data = this.context.globalState.get<SkillDefinition[]>(this.customSkillsKey);
            if (data) {
                this.customSkills = new Map(data.map((s: any) => [s.id, s]));
            }
        } catch {
            // Ignore load errors
        }
    }

    private saveCustomSkills(): void {
        try {
            const data = Array.from(this.customSkills.values());
            this.context.globalState.update(this.customSkillsKey, data);
        } catch {
            // Ignore save errors
        }
    }

    private async resolveOpenClawSkillsDir(): Promise<string> {
        const configuredStateDir = String(
            vscode.workspace.getConfiguration('openclaw').get<string>('stateDir', '')
            || process.env.OPENCLAW_STATE_DIR
            || path.join(os.homedir(), '.openclaw')
        ).trim();
        return path.join(configuredStateDir, 'skills');
    }

    private buildInstalledSkillFolderName(skill: SkillDefinition): string {
        const prefix = String(skill.hubId || skill.source || 'local')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'local';
        const id = String(skill.id || 'skill')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'skill';
        return `${prefix}__${id}`;
    }

    private buildInstalledSkillMarkdown(skill: SkillDefinition): string {
        const frontmatter = [
            '---',
            `name: ${skill.id}`,
            `description: ${JSON.stringify(skill.description || '')}`,
            '---',
            ''
        ];
        const body = skill.prompt || skill.readme || skill.description || '';
        return [...frontmatter, body, ''].join('\n');
    }

    private async readInstalledSkillFromDirectory(skillDir: string, folderName: string): Promise<SkillDefinition | undefined> {
        try {
            const skillMarkdownPath = path.join(skillDir, 'SKILL.md');
            const markdown = await fs.readFile(skillMarkdownPath, 'utf8');
            const metadata = await this.readStoredSkillMetadata(path.join(skillDir, SKILL_METADATA_FILE));
            const parsed = this.parseSkillMarkdown(markdown);
            const skillId = String(metadata.id || parsed.name || folderName.split('__').slice(1).join('__') || folderName).trim();
            if (!skillId) {
                return undefined;
            }

            return {
                id: skillId,
                label: String(metadata.label || parsed.name || skillId).trim(),
                description: String(metadata.description || parsed.description || '').trim(),
                prompt: String(metadata.prompt || parsed.body || '').trim(),
                category: metadata.category || 'other',
                tags: Array.isArray(metadata.tags) ? metadata.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean) : [],
                source: metadata.source === 'custom' ? 'custom' : 'marketplace',
                sourceKind: 'installed',
                hubId: metadata.hubId,
                hubName: metadata.hubName,
                hubUrl: metadata.hubUrl,
                version: String(metadata.version || '1.0.0'),
                downloads: Number(metadata.downloads || 0),
                createdAt: metadata.installedAt || new Date().toISOString(),
                updatedAt: metadata.installedAt || new Date().toISOString(),
                downloadUrl: '',
                homepage: metadata.homepage,
                isInstalled: true,
                isEnabled: this.isSkillEnabled(skillId),
                installedAt: metadata.installedAt,
                localPath: skillDir
            };
        } catch {
            return undefined;
        }
    }

    private async readStoredSkillMetadata(metadataPath: string): Promise<StoredSkillMetadata> {
        try {
            const content = await fs.readFile(metadataPath, 'utf8');
            return JSON.parse(content) as StoredSkillMetadata;
        } catch {
            return {};
        }
    }

    private parseSkillMarkdown(markdown: string): { name?: string; description?: string; body: string } {
        const content = String(markdown || '');
        if (!content.startsWith('---')) {
            return { body: content.trim() };
        }

        const closing = content.indexOf('\n---', 3);
        if (closing < 0) {
            return { body: content.trim() };
        }

        const frontmatter = content.slice(3, closing).trim();
        const body = content.slice(closing + 4).trim();
        const nameMatch = frontmatter.match(/(?:^|\n)name:\s*(.+)/);
        const descriptionMatch = frontmatter.match(/(?:^|\n)description:\s*(.+)/);
        return {
            name: nameMatch ? String(nameMatch[1]).trim().replace(/^["']|["']$/g, '') : undefined,
            description: descriptionMatch ? String(descriptionMatch[1]).trim().replace(/^["']|["']$/g, '') : undefined,
            body
        };
    }
}
