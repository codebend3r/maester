---
name: run-sparrow
description: Use when running sparrow's chat page locally to try it out, against raven running on this Mac or against the real raven deployed on Vhagar: "run sparrow", "run sparrow local", "run sparrow prod", "test sparrow against Vhagar", "start the sparrow sandbox", or the page at http://localhost:5190 saying "Couldn't reach sparrow; check that its server is running."
argument-hint: local | prod
---

# Run sparrow

Starts sparrow's sandbox API (`sparrow-sandbox`, :8020) and its chat page (`@sparrow/web`, http://localhost:5190), wired to a raven. The argument picks which raven:

| Argument | raven sparrow searches                                               | What else starts                                    |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| `local`  | the dev raven on this Mac (`bun run dev:raven`, Vite proxying :8484) | `dev:raven`, unless a raven already answers locally |
| `prod`   | the deployed raven on Vhagar, `http://192.168.50.6:8484`             | nothing else                                        |

No argument means `local`. Anything else: stop and say the argument must be `local` or `prod`.

The sandbox is the only way to run sparrow on this Mac without the NAS: the real server (`bun run dev:sparrow`) needs a filled `apps/sparrow/.env`, a running rookery and every service's key, and there is no deployed sparrow to point the page at (nothing answers on :8020 on Meleys or Vhagar). The sandbox fakes Seerr, Plex and the arrs from an eval case, needs no sign-in, and calls the model through `claude -p` on the user's own Claude Code sign-in (Sonnet 5.5 at medium effort). raven is the one real service, chosen by `RAVEN_URL`, which the shell sets ahead of any `apps/sparrow/.env` (python-dotenv never overrides).

## Steps

Run everything from the repo root, each server with `run_in_background`, logs in the scratchpad.

1. **Prerequisites.** `command -v uv claude` must find both. If `uv` is missing, `brew install uv`; if `claude` is missing, tell the user the sandbox needs Claude Code signed in, or offer `--model fake` (step 4).

2. **Free ports.** Probe with curl, never `lsof` (it hangs on this Mac's SMB volumes):

   ```bash
   curl -s -m 2 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8020/api/sandbox
   curl -s -m 2 -o /dev/null -w '%{http_code}\n' http://localhost:5190
   ```

   Anything but `000` means a sparrow is already up. `curl -s http://127.0.0.1:8020/api/sandbox` answers JSON whose `raven` field is the raven it searches. If that is not the raven this mode wants (the other mode, or a local port no raven answers on, such as the sandbox's fallback `http://localhost:5174` when Vite took 5173), stop it: find the PIDs with `pgrep -fl sparrow-sandbox` and `pgrep -fl 'sparrow/web'` and kill those PIDs (`kill -9` if uvicorn's reloader ignores SIGTERM). Never `pkill -f` a pattern; it takes the user's own servers with it. If it is the right raven, skip to step 5, which still starts the page if only the API is up (`bunx nx run @sparrow/web:sandbox`).

3. **raven (`local` only).** Look for a running dev raven first:

   ```bash
   for p in 5173 5174 5175; do echo "$p $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:$p/api/health)"; done
   ```

   The first port answering `200` is the raven to use. If none does, start `bun run dev:raven` in the background, then read its log for Vite's `Local:   http://localhost:<port>/` line (5173 unless taken) and wait until `/api/health` there answers `200`. The server takes a while on first start; it migrates `apps/raven/server/data/raven.db`. Use the Vite address, not :8484 directly, because sparrow links friends to raven's pages at `RAVEN_URL` and only Vite serves those in development. The local raven runs open (no `SUPABASE_*` in `apps/raven/.env`), so sparrow needs no sign-in. A local library comes from Vhagar's database: `bun run dev:raven:db` (see the `raven-local-dev-data` memory).

4. **sparrow.** Start it with the raven from step 3, or Vhagar's:

   ```bash
   # local
   RAVEN_URL=http://localhost:<vite port> bun run sandbox:sparrow
   # prod
   RAVEN_URL=http://192.168.50.6:8484 bun run sandbox:sparrow
   ```

   `sandbox:sparrow` runs `@sparrow/api:sandbox` and `@sparrow/web:sandbox` together. Always pass `RAVEN_URL`: without it the sandbox falls back to `http://localhost:5174`, but Vite gives raven 5173 unless that is taken. Its log prints `sparrow sandbox (model claude-sonnet-5-5, raven <url>) on http://127.0.0.1:8020`, and `/api/sandbox`'s `raven` field says the same; check that it is the raven meant. With no `claude`, or to work on the page without model calls, run the API with scripted replies instead: `RAVEN_URL=... uv run --project api sparrow-sandbox --model fake` from `apps/sparrow/`, beside `bunx nx run @sparrow/web:dev`.

5. **Wait for both.** Poll until `http://127.0.0.1:8020/api/sandbox` and `http://localhost:5190` both answer `200`.

6. **Check raven from sparrow's side**, the way sparrow asks it:

   ```bash
   curl -s -m 5 -w ' %{http_code}\n' "$RAVEN_URL/api/home/search?q=dune" | tail -c 200
   ```

   `200` with shelves means "is Dune on the server?" gets a real answer.

7. **Report**: open http://localhost:5190, the mode, the raven URL, the model, the PIDs of what was started, and how to stop them (kill those PIDs).

## Known limits

- **`prod` and raven's sign-in.** raven on Vhagar has Supabase accounts on, and answers every API call without a session with `401 {"reason":"signed_out"}`. sparrow's `RavenClient` sends no credentials, so in `prod` every `search_library` call fails with `raven GET /api/home/search failed (401)`, and the sandbox shows that error under the reply. The rest of the sandbox works (the fakes, the model, the page). Say so when step 6 returns `401`; sparrow needs a way to sign in to raven (a service token, like the one rookery gives it) before `prod` can answer library questions.
- **Local Network privacy.** The sandbox reaches raven through `curl` (`sparrow/clients/curl.py`) on a Mac, so `prod` works from Claude Code's shell. Bun, Python and Chrome launched from that shell cannot reach `192.168.50.x`; use `curl` for any other check against Vhagar.
- The sandbox keeps everything in memory and restarts itself, starting the conversation fresh, whenever a file under `apps/sparrow/api/sparrow/` changes.
