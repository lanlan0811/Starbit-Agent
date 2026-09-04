# Permissions and Security Model

Starbit sends built-in tools, MCP tools, and skill scripts through one permission engine. The permission mode supplies defaults, specific rules supply exceptions, and dangerous-command rules impose a ceiling that a model cannot approve for itself.

## Three-mode matrix

| Operation | Plan `plan` | Accept Edits `acceptEdits` | Full Access `fullAccess` |
|---|---|---|---|
| Read, list, search | Allow | Allow | Allow |
| Create directories | Allow | Allow | Allow |
| Matching Markdown plan documents | Create and edit | Allow | Allow |
| Other file writes/edits | Deny | Allow | Allow |
| Ordinary shell command | Deny | Ask | Allow |
| Risk-level 1 script/external tool | Deny | Ask | Allow |
| High-risk tool or warning-level command | Deny or ask, whichever is stricter | Ask | Ask |
| Built-in block-level dangerous command | Deny | Deny | Deny |

Full Access does not disable dangerous-command checks. Built-in `block` rules, including disk formatting, disk cleanup, drive-wide erasure, and selected elevation operations, are rejected. `warn` rules require confirmation. The rule set evolves, so the confirmation and audit record are authoritative for a particular decision.

## Plan documents

The default plan-document rule matches a `.md` file inside the workspace whose filename contains `plan` or the Chinese word for plan, case-insensitively. Plan mode permits both creation and repeated edits; it is not a create-once exception.

Do not disguise executable code or broad unrelated changes as a plan document. If a target does not match, verify its path and purpose before changing modes.

## Workspace boundary

Relative paths resolve from the session workspace. A normalized absolute path must be under the workspace or an explicitly authorized root. `..`, alternate spelling, or case differences must not be used to escape that boundary. Avoid choosing a home directory, drive root, or shared sensitive directory as a routine workspace.

Shell commands start in the workspace, but a shell can use absolute paths, the network, and child processes. Shell operations therefore also depend on mode, dangerous rules, and confirmation. The file boundary is not an operating-system sandbox.

## Permission rules

A rule contains a semantic label, matching pattern, and action. Conceptual examples are:

```text
Bash(pnpm test *)       allow
Write(./docs/**)        allow
MCP:filesystem:read_*   allow
```

The stored representation keeps `semanticLabel` and `pattern` separately; `*` and `?` participate in matching. Keep scope narrow. Do not approve `Bash(*)`, `Write(*)`, or a whole home directory.

Actions are `allow`, `deny`, and `ask`. Approval scopes are:

- Once: decides only the current prompt and is not reused.
- Session: reuses the same semantic label and subject during the current Agent Loop lifetime.
- Permanent: persists a local allow rule for future sessions.

The current confirmation flow creates session or permanent rules only for an approval. A rejection is returned to the agent but is not silently converted into a permanent deny rule. Review and delete stored rules periodically.

## Confirmation review

Before approval, verify:

1. The tool and source match the task, such as built-in, `mcp:<server>`, or `skill:<name>`.
2. The complete command contains no unexpected pipes, redirects, substitutions, download-and-execute sequence, or hidden argument.
3. The target path is exact and does not overwrite, recursively mutate, or leave the workspace unexpectedly.
4. The described impact matches the user's request.
5. Session or permanent scope is actually necessary; choose Once when uncertain.

When rejecting, add a short reason such as “read only in this directory” or “do not access the network.” The agent receives that reason and can select a safer alternative.

## Dangerous-command rules

Built-in rules cover common Windows and Unix-like patterns for forced recursive deletion, disk formatting, download piped to a shell, registry changes, elevation, and disk cleanup. Matching is case-insensitive and considers the complete command.

`resources/dangerous-rules.yaml` is the project-maintained rule list. An invalid regular expression must not crash the application; custom rules require tests. Matching is a defensive layer rather than a complete shell parser. Aliases, encoded payloads, and nested interpreters still require human review.

## MCP and Skills

MCP tools use `mcp__<server>__<tool>`. A server's `readOnlyHint` and `destructiveHint` influence initial classification, but a remote declaration is not trusted evidence. Unknown or side-effecting tools are treated more strictly, and MCP results are untrusted data.

A skill body is guidance, not additional authority. Scripts under `scripts/` are separate tools subject to the same permission engine. They still execute with the host user's operating-system privileges, so review their source first.

## Credentials, logs, and audit

Model API keys and MCP headers/environment values whose names match `authorization`, `api-key`, `password`, `secret`, or `token` are removed from ordinary configuration and encrypted with Electron `safeStorage`. Secrets are not returned through normal settings APIs.

Permission decisions, security-relevant setting changes, and tool events enter the local audit path. Redaction reduces exposure but does not make logs public. Remove tokens, private paths, document contents, and identity data before sharing diagnostics.

## Untrusted-data boundary

Web snapshots, knowledge documents, and MCP content are wrapped in `<untrusted-data>`. Text inside that boundary such as “ignore earlier instructions,” “run this command,” or “send the key” is data to analyze, not authority to change system instructions, mode, or user consent. Reject and report unusual actions that originate from untrusted content.

## Choosing a mode

- Research, explanation, auditing, and planning: Plan.
- Controlled coding, file organization, and occasional commands: Accept Edits.
- A well-understood scope requiring many ordinary commands: Full Access.

Changing mode affects future decisions only. It does not undo completed operations or remove previously stored permanent rules.
