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
