// Skill Market - Local Skill Registry
import * as vscode from 'vscode';
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
            ...BUILT_IN_SKILLS.map(s => this.enrichWithState(s)),
            ...installed.map(s => this.enrichWithState(s)),
            ...custom.map(s => this.enrichWithState(s))
        ];

        // Remove duplicates (by id), preferring installed/custom over built-in
        const seen = new Set<string>();
        return allSkills.filter(s => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
        });
    }

    /**
     * Get skills enabled for a specific agent
     */
    public getEnabledSkillsForAgent(agentId: string): SkillDefinition[] {
        const allSkills = [...BUILT_IN_SKILLS, ...this.customSkills.values()];
        return allSkills
            .filter(s => {
                const state = this.skillStates.get(s.id);
                return state?.isEnabled || state?.enabledForAgents?.includes(agentId);
            })
            .map(s => ({ ...s, isEnabled: true }));
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
                state.enabledForAgents = state.enabledForAgents.filter(id => id !== agentId);
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
        const skillsDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'skills');
        await vscode.workspace.fs.createDirectory(skillsDir);

        const skillPath = vscode.Uri.joinPath(skillsDir, `${skill.id}.json`);
        const skillData: SkillDefinition = {
            ...skill,
            isInstalled: true,
            isEnabled: false,
            installedAt: new Date().toISOString(),
            localPath: skillPath.fsPath
        };

        await vscode.workspace.fs.writeFile(
            skillPath,
            Buffer.from(JSON.stringify(skillData, null, 2))
        );

        this.emit('skillImported', skillData);
    }

    /**
     * Get installed skills from storage
     */
    private async getInstalledSkills(): Promise<SkillDefinition[]> {
        try {
            const skillsDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'skills');
            
            try {
                await vscode.workspace.fs.stat(skillsDir);
            } catch {
                return [];
            }

            const entries = await vscode.workspace.fs.readDirectory(skillsDir);
            const skills: SkillDefinition[] = [];

            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.json')) {
                    try {
                        const content = await vscode.workspace.fs.readFile(
                            vscode.Uri.joinPath(skillsDir, name)
                        );
                        const skill = JSON.parse(content.toString()) as SkillDefinition;
                        skills.push(skill);
                    } catch {
                        // Skip invalid files
                    }
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
            .map(skill => `- ${skill.label}: ${skill.prompt}`);

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
        
        skills.forEach(s => {
            counts.set(s.category, (counts.get(s.category) || 0) + 1);
        });

        return Array.from(counts.entries())
            .map(([id, count]) => ({ id, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Get all tags with counts
     */
    public async getTags(): Promise<{ name: string; count: number }[]> {
        const skills = await this.getAllSkills();
        const counts = new Map<string, number>();
        
        skills.forEach(s => {
            s.tags.forEach(t => {
                counts.set(t, (counts.get(t) || 0) + 1);
            });
        });

        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
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
                this.customSkills = new Map(data.map(s => [s.id, s]));
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
}
