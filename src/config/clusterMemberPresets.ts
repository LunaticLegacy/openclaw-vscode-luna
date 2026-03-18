import type { ClusterWorkspaceConfig } from '../services/openclawService';

export interface ClusterMemberAgentBlueprint {
    /** 智能体标识（在集群中唯一） */
    id: string;
    /** 显示名称模板 */
    nameTemplate: string;
    /** 使用的智能体预设ID */
    presetId: string;
    /** 模型名称（可选，覆盖预设默认值） */
    model?: string;
    /** 是否为协调者 */
    isCoordinator?: boolean;
    /** 父级智能体ID（用于层级结构） */
    parentId?: string;
    /** 系统提示词追加内容 */
    systemPromptAppend?: string;
    /** 激活条件 */
    activation?: {
        keywords?: string[];
        swarmModes?: ('broadcast' | 'collaborate')[];
    };
}

export interface ClusterMemberPreset {
    /** 预设ID */
    id: string;
    /** 集群名称模板 */
    nameTemplate: string;
    /** 集群描述 */
    description: string;
    /** 分类标签 */
    tags: string[];
    /** 工作模式配置（部分或全部） */
    workspaceConfig: Partial<ClusterWorkspaceConfig> & {
        /** 强制使用的工作模式预设ID */
        presetId: string;
    };
    /** 成员智能体蓝图列表 */
    memberBlueprints: ClusterMemberAgentBlueprint[];
    /** 推荐的额外技能（可选） */
    recommendedSkills?: string[];
    /** 创建后的引导消息模板 */
    onboardingMessageTemplate?: string;
}

/**
 * 默认集群成员预设ID
 */
export const DEFAULT_CLUSTER_MEMBER_PRESET_ID = 'implementation-squad';

const CLUSTER_MEMBER_PRESETS: ClusterMemberPreset[] = [
    {
        id: 'implementation-squad',
        nameTemplate: '实施小队 - {{timestamp}}',
        description: '专注于代码实现和交付的敏捷团队。包含交付负责人、主要构建者、验证专家和风险评估员。',
        tags: ['开发', '实现', '代码'],
        workspaceConfig: {
            presetId: 'implementation-squad',
            collaborationStyle: 'leader-draft',
            deliveryStyle: 'balanced',
            critiqueLevel: 'standard',
            rounds: 2,
            briefing: 'Bias toward implementation-ready plans, concrete changes, and verification steps.'
        },
        memberBlueprints: [
            {
                id: 'lead',
                nameTemplate: '交付负责人',
                presetId: 'code-review-guard',
                isCoordinator: true,
                systemPromptAppend: '你是交付负责人，负责统筹整个实施过程，确保交付质量和进度。'
            },
            {
                id: 'builder',
                nameTemplate: '主要构建者',
                presetId: 'refactor-planner',
                parentId: 'lead',
                systemPromptAppend: '你是主要构建者，负责将需求转化为具体的代码实现。'
            },
            {
                id: 'verifier',
                nameTemplate: '验证专家',
                presetId: 'test-author',
                parentId: 'lead',
                activation: { keywords: ['test', 'verify', 'validation', 'regression'] },
                systemPromptAppend: '你是验证专家，专注于测试覆盖、回归验证和质量保证。'
            },
            {
                id: 'risk',
                nameTemplate: '风险评估员',
                presetId: 'bug-hunter',
                parentId: 'lead',
                activation: { keywords: ['risk', 'rollout', 'dependency', 'migration'] },
                systemPromptAppend: '你是风险评估员，负责识别发布风险、隐藏假设和潜在的破坏性变更。'
            }
        ],
        onboardingMessageTemplate: '实施小队已组建完成！这个团队专注于将需求快速转化为高质量的代码实现。'
    },
    {
        id: 'code-review-board',
        nameTemplate: '代码评审委员会 - {{timestamp}}',
        description: '专业的代码审查团队，包含架构视角、边界审查、迁移规划和运维风险评估。',
        tags: ['评审', '架构', '质量'],
        workspaceConfig: {
            presetId: 'architecture-review',
            collaborationStyle: 'review-board',
            deliveryStyle: 'deep',
            critiqueLevel: 'aggressive',
            rounds: 2,
            briefing: 'Stress long-term maintainability, boundaries, migration risk, and tradeoffs.'
        },
        memberBlueprints: [
            {
                id: 'chair',
                nameTemplate: '评审主席',
                presetId: 'code-review-guard',
                isCoordinator: true,
                systemPromptAppend: '你是评审主席，负责把控代码质量的最后防线，确保边界清晰、权衡合理、决策质量高。'
            },
            {
                id: 'boundary',
                nameTemplate: '边界审查员',
                presetId: 'api-contract-writer',
                parentId: 'chair',
                activation: { keywords: ['api', 'boundary', 'contract', 'interface'] },
                systemPromptAppend: '你是边界审查员，负责审视模块间的所有权边界、API契约和耦合关系。'
            },
            {
                id: 'migration',
                nameTemplate: '迁移规划师',
                presetId: 'refactor-planner',
                parentId: 'chair',
                activation: { keywords: ['migration', 'rollout', 'compatibility', 'version'] },
                systemPromptAppend: '你是迁移规划师，专注于发布路径、兼容性策略、回滚方案和增量迁移。'
            },
            {
                id: 'ops',
                nameTemplate: '运维风险评估员',
                presetId: 'bug-hunter',
                parentId: 'chair',
                activation: { keywords: ['ops', 'latency', 'reliability', 'failure', 'recovery'] },
                systemPromptAppend: '你是运维风险评估员，评估可观测性、故障处理、恢复能力和长期运维负担。'
            }
        ],
        onboardingMessageTemplate: '代码评审委员会已成立！这个团队将从架构、边界、迁移和运维多个维度深度审查代码。'
    },
    {
        id: 'debug-task-force',
        nameTemplate: '调试特遣队 - {{timestamp}}',
        description: '快速响应的调试团队，专注于快速定位问题、复现bug和实施最小安全修复。',
        tags: ['调试', '问题排查', '紧急'],
        workspaceConfig: {
            presetId: 'debug-war-room',
            collaborationStyle: 'leader-draft',
            deliveryStyle: 'balanced',
            critiqueLevel: 'aggressive',
            rounds: 2,
            briefing: 'Prioritize the fastest reproducer, strongest signal, and smallest safe fix.'
        },
        memberBlueprints: [
            {
                id: 'commander',
                nameTemplate: '事件指挥官',
                presetId: 'bug-hunter',
                isCoordinator: true,
                systemPromptAppend: '你是事件指挥官，保持调查纪律，推动找到最小安全修复方案。'
            },
            {
                id: 'repro',
                nameTemplate: '复现专家',
                presetId: 'bug-hunter',
                parentId: 'commander',
                activation: { keywords: ['repro', 'steps', 'trace', 'logs'] },
                systemPromptAppend: '你是复现专家，负责隔离最小可靠复现步骤，精确定位触发条件。'
            },
            {
                id: 'rootcause',
                nameTemplate: '根因分析师',
                presetId: 'algorithm-helper',
                parentId: 'commander',
                systemPromptAppend: '你是根因分析师，追踪最强信号找到底层故障原因，而非表面症状。'
            },
            {
                id: 'fixguard',
                nameTemplate: '修复验证员',
                presetId: 'test-author',
                parentId: 'commander',
                activation: { keywords: ['fix', 'patch', 'regression', 'verify'] },
                systemPromptAppend: '你是修复验证员，检查补丁影响范围、回归风险，以及发布前必须验证的内容。'
            }
        ],
        onboardingMessageTemplate: '调试特遣队已集结！专注于最快复现、最强信号定位和最小安全修复。'
    },
    {
        id: 'api-design-studio',
        nameTemplate: 'API设计工作室 - {{timestamp}}',
        description: '专业的API设计团队，从需求到契约、实现规划到发布策略的全流程设计。',
        tags: ['API', '设计', '契约'],
        workspaceConfig: {
            presetId: 'spec-to-build',
            collaborationStyle: 'round-robin',
            deliveryStyle: 'balanced',
            critiqueLevel: 'standard',
            rounds: 2,
            briefing: 'Move from requirements to execution plan, API shape, task slicing, and rollout details.'
        },
        memberBlueprints: [
            {
                id: 'translator',
                nameTemplate: '需求翻译官',
                presetId: 'api-contract-writer',
                isCoordinator: true,
                systemPromptAppend: '你是需求翻译官，将产品意图转化为清晰的技术需求和决策点。'
            },
            {
                id: 'api',
                nameTemplate: 'API设计师',
                presetId: 'api-contract-writer',
                parentId: 'translator',
                activation: { keywords: ['api', 'schema', 'contract', 'payload'] },
                systemPromptAppend: '你是API设计师，负责设计外部契约、载荷结构、验证规则和兼容性约束。'
            },
            {
                id: 'execution',
                nameTemplate: '实现规划师',
                presetId: 'refactor-planner',
                parentId: 'translator',
                systemPromptAppend: '你是实现规划师，将设计切分为可执行的任务、依赖和里程碑。'
            },
            {
                id: 'rollout',
                nameTemplate: '发布策略师',
                presetId: 'docs-editor',
                parentId: 'translator',
                activation: { keywords: ['rollout', 'release', 'migration', 'deploy'] },
                systemPromptAppend: '你是发布策略师，定义迁移顺序、特性开关、验证方案和发布序列。'
            }
        ],
        onboardingMessageTemplate: 'API设计工作室已启动！团队将从需求到实现、从契约到发布的全流程设计API。'
    },
    {
        id: 'quality-guardians',
        nameTemplate: '质量守护者 - {{timestamp}}',
        description: '专注于质量保证的团队，关注用户可见回归、缺失测试和高风险状态转换。',
        tags: ['质量', '测试', '回归'],
        workspaceConfig: {
            presetId: 'qa-regression',
            collaborationStyle: 'review-board',
            deliveryStyle: 'balanced',
            critiqueLevel: 'aggressive',
            rounds: 2,
            briefing: 'Center on user-visible regressions, missing tests, risky state transitions, and coverage gaps.'
        },
        memberBlueprints: [
            {
                id: 'lead',
                nameTemplate: '质量负责人',
                presetId: 'test-author',
                isCoordinator: true,
                systemPromptAppend: '你是质量负责人，负责最终的回归评估和缺失覆盖判定。'
            },
            {
                id: 'userpath',
                nameTemplate: '用户路径审查员',
                presetId: 'test-author',
                parentId: 'lead',
                systemPromptAppend: '你是用户路径审查员，追踪最高价值用户可见流程和潜在回归点。'
            },
            {
                id: 'state',
                nameTemplate: '状态机怀疑者',
                presetId: 'algorithm-helper',
                parentId: 'lead',
                activation: { keywords: ['state', 'transition', 'lifecycle', 'session'] },
                systemPromptAppend: '你是状态机怀疑者，重点关注脆弱的状态变更、无效转换和隐藏的生命周期bug。'
            },
            {
                id: 'tests',
                nameTemplate: '测试缺口作者',
                presetId: 'test-author',
                parentId: 'lead',
                activation: { keywords: ['test', 'coverage', 'assert', 'fixture'] },
                systemPromptAppend: '你是测试缺口作者，指出缺失的断言、脆弱的夹具，以及应添加的最小稳定测试。'
            }
        ],
        onboardingMessageTemplate: '质量守护者团队已就位！专注于用户可见回归、状态转换风险和测试覆盖缺口。'
    },
    {
        id: 'innovation-lab',
        nameTemplate: '创新实验室 - {{timestamp}}',
        description: '快速头脑风暴团队，追求广度优先、低仪式感的并行创意生成。',
        tags: ['创新', '头脑风暴', '探索'],
        workspaceConfig: {
            presetId: 'rapid-brainstorm',
            collaborationStyle: 'round-robin',
            deliveryStyle: 'fast',
            critiqueLevel: 'minimal',
            rounds: 1,
            briefing: 'Prefer breadth first, low ceremony, and fast parallel idea generation.'
        },
        memberBlueprints: [
            {
                id: 'moderator',
                nameTemplate: '快速主持人',
                presetId: 'docs-editor',
                isCoordinator: true,
                systemPromptAppend: '你是快速主持人，保持团队高效运转，减少仪式，快速收敛到有用选项。'
            },
            {
                id: 'divergent',
                nameTemplate: '创意生成器',
                presetId: 'algorithm-helper',
                systemPromptAppend: '你是创意生成器，产生广泛的选择空间，提出非常规但合理的新方向。'
            },
            {
                id: 'contrarian',
                nameTemplate: '建设性反对者',
                presetId: 'code-review-guard',
                activation: { keywords: ['alternative', 'option', 'idea', 'brainstorm'] },
                systemPromptAppend: '你是建设性反对者，尽早挑战显而易见的方案，提出更尖锐的替代选项。'
            },
            {
                id: 'synth',
                nameTemplate: '模式发现者',
                presetId: 'algorithm-helper',
                parentId: 'moderator',
                systemPromptAppend: '你是模式发现者，将原始想法聚类为可复用的主题、权衡组和下一步分类。'
            }
        ],
        onboardingMessageTemplate: '创新实验室已开启！头脑风暴模式，追求广度优先、低仪式感的并行创意生成。'
    },
    {
        id: 'red-team-audit',
        nameTemplate: '红队审计组 - {{timestamp}}',
        description: '主动寻找故障模式、滥用路径、隐藏假设和边缘情况破坏的安全审计团队。',
        tags: ['安全', '审计', '红队'],
        workspaceConfig: {
            presetId: 'red-team-audit',
            collaborationStyle: 'review-board',
            deliveryStyle: 'deep',
            critiqueLevel: 'aggressive',
            rounds: 3,
            briefing: 'Actively search for failure modes, abuse paths, hidden assumptions, and edge-case breakage.'
        },
        memberBlueprints: [
            {
                id: 'captain',
                nameTemplate: '红队队长',
                presetId: 'bug-hunter',
                isCoordinator: true,
                systemPromptAppend: '你是红队队长，驱动最强的故障叙事，保持审计发现的尖锐性。'
            },
            {
                id: 'abuse',
                nameTemplate: '滥用场景分析师',
                presetId: 'bug-hunter',
                parentId: 'captain',
                activation: { keywords: ['auth', 'permission', 'abuse', 'security'] },
                systemPromptAppend: '你是滥用场景分析师，寻找误用、对抗性工作流和权限滥用路径。'
            },
            {
                id: 'boundary',
                nameTemplate: '信任边界审计员',
                presetId: 'api-contract-writer',
                parentId: 'captain',
                systemPromptAppend: '你是信任边界审计员，审视集成接缝、信任边界和交接点的假设。'
            },
            {
                id: 'edge',
                nameTemplate: '边缘情况破坏者',
                presetId: 'algorithm-helper',
                parentId: 'captain',
                activation: { keywords: ['edge', 'race', 'timeout', 'invalid', 'overflow'] },
                systemPromptAppend: '你是边缘情况破坏者，追踪罕见状态、畸形输入和导致系统崩溃的运维边缘。'
            }
        ],
        onboardingMessageTemplate: '红队审计组已组建！主动寻找故障模式、滥用路径、隐藏假设和边缘情况破坏。'
    },
    {
        id: 'research-synthesis',
        nameTemplate: '研究综合组 - {{timestamp}}',
        description: '收集竞争性观点、仔细调和、在证据薄弱处保留不确定性的研究综合团队。',
        tags: ['研究', '综合', '分析'],
        workspaceConfig: {
            presetId: 'research-synthesis',
            collaborationStyle: 'debate',
            deliveryStyle: 'deep',
            critiqueLevel: 'standard',
            rounds: 2,
            briefing: 'Collect competing views, reconcile them carefully, and retain uncertainty where evidence is weak.'
        },
        memberBlueprints: [
            {
                id: 'editor',
                nameTemplate: '综合编辑',
                presetId: 'docs-editor',
                isCoordinator: true,
                systemPromptAppend: '你是综合编辑，将竞争性证据融合为一个连贯答案，不隐藏不确定性。'
            },
            {
                id: 'mapper',
                nameTemplate: '证据制图员',
                presetId: 'docs-editor',
                parentId: 'editor',
                systemPromptAppend: '你是证据制图员，布局最强的事实主张、来源形态和实际支持的内容。'
            },
            {
                id: 'skeptic',
                nameTemplate: '证据怀疑者',
                presetId: 'code-review-guard',
                parentId: 'editor',
                systemPromptAppend: '你是证据怀疑者，挑战薄弱证据、过度延伸和缺乏足够支持的断言。'
            },
            {
                id: 'alt',
                nameTemplate: '替代假设分析师',
                presetId: 'algorithm-helper',
                parentId: 'editor',
                activation: { keywords: ['uncertain', 'evidence', 'compare', 'tradeoff'] },
                systemPromptAppend: '你是替代假设分析师，保留可行的竞争性解释，避免过早收敛。'
            }
        ],
        onboardingMessageTemplate: '研究综合组已组建！收集竞争性观点、仔细调和、在证据薄弱处保留不确定性。'
    }
];

/**
 * 获取所有集群成员预设列表
 * @returns 集群成员预设数组的深拷贝
 */
export function getClusterMemberPresets(): ClusterMemberPreset[] {
    return CLUSTER_MEMBER_PRESETS.map(cloneClusterMemberPreset);
}

/**
 * 根据预设ID获取集群成员预设
 * @param presetId - 预设标识符
 * @returns 集群成员预设，如果不存在则返回 null
 */
export function getClusterMemberPreset(presetId?: string | null): ClusterMemberPreset | null {
    if (!presetId) {
        return null;
    }
    const preset = CLUSTER_MEMBER_PRESETS.find(p => p.id === presetId);
    return preset ? cloneClusterMemberPreset(preset) : null;
}

/**
 * 解析集群成员预设，如指定ID不存在则返回默认预设
 * @param presetId - 预设标识符
 * @returns 集群成员预设
 */
export function resolveClusterMemberPreset(presetId?: string | null): ClusterMemberPreset {
    return getClusterMemberPreset(presetId) 
        || getClusterMemberPreset(DEFAULT_CLUSTER_MEMBER_PRESET_ID)
        || cloneClusterMemberPreset(CLUSTER_MEMBER_PRESETS[0]);
}

/**
 * 根据模板构建集群名称
 * @param template - 名称模板，支持 {{timestamp}} 等占位符
 * @param context - 可选的上下文变量
 * @returns 构建后的集群名称
 */
export function buildClusterNameFromTemplate(template: string, context?: Record<string, string>): string {
    const timestamp = new Date().toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let result = template.replace(/\{\{\s*timestamp\s*\}\}/g, timestamp);
    
    if (context) {
        for (const [key, value] of Object.entries(context)) {
            result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
        }
    }
    
    return result;
}

/**
 * 根据模板构建智能体名称
 * @param template - 名称模板，支持 {{clusterName}} 和 {{index}} 占位符
 * @param clusterName - 集群名称
 * @param index - 成员索引
 * @returns 构建后的智能体名称
 */
export function buildAgentNameFromTemplate(template: string, clusterName: string, index: number): string {
    return template
        .replace(/\{\{\s*clusterName\s*\}\}/g, clusterName)
        .replace(/\{\{\s*index\s*\}\}/g, String(index + 1));
}

function cloneClusterMemberPreset(preset: ClusterMemberPreset): ClusterMemberPreset {
    return {
        ...preset,
        workspaceConfig: { ...preset.workspaceConfig },
        memberBlueprints: preset.memberBlueprints.map(blueprint => ({
            ...blueprint,
            activation: blueprint.activation
                ? {
                    ...(blueprint.activation.swarmModes ? { swarmModes: [...blueprint.activation.swarmModes] } : {}),
                    ...(blueprint.activation.keywords ? { keywords: [...blueprint.activation.keywords] } : {})
                }
                : undefined
        })),
        tags: [...preset.tags],
        recommendedSkills: preset.recommendedSkills ? [...preset.recommendedSkills] : undefined
    };
}
