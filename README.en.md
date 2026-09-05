# Starbit

Starbit is a Windows-first desktop AI agent workspace built with Electron, React, and TypeScript. It uses a custom agent loop architecture and connects to models through OpenAI-compatible APIs.

> Status: development build (0.1.0). All M1-M4 plan modules are implemented: the agent tool loop, three-tier permissions, terminal, browser, knowledge base (better-sqlite3 + sqlite-vec), layered memory, context compaction, subagents, multimodal input, and the cache regression gate. Vendor live tests, installer delivery, and real-world cache hit-rate evidence are still being collected; see the [acceptance status](docs/en-US/acceptance-status.md).

## Implemented

- Electron main process, isolated preload bridge, and React renderer
- Local SQLite sessions and an append-only event log (better-sqlite3 with an sql.js fallback)
- Three permission modes and dangerous-command rule evaluation
- Markdown, GFM, KaTeX, and syntax-highlighted code rendering
- Capability, reasoning-level, and cache-usage metadata for 11 built-in models
- Streaming Chat Completions and Responses provider support
- Image/video content conversion, local-media data URL encoding, ffmpeg frame-extraction fallback, and screenshots fed back to vision models
- Normalized cache usage, canonical stable-prefix serialization, and SHA-256 diagnostics
- Vitest unit tests (including a cache regression gate and MCP stdio integration tests) and Playwright Electron E2E
- Custom endpoints, context/output limits, and configurable reasoning mappings
- MCP, Claude Skills, interactive terminal, visual browser, knowledge, and layered memory
- Cancellable compaction (dedicated summary model + chunked budgets), Task subagents, TodoWrite plan synchronization, and Node/Python execution
- Workspace file tree, @file references, paste/drop attachments, and full diff display for Edit/Write
- Visual whitelist and plan-doc pattern management, per-model cost estimates, and prefix-diff diagnostics
- Session and full-data export/import, a zh-CN/en-US interface switch, auto-update, and local error reporting

## Development

Requirements: Node.js 22 and pnpm 11.25.0. Windows 10/11 is the primary target.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Quality checks:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

## Repository layout

```text
src/core/       Electron-independent domain types, permissions, and tool contracts
src/main/       Agent host, session persistence, provider, and IPC
src/preload/    contextBridge security boundary
src/renderer/   React desktop interface
docs/prompts/   Built-in Harness Agent system prompts
tests/e2e/      Electron critical-path tests
```

See the [architecture](docs/en-US/architecture.md), [model integration](docs/en-US/models.md), and [development guide](docs/en-US/development.md) for details.

## Security and privacy

Data is local by default. Never commit API keys, `.env` files, databases, or test output. Report vulnerabilities privately as described in [SECURITY.en.md](SECURITY.en.md).

## Contributing

Read [CONTRIBUTING.en.md](CONTRIBUTING.en.md) and [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md), then run every quality check above before submitting a change.

## License

[MIT](LICENSE)
