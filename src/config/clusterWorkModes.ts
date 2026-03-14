import type { ClusterMemberProfile, ClusterWorkspaceConfig } from '../services/openclawService';

export interface ClusterWorkModePreset extends ClusterWorkspaceConfig {
    id: string;
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
        briefing: 'Bias toward implementation-ready plans, concrete changes, and verification steps.'
    },
    {
        id: 'rapid-brainstorm',
        presetId: 'rapid-brainstorm',
        collaborationStyle: 'round-robin',
        deliveryStyle: 'fast',
        critiqueLevel: 'minimal',
        rounds: 1,
        briefing: 'Prefer breadth first, low ceremony, and fast parallel idea generation.'
    },
    {
        id: 'architecture-review',
        presetId: 'architecture-review',
        collaborationStyle: 'review-board',
        deliveryStyle: 'deep',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Stress long-term maintainability, boundaries, migration risk, and tradeoffs.'
    },
    {
        id: 'debug-war-room',
        presetId: 'debug-war-room',
        collaborationStyle: 'leader-draft',
        deliveryStyle: 'balanced',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Prioritize the fastest reproducer, strongest signal, and smallest safe fix.'
    },
    {
        id: 'red-team-audit',
        presetId: 'red-team-audit',
        collaborationStyle: 'review-board',
        deliveryStyle: 'deep',
        critiqueLevel: 'aggressive',
        rounds: 3,
        briefing: 'Actively search for failure modes, abuse paths, hidden assumptions, and edge-case breakage.'
    },
    {
        id: 'research-synthesis',
        presetId: 'research-synthesis',
        collaborationStyle: 'debate',
        deliveryStyle: 'deep',
        critiqueLevel: 'standard',
        rounds: 2,
        briefing: 'Collect competing views, reconcile them carefully, and retain uncertainty where evidence is weak.'
    },
    {
        id: 'spec-to-build',
        presetId: 'spec-to-build',
        collaborationStyle: 'round-robin',
        deliveryStyle: 'balanced',
        critiqueLevel: 'standard',
        rounds: 2,
        briefing: 'Move from requirements to execution plan, API shape, task slicing, and rollout details.'
    },
    {
        id: 'qa-regression',
        presetId: 'qa-regression',
        collaborationStyle: 'review-board',
        deliveryStyle: 'balanced',
        critiqueLevel: 'aggressive',
        rounds: 2,
        briefing: 'Center on user-visible regressions, missing tests, risky state transitions, and coverage gaps.'
    }
];

export function getClusterWorkModePresets(): ClusterWorkModePreset[] {
    return CLUSTER_WORK_MODE_PRESETS.map(preset => ({ ...preset }));
}

export function resolveClusterWorkModePreset(
    presetId?: string | null
): ClusterWorkModePreset {
    const normalizedPresetId = normalizePresetId(presetId);
    return CLUSTER_WORK_MODE_PRESETS.find(preset => preset.id === normalizedPresetId)
        || CLUSTER_WORK_MODE_PRESETS.find(preset => preset.id === DEFAULT_CLUSTER_WORK_MODE_PRESET_ID)!
        || CLUSTER_WORK_MODE_PRESETS[0];
}

export function createDefaultClusterWorkspaceConfig(): ClusterWorkspaceConfig {
    const preset = resolveClusterWorkModePreset(DEFAULT_CLUSTER_WORK_MODE_PRESET_ID);
    return {
        presetId: preset.id,
        collaborationStyle: preset.collaborationStyle,
        deliveryStyle: preset.deliveryStyle,
        critiqueLevel: preset.critiqueLevel,
        rounds: preset.rounds,
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

    return {
        presetId: preset.id,
        collaborationStyle: normalizeCollaborationStyle(config?.collaborationStyle, preset.collaborationStyle),
        deliveryStyle: normalizeDeliveryStyle(config?.deliveryStyle, preset.deliveryStyle),
        critiqueLevel: normalizeCritiqueLevel(config?.critiqueLevel, preset.critiqueLevel),
        rounds: normalizeRounds(preset.rounds, config?.rounds),
        briefing: briefing || preset.briefing || '',
        coordinatorAgentId: normalizeCoordinatorAgentId(config?.coordinatorAgentId),
        memberProfiles: normalizeMemberProfiles(config?.memberProfiles)
    };
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
        const activation = normalizeMemberActivation(profile.activation);
        if (!identity && !stance && !activation) {
            continue;
        }

        normalized[normalizedAgentId] = {
            ...(identity ? { identity } : {}),
            ...(stance ? { stance } : {}),
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
