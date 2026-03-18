import type { Agent, AgentCluster } from '../services/openclawService';

/**
 * 状态指示器规范
 * 定义图标 ID 和颜色 ID 的接口
 */
export interface StatusIndicatorSpec {
    iconId: string;
    colorId: string;
}

/**
 * 获取 Agent 状态指示器
 * @param status - Agent 状态（active/idle/offline）
 * @returns 状态指示器规范对象
 */
export function getAgentStatusIndicator(status: Agent['status']): StatusIndicatorSpec {
    switch (status) {
        case 'active':
            return {
                iconId: 'circle-filled',
                colorId: 'testing.iconPassed'
            };
        case 'offline':
            return {
                iconId: 'circle-slash',
                colorId: 'disabledForeground'
            };
        case 'idle':
        default:
            return {
                iconId: 'circle-outline',
                colorId: 'testing.iconQueued'
            };
    }
}

/**
 * 获取集群状态指示器
 * @param status - 集群状态（active/offline）
 * @returns 状态指示器规范对象
 */
export function getClusterStatusIndicator(status: AgentCluster['status']): StatusIndicatorSpec {
    return {
        iconId: 'server',
        colorId: status === 'active'
            ? 'testing.iconPassed'
            : 'disabledForeground'
    };
}
