# Changelog

This project follows semantic versioning. Unreleased changes are recorded here.

## [Unreleased]

### Added

- Added a streaming OpenAI-compatible provider core for Chat Completions and Responses.
- Added reasoning-level parameters, multimodal content, function tools, and local-media request assembly.
- Added normalized cache usage for five provider layouts and stable-prefix SHA-256 diagnostics.
- Added a workspace file tree panel with previews and one-click @references.
- Added an @file mention popup (keyboard navigation) plus image/video paste and drop attachments in the input area.
- Added unified diff output for Edit/Write tool results with per-line coloring in the chat flow.
- Added in-settings editing of permission whitelist rules (allow/deny/ask) and a configurable plan-doc pattern applied to live sessions.
- Added per-model cost estimates (editable prices), separate subagent usage, and a prefix-diff diagnostic view.
- Added a dedicated compaction summary model plus chunked summarization budgets for long histories.
- Added ffmpeg frame-extraction fallback for models without native video_url support, and browser screenshots fed back to vision models.
- Added session export (Markdown/JSON archive), session import, and full-data backup/restore.
- Added a zh-CN/en-US interface language switch (zh-CN default, persisted locally).
- Added electron-updater auto-update and local error reporting (uncaught exceptions, renderer/child process crashes).
- Added a real stdio MCP integration test, a cache regression gate (blocks below 95% hit rate), and a parallel-subagent E2E scenario.

### Fixed

- Fixed the shared session type crossing process-layer boundaries.
- Fixed the missing syntax-highlighting dependency and obsolete ESLint 9 CLI arguments.
- Standardized CI and Release workflows on the repository's pnpm lockfile.
- Migrated storage to better-sqlite3 (knowledge base with a sqlite-vec KNN index) with a driver layer that falls back to sql.js when the native module does not match the runtime ABI, fixing native load crashes in development and packaging.

### Changed

- The storage engine now uses better-sqlite3 + sqlite-vec per the plan; sql.js is kept as the fallback implementation.
- `pnpm test:e2e` now runs `electron-builder install-app-deps` first so native modules match the Electron ABI.
