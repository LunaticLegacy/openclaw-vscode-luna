import * as vscode from 'vscode';

// 直接导入翻译文件
import enMessages from '../i18n/en.json';
import zhCnMessages from '../i18n/zh-cn.json';

type Locale = 'en' | 'zh-cn';
type MessageValue = string | number;

const LOCAL_FALLBACK_MESSAGES: Record<Locale, Record<string, string>> = {
    en: {},
    'zh-cn': {
        'clusters.updated': '集群“{name}”已更新',
        'clusters.editTitle': '编辑 {name}',
        'clusters.validationName': '请填写集群名称。',
        'clusters.validationAgents': '请至少为集群选择一个智能体。'
    }
};

export const MESSAGES: Record<Locale, Record<string, string>> = {
    en: enMessages,
    'zh-cn': zhCnMessages
};

function normalizeLocale(language: string | undefined): Locale {
    const normalized = (language || '').toLowerCase();
    return normalized.startsWith('zh') ? 'zh-cn' : 'en';
}

function format(template: string, values: Record<string, MessageValue>): string {
    return template.replace(/\{(\w+)\}/g, (_match: any, key: any) => String(values[key] ?? ''));
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

    const message = messages?.[key]
        || LOCAL_FALLBACK_MESSAGES[locale]?.[key]
        || defaultMessages?.[key]
        || key;
    return format(message, values);
}
