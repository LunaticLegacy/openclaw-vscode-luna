import * as vscode from 'vscode';
import { t } from '../i18n';
import {
    CUSTOM_AGENT_PRESET_ID,
    AgentPresetOption,
    getAgentPreset,
    getAgentPresets
} from '../config/agentPresets';

/**
 * 解析 Agent ID
 * @param agentArg - Agent 参数（可以是字符串、对象或包含 agent 的对象）
 * @returns Agent ID 或 undefined
 */
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

/**
 * 解析集群 ID
 * @param clusterArg - 集群参数（可以是字符串、对象或包含 cluster 的对象）
 * @returns 集群 ID 或 undefined
 */
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

/**
 * 解析任务 ID
 * @param taskArg - 任务参数（可以是字符串、对象或包含 task 的对象）
 * @returns 任务 ID 或 undefined
 */
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

/**
 * 选择 Agent 预设配置
 * @returns 选中的 Agent 预设配置，或 null/undefined（用户取消）
 */
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
            detail: `${preset.description} ${t('newAgent.preset.recommendedModel')}: ${preset.recommendedModel}`,
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
