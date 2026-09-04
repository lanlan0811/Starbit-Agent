# Starbit

Starbit is a Windows-first desktop AI agent workspace built with Electron, React, and TypeScript. It uses a custom agent loop architecture and connects to models through OpenAI-compatible APIs.

> Status: development build (0.1.0). The agent loop, custom models, terminal, browser, knowledge, and memory are integrated. Context compaction and collaboration tools are undergoing full acceptance. Release delivery, cache targets, and vendor multimodal compatibility remain incomplete; see the [acceptance status](docs/en-US/acceptance-status.md).

## Implemented

- Electron main process, isolated preload bridge, and React renderer
- Local SQLite sessions and an append-only event log
- Three permission modes and dangerous-command rule evaluation
- Markdown, GFM, KaTeX, and syntax-highlighted code rendering
- Capability, reasoning-level, and cache-usage metadata for 11 built-in models
- Streaming Chat Completions and Responses provider support
- Image/video content conversion and local-media data URL encoding
- Normalized cache usage, canonical stable-prefix serialization, and SHA-256 diagnostics
- Vitest unit tests and a Playwright Electron startup test
- Custom endpoints, context/output limits, and configurable reasoning mappings
- MCP, Claude Skills, interactive terminal, visual browser, knowledge, and layered memory
- Cancellable compaction, Task subagents, TodoWrite plan synchronization, and Node/Python execution

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
