import type { ClusterWorkspaceConfig } from '../services/openclawService';
import {
    loadSwarmPresets,
    type SwarmPreset,
    type SwarmPresetMemberBlueprint
} from '../presets/loader';

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
    /** 成员画像 */
    profile?: {
        identity?: string;
        stance?: string;
        presetIdentityId?: string;
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

/**
 * 获取所有集群成员预设列表
 * @returns 集群成员预设数组的深拷贝
 */
export async function getClusterMemberPresets(extensionPath: string): Promise<ClusterMemberPreset[]> {
    const presets = await loadSwarmPresets(extensionPath);
    return presets.map(cloneClusterMemberPreset);
}

/**
 * 根据预设ID获取集群成员预设
 * @param presetId - 预设标识符
 * @returns 集群成员预设，如果不存在则返回 null
 */
export async function getClusterMemberPreset(
    extensionPath: string,
    presetId?: string | null
): Promise<ClusterMemberPreset | null> {
    if (!presetId) {
        return null;
    }
    const presets = await loadSwarmPresets(extensionPath);
    const preset = presets.find(p => p.id === presetId);
    return preset ? cloneClusterMemberPreset(preset) : null;
}

/**
 * 解析集群成员预设，如指定ID不存在则返回默认预设
 * @param presetId - 预设标识符
 * @returns 集群成员预设
 */
export async function resolveClusterMemberPreset(
    extensionPath: string,
    presetId?: string | null
): Promise<ClusterMemberPreset> {
    const resolved = (await getClusterMemberPreset(extensionPath, presetId))
        || (await getClusterMemberPreset(extensionPath, DEFAULT_CLUSTER_MEMBER_PRESET_ID));
    if (resolved) {
        return resolved;
    }
    const presets = await loadSwarmPresets(extensionPath);
    if (presets.length > 0) {
        return cloneClusterMemberPreset(presets[0]);
    }
    return {
        id: DEFAULT_CLUSTER_MEMBER_PRESET_ID,
        nameTemplate: 'Swarm - {{timestamp}}',
        description: '',
        tags: [],
        workspaceConfig: {
            presetId: DEFAULT_CLUSTER_MEMBER_PRESET_ID
        } as Partial<ClusterWorkspaceConfig> & { presetId: string },
        memberBlueprints: []
    };
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

function cloneClusterMemberPreset(preset: SwarmPreset): ClusterMemberPreset {
    const workspaceConfig = preset.workspaceConfig && typeof preset.workspaceConfig === 'object'
        ? { ...preset.workspaceConfig }
        : { presetId: DEFAULT_CLUSTER_MEMBER_PRESET_ID };
    if (!('presetId' in workspaceConfig) || !String((workspaceConfig as any).presetId || '').trim()) {
        (workspaceConfig as any).presetId = DEFAULT_CLUSTER_MEMBER_PRESET_ID;
    }

    return {
        ...preset,
        description: preset.description ?? '',
        workspaceConfig: workspaceConfig as Partial<ClusterWorkspaceConfig> & { presetId: string },
        memberBlueprints: preset.memberBlueprints.map(blueprint => cloneClusterMemberBlueprint(blueprint)),
        tags: preset.tags ? [...preset.tags] : [],
        recommendedSkills: preset.recommendedSkills ? [...preset.recommendedSkills] : undefined
    };
}

function cloneClusterMemberBlueprint(
    blueprint: SwarmPresetMemberBlueprint
): ClusterMemberAgentBlueprint {
    return {
        ...blueprint,
        activation: blueprint.activation
            ? {
                ...(blueprint.activation.swarmModes ? { swarmModes: [...blueprint.activation.swarmModes] } : {}),
                ...(blueprint.activation.keywords ? { keywords: [...blueprint.activation.keywords] } : {})
            }
            : undefined,
        profile: blueprint.profile
            ? { ...blueprint.profile }
            : undefined
    };
}
