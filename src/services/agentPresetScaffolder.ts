import * as fs from 'fs/promises';
import * as path from 'path';
import { t } from '../i18n';
import { Agent, OpenClawService } from './openclawService';

const REQUIRED_PRESET_FILES = ['IDENTITY.md', 'SOUL.md'] as const;
const OPTIONAL_PRESET_FILES = ['BOOTSTRAP.md', 'HEARTBEAT.md', 'TOOLS.md', 'USER.md'] as const;
const ALL_PRESET_FILES = [...REQUIRED_PRESET_FILES, ...OPTIONAL_PRESET_FILES] as const;

interface ApplyPresetFilesOptions {
    presetId: string;
    requestedName: string;
    requestedModel: string;
    systemPrompt?: string;
}

type TemplateContext = Record<string, string>;

export class AgentPresetScaffolder {
    constructor(
        private readonly extensionPath: string,
        private readonly service: OpenClawService
    ) {}

    public async applyPresetFiles(agent: Agent, options: ApplyPresetFilesOptions): Promise<void> {
        const presetId = options.presetId.trim();
        if (!presetId) {
            return;
        }

        const presetDir = path.join(this.extensionPath, 'agent-presets', presetId);
        const workspacePath = await this.service.resolveAgentFolderPath(agent);

        if (!workspacePath) {
            throw new Error(t('newAgent.presetFilesWorkspaceUnavailable', {
                name: agent.name || options.requestedName
            }));
        }

        await fs.mkdir(workspacePath, { recursive: true });

        const context = this.buildTemplateContext(agent, workspacePath, options);
        for (const fileName of ALL_PRESET_FILES) {
            const templatePath = path.join(presetDir, fileName);
            const template = await readTemplateFile(templatePath);

            if (!template) {
                if (REQUIRED_PRESET_FILES.includes(fileName as typeof REQUIRED_PRESET_FILES[number])) {
                    throw new Error(t('newAgent.presetFilesMissingRequired', {
                        presetId,
                        fileName
                    }));
                }
                continue;
            }

            const rendered = renderTemplate(template, context);
            await fs.writeFile(path.join(workspacePath, fileName), rendered, 'utf8');
        }
    }

    private buildTemplateContext(
        agent: Agent,
        workspacePath: string,
        options: ApplyPresetFilesOptions
    ): TemplateContext {
        return {
            agentId: agent.id || options.requestedName,
            agentName: agent.name || options.requestedName,
            model: agent.model || options.requestedModel,
            systemPrompt: agent.systemPrompt || options.systemPrompt || '',
            createdAt: agent.createdAt || new Date().toISOString(),
            presetId: options.presetId,
            workspacePath
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
