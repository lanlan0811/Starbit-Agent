# Roadmap

Starbit is delivered in four independently testable milestones. This page is a public progress summary; detailed requirements come from the project development plan, current issues, and release notes. Status must be supported by code, tests, and artifacts rather than a checkbox alone.

## Status terms

| Status | Meaning |
|---|---|
| Delivered | On `master` with core test coverage |
| Integrating | Core implementation exists, with UI, boundary, or end-to-end verification remaining |
| Planned | Requirements and acceptance are defined but the feature is not yet stable |

## M1: Core loop and permissions

Status: delivered and under continued hardening.

Covered:

- Electron/Main/Preload/React/TypeScript layered application;
- local SQLite sessions, append-only events, and replay;
- streaming OpenAI-compatible Chat Completions and Responses providers;
- 11 built-in profiles, three reasoning levels, multimodal content parts, and normalized usage;
- cancellable Agent Loop, tool round trips, concurrent reads, and serialized mutations;
- `Read`, `Write`, `Edit`, `Mkdir`, `LS`, `Glob`, `Grep`, and `Bash`;
- workspace boundaries, three permission modes, session/permanent approvals, dangerous commands, and audit;
- Markdown, GFM, KaTeX, syntax highlighting, and permission prompts;
- modular `docs/prompts` and the stable-prefix fingerprint foundation.

Continuing work includes custom dangerous-rule loading, wider live-provider compatibility, provider-specific video fallback, and cache-diagnostic precision.

## M2: MCP, Skills, and terminal

Status: core delivered, with ongoing PTY/package verification.

Covered:

- MCP stdio, Streamable HTTP, SSE fallback, version negotiation, tool refresh, and reconnect;
- namespaced MCP tools, per-tool enablement, permission gates, encrypted sensitive configuration, and untrusted results;
- Claude Skills scanning, frontmatter, workspace overrides, progressive loading, slash activation, and script tools;
- `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `PreCompact`, `SessionStart`, and `SessionEnd` hooks;
- an interactive `utilityProcess + node-pty` terminal with xterm fit/search/serialize foundations;
- configurable PowerShell, cmd, and Git Bash execution.

Release gates include Windows ConPTY tree cleanup, Electron ABI rebuild, native-module loading from a package, and critical E2E coverage.

## M3: Browser, knowledge, and durable memory

Status: integrating.

Target scope:

- visible WebContentsView browser with tabs, address bar, manual control, and operation highlighting;
- CDP-based navigation, click, type, scroll, snapshot, screenshot, upload, and download tools;
- temporary browser partitions by default, with explicit opt-in for persistent login state;
- local file/web import, chunking, OpenAI-compatible or offline embeddings, cosine top-k, and `kb_search`;
- user and workspace `memory.md`, manual entries, session summaries, and memory tools;
- project rules from workspace-root `AGENTS.md` only;
- visual settings for models, permissions, shell, browser, knowledge, and memory.

Acceptance requires every external result to retain an `<untrusted-data>` boundary, browser upload/download to respect authorized paths, knowledge sources to remain traceable, and persistent login state to default off.

## M4: Context, subagents, and release

Status: planned.

Target scope:

- ContextManager token counting, 90% microcompaction, 97% hard-limit summaries, and manual `/compact`;
- cancellable pre-compaction warning, compaction events, and resumable structured summaries;
- low-hit warnings, prefix diff, TTL/compaction/avoidable miss classes, and a regression gate below 95%;
- `Task` subagents, Explore/general presets, isolated context, and separate usage;
- `TodoWrite` integrated with plan documents;
- a workspace-bound Node/Python execution sandbox;
- data export/import, Simplified Chinese default, and an internationalization framework;
- local error reporting, auto-update, and electron-builder/NSIS delivery;
- complete bilingual open-source documentation, changelogs, and CI/Release validation.

## Full acceptance

1. From a workspace, the agent can read, write, search, run shell, browse, and retrieve knowledge while following the permission matrix.
2. Sessions resume and every permission decision is auditable.
3. Long context compacts without losing the objective, progress, or critical files.
4. Models, reasoning, allow rules, shell, browser, knowledge, and memory are configurable and effective.
5. Global main-session cache hit rate is at least 95%, the accounting is explainable, and the prefix has no accidental drift.
6. Claude Skills and mainstream MCP servers work without bypassing permissions.
7. All 11 built-in models can be selected, and visual profiles handle images/video and browser screenshots.
8. Type checking, lint, unit tests, Electron E2E, build, packaging, and CI/Release all pass.

## Not a schedule commitment

This roadmap describes direction, not a guaranteed date, permanent provider-model availability, or production support for unsigned builds. A milestone is complete only when implementation, tests, documentation, and a runnable artifact all meet its acceptance criteria.
