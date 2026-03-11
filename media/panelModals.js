// OpenClaw Luna - Panel Modals
'use strict';

    function showTaskEditor(task) {
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        if (state.tasksAvailable === false) {
            showError(state.tasksMessage || resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        const modal = elements.modalTask;
        if (!modal) {
            return;
        }

        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const title = document.getElementById('task-modal-title');
        const idField = document.getElementById('task-id');
        const nameField = document.getElementById('task-name');
        const descriptionField = document.getElementById('task-description');
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneField = document.getElementById('task-schedule-timezone');
        const sessionTargetField = document.getElementById('task-session-target');
        const wakeModeField = document.getElementById('task-wake-mode');
        const payloadKindField = document.getElementById('task-payload-kind');
        const contentField = document.getElementById('task-content');
        const modelField = document.getElementById('task-model');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const enabledField = document.getElementById('task-enabled');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');

        if (!idField
            || !nameField
            || !descriptionField
            || !agentField
            || !scheduleKindField
            || !scheduleEveryField
            || !scheduleAtField
            || !scheduleCronField
            || !scheduleTimezoneField
            || !sessionTargetField
            || !wakeModeField
            || !payloadKindField
            || !contentField
            || !modelField
            || !timeoutField
            || !enabledField
            || !deleteAfterRunField) {
            return;
        }

        idField.value = task?.id || '';
        nameField.value = task?.name || '';
        descriptionField.value = task?.description || '';
        populateTaskAgentOptions(task?.agentId || '');

        const scheduleKind = task?.schedule?.kind || 'every';
        scheduleKindField.value = scheduleKind;
        scheduleEveryField.value = task?.schedule?.kind === 'every'
            ? formatEveryDuration(task.schedule.everyMs)
            : '10m';
        scheduleAtField.value = task?.schedule?.kind === 'at'
            ? toDateTimeLocalValue(task.schedule.at)
            : '';
        scheduleCronField.value = task?.schedule?.kind === 'cron'
            ? task.schedule.expr
            : '';
        scheduleTimezoneField.value = task?.schedule?.kind === 'cron'
            ? (task.schedule.tz || '')
            : '';

        const payloadKind = task?.payload?.kind || 'agentTurn';
        payloadKindField.value = payloadKind;
        sessionTargetField.value = task?.sessionTarget || (payloadKind === 'systemEvent' ? 'main' : 'isolated');
        wakeModeField.value = task?.wakeMode || 'now';
        contentField.value = extractTaskContent(task) || '';
        modelField.value = task?.payload?.kind === 'agentTurn' ? (task.payload.model || '') : '';
        timeoutField.value = task?.payload?.kind === 'agentTurn' && task.payload.timeoutSeconds
            ? String(task.payload.timeoutSeconds)
            : '';
        enabledField.checked = task ? task.enabled !== false : true;
        deleteAfterRunField.checked = task
            ? Boolean(task.deleteAfterRun)
            : scheduleKind === 'at';

        if (title) {
            title.textContent = task ? t('tasks.form.editTitle') : t('tasks.form.createTitle');
        }

        updateTaskFormFields();
        openModal(modal);
    }

    function updateTaskFormFields() {
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryGroup = document.getElementById('task-schedule-every-group');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtGroup = document.getElementById('task-schedule-at-group');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronGroup = document.getElementById('task-schedule-cron-group');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneGroup = document.getElementById('task-schedule-timezone-group');
        const payloadKindField = document.getElementById('task-payload-kind');
        const sessionTargetField = document.getElementById('task-session-target');
        const modelGroup = document.getElementById('task-model-group');
        const modelField = document.getElementById('task-model');
        const timeoutGroup = document.getElementById('task-timeout-group');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const deleteAfterRunGroup = document.getElementById('task-delete-after-run-group');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');
        const contentLabel = document.getElementById('task-content-label');

        if (!agentField
            || !scheduleKindField
            || !scheduleEveryGroup
            || !scheduleEveryField
            || !scheduleAtGroup
            || !scheduleAtField
            || !scheduleCronGroup
            || !scheduleCronField
            || !scheduleTimezoneGroup
            || !payloadKindField
            || !sessionTargetField
            || !modelGroup
            || !modelField
            || !timeoutGroup
            || !timeoutField
            || !deleteAfterRunGroup
            || !deleteAfterRunField
            || !contentLabel) {
            return;
        }

        populateTaskAgentOptions(agentField.value || '');

        const scheduleKind = scheduleKindField.value || 'every';
        scheduleEveryGroup.hidden = scheduleKind !== 'every';
        scheduleEveryField.required = scheduleKind === 'every';
        scheduleAtGroup.hidden = scheduleKind !== 'at';
        scheduleAtField.required = scheduleKind === 'at';
        scheduleCronGroup.hidden = scheduleKind !== 'cron';
        scheduleCronField.required = scheduleKind === 'cron';
        scheduleTimezoneGroup.hidden = scheduleKind !== 'cron';
        deleteAfterRunGroup.hidden = scheduleKind !== 'at';
        if (scheduleKind !== 'at') {
            deleteAfterRunField.checked = false;
        }

        const payloadKind = payloadKindField.value === 'systemEvent' ? 'systemEvent' : 'agentTurn';
        const isSystemEvent = payloadKind === 'systemEvent';
        sessionTargetField.value = isSystemEvent ? 'main' : 'isolated';
        sessionTargetField.disabled = true;
        modelGroup.hidden = isSystemEvent;
        timeoutGroup.hidden = isSystemEvent;
        modelField.required = false;
        timeoutField.required = false;
        contentLabel.textContent = isSystemEvent
            ? t('tasks.form.payloadSystemEvent')
            : t('tasks.form.payloadAgentTurn');
    }

    function saveTask() {
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        const idField = document.getElementById('task-id');
        const nameField = document.getElementById('task-name');
        const descriptionField = document.getElementById('task-description');
        const agentField = document.getElementById('task-agent-id');
        const scheduleKindField = document.getElementById('task-schedule-kind');
        const scheduleEveryField = document.getElementById('task-schedule-every');
        const scheduleAtField = document.getElementById('task-schedule-at');
        const scheduleCronField = document.getElementById('task-schedule-cron');
        const scheduleTimezoneField = document.getElementById('task-schedule-timezone');
        const sessionTargetField = document.getElementById('task-session-target');
        const wakeModeField = document.getElementById('task-wake-mode');
        const payloadKindField = document.getElementById('task-payload-kind');
        const contentField = document.getElementById('task-content');
        const modelField = document.getElementById('task-model');
        const timeoutField = document.getElementById('task-timeout-seconds');
        const enabledField = document.getElementById('task-enabled');
        const deleteAfterRunField = document.getElementById('task-delete-after-run');

        const taskId = idField ? idField.value : '';
        const scheduleKind = scheduleKindField?.value || 'every';
        const data = {
            name: nameField ? nameField.value : '',
            description: descriptionField ? descriptionField.value : '',
            agentId: agentField ? agentField.value : '',
            scheduleKind,
            scheduleEvery: scheduleEveryField ? scheduleEveryField.value : '',
            scheduleAt: scheduleAtField ? scheduleAtField.value : '',
            scheduleCron: scheduleCronField ? scheduleCronField.value : '',
            scheduleTimezone: scheduleTimezoneField ? scheduleTimezoneField.value : '',
            sessionTarget: sessionTargetField ? sessionTargetField.value : 'isolated',
            wakeMode: wakeModeField ? wakeModeField.value : 'now',
            payloadKind: payloadKindField ? payloadKindField.value : 'agentTurn',
            content: contentField ? contentField.value : '',
            model: modelField ? modelField.value : '',
            timeoutSeconds: timeoutField ? timeoutField.value : '',
            enabled: Boolean(enabledField?.checked),
            deleteAfterRun: Boolean(deleteAfterRunField?.checked)
        };

        vscode.postMessage({
            type: taskId ? 'updateTask' : 'createTask',
            taskId,
            data
        });
        closeAllModals();
    }

    // Modal handling
    function openModal(modal) {
        if (modal) modal.classList.add('active');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    }

