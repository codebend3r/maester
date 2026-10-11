# Claude context for rookery

## What this is

The suite's sign-in: Sign in with Plex, the shared `maester_session` cookie, sign-out, and `/internal/session`, which tells the other apps who a session belongs to. See README.md for the flow and hosting, and `docs/superpowers/specs/2026-10-09-shared-sign-in-design.md` for the design.

rookery authenticates; it never decides what someone may do in an app. Tiers, owner detection and Seerr matching stay in luwin.

## Structure

rookery's projects live in the workspace described by the root `CLAUDE.md`, which covers Nx, the project table and how to run tasks: `@rookery/server` in `apps/rookery/server` and `@rookery/web` in `apps/rookery/web`.

The image builds from the repo root: `docker build -f apps/rookery/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.

## Security rules

- Never store a Plex token, and never store a session token: only its SHA-256 (`hashToken`).
- Every `return_to` goes through `safeReturnTo`, so rookery is never an open redirect.
- Every write is JSON; `app.ts` refuses anything else with 415. Do not add CORS headers.
- `/internal/*` checks the service token in constant time before anything else.
- The session cookie is cleared with the same `Domain` it was set with, or browsers keep it.

## Conventions

The TypeScript, code style and CSS rules are in the root `CLAUDE.md`. rookery adds:

- Server constructors inject with explicit `@Inject(Token)`, so DI never depends on decorator metadata under vitest. plex.tv and the clock are injected (`PLEX_TV_CLIENT`, `CLOCK`) so tests use `FakePlexTv` and a movable clock.
- The tokens are in `apps/rookery/web/src/styles/globals.scss`.
