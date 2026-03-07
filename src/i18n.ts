import * as vscode from 'vscode';

// 直接导入翻译文件
import enMessages from '../i18n/en.json';
import zhCnMessages from '../i18n/zh-cn.json';

type Locale = 'en' | 'zh-cn';
type MessageValue = string | number;

export const MESSAGES: Record<Locale, Record<string, string>> = {
    en: enMessages,
    'zh-cn': zhCnMessages
};

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
    const messages = MESSAGES[locale];
    const defaultMessages = MESSAGES.en;
    
    const message = messages?.[key] || defaultMessages?.[key] || key;
    return format(message, values);
}