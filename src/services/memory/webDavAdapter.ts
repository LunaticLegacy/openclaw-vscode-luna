import { MemoryEntry, MemoryStorageAdapter } from './types';

export class WebDavMemoryAdapter implements MemoryStorageAdapter {
    public readonly kind = 'webdav' as const;
    public readonly root: string;
    public ready = false;

    constructor(root: string) {
        this.root = root;
    }

    public async init(): Promise<void> {
        this.ready = false;
        throw new Error('WebDAV memory backend is not configured yet.');
    }

    public async ensureDir(_relativePath: string): Promise<void> {
        throw new Error('WebDAV memory backend is not configured yet.');
    }

    public async readFile(_relativePath: string): Promise<Buffer> {
        throw new Error('WebDAV memory backend is not configured yet.');
    }

    public async writeFile(_relativePath: string, _content: Buffer | string): Promise<void> {
        throw new Error('WebDAV memory backend is not configured yet.');
    }

    public async deleteFile(_relativePath: string): Promise<void> {
        throw new Error('WebDAV memory backend is not configured yet.');
    }

    public async exists(_relativePath: string): Promise<boolean> {
        return false;
    }

    public async list(_relativePath: string): Promise<MemoryEntry[]> {
        return [];
    }
}
