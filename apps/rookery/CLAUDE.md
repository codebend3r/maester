# Claude context for rookery

## What this is

The suite's sign-in: Sign in with Plex, the shared `maester_session` cookie, sign-out, and `/internal/session`, which tells the other apps who a session belongs to. See README.md for the flow and hosting, and `docs/superpowers/specs/2026-10-09-shared-sign-in-design.md` for the design.

rookery authenticates; it never decides what someone may do in an app. Tiers, owner detection and Seerr matching stay in sparrow.

## Structure

rookery's projects live in the workspace described by the root `CLAUDE.md`, which covers Nx, the project table and how to run tasks: `@rookery/server` in `apps/rookery/server`, `@rookery/web` in `apps/rookery/web` and their contract, `@rookery/core` in `libs/rookery/core`: the routes (`ROUTES`, and `SERVER_PATHS`, every path the server answers itself), the pages, the query and body keys, the error codes and the wire types with their guards. Both sides import it, so neither writes a route, a key or a code of its own. The server depends on `@shared/server` (`libs/shared/server`), which it shares with raven: it serves the built web app, compresses responses, opens SQLite and runs `MIGRATIONS`, reads the listen config, and, through `@shared/http`, reads cookies and the bearer token, writes cookies with `serializeCookie`, and checks the service token with `@shared/server`'s `sameSecret`.

The image builds from the repo root: `docker build -f apps/rookery/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.

## Security rules

- Never store a Plex token, and never store a session token: only its SHA-256 (`hashToken`).
- Every `return_to` goes through `safeReturnTo`, so rookery is never an open redirect.
- Every write is JSON; `app.ts` refuses anything else with 415. Do not add CORS headers.
- A pending sign-in is claimed (`PendingSignIns.claim`, one `DELETE ... RETURNING`) before plex.tv is asked, so a callback that arrives twice finishes it once.
- `/internal/*` checks the service token in constant time before anything else.
- The session cookie is cleared with the same `Domain` it was set with, or browsers keep it.

## Conventions

The TypeScript, code style and CSS rules are in the root `CLAUDE.md`. rookery adds:

- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata, which neither vitest nor `tsx` emits. The server's `dev` runs through `tsx`, and its `build` is `tsc` then `tsc-alias`, as raven's is. plex.tv, the clock and the PIN check's attempts and wait are injected (`PLEX_TV_CLIENT`, `CLOCK`, `PIN_CHECK`) so tests use `FakePlexTv`, a movable clock and no wait.
- The tokens are in `apps/rookery/web/src/styles/globals.scss`; the heading, lede and error line every page's card shares are `src/styles/text.module.scss`.
