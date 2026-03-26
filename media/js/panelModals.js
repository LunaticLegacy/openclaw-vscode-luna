// OpenClaw Luna - Panel Modals
// 面板模态框模块 - 负责任务编辑器的显示、表单处理和任务保存功能
'use strict';

    /**
     * 显示任务编辑器模态框
     * 根据传入的任务对象初始化表单字段，支持新建任务和编辑现有任务
     * @function showTaskEditor
     * @param {Object} task - 任务对象，若为null/undefined则创建新任务
     * @param {string} task.id - 任务唯一标识
     * @param {string} task.name - 任务名称
     * @param {string} task.description - 任务描述
     * @param {string} task.agentId - 关联的Agent ID
     * @param {Object} task.schedule - 任务调度配置
     * @param {Object} task.payload - 任务负载配置
     * @param {boolean} task.enabled - 任务是否启用
     * @param {boolean} task.deleteAfterRun - 运行后是否删除
     * @returns {void}
     */
    function showTaskEditor(task) {
        // =====================================================
        // 检查运行时能力支持
        // =====================================================
        
        // 检查是否支持定时任务功能
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        // 检查任务功能是否可用（后端可能禁用）
        if (state.tasksAvailable === false) {
            showError(state.tasksMessage || resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        // 获取任务编辑模态框元素
        const modal = elements.modalTask;
        if (!modal) {
            return;
        }

        // =====================================================
        // 获取表单字段元素
        // =====================================================
        
        // 获取i18n翻译函数，若未加载则返回key本身
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // 获取模态框标题元素
        const title = document.getElementById('task-modal-title');
        
        // 获取表单输入字段元素
        const idField = document.getElementById('task-id');                    // 任务ID（隐藏字段）
        const nameField = document.getElementById('task-name');                // 任务名称
        const descriptionField = document.getElementById('task-description');  // 任务描述
        const agentField = document.getElementById('task-agent-id');           // 关联Agent选择
        const scheduleKindField = document.getElementById('task-schedule-kind'); // 调度类型
        const scheduleEveryField = document.getElementById('task-schedule-every'); // 周期调度值
        const scheduleAtField = document.getElementById('task-schedule-at');   // 定点调度时间
        const scheduleCronField = document.getElementById('task-schedule-cron'); // Cron表达式
        const scheduleTimezoneField = document.getElementById('task-schedule-timezone'); // 时区
        const sessionTargetField = document.getElementById('task-session-target'); // 会话目标
        const wakeModeField = document.getElementById('task-wake-mode');       // 唤醒模式
        const payloadKindField = document.getElementById('task-payload-kind'); // 负载类型
        const contentField = document.getElementById('task-content');          // 内容/提示词
        const modelField = document.getElementById('task-model');              // 模型选择
        const timeoutField = document.getElementById('task-timeout-seconds');  // 超时时间
        const enabledField = document.getElementById('task-enabled');          // 启用状态
        const deleteAfterRunField = document.getElementById('task-delete-after-run'); // 运行后删除

        // 校验所有必要字段是否存在，若有缺失则退出
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

        // =====================================================
        // 填充表单字段值
        // =====================================================
        
        // 基本信息字段
        idField.value = task?.id || '';                    // 任务ID，新建时为空
        nameField.value = task?.name || '';                // 任务名称
        descriptionField.value = task?.description || '';  // 任务描述
        populateTaskAgentOptions(task?.agentId || '');     // 填充Agent下拉选项并设置选中值

        // -----------------------------------------------------
        // 调度配置字段处理
        // -----------------------------------------------------
        const scheduleKind = task?.schedule?.kind || 'every';  // 默认周期调度
        scheduleKindField.value = scheduleKind;
        
        // 根据调度类型设置对应字段的值
        scheduleEveryField.value = task?.schedule?.kind === 'every'
            ? formatEveryDuration(task.schedule.everyMs)    // 将毫秒转换为可读格式
            : '10m';                                         // 默认值10分钟
        scheduleAtField.value = task?.schedule?.kind === 'at'
            ? toDateTimeLocalValue(task.schedule.at)        // 转换为datetime-local格式
            : '';
        scheduleCronField.value = task?.schedule?.kind === 'cron'
            ? task.schedule.expr                            // Cron表达式
            : '';
        scheduleTimezoneField.value = task?.schedule?.kind === 'cron'
            ? (task.schedule.tz || '')                      // Cron时区，默认为空
            : '';

        // -----------------------------------------------------
        // 负载和会话配置
        // -----------------------------------------------------
        const payloadKind = task?.payload?.kind || 'agentTurn';  // 默认识Agent对话
        payloadKindField.value = payloadKind;
        
        // 会话目标：系统事件固定为'main'，其他为'isolated'
        sessionTargetField.value = task?.sessionTarget || (payloadKind === 'systemEvent' ? 'main' : 'isolated');
        wakeModeField.value = task?.wakeMode || 'now';           // 唤醒模式默认立即
        contentField.value = extractTaskContent(task) || '';     // 提取任务内容
        
        // Agent对话特有的字段
        modelField.value = task?.payload?.kind === 'agentTurn' ? (task.payload.model || '') : '';
        timeoutField.value = task?.payload?.kind === 'agentTurn' && task.payload.timeoutSeconds
            ? String(task.payload.timeoutSeconds)
            : '';
        
        // 状态字段
        enabledField.checked = task ? task.enabled !== false : true;  // 默认启用
        deleteAfterRunField.checked = task
            ? Boolean(task.deleteAfterRun)
            : scheduleKind === 'at';  // 定点任务默认启用运行后删除

        // =====================================================
        // 设置模态框标题并显示
        // =====================================================
        if (title) {
            // 根据是编辑还是创建显示不同标题
            title.textContent = task ? t('tasks.form.editTitle') : t('tasks.form.createTitle');
        }

        // 根据当前表单值更新字段显示/隐藏状态
        updateTaskFormFields();
        // 打开模态框
        openModal(modal);
    }

    /**
     * 更新任务表单字段的显示状态
     * 根据用户选择的调度类型和负载类型，动态显示/隐藏相关字段组
     * @function updateTaskFormFields
     * @returns {void}
     */
    function updateTaskFormFields() {
        // 获取i18n翻译函数
        const t = window.OpenClawI18n ? window.OpenClawI18n.t : (key) => key;
        
        // =====================================================
        // 获取表单元素
        // =====================================================
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

        // 校验必要元素是否存在
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

        // =====================================================
        // 更新Agent下拉选项
        // =====================================================
        populateTaskAgentOptions(agentField.value || '');

        // =====================================================
        // 根据调度类型控制字段显示
        // =====================================================
        const scheduleKind = scheduleKindField.value || 'every';
        
        // 周期调度(every)：显示周期字段，其他隐藏
        scheduleEveryGroup.hidden = scheduleKind !== 'every';
        scheduleEveryField.required = scheduleKind === 'every';
        
        // 定点调度(at)：显示时间字段，其他隐藏
        scheduleAtGroup.hidden = scheduleKind !== 'at';
        scheduleAtField.required = scheduleKind === 'at';
        
        // Cron调度：显示Cron表达式和时区字段
        scheduleCronGroup.hidden = scheduleKind !== 'cron';
        scheduleCronField.required = scheduleKind === 'cron';
        scheduleTimezoneGroup.hidden = scheduleKind !== 'cron';
        
        // 运行后删除选项仅在定点调度时可用
        deleteAfterRunGroup.hidden = scheduleKind !== 'at';
        if (scheduleKind !== 'at') {
            deleteAfterRunField.checked = false;
        }

        // =====================================================
        // 根据负载类型控制字段显示
        // =====================================================
        const payloadKind = payloadKindField.value === 'systemEvent' ? 'systemEvent' : 'agentTurn';
        const isSystemEvent = payloadKind === 'systemEvent';
        
        // 系统事件固定会话目标为'main'且不可修改
        sessionTargetField.value = isSystemEvent ? 'main' : 'isolated';
        sessionTargetField.disabled = true;
        
        // 系统事件隐藏模型和超时字段
        modelGroup.hidden = isSystemEvent;
        timeoutGroup.hidden = isSystemEvent;
        modelField.required = false;
        timeoutField.required = false;
        
        // 更新内容标签文本以反映负载类型
        contentLabel.textContent = isSystemEvent
            ? t('tasks.form.payloadSystemEvent')
            : t('tasks.form.payloadAgentTurn');
    }

    /**
     * 保存任务
     * 从表单收集数据并发送给VS Code扩展进行保存（创建或更新）
     * @function saveTask
     * @returns {void}
     */
    function saveTask() {
        // =====================================================
        // 检查运行时能力支持
        // =====================================================
        if (!supportsRuntimeCapability('scheduledTasks')) {
            showError(resolveCapabilityUnavailableMessage('scheduledTasks'));
            return;
        }

        // =====================================================
        // 获取表单字段元素并收集数据
        // =====================================================
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

        // 判断是创建还是更新（有ID则为更新）
        const taskId = idField ? idField.value : '';
        const scheduleKind = scheduleKindField?.value || 'every';
        
        // 构建任务数据对象
        const data = {
            name: nameField ? nameField.value : '',                              // 任务名称
            description: descriptionField ? descriptionField.value : '',          // 任务描述
            agentId: agentField ? agentField.value : '',                          // 关联Agent
            scheduleKind,                                                          // 调度类型
            scheduleEvery: scheduleEveryField ? scheduleEveryField.value : '',    // 周期值
            scheduleAt: scheduleAtField ? scheduleAtField.value : '',             // 定点时间
            scheduleCron: scheduleCronField ? scheduleCronField.value : '',       // Cron表达式
            scheduleTimezone: scheduleTimezoneField ? scheduleTimezoneField.value : '', // 时区
            sessionTarget: sessionTargetField ? sessionTargetField.value : 'isolated', // 会话目标
            wakeMode: wakeModeField ? wakeModeField.value : 'now',                // 唤醒模式
            payloadKind: payloadKindField ? payloadKindField.value : 'agentTurn', // 负载类型
            content: contentField ? contentField.value : '',                      // 内容
            model: modelField ? modelField.value : '',                            // 模型
            timeoutSeconds: timeoutField ? timeoutField.value : '',               // 超时时间
            enabled: Boolean(enabledField?.checked),                              // 启用状态
            deleteAfterRun: Boolean(deleteAfterRunField?.checked)                 // 运行后删除
        };

        // =====================================================
        // 发送保存请求
        // =====================================================
        vscode.postMessage({
            // 根据有无taskId决定是创建还是更新
            type: taskId ? 'updateTask' : 'createTask',
            taskId,
            data
        });
        
        // 关闭所有模态框
        closeAllModals();
    }

    // =====================================================
    // 模态框通用操作
    // =====================================================

    /**
     * 打开指定模态框
     * @function openModal
     * @param {HTMLElement} modal - 模态框DOM元素
     * @returns {void}
     */
    function openModal(modal) {
        if (modal) modal.classList.add('active');
    }

    /**
     * 关闭所有模态框
     * 通过移除active类来隐藏所有带有modal类的元素
     * @function closeAllModals
     * @returns {void}
     */
    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    }
