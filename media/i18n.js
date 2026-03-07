// OpenClaw Luna - Webview i18n
(function() {
    'use strict';

    const TRANSLATIONS = {
        en: {
            'common.loading': 'Loading...',
            'common.close': 'Close',
            'common.save': 'Save',
            'common.edit': 'Edit',
            'common.delete': 'Delete',
            'common.create': 'Create',
            'common.cancel': 'Cancel',
            'common.settings': 'Settings',
            'common.openInExplorer': 'Open in Explorer',
            'common.systemPrompt': 'System Prompt',
            'common.temperature': 'Temperature',
            'common.maxTokens': 'Max Tokens',
            'common.thinking': 'Thinking',
            'common.thinkingLevel': 'Thinking Level',
            'common.showThinking': 'Show Thinking Process',
            'common.hideThinking': 'Hide Thinking Process',
            'thinking.started': 'Thinking...',
            'thinking.processing': 'Processing...',
            'thinking.completed': 'Thought process completed',
            'thinking.step': 'Step {step}',
            'agentSettings.title': 'Agent Settings',
            'agentSettings.name': 'Name',
            'agentSettings.model': 'Model',
            'agentSettings.workspace': 'Workspace',
            'agentSettings.advanced': 'Advanced Settings',
            'chat.placeholder': 'Type your message... (Shift+Enter to send)',
            'chat.send': 'Send',
            'chat.thinking': 'Thinking',
            'chat.clear': 'Clear Chat',
            'sidebar.agents': 'Agents',
            'sidebar.clusters': 'Clusters',
            'sidebar.usage': 'Usage',
            'sidebar.newAgent': 'New Agent',
            'clusters.create': 'Create Cluster',
            'clusters.broadcast': 'Broadcast',
            'usage.title': 'API Usage Dashboard',
            'usage.refresh': 'Refresh',
            'usage.totalRequests': 'Total Requests',
            'usage.totalTokens': 'Total Tokens',
            'usage.estimatedCost': 'Estimated Cost',
            'welcome.title': 'Welcome to OpenClaw Luna',
            'welcome.subtitle': 'Select an agent from the sidebar and start chatting!',
            'sidebar.chat': 'Chat',
            'sidebar.basic': 'Basic Settings',
            'agentSettings.basic': 'Basic Settings',
            'clusters.broadcastPrompt': 'Enter message to broadcast to all agents in this cluster:'
        },
        'zh-cn': {
            'common.loading': '加载中...',
            'common.close': '关闭',
            'common.save': '保存',
            'common.edit': '编辑',
            'common.delete': '删除',
            'common.create': '创建',
            'common.cancel': '取消',
            'common.settings': '设置',
            'common.openInExplorer': '在文件管理器中打开',
            'common.systemPrompt': '系统提示词',
            'common.temperature': '温度',
            'common.maxTokens': '最大 Token 数',
            'common.thinking': '思考',
            'common.thinkingLevel': '思考级别',
            'common.showThinking': '显示思考过程',
            'common.hideThinking': '隐藏思考过程',
            'thinking.started': '正在思考...',
            'thinking.processing': '处理中...',
            'thinking.completed': '思考完成',
            'thinking.step': '步骤 {step}',
            'agentSettings.title': 'Agent 设置',
            'agentSettings.name': '名称',
            'agentSettings.model': '模型',
            'agentSettings.workspace': '工作区',
            'agentSettings.advanced': '高级设置',
            'chat.placeholder': '输入你的消息... (Shift+Enter 发送)',
            'chat.send': '发送',
            'chat.thinking': '思考中',
            'chat.clear': '清空聊天',
            'sidebar.agents': 'Agents',
            'sidebar.clusters': '集群',
            'sidebar.usage': '用量',
            'sidebar.newAgent': '新建 Agent',
            'clusters.create': '创建集群',
            'clusters.broadcast': '广播',
            'usage.title': 'API 用量仪表板',
            'usage.refresh': '刷新',
            'usage.totalRequests': '总请求数',
            'usage.totalTokens': '总 Tokens',
            'usage.estimatedCost': '预估费用',
            'welcome.title': '欢迎使用 OpenClaw Luna',
            'welcome.subtitle': '从侧边栏选择一个 Agent 开始对话！',
            'sidebar.chat': '对话',
            'sidebar.basic': '基础设置',
            'agentSettings.basic': '基础设置',
            'clusters.broadcastPrompt': '输入要广播给此集群中所有 Agent 的消息：'
        }
    };

    let currentLocale = 'en';

    function setLocale(locale) {
        currentLocale = locale.startsWith('zh') ? 'zh-cn' : 'en';
    }

    function t(key, values = {}) {
        const messages = TRANSLATIONS[currentLocale] || TRANSLATIONS.en;
        let message = messages[key] || TRANSLATIONS.en[key] || key;
        
        // Replace placeholders
        Object.keys(values).forEach(k => {
            message = message.replace(new RegExp(`{${k}}`, 'g'), values[k]);
        });
        
        return message;
    }

    // Expose to global scope
    window.OpenClawI18n = {
        setLocale,
        t
    };
})();
