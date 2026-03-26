import { buildSkillPromptAppendix, normalizeEnabledSkills } from '../../config/aiSkills';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { OpenClawChannelsListResult } from '../openclawCli';
import type { DiscoveredChannel } from './types';
import type { OpenClawIdentityValues } from '../../types/serviceParams';

const OPENCLAW_AGENT_SETTINGS_FILE = '.openclaw-vscode-agent.json';
const OPENCLAW_SYSTEM_PROMPT_FILE = 'SYSTEM.md';
const OPENCLAW_IDENTITY_FILE = 'IDENTITY.md';

/**
 * Represents stored agent settings in workspace.
 */
export interface OpenClawAgentSettingsRecord {
    name?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    enabledSkills?: string[];
}

/**
 * Maps OpenClaw channels list result to discovered channels.
 * @param result - The channels list result from OpenClaw
 * @returns Array of discovered channels
 */
export function mapDiscoveredChannels(result: OpenClawChannelsListResult | undefined): DiscoveredChannel[] {
    if (!result?.chat || typeof result.chat !== 'object') {
        return [];
    }

    const channels: DiscoveredChannel[] = [];
    for (const [providerId, accounts] of Object.entries(result.chat)) {
        if (!Array.isArray(accounts)) {
            continue;
        }

        for (const rawAccountId of accounts) {
            const accountId = String(rawAccountId || '').trim();
            if (!accountId) {
                continue;
            }

            channels.push({
                id: `openclaw:${providerId}:${accountId}`,
                name: formatDiscoveredChannelName(providerId, accountId),
                source: 'openclaw',
                providerId,
                accountId,
                description: `${providerId}/${accountId}`
            });
        }
    }

    return channels.sort((left: any, right: any) => left.name.localeCompare(right.name));
}

/**
 * Reads agent settings from workspace.
 * @param workspacePath - The workspace path
 * @returns The agent settings record
 */
export async function readOpenClawAgentSettings(workspacePath: string): Promise<OpenClawAgentSettingsRecord> {
    try {
        const content = await fs.readFile(path.join(workspacePath, OPENCLAW_AGENT_SETTINGS_FILE), 'utf8');
        const parsed = JSON.parse(content) as OpenClawAgentSettingsRecord;
        return {
            name: normalizeOptionalString(parsed.name),
            model: normalizeOptionalString(parsed.model),
            systemPrompt: parsed.systemPrompt !== undefined ? String(parsed.systemPrompt) : undefined,
            temperature: normalizeOptionalNumber(parsed.temperature),
            maxTokens: normalizeOptionalInteger(parsed.maxTokens),
            enabledSkills: normalizeEnabledSkills(parsed.enabledSkills)
        };
    } catch {
        return {};
    }
}

/**
 * Writes agent settings to workspace.
 * @param workspacePath - The workspace path
 * @param settings - The agent settings to write
 */
export async function writeOpenClawAgentSettings(
    workspacePath: string,
    settings: OpenClawAgentSettingsRecord
): Promise<void> {
    const payload: OpenClawAgentSettingsRecord = {};

    if (settings.name) {
        payload.name = settings.name;
    }
    if (settings.model) {
        payload.model = settings.model;
    }
    if (settings.systemPrompt !== undefined) {
        payload.systemPrompt = settings.systemPrompt;
    }
    if (settings.temperature !== undefined) {
        payload.temperature = settings.temperature;
    }
    if (settings.maxTokens !== undefined) {
        payload.maxTokens = settings.maxTokens;
    }
    if (settings.enabledSkills !== undefined) {
        payload.enabledSkills = normalizeEnabledSkills(settings.enabledSkills);
    }

    await fs.writeFile(
        path.join(workspacePath, OPENCLAW_AGENT_SETTINGS_FILE),
        JSON.stringify(payload, undefined, 2),
        'utf8'
    );
}

/**
 * Reads system prompt from workspace.
 * @param workspacePath - The workspace path
 * @returns The system prompt or undefined
 */
export async function readOpenClawSystemPrompt(workspacePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(path.join(workspacePath, OPENCLAW_SYSTEM_PROMPT_FILE), 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * Writes system prompt to workspace.
 * @param workspacePath - The workspace path
 * @param content - The system prompt content
 */
export async function writeOpenClawSystemPrompt(workspacePath: string, content: string): Promise<void> {
    await fs.writeFile(path.join(workspacePath, OPENCLAW_SYSTEM_PROMPT_FILE), content, 'utf8');
}

/**
 * Composes the full system prompt with skill appendix.
 * @param systemPrompt - Base system prompt
 * @param enabledSkills - Enabled skills for the agent
 * @returns The composed system prompt
 */
export function composeAgentSystemPrompt(systemPrompt: string | undefined, enabledSkills: unknown): string {
    return `${systemPrompt || ''}${buildSkillPromptAppendix(enabledSkills)}`.trim();
}

/**
 * Updates the agent identity file in workspace.
 * @param workspacePath - The workspace path
 * @param values - The identity values to update
 */
export async function updateOpenClawIdentityFile(
    workspacePath: string,
    values: OpenClawIdentityValues
): Promise<void> {
    const targetPath = path.join(workspacePath, OPENCLAW_IDENTITY_FILE);
    let content: string;

    try {
        content = await fs.readFile(targetPath, 'utf8');
    } catch {
        content = [
            '# IDENTITY.md - Who Am I?',
            '',
            `- Name: ${values.name}`,
            `- Agent ID: ${values.agentId}`,
            `- Model: ${values.model}`,
            ''
        ].join('\n');
        await fs.writeFile(targetPath, content, 'utf8');
        return;
    }

    const updates: Array<[RegExp, string]> = [
        [/^- Name:\s*.*$/m, `- Name: ${values.name}`],
        [/^- Agent ID:\s*.*$/m, `- Agent ID: ${values.agentId}`],
        [/^- Model:\s*.*$/m, `- Model: ${values.model}`]
    ];

    let nextContent = content;
    for (const [pattern, replacement] of updates) {
        if (pattern.test(nextContent)) {
            nextContent = nextContent.replace(pattern, replacement);
        } else {
            nextContent = `${nextContent.trimEnd()}\n${replacement}\n`;
        }
    }

    if (nextContent !== content) {
        await fs.writeFile(targetPath, nextContent, 'utf8');
    }
}

/**
 * Normalizes an optional string value.
 * @param value - The value to normalize
 * @returns The normalized string or undefined
 */
export function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

/**
 * Normalizes an optional number value.
 * @param value - The value to normalize
 * @returns The normalized number or undefined
 */
export function normalizeOptionalNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }

    return value;
}

/**
 * Normalizes an optional integer value.
 * @param value - The value to normalize
 * @returns The normalized integer or undefined
 */
export function normalizeOptionalInteger(value: unknown): number | undefined {
    const normalized = normalizeOptionalNumber(value);
    if (normalized === undefined) {
        return undefined;
    }

    return Math.max(1, Math.round(normalized));
}

/**
 * Formats a discovered channel name from provider and account IDs.
 * @param providerId - The provider ID
 * @param accountId - The account ID
 * @returns The formatted channel name
 */
function formatDiscoveredChannelName(providerId: string, accountId: string): string {
    const normalizedProvider = String(providerId || '').trim();
    const normalizedAccount = String(accountId || '').trim();
    const providerLabel = normalizedProvider
        .split(/[-_]+/)
        .filter(Boolean)
        .map((token: any) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');

    return `${providerLabel || 'Channel'} ${normalizedAccount}`;
}
