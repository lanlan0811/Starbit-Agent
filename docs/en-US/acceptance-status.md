# Development and acceptance status

Updated 2026-09-05. Acceptance still covers every M1–M4 requirement in the development plan.

## Current evidence

Type checking, lint, the production build, 77 unit tests, and 3 Electron E2E tests pass locally. Tests cover permission precedence and the configurable plan-doc pattern, junction boundaries, provider requests (including video frame-extraction fallback and video_url strategies), deterministic tool ordering, unified diff generation, chunked summarization budgets, cost estimation, ffmpeg frame extraction (injected runner), session archive parsing, the i18n dictionaries, the storage driver, and a real stdio MCP integration test.

The cache regression gate (§3.6) models "byte-identical prefix ⇒ cache hit": a 24-round long-prefix session reaches a cumulative hit rate of at least 95%, while a negative case (a timestamp leaking into the system prompt) collapses the hit rate, proving the gate is effective.

The three Electron E2E tests cover the workbench entries (terminal/browser/knowledge/memory), a local-endpoint-driven file tool loop with compaction cancellation and session replay, and parallel subagents (explore + general fan-out) with summary return and mid-run cancellation.

Storage runs on better-sqlite3 as the primary engine with a sqlite-vec KNN index; the driver layer falls back to sql.js automatically when the native module does not match the runtime ABI (capabilities unchanged except extension loading, where knowledge retrieval degrades to JavaScript cosine similarity).

Auto-update (electron-updater, production only), local error reports (userData/error-reports.log), session and full-data export/import, and the zh-CN/en-US interface switch are implemented with IPC surfaces and tests. GitHub CI (typecheck/lint/unit/e2e) and the Release workflow are configured; CI for the previous stage passed, and the current changes still require their own remote CI and Release validation.

## Outstanding acceptance

- M1: live compatibility for all 11 vendor models and real frame-extraction runs (ffmpeg depends on the user environment); configuration and simulated tests do not replace vendor verification.
- M2: a checklist of real mainstream MCP servers (filesystem, fetch, GitHub); the current integration test uses a purpose-built stdio server. Packaged ConPTY/process-tree checks and xterm WebGL.
- M3: real-page browser CDP operations, transfers, and login-state reuse E2E (only panel smoke tests exist); complex PDF/DOCX parsing and damaged-document recovery; sqlite-vec verification inside packaged artifacts.
- M4: real-server cumulative hit-rate evidence at ≥95% (the gate and usage views are ready), NSIS install/uninstall verification, a real auto-update feed (the publish URL in electron-builder.yml is a placeholder), and successful three-platform Release workflows.

Compaction snapshots support deterministic replay while the original event log remains append-only. Script execution has bounded output and runtime, and temporary directories are reclaimed. Python isolated import mode is not operating-system isolation. Outstanding requirements must not be described as accepted release capabilities.
