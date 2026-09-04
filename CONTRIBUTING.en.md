# Contributing to Starbit

Thank you for helping improve Starbit. This guide covers bug reports, feature proposals, documentation, tests, and code contributions. Please also read the [Code of Conduct](CODE_OF_CONDUCT.en.md) and [Security Policy](SECURITY.en.md).

## Project direction and boundaries

Starbit is a Windows-first Electron desktop harness agent. Its core constraints are:

- The Main process hosts the agent. The Renderer must not receive direct Node.js access; cross-process calls go through the typed Preload IPC boundary.
- Model integrations use only OpenAI-compatible Chat Completions or Responses APIs.
- Sessions are append-only event streams. Security decisions, tool results, and usage must remain recoverable and auditable.
- Every tool goes through ToolRegistry and PermissionService. No tool may bypass the workspace boundary, three permission modes, or dangerous-command evaluation.
- Web pages, documents, knowledge-base passages, and MCP results are untrusted data and must retain their `<untrusted-data>` boundary.
- API keys and MCP credentials must never enter source, logs, events, or ordinary settings in plaintext. Use Electron `safeStorage`.
- Built-in system prompts live only in `docs/prompts/`; do not duplicate them as drift-prone strings in application code.
- UI work follows the Starbit design system. Use SVG/Lucide icons, not emoji as icons.
- Do not hard-code user paths, shells, ports, credentials, locales, or model capabilities. Express differences through configuration, platform APIs, or domain models.

The public delivery sequence is documented in [docs/en-US/roadmap.md](docs/en-US/roadmap.md). Discuss substantial changes in an issue first, including goals, acceptance evidence, and milestone impact. Maintainers may also provide an internal development plan; that plan takes precedence over incidental implementation preferences.

## Reporting a bug

Search existing issues and reproduce against the latest release or current code before opening a report. Include at least:

- Starbit version or commit, Windows version, and architecture;
- Node.js and pnpm versions for development-environment problems;
- selected model/API shape, permission mode, and affected feature;
- minimal reproduction steps, expected result, and actual result;
- redacted logs, error text, or screenshots;
- whether it reproduces consistently and the last known working version.

Never paste API keys, Authorization headers, MCP environment values, private documents, full user-directory paths, or an undisclosed vulnerability into an issue. Security reports use the [private process](SECURITY.en.md).

## Proposing a feature

Start with the user problem, not only an implementation. Describe the use case, impact of not solving it, relationship to the permission and data models, verifiable acceptance criteria, and compatibility risks. Provider, MCP, browser, security, persistence-format, and stable-prompt-prefix changes should include migration and regression-test plans.

## Development environment

Use Windows 10/11, Node.js 22, and the pnpm version pinned by the repository. Other platforms may be used for pure TypeScript work, but Windows is the primary desktop acceptance environment.

```powershell
git clone https://github.com/lanlan0811/Starbit.git
Set-Location Starbit
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Run the standard quality gates:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

For packaging or `node-pty` changes, also run:

```powershell
pnpm exec electron-builder install-app-deps
pnpm dist:win
```

See the [development guide](docs/en-US/development.md) and [architecture](docs/en-US/architecture.md) for more detail.

## Change workflow

1. Create a focused branch from `master`.
2. Add or update tests for behavioral changes. A bug fix should preferably start with a test that reproduces the defect.
3. Keep commits focused and describe outcomes. Update the Chinese and English documentation together.
4. Update the relevant guides and `CHANGELOG.md`/`CHANGELOG.en.md` when a change affects users, configuration, data formats, security boundaries, or public APIs.
5. Run every quality gate and manually inspect desktop layout, permission prompts, and critical interactions.
6. Open a pull request explaining context, approach, test evidence, risks, rollback, and UI screenshots when applicable.

Do not commit `node_modules`, `out`, `release`, test reports, local databases, `.env` files, design caches, or `.starbit` runtime data. Respect `.gitignore`; explain any necessary ignore-rule change and its data implications in the pull request.

## Code and test expectations

- Keep TypeScript strict; do not use unexplained `any` casts to bypass contracts.
- Put shared domain types in `src/core`, platform code in `src/main`, and expose only Preload APIs to the Renderer.
- File operations must normalize absolute paths and verify the workspace or an authorized root. Test Windows paths and UTF-8 data.
- Every write, execution, and external-data entry point must account for cancellation, timeout, output limits, visible errors, and auditing.
- Read-only tools may run concurrently. Writes, edits, and executions run in a stable serial order to avoid races.
- Provider requests must preserve a deterministic system/tools/skills prefix. Do not insert timestamps or frequently changing state into that stable prefix.
- Co-locate unit tests as `*.test.ts`; put Electron end-to-end tests in `tests/e2e` and use an isolated user-data directory.
- Tests must not depend on a paid API, personal credentials, or an uncontrolled public service.

## Documentation and prompts

Keep corresponding pages in `docs/zh-CN` and `docs/en-US` aligned. Format commands, configuration keys, and paths as code, and use placeholders instead of real secrets.

When changing `docs/prompts`, explain the effect on agent behavior, security, and the cache prefix; run PromptAssembler and Agent Loop tests; and keep per-turn dynamic values out of the stable template sections. Starbit recognizes only `AGENTS.md` at the workspace root as project rules. Do not add implicit alternative rule filenames.

## Review criteria

Maintainers review alignment with requirements, user-verifiable outcomes, security boundaries, failure behavior, Windows behavior, data migrations, accessibility and design-system fit, test coverage, documentation, and continued CI/Release viability. Address review feedback before merge. A merge does not guarantee immediate release.

## License

By contributing, you confirm that you have the right to provide the contribution under the repository's [MIT License](LICENSE), and agree that it may be distributed under that license.
