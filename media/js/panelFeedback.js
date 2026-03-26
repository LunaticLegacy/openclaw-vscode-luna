// OpenClaw Luna - Panel Feedback
// 面板反馈模块 - 负责处理连接状态显示、错误提示等用户反馈功能
(function() {
    'use strict';

    /**
     * 设置连接设置状态
     * 更新状态对象并触发界面重新渲染
     * @function setConnectionSetupStatus
     * @param {Object} state - 全局状态对象
     * @param {Object} elements - DOM元素引用集合
     * @param {string} kind - 状态类型，可选值: 'success' | 'error' | 其他
     * @param {string} text - 状态提示文本，为空则清除状态
     * @returns {void}
     */
    function setConnectionSetupStatus(state, elements, kind, text) {
        // 更新状态对象：如果有文本则保存状态，否则设为null
        state.connectionSettingsStatus = text ? { kind, text } : null;
        // 触发状态显示渲染
        renderConnectionSetupStatus(state, elements);
    }

    /**
     * 渲染连接设置状态显示
     * 根据当前状态更新DOM元素的显示样式和内容
     * @function renderConnectionSetupStatus
     * @param {Object} state - 全局状态对象
     * @param {Object} elements - DOM元素引用集合
     * @param {HTMLElement} elements.connectionSettingsStatus - 状态显示元素
     * @returns {void}
     */
    function renderConnectionSetupStatus(state, elements) {
        // 检查状态元素是否存在
        if (!elements.connectionSettingsStatus) {
            return;
        }

        // 获取当前状态
        const status = state.connectionSettingsStatus;
        
        // 根据状态控制显示/隐藏
        elements.connectionSettingsStatus.classList.toggle('hidden', !status);
        
        // 根据状态类型设置成功/错误样式
        elements.connectionSettingsStatus.classList.toggle('success', status?.kind === 'success');
        elements.connectionSettingsStatus.classList.toggle('error', status?.kind === 'error');
        
        // 设置状态文本内容
        elements.connectionSettingsStatus.textContent = status?.text || '';
    }

    /**
     * 在聊天容器中显示错误消息
     * 创建错误消息元素并添加到容器，5秒后自动移除
     * @function showChatError
     * @param {HTMLElement} container - 聊天消息容器元素
     * @param {string} msg - 错误消息文本
     * @param {Function} scrollToBottom - 滚动到底部的回调函数
     * @returns {void}
     */
    function showChatError(container, msg, scrollToBottom) {
        // 检查容器是否存在
        if (!container) {
            return;
        }

        // 创建错误消息元素
        const div = document.createElement('div');
        div.className = 'error-message';  // 应用错误样式
        div.textContent = msg;             // 设置错误文本
        
        // 添加到容器
        container.appendChild(div);
        
        // 如果提供了滚动函数，则滚动到底部显示错误
        if (typeof scrollToBottom === 'function') {
            scrollToBottom();
        }
        
        // 5秒后自动移除错误消息
        setTimeout(() => div.remove(), 5000);
    }

    // =====================================================
    // 暴露公共API到全局作用域
    // =====================================================
    window.OpenClawPanelFeedback = {
        renderConnectionSetupStatus,  // 渲染连接设置状态
        setConnectionSetupStatus,     // 设置连接设置状态
        showChatError                 // 显示聊天错误
    };
})();
