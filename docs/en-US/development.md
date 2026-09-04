# Development guide

## Environment

Use Node.js 22 and pnpm 11.25.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Pre-commit checks

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

`test:e2e` builds the app, launches Electron with an isolated temporary user-data directory, and removes that directory after the test.

Put shared types in `src/core`. Main and renderer must communicate only through the IPC contract exposed by preload. Built-in system prompts belong in `docs/prompts`. UI work follows the Starbit design system: system fonts, a light office tone, 4 px base spacing, and Lucide SVG icons.
