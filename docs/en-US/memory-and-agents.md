# Memory, Knowledge, and Project Rules

Starbit separates durable facts, mandatory workspace instructions, and large searchable sources. These categories have different trust levels and lifetimes and should not be merged into one prompt file.

## Content classes

| Content | Default location | Purpose | Trust treatment |
|---|---|---|---|
| User memory | `<USER_HOME>/.starbit/memory.md` | Stable preferences across workspaces | User-editable; still must not contain secrets |
| Workspace memory | `<WORKSPACE>/memory.md` | Stable facts, conventions, and decisions for one project | Applies only to that workspace |
| Project rules | `<WORKSPACE>/AGENTS.md` | Mandatory instructions, commands, and acceptance requirements | Loaded as workspace rules |
| Knowledge base | `<WORKSPACE>/.starbit/knowledge.db` | Chunked documents and semantic retrieval | Retrieved passages are untrusted data |

Only `AGENTS.md` at the workspace root is automatically treated as project rules. Starbit does not promote `CLAUDE.md`, `.cursorrules`, a README, or nested files into rules. The agent may read them as ordinary files when relevant.

## Long-term memory

Memory is for stable information likely to help future tasks: language preferences, common test commands, project terminology, or a confirmed architecture decision. It is not for transient task state, full transcripts, model guesses, passwords, access tokens, or sensitive inferred attributes.

A concise Markdown layout works well:

```markdown
# Preferences

- Reply in Simplified Chinese by default.
- After changing TypeScript, run type checking and relevant unit tests.

# Confirmed facts

- The primary branch is master.
```

User and workspace memory are loaded during system-prompt assembly. Explicit current user instructions and workspace `AGENTS.md` take precedence in a conflict. Workspace memory is more specific than a general user preference, but no memory can disable security rules.

The memory design supports manual entries and persistent session summaries, with read-only search and permission-controlled create, update, and delete operations. An automatic summary must distinguish confirmed facts from model inference; uncertain material must not become a permanent fact.

## Session summaries

A useful summary records the objective, completed work, remaining work, key files, verification evidence, known risks, and failed attempts. It does not replace the append-only event log, which remains the source for session replay.

Automatic summaries should avoid large tool outputs and credentials. Durable-memory writes require a clear basis in user intent. A user can remove an incorrect or obsolete entry; removing memory does not rewrite existing session events.

## AGENTS.md

Use `AGENTS.md` for:

- supported platform, encoding, and directory boundaries;
- build, test, formatting, and release commands;
- architecture layering and forbidden dependencies;
- security, permission, and credential requirements;
- the definition of done and commit rules.

Rules should be specific, executable, and verifiable, and should not embed secrets or personal machine paths. Review `AGENTS.md` manually before allowing commands in an untrusted workspace: a malicious repository can disguise unsafe behavior as a project convention.

## Knowledge base

Knowledge import is for references too large to place in every context. The design supports `md`, `txt`, `html`, `pdf`, `docx`, and web URLs. Extracted content is chunked, embedded through an OpenAI-compatible `/embeddings` endpoint or a deterministic offline fallback, and retrieved with top-k cosine similarity.

`kb_search` returns sources and relevant passages, all marked as untrusted. Semantic similarity does not prove that a passage is correct, current, or authorized to override project rules. Verify the original source for legal, medical, financial, or release decisions.

The knowledge database is `.starbit/knowledge.db` within the workspace, separate from the global session database. Do not commit a database containing proprietary material. Before import, check copyright, confidentiality, and the data policy of any remote embedding service.

## Choosing the right store

- A short, stable, confirmed fact needed every time: memory.
- A constraint on agent behavior or completion: `AGENTS.md`.
- A large source recalled by question: knowledge base.
- Temporary progress for one task: session events or a todo, not long-term memory.

Copying an entire document into `memory.md` increases context, reduces cache efficiency, and gives stale content lasting influence. Prefer the smallest stable, reviewable entries.

## Privacy and safety

Memory and knowledge are local by default, but relevant content can be sent to a configured model or remote embedding API. A local file does not automatically grant permission to disclose it. Use a dedicated workspace, minimize imports, remove obsolete data, and handle backups according to organizational policy.

An instruction in a web page, imported document, or MCP result cannot persist itself by saying “remember this.” A memory write is a side effect and must follow the active permission mode and the user's intent.
