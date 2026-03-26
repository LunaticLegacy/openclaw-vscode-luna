export interface AiSkillDefinition {
    id: string;
    label: string;
    description: string;
    prompt: string;
    downloadUrl: string;
    linkLabel?: string;
    linkDescription?: string;
    sourceLabel?: string;
}

/**
 * AI技能市场URL
 */
export const SKILL_MARKET_URL = 'https://skillsllm.com/';

const AI_SKILLS: AiSkillDefinition[] = [
    {
        id: 'code-review',
        label: 'Code Review',
        description: 'Find high-signal bugs, regressions, missing tests, and user-visible risks first.',
        prompt: 'Review code with a findings-first mindset. Prioritize correctness, regressions, security, and missing tests over style.',
        downloadUrl: SKILL_MARKET_URL,
        linkLabel: 'Browse Skill Hubs',
        linkDescription: 'Open a public skill hub catalog to discover and import more skills.',
        sourceLabel: 'Skill Hub'
    },
    {
        id: 'debugging',
        label: 'Debugging',
        description: 'Converge on the fastest reproducer, strongest signal, and smallest safe fix.',
        prompt: 'Run a compact debug loop: restate the symptom, rank hypotheses, pick one high-signal probe, and avoid broad rewrites before verification.',
        downloadUrl: SKILL_MARKET_URL,
        linkLabel: 'Browse Skill Hubs',
        linkDescription: 'Open a public skill hub catalog to discover and import more skills.',
        sourceLabel: 'Skill Hub'
    },
    {
        id: 'refactor-planning',
        label: 'Refactor Planning',
        description: 'Plan staged, reversible refactors with rollback and verification gates.',
        prompt: 'Favor small, reversible phases. Include dependency impact, rollback points, and verification gates for each stage.',
        downloadUrl: SKILL_MARKET_URL,
        linkLabel: 'Browse Skill Hubs',
        linkDescription: 'Open a public skill hub catalog to discover and import more skills.',
        sourceLabel: 'Skill Hub'
    },
    {
        id: 'api-design',
        label: 'API Design',
        description: 'Design contracts with explicit schema, examples, compatibility, and error models.',
        prompt: 'Keep request and response schemas, examples, authentication, versioning, and error models internally consistent. Call out breaking changes explicitly.',
        downloadUrl: SKILL_MARKET_URL,
        linkLabel: 'Browse Skill Hubs',
        linkDescription: 'Open a public skill hub catalog to discover and import more skills.',
        sourceLabel: 'Skill Hub'
    },
    {
        id: 'test-authoring',
        label: 'Test Authoring',
        description: 'Add focused tests that cover the real behavioral risk without brittle noise.',
        prompt: 'Write the smallest stable tests that cover the intended behavior and key edge cases. Prefer risk coverage over raw coverage count.',
        downloadUrl: SKILL_MARKET_URL,
        linkLabel: 'Browse Skill Hubs',
        linkDescription: 'Open a public skill hub catalog to discover and import more skills.',
        sourceLabel: 'Skill Hub'
    }
];

/**
 * 获取所有AI技能定义列表
 * @returns AI技能定义数组的深拷贝
 */
export function getAiSkills(): AiSkillDefinition[] {
    return AI_SKILLS.map((skill: any) => ({ ...skill }));
}

/**
 * 规范化启用的技能列表，过滤无效和重复的技能ID
 * @param skills - 原始技能列表
 * @returns 有效的、去重的技能ID数组
 */
export function normalizeEnabledSkills(skills: unknown): string[] {
    if (!Array.isArray(skills)) {
        return [];
    }

    const validIds = new Set(AI_SKILLS.map((skill: any) => skill.id));
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of skills) {
        const normalized = String(item || '').trim();
        if (!normalized || !validIds.has(normalized) || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

/**
 * 根据启用的技能构建技能提示词附录
 * @param enabledSkills - 启用的技能列表
 * @returns 格式化的技能提示词附录字符串
 */
export function buildSkillPromptAppendix(enabledSkills: unknown): string {
    const normalizedSkills = normalizeEnabledSkills(enabledSkills);
    if (normalizedSkills.length === 0) {
        return '';
    }

    const skillPrompts = normalizedSkills
        .map((skillId: any) => AI_SKILLS.find((skill: any) => skill.id === skillId))
        .filter((skill: any): skill is AiSkillDefinition => Boolean(skill))
        .map((skill: any) => `- ${skill.label}: ${skill.prompt}`);

    if (skillPrompts.length === 0) {
        return '';
    }

    return [
        '',
        'Enabled AI skills:',
        ...skillPrompts
    ].join('\n');
}
