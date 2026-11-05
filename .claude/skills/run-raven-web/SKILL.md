---
name: run-raven-web
description: Use when running raven's web app locally against a local backend to try a change in the browser: "run raven web", "run raven locally", "start the raven dev server", "run the web app with a local backend", "start raven's server and Vite", "get started on this worktree", a local Home that says "Nothing to show yet" because the database is empty, or http://localhost:5173 answering 502 on /api because nothing listens on :8484.
---

# Run raven web with a local backend

Imports production's database from Vhagar, then starts raven's server (`@raven/server`, http://localhost:8484) and the web app's Vite dev server (`@raven/web`, with `@raven/ui` rebuilding in watch mode). Vite proxies `/api` to :8484, so open the Vite address, never :8484.

The server reads `apps/raven/.env`. With `SUPABASE_*` there (the usual case) it enforces accounts and the page asks for a real sign-in; without it, it runs open. It migrates `apps/raven/server/data/raven.db` on start, skips the library scan (`SCAN_ON_START=false`) and logs a line for every request it answers (`RAVEN_LOG_REQUESTS=true`, both set by the server's `dev` script). To point the web app at Vhagar's raven instead of a local one, use `bun run dev:raven:prod` and stop here.

## Steps

Run everything from the repo root (the worktree's root in a worktree), each server with `run_in_background`, logs in the scratchpad. Probe with curl, never `lsof` (it hangs on this Mac's SMB volumes).

1. **Install.** `bun install`.

2. **See what already runs.**

   ```bash
   for p in 5173 5174 5175 8484; do echo "$p $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:$p/api/health)"; done
   pgrep -fl 'tsx watch|vite|nx run-many'
   ```

   `200` on 8484 means a server is up; `502` on a Vite port means a Vite with no backend behind it. The paths `pgrep` prints say whose each process is: one under `.claude/worktrees/<name>` serves that worktree, not this checkout. Stop only this checkout's processes, by PID (kill the `nx run-many` first, then any `tsx watch` or `vite` of this checkout left behind). Never `pkill -f` a pattern; it takes the user's other servers and worktree Vites with it. Another checkout's server on :8484 must be stopped too before step 3, since the import refuses to run while :8484 answers and this checkout's server needs the port; say whose it was in the report.

3. **Import production's database.** `bun run dev:raven:db` (`scripts/pull_raven_db.sh`), with no server on :8484. It copies Vhagar's `raven.db` over ssh with a consistent `.backup`, rewrites the stored `/media/<nas>/` paths to the shares under `/Volumes`, moves the old local database to `apps/raven/server/data/backups/<stamp>/`, and pulls the posters and thumbnails (over a gigabyte the first time; give it up to 10 minutes). A fresh worktree has no `data` folder, and without this step Home says "Nothing to show yet". Check the result:

   ```bash
   sqlite3 apps/raven/server/data/raven.db 'select count(*) from libraries; select count(*) from media'
   ```

   If ssh to `vhagar` fails, fall back to the main checkout's copy: stop the servers, `sqlite3 <main>/apps/raven/server/data/raven.db ".backup apps/raven/server/data/raven.db"` (after removing this checkout's `raven.db`, `-wal` and `-shm`), then `cp -cR` its `images`, `thumbnails` and `subtitles` folders, and say so in the report.

4. **Start both servers.** `bun run dev:raven` (the server, `@raven/ui` in watch mode and Vite). Wait until `http://localhost:8484/api/health` answers `200`; the first start takes a few seconds, more when a branch's migrations run on the imported database. Vite takes 5173, or the next free port when another Vite holds it: read the log for the `Local:   http://localhost:<port>/` line (strip the colour codes first), then check `http://localhost:<port>/api/health` answers `200`, which proves the proxy reaches the backend. `http proxy error ... ECONNREFUSED` lines from the first seconds are an open tab polling before the server listened; they stop once it does.

5. **Report**: the Vite URL, which checkout's code it serves, the library and video counts the import brought, where the log is (each request shows in it as `[registerRequestLog] GET /api/... 200 12ms`), the PIDs started (`pgrep -fl 'tsx watch|vite|nx run-many'`) and how to stop them (kill those PIDs).

## Known limits

- `apps/raven/.env` supplies the metadata keys (TMDB, OMDb, MDBList), `ADMIN_PASSWORD`, `LIBRARY_PIN` and the Supabase settings. Never put a `.env` at the repo root.
- **Never start the server with `RAVEN_ACCOUNTS=off` while `apps/raven/.env` has `SUPABASE_*`**: the override conflicts with them and every protected route answers 503. Check the file first.
- **"raven is temporarily unavailable / raven could not reach its accounts"** with no `SUPABASE_*` in `apps/raven/.env`: the imported database remembers that production enforced accounts, and a server that once enforced never falls back to open by itself. Either add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `RAVEN_WEB_URL` to `apps/raven/.env` for a real sign-in, or start with `RAVEN_ACCOUNTS=off bun run dev:raven` (in the shell, never in `.env`) to clear the record in the local copy and open raven to anonymous viewers; without the variable the 503 returns.
- The import runs only with no server on :8484, and a later import needs the servers stopped again. Editing server code or rebuilding `@raven/core` restarts `tsx watch`, which runs the branch's migrations on the local copy only.
- A Vite already holding :5173 pushes this checkout's to :5174, and the two proxy to the same :8484 server.
