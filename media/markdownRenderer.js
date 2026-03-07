// OpenClaw Luna - Markdown Renderer (Lightweight)
(function() {
    'use strict';

    window.MarkdownRenderer = {
        render(content) {
            // Escape HTML first
            let html = this.escapeHtml(content);
            
            // Code blocks
            html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>');
            
            // Inline code
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
            
            // Bold
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            
            // Italic
            html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            
            // Line breaks
            html = html.replace(/\n/g, '<br>');
            
            return html;
        },
        
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
})();
