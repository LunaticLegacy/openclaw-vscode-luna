import * as fs from 'fs';
import * as vscode from 'vscode';

import { getCurrentLocale, MESSAGES } from '../../i18n';

/**
 * List of panel script files to include in the webview
 */
const PANEL_SCRIPT_FILES = [
    'js/i18n.js',
    'js/markdownRenderer.js',
    'js/panelCommon.js',
    'js/panelFeedback.js',
    'js/panelCore.js',
    'js/panelView.js',
    'js/panelConsole.js',
    'js/panelChat.js',
    'js/panelMessageRender.js',
    'js/panelMessageEnvelope.js',
    'js/panelMessageTools.js',
    'js/panelFormat.js',
    'js/panelAgents.js',
    'js/panelChannels.js',
    'js/panelAgentForms.js',
    'js/panelModals.js',
    'js/panelClusters.js',
    'js/panelClusterWorkspace.js',
    'js/panelClusterConversation.js',
    'js/panelTasksUsage.js',
    'js/panel.js'
] as const;

/**
 * Builds the HTML for the OpenClaw panel webview
 * @param extensionUri - The extension URI
 * @param webview - The webview instance
 * @returns The complete HTML string
 */
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

/**
 * Builds the script tags for panel scripts
 * @param extensionUri - The extension URI
 * @param webview - The webview instance
 * @returns The script tags HTML string
 */
function buildPanelScriptTags(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    return PANEL_SCRIPT_FILES
        .map((fileName: any) => {
            const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', fileName));
            return `    <script src="${scriptUri.toString()}" defer></script>`;
        })
        .join('\n');
}

/**
 * Reads a media file from the extension
 * @param extensionUri - The extension URI
 * @param fileName - The name of the file to read
 * @returns The file contents as a string
 */
function readMediaFile(extensionUri: vscode.Uri, fileName: string): string {
    const fileUri = vscode.Uri.joinPath(extensionUri, 'media', fileName);
    return fs.readFileSync(fileUri.fsPath, 'utf8');
}

/**
 * Applies template variables to a template string
 * @param template - The template string with placeholders
 * @param variables - The variables to substitute
 * @returns The processed template string
 */
function applyTemplateVariables(template: string, variables: Record<string, string>): string {
    let output = template;
    for (const [key, value] of Object.entries(variables)) {
        output = output.split(`{{${key}}}`).join(value);
    }

    return output;
}
