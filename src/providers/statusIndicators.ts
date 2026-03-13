import type { Agent, AgentCluster } from '../services/openclawService';

export interface StatusIndicatorSpec {
    iconId: string;
    colorId: string;
}

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

export function getClusterStatusIndicator(status: AgentCluster['status']): StatusIndicatorSpec {
    return {
        iconId: 'server',
        colorId: status === 'active'
            ? 'testing.iconPassed'
            : 'disabledForeground'
    };
}
