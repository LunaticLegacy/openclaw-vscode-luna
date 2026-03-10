import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import { Agent, OpenClawService } from './openclawService';

const REQUIRED_PRESET_FILES = ['IDENTITY.md', 'SOUL.md'] as const;
const SYSTEM_PROMPT_TEMPLATE_FILE = 'SYSTEM.md';

interface ApplyPresetFilesOptions {
    presetId: string;
    requestedName: string;
    requestedModel: string;
    systemPrompt?: string;
}

interface BuildPresetSystemPromptOptions {
    presetId: string;
    requestedName: string;
    requestedModel: string;
    systemPrompt?: string;
    agentId?: string;
    createdAt?: string;
    workspacePath?: string;
}

type TemplateContext = Record<string, string>;

export class AgentPresetScaffolder {
    constructor(
        private readonly extensionPath: string,
        private readonly service: OpenClawService
    ) {}

    public async buildSystemPrompt(options: BuildPresetSystemPromptOptions): Promise<string | undefined> {
        const presetId = options.presetId.trim();
        const fallbackPrompt = options.systemPrompt?.trim() || '';
        if (!presetId) {
            return fallbackPrompt || undefined;
        }

        const templatePath = path.join(this.extensionPath, 'agent-presets', presetId, SYSTEM_PROMPT_TEMPLATE_FILE);
        const template = await readTemplateFile(templatePath);
        if (!template) {
            return fallbackPrompt || undefined;
        }

        const context = this.buildTemplateContext({
            agentId: options.agentId || options.requestedName,
            agentName: options.requestedName,
            model: options.requestedModel,
            systemPrompt: fallbackPrompt,
            createdAt: options.createdAt || new Date().toISOString(),
            presetId,
            workspacePath: options.workspacePath || ''
        });
        const rendered = renderTemplate(template, context).trim();
        if (!rendered) {
            return fallbackPrompt || undefined;
        }

        return fallbackPrompt ? `${fallbackPrompt}\n\n${rendered}` : rendered;
    }

    public async applyPresetFiles(agent: Agent, options: ApplyPresetFilesOptions): Promise<void> {
        const presetId = options.presetId.trim();
        if (!presetId) {
            return;
        }
        const workspacePath = await this.service.resolveAgentFolderPath(agent);
        if (!workspacePath) {
            return;
        }

        const presetDir = path.join(this.extensionPath, 'agent-presets', presetId);
        const allMarkdownFiles = await listPresetMarkdownFiles(presetDir);

        for (const requiredFile of REQUIRED_PRESET_FILES) {
            if (!allMarkdownFiles.includes(requiredFile)) {
                throw new Error(t('newAgent.presetFilesMissingRequired', {
                    presetId,
                    fileName: requiredFile
                }));
            }
        }

        await fs.mkdir(workspacePath, { recursive: true });

        const context = this.buildTemplateContext({
            agentId: agent.id || options.requestedName,
            agentName: agent.name || options.requestedName,
            model: agent.model || options.requestedModel,
            systemPrompt: agent.systemPrompt || options.systemPrompt || '',
            createdAt: agent.createdAt || new Date().toISOString(),
            presetId: options.presetId,
            workspacePath
        });
        for (const fileName of allMarkdownFiles) {
            const templatePath = path.join(presetDir, fileName);
            const template = await readTemplateFile(templatePath);

            if (!template) {
                continue;
            }

            const rendered = renderTemplate(template, context);
            await fs.writeFile(path.join(workspacePath, fileName), rendered, 'utf8');
        }
    }

    private buildTemplateContext(options: {
        agentId: string;
        agentName: string;
        model: string;
        systemPrompt: string;
        createdAt: string;
        presetId: string;
        workspacePath: string;
    }): TemplateContext {
        return {
            agentId: options.agentId,
            agentName: options.agentName,
            model: options.model,
            systemPrompt: options.systemPrompt,
            createdAt: options.createdAt,
            presetId: options.presetId,
            workspacePath: options.workspacePath
        };
    }
}

async function readTemplateFile(targetPath: string): Promise<string | null> {
    try {
        return await fs.readFile(targetPath, 'utf8');
    } catch {
        return null;
    }
}

function renderTemplate(template: string, context: TemplateContext): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => context[key] || '');
}

async function listPresetMarkdownFiles(presetDir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(presetDir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
            .map(entry => entry.name)
            .sort((left, right) => left.localeCompare(right));
    } catch {
        return [];
    }
}
