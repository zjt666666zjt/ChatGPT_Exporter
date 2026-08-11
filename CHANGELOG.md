# Changelog

All notable maintenance changes to ChatGPT_Exporter are documented here.

## [Unreleased] — v1.1.0 Beta

### Beta v1.1.0-beta.3
- Fixed inline Markdown token handling so inline code, math notation, links, and images are not accidentally re-parsed as emphasis.
- Fixed escaped query-string handling in exported HTML links.

### Beta v1.1.0-beta.2
- Adaptive pacing and `Retry-After` aware exponential backoff for large exports and HTTP 429/5xx responses.
- More complete Project/Gizmo pagination, including `cursor` / `next_cursor`, `has_more` / `hasMore`, repeated-cursor protection, and a first-page fallback for endpoints that still require `cursor=0`.
- Improved root conversation selection for “recent N” across active and archived conversations.
- Per-conversation failure isolation: one failed conversation no longer aborts the whole ZIP; `_export-report.txt` and `_export-report.json` record failures.
- Improved HTML export rendering for headings, lists, blockquotes, tables, links, images, fenced code blocks, inline code, and preserved math notation.
- Improved visible-thread reconstruction by following `current_node` parent links when available.
- Added userscript update/support metadata and more Safari-friendly delayed Blob URL cleanup.
- Improved SPA button reinsertion with a MutationObserver.

### Scope
- This maintenance cycle changes the **Beta userscript only**. The stable `chatgpt-exporter.user.js` is intentionally unchanged.
- Issues #6, #7 and #8 were addressed by this Beta maintenance release.

## [2025-12-07]
- Added conversation selection and project grouping improvements.
