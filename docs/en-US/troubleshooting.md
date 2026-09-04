# Troubleshooting

First record the Starbit version, Windows version, workspace, model, permission mode, and minimal reproduction. Remove API keys, Authorization headers, MCP environment values, private paths, and document content before sharing diagnostics.

## Development dependencies do not install

Check versions:

```powershell
node --version
pnpm --version
```

The project requires Node.js 22 and the pnpm version matching the lockfile:

```powershell
corepack enable
pnpm install --frozen-lockfile
```

Do not delete or hand-edit the lockfile to hide an install error. If the native `node-pty` binary does not match Electron's ABI, run:

```powershell
pnpm exec electron-builder install-app-deps
```

Then repeat the build or E2E test.

## The app is blank or exits immediately

In a source checkout, run `pnpm build` and verify that Main, Preload, and Renderer output exists under `out/`. Then use `pnpm start` or `pnpm test:e2e`. Diagnose the first terminal error, not later cascading errors.

If the error references Preload, verify `out/preload/index.mjs`. If it references `sql-wasm.wasm`, verify a complete `sql.js` installation and packaged resources. Never fetch a missing binary from an untrusted site.

## “API key is not configured”

In Settings → Model connection, select the active session model, enter the key, and save. Keys are stored per model ID; configuring one model does not configure every profile. A development launch may supply `STARBIT_API_KEY`, but never commit it.

If credential encryption is unavailable, run Starbit in a normal interactive Windows user session. A service, restricted session, or environment without credential facilities may not support Electron `safeStorage`.

## Model connection test fails

Check, in order:

1. API key, account credit, model entitlement, and region restrictions.
2. The base URL is an OpenAI-compatible API root, not a console page.
3. The endpoint actually provides the selected model ID.
4. Proxy, TLS inspection, firewall, and system time.
5. The selected API shape is Chat Completions or Responses as expected.

The connection test has a timeout and asks for a very short response. Provider errors may include a request ID but should not include the key; inspect them before sharing.

## A sent message receives no answer

Check the event flow and status bar:

- Waiting for confirmation means a permission prompt is open.
- If Running persists unexpectedly, press Escape, then inspect model and tool services.
- A model that does not support an attached image/video may return a 4xx error; remove it or choose a visual model.
- After an interrupted tool loop, do not assume files are unchanged. Inspect the working tree and relevant processes.

## A file tool reports an out-of-bounds path

A path must be inside the active workspace or an explicitly authorized root. Verify the workspace bound to the session and avoid `..`, network aliases, or links that indirectly escape it. If another directory is genuinely needed, create a narrowly scoped workspace or use the formal authorization path; do not disable boundary checks.

## Plan mode rejects a write

Plan mode permits directory creation and Markdown files matching the plan rule. By default, the filename contains `plan` or its Chinese equivalent and ends in `.md`. Source, configuration, and other documents require Accept Edits or Full Access. Repeated edits to the same matching plan should remain allowed; capture the complete normalized path when reporting a contrary result.

## The shell tool fails

Check Settings → Shell. PowerShell, cmd, and Git Bash require different launch arguments. For an executable path containing spaces, keep the executable in its own field rather than concatenating the command and all arguments.

The tool starts in the workspace, defaults to a 120-second timeout, and accepts at most 600 seconds. A nonzero exit code is an error. Output is decoded as UTF-8; legacy code-page programs may render incorrectly, so configure UTF-8 in that program or use a UTF-8-capable alternative.

## Terminal fails to open or exits immediately

Verify that the same executable starts in a normal Windows terminal. For development, rebuild Electron native modules:

```powershell
pnpm exec electron-builder install-app-deps
```

A packaged build must unpack `node-pty` for the current architecture. Security software can block ConPTY or child processes; create only a narrow exception for a trusted artifact. If a child remains after closing, record its PID and reproduction instead of running a broad recursive termination command.

## Tool output is truncated

The full result is stored at `.starbit/tool-output/<tool-call-id>.txt` in the active workspace; the conversation shows only its beginning, end, and path. Ask the agent to page the file or narrow the query. The file may be sensitive and may enter workspace backups, so remove it when no longer needed.

## A Skill is missing or cannot load

Verify `.starbit/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`, with exact filename and frontmatter beginning on the first line. `name` must be valid and `description` must be a nonempty single line. A workspace skill overrides a user skill with the same name. Start a new session/tool assembly after changing a skill index.

For a script failure, reproduce with the same interpreter and workspace. `.py` uses `STARBIT_PYTHON` or `python`; a nonzero script exit fails the tool. Do not solve a script defect by permanently widening shell permissions.

## MCP reports `error`

- stdio: verify command, arguments, working directory, and PATH; protocol belongs on stdout and diagnostics on stderr.
- HTTP/SSE: verify the HTTP(S) URL, certificate, and token.
- No tools: confirm the server completes initialization and implements tools/list.
- Missing tool: check per-tool disablement and whether configuration changed after this session started.
- Disconnected call: Starbit reconnects and retries only once; persistent failure requires a server fix.

See the [MCP guide](mcp.md).

## Cache hit rate is unexpectedly low

The first session turn, provider TTL expiration, and the first request after compaction can reasonably miss. For sustained avoidable misses, check model changes, tool/Skills/MCP inventory changes, prompt-template edits, and whether the endpoint returns a supported usage field. Never remove necessary security instructions or reuse another session's context merely to improve the metric.

## Local database is damaged or must be reset

Exit Starbit and back up the exact Electron user-data directory. Prefer renaming `starbit.db` to a dated backup before restarting to create a new database. Never recursively delete `%APPDATA%`, a user directory, or a workspace. Resetting loses sessions, settings, permission rules, usage, and audit, and encrypted keys cannot be recovered automatically from a damaged database.

The knowledge database is `.starbit/knowledge.db` in each workspace and is separate from the main database. Do not use a main-database reset as a way to remove workspace sources.

## E2E fails locally or in CI

E2E builds Electron and uses an isolated user-data directory. Ensure native modules are rebuilt and graphical dependencies are present; Linux CI uses xvfb. Run the gates separately to identify the first failure:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm test:e2e
```

Retain the first failing trace, screenshot, and app log after redaction. Do not commit `test-results/` or `playwright-report/`.

## Still blocked

Follow [CONTRIBUTING.en.md](../../CONTRIBUTING.en.md) for an ordinary bug report. For suspected credential exposure, workspace escape, permission bypass, arbitrary command execution, or prompt-injection boundary failure, stop the affected function, rotate relevant keys, and use the private process in [SECURITY.en.md](../../SECURITY.en.md).
