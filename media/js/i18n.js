// OpenClaw Luna - Webview i18n
// 国际化(i18n)模块 - 负责处理Webview中的多语言翻译功能
(function() {
    'use strict';

    // =====================================================
    // 模块内部变量
    // =====================================================
    
    /**
     * 翻译字典存储对象
     * 翻译内容将通过 VS Code API 从扩展端传递，而不是在此硬编码
     * @type {Object.<string, string>}
     */
    let TRANSLATIONS = {};
    
    /**
     * 当前语言区域设置
     * @type {string}
     */
    let currentLocale = 'en';

    // =====================================================
    // 公共函数
    // =====================================================

    /**
     * 设置翻译字典和当前语言
     * 由扩展端调用，传入当前语言对应的翻译内容
     * @function setTranslations
     * @param {Object.<string, string>} translations - 翻译键值对字典
     * @param {string} locale - 语言区域代码（如 'zh-cn', 'en'）
     * @returns {void}
     */
    function setTranslations(translations, locale) {
        // 验证并保存翻译字典，确保是对象类型
        TRANSLATIONS = translations && typeof translations === 'object' ? translations : {};
        
        // 标准化语言代码：统一转换为小写
        const normalizedLocale = String(locale || '').toLowerCase();
        
        // 简化语言处理：中文统一映射为'zh-cn'，其他默认为'en'
        currentLocale = normalizedLocale.startsWith('zh') ? 'zh-cn' : 'en';
    }

    /**
     * 翻译函数
     * 根据键获取对应的翻译文本，支持变量插值
     * @function t
     * @param {string} key - 翻译键名
     * @param {Object.<string, string>} [values={}] - 用于插值的变量字典
     * @returns {string} - 翻译后的文本，若未找到则返回键名本身
     * @example
     * // 假设 TRANSLATIONS = { 'hello': 'Hello, {name}!' }
     * t('hello', { name: 'World' }); // 返回: 'Hello, World!'
     * t('missing.key'); // 返回: 'missing.key'
     */
    function t(key, values = {}) {
        // 获取翻译文本，若不存在则使用键名作为回退
        let message = TRANSLATIONS[key] || key;
        
        // -----------------------------------------------------
        // 变量插值处理
        // 将 {variableName} 格式的占位符替换为实际值
        // -----------------------------------------------------
        Object.keys(values).forEach(k => {
            // 使用正则表达式全局替换所有匹配项
            message = message.replace(new RegExp(`{${k}}`, 'g'), values[k]);
        });
        
        return message;
    }

    // =====================================================
    // 暴露公共API到全局作用域
    // =====================================================
    window.OpenClawI18n = {
        setTranslations,  // 设置翻译字典
        t                 // 翻译函数
    };
})();
