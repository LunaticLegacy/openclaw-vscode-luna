import * as fs from 'fs/promises';
import * as path from 'path';

import { pathExists } from './utils';

export interface RuntimeLogFileEntry {
    path: string;
    size: number;
    modifiedAt: string;
    truncated: boolean;
    content: string;
}

export interface RuntimeLogCollection {
    scannedRoot: string | undefined;
    rootEntries: string[];
    fileCount: number;
    scanTruncated: boolean;
    files: RuntimeLogFileEntry[];
}

interface CollectRuntimeLogFileOptions {
    maxFiles?: number;
    maxFileBytes?: number;
    maxScannedEntries?: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_SCANNED_ENTRIES = 1200;
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:gatewaytoken|configuredgatewaytoken|detectedgatewaytoken|authapikey|api[_-]?key|token|secret|password)$/i;

export function redactRuntimeExportSecrets<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item: any) => redactRuntimeExportSecrets(item)) as T;
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const source = value as Record<string, unknown>;
    const clone: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(source)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            clone[key] = nestedValue ? REDACTED_VALUE : nestedValue;
            continue;
        }

        clone[key] = redactRuntimeExportSecrets(nestedValue);
    }

    return clone as T;
}

export async function collectRuntimeLogFiles(
    stateDir: string,
    options: CollectRuntimeLogFileOptions = {}
): Promise<RuntimeLogCollection> {
    const normalizedRoot = stateDir.trim();
    if (!normalizedRoot || !(await pathExists(normalizedRoot))) {
        return {
            scannedRoot: undefined,
            rootEntries: [],
            fileCount: 0,
            scanTruncated: false,
            files: []
        };
    }

    const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
    const maxFileBytes = Math.max(1024, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    const maxScannedEntries = Math.max(maxFiles, options.maxScannedEntries ?? DEFAULT_MAX_SCANNED_ENTRIES);
    const files: RuntimeLogFileEntry[] = [];
    const queue = [normalizedRoot];
    let scannedEntries = 0;
    let scanTruncated = false;

    const rootEntries = (await fs.readdir(normalizedRoot).catch(() => []))
        .map((entry: any) => entry.trim())
        .filter(Boolean)
        .sort((left: any, right: any) => left.localeCompare(right));

    while (queue.length > 0 && files.length < maxFiles && scannedEntries < maxScannedEntries) {
        const currentDir = queue.shift()!;
        const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);

        for (const entry of entries) {
            scannedEntries += 1;
            if (scannedEntries > maxScannedEntries || files.length >= maxFiles) {
                scanTruncated = true;
                break;
            }

            const absolutePath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                queue.push(absolutePath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const relativePath = normalizeRelativePath(path.relative(normalizedRoot, absolutePath));
            if (!shouldIncludeRuntimeLogFile(relativePath)) {
                continue;
            }

            const stats = await fs.stat(absolutePath).catch(() => undefined);
            const buffer = await fs.readFile(absolutePath).catch(() => undefined);
            if (!stats || !buffer) {
                continue;
            }

            const truncated = buffer.byteLength > maxFileBytes;
            files.push({
                path: relativePath,
                size: stats.size,
                modifiedAt: stats.mtime.toISOString(),
                truncated,
                content: buffer.subarray(0, maxFileBytes).toString('utf8')
            });
        }
    }

    if (queue.length > 0) {
        scanTruncated = true;
    }

    files.sort((left: any, right: any) => right.modifiedAt.localeCompare(left.modifiedAt) || left.path.localeCompare(right.path));

    return {
        scannedRoot: normalizedRoot,
        rootEntries,
        fileCount: files.length,
        scanTruncated,
        files
    };
}

function shouldIncludeRuntimeLogFile(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath).toLowerCase();
    if (!normalized) {
        return false;
    }

    if (normalized.includes('/sessions/')) {
        return false;
    }

    if (normalized.startsWith('cron/')) {
        return normalized.endsWith('.json')
            || normalized.endsWith('.jsonl')
            || normalized.endsWith('.log')
            || normalized.endsWith('.txt');
    }

    return normalized.endsWith('.log')
        || normalized.endsWith('.txt')
        || normalized.includes('/logs/')
        || normalized.startsWith('logs/')
        || normalized.includes('.log.');
}

function normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
}
