import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveOpenClawConfigStateDir } from '../openclawConfig/discovery';
import { AGENT_SETTINGS_FILE, CORE_FILES, MEMORY_LAYOUT, MEMORY_LAYOUT_VERSION } from './layout';
import { LocalMemoryAdapter } from './localAdapter';
import { WebDavMemoryAdapter } from './webDavAdapter';
import type { MemoryBackendKind, MemoryExportResult, MemoryStatus, MemoryStorageAdapter } from './types';

const MEMORY_STATUS_FILE = `${MEMORY_LAYOUT.meta}/status.json`;

export class MemoryService {
    private adapter: MemoryStorageAdapter | null = null;
    private status: MemoryStatus = {
        backend: 'local',
        root: '',
        ready: false
    };
    private initialized = false;

    constructor(private context: vscode.ExtensionContext, private extensionPath: string) {}

    public async getStatus(): Promise<MemoryStatus> {
        await this.ensureInitialized();
        return { ...this.status };
    }

    public async refreshStatus(): Promise<MemoryStatus> {
        this.initialized = false;
        await this.ensureInitialized();
        return { ...this.status };
    }

    public async persistAgentWorkspace(agentId: string, workspacePath: string, reason: string = 'agent-sync'): Promise<void> {
        await this.ensureInitialized();
        if (!this.adapter?.ready) {
            this.markError('Memory backend not ready.');
            return;
        }

        const safeAgentId = sanitizeSegment(agentId || 'agent');
        if (!safeAgentId) {
            return;
        }

        const targets: Array<{ source: string; destination: string }> = [
            CORE_FILES.system,
            CORE_FILES.identity,
            CORE_FILES.soul,
            CORE_FILES.user
        ].map(fileName => ({
            source: path.join(workspacePath, fileName),
            destination: path.join(MEMORY_LAYOUT.agents, safeAgentId, MEMORY_LAYOUT.core, fileName)
        }));

        targets.push({
            source: path.join(workspacePath, AGENT_SETTINGS_FILE),
            destination: path.join(MEMORY_LAYOUT.agents, safeAgentId, AGENT_SETTINGS_FILE)
        });

        let wrote = 0;
        for (const target of targets) {
            const content = await safeReadFile(target.source);
            if (content === null) {
                continue;
            }
            await this.adapter.writeFile(target.destination, content);
            wrote += 1;
        }

        if (wrote > 0) {
            await this.recordSync({
                event: reason,
                summary: `Synced ${wrote} files for agent ${safeAgentId}`
            });
        }
    }

    public async persistClusterExport(options: {
        baseName: string;
        kind: 'raw' | 'readable';
        content: string;
        clusterId: string;
        mode?: string;
    }): Promise<void> {
        await this.ensureInitialized();
        if (!this.adapter?.ready) {
            this.markError('Memory backend not ready.');
            return;
        }

        const safeCluster = sanitizeSegment(options.clusterId || 'cluster');
        const safeName = sanitizeSegment(options.baseName || 'export');
        const timestamp = buildTimestamp();
        const extension = options.kind === 'raw' ? 'json' : 'md';
        const relativePath = path.join(
            MEMORY_LAYOUT.swarm,
            MEMORY_LAYOUT.exports,
            safeCluster,
            `${safeName}-${timestamp}.${extension}`
        );

        await this.adapter.writeFile(relativePath, options.content);
        await this.recordSync({
            event: 'cluster-export',
            summary: `Exported ${options.kind} context for ${safeCluster}`
        });
    }

    public async exportBundle(targetDir: string): Promise<MemoryExportResult> {
        await this.ensureInitialized();
        if (!this.adapter?.ready) {
            throw new Error('Memory backend not ready.');
        }

        await fs.mkdir(targetDir, { recursive: true });

        const entries = await this.adapter.list('');
        const files = entries.filter(entry => entry.kind === 'file');
        for (const entry of files) {
            const content = await this.adapter.readFile(entry.path);
            const targetPath = path.join(targetDir, entry.path);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, content);
        }

        const exportedAt = new Date().toISOString();
        const manifest = {
            exportedAt,
            layoutVersion: MEMORY_LAYOUT_VERSION,
            backend: this.status.backend,
            root: this.status.root,
            fileCount: files.length
        };
        await fs.writeFile(path.join(targetDir, 'memory-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await this.recordSync({ event: 'export', summary: `Exported memory bundle (${files.length} files).` });

        return {
            exportedAt,
            targetPath: targetDir,
            fileCount: files.length
        };
    }

    public async importBundle(sourceDir: string): Promise<void> {
        await this.ensureInitialized();
        if (!this.adapter?.ready) {
            throw new Error('Memory backend not ready.');
        }

        const entries = await listLocalFiles(sourceDir);
        for (const entry of entries) {
            const relative = entry.relativePath;
            if (relative === 'memory-manifest.json') {
                continue;
            }
            const content = await fs.readFile(entry.absolutePath);
            await this.adapter.writeFile(relative, content);
        }

        await this.recordSync({ event: 'import', summary: `Imported memory bundle (${entries.length} files).` });
    }

    public async getLocalRoot(): Promise<string | null> {
        await this.ensureInitialized();
        if (this.adapter?.kind === 'local') {
            return this.adapter.root;
        }
        return null;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const config = vscode.workspace.getConfiguration('openclaw');
        const backend = (config.get<string>('memoryBackend', 'local') || 'local') as MemoryBackendKind;
        const rootOverride = String(config.get<string>('memoryRoot', '') || process.env.OPENCLAW_MEMORY_ROOT || '').trim();

        let root = rootOverride;
        if (!root) {
            const stateDir = await resolveOpenClawConfigStateDir(config, this.extensionPath);
            root = path.join(stateDir, 'memory');
        }

        this.status = {
            backend,
            root,
            ready: false
        };

        try {
            if (backend === 'webdav') {
                const webDavRoot = String(config.get<string>('memoryWebDavUrl', '') || '').trim();
                if (!webDavRoot) {
                    throw new Error('WebDAV URL is not configured.');
                }
                this.adapter = new WebDavMemoryAdapter(webDavRoot);
            } else {
                this.adapter = new LocalMemoryAdapter(root);
            }

            await this.adapter.init();
            await this.ensureLayout();
            await this.loadStatusFromStorage();
            this.status.ready = this.adapter.ready;
            this.initialized = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.markError(message);
            this.initialized = true;
        }
    }

    private async ensureLayout(): Promise<void> {
        if (!this.adapter) {
            return;
        }
        const baseFolders = Object.values(MEMORY_LAYOUT).filter(value => value !== MEMORY_LAYOUT.meta);
        for (const folder of baseFolders) {
            await this.adapter.ensureDir(folder);
        }
        await this.adapter.ensureDir(MEMORY_LAYOUT.meta);
    }

    private async recordSync(options: { event: string; summary: string }): Promise<void> {
        const now = new Date().toISOString();
        this.status.lastSyncAt = now;
        this.status.lastEvent = options.event;
        this.status.lastError = undefined;

        if (!this.adapter) {
            return;
        }

        const payload = {
            updatedAt: now,
            lastEvent: options.event,
            summary: options.summary,
            backend: this.status.backend,
            root: this.status.root,
            layoutVersion: MEMORY_LAYOUT_VERSION
        };

        try {
            await this.adapter.writeFile(MEMORY_STATUS_FILE, JSON.stringify(payload, null, 2));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.markError(message);
        }
    }

    private async loadStatusFromStorage(): Promise<void> {
        if (!this.adapter) {
            return;
        }
        try {
            if (await this.adapter.exists(MEMORY_STATUS_FILE)) {
                const raw = await this.adapter.readFile(MEMORY_STATUS_FILE);
                const parsed = JSON.parse(raw.toString('utf8')) as { updatedAt?: string; lastEvent?: string };
                if (parsed.updatedAt) {
                    this.status.lastSyncAt = parsed.updatedAt;
                }
                if (parsed.lastEvent) {
                    this.status.lastEvent = parsed.lastEvent;
                }
            }
        } catch {
            // Ignore read failures.
        }
    }

    private markError(message: string) {
        this.status.ready = false;
        this.status.lastError = message;
    }
}

async function safeReadFile(targetPath: string): Promise<Buffer | null> {
    try {
        return await fs.readFile(targetPath);
    } catch {
        return null;
    }
}

function sanitizeSegment(value: string): string {
    return String(value || '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function buildTimestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function listLocalFiles(root: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
    const entries: Array<{ absolutePath: string; relativePath: string }> = [];
    const dirents = await fs.readdir(root, { withFileTypes: true });
    for (const dirent of dirents) {
        const absolutePath = path.join(root, dirent.name);
        const relativePath = dirent.name;
        if (dirent.isDirectory()) {
            const nested = await listLocalFiles(absolutePath);
            nested.forEach(entry => {
                entries.push({
                    absolutePath: entry.absolutePath,
                    relativePath: path.join(relativePath, entry.relativePath).replace(/\\/g, '/')
                });
            });
        } else if (dirent.isFile()) {
            entries.push({ absolutePath, relativePath });
        }
    }
    return entries;
}
