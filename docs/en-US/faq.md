# Frequently Asked Questions

## What is Starbit?

Starbit is a Windows-first desktop harness agent. It brings conversation, file tools, shell execution, MCP, Skills, terminal, browser, knowledge, memory, permissions, and audit into one workspace UI. A custom Agent Loop runs in the Main process and connects to models through OpenAI-compatible APIs.

## Is it a chat client or a coding tool?

Neither label is complete. Starbit supports work, study, research, and coding tasks. With the corresponding permission, a model can read a workspace, edit files, run commands, and call external tools. The Agent Loop attempts execution and verification rather than treating a plausible answer as completion.

## Which platforms are supported?

Windows 10/11 x64 is the primary support and acceptance platform. Terminal integration prioritizes PowerShell, cmd, and Git Bash. The architecture allows future cross-platform support, but macOS and Linux builds may have native dependency, PTY, path, signing, and behavior differences until formally supported.

## Is my data uploaded?

Sessions, settings, audit records, memory, and knowledge databases are local by default. Messages, attachments, selected context, and tool results sent to a model do reach your configured API service. Remote MCP, web import, and remote embeddings also disclose their corresponding data to third parties. Review those services' policies and send only what is necessary.

## How are API keys stored?

Model keys and recognized sensitive MCP headers/environment values are encrypted through Electron `safeStorage` before being stored in the local database. Keys are not displayed again and should not enter events or ordinary logs. Protection depends on the current Windows user credential context.

Developers may provide `STARBIT_API_KEY` to the launch process as a temporary default. Never put it in the repository, a script, or a terminal recording.

## Do model calls cost money?

Starbit does not resell model credit. Your configured provider account determines billing, quotas, and cache discounts. Usage shows token values returned by providers and normalized by Starbit. Until complete pricing configuration ships, a local estimate is not an invoice.

## Why is a workspace required?

The workspace is the default file boundary, shell working directory, and scope for workspace Skills, memory, and rules. A small dedicated folder limits accidental changes and disclosure. Do not use a home directory or drive root as a routine workspace.

## How do the three permission modes differ?

Plan is for read-only investigation and plan documents. Accept Edits permits file changes but normally asks for shell and side-effecting tools. Full Access permits ordinary shell operations, while high-risk actions still ask or are blocked. See [Permissions](permissions.md).

## Can “always allow” bypass dangerous rules?

No. Block-level dangerous rules take priority, and a permanent approval matches only its semantic label and target. Keep permanent rules narrow and review them regularly.

## Can a session resume after closing the app?

Yes. Messages, tool results, permission decisions, usage, compactions, and errors are append-only events in local SQLite. Selecting the session after restart replays them. An external operation interrupted with the process is not guaranteed to continue; inspect actual files and processes before retrying.

## Why is the tool called `Bash` when Windows runs PowerShell?

`Bash` is a stable semantic tool name for the model. The executable and arguments come from Settings. Windows defaults to PowerShell and can be changed to cmd or Git Bash. The interactive terminal uses the same shell choice but removes arguments intended only for a single non-interactive command.

## How is the terminal different from the shell tool?

The terminal is an interactive PTY for observation and manual control. `Bash` is a controlled Agent Loop tool with timeout, captured output, permission handling, and event recording. Temporary environment changes made manually in the terminal do not automatically transfer to tool processes.

## Can I use a local model?

Yes, if the service exposes an OpenAI-compatible endpoint, as compatible modes in Ollama or LM Studio do. Reasoning parameters, video, multimodal behavior, and usage fields differ across endpoints; unsupported reasoning parameters may be omitted or degraded. See [Model integration](models.md).

## Can I send images and videos?

The input supports image and video attachments, but the selected model profile must declare that modality. Some providers accept `video_url`, while others require extracted frames. Availability depends on model configuration and endpoint behavior. Confirm that the material may be shared with that provider.

## What is the difference between Skills and MCP?

A Skill is primarily a local instruction package and may include controlled scripts. An MCP server is a local process or remote service exposing protocol tools. Both enter the common tool and permission system. See [Skills](skills.md) and [MCP](mcp.md).

## How do I apply project rules automatically?

Create `AGENTS.md` at the workspace root. No other filename is automatically promoted to a rule. Project rules can define workflow and acceptance requirements but cannot override application security or an explicit current user instruction.

## Should a fact go in memory or the knowledge base?

Put short, stable, always-needed preferences and facts in `memory.md`; import large sources that need question-based retrieval into knowledge; use `AGENTS.md` for mandatory project constraints. See [Memory, knowledge, and project rules](memory-and-agents.md).

## Why is the cache hit rate low?

The first turn of a session, model changes, tool/Skills/MCP changes, context compaction, provider TTL expiry, and endpoints that omit cache details can all produce misses. Inspect the miss category and stable-prefix diagnostic first. See [Usage and caching](usage.md).

## Can Starbit run fully offline?

The application and local file functions can run offline, but conversation needs an accessible OpenAI-compatible model endpoint. A local model and offline embeddings avoid sending those contents to the public internet. Remote MCP, web access, and update checks still require a network.

## How do I report a problem?

Use a repository issue for an ordinary defect and include a redacted version, platform, reproduction, and log. Never disclose a vulnerability publicly; follow [SECURITY.en.md](../../SECURITY.en.md). Read [CONTRIBUTING.en.md](../../CONTRIBUTING.en.md) before submitting code.
