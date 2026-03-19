import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import WebSocket, { RawData } from 'ws';

export interface OpenClawGatewayClientOptions {
    url: string;
    token?: string;
    timeoutMs?: number;
    clientId?: string;
    clientDisplayName?: string;
    clientVersion?: string;
    caps?: string[];
}

export interface GatewayEventFrame {
    type: 'event';
    event: string;
    payload?: unknown;
    seq?: number;
    stateVersion?: {
        presence: number;
        health: number;
    };
}

interface GatewayResponseFrame {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: unknown;
    error?: {
        message?: string;
    };
}

interface GatewayHelloOk {
    type?: 'hello-ok';
}

interface PendingRequest {
    expectFinal: boolean;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

const PROTOCOL_VERSION = 3;

/**
 * OpenClaw Gateway WebSocket 客户端
 * 
 * 提供与 OpenClaw Gateway 的 WebSocket 连接管理、请求发送和事件处理功能
 * 
 * @example
 * ```typescript
 * const client = new OpenClawGatewayClient({ url: 'ws://localhost:3000' });
 * await client.connect();
 * const result = await client.request('method', params);
 * client.dispose();
 * ```
 */
export class OpenClawGatewayClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private connected = false;
    private connectPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private intentionalClose = false;

    /**
     * 创建 Gateway 客户端实例
     * @param options - 客户端配置选项
     */
    constructor(private readonly options: OpenClawGatewayClientOptions) {
        super();
    }

    /**
     * 连接到 Gateway
     * @throws Error - 连接失败时抛出
     */
    public async connect(): Promise<void> {
        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.intentionalClose = false;
        this.connectPromise = this.createConnection();

        try {
            await this.connectPromise;
        } finally {
            if (!this.connected) {
                this.connectPromise = null;
            }
        }
    }

    /**
     * 发送请求到 Gateway
     * @param method - 请求方法名
     * @param params - 请求参数
     * @param options - 请求选项
     * @returns 请求结果
     * @throws Error - 请求失败或超时时抛出
     */
    public async request<T = Record<string, unknown>>(
        method: string,
        params?: unknown,
        options: {
            expectFinal?: boolean;
            timeoutMs?: number;
        } = {}
    ): Promise<T> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Gateway not connected');
        }

        if (!this.connected && method !== 'connect') {
            throw new Error('Gateway handshake not completed');
        }

        const id = crypto.randomUUID();
        const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 30000;

        const promise = new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Gateway request timed out: ${method}`));
            }, timeoutMs);

            this.pending.set(id, {
                expectFinal: options.expectFinal === true,
                resolve: value => resolve(value as T),
                reject,
                timer
            });
        });

        this.ws.send(JSON.stringify({
            type: 'req',
            id,
            method,
            params
        }), (error?: Error) => {
            if (!error) {
                return;
            }

            const pending = this.pending.get(id);
            if (!pending) {
                return;
            }

            clearTimeout(pending.timer);
            this.pending.delete(id);
            pending.reject(normalizeError(error));
        });

        return promise;
    }

    /**
     * 释放客户端资源，断开连接
     */
    public dispose(): void {
        this.intentionalClose = true;
        this.connected = false;
        this.connectPromise = null;

        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Gateway client disposed'));
            this.pending.delete(id);
        }

        if (!this.ws) {
            return;
        }

        try {
            this.ws.close();
        } catch {
            this.ws.terminate();
        }

        this.ws = null;
        this.removeAllListeners();
    }

    /**
     * 创建 WebSocket 连接
     * @returns 连接完成的 Promise
     */
    private createConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = toWebSocketUrl(this.options.url);
            const ws = new WebSocket(url);
            this.ws = ws;

            let settled = false;
            let timeout: NodeJS.Timeout | null = null;
            const settle = (error?: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            };

            timeout = setTimeout(() => {
                settle(new Error('Gateway connect timeout'));
            }, this.options.timeoutMs ?? 15000);

            ws.on('message', (raw: RawData) => {
                this.handleMessage(raw, settle);
            });

            ws.on('error', (error: Error) => {
                const normalized = normalizeError(error);
                if (!settled) {
                    settle(normalized);
                } else {
                    this.emit('error', normalized);
                }
            });

            ws.on('close', (code: number, reason: Buffer) => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                this.connected = false;
                this.connectPromise = null;

                const normalizedReason = typeof reason === 'string'
                    ? reason
                    : Buffer.isBuffer(reason)
                        ? reason.toString('utf8')
                        : '';

                if (!this.intentionalClose) {
                    const error = new Error(`Gateway connection closed (${code}${normalizedReason ? `: ${normalizedReason}` : ''})`);
                    this.rejectAllPending(error);
                    this.emit('close', { code, reason: normalizedReason, intentional: false });
                    if (!settled) {
                        settle(error);
                    }
                } else {
                    this.rejectAllPending(new Error('Gateway connection closed'));
                    this.emit('close', { code, reason: normalizedReason, intentional: true });
                    if (!settled) {
                        settle();
                    }
                }
            });
        });
    }

    /**
     * 处理收到的 WebSocket 消息
     * @param raw - 原始消息数据
     * @param settleConnect - 连接完成的回调函数
     */
    private handleMessage(raw: RawData, settleConnect: (error?: Error) => void): void {
        const text = typeof raw === 'string'
            ? raw
            : Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf8')
                    : '';

        let parsed: GatewayEventFrame | GatewayResponseFrame;
        try {
            parsed = JSON.parse(text) as GatewayEventFrame | GatewayResponseFrame;
        } catch (error) {
            this.emit('error', normalizeError(error));
            return;
        }

        if (parsed.type === 'event') {
            if (parsed.event === 'connect.challenge') {
                const payload = parsed.payload as { nonce?: unknown } | undefined;
                const nonce = typeof payload?.nonce === 'string' ? payload.nonce.trim() : '';
                if (!nonce) {
                    settleConnect(new Error('Gateway connect challenge missing nonce'));
                    return;
                }

                this.request<GatewayHelloOk>('connect', this.buildConnectParams(nonce), {
                    timeoutMs: this.options.timeoutMs ?? 15000
                }).then(payloadValue => {
                    if (payloadValue?.type && payloadValue.type !== 'hello-ok') {
                        throw new Error(`Unexpected gateway hello payload: ${payloadValue.type}`);
                    }

                    this.connected = true;
                    this.connectPromise = null;
                    settleConnect();
                }).catch(error => {
                    settleConnect(normalizeError(error));
                });
                return;
            }

            this.emit('event', parsed);
            return;
        }

        const pending = this.pending.get(parsed.id);
        if (!pending) {
            return;
        }

        const status = getPayloadStatus(parsed.payload);
        if (pending.expectFinal && (status === 'accepted' || status === 'started' || status === 'in_flight')) {
            return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);

        if (parsed.ok) {
            pending.resolve(parsed.payload);
            return;
        }

        pending.reject(new Error(parsed.error?.message || 'Gateway request failed'));
    }

    /**
     * 构建连接认证参数
     * @param nonce - 服务器提供的随机数
     * @returns 连接参数对象
     */
    private buildConnectParams(nonce: string): Record<string, unknown> {
        const token = this.options.token?.trim() || undefined;

        return {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
                id: this.options.clientId || 'gateway-client',
                displayName: this.options.clientDisplayName || 'OpenClaw VS Code',
                version: this.options.clientVersion || 'vscode-plugin',
                platform: process.platform,
                mode: 'backend'
            },
            caps: this.options.caps || [],
            auth: token ? { token } : undefined,
            role: 'operator',
            scopes: ['operator.admin']
        };
    }

    /**
     * 拒绝所有待处理的请求
     * @param error - 拒绝原因错误
     */
    private rejectAllPending(error: Error): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}

function getPayloadStatus(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const status = (payload as Record<string, unknown>).status;
    return typeof status === 'string' ? status : undefined;
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(String(error));
}

function toWebSocketUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Gateway URL is empty');
    }

    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
        return trimmed;
    }

    if (trimmed.startsWith('http://')) {
        return `ws://${trimmed.slice('http://'.length)}`;
    }

    if (trimmed.startsWith('https://')) {
        return `wss://${trimmed.slice('https://'.length)}`;
    }

    return `ws://${trimmed}`;
}
