# Claude context for raven

## Hard rules

- Do not commit, push, branch, merge, or open a PR unless told to.

## What this is

A self-hosted video library and web player: direct play, with an on-the-fly remux or transcode for what the browser cannot play. See README.md for how playback, scanning and thumbnails work.

## Structure

raven's projects live in the workspace described by the root `CLAUDE.md`, which covers Nx, the project table and how to run tasks: `@raven/server` in `apps/raven/server`, `@raven/web` in `apps/raven/web`, and `@raven/core` in `libs/raven/core`. The server also depends on `@shared/server` (`libs/shared/server`), which it shares with rookery: it serves the built web app, opens SQLite and runs `MIGRATIONS`, reads the listen config, and compares the PIN and the unlock cookie in constant time.

`libs/raven/core` must stay platform-agnostic: no DOM, no Node APIs, not even `URLSearchParams` (use `toQueryString`). Its tsconfig has `lib: ["ES2023"]` and no `types` so a slip fails the typecheck.

The image builds from the repo root: `docker build -f apps/raven/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.

## Conventions

The TypeScript, code style and CSS rules are in the root `CLAUDE.md`. raven adds:

- The API contract is `libs/raven/core/src/contract.ts`. Each shape is written once, as its `is<Type>` guard built from the combinators in `schema.ts` (`object`, `oneOf`, `nullable`, `listOf`, `union`, `exactPartial`), and its type is read off the guard: `export type MediaItem = Infer<typeof isMediaItem>`. A new API type is a new guard there, never a hand-written type beside a hand-written guard. A union of literals is a `oneOf([...])`, and its `.values` is the list for a menu or a loop. Request bodies get guards there too, so the server checks a body with the guard the client's call is typed by.
- What each type of library allows (its sorts, views and groupings, and whether it is matched) lives in `KIND_RULES` in `libs/raven/core/src/libraryKinds.ts`; `coherentSettings` applies it.
- Narrow with the guards in `@raven/core` wherever data crosses the network.
- The web app is also served from Netlify, whose CDN proxies `/api` to raven (README, "On Netlify"). A response that depends on the browser's cookies, the PIN's or the admin lock's, is never `public` in `cache-control`, or Netlify's cache hands it to everyone. A route that changes things gets `@AdminOnly()`, since raven is reachable from the internet.
- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata, which neither vitest nor `tsx` emits.
- All three projects import their own modules via `@/` with no extension; `tsconfig.json` uses `"moduleResolution": "bundler"` so TypeScript allows it. The server's `dev` runs through `tsx`, and its `build` is `tsc` then `tsc-alias`.
- The tokens are in `apps/raven/web/src/styles/globals.scss`, and element defaults in `elements.scss` beside it. The `/design` page reads `globals.scss` itself, so a new token shows up there with no extra step.
