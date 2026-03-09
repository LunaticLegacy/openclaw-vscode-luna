import * as vscode from 'vscode';
import { t } from '../i18n';
import {
    CUSTOM_AGENT_PRESET_ID,
    AgentPresetOption,
    getAgentPreset,
    getAgentPresets
} from '../config/agentPresets';

export function resolveAgentId(agentArg: any): string | undefined {
    if (!agentArg) {
        return undefined;
    }

    if (typeof agentArg === 'string') {
        return agentArg;
    }

    if (typeof agentArg.id === 'string') {
        return agentArg.id;
    }

    if (typeof agentArg.agent?.id === 'string') {
        return agentArg.agent.id;
    }

    return undefined;
}

export function resolveClusterId(clusterArg: any): string | undefined {
    if (!clusterArg) {
        return undefined;
    }

    if (typeof clusterArg === 'string') {
        return clusterArg;
    }

    if (typeof clusterArg.id === 'string') {
        return clusterArg.id;
    }

    if (typeof clusterArg.cluster?.id === 'string') {
        return clusterArg.cluster.id;
    }

    return undefined;
}

export function resolveTaskId(taskArg: any): string | undefined {
    if (!taskArg) {
        return undefined;
    }

    if (typeof taskArg === 'string') {
        return taskArg;
    }

    if (typeof taskArg.id === 'string') {
        return taskArg.id;
    }

    if (typeof taskArg.task?.id === 'string') {
        return taskArg.task.id;
    }

    return undefined;
}

export async function pickAgentPreset(): Promise<AgentPresetOption | null | undefined> {
    const items = [
        {
            label: t('newAgent.preset.custom'),
            description: t('newAgent.preset.customDescription'),
            detail: t('newAgent.preset.hint'),
            presetId: CUSTOM_AGENT_PRESET_ID
        },
        ...getAgentPresets().map(preset => ({
            label: preset.label,
            description: preset.defaultName,
            detail: preset.description,
            presetId: preset.id
        }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: t('newAgent.selectPreset')
    });

    if (!selected) {
        return undefined;
    }

    return getAgentPreset(selected.presetId);
}
