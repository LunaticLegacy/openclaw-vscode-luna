import { t } from '../i18n';

export const CUSTOM_AGENT_PRESET_ID = 'custom';

export interface AgentPresetOption {
    id: string;
    defaultName: string;
    label: string;
    badge: string;
    description: string;
    systemPrompt: string;
}

interface AgentPresetDefinition {
    id: string;
    defaultName: string;
    labelKey: string;
    badgeKey: string;
    descriptionKey: string;
    systemPromptKey: string;
}

const AGENT_PRESET_DEFINITIONS: readonly AgentPresetDefinition[] = [
    {
        id: 'algorithm-helper',
        defaultName: 'algorithm-helper',
        labelKey: 'newAgent.preset.algorithmHelper.label',
        badgeKey: 'newAgent.preset.algorithmHelper.badge',
        descriptionKey: 'newAgent.preset.algorithmHelper.description',
        systemPromptKey: 'newAgent.preset.algorithmHelper.systemPrompt'
    },
    {
        id: 'quantative-recorder',
        defaultName: 'quantative-recorder',
        labelKey: 'newAgent.preset.quantativeRecorder.label',
        badgeKey: 'newAgent.preset.quantativeRecorder.badge',
        descriptionKey: 'newAgent.preset.quantativeRecorder.description',
        systemPromptKey: 'newAgent.preset.quantativeRecorder.systemPrompt'
    },
    {
        id: 'code-review-guard',
        defaultName: 'code-review-guard',
        labelKey: 'newAgent.preset.codeReviewGuard.label',
        badgeKey: 'newAgent.preset.codeReviewGuard.badge',
        descriptionKey: 'newAgent.preset.codeReviewGuard.description',
        systemPromptKey: 'newAgent.preset.codeReviewGuard.systemPrompt'
    },
    {
        id: 'bug-hunter',
        defaultName: 'bug-hunter',
        labelKey: 'newAgent.preset.bugHunter.label',
        badgeKey: 'newAgent.preset.bugHunter.badge',
        descriptionKey: 'newAgent.preset.bugHunter.description',
        systemPromptKey: 'newAgent.preset.bugHunter.systemPrompt'
    },
    {
        id: 'refactor-planner',
        defaultName: 'refactor-planner',
        labelKey: 'newAgent.preset.refactorPlanner.label',
        badgeKey: 'newAgent.preset.refactorPlanner.badge',
        descriptionKey: 'newAgent.preset.refactorPlanner.description',
        systemPromptKey: 'newAgent.preset.refactorPlanner.systemPrompt'
    },
    {
        id: 'api-contract-writer',
        defaultName: 'api-contract-writer',
        labelKey: 'newAgent.preset.apiContractWriter.label',
        badgeKey: 'newAgent.preset.apiContractWriter.badge',
        descriptionKey: 'newAgent.preset.apiContractWriter.description',
        systemPromptKey: 'newAgent.preset.apiContractWriter.systemPrompt'
    }
];

export function getAgentPresets(): AgentPresetOption[] {
    return AGENT_PRESET_DEFINITIONS.map(definition => ({
        id: definition.id,
        defaultName: definition.defaultName,
        label: t(definition.labelKey),
        badge: t(definition.badgeKey),
        description: t(definition.descriptionKey),
        systemPrompt: t(definition.systemPromptKey)
    }));
}

export function getAgentPreset(presetId?: string | null): AgentPresetOption | null {
    if (!presetId || presetId === CUSTOM_AGENT_PRESET_ID) {
        return null;
    }

    return getAgentPresets().find(preset => preset.id === presetId) || null;
}
