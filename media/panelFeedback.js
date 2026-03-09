(function() {
    'use strict';

    function setConnectionSetupStatus(state, elements, kind, text) {
        state.connectionSettingsStatus = text ? { kind, text } : null;
        renderConnectionSetupStatus(state, elements);
    }

    function renderConnectionSetupStatus(state, elements) {
        if (!elements.connectionSettingsStatus) {
            return;
        }

        const status = state.connectionSettingsStatus;
        elements.connectionSettingsStatus.classList.toggle('hidden', !status);
        elements.connectionSettingsStatus.classList.toggle('success', status?.kind === 'success');
        elements.connectionSettingsStatus.classList.toggle('error', status?.kind === 'error');
        elements.connectionSettingsStatus.textContent = status?.text || '';
    }

    function showChatError(container, msg, scrollToBottom) {
        if (!container) {
            return;
        }

        const div = document.createElement('div');
        div.className = 'error-message';
        div.textContent = msg;
        container.appendChild(div);
        if (typeof scrollToBottom === 'function') {
            scrollToBottom();
        }
        setTimeout(() => div.remove(), 5000);
    }

    window.OpenClawPanelFeedback = {
        renderConnectionSetupStatus,
        setConnectionSetupStatus,
        showChatError
    };
})();
