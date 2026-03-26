import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 智能体文件夹接口
 */
export interface AgentFolder {
    id: string;
    name: string;
    agentIds: string[];
    collapsed: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * 持久化的智能体文件夹文件结构
 */
export interface PersistedAgentFoldersFile {
    version: number;
    folders: AgentFolder[];
}

/**
 * 智能体文件夹管理器，负责管理智能体文件夹的创建、重命名、删除和智能体移动
 * 
 * @emits foldersChanged - 当文件夹列表发生变化时触发
 * 
 * @example
 * ```typescript
 * const manager = new AgentFolderManager(storageFilePath);
 * const folder = await manager.createFolder('My Folder');
 * ```
 */
export class AgentFolderManager extends EventEmitter {
    private readonly storageFilePath: string;
    private readonly folders: Map<string, AgentFolder> = new Map();
    private loaded = false;
    private loadPromise: Promise<void> | undefined = undefined;

    /**
     * 创建 AgentFolderManager 实例
     * @param storageFilePath - 存储文件路径
     */
    constructor(storageFilePath: string) {
        super();
        this.storageFilePath = storageFilePath;
    }

    /**
     * 获取所有文件夹
     * 
     * @param refresh - 是否强制刷新
     * @returns 文件夹列表
     */
    public async getFolders(refresh: boolean = false): Promise<AgentFolder[]> {
        await this.ensureLoaded(refresh);
        return Array.from(this.folders.values()).sort((left: any, right: any) =>
            left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name)
        );
    }

    /**
     * 创建新文件夹
     * 
     * @param name - 文件夹名称
     * @returns 创建的文件夹
     */
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

    /**
     * 重命名文件夹
     * 
     * @param folderId - 文件夹ID
     * @param name - 新名称
     * @returns 更新后的文件夹
     */
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

    /**
     * 删除文件夹
     * 
     * @param folderId - 文件夹ID
     * @returns Promise<void>
     */
    public async deleteFolder(folderId: string): Promise<void> {
        await this.ensureLoaded();
        this.requireFolder(folderId);
        this.folders.delete(folderId);
        await this.persist();
        this.emit('foldersChanged');
    }

    /**
     * 设置文件夹折叠状态
     * 
     * @param folderId - 文件夹ID
     * @param collapsed - 是否折叠
     * @returns 更新后的文件夹
     */
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

    /**
     * 移动智能体到指定文件夹
     * 
     * @param agentId - 智能体ID
     * @param folderId - 目标文件夹ID，undefined 表示移出所有文件夹
     * @returns Promise<void>
     */
    public async moveAgentToFolder(agentId: string, folderId: string | undefined): Promise<void> {
        await this.ensureLoaded();
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return;
        }

        let changed = false;
        for (const [id, folder] of this.folders.entries()) {
            const nextAgentIds = folder.agentIds.filter((currentAgentId: any) => currentAgentId !== normalizedAgentId);
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

    /**
     * 清理不存在的智能体引用
     * 
     * @param validAgentIds - 有效的智能体ID列表
     * @returns 是否有变化
     */
    public async pruneMissingAgents(validAgentIds: string[]): Promise<boolean> {
        await this.ensureLoaded();
        const validSet = new Set(validAgentIds.map((agentId: any) => String(agentId || '').trim()).filter(Boolean));
        let changed = false;

        for (const [folderId, folder] of this.folders.entries()) {
            const nextAgentIds = folder.agentIds.filter((agentId: any) => validSet.has(agentId));
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

    /**
     * 释放资源
     */
    public dispose(): void {
        this.removeAllListeners();
        this.folders.clear();
        this.loaded = false;
        this.loadPromise = undefined;
    }

    /**
     * 获取文件夹，不存在则抛出错误
     * @param folderId - 文件夹ID
     * @returns 文件夹对象
     * @throws Error - 当文件夹不存在时抛出
     */
    private requireFolder(folderId: string): AgentFolder {
        const folder = this.folders.get(folderId);
        if (!folder) {
            throw new Error('Agent folder not found.');
        }
        return folder;
    }

    /**
     * 确保数据已加载
     * @param forceRefresh - 是否强制刷新
     */
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
                            ? folder.agentIds.map((agentId: any) => String(agentId || '').trim()).filter(Boolean)
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
            this.loadPromise = undefined;
        }
    }

    /**
     * 持久化数据到磁盘
     */
    private async persist(): Promise<void> {
        const payload: PersistedAgentFoldersFile = {
            version: 1,
            folders: Array.from(this.folders.values())
        };

        await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
        await fs.writeFile(this.storageFilePath, JSON.stringify(payload, undefined, 2), 'utf8');
    }
}

/**
 * 根据名称构建文件夹ID
 * @param name - 文件夹名称
 * @returns 文件夹ID
 */
function buildFolderId(name: string): string {
    const normalized = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return `folder:${normalized || 'agents'}:${Date.now()}`;
}

/**
 * 要求有效的文件夹名称
 * @param name - 文件夹名称
 * @returns 规范化后的名称
 * @throws Error - 当名称为空时抛出
 */
function requireFolderName(name: string): string {
    const normalized = String(name || '').trim();
    if (!normalized) {
        throw new Error('Folder name is required.');
    }
    return normalized;
}
