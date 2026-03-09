import type { ResolvedServiceConfig } from '../openclawConfig';

export type OpenClawMode = ResolvedServiceConfig['mode'];
export type CapabilitySupport = 'full' | 'limited' | 'unavailable';

export type OpenClawCapabilityId =
    | 'agentChat'
    | 'agentEditing'
    | 'swarmWorkspace'
    | 'clusterPersistence'
    | 'scheduledTasks'
    | 'liveSessionSync'
    | 'usageInsights';

export type OpenClawBooleanCapabilityId = keyof OpenClawModeCapabilities['supports'];

export interface OpenClawModeCapabilities {
    mode: OpenClawMode;
    supports: {
        agentChat: boolean;
        agentEditing: boolean;
        swarmWorkspace: boolean;
        scheduledTasks: boolean;
        liveSessionSync: boolean;
        usageInsights: boolean;
    };
    clusterTransport: 'remote' | 'workspace';
    clusterPersistence: 'remote' | 'workspace';
    currentModeTitleKey: string;
    currentModeBodyKey: string;
}

export interface OpenClawCapabilityMatrixRow {
    id: OpenClawCapabilityId;
    titleKey: string;
    summaryKey: string;
    modes: Record<OpenClawMode, {
        support: CapabilitySupport;
        noteKey: string;
    }>;
}

const MODE_CAPABILITIES: Record<OpenClawMode, OpenClawModeCapabilities> = {
    gateway: {
        mode: 'gateway',
        supports: {
            agentChat: true,
            agentEditing: true,
            swarmWorkspace: true,
            scheduledTasks: false,
            liveSessionSync: false,
            usageInsights: true
        },
        clusterTransport: 'remote',
        clusterPersistence: 'remote',
        currentModeTitleKey: 'capability.current.gateway.title',
        currentModeBodyKey: 'capability.current.gateway.body'
    },
    openclaw: {
        mode: 'openclaw',
        supports: {
            agentChat: true,
            agentEditing: false,
            swarmWorkspace: true,
            scheduledTasks: true,
            liveSessionSync: true,
            usageInsights: true
        },
        clusterTransport: 'workspace',
        clusterPersistence: 'workspace',
        currentModeTitleKey: 'capability.current.openclaw.title',
        currentModeBodyKey: 'capability.current.openclaw.body'
    },
    local: {
        mode: 'local',
        supports: {
            agentChat: true,
            agentEditing: true,
            swarmWorkspace: true,
            scheduledTasks: false,
            liveSessionSync: false,
            usageInsights: true
        },
        clusterTransport: 'workspace',
        clusterPersistence: 'workspace',
        currentModeTitleKey: 'capability.current.local.title',
        currentModeBodyKey: 'capability.current.local.body'
    }
};

const CAPABILITY_MATRIX: readonly OpenClawCapabilityMatrixRow[] = [
    {
        id: 'agentChat',
        titleKey: 'capability.row.agentChat.title',
        summaryKey: 'capability.row.agentChat.summary',
        modes: {
            gateway: { support: 'full', noteKey: 'capability.note.agentChat.full' },
            openclaw: { support: 'full', noteKey: 'capability.note.agentChat.full' },
            local: { support: 'full', noteKey: 'capability.note.agentChat.full' }
        }
    },
    {
        id: 'agentEditing',
        titleKey: 'capability.row.agentEditing.title',
        summaryKey: 'capability.row.agentEditing.summary',
        modes: {
            gateway: { support: 'full', noteKey: 'capability.note.agentEditing.full' },
            openclaw: { support: 'unavailable', noteKey: 'capability.note.agentEditing.openclaw' },
            local: { support: 'full', noteKey: 'capability.note.agentEditing.full' }
        }
    },
    {
        id: 'swarmWorkspace',
        titleKey: 'capability.row.swarmWorkspace.title',
        summaryKey: 'capability.row.swarmWorkspace.summary',
        modes: {
            gateway: { support: 'full', noteKey: 'capability.note.swarmWorkspace.gateway' },
            openclaw: { support: 'limited', noteKey: 'capability.note.swarmWorkspace.workspace' },
            local: { support: 'limited', noteKey: 'capability.note.swarmWorkspace.workspace' }
        }
    },
    {
        id: 'clusterPersistence',
        titleKey: 'capability.row.clusterPersistence.title',
        summaryKey: 'capability.row.clusterPersistence.summary',
        modes: {
            gateway: { support: 'full', noteKey: 'capability.note.clusterPersistence.gateway' },
            openclaw: { support: 'limited', noteKey: 'capability.note.clusterPersistence.workspace' },
            local: { support: 'limited', noteKey: 'capability.note.clusterPersistence.workspace' }
        }
    },
    {
        id: 'scheduledTasks',
        titleKey: 'capability.row.scheduledTasks.title',
        summaryKey: 'capability.row.scheduledTasks.summary',
        modes: {
            gateway: { support: 'unavailable', noteKey: 'capability.note.scheduledTasks.requiresOpenclaw' },
            openclaw: { support: 'full', noteKey: 'capability.note.scheduledTasks.openclaw' },
            local: { support: 'unavailable', noteKey: 'capability.note.scheduledTasks.requiresOpenclaw' }
        }
    },
    {
        id: 'liveSessionSync',
        titleKey: 'capability.row.liveSessionSync.title',
        summaryKey: 'capability.row.liveSessionSync.summary',
        modes: {
            gateway: { support: 'unavailable', noteKey: 'capability.note.liveSessionSync.requiresOpenclaw' },
            openclaw: { support: 'full', noteKey: 'capability.note.liveSessionSync.openclaw' },
            local: { support: 'unavailable', noteKey: 'capability.note.liveSessionSync.requiresOpenclaw' }
        }
    },
    {
        id: 'usageInsights',
        titleKey: 'capability.row.usageInsights.title',
        summaryKey: 'capability.row.usageInsights.summary',
        modes: {
            gateway: { support: 'full', noteKey: 'capability.note.usageInsights.full' },
            openclaw: { support: 'full', noteKey: 'capability.note.usageInsights.full' },
            local: { support: 'full', noteKey: 'capability.note.usageInsights.full' }
        }
    }
];

export function getModeCapabilities(mode: OpenClawMode): OpenClawModeCapabilities {
    const capabilities = MODE_CAPABILITIES[mode];
    return {
        ...capabilities,
        supports: { ...capabilities.supports }
    };
}

export function getModeCapabilityMatrix(): OpenClawCapabilityMatrixRow[] {
    return CAPABILITY_MATRIX.map(row => ({
        ...row,
        modes: {
            gateway: { ...row.modes.gateway },
            openclaw: { ...row.modes.openclaw },
            local: { ...row.modes.local }
        }
    }));
}

export function isCapabilitySupported(
    mode: OpenClawMode,
    capabilityId: OpenClawBooleanCapabilityId
): boolean {
    return getModeCapabilities(mode).supports[capabilityId];
}
