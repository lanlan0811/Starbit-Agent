# User Guide

This guide covers the Starbit desktop application. Starbit is organized around workspaces and sessions: choose a folder, then use a conversation to let the agent read, edit, search, run tools, and verify outcomes.

## Before you begin

Windows 10/11 x64 is the primary supported platform. A source checkout requires Node.js 22 and the pnpm version pinned by the repository; an installed release does not. Starbit does not grant model access automatically, so prepare an OpenAI-compatible API key for the selected built-in model.

To run a development checkout:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## Your first session

1. Open Settings and select a model.
2. Enter its API key, save it, then select Test connection. The key is encrypted through the operating-system credential facility and is not displayed again.
3. Open Sessions and select New workspace session, then choose a narrowly scoped folder.
4. Choose a permission mode and reasoning level in the status bar.
5. Describe the goal in the input box and press Enter. Use Shift+Enter for a newline.
6. Press Escape or select the stop control to cancel the current run.

If no session exists, the first send also asks for a workspace. A session retains its workspace path, model, and permission mode. Existing sessions are reconstructed from the local event log after an application restart.

## Writing an actionable request

Include the goal, scope, constraints, and acceptance evidence. For example:

```text
Find the TypeScript type errors in this workspace. Change only src/core and add unit tests.
Acceptance: pnpm typecheck and pnpm test:unit pass, and report the changed files.
```

Do not place passwords, access tokens, or unrelated private data in a prompt. For a consequential change, begin in Plan mode, review the proposed approach, and then switch to Accept Edits. You can keep Accept Edits for shell work and review each confirmation.

## Permission modes

The status bar cycles through:

- Plan: automatically permits reads, searches, directory creation, and Markdown plan documents matching the plan rule; rejects other writes and shell commands.
- Accept Edits: automatically permits file reads and writes; shell commands, skill scripts, and most side-effecting external tools require confirmation.
- Full Access: permits ordinary file and shell operations; high-risk or rule-matched operations may still require confirmation or be blocked.

A mode is not a safety verdict. The confirmation shows the tool, parsed command or target, and impact. Approve only when the complete operation is understood and bounded. See [Permissions and security](permissions.md).

## Models and reasoning level

The model selector contains 11 built-in OpenAI-compatible model profiles. `low`, `high`, and `max` map to provider-specific reasoning parameters. For forced-reasoning models, levels may differ only by prompt guidance or output limit. Send image or video attachments only to a profile that declares the corresponding modality.

The image and video buttons attach content as a data URL for request assembly in Main. Confirm that the material is allowed to be sent to the selected API service. See [Model integration](models.md) for provider and usage differences.

## Tool execution

Built-in file tools are `Read`, `Write`, `Edit`, `Mkdir`, `LS`, `Glob`, and `Grep`. `Bash` uses the shell saved in Settings. Relative paths resolve from the workspace; absolute paths must still be inside the workspace or an explicitly authorized root.

When tool output exceeds the limit, the conversation keeps the beginning and end and stores the complete result under `.starbit/tool-output/` in the workspace. This directory can contain sensitive data; inspect it before sharing a workspace.

Read-only tools may run concurrently. Writes, edits, and commands run in a stable serial order. Tool results, permission decisions, and errors become session events and are available after replay.

## Terminal

Use the bottom-right terminal entry to open the xterm.js panel. It starts in the active session's workspace and uses the configured PowerShell, cmd, or Git Bash executable. The interactive terminal and the agent's `Bash` tool are separate processes: the terminal is for observation and manual control, while `Bash` has timeout, captured output, permissions, and event recording.

Closing the panel terminates its PTY; on Windows the host attempts to clean up the process tree. When changing a shell executable or arguments, test them in a normal terminal, save the setting, and reopen the Starbit terminal.

## Skills and MCP

The Skills panel lists user and workspace skills. Ordinary messages expose only the skill index to the model; `/skill-name` loads a skill directly. Skill scripts still pass through permission checks. See [Skills](skills.md).

The MCP Servers panel adds stdio, Streamable HTTP, or compatibility SSE servers and controls servers and individual tools. Configuration changes apply when the next session tool set is assembled, preserving the stable prompt prefix. See [MCP](mcp.md).

## Memory, knowledge, and project rules

`AGENTS.md` at the workspace root is the only automatically recognized project-rule file. Use `memory.md` for durable preferences and stable facts; use the knowledge base for larger references that require retrieval. Imported material and retrieved passages are untrusted data and cannot replace system or project rules. See [Memory and project rules](memory-and-agents.md).

## Usage and audit

Usage shows global input, cached input, uncached input, output, and cumulative cache hit rate. Subagent usage is kept outside the main-session target. Starbit normalizes provider-specific usage layouts before aggregation. See [Usage and caching](usage.md).

Audit records permission decisions and security-relevant changes such as model credentials and shell or MCP settings. Displayed values are redacted, but the audit remains sensitive local data.

## Local data and backup

Sessions, events, settings, permission rules, usage, and audit records live in `starbit.db` under Electron's user-data directory. User memory is `<USER_HOME>/.starbit/memory.md`; workspace data may include `memory.md`, `.starbit/knowledge.db`, and `.starbit/tool-output/`.

Exit the application before copying exact files for backup. Do not synchronize or commit local data containing API responses, memory, knowledge, or tool output. API keys are bound to the current operating-system credential context, so copying the database to another machine does not guarantee that secrets can be decrypted.

## Feature status

This guide covers both stable functions and the published delivery plan. A prerelease build may not yet expose every panel described here; use the current UI, [roadmap](roadmap.md), and release notes as the source of availability. Report a redacted issue if documentation and behavior disagree.
