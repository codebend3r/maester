# Claude context for weirwood

## Hard rules

- Do not commit, push, branch, merge, or open a PR unless told to.

## What this is

A self-hosted video library and direct-play web player. See README.md for how playback, scanning and thumbnails work.

## Structure

An Nx 23 monorepo over bun workspaces (`workspaces: ["apps/*", "libs/*"]`). Projects have no `project.json`: Nx infers targets from each `package.json`'s scripts, whitelisted by its `nx.includedScripts`. A new script that should be a target goes in that list too.

| Project          | Path          | What                                                                          |
| ---------------- | ------------- | ----------------------------------------------------------------------------- |
| `server`         | `apps/server` | NestJS 12 on Fastify, SQLite (better-sqlite3), ffprobe/ffmpeg, vitest         |
| `web`            | `apps/web`    | React 19, Vite 8, TanStack Query, zustand, SCSS modules, bun test + happy-dom |
| `@weirwood/core` | `libs/core`   | Shared by every client: API types and guards, API client, direct-play check   |

`libs/core` must stay platform-agnostic: no DOM, no Node APIs, not even `URLSearchParams` (use `toQueryString`). Its tsconfig has `lib: ["ES2023"]` and no `types` so a slip fails the typecheck.

Run tasks through Nx: `bunx nx run server:test`, `bunx nx run-many -t test typecheck`, `bun run verify`.

## Conventions

- Type aliases, never interfaces (except `.d.ts` augmentations that require one). No `any`, no casts (`as`), no non-null assertions: narrow with the guards in `@weirwood/core`.
- Named exports only (config files that need a default export are exempt in `.oxlintrc.json`).
- No `for`/`for...of`/`for...in` loops; use array methods. Prefer immutable updates.
- One object parameter instead of several positional ones.
- `!!value` for booleans; `&&` rather than a ternary with a null branch in JSX; `?.` always paired with `??`.
- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata under vitest.
- Web modules import via `@/`; styles are `*.module.scss` using the tokens in `apps/web/src/styles/globals.scss`.
- CSS layout is grid with `gap` and container padding; no flex layouts and no margins for spacing. Every page works at 320px wide.
- Accessibility: semantic elements, labels on every control, visible `:focus-visible`, reduced motion respected.
- Writing: no em dashes or en dashes anywhere, including comments and UI copy.
