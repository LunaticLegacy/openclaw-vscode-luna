import * as fs from 'fs';
import * as vscode from 'vscode';

import { getCurrentLocale, MESSAGES } from '../../i18n';

const PANEL_SCRIPT_FILES = [
    'i18n.js',
    'markdownRenderer.js',
    'panelCommon.js',
    'panelFeedback.js',
    'panelCore.js',
    'panelView.js',
    'panelConsole.js',
    'panelChat.js',
    'panelMessageRender.js',
    'panelMessageEnvelope.js',
    'panelMessageTools.js',
    'panelFormat.js',
    'panelAgents.js',
    'panelChannels.js',
    'panelAgentForms.js',
    'panelModals.js',
    'panelClusters.js',
    'panelClusterWorkspace.js',
    'panelClusterConversation.js',
    'panelTasksUsage.js',
    'panel.js'
] as const;

export function buildOpenClawPanelHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const template = readMediaFile(extensionUri, 'panel.html');
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
    const panelScriptTags = buildPanelScriptTags(extensionUri, webview);

    const locale = getCurrentLocale();
    const translations = MESSAGES[locale] || MESSAGES.en;
    const translationsBase64 = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');

    return applyTemplateVariables(template, {
        cspSource: webview.cspSource,
        locale,
        styleUri: styleUri.toString(),
        panelScriptTags,
        translationsBase64
    });
}

function buildPanelScriptTags(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    return PANEL_SCRIPT_FILES
        .map(fileName => {
            const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', fileName));
            return `    <script src="${scriptUri.toString()}" defer></script>`;
        })
        .join('\n');
}

function readMediaFile(extensionUri: vscode.Uri, fileName: string): string {
    const fileUri = vscode.Uri.joinPath(extensionUri, 'media', fileName);
    return fs.readFileSync(fileUri.fsPath, 'utf8');
}

function applyTemplateVariables(template: string, variables: Record<string, string>): string {
    let output = template;
    for (const [key, value] of Object.entries(variables)) {
        output = output.split(`{{${key}}}`).join(value);
    }

    return output;
}
