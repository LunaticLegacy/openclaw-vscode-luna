import * as path from 'path';
import { OpenClawCliServiceConfig } from '../openclawConfig';
import {
    OpenClawAgentRecord,
    OpenClawChatHistoryMessage,
    OpenClawGatewayAgentsResult,
    OpenClawSessionsListEntry
} from '../openclawCli';
import {
    APIUsage,
    ChatMessage,
    ChatMessagePart
} from './types';

interface OpenClawToolCallInfo {
    name: string;
    arguments?: unknown;
}

interface OpenClawSessionLogEntry {
    type?: string;
    id?: string;
    timestamp?: string | number;
    message?: OpenClawChatHistoryMessage;
}

export function extractAssistantText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const data = payload as {
        choices?: Array<{
            message?: {
                content?: unknown;
            };
        }>;
    };
    return extractTextContent(data.choices?.[0]?.message?.content);
}

export function extractTextContent(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(item => extractTextContent(item)).join('');
    }

    if (!value || typeof value !== 'object') {
        return '';
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
        return record.text;
    }

    if (typeof record.content === 'string') {
        return record.content;
    }

    if (Array.isArray(record.content)) {
        return record.content.map(item => extractTextContent(item)).join('');
    }

    return '';
}

export function normalizeOpenClawGatewayToolEvent(
    sessionKey: string,
    payload: Record<string, unknown>
): ChatMessage | null {
    const data = payload.data && typeof payload.data === 'object'
        ? payload.data as Record<string, unknown>
        : null;
    if (!data) {
        return null;
    }

    const phase = typeof data.phase === 'string' ? data.phase : '';
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
    const toolName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'tool';
    const runId = typeof payload.runId === 'string' && payload.runId.trim()
        ? payload.runId.trim()
        : sessionKey;
    const seq = typeof payload.seq === 'number' && Number.isFinite(payload.seq)
        ? payload.seq
        : Date.now();
    const timestamp = typeof payload.ts === 'number' && Number.isFinite(payload.ts)
        ? new Date(payload.ts).toISOString()
        : new Date().toISOString();
    const agentId = parseAgentIdFromSessionKey(sessionKey) || undefined;
    const metadata: Record<string, unknown> = {
        transient: true,
        runId,
        seq,
        stream: 'tool',
        phase
    };

    if (phase === 'start') {
        return {
            id: `${runId}:tool:start:${toolCallId || toolName}:${seq}`,
            role: 'assistant',
            content: '',
            timestamp,
            agentId,
            parts: [{
                type: 'toolCall',
                id: toolCallId,
                name: toolName,
                arguments: data.args
            }],
            metadata: {
                ...metadata,
                stopReason: 'toolUse'
            }
        };
    }

    if (phase === 'result') {
        const resultText = extractTextContent(data.result);
        const isError = Boolean(data.isError);
        return {
            id: `${runId}:tool:result:${toolCallId || toolName}:${seq}`,
            role: 'tool',
            content: resultText,
            timestamp,
            agentId,
            parts: [{
                type: 'toolResult',
                toolCallId,
                name: toolName,
                arguments: data.args,
                result: resultText,
                details: data.result,
                isError
            }],
            toolCallId,
            toolName,
            toolArguments: data.args,
            toolDetails: data.result,
            isError,
            metadata
        };
    }

    return null;
}

export function normalizeOpenClawGatewayLifecycleEvent(
    sessionKey: string,
    payload: Record<string, unknown>
): ChatMessage | null {
    const data = payload.data && typeof payload.data === 'object'
        ? payload.data as Record<string, unknown>
        : null;
    if (!data) {
        return null;
    }

    const notice = buildOpenClawLifecycleNotice(data);
    if (!notice) {
        return null;
    }

    const runId = typeof payload.runId === 'string' && payload.runId.trim()
        ? payload.runId.trim()
        : sessionKey;
    const seq = typeof payload.seq === 'number' && Number.isFinite(payload.seq)
        ? payload.seq
        : Date.now();
    const timestamp = typeof payload.ts === 'number' && Number.isFinite(payload.ts)
        ? new Date(payload.ts).toISOString()
        : new Date().toISOString();

    return {
        id: `${runId}:lifecycle:${seq}`,
        role: 'system',
        content: notice,
        timestamp,
        agentId: parseAgentIdFromSessionKey(sessionKey) || undefined,
        metadata: {
            transient: true,
            runId,
            seq,
            stream: 'lifecycle',
            phase: typeof data.phase === 'string' ? data.phase : '',
            noticeType: 'lifecycle'
        }
    };
}

export function buildSessionKeyMap(sessions: OpenClawSessionsListEntry[]): Map<string, string> {
    const map = new Map<string, string>();

    for (const session of [...sessions].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))) {
        const agentId = session.agentId || parseAgentIdFromSessionKey(session.key);
        if (!agentId || map.has(agentId)) {
            continue;
        }

        map.set(agentId, session.key);
    }

    return map;
}

export function resolvePreferredAgentId(
    records: OpenClawAgentRecord[],
    gatewayAgents: OpenClawGatewayAgentsResult,
    sessionKeysByAgent: Map<string, string>
): string | null {
    for (const agentId of sessionKeysByAgent.keys()) {
        return agentId;
    }

    const defaultId = gatewayAgents.defaultId?.trim();
    if (defaultId) {
        return defaultId;
    }

    const explicitDefault = records.find(record => record.isDefault)?.id?.trim();
    if (explicitDefault) {
        return explicitDefault;
    }

    return records[0]?.id || null;
}

export function parseAgentIdFromSessionKey(sessionKey: string): string | null {
    const normalized = sessionKey.trim();
    if (!normalized) {
        return null;
    }

    const parts = normalized.split(':').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'agent') {
        return null;
    }

    const agentId = parts[1]?.trim();
    return agentId || null;
}

export function normalizeOpenClawChatHistory(messages: OpenClawChatHistoryMessage[], sessionKey: string): ChatMessage[] {
    const agentId = parseAgentIdFromSessionKey(sessionKey) || undefined;
    const toolCalls = new Map<string, OpenClawToolCallInfo>();

    return messages
        .map((message, index) => normalizeOpenClawChatMessage(
            message,
            `${sessionKey}:${index}`,
            agentId,
            toolCalls,
            index
        ))
        .filter((message): message is ChatMessage => Boolean(message));
}

export function normalizeOpenClawChatMessage(
    message: OpenClawChatHistoryMessage,
    fallbackId: string,
    agentId?: string,
    toolCalls: Map<string, OpenClawToolCallInfo> = new Map(),
    sequenceIndex: number = 0
): ChatMessage | null {
    const role = normalizeRole(message.role);
    if (!role) {
        return null;
    }

    if (role === 'tool') {
        const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
        const storedToolCall = toolCallId ? toolCalls.get(toolCallId) : undefined;
        const toolName = typeof message.toolName === 'string'
            ? message.toolName
            : storedToolCall?.name || 'tool';
        const resultText = extractTextContent(message.content) || (typeof message.text === 'string' ? message.text : '');

        return {
            id: fallbackId,
            role: 'tool',
            content: resultText,
            timestamp: normalizeTimestamp(message.timestamp, sequenceIndex),
            agentId,
            parts: [{
                type: 'toolResult',
                toolCallId,
                name: toolName,
                arguments: storedToolCall?.arguments,
                result: resultText,
                details: message.details,
                isError: Boolean(message.isError)
            }],
            toolCallId,
            toolName,
            toolArguments: storedToolCall?.arguments,
            toolDetails: message.details,
            isError: Boolean(message.isError),
            metadata: extractMessageMetadata(message)
        };
    }

    const parts = normalizeOpenClawMessageParts(message.content);
    for (const part of parts) {
        if (part.type === 'toolCall' && part.id) {
            toolCalls.set(part.id, {
                name: part.name,
                arguments: part.arguments
            });
        }
    }

    return {
        id: fallbackId,
        role,
        content: buildDisplayContentFromParts(parts, message as Record<string, unknown>),
        timestamp: normalizeTimestamp(message.timestamp, sequenceIndex),
        agentId,
        parts,
        metadata: extractMessageMetadata(message)
    };
}

export function extractAssistantMessageFromPayload(payload: unknown, sessionKey: string): ChatMessage | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const record = payload as Record<string, unknown>;
    const toolCalls = new Map<string, OpenClawToolCallInfo>();
    if (Array.isArray(record.messages)) {
        const candidate = [...record.messages]
            .reverse()
            .map((message, index) => {
                if (!message || typeof message !== 'object') {
                    return null;
                }

                return normalizeOpenClawChatMessage(
                    message as OpenClawChatHistoryMessage,
                    `${sessionKey}:payload:${index}`,
                    parseAgentIdFromSessionKey(sessionKey) || undefined,
                    toolCalls,
                    index
                );
            })
            .find((message): message is ChatMessage => {
                return message !== null && message.role === 'assistant';
            });

        if (candidate) {
            return candidate;
        }
    }

    if (record.message && typeof record.message === 'object') {
        const candidate = normalizeOpenClawChatMessage(
            record.message as OpenClawChatHistoryMessage,
            `${sessionKey}:payload`,
            parseAgentIdFromSessionKey(sessionKey) || undefined,
            toolCalls,
            0
        );
        if (candidate?.role === 'assistant') {
            return candidate;
        }
    }

    const role = normalizeRole(record.role);
    if (role === 'assistant') {
        const parts = normalizeOpenClawMessageParts(record.content);
        return {
            id: `${sessionKey}:payload`,
            role,
            content: buildDisplayContentFromParts(parts, record),
            timestamp: normalizeTimestamp(record.timestamp, 0),
            agentId: parseAgentIdFromSessionKey(sessionKey) || undefined,
            parts,
            metadata: extractRecordMetadata(record)
        };
    }

    if (record.final && typeof record.final === 'object') {
        return extractAssistantMessageFromPayload(record.final, sessionKey);
    }

    return null;
}

export function normalizeOpenClawSessionLog(
    content: string,
    sessionKey: string,
    agentId?: string,
    limit: number = 200
): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const toolCalls = new Map<string, OpenClawToolCallInfo>();
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) {
            continue;
        }

        let entry: OpenClawSessionLogEntry | null = null;
        try {
            entry = JSON.parse(line) as OpenClawSessionLogEntry;
        } catch {
            continue;
        }

        if (entry?.type === 'message' && entry.message) {
            const normalized = normalizeOpenClawChatMessage(
                {
                    ...entry.message,
                    timestamp: entry.message.timestamp ?? entry.timestamp
                },
                entry.id || `${sessionKey}:log:${index}`,
                agentId,
                toolCalls,
                index
            );

            if (normalized) {
                messages.push(normalized);
            }
            continue;
        }

        if (entry && typeof entry === 'object') {
            const lifecycle = normalizeOpenClawLifecycleEntry(
                entry as Record<string, unknown>,
                sessionKey,
                agentId,
                index
            );
            if (lifecycle) {
                messages.push(lifecycle);
            }
        }
    }

    if (limit <= 0 || messages.length <= limit) {
        return messages;
    }

    return messages.slice(-limit);
}

export function isFinalOpenClawAssistantMessage(message: ChatMessage): boolean {
    if (message.role !== 'assistant') {
        return false;
    }

    if (message.metadata?.stopReason === 'toolUse') {
        return false;
    }

    return true;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    if (timeoutMs <= 0) {
        return Promise.resolve(fallback);
    }

    return new Promise<T>(resolve => {
        const timer = setTimeout(() => resolve(fallback), timeoutMs);

        promise
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve(fallback);
            });
    });
}

export function delay(timeoutMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

export function sanitizeAgentName(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
    return normalized.replace(/^-|-$/g, '') || 'agent';
}

export function normalizeOptionalPath(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function resolveOpenClawRecordWorkspacePath(
    record: OpenClawAgentRecord,
    config: OpenClawCliServiceConfig | null
): string | undefined {
    return normalizeOptionalPath(record.workspace)
        || normalizeOptionalPath(record.agentDir)
        || inferOpenClawWorkspacePath(record.id, config);
}

export function inferOpenClawWorkspacePath(
    agentId: string | undefined,
    config: OpenClawCliServiceConfig | null
): string | undefined {
    const normalizedAgentId = normalizeOptionalPath(agentId);
    if (!normalizedAgentId || !config) {
        return undefined;
    }

    const safeAgentId = sanitizeAgentName(normalizedAgentId);
    if (!config.defaultWorkspacePath) {
        return path.join(config.stateDir, 'workspace', safeAgentId);
    }

    return path.join(path.dirname(config.defaultWorkspacePath), 'agents', safeAgentId);
}

export function extractString(payload: unknown, keys: string[]): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const record = payload as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function normalizeOpenClawMessageParts(content: unknown): ChatMessagePart[] {
    const values = Array.isArray(content) ? content : [content];
    const parts: ChatMessagePart[] = [];

    for (const value of values) {
        if (typeof value === 'string') {
            if (value) {
                parts.push({ type: 'text', text: value });
            }
            continue;
        }

        if (!value || typeof value !== 'object') {
            continue;
        }

        const record = value as Record<string, unknown>;
        const type = typeof record.type === 'string' ? record.type : '';

        if (type === 'text' && typeof record.text === 'string') {
            parts.push({
                type: 'text',
                text: record.text
            });
            continue;
        }

        if (type === 'thinking' && typeof record.thinking === 'string') {
            parts.push({
                type: 'thinking',
                thinking: record.thinking,
                thinkingSignature: typeof record.thinkingSignature === 'string' ? record.thinkingSignature : undefined
            });
            continue;
        }

        if (type === 'toolCall') {
            parts.push({
                type: 'toolCall',
                id: typeof record.id === 'string' ? record.id : undefined,
                name: typeof record.name === 'string' ? record.name : 'tool',
                arguments: record.arguments
            });
            continue;
        }

        const text = extractTextContent(record);
        if (text) {
            parts.push({
                type: 'text',
                text
            });
        }
    }

    return parts;
}

function buildDisplayContentFromParts(parts: ChatMessagePart[], message: Record<string, unknown>): string {
    const text = parts
        .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
        .map(part => part.text)
        .join('');
    if (text) {
        return text;
    }

    const thinking = parts
        .filter((part): part is Extract<ChatMessagePart, { type: 'thinking' }> => part.type === 'thinking')
        .map(part => part.thinking)
        .join('\n\n');
    if (thinking) {
        return thinking;
    }

    return extractTextContent(message.content) || (typeof message.text === 'string' ? message.text : '');
}

function extractMessageMetadata(message: OpenClawChatHistoryMessage): Record<string, unknown> | undefined {
    const metadata = extractRecordMetadata(message as Record<string, unknown>);
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractRecordMetadata(record: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    for (const key of ['api', 'provider', 'model', 'usage', 'stopReason', 'thinkingLevel']) {
        if (record[key] !== undefined) {
            metadata[key] = record[key];
        }
    }

    return metadata;
}

function normalizeRole(value: unknown): ChatMessage['role'] | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.toLowerCase();
    if (normalized === 'user' || normalized === 'assistant' || normalized === 'system') {
        return normalized;
    }

    if (normalized === 'toolresult') {
        return 'tool';
    }

    return null;
}

function normalizeTimestamp(value: unknown, sequenceIndex: number = 0): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }

    if (typeof value === 'string' && value.trim()) {
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }

    const stableIndex = Number.isFinite(sequenceIndex)
        ? Math.max(0, Math.trunc(sequenceIndex))
        : 0;
    return new Date(stableIndex).toISOString();
}

function normalizeOpenClawLifecycleEntry(
    entry: Record<string, unknown>,
    sessionKey: string,
    agentId: string | undefined,
    index: number
): ChatMessage | null {
    const type = typeof entry.type === 'string' ? entry.type : '';
    if (type && type !== 'lifecycle' && type !== 'notice' && type !== 'system') {
        return null;
    }

    const data = entry.data && typeof entry.data === 'object'
        ? entry.data as Record<string, unknown>
        : entry;
    const notice = buildOpenClawLifecycleNotice(data);
    if (!notice) {
        return null;
    }

    return {
        id: typeof entry.id === 'string' && entry.id.trim()
            ? entry.id
            : `${sessionKey}:lifecycle:${index}`,
        role: 'system',
        content: notice,
        timestamp: normalizeTimestamp(entry.timestamp ?? data.timestamp, index),
        agentId,
        metadata: {
            noticeType: 'lifecycle',
            phase: typeof data.phase === 'string' ? data.phase : ''
        }
    };
}

function buildOpenClawLifecycleNotice(data: Record<string, unknown>): string {
    const textFields = [
        data.message,
        data.summary,
        data.reason,
        data.detail,
        data.text
    ].map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean);
    const combined = [
        typeof data.phase === 'string' ? data.phase : '',
        typeof data.event === 'string' ? data.event : '',
        typeof data.kind === 'string' ? data.kind : '',
        ...textFields
    ].join(' ').toLowerCase();

    const fromModel = typeof data.fromModel === 'string' ? data.fromModel.trim() : '';
    const toModel = typeof data.toModel === 'string' ? data.toModel.trim() : '';
    if (fromModel && toModel && fromModel !== toModel) {
        return `Model fallback: ${fromModel} -> ${toModel}`;
    }

    if (/fallback|downgrade/.test(combined)) {
        return textFields[0] || 'Model fallback occurred during this run.';
    }

    if (/compact|compaction|compressed context|context refresh|context compressed/.test(combined)) {
        return textFields[0] || 'Context was compacted during this run.';
    }

    return '';
}
