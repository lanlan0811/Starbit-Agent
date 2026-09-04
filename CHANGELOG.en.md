# Changelog

This project follows semantic versioning. Unreleased changes are recorded here.

## [Unreleased]

### Added

- Added a streaming OpenAI-compatible provider core for Chat Completions and Responses.
- Added reasoning-level parameters, multimodal content, function tools, and local-media request assembly.
- Added normalized cache usage for five provider layouts and stable-prefix SHA-256 diagnostics.
- Added nine provider unit tests and an Electron startup E2E test.

### Fixed

- Fixed the shared session type crossing process-layer boundaries.
- Fixed the missing syntax-highlighting dependency and obsolete ESLint 9 CLI arguments.
- Standardized CI and Release workflows on the repository's pnpm lockfile.
