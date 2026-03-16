// Skill Market - Service
import * as vscode from 'vscode';
import axios from 'axios';
import { SkillDefinition, SkillMarketListing, SkillSearchFilters, SkillInstallResult, SkillMarketProvider } from './types';
import { EventEmitter } from 'events';

const SKILL_MARKET_URL = 'https://skillmarket.cc/api/v1';
const REQUEST_TIMEOUT = 10000;

export class SkillMarketService extends EventEmitter {
    private providers: SkillMarketProvider[] = [
        {
            id: 'skillmarket',
            name: 'SkillMarket.cc',
            url: 'https://skillmarket.cc',
            isAvailable: false
        },
        {
            id: 'github',
            name: 'GitHub Community',
            url: 'https://github.com/topics/openclaw-skills',
            isAvailable: true
        }
    ];

    private cache: Map<string, SkillMarketListing> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(private context: vscode.ExtensionContext) {
        super();
    }

    /**
     * Check if SkillMarket.cc is available
     */
    public async checkAvailability(): Promise<boolean> {
        try {
            const response = await axios.get(`${SKILL_MARKET_URL}/health`, {
                timeout: 5000
            });
            const isAvailable = response.status === 200;
            this.providers[0].isAvailable = isAvailable;
            return isAvailable;
        } catch {
            this.providers[0].isAvailable = false;
            return false;
        }
    }

    /**
     * Get available providers
     */
    public getProviders(): SkillMarketProvider[] {
        return [...this.providers];
    }

    /**
     * Search skills from marketplace
     */
    public async searchSkills(filters: SkillSearchFilters): Promise<SkillMarketListing> {
        const cacheKey = JSON.stringify(filters);
        
        // Check cache
        if (this.isCacheValid(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        // If SkillMarket.cc is not available, return mock data for now
        // In production, this would call the actual API
        if (!this.providers[0].isAvailable) {
            const mockListing = this.getMockListing(filters);
            this.setCache(cacheKey, mockListing);
            return mockListing;
        }

        try {
            const response = await axios.get(`${SKILL_MARKET_URL}/skills`, {
                params: {
                    q: filters.query,
                    category: filters.category,
                    tags: filters.tags?.join(','),
                    sort: filters.sortBy,
                    page: 1,
                    limit: 50
                },
                timeout: REQUEST_TIMEOUT
            });

            const listing: SkillMarketListing = {
                skills: response.data.skills || [],
                total: response.data.total || 0,
                page: response.data.page || 1,
                pageSize: response.data.pageSize || 50,
                categories: response.data.categories || [],
                tags: response.data.tags || []
            };

            this.setCache(cacheKey, listing);
            return listing;
        } catch (error) {
            console.warn('Failed to fetch skills from marketplace:', error);
            // Fallback to mock data
            const mockListing = this.getMockListing(filters);
            this.setCache(cacheKey, mockListing);
            return mockListing;
        }
    }

    /**
     * Get skill details
     */
    public async getSkillDetails(skillId: string): Promise<SkillDefinition | null> {
        try {
            const response = await axios.get(`${SKILL_MARKET_URL}/skills/${skillId}`, {
                timeout: REQUEST_TIMEOUT
            });
            return response.data;
        } catch {
            return null;
        }
    }

    /**
     * Download and install a skill
     */
    public async installSkill(skill: SkillDefinition): Promise<SkillInstallResult> {
        try {
            this.emit('installStart', skill);

            // Download skill content
            const response = await axios.get(skill.downloadUrl, {
                timeout: REQUEST_TIMEOUT
            });

            // Store in extension storage
            const skillsDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'skills');
            await vscode.workspace.fs.createDirectory(skillsDir);

            const skillPath = vscode.Uri.joinPath(skillsDir, `${skill.id}.json`);
            const skillData = {
                ...skill,
                isInstalled: true,
                installedAt: new Date().toISOString(),
                localPath: skillPath.fsPath
            };

            await vscode.workspace.fs.writeFile(
                skillPath,
                Buffer.from(JSON.stringify(skillData, null, 2))
            );

            this.emit('installComplete', skillData);
            return { success: true, skill: skillData };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.emit('installError', skill, errorMessage);
            return { success: false, skill, error: errorMessage };
        }
    }

    /**
     * Uninstall a skill
     */
    public async uninstallSkill(skillId: string): Promise<boolean> {
        try {
            const skillPath = vscode.Uri.joinPath(
                this.context.globalStorageUri, 
                'skills', 
                `${skillId}.json`
            );
            
            await vscode.workspace.fs.delete(skillPath, { useTrash: false });
            this.emit('uninstall', skillId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get all installed skills
     */
    public async getInstalledSkills(): Promise<SkillDefinition[]> {
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

            return skills.sort((a, b) => 
                new Date(b.installedAt!).getTime() - new Date(a.installedAt!).getTime()
            );
        } catch {
            return [];
        }
    }

    /**
     * Clear cache
     */
    public clearCache(): void {
        this.cache.clear();
        this.cacheExpiry.clear();
    }

    private isCacheValid(key: string): boolean {
        const expiry = this.cacheExpiry.get(key);
        if (!expiry) return false;
        return Date.now() < expiry;
    }

    private setCache(key: string, listing: SkillMarketListing): void {
        this.cache.set(key, listing);
        this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
    }

    /**
     * Mock data for development/fallback
     */
    private getMockListing(filters: SkillSearchFilters): SkillMarketListing {
        const mockSkills: SkillDefinition[] = [
            {
                id: 'code-review-pro',
                label: 'Code Review Pro',
                description: 'Advanced code review with security analysis, performance checks, and best practices.',
                prompt: 'You are an expert code reviewer. Analyze code for: 1) Security vulnerabilities, 2) Performance bottlenecks, 3) Maintainability issues, 4) Testing gaps. Provide actionable feedback with examples.',
                category: 'coding',
                tags: ['review', 'security', 'performance', 'quality'],
                source: 'marketplace',
                author: { name: 'OpenClaw Team', url: 'https://skillmarket.cc' },
                version: '1.2.0',
                downloads: 15420,
                rating: 4.8,
                createdAt: '2024-01-15',
                updatedAt: '2024-03-01',
                downloadUrl: 'https://skillmarket.cc/skills/code-review-pro/download'
            },
            {
                id: 'api-designer',
                label: 'API Designer',
                description: 'Design RESTful and GraphQL APIs with proper versioning, authentication, and documentation.',
                prompt: 'You are an API design specialist. Help design APIs that are: RESTful or GraphQL, properly versioned, secure, well-documented, and developer-friendly.',
                category: 'planning',
                tags: ['api', 'design', 'rest', 'graphql'],
                source: 'marketplace',
                author: { name: 'API Experts', url: 'https://skillmarket.cc' },
                version: '2.0.1',
                downloads: 8930,
                rating: 4.6,
                createdAt: '2024-02-01',
                updatedAt: '2024-03-10',
                downloadUrl: 'https://skillmarket.cc/skills/api-designer/download'
            },
            {
                id: 'test-master',
                label: 'Test Master',
                description: 'Generate comprehensive test suites including unit, integration, and e2e tests.',
                prompt: 'You are a testing specialist. Generate tests that cover: happy paths, edge cases, error handling, boundary conditions. Use appropriate testing patterns and mocking strategies.',
                category: 'testing',
                tags: ['testing', 'tdd', 'unit-tests', 'integration'],
                source: 'marketplace',
                author: { name: 'QA Masters', url: 'https://skillmarket.cc' },
                version: '1.5.0',
                downloads: 12300,
                rating: 4.7,
                createdAt: '2024-01-20',
                updatedAt: '2024-03-05',
                downloadUrl: 'https://skillmarket.cc/skills/test-master/download'
            },
            {
                id: 'doc-writer',
                label: 'Documentation Writer',
                description: 'Write clear, concise technical documentation, READMEs, and API docs.',
                prompt: 'You are a technical writer. Create documentation that is: clear and concise, well-structured, includes examples, considers the target audience.',
                category: 'documentation',
                tags: ['docs', 'writing', 'readme', 'api-docs'],
                source: 'marketplace',
                author: { name: 'Tech Writers', url: 'https://skillmarket.cc' },
                version: '1.0.5',
                downloads: 6750,
                rating: 4.5,
                createdAt: '2024-02-15',
                updatedAt: '2024-03-08',
                downloadUrl: 'https://skillmarket.cc/skills/doc-writer/download'
            },
            {
                id: 'security-auditor',
                label: 'Security Auditor',
                description: 'Security audit with OWASP checks, vulnerability scanning, and fix recommendations.',
                prompt: 'You are a security specialist. Perform security audits covering: OWASP Top 10, injection attacks, authentication flaws, sensitive data exposure, security misconfigurations.',
                category: 'coding',
                tags: ['security', 'audit', 'owasp', 'vulnerabilities'],
                source: 'marketplace',
                author: { name: 'Security First', url: 'https://skillmarket.cc' },
                version: '1.1.0',
                downloads: 9870,
                rating: 4.9,
                createdAt: '2024-01-10',
                updatedAt: '2024-03-12',
                downloadUrl: 'https://skillmarket.cc/skills/security-auditor/download'
            },
            {
                id: 'data-analyst',
                label: 'Data Analyst',
                description: 'Analyze datasets, generate insights, and create visualizations.',
                prompt: 'You are a data analyst. Analyze data to find: trends, patterns, anomalies, correlations. Provide insights with supporting evidence.',
                category: 'analysis',
                tags: ['data', 'analysis', 'statistics', 'visualization'],
                source: 'marketplace',
                author: { name: 'Data Pros', url: 'https://skillmarket.cc' },
                version: '1.3.0',
                downloads: 7890,
                rating: 4.4,
                createdAt: '2024-02-05',
                updatedAt: '2024-03-15',
                downloadUrl: 'https://skillmarket.cc/skills/data-analyst/download'
            }
        ];

        // Apply filters
        let filtered = [...mockSkills];

        if (filters.query) {
            const query = filters.query.toLowerCase();
            filtered = filtered.filter(s => 
                s.label.toLowerCase().includes(query) ||
                s.description.toLowerCase().includes(query) ||
                s.tags.some(t => t.toLowerCase().includes(query))
            );
        }

        if (filters.category) {
            filtered = filtered.filter(s => s.category === filters.category);
        }

        if (filters.tags?.length) {
            filtered = filtered.filter(s => 
                filters.tags!.some(t => s.tags.includes(t))
            );
        }

        // Apply sorting
        if (filters.sortBy) {
            switch (filters.sortBy) {
                case 'popular':
                    filtered.sort((a, b) => b.downloads - a.downloads);
                    break;
                case 'newest':
                    filtered.sort((a, b) => 
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    break;
                case 'rating':
                    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                    break;
                case 'name':
                    filtered.sort((a, b) => a.label.localeCompare(b.label));
                    break;
            }
        }

        // Calculate categories
        const categoryCounts = new Map<string, number>();
        mockSkills.forEach(s => {
            categoryCounts.set(s.category, (categoryCounts.get(s.category) || 0) + 1);
        });

        // Calculate tags
        const tagCounts = new Map<string, number>();
        mockSkills.forEach(s => {
            s.tags.forEach(t => {
                tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            });
        });

        return {
            skills: filtered,
            total: filtered.length,
            page: 1,
            pageSize: 50,
            categories: Array.from(categoryCounts.entries()).map(([id, count]) => ({ 
                id: id as any, 
                count 
            })),
            tags: Array.from(tagCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([name, count]) => ({ name, count }))
        };
    }
}
