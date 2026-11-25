---
name: run-wren-web
description: Use when running Wren's web app (`@wren/web`) locally to try a change in the browser: "run wren", "start the wren dev server", "run wren web", "start wren locally", "run wren on the fixture", or http://localhost:5185 not answering or answering 502 on /api because nothing listens on :8484.
---

# Run Wren on the web

Starts raven's server (`@raven/server`, http://localhost:8484) and Wren's Vite dev server (`@wren/web`, http://localhost:5185, strict port). Vite proxies `/api` to the server, so open :5185, never :8484.

The server reads `apps/raven/.env` and migrates `apps/raven/server/data/raven.db` on start. Wren needs music in that database; for an empty one use the fixture server (below) or import production's with the `run-raven-web` skill's step 3.

## Steps

Run from the repo root, each server with `run_in_background`, logs in the scratchpad. Probe with curl, never `lsof` (it hangs on this Mac's SMB volumes).

1. **See what already runs.**

   ```bash
   for p in 5173 5185 8484 8490; do echo "$p $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:$p/api/health)"; done
   pgrep -fl 'tsx watch|vite|nx run-many'
   ```

   A server already on 8484 is reused: start only Wren's Vite (`bun run nx run @wren/web:dev`). Stop only this checkout's processes, by PID; never `pkill -f` a pattern.

2. **Start both.** `bun run dev:wren:web`. Wait until `http://localhost:8484/api/health` and `http://localhost:5185/api/health` both answer `200` (the second proves the proxy reaches the backend). `ECONNREFUSED` proxy lines in the first seconds are harmless.

3. **Report** the URL, the log path, the PIDs (`pgrep -fl 'tsx watch|vite|nx run-many'`) and how to stop them.

## Against the fixture server

No account, one album (Morning Chorus by The Fixture Birds):

```bash
bun run nx run @raven/server:serve:fixture
RAVEN_DEV_API_ORIGIN=http://127.0.0.1:8490 bun run nx run @wren/web:dev
```

Accounts are off, so the app opens on Home with no sign-in.

## Known limits

- Port 5185 is strict: a second Wren Vite fails instead of moving. Stop the old one first.
- Never start the server with `RAVEN_ACCOUNTS=off` while `apps/raven/.env` has `SUPABASE_*`; every protected route answers 503.
- Editing server code or rebuilding `@raven/core` restarts `tsx watch` and drops running scans.
- Never put a `.env` at the repo root.
