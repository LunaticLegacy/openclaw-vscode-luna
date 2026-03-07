// OpenClaw Luna - Markdown Renderer
(function() {
    'use strict';

    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function sanitizeUrl(value) {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) {
            return null;
        }

        if (/^(https?:|mailto:)/i.test(trimmed)) {
            return trimmed;
        }

        return null;
    }

    function isBlank(line) {
        return !line || !line.trim();
    }

    function countIndent(line) {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
    }

    function splitTableCells(line) {
        let text = String(line ?? '').trim();

        if (text.startsWith('|')) {
            text = text.slice(1);
        }

        if (text.endsWith('|')) {
            text = text.slice(0, -1);
        }

        const cells = [];
        let current = '';
        let escaping = false;

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

    function isTableSeparator(line) {
        const cells = splitTableCells(line);
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
    }

    function parseListItem(line) {
        const taskMatch = line.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
            return {
                ordered: false,
                indent: countIndent(taskMatch[1]),
                task: taskMatch[2].toLowerCase() === 'x',
                content: taskMatch[3],
                number: null
            };
        }

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

    function renderInline(text) {
        if (!text) {
            return '';
        }

        const inlineCodeBlocks = [];
        let source = String(text).replace(/`([^`\n]+)`/g, (_, code) => {
            const placeholder = `\u0000INLINE_CODE_${inlineCodeBlocks.length}\u0000`;
            inlineCodeBlocks.push(`<code>${escapeHtml(code)}</code>`);
            return placeholder;
        });

        let html = escapeHtml(source)
            .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, url, title) => {
                const safeUrl = sanitizeUrl(url);
                if (!safeUrl) {
                    return match;
                }

                const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
                return `<img src="${escapeAttribute(safeUrl)}" alt="${escapeAttribute(alt)}"${titleAttr}>`;
            })
            .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, label, url, title) => {
                const safeUrl = sanitizeUrl(url);
                if (!safeUrl) {
                    return match;
                }

                const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
                return `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
            })
            .replace(/\*\*([^*][\s\S]*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_][\s\S]*?)__/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
            .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        inlineCodeBlocks.forEach((code, index) => {
            const placeholder = `\u0000INLINE_CODE_${index}\u0000`;
            html = html.split(placeholder).join(code);
        });

        return html;
    }

    function renderList(lines, startIndex) {
        const firstItem = parseListItem(lines[startIndex]);
        if (!firstItem) {
            return null;
        }

        const items = [];
        let currentItem = null;
        let currentIndex = startIndex;

        while (currentIndex < lines.length) {
            const line = lines[currentIndex];
            const parsedItem = parseListItem(line);

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

            if (isBlank(line)) {
                currentItem.lines.push('');
                currentIndex += 1;
                continue;
            }

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

        const tag = firstItem.ordered ? 'ol' : 'ul';
        const allTaskItems = !firstItem.ordered && items.every(item => typeof item.task === 'boolean');
        const startAttr = firstItem.ordered && firstItem.number && firstItem.number !== 1
            ? ` start="${firstItem.number}"`
            : '';
        const classAttr = allTaskItems ? ' class="task-list"' : '';

        const itemsHtml = items.map(item => {
            const contentHtml = item.lines.map(renderInline).join('<br>');
            if (typeof item.task === 'boolean') {
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

    function renderTable(lines, startIndex) {
        const headerLine = lines[startIndex];
        const separatorLine = lines[startIndex + 1];

        if (!headerLine || !separatorLine || !headerLine.includes('|') || !isTableSeparator(separatorLine)) {
            return null;
        }

        const headers = splitTableCells(headerLine);
        const rows = [];
        let currentIndex = startIndex + 2;

        while (currentIndex < lines.length) {
            const line = lines[currentIndex];
            if (isBlank(line) || !line.includes('|')) {
                break;
            }

            rows.push(splitTableCells(line));
            currentIndex += 1;
        }

        const headerHtml = headers.map(cell => `<th>${renderInline(cell)}</th>`).join('');
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

    function isBlockStarter(lines, index) {
        const line = lines[index];
        if (!line) {
            return false;
        }

        if (/^\u0000CODE_BLOCK_\d+\u0000$/.test(line.trim())) {
            return true;
        }

        if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) || /^\s*>/.test(line)) {
            return true;
        }

        if (parseListItem(line)) {
            return true;
        }

        return line.includes('|') && isTableSeparator(lines[index + 1] || '');
    }

    function renderBlocks(lines) {
        const parts = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];

            if (isBlank(line)) {
                index += 1;
                continue;
            }

            const placeholderMatch = line.trim().match(/^\u0000CODE_BLOCK_(\d+)\u0000$/);
            if (placeholderMatch) {
                parts.push(line.trim());
                index += 1;
                continue;
            }

            const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                parts.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
                index += 1;
                continue;
            }

            if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
                parts.push('<hr>');
                index += 1;
                continue;
            }

            const tableResult = renderTable(lines, index);
            if (tableResult) {
                parts.push(tableResult.html);
                index = tableResult.nextIndex;
                continue;
            }

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

            const listResult = renderList(lines, index);
            if (listResult) {
                parts.push(listResult.html);
                index = listResult.nextIndex;
                continue;
            }

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

    function restoreCodeBlocks(html, codeBlocks) {
        let output = html;

        codeBlocks.forEach((block, index) => {
            const placeholder = `\u0000CODE_BLOCK_${index}\u0000`;
            const langLabel = block.lang ? `<div class="md-code-header">${escapeHtml(block.lang)}</div>` : '';
            const langClass = block.lang ? ` class="language-${escapeAttribute(block.lang)}"` : '';
            const codeHtml = `<div class="md-code-block">${langLabel}<pre><code${langClass}>${escapeHtml(block.code)}</code></pre></div>`;
            output = output.split(placeholder).join(codeHtml);
        });

        return output;
    }

    function render(content) {
        const normalized = String(content ?? '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) {
            return '';
        }

        const codeBlocks = [];
        const withoutCodeFences = normalized.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const placeholder = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
            codeBlocks.push({
                lang: String(lang ?? '').trim(),
                code: String(code ?? '').replace(/^\n+|\n+$/g, '')
            });
            return `\n${placeholder}\n`;
        });

        const html = renderBlocks(withoutCodeFences.split('\n'));
        return restoreCodeBlocks(html, codeBlocks);
    }

    window.MarkdownRenderer = {
        render,
        escapeHtml
    };
})();
