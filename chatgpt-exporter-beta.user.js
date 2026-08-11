// ==UserScript==
// @name         ChatGPT Universal Exporter Enhanced Beta
// @version      1.1.0-beta.1
// @description  Robust ZIP exporter with JSON/Markdown/HTML, safer intercept, full-thread export, and retries.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @license      MIT
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. 核心配置 Core Config
    // ==========================================

    // Conservatively pace backend requests. Large exports are especially prone to 429s.
    const BASE_DELAY = 650;
    const JITTER = 350;
    const PAGE_LIMIT = 100;
    const RETRY_BASE_DELAY = 2000;
    const MAX_RETRY_DELAY = 30000;
    let accessToken = null;
    let capturedWorkspaceIds = new Set();

    // 导出格式配置 Export formats
    let exportFormats = { json: true, markdown: true, html: true };

    // 按钮图标（SVG）
    const ICON_DOWNLOAD = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path>
        </svg>
    `;
    const ICON_SPINNER = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"></circle>
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"></path>
        </svg>
    `;
    const ICON_CHECK = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5z"></path>
        </svg>
    `;
    const ICON_ERROR = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2v-6z"></path>
        </svg>
    `;

    // ==========================================
    // 2. 网络拦截，捕获 Token / WorkspaceId
    // ==========================================

    (function interceptNetwork() {
        const rawFetch = window.fetch;

        function isSameOriginResource(res) {
            try {
                const url = typeof res === 'string' ? new URL(res, location.href) : new URL(res.url, location.href);
                return url.origin === location.origin;
            } catch (_) {
                return true;
            }
        }

        function getHeaderValueFromAny(hLike, name) {
            if (!hLike) return null;
            try {
                if (hLike instanceof Headers) return hLike.get(name) || hLike.get(name.toLowerCase());
                if (Array.isArray(hLike)) {
                    const found = hLike.find(
                        p => Array.isArray(p) && String(p[0]).toLowerCase() === name.toLowerCase()
                    );
                    return found ? found[1] : null;
                }
                if (typeof hLike === 'object') return hLike[name] || hLike[name.toLowerCase()] || null;
                if (typeof hLike === 'string' && name.toLowerCase() === 'authorization') return hLike;
            } catch (_) {}
            return null;
        }

        window.fetch = function (resource, options) {
            try {
                if (isSameOriginResource(resource)) {
                    const headerCandidates = [];
                    if (resource && typeof Request !== 'undefined' && resource instanceof Request) {
                        headerCandidates.push(resource.headers);
                    }
                    if (options && options.headers) {
                        headerCandidates.push(options.headers);
                    }
                    for (const hc of headerCandidates) {
                        tryCaptureToken(getHeaderValueFromAny(hc, 'Authorization'));
                        const wid = getHeaderValueFromAny(hc, 'ChatGPT-Account-Id');
                        if (wid && !capturedWorkspaceIds.has(wid)) {
                            capturedWorkspaceIds.add(wid);
                        }
                    }
                }
            } catch (_) {}
            return rawFetch.apply(this, arguments);
        };

        const rawOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function () {
            this.addEventListener('readystatechange', () => {
                if (this.readyState === 4) {
                    try {
                        const auth = this.getRequestHeader && this.getRequestHeader('Authorization');
                        tryCaptureToken(auth);
                        const id = this.getRequestHeader && this.getRequestHeader('ChatGPT-Account-Id');
                        if (id && !capturedWorkspaceIds.has(id)) {
                            capturedWorkspaceIds.add(id);
                        }
                    } catch (_) {}
                }
            });
            return rawOpen.apply(this, arguments);
        };
    })();

    function tryCaptureToken(headerLike) {
        let h = null;
        try {
            if (!headerLike) {
                h = null;
            } else if (typeof headerLike === 'string') {
                h = headerLike;
            } else if (headerLike instanceof Headers) {
                h = headerLike.get('Authorization') || headerLike.get('authorization');
            } else if (Array.isArray(headerLike)) {
                const found = headerLike.find(
                    e => Array.isArray(e) && String(e[0]).toLowerCase() === 'authorization'
                );
                h = found ? found[1] : null;
            } else if (typeof headerLike === 'object') {
                h = headerLike.Authorization || headerLike.authorization || null;
            }
        } catch (_) {}
        if (h && /^Bearer\s+(.+)/i.test(h)) {
            const token = h.replace(/^Bearer\s+/i, '');
            if (token && token.toLowerCase() !== 'dummy') {
                accessToken = token;
            }
        }
    }

    async function ensureAccessToken() {
        if (accessToken) return accessToken;
        try {
            const res = await fetch('/api/auth/session?unstable_client=true');
            const session = await res.json();
            if (session && session.accessToken) {
                accessToken = session.accessToken;
                return accessToken;
            }
        } catch (_) {}
        alert('无法获取 Access Token。请刷新页面或打开任意一个对话后再试。');
        return null;
    }

    // ==========================================
    // 3. 通用辅助函数 Helpers
    // ==========================================

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const jitter = () => BASE_DELAY + Math.random() * JITTER;
    const sanitizeFilename = name => name.replace(/[\/\\?%*:|"<>]/g, '-').trim();

    function getOaiDeviceId() {
        const cookieString = document.cookie;
        const match = cookieString.match(/oai-did=([^;]+)/);
        return match ? match[1] : null;
    }

    function getRetryAfterMs(res) {
        const raw = res && res.headers && res.headers.get('Retry-After');
        if (!raw) return 0;
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const dateMs = Date.parse(raw);
        return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
    }

    async function fetchWithRetry(input, init = {}, retries = 5) {
        let attempt = 0;
        while (true) {
            try {
                const res = await fetch(input, init);
                if (res.ok) return res;
                if (attempt < retries && (res.status === 429 || res.status >= 500)) {
                    const retryAfter = getRetryAfterMs(res);
                    const backoff = Math.min(
                        MAX_RETRY_DELAY,
                        RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER
                    );
                    await sleep(Math.max(retryAfter, backoff));
                    attempt++;
                    continue;
                }
                return res;
            } catch (err) {
                if (attempt < retries) {
                    const backoff = Math.min(
                        MAX_RETRY_DELAY,
                        RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER
                    );
                    await sleep(backoff);
                    attempt++;
                    continue;
                }
                throw err;
            }
        }
    }

    function buildHeaders(workspaceId) {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const did = getOaiDeviceId();
        if (did) headers['oai-device-id'] = did;
        if (workspaceId) headers['ChatGPT-Account-Id'] = workspaceId;
        return headers;
    }

    function generateUniqueFilename(convData, extension = 'json') {
        const convId = String(convData.conversation_id || '').trim();
        const idPart = convId || Math.random().toString(36).slice(2, 10);
        const ts = convData.create_time ? new Date(convData.create_time * 1000) : new Date();
        const tsPart = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(
            ts.getDate()
        ).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(
            ts.getMinutes()
        ).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
        let baseName = convData.title;
        if (!baseName || baseName.trim().toLowerCase() === 'new chat') {
            baseName = 'Untitled Conversation';
        }
        return `${sanitizeFilename(baseName)}_${idPart}_${tsPart}.${extension}`;
    }

    function downloadFile(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    // ==========================================
    // 4. 会话解析 & 转换为 Markdown / HTML
    // ==========================================

    function parseConversation(convData) {
        const mapping = convData.mapping || {};
        const msgs = [];
        for (const key in mapping) {
            const node = mapping[key];
            const message = node && node.message;
            if (!message || !message.content || !message.content.parts) continue;
            const role = message.author && message.author.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const content = message.content.parts.join('\n');
            if (!content || !content.trim()) continue;
            msgs.push({
                role,
                content,
                createTime: message.create_time,
                model: (message.metadata && message.metadata.model_slug) || ''
            });
        }
        msgs.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
        return {
            title: convData.title || 'Untitled Conversation',
            createTime: convData.create_time,
            updateTime: convData.update_time,
            conversationId: convData.conversation_id,
            model: convData.default_model_slug || '',
            messages: msgs
        };
    }

    function convertToMarkdown(convData) {
        const parsed = parseConversation(convData);
        let md = '';
        md += `# ${parsed.title}\n\n`;
        md += `**Conversation ID:** \`${parsed.conversationId || 'Unknown'}\`\n\n`;
        if (parsed.model) md += `**Model:** ${parsed.model}\n\n`;
        if (parsed.createTime)
            md += `**Created:** ${new Date(parsed.createTime * 1000).toLocaleString()}\n\n`;
        if (parsed.updateTime)
            md += `**Last Updated:** ${new Date(parsed.updateTime * 1000).toLocaleString()}\n\n`;
        md += `---\n\n`;
        parsed.messages.forEach((msg, index) => {
            const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
            const timestamp = msg.createTime
                ? ` (${new Date(msg.createTime * 1000).toLocaleString()})`
                : '';
            md += `## ${roleLabel}${timestamp}\n\n`;
            md += `${msg.content}\n\n`;
            if (index < parsed.messages.length - 1) md += `---\n\n`;
        });
        return md;
    }

    function convertToHTML(convData) {
        const parsed = parseConversation(convData);
        const escapeHtml = text => {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        };
        const renderContent = content => {
            let html = escapeHtml(content);
            const blocks = [];
            html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                const idx = blocks.length;
                const blockHtml = `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
                blocks.push(blockHtml);
                return `[[[CODE_BLOCK_${idx}]]]`;
            });
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(
                /\[([^\]]+)\]\(([^)]+)\)/g,
                '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
            );
            html = html.replace(/\n/g, '<br>');
            html = html.replace(/\[\[\[CODE_BLOCK_(\d+)]]]/g, (_, i) => blocks[Number(i)]);
            return html;
        };

        const convIdText = parsed.conversationId ? escapeHtml(parsed.conversationId) : 'Unknown';
        const createdText = parsed.createTime
            ? new Date(parsed.createTime * 1000).toLocaleString()
            : '';

        let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(parsed.title)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #10a37f 0%, #0d8a6c 100%); color: #fff; padding: 30px; }
        .header h1 { font-size: 24px; margin-bottom: 10px; }
        .metadata { font-size: 13px; opacity: 0.9; }
        .conversation { padding: 20px; }
        .message { margin-bottom: 25px; padding: 20px; border-radius: 8px; }
        .message.user { background: #eef2ff; border-left: 4px solid #4f46e5; }
        .message.assistant { background: #f9fafb; border-left: 4px solid #10a37f; }
        .message-header { display: flex; align-items: center; margin-bottom: 12px; font-weight: 600; font-size: 15px; }
        .role-icon { margin-right: 8px; }
        .timestamp { font-size: 12px; color: #888; margin-left: auto; font-weight: normal; }
        pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 6px; overflow-x: auto; margin: 10px 0; }
        code { font-family: "Consolas", monospace; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${escapeHtml(parsed.title)}</h1>
            <div class="metadata">ID: ${convIdText}${
            createdText ? ' | ' + escapeHtml(createdText) : ''
        }</div>
        </div>
        <div class="conversation">`;

        parsed.messages.forEach(msg => {
            const roleClass = msg.role;
            const roleIcon = msg.role === 'user' ? '👤' : '🤖';
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            const timestamp = msg.createTime
                ? new Date(msg.createTime * 1000).toLocaleString()
                : '';
            html += `
            <div class="message ${roleClass}">
                <div class="message-header">
                    <span class="role-icon">${roleIcon}</span>${roleLabel}${
                timestamp ? `<span class="timestamp">${escapeHtml(timestamp)}</span>` : ''
            }
                </div>
                <div class="message-content">${renderContent(msg.content)}</div>
            </div>`;
        });

        html += `</div></div></body></html>`;
        return html;
    }

    // ==========================================
    // 5. API 辅助：项目列表 / 会话 meta / 会话详情
    // ==========================================

    async function getProjects(workspaceId) {
        const r = await fetchWithRetry('/backend-api/gizmos/snorlax/sidebar', {
            headers: buildHeaders(workspaceId)
        });
        if (!r.ok) return [];
        const data = await r.json();
        const projects = [];
        data.items?.forEach(item => {
            if (item?.gizmo?.id && item?.gizmo?.display?.name) {
                projects.push({ id: item.gizmo.id, title: item.gizmo.display.name });
            }
        });
        return projects;
    }

    /**
     * 收集会话 meta 信息（ID + 更新时间 + source）
     * 返回 { rootMeta, projectMeta }
     *
     * rootLimit：只作用于“根目录”，达到 N 条就提前停止继续扫描根目录历史；
     * 项目部分无数量限制（如果 includeProjects）。
     */
    async function collectConversationsMeta(workspaceId, includeProjects, rootLimit = Infinity) {
        const headers = buildHeaders(workspaceId);
        const metaMap = new Map();

        const upsert = meta => {
            const existing = metaMap.get(meta.id);
            if (!existing) {
                metaMap.set(meta.id, meta);
            } else if (meta.source === 'project' && existing.source !== 'project') {
                metaMap.set(meta.id, { ...existing, ...meta });
            }
        };

        const rootLimitEff =
            Number.isFinite(rootLimit) && rootLimit > 0 ? rootLimit : Infinity;
        let rootCount = 0;
        let stopRootScan = false;

        // 1) 根目录会话：Active + Archived
        for (const is_archived of [false, true]) {
            if (stopRootScan) break;

            let offset = 0;
            let has_more = true;

            while (has_more) {
                if (rootCount >= rootLimitEff && rootLimitEff !== Infinity) {
                    stopRootScan = true;
                    break;
                }

                const url = `/backend-api/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated${
                    is_archived ? '&is_archived=true' : ''
                }`;
                const r = await fetchWithRetry(url, { headers });
                if (!r.ok)
                    throw new Error(`列举项目外对话列表失败 (${r.status})`);

                const j = await r.json();
                const items = j.items || [];
                if (!items.length) {
                    has_more = false;
                    break;
                }

                for (const it of items) {
                    if (!it || !it.id) continue;
                    const updated =
                        it.update_time ||
                        it.updated_time ||
                        it.updated_at ||
                        it.update_at ||
                        it.create_time ||
                        0;
                    upsert({
                        id: it.id,
                        updatedAt: updated || 0,
                        source: 'root',
                        isArchived: !!is_archived
                    });
                    rootCount++;
                    if (rootCount >= rootLimitEff && rootLimitEff !== Infinity) {
                        stopRootScan = true;
                        break;
                    }
                }

                if (stopRootScan) break;

                has_more = items.length === PAGE_LIMIT;
                offset += items.length;
                await sleep(jitter());
            }
        }

        // 2) 项目内会话：从第一页开始，兼容 cursor / next_cursor 两种响应字段。
        if (includeProjects) {
            const projects = await getProjects(workspaceId);
            for (const project of projects) {
                let cursor = null;
                const seenCursors = new Set();

                while (true) {
                    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
                    const url = `/backend-api/gizmos/${project.id}/conversations${query}`;
                    const r = await fetchWithRetry(url, { headers });
                    if (!r.ok)
                        throw new Error(`列举项目对话列表失败 (${r.status})`);
                    const j = await r.json();
                    const items = j.items || [];

                    for (const it of items) {
                        if (!it || !it.id) continue;
                        const updated =
                            it.update_time ||
                            it.updated_time ||
                            it.updated_at ||
                            it.update_at ||
                            it.create_time ||
                            0;
                        upsert({
                            id: it.id,
                            updatedAt: updated || 0,
                            source: 'project',
                            projectId: project.id,
                            projectTitle: project.title
                        });
                    }

                    const nextCursor = j.next_cursor ?? j.cursor ?? null;
                    const hasMore = j.has_more ?? j.hasMore ?? Boolean(nextCursor);
                    if (!hasMore || !nextCursor || seenCursors.has(String(nextCursor))) break;
                    seenCursors.add(String(nextCursor));
                    cursor = String(nextCursor);
                    await sleep(jitter());
                }
            }
        }

        const all = Array.from(metaMap.values());
        const rootMeta = all.filter(m => m.source === 'root');
        const projectMeta = all.filter(m => m.source === 'project');
        return { rootMeta, projectMeta };
    }

    async function getConversation(id, workspaceId) {
        const headers = buildHeaders(workspaceId);
        const r = await fetchWithRetry(`/backend-api/conversation/${id}`, { headers });
        if (r.status === 404 || r.status === 403) return null;
        if (!r.ok) return null;
        let j;
        try {
            j = await r.json();
        } catch (e) {
            return null;
        }
        if (!j || !j.mapping) return null;
        return j;
    }

    function detectAllWorkspaceIds() {
        const foundIds = new Set(capturedWorkspaceIds);
        try {
            const data = JSON.parse(
                document.getElementById('__NEXT_DATA__')?.textContent || '{}'
            );
            const accounts = data?.props?.pageProps?.user?.accounts;
            if (accounts) {
                Object.values(accounts).forEach(acc => {
                    if (acc?.account?.id) foundIds.add(acc.account.id);
                });
            }
        } catch (e) {}
        return Array.from(foundIds);
    }

    // ==========================================
    // 6. 导出流程：按钮内嵌进度条 + 状态文本
    // ==========================================

    async function startExportProcess(mode, workspaceId, formats, limit = Infinity, includeProjects = true) {
        const btn = document.getElementById('gpt-rescue-btn');
        if (!btn) return;

        const iconSpan = btn.querySelector('.btn-icon');
        const labelSpan = btn.querySelector('.btn-label');

        const originalLabelText = labelSpan ? labelSpan.textContent : '';
        const resetProgress = () => btn.style.setProperty('--prog', '0%');

        const setIcon = type => {
            if (!iconSpan) return;
            btn.classList.remove('ue-loading', 'ue-error', 'ue-done');
            switch (type) {
                case 'spinner':
                    iconSpan.innerHTML = ICON_SPINNER;
                    btn.classList.add('ue-loading');
                    break;
                case 'check':
                    iconSpan.innerHTML = ICON_CHECK;
                    btn.classList.add('ue-done');
                    break;
                case 'error':
                    iconSpan.innerHTML = ICON_ERROR;
                    btn.classList.add('ue-error');
                    break;
                default:
                    iconSpan.innerHTML = ICON_DOWNLOAD;
                    break;
            }
        };

        const setLabel = text => {
            if (labelSpan && typeof text === 'string') {
                labelSpan.textContent = text;
            }
        };

        const setProgress = percent => {
            if (percent == null || isNaN(percent)) return;
            const clamped = Math.max(0, Math.min(100, percent));
            btn.style.setProperty('--prog', clamped + '%');
        };

        btn.disabled = true;

        try {
            const token = await ensureAccessToken();
            if (!token) {
                btn.disabled = false;
                setIcon('error');
                setLabel('失败');
                setProgress(0);
                return;
            }

            setIcon('spinner');
            setLabel('扫描中...');
            setProgress(5);

            const { rootMeta, projectMeta } = await collectConversationsMeta(
                workspaceId,
                includeProjects,
                limit
            );

            if (!rootMeta.length && !projectMeta.length) {
                alert('未找到任何会话记录。');
                setIcon('error');
                setLabel('无会话');
                setProgress(0);
                return;
            }

            rootMeta.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            projectMeta.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            const selectedRoot =
                limit === Infinity ? rootMeta : rootMeta.slice(0, limit);
            const exportMetaList = selectedRoot.concat(projectMeta);
            const total = exportMetaList.length;

            if (!total) {
                alert('未找到符合条件的会话。');
                setIcon('error');
                setLabel('空结果');
                setProgress(0);
                return;
            }

            setProgress(0);
            setLabel(`0/${total}`);

            const zip = new JSZip();
            let processed = 0;

            for (const meta of exportMetaList) {
                processed++;
                const percent = (processed / total) * 100;
                setProgress(percent);
                setLabel(`${processed}/${total}`);

                const convData = await getConversation(meta.id, workspaceId);
                if (!convData) {
                    await sleep(jitter());
                    continue;
                }

                const folder =
                    meta.source === 'project' && meta.projectTitle
                        ? zip.folder(sanitizeFilename(meta.projectTitle))
                        : zip;

                if (formats.json)
                    folder.file(
                        generateUniqueFilename(convData, 'json'),
                        JSON.stringify(convData, null, 2)
                    );
                if (formats.markdown)
                    folder.file(
                        generateUniqueFilename(convData, 'md'),
                        convertToMarkdown(convData)
                    );
                if (formats.html)
                    folder.file(
                        generateUniqueFilename(convData, 'html'),
                        convertToHTML(convData)
                    );

                await sleep(jitter());
            }

            setIcon('spinner');
            setLabel('打包...');
            setProgress(95);

            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE'
            });
            const date = new Date().toISOString().slice(0, 10);
            const suffix =
                limit === Infinity ? 'full' : `recentRoot_${selectedRoot.length}`;
            const projFlag = includeProjects ? 'with_projects' : 'no_projects';
            const filename =
                mode === 'team'
                    ? `chatgpt_team_backup_${workspaceId || 'workspace'}_${date}_${suffix}_${projFlag}.zip`
                    : `chatgpt_personal_backup_${date}_${suffix}_${projFlag}.zip`;

            downloadFile(blob, filename);

            setIcon('check');
            setLabel('完成');
            setProgress(100);
            alert('✅ 导出完成！');
        } catch (e) {
            console.error('导出错误', e);
            setIcon('error');
            setLabel('错误');
            setProgress(0);
            alert(`导出失败: ${e.message}`);
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                setIcon('download');
                setLabel(originalLabelText || 'Export');
                resetProgress();
            }, 2500);
        }
    }

    // ==========================================
    // 7. UI：样式注入 + 弹窗 + 按钮
    // ==========================================

    function injectStyles() {
        const styleId = 'gpt-exporter-styles';
        if (document.getElementById(styleId)) return;

        const css = `
            :root {
                --ue-primary: #10a37f;
                --ue-primary-hover: #0d8a6c;
                --ue-primary-dark: #0b745c;
                --ue-bg: #ffffff;
                --ue-text: #343541;
                --ue-text-secondary: #6e6e80;
                --ue-border: #ececf1;
                --ue-shadow: 0 10px 30px rgba(0,0,0,0.2);
                --ue-radius: 12px;
                --ue-overlay-bg: rgba(52, 53, 65, 0.7);
            }
            
            #gpt-rescue-btn {
                --prog: 0%;
                position: fixed; bottom: 24px; right: 24px; z-index: 99997;
                height: 50px; min-width: 64px; padding: 0 16px;
                border-radius: 25px; border: none;
                cursor: pointer;
                display: inline-flex; align-items: center; justify-content: center;
                gap: 6px;
                font-weight: 600; font-size: 14px; white-space: nowrap;
                color: #ffffff;
                background-image: linear-gradient(
                    to right,
                    var(--ue-primary-dark) 0%,
                    var(--ue-primary-dark) var(--prog),
                    var(--ue-primary) var(--prog),
                    var(--ue-primary) 100%
                );
                background-color: var(--ue-primary);
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: transform 0.2s ease, box-shadow 0.2s ease, background-image 0.2s ease;
            }
            #gpt-rescue-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: 0 8px 16px rgba(0,0,0,0.25);
            }
            #gpt-rescue-btn:disabled {
                opacity: 0.85;
                cursor: default;
            }
            #gpt-rescue-btn .btn-icon {
                display: inline-flex;
            }
            #gpt-rescue-btn .btn-icon svg {
                width: 20px;
                height: 20px;
                fill: currentColor;
            }
            #gpt-rescue-btn .btn-label {
                font-variant-numeric: tabular-nums;
            }
            #gpt-rescue-btn.ue-loading .btn-icon svg {
                animation: ue-spin 0.9s linear infinite;
                transform-origin: 50% 50%;
            }

            #export-dialog-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: var(--ue-overlay-bg); backdrop-filter: blur(4px); z-index: 99998;
                display: flex; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.3s ease;
            }
            #export-dialog-overlay.visible { opacity: 1; }
            .ue-dialog {
                background: var(--ue-bg); width: 420px; max-width: 90%;
                border-radius: var(--ue-radius); box-shadow: var(--ue-shadow); padding: 24px;
                font-family: system-ui, -apple-system, sans-serif; color: var(--ue-text);
                transform: translateY(20px); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #export-dialog-overlay.visible .ue-dialog { transform: translateY(0); }

            .ue-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--ue-border); padding-bottom: 12px; }
            .ue-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
            .ue-close { cursor: pointer; opacity: 0.5; transition: 0.2s; background:none; border:none; font-size: 20px; color: var(--ue-text);}
            .ue-close:hover { opacity: 1; }

            .ue-tabs { display: flex; background: #f0f0f1; padding: 4px; border-radius: 8px; margin-bottom: 20px; }
            .ue-tab { flex: 1; text-align: center; padding: 8px; font-size: 14px; cursor: pointer; border-radius: 6px; transition: 0.2s; color: var(--ue-text-secondary); }
            .ue-tab.active { background: #fff; color: var(--ue-text); font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }

            .ue-formats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
            .ue-format-item { display: flex; flex-direction: column; align-items: center; padding: 12px; border: 1px solid var(--ue-border); border-radius: 8px; cursor: pointer; transition: 0.2s; }
            .ue-format-item:hover { background: #f7f7f8; }
            .ue-format-item.active { border-color: var(--ue-primary); background: rgba(16, 163, 127, 0.05); color: var(--ue-primary); font-weight: bold; }
            .ue-format-item input { display: none; }
            .ue-icon { font-size: 24px; margin-bottom: 4px; }

            .ue-range-wrapper { margin-bottom: 8px; }
            .ue-range-selector { display: flex; align-items: center; gap: 15px; background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid var(--ue-border); }
            .ue-radio-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; color: var(--ue-text); user-select: none; }
            .ue-range-input { width: 60px; padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px; outline: none; transition: 0.2s; }
            .ue-range-input:disabled { background: #eef; color: #999; border-color: #eee; cursor: not-allowed; }
            .ue-range-input:focus { border-color: var(--ue-primary); box-shadow: 0 0 0 2px rgba(16,163,127,0.1); }

            .ue-checkbox-line { margin-bottom: 10px; font-size: 13px; color:#555; display:flex; align-items:center; gap:6px; }
            .ue-checkbox-line input { cursor:pointer; }

            .ue-input-group { margin-top: 12px; display: none; }
            .ue-input-group.show { display: block; animation: fadeIn 0.3s; }
            .ue-input { width: 100%; padding: 10px 12px; border: 1px solid var(--ue-border); border-radius: 6px; font-size: 14px; outline: none; box-sizing: border-box; }
            .ue-input:focus { border-color: var(--ue-primary); }
            .ue-hint { font-size: 12px; color: var(--ue-text-secondary); margin-top: 4px; }

            .ue-footer { margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; }
            .ue-btn { padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: 0.2s; }
            .ue-btn-cancel { background: transparent; color: var(--ue-text-secondary); }
            .ue-btn-cancel:hover { background: #f0f0f1; color: var(--ue-text); }
            .ue-btn-primary { background: var(--ue-primary); color: white; }
            .ue-btn-primary:hover { background: var(--ue-primary-hover); }

            @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes ue-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function showExportDialog() {
        if (document.getElementById('export-dialog-overlay')) return;
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'export-dialog-overlay';

        const ids = detectAllWorkspaceIds();
        const detectedText = ids.length ? ids.join(', ') : '暂未检测到';

        overlay.innerHTML = `
            <div class="ue-dialog">
                <div class="ue-header">
                    <h2>导出对话记录</h2>
                    <button class="ue-close">✕</button>
                </div>
                
                <div class="ue-tabs">
                    <div class="ue-tab active" data-mode="personal">👤 个人空间</div>
                    <div class="ue-tab" data-mode="team">🏢 团队空间</div>
                </div>
                
                <div style="font-size:13px; color:#666; margin-bottom:6px;">导出范围:</div>
                <div class="ue-range-wrapper">
                    <div class="ue-range-selector">
                        <label class="ue-radio-label">
                            <input type="radio" name="ue-range" value="all" checked> 全部
                        </label>
                        <label class="ue-radio-label">
                            <input type="radio" name="ue-range" value="recent">
                            最近 <input type="number" id="ue-range-count" value="20" min="1" max="9999" disabled class="ue-range-input"> 条
                        </label>
                    </div>
                    <div class="ue-hint">
                        提示：“最近 N 条” 仅限制<b>根目录</b>对话；若勾选项目，项目文件将<b>全部导出</b>。
                    </div>
                </div>

                <div class="ue-checkbox-line">
                    <input type="checkbox" id="ue-include-projects" checked>
                    <label for="ue-include-projects">是否导出项目文件</label>
                </div>

                <div style="font-size:13px; color:#666; margin-bottom:8px;">导出格式:</div>
                <div class="ue-formats">
                    <div class="ue-format-item active" data-fmt="json">
                        <div class="ue-icon">{ }</div><span>JSON</span>
                        <input type="checkbox" id="fmt-json" checked>
                    </div>
                    <div class="ue-format-item active" data-fmt="markdown">
                        <div class="ue-icon">⬇️</div><span>Markdown</span>
                        <input type="checkbox" id="fmt-md" checked>
                    </div>
                    <div class="ue-format-item active" data-fmt="html">
                        <div class="ue-icon">🌐</div><span>HTML</span>
                        <input type="checkbox" id="fmt-html" checked>
                    </div>
                </div>

                <div id="team-area" class="ue-input-group">
                    <input type="text" id="team-id" class="ue-input" placeholder="输入 Team Workspace ID (ws-...)">
                    <div class="ue-hint">自动检测: ${detectedText}</div>
                </div>
                
                <div class="ue-footer">
                    <button id="dlg-cancel" class="ue-btn ue-btn-cancel">取消</button>
                    <button id="dlg-start" class="ue-btn ue-btn-primary">开始导出</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('.ue-close').onclick = close;
        overlay.querySelector('#dlg-cancel').onclick = close;
        overlay.onclick = e => {
            if (e.target === overlay) close();
        };

        const rangeRadios = overlay.querySelectorAll('input[name="ue-range"]');
        const rangeCountInput = overlay.querySelector('#ue-range-count');
        rangeRadios.forEach(radio => {
            radio.onchange = () => {
                if (radio.value === 'recent') {
                    rangeCountInput.disabled = false;
                    rangeCountInput.focus();
                } else {
                    rangeCountInput.disabled = true;
                }
            };
        });

        const fmtItems = overlay.querySelectorAll('.ue-format-item');
        fmtItems.forEach(item => {
            item.onclick = () => {
                const cb = item.querySelector('input');
                cb.checked = !cb.checked;
                item.classList.toggle('active', cb.checked);
            };
        });

        const tabs = overlay.querySelectorAll('.ue-tab');
        const teamArea = overlay.querySelector('#team-area');
        let currentMode = 'personal';
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentMode = tab.dataset.mode;
                if (currentMode === 'team') {
                    teamArea.classList.add('show');
                    const teamInput = overlay.querySelector('#team-id');
                    if (ids.length > 0 && !teamInput.value) teamInput.value = ids[0];
                } else {
                    teamArea.classList.remove('show');
                }
            };
        });

        overlay.querySelector('#dlg-start').onclick = async () => {
            const formats = {
                json: overlay.querySelector('#fmt-json').checked,
                markdown: overlay.querySelector('#fmt-md').checked,
                html: overlay.querySelector('#fmt-html').checked
            };
            if (!Object.values(formats).includes(true)) {
                alert('请至少选择一种导出格式！');
                return;
            }

            let workspaceId = null;
            if (currentMode === 'team') {
                workspaceId = overlay.querySelector('#team-id').value.trim();
                if (!workspaceId) {
                    alert('请输入 Workspace ID');
                    return;
                }
            }

            const rangeValue = overlay.querySelector(
                'input[name="ue-range"]:checked'
            ).value;
            let limit = Infinity;
            if (rangeValue === 'recent') {
                const val = parseInt(rangeCountInput.value, 10);
                if (!val || val <= 0) {
                    alert('请输入有效的数量');
                    return;
                }
                limit = val;
            }

            const includeProjects = overlay.querySelector('#ue-include-projects').checked;

            close();
            exportFormats.mode = currentMode;
            exportFormats.workspaceId = workspaceId;
            await startExportProcess(currentMode, workspaceId, formats, limit, includeProjects);
        };
    }

    function addBtn() {
        if (document.getElementById('gpt-rescue-btn')) return;
        injectStyles();
        const b = document.createElement('button');
        b.id = 'gpt-rescue-btn';
        b.title = 'Export Conversations';
        b.style.setProperty('--prog', '0%');
        b.innerHTML = `
            <span class="btn-icon">${ICON_DOWNLOAD}</span>
            <span class="btn-label">Export</span>
        `;
        b.onclick = showExportDialog;
        document.body.appendChild(b);
    }

    setTimeout(addBtn, 2000);
})();
