import type { ClusterMemberProfile, ClusterWorkspaceConfig } from '../services/openclawService';

export interface ClusterWorkModePresetMemberBlueprint {
    id: string;
    title: string;
    identity: string;
    stance: string;
    parentId?: string;
    isCoordinator?: boolean;
    activation?: ClusterMemberProfile['activation'];
}

export interface ClusterWorkModePreset extends ClusterWorkspaceConfig {
    id: string;
    memberBlueprints: ClusterWorkModePresetMemberBlueprint[];
}

export const DEFAULT_CLUSTER_WORK_MODE_PRESET_ID = 'implementation-squad';
export const MAX_CLUSTER_WORK_MODE_ROUNDS = 12;

const CLUSTER_WORK_MODE_PRESETS: ClusterWorkModePreset[] = [
    {
        id: 'implementation-squad',
        presetId: 'implementation-squad',
        collaborationStyle: 'leader-draft',
        deliveryStyle: 'balanced',
        critiqueLevel: 'standard',
        rounds: 2,
        briefing: 'Bias toward implementation-ready plans, concrete changes, and verification steps.',
        memberBlueprints: [
            createPresetBlueprint('lead', 'Delivery Lead', 'Delivery lead', 'Own the merged execution draft, sequencing, and final delivery call.', { isCoordinator: true }),
            createPresetBlueprint('builder', 'Primary Builder', 'Implementation specialist', 'Turn the request into concrete code changes, task slicing, and buildable steps.', { parentId: 'lead' }),
            createPresetBlueprint('verifier', 'Verification Lane', 'Verification specialist', 'Stress validation steps, regression surface, and proof that the change really works.', { parentId: 'lead', activation: { keywords: ['test', 'verify', 'validation', 'regression'] } }),
            createPresetBlueprint('risk', 'Risk Lane', 'Release-risk reviewer', 'Call out rollout risk, hidden assumptions, and dependencies that can break the plan.', { parentId: 'lead', activation: { keywords: ['risk', 'rollout', 'dependency', 'migration'] } })
        ]
    },
    {
        id: 'rapid-brainstorm',
        presetId: 'rapid-brainstorm',
        collaborationStyle: 'round-robin',
        deliveryStyle: 'fast',
        critiqueLevel: 'minimal',
        rounds: 1,
        briefing: 'Prefer breadth first, low ceremony, and fast parallel idea generation.',
        memberBlueprints: [
            createPresetBlueprint('moderator', 'Fast Moderator', 'Fast moderator', 'Keep the swarm moving, trim ceremony, and converge quickly on useful options.', { isCoordinator: true }),
            createPresetBlueprint('divergent', 'Option Generator', 'Divergent explorer', 'Generate wide option space and surface unconventional but plausible directions.'),
            createPresetBlueprint('contrarian', 'Constructive Contrarian', 'Constructive contrarian', 'Challenge obvious paths early and propose sharper alternatives.', { activation: { keywords: ['alternative', 'option', 'idea', 'brainstorm'] } }),
            createPresetBlueprint('synth', 'Pattern Spotter', 'Pattern spotter', 'Cluster raw ideas into reusable themes, tradeoff groups, and next-step buckets.', { parentId: 'moderator' })
        ]
    },
    {
        id: 'architecture-review',
        presetId: 'architecture-review',
        collaborationStyle: 'review-board',
        deliveryStyle: 'deep',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Stress long-term maintainability, boundaries, migration risk, and tradeoffs.',
        memberBlueprints: [
            createPresetBlueprint('chair', 'Review Chair', 'Architecture review chair', 'Hold the final bar for boundary clarity, tradeoffs, and decision quality.', { isCoordinator: true }),
            createPresetBlueprint('boundary', 'Boundary Reviewer', 'Service-boundary reviewer', 'Push on ownership seams, API contracts, and coupling across modules.', { parentId: 'chair', activation: { keywords: ['api', 'boundary', 'contract', 'interface'] } }),
            createPresetBlueprint('migration', 'Migration Reviewer', 'Migration planner', 'Focus on rollout path, compatibility, fallback strategy, and incremental migration.', { parentId: 'chair', activation: { keywords: ['migration', 'rollout', 'compatibility', 'version'] } }),
            createPresetBlueprint('ops', 'Operational Reviewer', 'Operational risk reviewer', 'Evaluate observability, failure handling, recovery, and long-term operational load.', { parentId: 'chair', activation: { keywords: ['ops', 'latency', 'reliability', 'failure', 'recovery'] } })
        ]
    },
    {
        id: 'debug-war-room',
        presetId: 'debug-war-room',
        collaborationStyle: 'leader-draft',
        deliveryStyle: 'balanced',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Prioritize the fastest reproducer, strongest signal, and smallest safe fix.',
        memberBlueprints: [
            createPresetBlueprint('commander', 'Incident Commander', 'Incident commander', 'Keep the investigation disciplined and push toward the smallest safe fix.', { isCoordinator: true }),
            createPresetBlueprint('repro', 'Reproducer', 'Reproduction specialist', 'Isolate the smallest reliable reproducer and call out exact trigger conditions.', { parentId: 'commander', activation: { keywords: ['repro', 'steps', 'trace', 'logs'] } }),
            createPresetBlueprint('rootcause', 'Root Cause Hunter', 'Root-cause analyst', 'Trace the strongest signals back to the underlying fault instead of patching symptoms.', { parentId: 'commander' }),
            createPresetBlueprint('fixguard', 'Fix Guard', 'Fix verifier', 'Check patch blast radius, regression risk, and what must be verified before shipping.', { parentId: 'commander', activation: { keywords: ['fix', 'patch', 'regression', 'verify'] } })
        ]
    },
    {
        id: 'red-team-audit',
        presetId: 'red-team-audit',
        collaborationStyle: 'review-board',
        deliveryStyle: 'deep',
        critiqueLevel: 'aggressive',
        rounds: 3,
        briefing: 'Actively search for failure modes, abuse paths, hidden assumptions, and edge-case breakage.',
        memberBlueprints: [
            createPresetBlueprint('captain', 'Red Team Captain', 'Red-team captain', 'Drive the strongest failure narrative and keep the audit findings sharp.', { isCoordinator: true }),
            createPresetBlueprint('abuse', 'Abuse-Case Analyst', 'Abuse-case analyst', 'Search for misuse, adversarial workflows, and privilege abuse paths.', { parentId: 'captain', activation: { keywords: ['auth', 'permission', 'abuse', 'security'] } }),
            createPresetBlueprint('boundary', 'Trust-Boundary Auditor', 'Trust-boundary auditor', 'Stress assumptions at integration seams, trust boundaries, and handoff points.', { parentId: 'captain' }),
            createPresetBlueprint('edge', 'Edge-Case Breaker', 'Edge-case breaker', 'Hunt rare states, malformed input, and operational edges that collapse the system.', { parentId: 'captain', activation: { keywords: ['edge', 'race', 'timeout', 'invalid', 'overflow'] } })
        ]
    },
    {
        id: 'research-synthesis',
        presetId: 'research-synthesis',
        collaborationStyle: 'debate',
        deliveryStyle: 'deep',
        critiqueLevel: 'standard',
        rounds: 2,
        briefing: 'Collect competing views, reconcile them carefully, and retain uncertainty where evidence is weak.',
        memberBlueprints: [
            createPresetBlueprint('editor', 'Synthesis Editor', 'Synthesis editor', 'Merge competing evidence into one coherent answer without hiding uncertainty.', { isCoordinator: true }),
            createPresetBlueprint('mapper', 'Evidence Mapper', 'Evidence mapper', 'Lay out the strongest factual claims, source shape, and what is actually supported.', { parentId: 'editor' }),
            createPresetBlueprint('skeptic', 'Evidence Skeptic', 'Evidence skeptic', 'Challenge weak evidence, overreach, and claims that lack sufficient backing.', { parentId: 'editor' }),
            createPresetBlueprint('alt', 'Alternative Lens', 'Alternative-hypothesis analyst', 'Preserve viable competing interpretations instead of collapsing too early.', { parentId: 'editor', activation: { keywords: ['uncertain', 'evidence', 'compare', 'tradeoff'] } })
        ]
    },
    {
        id: 'spec-to-build',
        presetId: 'spec-to-build',
        collaborationStyle: 'round-robin',
        deliveryStyle: 'balanced',
        critiqueLevel: 'standard',
        rounds: 2,
        briefing: 'Move from requirements to execution plan, API shape, task slicing, and rollout details.',
        memberBlueprints: [
            createPresetBlueprint('translator', 'Spec Translator', 'Spec translator', 'Translate product intent into crisp technical requirements and decision points.', { isCoordinator: true }),
            createPresetBlueprint('api', 'API Lane', 'API designer', 'Shape external contracts, payloads, validation, and compatibility constraints.', { parentId: 'translator', activation: { keywords: ['api', 'schema', 'contract', 'payload'] } }),
            createPresetBlueprint('execution', 'Execution Lane', 'Implementation planner', 'Slice the build into executable tasks, dependencies, and milestones.', { parentId: 'translator' }),
            createPresetBlueprint('rollout', 'Rollout Lane', 'Rollout planner', 'Define migration order, feature gating, verification, and release sequencing.', { parentId: 'translator', activation: { keywords: ['rollout', 'release', 'migration', 'deploy'] } })
        ]
    },
    {
        id: 'qa-regression',
        presetId: 'qa-regression',
        collaborationStyle: 'review-board',
        deliveryStyle: 'balanced',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Center on user-visible regressions, missing tests, risky state transitions, and coverage gaps.',
        memberBlueprints: [
            createPresetBlueprint('lead', 'Regression Lead', 'Regression lead', 'Own the final regression assessment and missing-coverage call.', { isCoordinator: true }),
            createPresetBlueprint('userpath', 'User-Path Inspector', 'User-path inspector', 'Trace the highest-value user-visible flows and where they can quietly regress.', { parentId: 'lead' }),
            createPresetBlueprint('state', 'State-Machine Skeptic', 'State-transition skeptic', 'Stress brittle state changes, invalid transitions, and hidden lifecycle bugs.', { parentId: 'lead', activation: { keywords: ['state', 'transition', 'lifecycle', 'session'] } }),
            createPresetBlueprint('tests', 'Test Gap Author', 'Test-gap author', 'Call out missing assertions, weak fixtures, and the smallest stable tests to add.', { parentId: 'lead', activation: { keywords: ['test', 'coverage', 'assert', 'fixture'] } })
        ]
    }
];

export function getClusterWorkModePresets(): ClusterWorkModePreset[] {
    return CLUSTER_WORK_MODE_PRESETS.map(cloneClusterWorkModePreset);
}

export function resolveClusterWorkModePreset(
    presetId?: string | null
): ClusterWorkModePreset {
    const normalizedPresetId = normalizePresetId(presetId);
    return cloneClusterWorkModePreset(
        CLUSTER_WORK_MODE_PRESETS.find(preset => preset.id === normalizedPresetId)
        || CLUSTER_WORK_MODE_PRESETS.find(preset => preset.id === DEFAULT_CLUSTER_WORK_MODE_PRESET_ID)!
        || CLUSTER_WORK_MODE_PRESETS[0]
    );
}

export function createDefaultClusterWorkspaceConfig(): ClusterWorkspaceConfig {
    const preset = resolveClusterWorkModePreset(DEFAULT_CLUSTER_WORK_MODE_PRESET_ID);
    return {
        presetId: preset.id,
        collaborationStyle: preset.collaborationStyle,
        deliveryStyle: preset.deliveryStyle,
        critiqueLevel: preset.critiqueLevel,
        rounds: preset.rounds,
        runUntilConditionMet: false,
        stopCondition: '',
        briefing: preset.briefing,
        coordinatorAgentId: undefined,
        memberProfiles: {}
    };
}

export function normalizeClusterWorkspaceConfig(
    config?: Partial<ClusterWorkspaceConfig> | null
): ClusterWorkspaceConfig {
    const preset = resolveClusterWorkModePreset(config?.presetId);
    const briefing = typeof config?.briefing === 'string'
        ? config.briefing.trim()
        : '';
    const stopCondition = normalizeStopCondition(config?.stopCondition);
    const runUntilConditionMet = normalizeRunUntilConditionMet(config?.runUntilConditionMet, stopCondition);

    return {
        presetId: preset.id,
        collaborationStyle: normalizeCollaborationStyle(config?.collaborationStyle, preset.collaborationStyle),
        deliveryStyle: normalizeDeliveryStyle(config?.deliveryStyle, preset.deliveryStyle),
        critiqueLevel: normalizeCritiqueLevel(config?.critiqueLevel, preset.critiqueLevel),
        rounds: normalizeRounds(preset.rounds, config?.rounds),
        runUntilConditionMet,
        stopCondition,
        briefing: briefing || preset.briefing || '',
        coordinatorAgentId: normalizeCoordinatorAgentId(config?.coordinatorAgentId),
        memberProfiles: normalizeMemberProfiles(config?.memberProfiles)
    };
}

function normalizeRunUntilConditionMet(
    value: boolean | undefined,
    stopCondition?: string
): boolean {
    return Boolean(value) && Boolean(stopCondition);
}

function normalizeStopCondition(value?: string | null): string | undefined {
    const normalized = String(value || '').trim();
    return normalized || undefined;
}

function normalizeCoordinatorAgentId(value?: string | null): string | undefined {
    const normalized = String(value || '').trim();
    return normalized || undefined;
}

function normalizeMemberProfiles(
    value?: Record<string, ClusterMemberProfile> | null
): Record<string, ClusterMemberProfile> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const normalized: Record<string, ClusterMemberProfile> = {};
    for (const [agentId, profile] of Object.entries(value)) {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId || !profile || typeof profile !== 'object' || Array.isArray(profile)) {
            continue;
        }

        const identity = typeof profile.identity === 'string' ? profile.identity.trim() : '';
        const stance = typeof profile.stance === 'string' ? profile.stance.trim() : '';
        const parentAgentId = typeof profile.parentAgentId === 'string' ? profile.parentAgentId.trim() : '';
        const activation = normalizeMemberActivation(profile.activation);
        if (!identity && !stance && !parentAgentId && !activation) {
            continue;
        }

        normalized[normalizedAgentId] = {
            ...(identity ? { identity } : {}),
            ...(stance ? { stance } : {}),
            ...(parentAgentId ? { parentAgentId } : {}),
            ...(activation ? { activation } : {})
        };
    }

    return normalized;
}

function normalizeMemberActivation(
    value?: ClusterMemberProfile['activation'] | null
): ClusterMemberProfile['activation'] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const swarmModes = Array.isArray(value.swarmModes)
        ? Array.from(new Set(
            value.swarmModes.filter(
                (mode): mode is 'broadcast' | 'collaborate' => mode === 'broadcast' || mode === 'collaborate'
            )
        ))
        : undefined;
    const keywords = Array.isArray(value.keywords)
        ? Array.from(new Set(
            value.keywords
                .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
                .filter(Boolean)
        ))
        : undefined;

    if ((!swarmModes || swarmModes.length === 0) && (!keywords || keywords.length === 0)) {
        return swarmModes ? { swarmModes: [] } : undefined;
    }

    return {
        ...(swarmModes ? { swarmModes } : {}),
        ...(keywords && keywords.length > 0 ? { keywords } : {})
    };
}

function normalizePresetId(value?: string | null): string {
    const normalized = String(value || '').trim();
    return normalized || DEFAULT_CLUSTER_WORK_MODE_PRESET_ID;
}

function normalizeCollaborationStyle(
    value: ClusterWorkspaceConfig['collaborationStyle'] | undefined,
    fallback: ClusterWorkspaceConfig['collaborationStyle']
): ClusterWorkspaceConfig['collaborationStyle'] {
    switch (value) {
        case 'debate':
        case 'round-robin':
        case 'review-board':
        case 'leader-draft':
            return value;
        default:
            return fallback;
    }
}

function normalizeDeliveryStyle(
    value: ClusterWorkspaceConfig['deliveryStyle'] | undefined,
    fallback: ClusterWorkspaceConfig['deliveryStyle']
): ClusterWorkspaceConfig['deliveryStyle'] {
    switch (value) {
        case 'fast':
        case 'balanced':
        case 'deep':
            return value;
        default:
            return fallback;
    }
}

function normalizeCritiqueLevel(
    value: ClusterWorkspaceConfig['critiqueLevel'] | undefined,
    fallback: ClusterWorkspaceConfig['critiqueLevel']
): ClusterWorkspaceConfig['critiqueLevel'] {
    switch (value) {
        case 'minimal':
        case 'standard':
        case 'aggressive':
            return value;
        default:
            return fallback;
    }
}

function normalizeRounds(fallback: number, value?: number): number {
    if (!Number.isFinite(value)) {
        return Math.max(1, Math.min(MAX_CLUSTER_WORK_MODE_ROUNDS, Math.round(fallback || 1)));
    }

    const normalizedValue = Number(value);
    return Math.max(1, Math.min(MAX_CLUSTER_WORK_MODE_ROUNDS, Math.round(normalizedValue)));
}

function createPresetBlueprint(
    id: string,
    title: string,
    identity: string,
    stance: string,
    options: {
        parentId?: string;
        isCoordinator?: boolean;
        activation?: ClusterMemberProfile['activation'];
    } = {}
): ClusterWorkModePresetMemberBlueprint {
    return {
        id,
        title,
        identity,
        stance,
        ...(options.parentId ? { parentId: options.parentId } : {}),
        ...(options.isCoordinator ? { isCoordinator: true } : {}),
        ...(options.activation ? { activation: options.activation } : {})
    };
}

function cloneClusterWorkModePreset(preset: ClusterWorkModePreset): ClusterWorkModePreset {
    return {
        ...preset,
        memberBlueprints: preset.memberBlueprints.map(blueprint => ({
            ...blueprint,
            activation: blueprint.activation
                ? {
                    ...(blueprint.activation.swarmModes ? { swarmModes: [...blueprint.activation.swarmModes] } : {}),
                    ...(blueprint.activation.keywords ? { keywords: [...blueprint.activation.keywords] } : {})
                }
                : undefined
        }))
    };
}
