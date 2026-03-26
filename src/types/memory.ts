export type MemoryBackendKind = 'local' | 'webdav' | 'custom';

export interface MemoryEntry {
    path: string;
    kind: 'file' | 'dir';
    size?: number;
    modifiedAt?: string;
}

export interface MemoryStorageAdapter {
    kind: MemoryBackendKind;
    root: string;
    ready: boolean;
    init(): Promise<void>;
    ensureDir(relativePath: string): Promise<void>;
    readFile(relativePath: string): Promise<Buffer>;
    writeFile(relativePath: string, content: Buffer | string): Promise<void>;
    deleteFile(relativePath: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
    list(relativePath: string): Promise<MemoryEntry[]>;
}

export interface MemoryStatus {
    backend: MemoryBackendKind;
    root: string;
    ready: boolean;
    lastSyncAt?: string;
    lastError?: string;
    lastEvent?: string;
}

export interface MemoryExportResult {
    exportedAt: string;
    targetPath: string;
    fileCount: number;
}
