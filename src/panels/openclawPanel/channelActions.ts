import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { AgentManager } from '../../managers/agentManager';
import type { ChannelManager } from '../../managers/channelManager';
import type { DiscoveredChannel, OpenClawService } from '../../services/openclawService';
import type { ChannelDraftPayload } from '../../types/panel';
import { showSuccessStatus } from '../../utils/statusFeedback';
import {
    buildImportedChannelSessionKey,
    buildMessageSyncSignature,
    delay,
    mergePanelChannels,
    normalizeOutgoingMessageContent
} from './helpers';

/**
 * Context interface for channel action operations
 */
interface ChannelActionContext {
    service: OpenClawService;
    agentManager: AgentManager;
    channelManager: ChannelManager;
    importedChannelSessions: Map<string, { agentId: string; sessionId: string }>;
    postMessage(message: Record<string, unknown>): void;
    postRunState(scope: 'chat' | 'channel', running: boolean): void;
    resolveDiscoveredChannel(channelId: string): Promise<DiscoveredChannel | undefined>;
    getCurrentChannelId(): string | undefined;
    setCurrentChannelId(channelId: string | undefined): void;
    getCurrentChannelSessionId(): string | undefined;
    setCurrentChannelSessionId(sessionId: string | undefined): void;
    nextChannelLoadToken(): number;
    getChannelLoadToken(): number;
    bumpChannelSyncToken(): number;
    getChannelSyncToken(): number;
    nextChannelRunToken(): number;
    getChannelRunToken(): number;
    isPanelVisible(): boolean;
}

/**
 * Loads the list of channels
 * @param context - The channel action context
 * @param selectedChannelId - Optional channel ID to select
 */
export async function loadChannels(context: ChannelActionContext, selectedChannelId?: string): Promise<void> {
    try {
        const [channels, discoveredChannels] = await Promise.all([
            context.channelManager.getChannels(),
            context.service.getDiscoveredChannels()
        ]);
        const mergedChannels = mergePanelChannels(channels, discoveredChannels);
        const currentChannelId = context.getCurrentChannelId();
        const resolvedSelectedChannelId = selectedChannelId && mergedChannels.some((channel: any) => channel.id === selectedChannelId)
            ? selectedChannelId
            : currentChannelId && mergedChannels.some((channel: any) => channel.id === currentChannelId)
                ? currentChannelId
                : mergedChannels[0]?.id || undefined;

        context.postMessage({
            type: 'channelsLoaded',
            channels: mergedChannels,
            selectedChannelId: resolvedSelectedChannelId
        });

        if (resolvedSelectedChannelId) {
            await activateChannel(context, resolvedSelectedChannelId);
            return;
        }

        clearChannelSelection(context);
    } catch (error) {
        context.postMessage({
            type: 'error',
            message: t('channel.loadFailed', { error: String(error) })
        });
    }
}

/**
 * Activates a channel and loads its messages
 * @param context - The channel action context
 * @param channelId - The ID of the channel to activate
 */
export async function activateChannel(context: ChannelActionContext, channelId: string | undefined): Promise<void> {
    if (!channelId) {
        clearChannelSelection(context);
        return;
    }

    const loadToken = context.nextChannelLoadToken();
    stopActiveChannelSync(context);
    context.setCurrentChannelId(channelId);
    context.postMessage({
        type: 'setActiveChannel',
        channelId
    });
    context.postMessage({
        type: 'setChannelContextLoading',
        channelId,
        loading: true
    });

    try {
        const channel = await context.channelManager.getChannel(channelId);
        if (!channel) {
            const discoveredChannel = await context.resolveDiscoveredChannel(channelId);
            if (!discoveredChannel) {
                clearChannelSelection(context);
                return;
            }

            const importedSession = await ensureImportedChannelSession(context, discoveredChannel.id);
            context.setCurrentChannelSessionId(importedSession?.sessionId || undefined);

            if (!importedSession) {
                context.postMessage({
                    type: 'replaceChannelMessages',
                    channelId: discoveredChannel.id,
                    messages: []
                });
                return;
            }

            await loadImportedChannelMessages(context, discoveredChannel.id, importedSession.sessionId, loadToken);
            startActiveChannelSync(context, discoveredChannel.id, importedSession.sessionId, loadToken);
            return;
        }

        context.setCurrentChannelSessionId(channel.sessionId || undefined);
        await loadChannelMessages(context, channel, loadToken);

        if (channel.sessionId) {
            startActiveChannelSync(context, channel.id, channel.sessionId, loadToken);
        }
    } catch (error) {
        if (loadToken === context.getChannelLoadToken()) {
            context.postMessage({
                type: 'error',
                message: t('channel.loadFailed', { error: String(error) })
            });
        }
    } finally {
        if (loadToken === context.getChannelLoadToken() && context.getCurrentChannelId() === channelId) {
            context.postMessage({
                type: 'setChannelContextLoading',
                channelId,
                loading: false
            });
        }
    }
}

/**
 * Refreshes messages for the active channel
 * @param context - The channel action context
 * @param channelId - Optional channel ID to refresh
 */
export async function refreshActiveChannelMessages(context: ChannelActionContext, channelId?: string): Promise<void> {
    const resolvedChannelId = channelId || context.getCurrentChannelId();
    if (!resolvedChannelId) {
        return;
    }

    await activateChannel(context, resolvedChannelId);
}

/**
 * Handles creating a new channel
 * @param context - The channel action context
 * @param data - The channel creation data
 */
export async function handleCreateChannel(
    context: ChannelActionContext,
    data: ChannelDraftPayload
): Promise<void> {
    try {
        const channel = await context.channelManager.createChannel({
            name: data?.name || '',
            agentId: data?.agentId || '',
            description: data?.description || ''
        });
        showSuccessStatus(t('channel.created'));
        await loadChannels(context, channel.id);
    } catch (error) {
        vscode.window.showErrorMessage(t('channel.saveFailed', { error: String(error) }));
    }
}

/**
 * Handles updating an existing channel
 * @param context - The channel action context
 * @param channelId - The ID of the channel to update
 * @param data - The updated channel data
 */
export async function handleUpdateChannel(
    context: ChannelActionContext,
    channelId: string,
    data: ChannelDraftPayload
): Promise<void> {
    if (!channelId) {
        vscode.window.showErrorMessage(t('channel.notFound'));
        return;
    }

    try {
        const existing = await context.channelManager.getChannel(channelId);
        if (!existing) {
            const created = await context.channelManager.createChannel({
                name: data?.name || '',
                agentId: data?.agentId || '',
                description: data?.description || ''
            });
            showSuccessStatus(t('channel.saved'));
            await loadChannels(context, created.id);
            return;
        }

        const channel = await context.channelManager.updateChannel(channelId, {
            name: data?.name,
            agentId: data?.agentId,
            description: data?.description
        });
        showSuccessStatus(t('channel.saved'));
        await loadChannels(context, channel.id);
    } catch (error) {
        vscode.window.showErrorMessage(t('channel.saveFailed', { error: String(error) }));
    }
}

/**
 * Handles deleting a channel
 * @param context - The channel action context
 * @param channelId - The ID of the channel to delete
 */
export async function handleDeleteChannel(context: ChannelActionContext, channelId: string): Promise<void> {
    if (!channelId) {
        return;
    }

    try {
        const channel = await context.channelManager.getChannel(channelId);
        if (!channel) {
            vscode.window.showErrorMessage(t('channel.importedReadOnly'));
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            t('channel.deleteConfirm', { name: channel.name }),
            { modal: true },
            t('common.delete')
        );

        if (confirm !== t('common.delete')) {
            return;
        }

        await context.channelManager.deleteChannel(channelId);
        showSuccessStatus(t('channel.deleted'));
        await loadChannels(context);
    } catch (error) {
        vscode.window.showErrorMessage(t('channel.deleteFailed', { error: String(error) }));
    }
}

/**
 * Handles sending a message to a channel
 * @param context - The channel action context
 * @param channelId - The ID of the channel to send to
 * @param content - The message content
 */
export async function handleSendChannelMessage(
    context: ChannelActionContext,
    channelId: string,
    content: string
): Promise<void> {
    const normalizedContent = normalizeOutgoingMessageContent(content);
    if (!channelId || !normalizedContent.trim()) {
        return;
    }

    const channelRunToken = context.nextChannelRunToken();
    context.postRunState('channel', true);
    let runningAgentId: string | undefined = undefined;

    try {
        const channel = await context.channelManager.getChannel(channelId);
        if (!channel) {
            const discoveredChannel = await context.resolveDiscoveredChannel(channelId);
            if (discoveredChannel) {
                const importedSession = await ensureImportedChannelSession(context, discoveredChannel.id);
                if (!importedSession) {
                    throw new Error(t('channel.missingAgentHint'));
                }

                runningAgentId = importedSession.agentId;
                context.agentManager.beginAgentRun(runningAgentId);
                const response = await context.service.sendMessage(importedSession.sessionId, normalizedContent);

                if (context.getCurrentChannelId() === discoveredChannel.id && context.getChannelRunToken() === channelRunToken) {
                    context.setCurrentChannelSessionId(importedSession.sessionId);
                    context.postMessage({
                        type: 'addChannelMessage',
                        channelId: discoveredChannel.id,
                        message: response
                    });
                }
                return;
            }
            throw new Error(t('channel.notFound'));
        }

        let sessionId = channel.sessionId || undefined;
        if (!sessionId) {
            const session = await context.service.createChatSession(channel.agentId);
            sessionId = session.id;
            await context.channelManager.setChannelSessionId(channel.id, sessionId);
            context.setCurrentChannelSessionId(sessionId);
            startActiveChannelSync(context, channel.id, sessionId, context.getChannelLoadToken());
        }

        runningAgentId = channel.agentId;
        context.agentManager.beginAgentRun(runningAgentId);
        const response = await context.service.sendMessage(sessionId, normalizedContent);

        if (context.getCurrentChannelId() === channel.id && context.getChannelRunToken() === channelRunToken) {
            context.postMessage({
                type: 'addChannelMessage',
                channelId: channel.id,
                message: response
            });
        }
    } catch (error) {
        if (context.getChannelRunToken() === channelRunToken) {
            context.postMessage({
                type: 'channelSendFailed',
                channelId,
                message: t('panel.failedSendMessage', { error: String(error) })
            });
        }
    } finally {
        if (runningAgentId) {
            context.agentManager.endAgentRun(runningAgentId);
        }
        if (context.getChannelRunToken() === channelRunToken) {
            context.postRunState('channel', false);
        }
    }
}

/**
 * Clears the current channel selection
 * @param context - The channel action context
 */
export function clearChannelSelection(context: ChannelActionContext): void {
    stopActiveChannelSync(context);
    context.setCurrentChannelId(undefined);
    context.setCurrentChannelSessionId(undefined);
    context.postMessage({
        type: 'setActiveChannel',
        channelId: undefined
    });
    context.postMessage({
        type: 'replaceChannelMessages',
        channelId: undefined,
        messages: []
    });
    context.postRunState('channel', false);
}

/**
 * Stops the active channel sync
 * @param context - The channel action context
 */
export function stopActiveChannelSync(context: ChannelActionContext): void {
    context.bumpChannelSyncToken();
}

/**
 * Loads messages for a channel
 * @param context - The channel action context
 * @param channel - The channel to load messages for
 * @param loadToken - The load token for validation
 */
async function loadChannelMessages(
    context: ChannelActionContext,
    channel: { id: string; sessionId?: string },
    loadToken?: number
): Promise<void> {
    if ((loadToken !== undefined && loadToken !== context.getChannelLoadToken()) || context.getCurrentChannelId() !== channel.id) {
        return;
    }

    if (!channel.sessionId) {
        context.postMessage({
            type: 'replaceChannelMessages',
            channelId: channel.id,
            messages: []
        });
        context.postRunState('channel', false);
        return;
    }

    const messages = context.service.supportsLiveSessionSync()
        ? await context.service.getLiveChatHistory(channel.sessionId)
        : await context.service.getChatHistory(channel.sessionId);

    if ((loadToken !== undefined && loadToken !== context.getChannelLoadToken()) || context.getCurrentChannelId() !== channel.id) {
        return;
    }

    context.postMessage({
        type: 'replaceChannelMessages',
        channelId: channel.id,
        messages
    });
    context.postRunState('channel', context.service.hasActiveSessionRun(channel.sessionId));
}

/**
 * Starts syncing a channel's messages
 * @param context - The channel action context
 * @param channelId - The ID of the channel to sync
 * @param sessionId - The session ID for the channel
 * @param loadToken - The load token for validation
 */
function startActiveChannelSync(
    context: ChannelActionContext,
    channelId: string,
    sessionId: string,
    loadToken: number
): void {
    if (!context.service.supportsLiveSessionSync()) {
        return;
    }

    const syncToken = context.bumpChannelSyncToken();
    let previousSignature = '';

    void (async () => {
        while (isCurrentChannelSyncTarget(context, syncToken, channelId, sessionId, loadToken)) {
            await delay(450);

            if (!isCurrentChannelSyncTarget(context, syncToken, channelId, sessionId, loadToken)) {
                return;
            }

            const messages = await context.service.getLiveChatHistory(sessionId);
            const nextSignature = buildMessageSyncSignature(messages);
            if (nextSignature === previousSignature) {
                continue;
            }

            previousSignature = nextSignature;
            if (!isCurrentChannelSyncTarget(context, syncToken, channelId, sessionId, loadToken)) {
                return;
            }

            context.postMessage({
                type: 'replaceChannelMessages',
                channelId,
                messages
            });
        }
    })().catch(() => {
        if (syncToken === context.getChannelSyncToken()) {
            stopActiveChannelSync(context);
        }
    });
}

/**
 * Checks if the current sync target matches
 * @param context - The channel action context
 * @param syncToken - The sync token
 * @param channelId - The channel ID
 * @param sessionId - The session ID
 * @param loadToken - The load token
 * @returns True if this is the current sync target
 */
function isCurrentChannelSyncTarget(
    context: ChannelActionContext,
    syncToken: number,
    channelId: string,
    sessionId: string,
    loadToken: number
): boolean {
    return context.getChannelSyncToken() === syncToken
        && context.getCurrentChannelId() === channelId
        && context.getCurrentChannelSessionId() === sessionId
        && context.getChannelLoadToken() === loadToken
        && context.isPanelVisible();
}

/**
 * Ensures an imported channel session exists
 * @param context - The channel action context
 * @param channelId - The channel ID
 * @returns The imported session info or undefined
 */
async function ensureImportedChannelSession(
    context: ChannelActionContext,
    channelId: string
): Promise<{ agentId: string; sessionId: string } | undefined> {
    const cached = context.importedChannelSessions.get(channelId);
    if (cached) {
        return cached;
    }

    const discoveredChannel = await context.resolveDiscoveredChannel(channelId);
    if (!discoveredChannel) {
        return undefined;
    }

    const agentId = await context.service.getPreferredAgentId();
    if (!agentId) {
        return undefined;
    }

    const importedSession = {
        agentId,
        sessionId: buildImportedChannelSessionKey(discoveredChannel, agentId)
    };
    context.importedChannelSessions.set(channelId, importedSession);
    return importedSession;
}

/**
 * Loads messages for an imported channel
 * @param context - The channel action context
 * @param channelId - The channel ID
 * @param sessionId - The session ID
 * @param loadToken - The load token for validation
 */
async function loadImportedChannelMessages(
    context: ChannelActionContext,
    channelId: string,
    sessionId: string,
    loadToken?: number
): Promise<void> {
    if ((loadToken !== undefined && loadToken !== context.getChannelLoadToken()) || context.getCurrentChannelId() !== channelId) {
        return;
    }

    const messages = context.service.supportsLiveSessionSync()
        ? await context.service.getLiveChatHistory(sessionId)
        : await context.service.getChatHistory(sessionId);

    if ((loadToken !== undefined && loadToken !== context.getChannelLoadToken()) || context.getCurrentChannelId() !== channelId) {
        return;
    }

    context.postMessage({
        type: 'replaceChannelMessages',
        channelId,
        messages
    });
    context.postRunState('channel', context.service.hasActiveSessionRun(sessionId));
}
