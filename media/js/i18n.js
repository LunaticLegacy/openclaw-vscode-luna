// OpenClaw Luna - Webview i18n
(function() {
    'use strict';

    // 翻译将通过 VS Code API 传递，而不是硬编码在这里
    let TRANSLATIONS = {};
    let currentLocale = 'en';

    function setTranslations(translations, locale) {
        TRANSLATIONS = translations && typeof translations === 'object' ? translations : {};
        const normalizedLocale = String(locale || '').toLowerCase();
        currentLocale = normalizedLocale.startsWith('zh') ? 'zh-cn' : 'en';
    }

    function t(key, values = {}) {
        let message = TRANSLATIONS[key] || key;
        
        // Replace placeholders
        Object.keys(values).forEach(k => {
            message = message.replace(new RegExp(`{${k}}`, 'g'), values[k]);
        });
        
        return message;
    }

    // Expose to global scope
    window.OpenClawI18n = {
        setTranslations,
        t
    };
})();
