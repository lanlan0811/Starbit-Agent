# Development and acceptance status

Updated 2026-09-05. Acceptance still covers every M1–M4 requirement in the development plan.

## Current evidence

Type checking, lint, production build, 46 unit tests, and 2 Electron E2E tests pass locally. Tests cover permission precedence, junction boundaries, provider requests, deterministic tool ordering, compaction replay, bounded process execution, knowledge, and memory. The desktop test uses a controlled local model endpoint to exercise file tool execution, compaction cancellation, and session replay.

GitHub CI passed for the previous stage, `7907cf6`. The current changes still require their own remote CI and Release validation. A simulated endpoint does not prove real vendor availability or production cache hit rates.

## Outstanding acceptance

- M1: vendor video/frame fallback and screenshot feedback, live compatibility for all 11 models, file tree/references, paste attachments, diff UI, editable permission rules and plan patterns, authorization recovery, and IPC validation.
- M2: mainstream MCP integration, frozen tool consistency, packaged ConPTY/process-tree checks, WebGL, and high-throughput transport.
- M3: real-page browser operations, transfers, network boundaries and modal layering; the specified better-sqlite3/sqlite-vec backend (the current sql.js/JavaScript cosine implementation does not satisfy that technical selection); complex PDF/DOCX tests, summary quality, and concurrent user-memory writes.
- M4: configurable smaller summarization model, summary batching and budgets, restart-stable prefixes, prefix diff, TTL accounting, costs/subagent usage views, a 95% regression gate and real usage evidence, subagent authorization/cancellation E2E, packaged script runtimes, export/import, language switching, updates, local error reports, installers, and successful Release workflows.

Compaction snapshots support deterministic replay while the original event log remains append-only. Script execution has bounded output and runtime, and temporary directories are reclaimed. Python isolated import mode is not operating-system isolation. Outstanding requirements must not be described as accepted release capabilities.
