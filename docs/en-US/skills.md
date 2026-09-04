# Skills Guide

Starbit supports the Claude Skills directory format with `SKILL.md` as the entry point. A skill is progressively disclosed operating guidance and may include scripts and references. It is not a plugin permission and cannot bypass ToolRegistry or PermissionService.

## Discovery locations

When assembling a session tool set, Starbit scans:

```text
User:      <USER_HOME>/.starbit/skills/<skill>/SKILL.md
User:      <USER_HOME>/.claude/skills/<skill>/SKILL.md
Workspace: <WORKSPACE>/.starbit/skills/<skill>/SKILL.md
Workspace: <WORKSPACE>/.claude/skills/<skill>/SKILL.md
```

Names are matched case-insensitively, and a workspace skill overrides a user skill with the same name. One malformed skill is skipped without blocking the rest. The Skills panel shows name, description, scope, and discovered script count.

## Minimal structure

```text
example-skill/
├─ SKILL.md
├─ scripts/
│  └─ inspect.ps1
└─ references/
   └─ format.md
```

`SKILL.md` begins with simple YAML frontmatter:

```markdown
---
name: example-skill
description: Use when a task requires checking the example project format.
---

# Example skill

Read the workspace configuration first, then run the read-only check. Explain impact before editing and follow the active permission mode.
```

`name` is 1–64 characters, begins with an alphanumeric character, and contains only letters, digits, dots, underscores, and hyphens. `description` is required and should say when to use the skill and what it does. The current parser accepts simple single-line scalar values; avoid multiline YAML, anchors, and complex objects.

## Progressive disclosure

At session assembly, the system prompt receives only a name-and-description index sorted by name. This avoids loading every body into the stable prefix. When needed, the model calls the read-only `LoadSkill` tool. The body is appended to current context rather than inserted into old history.

Start a user message with `/example-skill` to load that skill directly. The command name ends at the first whitespace; following text remains the task. An unknown skill returns a clear error.

## Script tools

Files under `scripts/` are discovered recursively and registered as:

```text
skill__<skill-name>__<script-file-name>
```

Common extensions use these defaults:

| Extension | Default execution |
|---|---|
| `.js`, `.mjs` | Current Node/Electron executable environment |
| `.py` | `STARBIT_PYTHON` or `python` |
| `.ps1` | Windows PowerShell in non-interactive mode |
| `.cmd`, `.bat` | `cmd.exe` |
| Other | Launch as an executable |

A script runs in the session workspace and receives an explicit argument array, not a concatenated command. Output is captured; a nonzero exit code is a tool error. Scripts are side-effecting risk-level 1 tools: Plan denies them and Accept Edits asks for confirmation.

## Authoring principles

- Give one skill a focused problem with repeatable, verifiable steps.
- Use references relative to the skill root and state when to read `references/` or run scripts.
- Do not copy API keys, machine-specific paths, usernames, or private organization data.
- Never instruct the agent to ignore system, security, user, or workspace rules.
- Identify prerequisites and impact for writes, network access, paid APIs, and deletion.
- Account for Windows paths, UTF-8, directories with spaces, and failed exit codes.
- Load large references only when needed; keep `SKILL.md` as the essential procedure and navigation.
- Give scripts deterministic output, timeout-friendly behavior, and testable exit codes.

## Installing third-party skills

Review repository provenance, license, recent changes, `SKILL.md`, and every script. Pin an audited version. Test it as a workspace skill before promoting it to user scope. Commands and external material in third-party guidance are not automatically trusted.

New sessions rescan changed skills. An active session retains its frozen skill index to avoid tool-definition churn and model-cache invalidation.

## Troubleshooting

If a skill is absent, verify its directory level, exact `SKILL.md` filename, frontmatter at the beginning of the file, valid `name`, and nonempty single-line `description`. For a script failure, reproduce with the same workspace and interpreter and check permissions, dependencies, encoding, and exit code without bypassing the confirmation system.

Before contributing a built-in workflow, also read the [system prompt guide](prompts-guide.md) and repository contribution guide.
