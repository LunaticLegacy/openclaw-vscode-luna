import { t } from '../i18n';

export const CUSTOM_AGENT_PRESET_ID = 'custom';

export interface AgentPresetOption {
    id: string;
    defaultName: string;
    label: string;
    badge: string;
    description: string;
    recommendedModel: string;
    failureSignals: string;
    outputStandard: string;
    systemPrompt: string;
}

interface AgentPresetDefinition {
    id: string;
    defaultName: string;
    labelKey: string;
    badgeKey: string;
    descriptionKey: string;
    recommendedModelKey: string;
    failureSignalsKey: string;
    outputStandardKey: string;
    systemPromptKey: string;
}

const AGENT_PRESET_DEFINITIONS: readonly AgentPresetDefinition[] = [
    {
        id: 'algorithm-helper',
        defaultName: 'algorithm-helper',
        labelKey: 'newAgent.preset.algorithmHelper.label',
        badgeKey: 'newAgent.preset.algorithmHelper.badge',
        descriptionKey: 'newAgent.preset.algorithmHelper.description',
        recommendedModelKey: 'newAgent.preset.algorithmHelper.recommendedModel',
        failureSignalsKey: 'newAgent.preset.algorithmHelper.failureSignals',
        outputStandardKey: 'newAgent.preset.algorithmHelper.outputStandard',
        systemPromptKey: 'newAgent.preset.algorithmHelper.systemPrompt'
    },
    {
        id: 'quantative-recorder',
        defaultName: 'quantative-recorder',
        labelKey: 'newAgent.preset.quantativeRecorder.label',
        badgeKey: 'newAgent.preset.quantativeRecorder.badge',
        descriptionKey: 'newAgent.preset.quantativeRecorder.description',
        recommendedModelKey: 'newAgent.preset.quantativeRecorder.recommendedModel',
        failureSignalsKey: 'newAgent.preset.quantativeRecorder.failureSignals',
        outputStandardKey: 'newAgent.preset.quantativeRecorder.outputStandard',
        systemPromptKey: 'newAgent.preset.quantativeRecorder.systemPrompt'
    },
    {
        id: 'code-review-guard',
        defaultName: 'code-review-guard',
        labelKey: 'newAgent.preset.codeReviewGuard.label',
        badgeKey: 'newAgent.preset.codeReviewGuard.badge',
        descriptionKey: 'newAgent.preset.codeReviewGuard.description',
        recommendedModelKey: 'newAgent.preset.codeReviewGuard.recommendedModel',
        failureSignalsKey: 'newAgent.preset.codeReviewGuard.failureSignals',
        outputStandardKey: 'newAgent.preset.codeReviewGuard.outputStandard',
        systemPromptKey: 'newAgent.preset.codeReviewGuard.systemPrompt'
    },
    {
        id: 'bug-hunter',
        defaultName: 'bug-hunter',
        labelKey: 'newAgent.preset.bugHunter.label',
        badgeKey: 'newAgent.preset.bugHunter.badge',
        descriptionKey: 'newAgent.preset.bugHunter.description',
        recommendedModelKey: 'newAgent.preset.bugHunter.recommendedModel',
        failureSignalsKey: 'newAgent.preset.bugHunter.failureSignals',
        outputStandardKey: 'newAgent.preset.bugHunter.outputStandard',
        systemPromptKey: 'newAgent.preset.bugHunter.systemPrompt'
    },
    {
        id: 'refactor-planner',
        defaultName: 'refactor-planner',
        labelKey: 'newAgent.preset.refactorPlanner.label',
        badgeKey: 'newAgent.preset.refactorPlanner.badge',
        descriptionKey: 'newAgent.preset.refactorPlanner.description',
        recommendedModelKey: 'newAgent.preset.refactorPlanner.recommendedModel',
        failureSignalsKey: 'newAgent.preset.refactorPlanner.failureSignals',
        outputStandardKey: 'newAgent.preset.refactorPlanner.outputStandard',
        systemPromptKey: 'newAgent.preset.refactorPlanner.systemPrompt'
    },
    {
        id: 'api-contract-writer',
        defaultName: 'api-contract-writer',
        labelKey: 'newAgent.preset.apiContractWriter.label',
        badgeKey: 'newAgent.preset.apiContractWriter.badge',
        descriptionKey: 'newAgent.preset.apiContractWriter.description',
        recommendedModelKey: 'newAgent.preset.apiContractWriter.recommendedModel',
        failureSignalsKey: 'newAgent.preset.apiContractWriter.failureSignals',
        outputStandardKey: 'newAgent.preset.apiContractWriter.outputStandard',
        systemPromptKey: 'newAgent.preset.apiContractWriter.systemPrompt'
    },
    {
        id: 'test-author',
        defaultName: 'test-author',
        labelKey: 'newAgent.preset.testAuthor.label',
        badgeKey: 'newAgent.preset.testAuthor.badge',
        descriptionKey: 'newAgent.preset.testAuthor.description',
        recommendedModelKey: 'newAgent.preset.testAuthor.recommendedModel',
        failureSignalsKey: 'newAgent.preset.testAuthor.failureSignals',
        outputStandardKey: 'newAgent.preset.testAuthor.outputStandard',
        systemPromptKey: 'newAgent.preset.testAuthor.systemPrompt'
    },
    {
        id: 'docs-editor',
        defaultName: 'docs-editor',
        labelKey: 'newAgent.preset.docsEditor.label',
        badgeKey: 'newAgent.preset.docsEditor.badge',
        descriptionKey: 'newAgent.preset.docsEditor.description',
        recommendedModelKey: 'newAgent.preset.docsEditor.recommendedModel',
        failureSignalsKey: 'newAgent.preset.docsEditor.failureSignals',
        outputStandardKey: 'newAgent.preset.docsEditor.outputStandard',
        systemPromptKey: 'newAgent.preset.docsEditor.systemPrompt'
    }
];

export function getAgentPresets(): AgentPresetOption[] {
    return AGENT_PRESET_DEFINITIONS.map(definition => ({
        id: definition.id,
        defaultName: definition.defaultName,
        label: t(definition.labelKey),
        badge: t(definition.badgeKey),
        description: t(definition.descriptionKey),
        recommendedModel: t(definition.recommendedModelKey),
        failureSignals: t(definition.failureSignalsKey),
        outputStandard: t(definition.outputStandardKey),
        systemPrompt: t(definition.systemPromptKey)
    }));
}

export function getAgentPreset(presetId?: string | null): AgentPresetOption | null {
    if (!presetId || presetId === CUSTOM_AGENT_PRESET_ID) {
        return null;
    }

    return getAgentPresets().find(preset => preset.id === presetId) || null;
}
