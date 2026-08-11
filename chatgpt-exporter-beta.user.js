// ==UserScript==
// @name         ChatGPT Universal Exporter Enhanced Beta
// @namespace    https://github.com/zjt666666zjt/ChatGPT_Exporter
// @version      1.1.0-beta.3
// @description  Export ChatGPT conversations and Projects to ZIP as JSON, Markdown, and readable HTML with adaptive retry and failure reports.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @homepageURL  https://github.com/zjt666666zjt/ChatGPT_Exporter
// @supportURL   https://github.com/zjt666666zjt/ChatGPT_Exporter/issues
// @downloadURL  https://raw.githubusercontent.com/zjt666666zjt/ChatGPT_Exporter/main/chatgpt-exporter-beta.user.js
// @updateURL    https://raw.githubusercontent.com/zjt666666zjt/ChatGPT_Exporter/main/chatgpt-exporter-beta.user.js
// @grant        none
// @license      MIT
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.1.0-beta.3';
    const PAGE_LIMIT = 100;
    const BASE_DELAY = 650;
    const JITTER = 350;
    const RETRY_BASE_DELAY = 2000;
    const MAX_RETRY_DELAY = 60000;
    const MAX_RETRIES = 5;

    let accessToken = null;
    const capturedWorkspaceIds = new Set();
    let adaptiveDelay = BASE_DELAY;
    let nextRequestAt = 0;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const sanitizeFilename = value => String(value || 'Untitled')
        .replace(/[\/\\?%*:|"<>\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || 'Untitled';

    const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>`;
    const ICON_SPINNER = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"></circle><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"></path></svg>`;
    const ICON_CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5z"></path></svg>`;
    const ICON_ERROR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2v-6z"></path></svg>`;

    (function interceptFetch() {
        const rawFetch = window.fetch;
        if (typeof rawFetch !== 'function') return;
        window.fetch = function (resource, options) {
            try {
                const requestUrl = resource instanceof Request ? resource.url : String(resource || '');
                const url = new URL(requestUrl, location.href);
                if (url.origin === location.origin) {
                    const candidates = [];
                    if (resource instanceof Request) candidates.push(resource.headers);
                    if (options && options.headers) candidates.push(options.headers);
                    for (const headersLike of candidates) captureHeaders(headersLike);
                }
            } catch (_) {}
            return rawFetch.apply(this, arguments);
        };
    })();

    function headerValue(headersLike, name) {
        if (!headersLike) return null;
        const needle = name.toLowerCase();
        try {
            if (headersLike instanceof Headers) return headersLike.get(name);
            if (Array.isArray(headersLike)) {
                const pair = headersLike.find(entry => Array.isArray(entry) && String(entry[0]).toLowerCase() === needle);
                return pair ? pair[1] : null;
            }
            if (typeof headersLike === 'object') {
                const key = Object.keys(headersLike).find(k => k.toLowerCase() === needle);
                return key ? headersLike[key] : null;
            }
        } catch (_) {}
        return null;
    }

    function captureHeaders(headersLike) {
        const auth = headerValue(headersLike, 'Authorization');
        if (auth && /^Bearer\s+(.+)/i.test(String(auth))) {
            const token = String(auth).replace(/^Bearer\s+/i, '').trim();
            if (token && token.toLowerCase() !== 'dummy') accessToken = token;
        }
        const workspaceId = headerValue(headersLike, 'ChatGPT-Account-Id');
        if (workspaceId) capturedWorkspaceIds.add(String(workspaceId));
    }

    async function ensureAccessToken() {
        if (accessToken) return accessToken;
        try {
            const response = await fetch('/api/auth/session?unstable_client=true');
            if (response.ok) {
                const session = await response.json();
                if (session && session.accessToken) {
                    accessToken = session.accessToken;
                    return accessToken;
                }
            }
        } catch (_) {}
        alert('无法获取 Access Token。请刷新 ChatGPT，打开任意一个对话后再试。');
        return null;
    }

    function getOaiDeviceId() {
        const match = document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    function buildHeaders(workspaceId) {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const did = getOaiDeviceId();
        if (did) headers['oai-device-id'] = did;
        if (workspaceId) headers['ChatGPT-Account-Id'] = workspaceId;
        return headers;
    }

    function getRetryAfterMs(response) {
        const raw = response && response.headers ? response.headers.get('Retry-After') : null;
        if (!raw) return 0;
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const absolute = Date.parse(raw);
        return Number.isFinite(absolute) ? Math.max(0, absolute - Date.now()) : 0;
    }

    async function paceRequest(extra = 0) {
        const now = Date.now();
        const wait = Math.max(0, nextRequestAt - now, extra);
        if (wait) await sleep(wait);
        nextRequestAt = Date.now() + adaptiveDelay + Math.random() * JITTER;
    }

    async function fetchWithRetry(input, init = {}, retries = MAX_RETRIES) {
        let attempt = 0;
        while (true) {
            await paceRequest();
            try {
                const response = await fetch(input, init);
                if (response.ok) {
                    adaptiveDelay = Math.max(BASE_DELAY, adaptiveDelay * 0.92);
                    return response;
                }

                const retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
                if (!retryable || attempt >= retries) return response;

                const serverDelay = getRetryAfterMs(response);
                const exponential = Math.min(MAX_RETRY_DELAY, RETRY_BASE_DELAY * Math.pow(2, attempt));
                const wait = Math.min(MAX_RETRY_DELAY, Math.max(serverDelay, exponential) + Math.random() * JITTER);
                if (response.status === 429) adaptiveDelay = Math.min(5000, Math.max(adaptiveDelay * 1.7, BASE_DELAY + 500));
                attempt++;
                await paceRequest(wait);
            } catch (error) {
                if (attempt >= retries) throw error;
                const wait = Math.min(MAX_RETRY_DELAY, RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER);
                attempt++;
                await paceRequest(wait);
            }
        }
    }

    async function requestJson(url, init, context) {
        const response = await fetchWithRetry(url, init);
        if (!response.ok) {
            const error = new Error(`${context || '请求失败'} (${response.status})`);
            error.status = response.status;
            throw error;
        }
        try {
            return await response.json();
        } catch (_) {
            throw new Error(`${context || '请求失败'}：响应不是有效 JSON`);
        }
    }

    function partToText(part) {
        if (typeof part === 'string') return part;
        if (part == null) return '';
        if (typeof part === 'number' || typeof part === 'boolean') return String(part);
        if (typeof part === 'object') {
            if (typeof part.text === 'string') return part.text;
            if (typeof part.content === 'string') return part.content;
            if (typeof part.asset_pointer === 'string') return `[Image: ${part.asset_pointer}]`;
            if (typeof part.url === 'string') return `[Attachment: ${part.url}]`;
        }
        return '';
    }

    function messageText(message) {
        const content = message && message.content;
        if (!content) return '';
        if (Array.isArray(content.parts)) return content.parts.map(partToText).filter(Boolean).join('\n');
        if (typeof content.text === 'string') return content.text;
        return '';
    }

    function parseConversation(convData) {
        const mapping = convData.mapping || {};
        const selected = [];
        const currentNode = convData.current_node;

        if (currentNode && mapping[currentNode]) {
            let nodeId = currentNode;
            const seen = new Set();
            while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
                seen.add(nodeId);
                selected.push(mapping[nodeId]);
                nodeId = mapping[nodeId].parent;
            }
            selected.reverse();
        } else {
            selected.push(...Object.values(mapping));
            selected.sort((a, b) => ((a?.message?.create_time || 0) - (b?.message?.create_time || 0)));
        }

        const messages = [];
        for (const node of selected) {
            const message = node && node.message;
            const role = message && message.author && message.author.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const content = messageText(message);
            if (!content.trim()) continue;
            messages.push({
                role,
                content,
                createTime: message.create_time || null,
                model: (message.metadata && message.metadata.model_slug) || ''
            });
        }

        return {
            title: convData.title || 'Untitled Conversation',
            createTime: convData.create_time || null,
            updateTime: convData.update_time || null,
            conversationId: convData.conversation_id || convData.id || '',
            model: convData.default_model_slug || '',
            messages
        };
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeUrl(raw) {
        try {
            const value = String(raw || '').trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            const url = new URL(value, 'https://chatgpt.com/');
            if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '#';
            return escapeHtml(value);
        } catch (_) {
            return '#';
        }
    }

    function renderInlineMarkdown(input) {
        let text = String(input || '');
        const tokens = [];
        const token = html => {
            const id = tokens.length;
            tokens.push(html);
            return `§§UETOKEN${id}§§`;
        };

        text = text.replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
        text = text.replace(/\$([^$\n]+)\$/g, (_, math) => token(`<span class="math-inline">${escapeHtml(math)}</span>`));
        text = escapeHtml(text);
        text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (_, alt, url) => token(`<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`));
        text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (_, label, url) => token(`<a href="${safeUrl(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`));
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
        text = text.replace(/§§UETOKEN(\d+)§§/g, (_, index) => tokens[Number(index)] || '');
        return text;
    }

    function splitTableRow(line) {
        let value = String(line || '').trim();
        if (value.startsWith('|')) value = value.slice(1);
        if (value.endsWith('|')) value = value.slice(0, -1);
        return value.split('|').map(cell => cell.trim());
    }

    function isTableSeparator(line) {
        const cells = splitTableRow(line);
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
    }

    function renderMarkdownToHtml(markdown) {
        const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) { i++; continue; }

            const fence = line.match(/^```([^\s`]*)\s*$/);
            if (fence) {
                const language = escapeHtml(fence[1] || 'text');
                const code = [];
                i++;
                while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
                if (i < lines.length) i++;
                out.push(`<pre><code class="language-${language}">${escapeHtml(code.join('\n'))}</code></pre>`);
                continue;
            }

            if (/^\$\$\s*$/.test(line)) {
                const math = [];
                i++;
                while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) math.push(lines[i++]);
                if (i < lines.length) i++;
                out.push(`<div class="math-block">${escapeHtml(math.join('\n'))}</div>`);
                continue;
            }

            if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
                const headers = splitTableRow(line);
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
                out.push(`<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${renderInlineMarkdown(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, idx) => `<td>${renderInlineMarkdown(row[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
                continue;
            }

            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                const level = heading[1].length;
                out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
                i++;
                continue;
            }

            if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
                out.push('<hr>');
                i++;
                continue;
            }

            if (/^>\s?/.test(line)) {
                const quote = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
                out.push(`<blockquote>${renderMarkdownToHtml(quote.join('\n'))}</blockquote>`);
                continue;
            }

            if (/^\s*[-+*]\s+/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*[-+*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-+*]\s+/, ''));
                out.push(`<ul>${items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
                continue;
            }

            if (/^\s*\d+[.)]\s+/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
                out.push(`<ol>${items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`);
                continue;
            }

            const paragraph = [line];
            i++;
            while (i < lines.length && lines[i].trim()) {
                const next = lines[i];
                if (/^```/.test(next) || /^\$\$\s*$/.test(next) || /^(#{1,6})\s+/.test(next) || /^>\s?/.test(next) || /^\s*[-+*]\s+/.test(next) || /^\s*\d+[.)]\s+/.test(next)) break;
                if (i + 1 < lines.length && next.includes('|') && isTableSeparator(lines[i + 1])) break;
                paragraph.push(next);
                i++;
            }
            out.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
        }

        return out.join('\n');
    }

    function convertToMarkdown(convData) {
        const parsed = parseConversation(convData);
        let md = `# ${parsed.title}\n\n`;
        md += `**Conversation ID:** \`${parsed.conversationId || 'Unknown'}\`\n\n`;
        if (parsed.model) md += `**Model:** ${parsed.model}\n\n`;
        if (parsed.createTime) md += `**Created:** ${new Date(parsed.createTime * 1000).toLocaleString()}\n\n`;
        if (parsed.updateTime) md += `**Last Updated:** ${new Date(parsed.updateTime * 1000).toLocaleString()}\n\n`;
        md += '---\n\n';
        parsed.messages.forEach((message, index) => {
            const role = message.role === 'user' ? '👤 User' : '🤖 Assistant';
            const time = message.createTime ? ` (${new Date(message.createTime * 1000).toLocaleString()})` : '';
            md += `## ${role}${time}\n\n${message.content}\n\n`;
            if (index < parsed.messages.length - 1) md += '---\n\n';
        });
        return md;
    }

    function convertToHTML(convData) {
        const parsed = parseConversation(convData);
        const metadata = [
            `ID: ${escapeHtml(parsed.conversationId || 'Unknown')}`,
            parsed.model ? `Model: ${escapeHtml(parsed.model)}` : '',
            parsed.createTime ? `Created: ${escapeHtml(new Date(parsed.createTime * 1000).toLocaleString())}` : ''
        ].filter(Boolean).join(' · ');

        const messages = parsed.messages.map(message => {
            const roleLabel = message.role === 'user' ? 'User' : 'Assistant';
            const timestamp = message.createTime ? new Date(message.createTime * 1000).toLocaleString() : '';
            return `<article class="message ${message.role}"><header><strong>${roleLabel}</strong>${timestamp ? `<time>${escapeHtml(timestamp)}</time>` : ''}</header><div class="message-content">${renderMarkdownToHtml(message.content)}</div></article>`;
        }).join('\n');

        return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(parsed.title)}</title>
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#202123;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}.page{max-width:980px;margin:32px auto;background:#fff;border:1px solid #ddd;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)}.top{padding:28px 32px;border-bottom:1px solid #e5e5e5}.top h1{margin:0 0 8px;font-size:26px;line-height:1.25}.meta{color:#666;font-size:12px;word-break:break-all}.conversation{padding:26px}.message{padding:20px 22px;margin:0 0 18px;border:1px solid #e5e5e5;border-radius:10px;background:#fff}.message.user{background:#f7f7f8}.message header{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid #eee}.message time{font-size:12px;color:#777}.message-content h1,.message-content h2,.message-content h3,.message-content h4,.message-content h5,.message-content h6{margin:1.2em 0 .55em;line-height:1.3}.message-content h1{font-size:1.65em}.message-content h2{font-size:1.4em}.message-content h3{font-size:1.2em}.message-content p{margin:.7em 0}.message-content ul,.message-content ol{padding-left:1.6em}.message-content blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #999;color:#555;background:#fafafa}.message-content pre{margin:1em 0;padding:14px 16px;border-radius:8px;overflow:auto;background:#1f1f1f;color:#f3f3f3;white-space:pre}.message-content code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#eee;padding:.15em .35em;border-radius:4px}.message-content pre code{background:transparent;padding:0}.table-wrap{overflow-x:auto;margin:1em 0}.message-content table{width:100%;border-collapse:collapse}.message-content th,.message-content td{border:1px solid #ccc;padding:7px 9px;text-align:left;vertical-align:top}.message-content th{background:#f3f3f3}.message-content img{max-width:100%;height:auto;border-radius:6px}.message-content a{color:#0969da;word-break:break-word}.math-inline,.math-block{font-family:"Times New Roman",serif;background:#f6f6f6;border-radius:4px}.math-inline{padding:.08em .3em}.math-block{padding:12px 14px;margin:1em 0;white-space:pre-wrap;overflow:auto}hr{border:0;border-top:1px solid #ddd;margin:1.5em 0}@media(max-width:700px){body{background:#fff}.page{margin:0;border:0;border-radius:0}.top,.conversation{padding:18px}.message{padding:16px}}@media(prefers-color-scheme:dark){body{background:#161616;color:#e8e8e8}.page,.message{background:#202020;border-color:#3a3a3a}.message.user{background:#292929}.top,.message header{border-color:#3a3a3a}.meta,.message time{color:#aaa}.message-content blockquote{background:#292929;color:#ccc}.message-content code{background:#333}.message-content th{background:#292929}.message-content th,.message-content td{border-color:#555}.math-inline,.math-block{background:#2c2c2c}.message-content a{color:#6ea8fe}}
</style>
</head>
<body><main class="page"><header class="top"><h1>${escapeHtml(parsed.title)}</h1><div class="meta">${metadata}</div></header><section class="conversation">${messages}</section></main></body></html>`;
    }

    function generateUniqueFilename(convData, extension) {
        const title = sanitizeFilename(convData.title || 'Untitled Conversation');
        const id = sanitizeFilename(convData.conversation_id || convData.id || Math.random().toString(36).slice(2, 10));
        const date = convData.create_time ? new Date(convData.create_time * 1000) : new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
        return `${title}_${id}_${stamp}.${extension}`;
    }

    function normalizeProject(item) {
        const gizmo = item && (item.gizmo || item.project || item);
        const id = gizmo && (gizmo.id || gizmo.gizmo_id || gizmo.project_id);
        const title = gizmo && ((gizmo.display && gizmo.display.name) || gizmo.name || gizmo.title);
        return id ? { id: String(id), title: String(title || id) } : null;
    }

    function normalizeConversationMeta(item) {
        const value = item && (item.conversation || item);
        if (!value) return null;
        const id = value.id || value.conversation_id;
        if (!id) return null;
        return {
            id: String(id),
            title: value.title || 'Untitled Conversation',
            updatedAt: value.update_time || value.updated_time || value.updated_at || value.update_at || value.create_time || 0
        };
    }

    async function getProjects(workspaceId) {
        const headers = buildHeaders(workspaceId);
        const projects = new Map();
        const seenCursors = new Set();
        let cursor = null;

        while (true) {
            const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
            const data = await requestJson(`/backend-api/gizmos/snorlax/sidebar${query}`, { headers }, '获取项目列表失败');
            const items = data.items || data.gizmos || data.projects || [];
            for (const item of items) {
                const project = normalizeProject(item);
                if (project) projects.set(project.id, project);
            }
            const nextCursor = data.next_cursor ?? data.cursor ?? null;
            const hasMore = data.has_more ?? data.hasMore ?? Boolean(nextCursor);
            if (!hasMore || !nextCursor || seenCursors.has(String(nextCursor))) break;
            seenCursors.add(String(nextCursor));
            cursor = String(nextCursor);
        }
        return Array.from(projects.values());
    }

    async function collectRootConversations(headers, rootLimit) {
        const map = new Map();
        const perBucketLimit = Number.isFinite(rootLimit) ? Math.max(1, rootLimit) : Infinity;

        for (const isArchived of [false, true]) {
            let offset = 0;
            let bucketCount = 0;
            while (true) {
                const remaining = Number.isFinite(perBucketLimit) ? Math.max(1, perBucketLimit - bucketCount) : PAGE_LIMIT;
                const pageLimit = Math.min(PAGE_LIMIT, remaining);
                const url = `/backend-api/conversations?offset=${offset}&limit=${pageLimit}&order=updated${isArchived ? '&is_archived=true' : ''}`;
                const data = await requestJson(url, { headers }, '列举项目外对话失败');
                const items = data.items || [];
                if (!items.length) break;
                for (const item of items) {
                    const meta = normalizeConversationMeta(item);
                    if (!meta) continue;
                    const existing = map.get(meta.id);
                    if (!existing || meta.updatedAt > existing.updatedAt) map.set(meta.id, { ...meta, source: 'root', isArchived });
                    bucketCount++;
                }
                offset += items.length;
                if (Number.isFinite(perBucketLimit) && bucketCount >= perBucketLimit) break;
                if (items.length < pageLimit) break;
            }
        }

        return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    async function fetchProjectConversationPage(projectId, cursor, headers) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        let response = await fetchWithRetry(`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations${query}`, { headers });
        if (!cursor && !response.ok && [400, 422].includes(response.status)) {
            response = await fetchWithRetry(`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=0`, { headers });
        }
        if (!response.ok) {
            const error = new Error(`列举项目对话失败 (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    async function collectProjectConversations(headers, workspaceId) {
        const map = new Map();
        const projects = await getProjects(workspaceId);
        for (const project of projects) {
            let cursor = null;
            const seenCursors = new Set();
            while (true) {
                const data = await fetchProjectConversationPage(project.id, cursor, headers);
                const items = data.items || data.conversations || [];
                for (const item of items) {
                    const meta = normalizeConversationMeta(item);
                    if (!meta) continue;
                    map.set(meta.id, { ...meta, source: 'project', projectId: project.id, projectTitle: project.title });
                }
                const nextCursor = data.next_cursor ?? data.cursor ?? null;
                const hasMore = data.has_more ?? data.hasMore ?? Boolean(nextCursor);
                if (!hasMore || !nextCursor || seenCursors.has(String(nextCursor))) break;
                seenCursors.add(String(nextCursor));
                cursor = String(nextCursor);
            }
        }
        return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    async function collectConversationsMeta(workspaceId, includeProjects, rootLimit) {
        const headers = buildHeaders(workspaceId);
        const rootAll = await collectRootConversations(headers, rootLimit);
        const rootMeta = Number.isFinite(rootLimit) ? rootAll.slice(0, rootLimit) : rootAll;
        const projectMeta = includeProjects ? await collectProjectConversations(headers, workspaceId) : [];

        const projectIds = new Set(projectMeta.map(item => item.id));
        return {
            rootMeta: rootMeta.filter(item => !projectIds.has(item.id)),
            projectMeta
        };
    }

    async function getConversation(id, workspaceId) {
        const headers = buildHeaders(workspaceId);
        return requestJson(`/backend-api/conversation/${encodeURIComponent(id)}`, { headers }, `获取对话 ${id} 失败`);
    }

    function detectAllWorkspaceIds() {
        const ids = new Set(capturedWorkspaceIds);
        try {
            const node = document.getElementById('__NEXT_DATA__');
            const data = node ? JSON.parse(node.textContent || '{}') : {};
            const accounts = data?.props?.pageProps?.user?.accounts;
            if (accounts) Object.values(accounts).forEach(account => {
                const id = account?.account?.id || account?.id;
                if (id) ids.add(String(id));
            });
        } catch (_) {}
        return Array.from(ids);
    }

    function downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function buildExportReport(version, total, exported, failures) {
        return {
            exporter: 'ChatGPT Universal Exporter Enhanced Beta',
            version,
            generatedAt: new Date().toISOString(),
            totalRequested: total,
            exported,
            failed: failures.length,
            failures
        };
    }

    async function startExportProcess(mode, workspaceId, formats, limit = Infinity, includeProjects = true) {
        const button = document.getElementById('gpt-rescue-btn');
        if (!button) return;
        const icon = button.querySelector('.btn-icon');
        const label = button.querySelector('.btn-label');
        const originalLabel = label ? label.textContent : 'Export';

        const setState = (kind, text, percent) => {
            button.classList.remove('ue-loading', 'ue-error', 'ue-done');
            if (icon) {
                icon.innerHTML = kind === 'loading' ? ICON_SPINNER : kind === 'done' ? ICON_CHECK : kind === 'error' ? ICON_ERROR : ICON_DOWNLOAD;
            }
            if (kind === 'loading') button.classList.add('ue-loading');
            if (kind === 'done') button.classList.add('ue-done');
            if (kind === 'error') button.classList.add('ue-error');
            if (label) label.textContent = text;
            button.style.setProperty('--prog', `${Math.max(0, Math.min(100, percent || 0))}%`);
        };

        button.disabled = true;
        try {
            if (!await ensureAccessToken()) return;
            adaptiveDelay = BASE_DELAY;
            nextRequestAt = 0;
            setState('loading', '扫描中…', 3);

            const { rootMeta, projectMeta } = await collectConversationsMeta(workspaceId, includeProjects, limit);
            const exportList = rootMeta.concat(projectMeta);
            if (!exportList.length) throw new Error('未找到符合条件的会话。');

            const zip = new JSZip();
            const failures = [];
            let exported = 0;

            for (let index = 0; index < exportList.length; index++) {
                const meta = exportList[index];
                const percent = 5 + ((index + 1) / exportList.length) * 86;
                setState('loading', `${index + 1}/${exportList.length}`, percent);
                try {
                    const convData = await getConversation(meta.id, workspaceId);
                    if (!convData || !convData.mapping) throw new Error('对话数据缺少 mapping');
                    const folder = meta.source === 'project' && meta.projectTitle ? zip.folder(sanitizeFilename(meta.projectTitle)) : zip;
                    if (formats.json) folder.file(generateUniqueFilename(convData, 'json'), JSON.stringify(convData, null, 2));
                    if (formats.markdown) folder.file(generateUniqueFilename(convData, 'md'), convertToMarkdown(convData));
                    if (formats.html) folder.file(generateUniqueFilename(convData, 'html'), convertToHTML(convData));
                    exported++;
                } catch (error) {
                    console.warn('[ChatGPT Exporter] skipped conversation', meta.id, error);
                    failures.push({
                        id: meta.id,
                        title: meta.title || '',
                        source: meta.source,
                        project: meta.projectTitle || null,
                        reason: error && error.message ? error.message : String(error)
                    });
                }
            }

            const report = buildExportReport(VERSION, exportList.length, exported, failures);
            zip.file('_export-report.json', JSON.stringify(report, null, 2));
            zip.file('_export-report.txt', [
                `ChatGPT Exporter ${VERSION}`,
                `Requested: ${report.totalRequested}`,
                `Exported: ${report.exported}`,
                `Failed: ${report.failed}`,
                '',
                ...failures.map(item => `- ${item.id}${item.title ? ` | ${item.title}` : ''}: ${item.reason}`)
            ].join('\n'));

            setState('loading', '打包…', 94);
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const date = new Date().toISOString().slice(0, 10);
            const rootSuffix = Number.isFinite(limit) ? `recentRoot_${rootMeta.length}` : 'full';
            const projectSuffix = includeProjects ? 'with_projects' : 'no_projects';
            const filename = mode === 'team'
                ? `chatgpt_team_backup_${sanitizeFilename(workspaceId || 'workspace')}_${date}_${rootSuffix}_${projectSuffix}.zip`
                : `chatgpt_personal_backup_${date}_${rootSuffix}_${projectSuffix}.zip`;
            downloadFile(blob, filename);

            if (failures.length) {
                setState('done', `完成 ${exported}/${exportList.length}`, 100);
                alert(`导出完成：成功 ${exported} 条，失败 ${failures.length} 条。ZIP 内的 _export-report.txt / .json 记录了失败明细。`);
            } else {
                setState('done', '完成', 100);
                alert(`✅ 导出完成，共 ${exported} 条会话。`);
            }
        } catch (error) {
            console.error('[ChatGPT Exporter] export failed', error);
            setState('error', '错误', 0);
            alert(`导出失败：${error && error.message ? error.message : error}`);
        } finally {
            setTimeout(() => {
                button.disabled = false;
                setState('idle', originalLabel || 'Export', 0);
            }, 2800);
        }
    }

    function injectStyles() {
        if (document.getElementById('gpt-exporter-styles')) return;
        const style = document.createElement('style');
        style.id = 'gpt-exporter-styles';
        style.textContent = `
:root{--ue-primary:#10a37f;--ue-primary-dark:#0b745c;--ue-bg:#fff;--ue-text:#343541;--ue-muted:#6e6e80;--ue-border:#dedee5;--ue-overlay:rgba(20,20,22,.64)}
#gpt-rescue-btn{--prog:0%;position:fixed;right:24px;bottom:24px;z-index:99997;height:48px;min-width:68px;padding:0 16px;border:0;border-radius:24px;color:#fff;background:linear-gradient(to right,var(--ue-primary-dark) 0,var(--ue-primary-dark) var(--prog),var(--ue-primary) var(--prog),var(--ue-primary) 100%);box-shadow:0 5px 18px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;gap:7px;font:600 14px system-ui,-apple-system,sans-serif;cursor:pointer}#gpt-rescue-btn:disabled{opacity:.82;cursor:default}#gpt-rescue-btn .btn-icon{display:flex}#gpt-rescue-btn svg{width:20px;height:20px;fill:currentColor}#gpt-rescue-btn.ue-loading svg{animation:ue-spin .9s linear infinite}
#export-dialog-overlay{position:fixed;inset:0;z-index:99998;background:var(--ue-overlay);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px}.ue-dialog{width:440px;max-width:100%;max-height:92vh;overflow:auto;background:var(--ue-bg);color:var(--ue-text);border-radius:12px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.28);font-family:system-ui,-apple-system,sans-serif}.ue-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;margin-bottom:16px;border-bottom:1px solid var(--ue-border)}.ue-header h2{font-size:18px;margin:0}.ue-close{border:0;background:transparent;font-size:21px;color:inherit;cursor:pointer}.ue-tabs{display:flex;background:#f0f0f2;padding:4px;border-radius:8px;margin-bottom:16px}.ue-tab{flex:1;text-align:center;padding:8px;border-radius:6px;cursor:pointer;color:var(--ue-muted);font-size:14px}.ue-tab.active{background:#fff;color:var(--ue-text);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.08)}.ue-label{font-size:13px;color:var(--ue-muted);margin:12px 0 6px}.ue-range{display:flex;gap:15px;align-items:center;padding:10px;background:#f8f8f9;border:1px solid var(--ue-border);border-radius:8px}.ue-range label,.ue-check{font-size:13px;display:flex;align-items:center;gap:6px}.ue-range input[type=number]{width:70px;padding:5px 7px;border:1px solid #cfcfd5;border-radius:5px}.ue-hint{margin-top:6px;color:var(--ue-muted);font-size:12px;line-height:1.45}.ue-check{margin:11px 0}.ue-formats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ue-format{padding:10px;border:1px solid var(--ue-border);border-radius:8px;text-align:center;cursor:pointer;font-size:13px}.ue-format.active{border-color:var(--ue-primary);background:rgba(16,163,127,.06);color:var(--ue-primary);font-weight:600}.ue-format input{display:none}.ue-team{display:none;margin-top:12px}.ue-team.show{display:block}.ue-input{width:100%;padding:9px 10px;border:1px solid var(--ue-border);border-radius:7px;font-size:13px}.ue-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.ue-btn{border:0;border-radius:7px;padding:9px 16px;font-size:13px;cursor:pointer}.ue-btn.cancel{background:#f0f0f2;color:var(--ue-text)}.ue-btn.primary{background:var(--ue-primary);color:#fff}@keyframes ue-spin{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){:root{--ue-bg:#242424;--ue-text:#eee;--ue-muted:#aaa;--ue-border:#444}.ue-tabs,.ue-range,.ue-btn.cancel{background:#303030}.ue-tab.active{background:#3a3a3a}.ue-input{background:#202020;color:#eee;border-color:#555}}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function showExportDialog() {
        if (document.getElementById('export-dialog-overlay')) return;
        injectStyles();
        const ids = detectAllWorkspaceIds();
        const overlay = document.createElement('div');
        overlay.id = 'export-dialog-overlay';
        overlay.innerHTML = `<div class="ue-dialog"><div class="ue-header"><h2>导出对话记录 <small style="font-size:11px;color:var(--ue-muted)">${VERSION}</small></h2><button class="ue-close">✕</button></div><div class="ue-tabs"><div class="ue-tab active" data-mode="personal">👤 个人空间</div><div class="ue-tab" data-mode="team">🏢 团队空间</div></div><div class="ue-label">导出范围</div><div class="ue-range"><label><input type="radio" name="ue-range" value="all" checked> 全部</label><label><input type="radio" name="ue-range" value="recent"> 最近 <input id="ue-range-count" type="number" value="20" min="1" max="9999" disabled> 条</label></div><div class="ue-hint">“最近 N 条”只限制根目录；项目会话在勾选后仍按项目完整导出。</div><label class="ue-check"><input type="checkbox" id="ue-projects" checked> 导出 Projects / Gizmos 会话</label><div class="ue-label">导出格式</div><div class="ue-formats"><label class="ue-format active">JSON<input id="fmt-json" type="checkbox" checked></label><label class="ue-format active">Markdown<input id="fmt-md" type="checkbox" checked></label><label class="ue-format active">HTML<input id="fmt-html" type="checkbox" checked></label></div><div id="ue-team" class="ue-team"><input id="ue-team-id" class="ue-input" placeholder="Workspace ID (ws-...)"><div class="ue-hint">自动检测：${escapeHtml(ids.length ? ids.join(', ') : '暂未检测到')}</div></div><div class="ue-hint">大批量导出会自动降速，并在 429/服务器错误时退避重试。单条失败不会中断整个 ZIP。</div><div class="ue-footer"><button class="ue-btn cancel" id="ue-cancel">取消</button><button class="ue-btn primary" id="ue-start">开始导出</button></div></div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.ue-close').onclick = close;
        overlay.querySelector('#ue-cancel').onclick = close;
        overlay.onclick = event => { if (event.target === overlay) close(); };

        const count = overlay.querySelector('#ue-range-count');
        overlay.querySelectorAll('input[name="ue-range"]').forEach(radio => {
            radio.onchange = () => { count.disabled = radio.value !== 'recent' || !radio.checked; };
        });

        overlay.querySelectorAll('.ue-format').forEach(label => {
            label.onclick = event => {
                if (event.target.tagName === 'INPUT') return;
                const checkbox = label.querySelector('input');
                checkbox.checked = !checkbox.checked;
                label.classList.toggle('active', checkbox.checked);
                event.preventDefault();
            };
            label.querySelector('input').onchange = event => label.classList.toggle('active', event.target.checked);
        });

        const tabs = overlay.querySelectorAll('.ue-tab');
        const teamArea = overlay.querySelector('#ue-team');
        const teamInput = overlay.querySelector('#ue-team-id');
        let mode = 'personal';
        tabs.forEach(tab => tab.onclick = () => {
            tabs.forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            mode = tab.dataset.mode;
            teamArea.classList.toggle('show', mode === 'team');
            if (mode === 'team' && ids.length && !teamInput.value) teamInput.value = ids[0];
        });

        overlay.querySelector('#ue-start').onclick = async () => {
            const formats = {
                json: overlay.querySelector('#fmt-json').checked,
                markdown: overlay.querySelector('#fmt-md').checked,
                html: overlay.querySelector('#fmt-html').checked
            };
            if (!Object.values(formats).some(Boolean)) return alert('请至少选择一种导出格式。');

            let workspaceId = null;
            if (mode === 'team') {
                workspaceId = teamInput.value.trim();
                if (!workspaceId) return alert('请输入 Workspace ID。');
            }

            const range = overlay.querySelector('input[name="ue-range"]:checked').value;
            let limit = Infinity;
            if (range === 'recent') {
                limit = parseInt(count.value, 10);
                if (!Number.isFinite(limit) || limit <= 0) return alert('请输入有效的最近条数。');
            }
            const includeProjects = overlay.querySelector('#ue-projects').checked;
            close();
            await startExportProcess(mode, workspaceId, formats, limit, includeProjects);
        };
    }

    function ensureButton() {
        if (!document.body || document.getElementById('gpt-rescue-btn')) return;
        injectStyles();
        const button = document.createElement('button');
        button.id = 'gpt-rescue-btn';
        button.title = `ChatGPT Exporter Beta ${VERSION}`;
        button.innerHTML = `<span class="btn-icon">${ICON_DOWNLOAD}</span><span class="btn-label">Export</span>`;
        button.onclick = showExportDialog;
        document.body.appendChild(button);
    }

    const observer = new MutationObserver(ensureButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
    else ensureButton();
    setInterval(ensureButton, 5000);
})();
