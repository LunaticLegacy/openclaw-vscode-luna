import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { getStateDirCandidates } from '../services/openclawConfig/discovery';
import { findFirstExistingPath } from '../services/openclawConfig/utils';

export interface IdentityPreset {
    id: string;
    name?: string;
    nameKey?: string;
    identity?: string;
    stance?: string;
    wakeKeywords?: string[];
}

export interface SwarmPresetMemberProfile {
    identity?: string;
    stance?: string;
    presetIdentityId?: string;
}

export interface SwarmPresetMemberBlueprint {
    id: string;
    nameTemplate: string;
    presetId: string;
    model?: string;
    isCoordinator?: boolean;
    parentId?: string;
    systemPromptAppend?: string;
    activation?: {
        keywords?: string[];
        swarmModes?: Array<'broadcast' | 'collaborate'>;
    };
    profile?: SwarmPresetMemberProfile;
}

export interface SwarmPreset {
    id: string;
    nameTemplate: string;
    name?: string;
    nameKey?: string;
    description?: string;
    descriptionKey?: string;
    tags?: string[];
    workspaceConfig?: Record<string, unknown>;
    memberBlueprints: SwarmPresetMemberBlueprint[];
    recommendedSkills?: string[];
    onboardingMessageTemplate?: string;
}

interface PresetRoots {
    bundledRoot: string;
    userRoot?: string;
}

export async function loadSwarmPresets(extensionPath: string): Promise<SwarmPreset[]> {
    const roots = await resolvePresetRoots(extensionPath);
    const bundledPresets = await readPresetDirectory<SwarmPreset>(
        path.join(roots.bundledRoot, 'swarms'),
        normalizeSwarmPreset
    );
    const userPresets = roots.userRoot
        ? await readPresetDirectory<SwarmPreset>(
            path.join(roots.userRoot, 'swarms'),
            normalizeSwarmPreset
        )
        : [];
    return mergePresets(bundledPresets, userPresets);
}

export async function loadIdentityPresets(extensionPath: string): Promise<IdentityPreset[]> {
    const roots = await resolvePresetRoots(extensionPath);
    const bundledPresets = await readPresetDirectory<IdentityPreset>(
        path.join(roots.bundledRoot, 'identities'),
        normalizeIdentityPreset
    );
    const userPresets = roots.userRoot
        ? await readPresetDirectory<IdentityPreset>(
            path.join(roots.userRoot, 'identities'),
            normalizeIdentityPreset
        )
        : [];
    return mergePresets(bundledPresets, userPresets);
}

async function resolvePresetRoots(extensionPath: string): Promise<PresetRoots> {
    const bundledRoot = path.join(extensionPath, 'src', 'presets');
    const config = vscode.workspace.getConfiguration('openclaw');
    const stateDir = await findFirstExistingPath(getStateDirCandidates(config, extensionPath));
    const userRoot = stateDir ? path.join(stateDir, 'presets') : undefined;
    return { bundledRoot, userRoot };
}

async function readPresetDirectory<T>(
    dirPath: string,
    normalize: (value: unknown) => T | undefined
): Promise<T[]> {
    let entries: Array<{ name: string; isFile: () => boolean }>;
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const presets: T[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
            continue;
        }
        const targetPath = path.join(dirPath, entry.name);
        try {
            const raw = await fs.readFile(targetPath, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                const normalized = normalize(item);
                if (normalized) {
                    presets.push(normalized);
                } else {
                    console.warn(`[openclaw] Preset ignored (invalid): ${targetPath}`);
                }
            }
        } catch (error) {
            console.warn(`[openclaw] Failed to load preset: ${targetPath}`, error);
        }
    }

    return presets;
}

function mergePresets<T extends { id: string }>(bundled: T[], user: T[]): T[] {
    const byId = new Map<string, T>();
    bundled.forEach((preset: any) => {
        byId.set(preset.id, preset);
    });
    user.forEach((preset: any) => {
        byId.set(preset.id, preset);
    });
    return Array.from(byId.values());
}

function normalizeIdentityPreset(value: unknown): IdentityPreset | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) {
        return undefined;
    }
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const nameKey = typeof record.nameKey === 'string' ? record.nameKey.trim() : '';
    const identity = typeof record.identity === 'string' ? record.identity.trim() : '';
    const stance = typeof record.stance === 'string' ? record.stance.trim() : '';
    const wakeKeywords = Array.isArray(record.wakeKeywords)
        ? record.wakeKeywords
            .map((keyword: any) => typeof keyword === 'string' ? keyword.trim() : '')
            .filter(Boolean)
        : undefined;

    return {
        id,
        ...(name ? { name } : {}),
        ...(nameKey ? { nameKey } : {}),
        ...(identity ? { identity } : {}),
        ...(stance ? { stance } : {}),
        ...(wakeKeywords && wakeKeywords.length > 0 ? { wakeKeywords } : {})
    };
}

function normalizeSwarmPreset(value: unknown): SwarmPreset | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const nameTemplate = typeof record.nameTemplate === 'string' ? record.nameTemplate.trim() : '';
    if (!id || !nameTemplate) {
        return undefined;
    }
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const nameKey = typeof record.nameKey === 'string' ? record.nameKey.trim() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const descriptionKey = typeof record.descriptionKey === 'string' ? record.descriptionKey.trim() : '';
    const tags = Array.isArray(record.tags)
        ? record.tags.map((tag: any) => typeof tag === 'string' ? tag.trim() : '').filter(Boolean)
        : undefined;
    const workspaceConfig = record.workspaceConfig && typeof record.workspaceConfig === 'object' && !Array.isArray(record.workspaceConfig)
        ? { ...(record.workspaceConfig as Record<string, unknown>) }
        : undefined;
    const recommendedSkills = Array.isArray(record.recommendedSkills)
        ? record.recommendedSkills.map((skill: any) => typeof skill === 'string' ? skill.trim() : '').filter(Boolean)
        : undefined;
    const onboardingMessageTemplate = typeof record.onboardingMessageTemplate === 'string'
        ? record.onboardingMessageTemplate.trim()
        : '';

    const memberBlueprints = Array.isArray(record.memberBlueprints)
        ? record.memberBlueprints
            .map((raw: any) => normalizeSwarmPresetMemberBlueprint(raw))
            .filter((item: any): item is SwarmPresetMemberBlueprint => Boolean(item))
        : [];

    return {
        id,
        nameTemplate,
        ...(name ? { name } : {}),
        ...(nameKey ? { nameKey } : {}),
        ...(description ? { description } : {}),
        ...(descriptionKey ? { descriptionKey } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
        ...(workspaceConfig ? { workspaceConfig } : {}),
        memberBlueprints,
        ...(recommendedSkills && recommendedSkills.length > 0 ? { recommendedSkills } : {}),
        ...(onboardingMessageTemplate ? { onboardingMessageTemplate } : {})
    };
}

function normalizeSwarmPresetMemberBlueprint(value: unknown): SwarmPresetMemberBlueprint | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const nameTemplate = typeof record.nameTemplate === 'string' ? record.nameTemplate.trim() : '';
    const presetId = typeof record.presetId === 'string' ? record.presetId.trim() : '';
    if (!id || !nameTemplate || !presetId) {
        return undefined;
    }

    const model = typeof record.model === 'string' ? record.model.trim() : '';
    const parentId = typeof record.parentId === 'string' ? record.parentId.trim() : '';
    const systemPromptAppend = typeof record.systemPromptAppend === 'string' ? record.systemPromptAppend.trim() : '';
    const activation = normalizeSwarmActivation(record.activation);
    const profile = normalizeSwarmPresetProfile(record.profile);

    return {
        id,
        nameTemplate,
        presetId,
        ...(model ? { model } : {}),
        ...(typeof record.isCoordinator === 'boolean' ? { isCoordinator: record.isCoordinator } : {}),
        ...(parentId ? { parentId } : {}),
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
        ...(activation ? { activation } : {}),
        ...(profile ? { profile } : {})
    };
}

function normalizeSwarmPresetProfile(value: unknown): SwarmPresetMemberProfile | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const identity = typeof record.identity === 'string' ? record.identity.trim() : '';
    const stance = typeof record.stance === 'string' ? record.stance.trim() : '';
    const presetIdentityId = typeof record.presetIdentityId === 'string' ? record.presetIdentityId.trim() : '';
    if (!identity && !stance && !presetIdentityId) {
        return undefined;
    }
    return {
        ...(identity ? { identity } : {}),
        ...(stance ? { stance } : {}),
        ...(presetIdentityId ? { presetIdentityId } : {})
    };
}

function normalizeSwarmActivation(value: unknown): SwarmPresetMemberBlueprint['activation'] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const swarmModes = Array.isArray(record.swarmModes)
        ? record.swarmModes.filter((mode: any): mode is 'broadcast' | 'collaborate' => mode === 'broadcast' || mode === 'collaborate')
        : undefined;
    const keywords = Array.isArray(record.keywords)
        ? record.keywords.map((keyword: any) => typeof keyword === 'string' ? keyword.trim() : '').filter(Boolean)
        : undefined;
    if ((!swarmModes || swarmModes.length === 0) && (!keywords || keywords.length === 0)) {
        return undefined;
    }
    return {
        ...(swarmModes && swarmModes.length > 0 ? { swarmModes: Array.from(new Set(swarmModes)) } : {}),
        ...(keywords && keywords.length > 0 ? { keywords: Array.from(new Set(keywords)) } : {})
    };
}
