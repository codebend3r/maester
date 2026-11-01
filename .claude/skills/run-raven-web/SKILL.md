---
name: run-raven-web
description: Use when running raven's web app locally against a local backend to try a change in the browser: "run raven web", "run raven locally", "start the raven dev server", "run the web app with a local backend", "start raven's server and Vite", or http://localhost:5173 answering 502 on /api because nothing listens on :8484.
---

# Run raven web with a local backend

Starts raven's server (`@raven/server`, http://localhost:8484) and the web app's Vite dev server (`@raven/web`, with `@raven/ui` rebuilding in watch mode). Vite proxies `/api` to :8484, so open the Vite address, never :8484.

The local server runs open: with no `SUPABASE_*` in `apps/raven/.env` there is no sign-in. It migrates `apps/raven/server/data/raven.db` on start and skips the library scan (`SCAN_ON_START=false`). A library comes from Vhagar's database: `bun run dev:raven:db`. To point the web app at Vhagar's raven instead of a local one, use `bun run dev:raven:prod` and stop here.

## Steps

Run everything from the repo root, each server with `run_in_background`, logs in the scratchpad. Probe with curl, never `lsof` (it hangs on this Mac's SMB volumes).

1. **See what already runs.**

   ```bash
   for p in 5173 5174 5175 8484; do echo "$p $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:$p/api/health)"; done
   ```

   `200` on 8484 means a server is up; skip step 2. `502` on a Vite port means a Vite is up with no backend behind it. Find out whose it is before reusing it: `pgrep -fl vite` shows the path, and a Vite from `.claude/worktrees/<name>` serves that worktree's code, not this checkout's.

2. **Backend.** `bun run app:server` (`@raven/server:dev`, `tsx watch`). After `bun run dev:raven:db` (production's database remembers that accounts were enforced), start it as `RAVEN_ACCOUNTS=off bun run app:server`, or the page says "raven is temporarily unavailable" and `/api` answers 503 (see "Known limits"). `dev:raven:db` itself needs the local server stopped, so stop it first, import, then start it again. Wait until `http://localhost:8484/api/health` answers `200`; the first start takes a few seconds.

3. **Web.** `bunx nx run-many -t dev -p @raven/ui @raven/web` (`bun run dev:raven` starts the server too, so use it instead of steps 2 and 3 when nothing runs). Vite takes 5173, or the next free port when another Vite holds it. Read the log for the `Local:   http://localhost:<port>/` line, then check `http://localhost:<port>/api/health` answers `200` (that proves the proxy reaches the backend).

4. **Report**: the Vite URL, which checkout's code it serves, the PIDs started (`pgrep -fl 'raven/server'`, `pgrep -fl vite`) and how to stop them (kill those PIDs). Never `pkill -f` a pattern; it takes the user's other servers and worktree Vites with it.

## Known limits

- `apps/raven/.env` supplies the metadata keys (TMDB, OMDb, MDBList), `ADMIN_PASSWORD` and `LIBRARY_PIN`. Never put a `.env` at the repo root.
- With a Supabase config added to `apps/raven/.env` the server enforces accounts and the web app needs a real sign-in. Remove it, or set `RAVEN_ACCOUNTS=off`, to stay open.
- **"raven is temporarily unavailable / raven could not reach its accounts."** A server that has enforced accounts never falls back to open by itself, and the imported production database carries that record. With no `SUPABASE_*` locally the server answers 503. Set `RAVEN_ACCOUNTS=off` in the shell (not `.env`) when starting it: it clears the record in the local copy only, opens raven to anonymous viewers and logs a warning on every start. Without the variable the 503 returns, because the record is only cleared while it is set. For a real sign-in instead, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `RAVEN_WEB_URL` in `apps/raven/.env`.
- A Vite already holding :5173 pushes this checkout's to :5174, and the two proxy to the same :8484 server.
