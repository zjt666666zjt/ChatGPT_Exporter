# 更新记录 / Changelog

[中文](#中文) · [English](#english)

---

# 中文

这里记录 ChatGPT_Exporter 的主要维护更新。

## [Unreleased] — v1.1.0 Beta

### Beta v1.1.0-beta.3
- 修复行内 Markdown token 处理，避免行内代码、数学记号、链接和图片被再次误解析为强调格式。
- 修复导出 HTML 链接中转义后的查询参数处理问题。

### Beta v1.1.0-beta.2
- 为大批量导出增加自适应请求节流，并支持识别 `Retry-After`；对 HTTP 429 / 5xx 使用指数退避重试。
- 增强 Projects / Gizmos 分页完整性，兼容 `cursor` / `next_cursor`、`has_more` / `hasMore`，加入重复 cursor 防护，并为仍要求首个 `cursor=0` 的接口提供回退。
- 改进“最近 N 条”根目录会话选择逻辑，使 Active 与 Archived 会话一起参与排序。
- 增加单条会话失败隔离；单个失败不再中止整个 ZIP，并在 `_export-report.txt` 与 `_export-report.json` 中记录失败信息。
- 改进 HTML 导出，对标题、列表、引用、表格、链接、图片、代码块、行内代码和数学记号提供更完整的显示支持。
- 当存在 `current_node` 时沿父节点还原当前可见对话线程。
- 增加 Userscript 更新 / 支持元数据，并优化 Safari 下载后的 Blob URL 延迟释放。
- 使用 MutationObserver 改进 ChatGPT SPA 页面中的导出按钮重新插入。

### 维护范围
- 本轮维护 **只修改 Beta userscript**。
- 稳定版 `chatgpt-exporter.user.js` 保持不变。
- Issues #6、#7、#8 已由本轮 Beta 维护处理。

## [2025-12-07]
- 增加对话选择功能与项目分组相关改进。

---

# English

All notable maintenance changes to ChatGPT_Exporter are documented here.

## [Unreleased] — v1.1.0 Beta

### Beta v1.1.0-beta.3
- Fixed inline Markdown token handling so inline code, math notation, links, and images are not accidentally re-parsed as emphasis.
- Fixed escaped query-string handling in exported HTML links.

### Beta v1.1.0-beta.2
- Added adaptive request pacing for large exports, `Retry-After` support, and exponential backoff for HTTP 429 / 5xx responses.
- Improved Projects / Gizmos pagination completeness, including `cursor` / `next_cursor`, `has_more` / `hasMore`, repeated-cursor protection, and a first-page fallback for endpoints that still require `cursor=0`.
- Improved root conversation selection for “recent N” across Active and Archived conversations.
- Added per-conversation failure isolation: one failed conversation no longer aborts the whole ZIP; `_export-report.txt` and `_export-report.json` record failure details.
- Improved HTML export rendering for headings, lists, blockquotes, tables, links, images, fenced code blocks, inline code, and preserved math notation.
- Improved visible-thread reconstruction by following parent links from `current_node` when available.
- Added userscript update / support metadata and more Safari-friendly delayed Blob URL cleanup.
- Improved export-button reinsertion in the ChatGPT SPA with a MutationObserver.

### Scope
- This maintenance cycle changes the **Beta userscript only**.
- The stable `chatgpt-exporter.user.js` remains unchanged.
- Issues #6, #7 and #8 were addressed by this Beta maintenance release.

## [2025-12-07]
- Added conversation selection and project grouping improvements.
