import * as vscode from 'vscode';

import { t } from '../../i18n';
import type { ChannelManager } from '../../managers/channelManager';
import type { DiscoveredChannel, OpenClawService } from '../../services/openclawService';
import { showSuccessStatus } from '../../utils/statusFeedback';
import {
    buildImportedChannelSessionKey,
    buildMessageSyncSignature,
    delay,
    mergePanelChannels,
    normalizeOutgoingMessageContent
} from './helpers';

interface ChannelActionContext {
    service: OpenClawService;
    channelManager: ChannelManager;
    importedChannelSessions: Map<string, { agentId: string; sessionId: string }>;
    postMessage(message: Record<string, unknown>): void;
    postRunState(scope: 'chat' | 'channel', running: boolean): void;
    resolveDiscoveredChannel(channelId: string): Promise<DiscoveredChannel | null>;
    getCurrentChannelId(): string | null;
    setCurrentChannelId(channelId: string | null): void;
    getCurrentChannelSessionId(): string | null;
    setCurrentChannelSessionId(sessionId: string | null): void;
    nextChannelLoadToken(): number;
    getChannelLoadToken(): number;
    bumpChannelSyncToken(): number;
    getChannelSyncToken(): number;
    nextChannelRunToken(): number;
    getChannelRunToken(): number;
    isPanelVisible(): boolean;
}

export async function loadChannels(context: ChannelActionContext, selectedChannelId?: string): Promise<void> {
    try {
        const [channels, discoveredChannels] = await Promise.all([
            context.channelManager.getChannels(),
            context.service.getDiscoveredChannels()
        ]);
        const mergedChannels = mergePanelChannels(channels, discoveredChannels);
        const currentChannelId = context.getCurrentChannelId();
        const resolvedSelectedChannelId = selectedChannelId && mergedChannels.some(channel => channel.id === selectedChannelId)
            ? selectedChannelId
            : currentChannelId && mergedChannels.some(channel => channel.id === currentChannelId)
                ? currentChannelId
                : mergedChannels[0]?.id || null;

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

export async function activateChannel(context: ChannelActionContext, channelId: string | null | undefined): Promise<void> {
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
            context.setCurrentChannelSessionId(importedSession?.sessionId || null);

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

        context.setCurrentChannelSessionId(channel.sessionId || null);
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

export async function refreshActiveChannelMessages(context: ChannelActionContext, channelId?: string): Promise<void> {
    const resolvedChannelId = channelId || context.getCurrentChannelId();
    if (!resolvedChannelId) {
        return;
    }

    await activateChannel(context, resolvedChannelId);
}

export async function handleCreateChannel(
    context: ChannelActionContext,
    data: { name?: string; agentId?: string; description?: string }
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

export async function handleUpdateChannel(
    context: ChannelActionContext,
    channelId: string,
    data: { name?: string; agentId?: string; description?: string }
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

    try {
        const channel = await context.channelManager.getChannel(channelId);
        if (!channel) {
            const discoveredChannel = await context.resolveDiscoveredChannel(channelId);
            if (discoveredChannel) {
                const importedSession = await ensureImportedChannelSession(context, discoveredChannel.id);
                if (!importedSession) {
                    throw new Error(t('channel.missingAgentHint'));
                }

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

        let sessionId = channel.sessionId || null;
        if (!sessionId) {
            const session = await context.service.createChatSession(channel.agentId);
            sessionId = session.id;
            await context.channelManager.setChannelSessionId(channel.id, sessionId);
            context.setCurrentChannelSessionId(sessionId);
            startActiveChannelSync(context, channel.id, sessionId, context.getChannelLoadToken());
        }

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
        if (context.getChannelRunToken() === channelRunToken) {
            context.postRunState('channel', false);
        }
    }
}

export function clearChannelSelection(context: ChannelActionContext): void {
    stopActiveChannelSync(context);
    context.setCurrentChannelId(null);
    context.setCurrentChannelSessionId(null);
    context.postMessage({
        type: 'setActiveChannel',
        channelId: null
    });
    context.postMessage({
        type: 'replaceChannelMessages',
        channelId: null,
        messages: []
    });
    context.postRunState('channel', false);
}

export function stopActiveChannelSync(context: ChannelActionContext): void {
    context.bumpChannelSyncToken();
}

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

async function ensureImportedChannelSession(
    context: ChannelActionContext,
    channelId: string
): Promise<{ agentId: string; sessionId: string } | null> {
    const cached = context.importedChannelSessions.get(channelId);
    if (cached) {
        return cached;
    }

    const discoveredChannel = await context.resolveDiscoveredChannel(channelId);
    if (!discoveredChannel) {
        return null;
    }

    const agentId = await context.service.getPreferredAgentId();
    if (!agentId) {
        return null;
    }

    const importedSession = {
        agentId,
        sessionId: buildImportedChannelSessionKey(discoveredChannel, agentId)
    };
    context.importedChannelSessions.set(channelId, importedSession);
    return importedSession;
}

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
