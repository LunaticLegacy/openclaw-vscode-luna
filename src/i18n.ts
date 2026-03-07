import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type Locale = 'en' | 'zh-cn';
type MessageValue = string | number;

// 缓存已加载的翻译
const messageCache = new Map<Locale, Record<string, string>>();

/**
 * 从JSON文件加载翻译
 */
function loadMessages(locale: Locale): Record<string, string> {
    if (messageCache.has(locale)) {
        return messageCache.get(locale)!;
    }

    try {
        const i18nDir = path.join(vscode.extensions.getExtension('openclaw.openclaw-vscode')!.extensionPath, 'i18n');
        const filePath = path.join(i18nDir, `${locale}.json`);
        const content = fs.readFileSync(filePath, 'utf8');
        const messages = JSON.parse(content);
        messageCache.set(locale, messages);
        return messages;
    } catch (error) {
        console.error(`Failed to load i18n file for locale ${locale}:`, error);
        // 如果加载失败，返回空对象
        return {};
    }
}

/**
 * 获取默认英文消息（作为后备）
 */
function getDefaultMessages(): Record<string, string> {
    return loadMessages('en');
}

function normalizeLocale(language: string | undefined): Locale {
    const normalized = (language || '').toLowerCase();
    return normalized.startsWith('zh') ? 'zh-cn' : 'en';
}

function format(template: string, values: Record<string, MessageValue>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));
}

export function getCurrentLocale(): Locale {
    return normalizeLocale(vscode.env.language);
}

export function t(
    key: string,
    values: Record<string, MessageValue> = {}
): string {
    const locale = getCurrentLocale();
    const messages = loadMessages(locale);
    const defaultMessages = getDefaultMessages();
    
    const message = messages[key] || defaultMessages[key] || key;
    return format(message, values);
}