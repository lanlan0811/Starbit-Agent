# Starbit Security Policy

## Supported versions

| Version | Security updates |
|---|---|
| `master` and the latest release | Supported |
| Older pre-release builds | Not guaranteed; upgrade and reproduce first |

Starbit is still in early development. Security fixes normally land on `master` first and ship in the next release. Until code signing is enabled, release artifacts may show an unknown publisher. That warning is not an integrity check; obtain artifacts from the repository's official Releases page and review the release notes.

## Reporting a vulnerability privately

Prefer [GitHub private vulnerability reporting](https://github.com/lanlan0811/Starbit/security/advisories/new). If that entry point is unavailable, contact the maintainer through a private method listed on the repository owner's profile and share only the minimum necessary information. Do not open a public issue, discussion, or pull request, and do not place exploit code, credentials, or victim data in public logs.

A useful report includes:

- vulnerability class, affected surface, and worst-case impact;
- affected version, platform, permission mode, and required configuration;
- minimal reproducible steps or a proof of concept;
- whether a real API, MCP server, web page, or specific file is required;
- any temporary mitigation already applied;
- preferred credit and a proposed coordinated-disclosure timeline.

Maintainers will try to acknowledge reports within three business days and provide a follow-up cadence after impact is confirmed. A response may include a patch, dependency upgrade, rule update, credential-rotation advice, or temporary feature disablement. Keep the report private until maintainers confirm a fix is available; both parties should agree on a reasonable disclosure date.

## Security boundaries

Starbit uses layered controls, but they do not replace user judgment:

- The current workspace is the default file boundary. Paths outside it require explicit authorization.
- Three permission modes govern reads, writes, and execution. Dangerous commands are evaluated by local rules before mode policy.
- Permission prompts show the tool, complete command or target, and impact, and support one-time approval, session approval, or rejection.
- Session events, permission decisions, usage, and audit records are kept in local SQLite storage.
- Model API keys and MCP headers/environment values with sensitive names are encrypted through Electron `safeStorage`; log output is redacted.
- Web, document, knowledge-base, and MCP content is treated as untrusted data. It cannot replace system instructions or grant itself tool access.
- The Renderer uses context isolation with Node integration disabled; new external windows are not opened as trusted application content.

## Important limitations

- Full Access permits ordinary shell commands and file writes, but does not make them safe. Verify the command, workspace, and impact before approval.
- Windows code execution and skill scripts currently run with host-process privileges, not container-grade isolation. Do not execute untrusted scripts.
- An MCP server is a separate local program or remote service and may access its allowed environment, network, and files. Add trusted servers only, minimize privileges, and enable tools individually.
- Models and web pages can produce prompt injections, unsafe commands, or misleading content. `<untrusted-data>` boundaries reduce instruction confusion but are not a formal sandbox.
- Persistent browser login state expands the data exposed to browsing tasks. Enable it explicitly only when needed, then disable it.
- Local databases, `memory.md`, knowledge bases, and stored tool output may contain sensitive data. Anyone with disk access may still read them; operating-system disk encryption and account isolation are the user's responsibility.
- `safeStorage` protection depends on the operating system credential facility and current user session. Do not share an unlocked operating-system account.

## User precautions

1. Use a dedicated Starbit workspace instead of opening a home directory or drive root.
2. Prefer Plan or Accept Edits mode, switching to Full Access only when needed.
3. Verify parsed commands, paths, and impact in every permission prompt. Reject and ask the agent to explain anything unclear.
4. Use purpose-specific API keys with minimal privileges and quotas, and rotate them regularly.
5. Install MCP servers and skills only from trusted sources. Pin versions and review `SKILL.md`, scripts, launch commands, and environment values.
6. Redact logs, databases, screenshots, and exports before sharing. Never commit `.env`, `starbit.db`, `.starbit/`, or `memory.md`.
7. Keep Windows, Starbit, development Node.js, and dependencies current.

## Maintainer requirements

Security fixes should include regression coverage and threat-model updates where practical. A change to permissions, storage formats, credentials, external connections, or defaults must update both language guides and the changelog. Public advisories should avoid exposing still-actionable details and should state affected versions, mitigations, and the upgrade path.

## Non-security reports

Use public issues for ordinary crashes, bugs, and feature requests after removing secrets, private paths, and user data. See [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md) for community conduct concerns.
