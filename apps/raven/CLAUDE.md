# Claude context for weirwood

## Hard rules

- Do not commit, push, branch, merge, or open a PR unless told to.

## What this is

A self-hosted video library and direct-play web player. See README.md for how playback, scanning and thumbnails work.

## Structure

weirwood's projects live in the workspace described by the root `CLAUDE.md`, which covers Nx, the project table and how to run tasks: `@weirwood/server` in `apps/weirwood/server`, `@weirwood/web` in `apps/weirwood/web`, and `@weirwood/core` in `libs/weirwood/core`.

`libs/weirwood/core` must stay platform-agnostic: no DOM, no Node APIs, not even `URLSearchParams` (use `toQueryString`). Its tsconfig has `lib: ["ES2023"]` and no `types` so a slip fails the typecheck.

The image builds from the repo root: `docker build -f apps/weirwood/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.

## Conventions

- Type aliases, never interfaces (except `.d.ts` augmentations that require one). No `any`, no casts (`as`), no non-null assertions: narrow with the guards in `@weirwood/core`.
- Named exports only (config files that need a default export are exempt in `.oxlintrc.json`).
- No `for`/`for...of`/`for...in` loops; use array methods. Prefer immutable updates.
- One object parameter instead of several positional ones.
- `!!value` for booleans; `&&` rather than a ternary with a null branch in JSX; `?.` always paired with `??`.
- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata under vitest.
- Web modules import via `@/`; styles are `*.module.scss` using the tokens in `apps/weirwood/web/src/styles/globals.scss`.
- CSS layout is grid with `gap` and container padding; no flex layouts and no margins for spacing. Every page works at 320px wide.
- Accessibility: semantic elements, labels on every control, visible `:focus-visible`, reduced motion respected.
- Writing: no em dashes or en dashes anywhere, including comments and UI copy.
