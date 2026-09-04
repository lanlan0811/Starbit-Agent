# MCP Guide

Starbit connects local programs and remote services through the Model Context Protocol (MCP), converting each discovered tool into a unified ToolRegistry entry. MCP expands capability but does not bypass workspace boundaries, security prompts, or permission modes.

## Supported capabilities

- stdio for a local MCP server communicating over standard input and output.
- Streamable HTTP for an HTTP(S) MCP endpoint.
- Compatibility SSE, including optional fallback from Streamable HTTP.
- Automatic protocol-version negotiation for current and legacy servers.
- Paginated tool discovery, `list_changed` refresh, and one reconnect attempt after a connection failure.
- Server-level and tool-level enablement.
- MCP annotations mapped to read-only/destructive risk and the common permission engine.

## Adding a server

Open MCP Servers, enter a unique name, choose a transport, and provide an executable command or HTTP(S) URL. The card reports `connecting`, `connected`, `disconnected`, or `error` and lists discovered tools.

A server ID is 1–64 characters, starts with an alphanumeric character, contains only letters, digits, dots, underscores, and hyphens, and must be unique. Remote URLs are limited to `http:` and `https:`; prefer HTTPS in production.

The basic UI covers argument-free executables and standard URLs. Advanced configurations with arguments, environment values, or headers use this shape internally; do not edit the settings database directly:

```json
[
  {
    "id": "filesystem",
    "name": "filesystem",
    "enabled": true,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "<WORKSPACE_PATH>"],
      "cwd": "<WORKSPACE_PATH>",
      "env": {}
    },
    "disabledTools": []
  }
]
```

Remote example:

```json
{
  "id": "research",
  "name": "research",
  "enabled": true,
  "transport": {
    "type": "streamable-http",
    "url": "https://mcp.example.test/service",
    "headers": { "Authorization": "Bearer <TOKEN>" },
    "fallbackToSse": true
  }
}
```

Replace placeholders with paths and credentials you control. Never commit a real value.

## Tool names and update timing

Discovered tools use:

```text
mcp__<sanitized-server-name>__<sanitized-tool-name>
```

Unsupported name characters are replaced. A tool title is for display; calls use the full namespaced name.

To preserve a stable model-cache prefix, a server or tool-list change does not rewrite an in-flight session request prefix. Saved settings take effect the next time a session tool set is assembled; an active Agent Loop retains its frozen definitions.

## Permission behavior

Tool annotations affect default classification. A tool is read-only only when it explicitly declares `readOnlyHint=true` and does not declare `destructiveHint=true`. A destructive tool receives the highest risk level; an unannotated tool is treated as side-effecting.

The permission semantic label is `MCP:<server-id>:<tool-name>`. You may store a narrow per-tool rule, but begin with a one-time approval. Text and structured data returned by MCP are marked untrusted and cannot promote instructions into system commands.

## Credentials and process environment

A stdio server inherits only a small set of basic launch variables such as PATH, temporary directories, and user directories, followed by explicitly configured values. Do not rely on every incidental variable in a development shell.

Header and environment names containing `authorization`, `api-key`, `password`, `secret`, or `token` are removed from ordinary configuration and encrypted separately with Electron `safeStorage`. Revoke an unused token at the service when removing a server.

## Enabling individual tools

After connection, clear the checkbox for tools the task does not need. The disabled list is stored per server. Apply least privilege, especially to file writes, command execution, messaging, cloud-data mutation, and paid calls.

## Connection and retry behavior

An initial timeout results in `error` with a visible reason. If a tool call fails because of the connection, Starbit closes the old connection, reconnects once, and retries the call. A second failure becomes a tool error; it is not retried indefinitely.

Streamable HTTP may fall back to SSE by default. Set `fallbackToSse=false` when the server explicitly does not support SSE so that endpoint mistakes remain visible.

## Troubleshooting

Check, in order:

1. A stdio command starts independently and has the correct arguments, working directory, and PATH.
2. The server writes protocol messages to stdout and diagnostics to stderr.
3. An HTTP URL is complete, its certificate is trusted, and the proxy allows it.
4. The token is current and the header name/value match server requirements.
5. The process implements MCP and completes initialization within 15 seconds.
6. The tool is not disabled and the configuration was not changed only after the current session started.

Errors may contain private paths or service details; redact them before sharing. See [Troubleshooting](troubleshooting.md) for additional checks.

## Removing a server

Remove closes the connection and deletes its server configuration. It does not revoke remote credentials, erase remote data, or delete files created by tools. Perform those actions separately and retain any required audit record.
