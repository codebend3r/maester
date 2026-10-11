# Claude context for raven

## Hard rules

- Do not commit, push, branch, merge, or open a PR unless told to.

## What this is

A self-hosted video library and web player: direct play, with an on-the-fly remux or transcode for what the browser cannot play. See README.md for how playback, scanning and thumbnails work.

## Structure

raven's projects live in the workspace described by the root `CLAUDE.md`, which covers Nx, the project table and how to run tasks: `@raven/server` in `apps/raven/server`, `@raven/web` in `apps/raven/web`, and `@raven/core` in `libs/raven/core`.

`libs/raven/core` must stay platform-agnostic: no DOM, no Node APIs, not even `URLSearchParams` (use `toQueryString`). Its tsconfig has `lib: ["ES2023"]` and no `types` so a slip fails the typecheck.

The image builds from the repo root: `docker build -f apps/raven/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.

## Conventions

The TypeScript, code style and CSS rules are in the root `CLAUDE.md`. raven adds:

- Narrow with the guards in `@raven/core`: the API types in `libs/raven/core/src/types.ts` have their `is<Type>` guards in `guards.ts`, and a new API type gets one there too.
- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata, which neither vitest nor `tsx` emits.
- All three projects import their own modules via `@/` with no extension; `tsconfig.json` uses `"moduleResolution": "bundler"` so TypeScript allows it. The server's `dev` runs through `tsx`, and its `build` is `tsc` then `tsc-alias`.
- The tokens are in `apps/raven/web/src/styles/globals.scss`, and element defaults in `elements.scss` beside it. The `/design` page reads `globals.scss` itself, so a new token shows up there with no extra step.
