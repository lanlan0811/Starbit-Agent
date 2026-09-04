# Architecture

Starbit uses Electron's three-layer structure. The main process hosts the agent, preload exposes a typed IPC surface, and the renderer owns the React UI. Electron-independent domain contracts live in `src/core`.

## Data flow

1. The renderer calls session, model, and workspace operations through `window.starbit`.
2. Main-process IPC handlers delegate to session or host services.
3. Sessions are stored as append-only events in local SQLite and replayed to restore UI state.
4. The provider converts unified messages into Chat Completions or Responses requests and normalizes SSE into text, reasoning, tool, usage, and completion events.

## Provider boundary

`src/main/provider` owns endpoint and request assembly, reasoning parameters, sampling allowlists, multimodal content conversion, incremental SSE decoding, tool deltas, usage normalization, and deterministic fingerprints for the system/tools/skills stable prefix.

API keys enter only as request header inputs. They are not part of static model configuration and must never be persisted in event logs. The future agent loop integration will translate provider output into append-only session events.

## Dependency direction

`renderer -> preload contract -> main -> core`. Shared types belong in `core`; the renderer must not import main-process implementation modules.
