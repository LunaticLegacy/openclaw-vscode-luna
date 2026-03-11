import * as crypto from 'crypto';

import type {
    OpenClawCliRunner
} from '../openclawCli';
import {
    GatewayEventFrame,
    OpenClawGatewayClient
} from '../openclawGatewayClient';
import {
    delay,
    extractAssistantMessageFromPayload,
    extractTextContent,
    isFinalOpenClawAssistantMessage,
    normalizeOpenClawGatewayLifecycleEvent,
    normalizeOpenClawGatewayToolEvent
} from './helpers';
import type { OpenClawCliServiceConfig } from '../openclawConfig';
import type { ChatMessage, StreamChunk } from './types';

interface OpenClawRuntimeStreamContext {
    config: OpenClawCliServiceConfig;
    runner: OpenClawCliRunner;
    activeGatewayRuns: Map<string, { runId: string; abortPromise?: Promise<void> }>;
    readSessionMessages(sessionKey: string): Promise<ChatMessage[]>;
    waitForAssistantMessage(sessionKey: string, knownIds: Set<string>, timeoutMs: number): Promise<ChatMessage | null>;
}

export async function *streamMessageViaGateway(
    context: OpenClawRuntimeStreamContext,
    sessionKey: string,
    message: string,
    knownIds: Set<string>
): AsyncGenerator<StreamChunk, void, unknown> {
    if (!context.config.gatewayUrl) {
        throw new Error('OpenClaw gateway URL is not configured');
    }

    const gatewayClient = new OpenClawGatewayClient({
        url: context.config.gatewayUrl,
        token: context.config.gatewayToken,
        timeoutMs: 30000,
        caps: ['tool-events'],
        clientId: 'gateway-client',
        clientDisplayName: 'OpenClaw VS Code',
        clientVersion: 'vscode-plugin'
    });

    const events: GatewayEventFrame[] = [];
    let wakeNextEvent: (() => void) | null = null;
    let streamError: Error | null = null;
    let dispatched = false;
    let runId = '';
    let assistantText = '';
    let thinkingText = '';
    let thinkingOpen = false;

    const queueEvent = (event: GatewayEventFrame) => {
        events.push(event);
        const wake = wakeNextEvent;
        wakeNextEvent = null;
        wake?.();
    };

    const onEvent = (event: GatewayEventFrame) => {
        if (event.event !== 'chat' && event.event !== 'agent') {
            return;
        }

        queueEvent(event);
    };

    const onError = (error: unknown) => {
        streamError = error instanceof Error ? error : new Error(String(error));
        const wake = wakeNextEvent;
        wakeNextEvent = null;
        wake?.();
    };

    const nextEvent = async (): Promise<GatewayEventFrame> => {
        while (events.length === 0) {
            if (streamError) {
                throw streamError;
            }

            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (wakeNextEvent === wake) {
                        wakeNextEvent = null;
                    }
                    reject(new Error('Timed out waiting for gateway stream event'));
                }, 30000);

                const wake = () => {
                    clearTimeout(timer);
                    resolve();
                };

                wakeNextEvent = wake;
            });
        }

        return events.shift()!;
    };

    gatewayClient.on('event', onEvent);
    gatewayClient.on('error', onError);

    try {
        await gatewayClient.connect();

        const started = await gatewayClient.request<{
            runId?: string;
            status?: string;
        }>('chat.send', {
            sessionKey,
            message,
            deliver: false,
            idempotencyKey: crypto.randomUUID()
        }, {
            timeoutMs: 30000
        });

        dispatched = true;
        runId = typeof started.runId === 'string' && started.runId.trim()
            ? started.runId.trim()
            : '';

        if (!runId) {
            throw new Error('Gateway chat.send did not return a runId');
        }

        context.activeGatewayRuns.set(sessionKey, { runId });

        while (true) {
            const event = await nextEvent();
            const payload = event.payload && typeof event.payload === 'object'
                ? event.payload as Record<string, unknown>
                : null;

            if (!payload || payload.runId !== runId) {
                continue;
            }

            if (event.event === 'agent') {
                const stream = typeof payload.stream === 'string' ? payload.stream : '';

                if (stream === 'thinking') {
                    const data = payload.data && typeof payload.data === 'object'
                        ? payload.data as Record<string, unknown>
                        : {};
                    const fullThinking = typeof data.text === 'string' ? data.text : '';
                    const deltaThinking = typeof data.delta === 'string'
                        ? data.delta
                        : fullThinking.startsWith(thinkingText)
                            ? fullThinking.slice(thinkingText.length)
                            : fullThinking;

                    thinkingText = fullThinking || thinkingText;
                    if (!deltaThinking) {
                        continue;
                    }

                    yield {
                        content: thinkingOpen ? deltaThinking : `<thinking>${deltaThinking}`,
                        done: false
                    };
                    thinkingOpen = true;
                    continue;
                }

                if (thinkingOpen && (stream === 'assistant' || stream === 'tool' || stream === 'lifecycle')) {
                    thinkingOpen = false;
                    thinkingText = '';
                    yield {
                        content: '</thinking>',
                        done: false
                    };
                }

                if (stream === 'tool') {
                    const transientMessage = normalizeOpenClawGatewayToolEvent(sessionKey, payload);
                    if (transientMessage) {
                        yield {
                            content: '',
                            done: false,
                            message: transientMessage
                        };
                    }
                    continue;
                }

                if (stream === 'lifecycle') {
                    const lifecycleMessage = normalizeOpenClawGatewayLifecycleEvent(sessionKey, payload);
                    if (lifecycleMessage) {
                        yield {
                            content: '',
                            done: false,
                            message: lifecycleMessage
                        };
                    }

                    const data = payload.data && typeof payload.data === 'object'
                        ? payload.data as Record<string, unknown>
                        : {};
                    if (data.phase === 'error') {
                        throw new Error(typeof data.error === 'string' ? data.error : 'OpenClaw agent run failed');
                    }
                }

                continue;
            }

            if (thinkingOpen) {
                thinkingOpen = false;
                thinkingText = '';
                yield {
                    content: '</thinking>',
                    done: false
                };
            }

            const state = typeof payload.state === 'string' ? payload.state : '';
            const messageText = extractTextContent((payload.message as { content?: unknown } | undefined)?.content);
            const deltaText = messageText
                ? messageText.startsWith(assistantText)
                    ? messageText.slice(assistantText.length)
                    : messageText
                : '';

            if (messageText) {
                assistantText = messageText;
            }

            if (deltaText) {
                yield {
                    content: deltaText,
                    done: false
                };
            }

            if (state === 'error') {
                throw new Error(typeof payload.errorMessage === 'string' ? payload.errorMessage : 'OpenClaw chat stream failed');
            }

            if (state === 'aborted') {
                throw new Error('OpenClaw chat stream aborted');
            }

            if (state === 'final') {
                yield {
                    content: '',
                    done: true
                };
                return;
            }
        }
    } catch (error) {
        if (!dispatched) {
            throw error;
        }

        const streamFailure = error instanceof Error ? error : new Error(String(error));
        if (thinkingOpen) {
            yield {
                content: '</thinking>',
                done: false
            };
        }

        const fallbackAssistant = await context.waitForAssistantMessage(sessionKey, knownIds, 120000);
        if (!fallbackAssistant && !assistantText) {
            throw streamFailure;
        }

        if (fallbackAssistant?.content) {
            const deltaText = fallbackAssistant.content.startsWith(assistantText)
                ? fallbackAssistant.content.slice(assistantText.length)
                : fallbackAssistant.content;

            if (deltaText) {
                yield {
                    content: deltaText,
                    done: false
                };
            }
        }

        yield {
            content: '',
            done: true
        };
    } finally {
        const activeRun = context.activeGatewayRuns.get(sessionKey);
        if (activeRun?.runId === runId && !activeRun.abortPromise) {
            context.activeGatewayRuns.delete(sessionKey);
        }
        gatewayClient.off('event', onEvent);
        gatewayClient.off('error', onError);
        gatewayClient.dispose();
    }
}

export async function *streamMessageFromSessionLog(
    context: OpenClawRuntimeStreamContext,
    sessionKey: string,
    message: string,
    knownIds: Set<string>
): AsyncGenerator<StreamChunk, void, unknown> {
    let responsePayload: Record<string, unknown> | null = null;
    let requestError: unknown = null;
    let requestCompleted = false;
    let requestCompletedAt = 0;
    let finalAssistantSeen = false;

    const requestPromise = context.runner.sendChat(sessionKey, message)
        .then(result => {
            responsePayload = result;
            requestCompleted = true;
            requestCompletedAt = Date.now();
            return result;
        })
        .catch(error => {
            requestError = error;
            requestCompleted = true;
            requestCompletedAt = Date.now();
            throw error;
        });

    while (!requestCompleted || Date.now() - requestCompletedAt < 2500) {
        const currentMessages = await context.readSessionMessages(sessionKey).catch(() => []);
        const newMessages = currentMessages.filter(item => !knownIds.has(item.id));

        for (const newMessage of newMessages) {
            knownIds.add(newMessage.id);
            if (isFinalOpenClawAssistantMessage(newMessage)) {
                finalAssistantSeen = true;
            }

            yield {
                content: newMessage.role === 'assistant' ? newMessage.content : '',
                done: false,
                tokenCount: newMessage.tokenCount,
                message: newMessage
            };
        }

        if (requestCompleted) {
            if (requestError) {
                break;
            }

            if (finalAssistantSeen) {
                break;
            }
        }

        await delay(200);
    }

    try {
        await requestPromise;
    } catch {
        throw requestError;
    }

    if (!finalAssistantSeen && responsePayload) {
        const fallbackAssistant = extractAssistantMessageFromPayload(responsePayload, sessionKey);
        if (fallbackAssistant && !knownIds.has(fallbackAssistant.id)) {
            yield {
                content: fallbackAssistant.content,
                done: false,
                tokenCount: fallbackAssistant.tokenCount,
                message: fallbackAssistant
            };
        }
    }

    yield {
        content: '',
        done: true
    };
}
