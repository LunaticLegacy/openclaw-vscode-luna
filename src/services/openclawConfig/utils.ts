import * as fs from 'fs/promises';
import * as path from 'path';

import type { JsonRecord } from './types';

export const DEFAULT_OPENCLAW_GATEWAY_PORT = 18789;

export function normalizeGatewayPort(value: number | undefined): number {
    if (Number.isInteger(value) && value! > 0 && value! <= 65535) {
        return value!;
    }

    return DEFAULT_OPENCLAW_GATEWAY_PORT;
}

export function cloneJsonRecord(value: JsonRecord | null): JsonRecord {
    return JSON.parse(JSON.stringify(value || {})) as JsonRecord;
}

export function ensureJsonRecord(parent: JsonRecord, key: string): JsonRecord {
    const current = parent[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
        return current as JsonRecord;
    }

    const next: JsonRecord = {};
    parent[key] = next;
    return next;
}

export function setOptionalString(
    parent: JsonRecord,
    key: string,
    value: string | undefined,
    options: { trimAsPath?: boolean } = {}
): void {
    const normalized = options.trimAsPath
        ? trimConfigPath(value)
        : value?.trim();

    if (normalized) {
        parent[key] = normalized;
        return;
    }

    delete parent[key];
}

export function pruneEmptyObject(parent: JsonRecord, key: string): void {
    const current = parent[key];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return;
    }

    if (Object.keys(current as JsonRecord).length === 0) {
        delete parent[key];
    }
}

/**
 * 对于配置项，如果用户输入了空字符串或者仅包含空白字符，则视为未设置，返回undefined。
 * @param value 用户输入的字符串，optional……等一下，ts的optional不是要问号吗？
 * @returns 如果输入有效（非空字符串），返回修剪后的字符串；如果输入无效，返回undefined。（沟槽的ts没有optional封装）
 */
export function trimConfigPath(value: string | undefined): string | undefined { 
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function toHttpGatewayUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    if (trimmed.startsWith('ws://')) {
        return `http://${trimmed.slice('ws://'.length)}`;
    }

    if (trimmed.startsWith('wss://')) {
        return `https://${trimmed.slice('wss://'.length)}`;
    }

    return trimmed;
}

export function joinSourceDescriptions(...values: Array<string | undefined>): string {
    return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
        .join(', ');
}

/**
 * 将路径及其父路径添加到集合中，直到达到最大深度或根目录。
 * @param target 要添加路径的集合
 * @param initialPath 初始路径
 * @param maxDepth 最大深度，0表示仅添加初始路径，1表示添加初始路径和其父路径，以此类推
 */
export function addBaseAndParents(target: Set<string>, initialPath: string, maxDepth: number): void {
    let current = path.resolve(initialPath);

    for (let depth = 0; depth <= maxDepth; depth += 1) {
        target.add(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
}

/**
 * 寻找第一个出现的路径。
 * 
 * @param candidates 路径候选列表，按照优先级排序。
 * @returns 
 */
export async function findFirstExistingPath(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

export async function readJsonFile<T>(targetPath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(targetPath, 'utf8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}
