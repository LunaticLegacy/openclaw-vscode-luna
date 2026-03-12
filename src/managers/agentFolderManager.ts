import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AgentFolder {
    id: string;
    name: string;
    agentIds: string[];
    collapsed: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PersistedAgentFoldersFile {
    version: number;
    folders: AgentFolder[];
}

export class AgentFolderManager extends EventEmitter {
    private readonly storageFilePath: string;
    private readonly folders: Map<string, AgentFolder> = new Map();
    private loaded = false;
    private loadPromise: Promise<void> | null = null;

    constructor(storageFilePath: string) {
        super();
        this.storageFilePath = storageFilePath;
    }

    public async getFolders(refresh: boolean = false): Promise<AgentFolder[]> {
        await this.ensureLoaded(refresh);
        return Array.from(this.folders.values()).sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name)
        );
    }

    public async createFolder(name: string): Promise<AgentFolder> {
        await this.ensureLoaded();

        const now = new Date().toISOString();
        const folder: AgentFolder = {
            id: buildFolderId(name),
            name: requireFolderName(name),
            agentIds: [],
            collapsed: false,
            createdAt: now,
            updatedAt: now
        };

        this.folders.set(folder.id, folder);
        await this.persist();
        this.emit('foldersChanged');
        return folder;
    }

    public async renameFolder(folderId: string, name: string): Promise<AgentFolder> {
        await this.ensureLoaded();
        const existing = this.requireFolder(folderId);
        const updated: AgentFolder = {
            ...existing,
            name: requireFolderName(name),
            updatedAt: new Date().toISOString()
        };

        this.folders.set(folderId, updated);
        await this.persist();
        this.emit('foldersChanged');
        return updated;
    }

    public async deleteFolder(folderId: string): Promise<void> {
        await this.ensureLoaded();
        this.requireFolder(folderId);
        this.folders.delete(folderId);
        await this.persist();
        this.emit('foldersChanged');
    }

    public async setFolderCollapsed(folderId: string, collapsed: boolean): Promise<AgentFolder> {
        await this.ensureLoaded();
        const existing = this.requireFolder(folderId);
        const updated: AgentFolder = {
            ...existing,
            collapsed,
            updatedAt: new Date().toISOString()
        };

        this.folders.set(folderId, updated);
        await this.persist();
        this.emit('foldersChanged');
        return updated;
    }

    public async moveAgentToFolder(agentId: string, folderId: string | null): Promise<void> {
        await this.ensureLoaded();
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return;
        }

        let changed = false;
        for (const [id, folder] of this.folders.entries()) {
            const nextAgentIds = folder.agentIds.filter(currentAgentId => currentAgentId !== normalizedAgentId);
            if (nextAgentIds.length !== folder.agentIds.length) {
                this.folders.set(id, {
                    ...folder,
                    agentIds: nextAgentIds,
                    updatedAt: new Date().toISOString()
                });
                changed = true;
            }
        }

        const normalizedFolderId = typeof folderId === 'string' ? folderId.trim() : '';
        if (normalizedFolderId) {
            const targetFolder = this.requireFolder(normalizedFolderId);
            if (!targetFolder.agentIds.includes(normalizedAgentId)) {
                this.folders.set(normalizedFolderId, {
                    ...targetFolder,
                    agentIds: [...targetFolder.agentIds, normalizedAgentId],
                    updatedAt: new Date().toISOString()
                });
                changed = true;
            }
        }

        if (!changed) {
            return;
        }

        await this.persist();
        this.emit('foldersChanged');
    }

    public async pruneMissingAgents(validAgentIds: string[]): Promise<boolean> {
        await this.ensureLoaded();
        const validSet = new Set(validAgentIds.map(agentId => String(agentId || '').trim()).filter(Boolean));
        let changed = false;

        for (const [folderId, folder] of this.folders.entries()) {
            const nextAgentIds = folder.agentIds.filter(agentId => validSet.has(agentId));
            if (nextAgentIds.length === folder.agentIds.length) {
                continue;
            }

            this.folders.set(folderId, {
                ...folder,
                agentIds: nextAgentIds,
                updatedAt: new Date().toISOString()
            });
            changed = true;
        }

        if (changed) {
            await this.persist();
            this.emit('foldersChanged');
        }

        return changed;
    }

    public dispose(): void {
        this.removeAllListeners();
        this.folders.clear();
        this.loaded = false;
        this.loadPromise = null;
    }

    private requireFolder(folderId: string): AgentFolder {
        const folder = this.folders.get(folderId);
        if (!folder) {
            throw new Error('Agent folder not found.');
        }
        return folder;
    }

    private async ensureLoaded(forceRefresh: boolean = false): Promise<void> {
        if (forceRefresh) {
            this.loaded = false;
        }

        if (this.loaded) {
            return;
        }

        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }

        this.loadPromise = (async () => {
            this.folders.clear();

            try {
                const content = await fs.readFile(this.storageFilePath, 'utf8');
                const data = JSON.parse(content) as PersistedAgentFoldersFile;

                for (const folder of data.folders || []) {
                    const id = String(folder?.id || '').trim();
                    const name = String(folder?.name || '').trim();
                    if (!id || !name) {
                        continue;
                    }

                    this.folders.set(id, {
                        id,
                        name,
                        agentIds: Array.isArray(folder.agentIds)
                            ? folder.agentIds.map(agentId => String(agentId || '').trim()).filter(Boolean)
                            : [],
                        collapsed: Boolean(folder.collapsed),
                        createdAt: folder.createdAt || new Date().toISOString(),
                        updatedAt: folder.updatedAt || folder.createdAt || new Date().toISOString()
                    });
                }
            } catch (error) {
                const maybeNodeError = error as NodeJS.ErrnoException;
                if (maybeNodeError.code !== 'ENOENT') {
                    throw error;
                }
            }

            this.loaded = true;
        })();

        try {
            await this.loadPromise;
        } finally {
            this.loadPromise = null;
        }
    }

    private async persist(): Promise<void> {
        const payload: PersistedAgentFoldersFile = {
            version: 1,
            folders: Array.from(this.folders.values())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }
}

function buildFolderId(name: string): string {
    const normalized = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return `folder:${normalized || 'agents'}:${Date.now()}`;
}

function requireFolderName(name: string): string {
    const normalized = String(name || '').trim();
    if (!normalized) {
        throw new Error('Folder name is required.');
    }
    return normalized;
}
