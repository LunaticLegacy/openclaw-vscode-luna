import { t } from '../i18n';
import { OpenClawService } from '../services/openclawService';
import type { OpenClawBooleanCapabilityId } from '../services/openclawService';

const CAPABILITY_ERROR_KEYS: Record<OpenClawBooleanCapabilityId, string> = {
    agentChat: 'capability.unavailable.generic',
    agentEditing: 'capability.unavailable.agentEditing',
    swarmWorkspace: 'capability.unavailable.swarmWorkspace',
    scheduledTasks: 'capability.unavailable.scheduledTasks',
    liveSessionSync: 'capability.unavailable.liveSessionSync',
    usageInsights: 'capability.unavailable.generic'
};

const CAPABILITY_TITLE_KEYS: Record<OpenClawBooleanCapabilityId, string> = {
    agentChat: 'capability.row.agentChat.title',
    agentEditing: 'capability.row.agentEditing.title',
    swarmWorkspace: 'capability.row.swarmWorkspace.title',
    scheduledTasks: 'capability.row.scheduledTasks.title',
    liveSessionSync: 'capability.row.liveSessionSync.title',
    usageInsights: 'capability.row.usageInsights.title'
};

/**
 * 获取功能不可用时的错误消息
 * @param capabilityId - 功能标识符
 * @returns 本地化的错误消息
 */
export function getCapabilityUnavailableMessage(capabilityId: OpenClawBooleanCapabilityId): string {
    const errorKey = CAPABILITY_ERROR_KEYS[capabilityId];
    if (errorKey === 'capability.unavailable.generic') {
        return t(errorKey, {
            capability: t(CAPABILITY_TITLE_KEYS[capabilityId])
        });
    }

    return t(errorKey);
}

/**
 * 检查服务功能是否可用
 * @param service - OpenClaw服务实例
 * @param capabilityId - 功能标识符
 * @returns 如果功能可用则返回 true
 */
export function isServiceCapabilityAvailable(
    service: OpenClawService,
    capabilityId: OpenClawBooleanCapabilityId
): boolean {
    return service.supportsCapability(capabilityId);
}
