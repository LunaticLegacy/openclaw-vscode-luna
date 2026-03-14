import { EventEmitter } from 'events';

import { t } from '../i18n';
import { ChatMessage, ChatSession, CreateChatSessionOptions, OpenClawService } from '../services/openclawService';

export class ChatSessionManager extends EventEmitter {
    private service: OpenClawService;
    private sessions: Map<string, ChatSession> = new Map();
    private currentSessionId: string | null = null;

    constructor(service: OpenClawService) {
        super();
        this.service = service;
    }

    public async createSession(agentId: string, options: CreateChatSessionOptions = {}): Promise<ChatSession> {
        const session = await this.service.createChatSession(agentId, options);
        this.sessions.set(session.id, session);
        this.currentSessionId = session.id;
        this.emit('sessionCreated', session);
        return session;
    }

    public async getOrCreateSession(
        agentId: string,
        options: { refreshHistory?: boolean; sessionId?: string } = {}
    ): Promise<ChatSession> {
        const requestedSessionId = String(options.sessionId || '').trim();
        if (requestedSessionId) {
            const existingById = this.sessions.get(requestedSessionId);
            if (existingById && existingById.agentId === agentId) {
                if (options.refreshHistory) {
                    existingById.messages = await this.service.getChatHistory(existingById.id);
                    existingById.updatedAt = existingById.messages[existingById.messages.length - 1]?.timestamp || existingById.updatedAt;
                }
                this.currentSessionId = existingById.id;
                return existingById;
            }
        }

        for (const session of this.sessions.values()) {
            if (!requestedSessionId && session.agentId === agentId) {
                if (options.refreshHistory) {
                    session.messages = await this.service.getChatHistory(session.id);
                    session.updatedAt = session.messages[session.messages.length - 1]?.timestamp || session.updatedAt;
                }
                this.currentSessionId = session.id;
                return session;
            }
        }

        return this.createSession(agentId, {
            sessionId: requestedSessionId || undefined
        });
    }

    public findSessionByAgent(agentId: string): ChatSession | null {
        for (const session of this.sessions.values()) {
            if (session.agentId === agentId) {
                return session;
            }
        }

        return null;
    }

    public getSession(sessionId: string): ChatSession | null {
        return this.sessions.get(sessionId) || null;
    }

    public getCurrentSession(): ChatSession | null {
        if (!this.currentSessionId) return null;
        return this.sessions.get(this.currentSessionId) || null;
    }

    public getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    public setCurrentSession(sessionId: string): boolean {
        if (this.sessions.has(sessionId)) {
            this.currentSessionId = sessionId;
            this.emit('sessionChanged', sessionId);
            return true;
        }
        return false;
    }

    public async sendMessage(content: string): Promise<ChatMessage> {
        const session = this.getCurrentSession();
        if (!session) {
            throw new Error(t('session.noActive'));
        }

        const response = await this.service.sendMessage(session.id, content);

        session.messages.push({
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });
        session.messages.push(response);
        session.updatedAt = new Date().toISOString();

        this.emit('messageReceived', response);
        return response;
    }

    public async *streamMessage(content: string): AsyncGenerator<{ content: string; done: boolean; message?: ChatMessage }, void, unknown> {
        const session = this.getCurrentSession();
        if (!session) {
            throw new Error(t('session.noActive'));
        }

        session.messages.push({
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        });

        let fullContent = '';
        let emittedStructuredMessage = false;

        for await (const chunk of this.service.streamMessage(session.id, content)) {
            if (chunk.message) {
                const isTransient = Boolean(chunk.message.metadata?.transient);
                if (!isTransient) {
                    emittedStructuredMessage = true;
                }

                if (!isTransient && !session.messages.some(message => message.id === chunk.message!.id)) {
                    session.messages.push(chunk.message);
                    session.updatedAt = chunk.message.timestamp || new Date().toISOString();
                }
            } else {
                fullContent += chunk.content;
            }

            yield chunk;
        }

        if (!emittedStructuredMessage && fullContent.trim()) {
            session.messages.push({
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: fullContent,
                timestamp: new Date().toISOString()
            });

            session.updatedAt = new Date().toISOString();
        }
    }

    public async getHistory(): Promise<ChatMessage[]> {
        const session = this.getCurrentSession();
        if (!session) {
            return [];
        }

        if (session.messages.length === 0) {
            const messages = await this.service.getChatHistory(session.id);
            session.messages = messages;
        }

        return session.messages;
    }

    public async refreshSessionHistory(
        sessionId?: string,
        options: { preferLiveState?: boolean } = {}
    ): Promise<ChatMessage[]> {
        const id = sessionId || this.currentSessionId;
        if (!id) {
            return [];
        }

        const session = this.sessions.get(id);
        if (!session) {
            return [];
        }

        const messages = options.preferLiveState && this.service.supportsLiveSessionSync()
            ? await this.service.getLiveChatHistory(id)
            : await this.service.getChatHistory(id);

        if (options.preferLiveState && messages.length === 0 && session.messages.length > 0) {
            return session.messages;
        }

        session.messages = messages;
        session.updatedAt = messages[messages.length - 1]?.timestamp || session.updatedAt;
        return session.messages;
    }

    public async clearHistory(): Promise<void> {
        const session = this.getCurrentSession();
        if (!session) return;

        await this.service.clearChatHistory(session.id);
        session.messages = [];
        this.emit('historyCleared', session.id);
    }

    public closeSession(sessionId?: string): void {
        const id = sessionId || this.currentSessionId;
        if (!id) return;

        this.sessions.delete(id);

        if (this.currentSessionId === id) {
            this.currentSessionId = null;
        }

        this.emit('sessionClosed', id);
    }

    public getAllSessions(): ChatSession[] {
        return Array.from(this.sessions.values());
    }

    public getSessionCount(): number {
        return this.sessions.size;
    }

    public dispose() {
        this.removeAllListeners();
        this.sessions.clear();
        this.currentSessionId = null;
    }
}
