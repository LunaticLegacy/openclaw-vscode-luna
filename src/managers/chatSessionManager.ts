import { EventEmitter } from 'events';

import { t } from '../i18n';
import { ChatMessage, ChatSession, CreateChatSessionOptions, OpenClawService } from '../services/openclawService';

/**
 * 聊天会话管理器，负责管理聊天会话的创建、消息发送和状态管理
 * 
 * @emits sessionCreated - 当会话被创建时触发
 * @emits sessionChanged - 当当前会话改变时触发
 * @emits messageReceived - 当收到消息时触发
 * @emits historyCleared - 当历史记录被清除时触发
 * @emits sessionClosed - 当会话被关闭时触发
 * 
 * @example
 * ```typescript
 * const manager = new ChatSessionManager(service);
 * const session = await manager.createSession(agentId);
 * await manager.sendMessage('Hello');
 * ```
 */
export class ChatSessionManager extends EventEmitter {
    private service: OpenClawService;
    private sessions: Map<string, ChatSession> = new Map();
    private currentSessionId: string | null = null;

    /**
     * 创建 ChatSessionManager 实例
     * @param service - OpenClaw 服务实例
     */
    constructor(service: OpenClawService) {
        super();
        this.service = service;
    }

    /**
     * 创建新会话
     * 
     * @param agentId - 智能体ID
     * @param options - 创建选项
     * @returns 创建的会话
     */
    public async createSession(agentId: string, options: CreateChatSessionOptions = {}): Promise<ChatSession> {
        const session = await this.service.createChatSession(agentId, options);
        this.sessions.set(session.id, session);
        this.currentSessionId = session.id;
        this.emit('sessionCreated', session);
        return session;
    }

    /**
     * 获取或创建会话
     * 
     * @param agentId - 智能体ID
     * @param options - 选项
     * @returns 现有会话或新创建的会话
     */
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

    /**
     * 根据智能体查找会话
     * 
     * @param agentId - 智能体ID
     * @returns 会话对象或 null
     */
    public findSessionByAgent(agentId: string): ChatSession | null {
        for (const session of this.sessions.values()) {
            if (session.agentId === agentId) {
                return session;
            }
        }

        return null;
    }

    /**
     * 获取指定会话
     * 
     * @param sessionId - 会话ID
     * @returns 会话对象或 null
     */
    public getSession(sessionId: string): ChatSession | null {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * 获取当前会话
     * 
     * @returns 当前会话或 null
     */
    public getCurrentSession(): ChatSession | null {
        if (!this.currentSessionId) return null;
        return this.sessions.get(this.currentSessionId) || null;
    }

    /**
     * 获取当前会话ID
     * 
     * @returns 当前会话ID或 null
     */
    public getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    /**
     * 设置当前会话
     * 
     * @param sessionId - 会话ID
     * @returns 是否设置成功
     */
    public setCurrentSession(sessionId: string): boolean {
        if (this.sessions.has(sessionId)) {
            this.currentSessionId = sessionId;
            this.emit('sessionChanged', sessionId);
            return true;
        }
        return false;
    }

    /**
     * 发送消息
     * 
     * @param content - 消息内容
     * @returns 助手回复消息
     * @throws Error - 当没有活跃会话时抛出
     */
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

    /**
     * 流式发送消息
     * 
     * @param content - 消息内容
     * @returns 消息块生成器
     * @throws Error - 当没有活跃会话时抛出
     */
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

    /**
     * 获取当前会话的历史记录
     * 
     * @returns 消息列表
     */
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

    /**
     * 刷新会话历史记录
     * 
     * @param sessionId - 会话ID，默认当前会话
     * @param options - 刷新选项
     * @returns 消息列表
     */
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

    /**
     * 清除当前会话的历史记录
     * 
     * @returns Promise<void>
     */
    public async clearHistory(): Promise<void> {
        const session = this.getCurrentSession();
        if (!session) return;

        await this.service.clearChatHistory(session.id);
        session.messages = [];
        this.emit('historyCleared', session.id);
    }

    /**
     * 关闭会话
     * 
     * @param sessionId - 会话ID，默认当前会话
     */
    public closeSession(sessionId?: string): void {
        const id = sessionId || this.currentSessionId;
        if (!id) return;

        this.sessions.delete(id);

        if (this.currentSessionId === id) {
            this.currentSessionId = null;
        }

        this.emit('sessionClosed', id);
    }

    /**
     * 获取所有会话
     * 
     * @returns 会话列表
     */
    public getAllSessions(): ChatSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * 获取会话数量
     * 
     * @returns 会话数量
     */
    public getSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * 释放资源
     */
    public dispose() {
        this.removeAllListeners();
        this.sessions.clear();
        this.currentSessionId = null;
    }
}
