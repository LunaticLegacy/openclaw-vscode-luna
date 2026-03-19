import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, MemoryStorageAdapter } from './types';

export class LocalMemoryAdapter implements MemoryStorageAdapter {
    public readonly kind = 'local' as const;
    public readonly root: string;
    public ready = false;

    constructor(root: string) {
        this.root = root;
    }

    public async init(): Promise<void> {
        await fs.mkdir(this.root, { recursive: true });
        this.ready = true;
    }

    public async ensureDir(relativePath: string): Promise<void> {
        const target = this.resolve(relativePath);
        await fs.mkdir(target, { recursive: true });
    }

    public async readFile(relativePath: string): Promise<Buffer> {
        return await fs.readFile(this.resolve(relativePath));
    }

    public async writeFile(relativePath: string, content: Buffer | string): Promise<void> {
        const target = this.resolve(relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
    }

    public async deleteFile(relativePath: string): Promise<void> {
        await fs.rm(this.resolve(relativePath), { force: true });
    }

    public async exists(relativePath: string): Promise<boolean> {
        try {
            await fs.stat(this.resolve(relativePath));
            return true;
        } catch {
            return false;
        }
    }

    public async list(relativePath: string): Promise<MemoryEntry[]> {
        const root = this.resolve(relativePath);
        return await listRecursive(root, relativePath);
    }

    private resolve(relativePath: string): string {
        const safe = relativePath ? relativePath.replace(/^\/+/, '') : '';
        return path.join(this.root, safe);
    }
}

async function listRecursive(absoluteRoot: string, relativeRoot: string): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    let dirents: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>; 

    try {
        dirents = await fs.readdir(absoluteRoot, { withFileTypes: true });
    } catch {
        return entries;
    }

    for (const entry of dirents) {
        const absolutePath = path.join(absoluteRoot, entry.name);
        const relativePath = path.join(relativeRoot, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) {
            entries.push({ path: relativePath, kind: 'dir' });
            const nested = await listRecursive(absolutePath, relativePath);
            entries.push(...nested);
        } else if (entry.isFile()) {
            const stat = await fs.stat(absolutePath).catch(() => null);
            entries.push({
                path: relativePath,
                kind: 'file',
                size: stat?.size,
                modifiedAt: stat ? new Date(stat.mtimeMs).toISOString() : undefined
            });
        }
    }

    return entries;
}
