// OpenClaw Luna - Markdown Renderer
// 该文件实现了一个轻量级的Markdown渲染器，支持代码块、表格、列表、内联格式等
(function() {
    'use strict';

    // HTML转义映射表，用于防止XSS攻击
    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    /**
     * 转义HTML特殊字符
     * 将 &, <, >, ", ' 转换为对应的HTML实体
     * @param {*} value - 要转义的值
     * @returns {string} 转义后的字符串
     */
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
    }

    /**
     * 转义HTML属性值
     * 在escapeHtml基础上额外转义反引号
     * @param {*} value - 要转义的值
     * @returns {string} 转义后的属性值
     */
    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    /**
     * 净化URL，只允许安全的协议
     * 仅允许http/https/mailto协议，防止javascript:等危险协议
     * @param {*} value - URL值
     * @returns {string|null} 安全的URL或null
     */
    function sanitizeUrl(value) {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) {
            return null;
        }

        // 只允许http/https/mailto协议
        if (/^(https?:|mailto:)/i.test(trimmed)) {
            return trimmed;
        }

        return null;
    }

    /**
     * 判断行是否为空行或仅包含空白字符
     * @param {string} line - 行内容
     * @returns {boolean} 是否为空行
     */
    function isBlank(line) {
        return !line || !line.trim();
    }

    /**
     * 计算行的缩进空格数
     * @param {string} line - 行内容
     * @returns {number} 缩进空格数
     */
    function countIndent(line) {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
    }

    /**
     * 分割表格单元格
     * 处理Markdown表格的|分隔符，支持转义字符
     * @param {string} line - 表格行内容
     * @returns {Array} 单元格数组
     */
    function splitTableCells(line) {
        let text = String(line ?? '').trim();

        // 去除首尾的|分隔符
        if (text.startsWith('|')) {
            text = text.slice(1);
        }

        if (text.endsWith('|')) {
            text = text.slice(0, -1);
        }

        const cells = [];
        let current = '';
        let escaping = false;

        // 逐字符解析，处理转义
        for (const char of text) {
            if (escaping) {
                current += char;
                escaping = false;
                continue;
            }

            if (char === '\\') {
                escaping = true;
                continue;
            }

            if (char === '|') {
                cells.push(current.trim());
                current = '';
                continue;
            }

            current += char;
        }

        cells.push(current.trim());
        return cells;
    }

    /**
     * 判断是否为表格分隔符行（如|:---:|）
     * @param {string} line - 行内容
     * @returns {boolean} 是否为表格分隔符行
     */
    function isTableSeparator(line) {
        const cells = splitTableCells(line);
        // 每个单元格必须匹配对齐标记模式（:---:）
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
    }

    /**
     * 解析列表项
     * 支持任务列表、无序列表和有序列表
     * @param {string} line - 行内容
     * @returns {Object|null} 列表项对象或null（如果不是列表项）
     */
    function parseListItem(line) {
        // 任务列表：- [x] 内容 或 - [ ] 内容
        const taskMatch = line.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
            return {
                ordered: false,      // 无序列表
                indent: countIndent(taskMatch[1]),
                task: taskMatch[2].toLowerCase() === 'x',  // 是否勾选
                content: taskMatch[3],
                number: null
            };
        }

        // 无序列表：- 内容 或 + 内容 或 * 内容
        const unorderedMatch = line.match(/^(\s*)[-+*]\s+(.*)$/);
        if (unorderedMatch) {
            return {
                ordered: false,
                indent: countIndent(unorderedMatch[1]),
                task: null,
                content: unorderedMatch[2],
                number: null
            };
        }

        // 有序列表：1. 内容
        const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
            return {
                ordered: true,
                indent: countIndent(orderedMatch[1]),
                task: null,
                content: orderedMatch[3],
                number: Number(orderedMatch[2])
            };
        }

        return null;
    }

    /**
     * 渲染内联格式
     * 支持：代码、图片、链接、粗体、斜体、删除线
     * @param {string} text - 原始文本
     * @returns {string} 渲染后的HTML
     */
    function renderInline(text) {
        if (!text) {
            return '';
        }

        // 提取内联代码块，使用占位符保护
        const inlineCodeBlocks = [];
        let source = String(text).replace(/`([^`\n]+)`/g, (_, code) => {
            const placeholder = `\u0000INLINECODE${inlineCodeBlocks.length}\u0000`;
            inlineCodeBlocks.push(`<code>${escapeHtml(code)}</code>`);
            return placeholder;
        });

        // 依次渲染各种内联格式
        let html = escapeHtml(source)
            // 图片：![alt](url "title")
            .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, url, title) => {
                const safeUrl = sanitizeUrl(url);
                if (!safeUrl) {
                    return match;
                }

                const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
                return `<img src="${escapeAttribute(safeUrl)}" alt="${escapeAttribute(alt)}"${titleAttr}>`;
            })
            // 链接：[label](url "title")
            .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, label, url, title) => {
                const safeUrl = sanitizeUrl(url);
                if (!safeUrl) {
                    return match;
                }

                const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
                return `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
            })
            // 粗体：**text** 或 __text__
            .replace(/\*\*([^*][\s\S]*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_][\s\S]*?)__/g, '<strong>$1</strong>')
            // 斜体：*text* 或 _text_
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
            // 删除线：~~text~~
            .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        // 恢复内联代码块
        inlineCodeBlocks.forEach((code, index) => {
            const placeholder = `\u0000INLINECODE${index}\u0000`;
            html = html.split(placeholder).join(code);
        });

        return html;
    }

    /**
     * 渲染列表（无序或有序）
     * @param {Array} lines - 所有行数组
     * @param {number} startIndex - 列表开始的行索引
     * @returns {Object|null} 包含html和nextIndex的对象，如果不是列表则返回null
     */
    function renderList(lines, startIndex) {
        const firstItem = parseListItem(lines[startIndex]);
        if (!firstItem) {
            return null;
        }

        const items = [];
        let currentItem = null;
        let currentIndex = startIndex;

        // 逐行解析列表项
        while (currentIndex < lines.length) {
            const line = lines[currentIndex];
            const parsedItem = parseListItem(line);

            // 新的同类型列表项（相同的有序/无序类型和缩进级别）
            if (parsedItem && parsedItem.ordered === firstItem.ordered && parsedItem.indent === firstItem.indent) {
                if (currentItem) {
                    items.push(currentItem);
                }

                currentItem = {
                    task: parsedItem.task,
                    lines: [parsedItem.content]
                };
                currentIndex += 1;
                continue;
            }

            if (!currentItem) {
                break;
            }

            // 空行保留
            if (isBlank(line)) {
                currentItem.lines.push('');
                currentIndex += 1;
                continue;
            }

            // 缩进更大的行作为当前项的续行
            if (countIndent(line) > firstItem.indent) {
                currentItem.lines.push(line.trim());
                currentIndex += 1;
                continue;
            }

            break;
        }

        if (currentItem) {
            items.push(currentItem);
        }

        // 确定列表标签类型（ul或ol）
        const tag = firstItem.ordered ? 'ol' : 'ul';
        // 判断是否所有项都是任务项
        const allTaskItems = !firstItem.ordered && items.every(item => typeof item.task === 'boolean');
        // 有序列表的起始编号
        const startAttr = firstItem.ordered && firstItem.number && firstItem.number !== 1
            ? ` start="${firstItem.number}"`
            : '';
        const classAttr = allTaskItems ? ' class="task-list"' : '';

        // 渲染列表项HTML
        const itemsHtml = items.map(item => {
            const contentHtml = item.lines.map(renderInline).join('<br>');
            if (typeof item.task === 'boolean') {
                // 任务列表项，带复选框
                return `
                    <li class="task-list-item">
                        <span class="task-list-control"><input type="checkbox" disabled${item.task ? ' checked' : ''}></span>
                        <span class="task-list-content">${contentHtml}</span>
                    </li>
                `;
            }

            return `<li>${contentHtml}</li>`;
        }).join('');

        return {
            html: `<${tag}${startAttr}${classAttr}>${itemsHtml}</${tag}>`,
            nextIndex: currentIndex
        };
    }

    /**
     * 渲染Markdown表格
     * @param {Array} lines - 所有行数组
     * @param {number} startIndex - 表格开始的行索引
     * @returns {Object|null} 包含html和nextIndex的对象，如果不是表格则返回null
     */
    function renderTable(lines, startIndex) {
        const headerLine = lines[startIndex];
        const separatorLine = lines[startIndex + 1];

        // 检查表格结构：表头行 + 分隔符行
        if (!headerLine || !separatorLine || !headerLine.includes('|') || !isTableSeparator(separatorLine)) {
            return null;
        }

        const headers = splitTableCells(headerLine);
        const rows = [];
        let currentIndex = startIndex + 2;

        // 收集数据行
        while (currentIndex < lines.length) {
            const line = lines[currentIndex];
            if (isBlank(line) || !line.includes('|')) {
                break;
            }

            rows.push(splitTableCells(line));
            currentIndex += 1;
        }

        // 渲染表头
        const headerHtml = headers.map(cell => `<th>${renderInline(cell)}</th>`).join('');
        // 渲染表体（如果有数据行）
        const bodyHtml = rows.length > 0
            ? `<tbody>${rows.map(row => `
                <tr>${headers.map((_, index) => `<td>${renderInline(row[index] || '')}</td>`).join('')}</tr>
            `).join('')}</tbody>`
            : '';

        return {
            html: `<div class="md-table-wrap"><table><thead><tr>${headerHtml}</tr></thead>${bodyHtml}</table></div>`,
            nextIndex: currentIndex
        };
    }

    /**
     * 判断某行是否为块级元素的开始
     * 用于段落解析时识别何时停止
     * @param {Array} lines - 所有行数组
     * @param {number} index - 行索引
     * @returns {boolean} 是否为块级元素开始
     */
    function isBlockStarter(lines, index) {
        const line = lines[index];
        if (!line) {
            return false;
        }

        // 代码块占位符
        if (/^\u0000CODE_BLOCK_\d+\u0000$/.test(line.trim())) {
            return true;
        }

        // 标题、分隔线、引用块
        if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) || /^\s*>/.test(line)) {
            return true;
        }

        // 列表项
        if (parseListItem(line)) {
            return true;
        }

        // 表格（当前行包含|且下一行是分隔符）
        return line.includes('|') && isTableSeparator(lines[index + 1] || '');
    }

    /**
     * 渲染块级元素
     * 包括：代码块占位符、标题、分隔线、表格、引用块、列表、段落
     * @param {Array} lines - 行数组
     * @returns {string} 渲染后的HTML
     */
    function renderBlocks(lines) {
        const parts = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];

            // 跳过空行
            if (isBlank(line)) {
                index += 1;
                continue;
            }

            // 代码块占位符：直接保留
            const placeholderMatch = line.trim().match(/^\u0000CODE_BLOCK_(\d+)\u0000$/);
            if (placeholderMatch) {
                parts.push(line.trim());
                index += 1;
                continue;
            }

            // 标题：# ## ### #### ##### ######
            const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                parts.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
                index += 1;
                continue;
            }

            // 分隔线：--- 或 *** 或 ___
            if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
                parts.push('<hr>');
                index += 1;
                continue;
            }

            // 表格
            const tableResult = renderTable(lines, index);
            if (tableResult) {
                parts.push(tableResult.html);
                index = tableResult.nextIndex;
                continue;
            }

            // 引用块：> 内容
            if (/^\s*>/.test(line)) {
                const quoteLines = [];
                let quoteIndex = index;

                while (quoteIndex < lines.length) {
                    const quoteLine = lines[quoteIndex];
                    if (isBlank(quoteLine)) {
                        quoteLines.push('');
                        quoteIndex += 1;
                        continue;
                    }

                    const match = quoteLine.match(/^\s*>\s?(.*)$/);
                    if (!match) {
                        break;
                    }

                    quoteLines.push(match[1]);
                    quoteIndex += 1;
                }

                parts.push(`<blockquote>${renderBlocks(quoteLines)}</blockquote>`);
                index = quoteIndex;
                continue;
            }

            // 列表
            const listResult = renderList(lines, index);
            if (listResult) {
                parts.push(listResult.html);
                index = listResult.nextIndex;
                continue;
            }

            // 段落：收集连续的非空行且非块级元素开始的行
            const paragraphLines = [line];
            let paragraphIndex = index + 1;

            while (paragraphIndex < lines.length && !isBlank(lines[paragraphIndex]) && !isBlockStarter(lines, paragraphIndex)) {
                paragraphLines.push(lines[paragraphIndex]);
                paragraphIndex += 1;
            }

            parts.push(`<p>${paragraphLines.map(renderInline).join('<br>')}</p>`);
            index = paragraphIndex;
        }

        return parts.join('');
    }

    /**
     * 恢复代码块
     * 将占位符替换为实际的代码块HTML
     * @param {string} html - 包含占位符的HTML
     * @param {Array} codeBlocks - 代码块数组，每个元素包含lang和code
     * @returns {string} 恢复后的HTML
     */
    function restoreCodeBlocks(html, codeBlocks) {
        let output = html;

        codeBlocks.forEach((block, index) => {
            const placeholder = `\u0000CODE_BLOCK_${index}\u0000`;
            // 语言标签
            const langLabel = block.lang ? `<div class="md-code-header">${escapeHtml(block.lang)}</div>` : '';
            // 语言类名
            const langClass = block.lang ? ` class="language-${escapeAttribute(block.lang)}"` : '';
            // 代码块HTML
            const codeHtml = `<div class="md-code-block">${langLabel}<pre><code${langClass}>${escapeHtml(block.code)}</code></pre></div>`;
            output = output.split(placeholder).join(codeHtml);
        });

        return output;
    }

    /**
     * 渲染Markdown内容
     * 主入口函数，处理代码块提取、块级渲染和代码块恢复
     * @param {*} content - Markdown内容
     * @returns {string} 渲染后的HTML
     */
    function render(content) {
        // 统一换行符并trim
        const normalized = String(content ?? '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) {
            return '';
        }

        // 提取代码块，使用占位符替换
        const codeBlocks = [];
        const withoutCodeFences = normalized.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const placeholder = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
            codeBlocks.push({
                lang: String(lang ?? '').trim(),
                code: String(code ?? '').replace(/^\n+|\n+$/g, '')  // 去除首尾空行
            });
            return `\n${placeholder}\n`;
        });

        // 渲染块级元素，然后恢复代码块
        const html = renderBlocks(withoutCodeFences.split('\n'));
        return restoreCodeBlocks(html, codeBlocks);
    }

    // 导出MarkdownRenderer到全局作用域
    window.MarkdownRenderer = {
        render,
        escapeHtml
    };
})();
