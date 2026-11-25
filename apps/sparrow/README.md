# sparrow

The AI assistant of the maester suite, a concierge for raven, the suite's media server. Friends talk to it in plain language; it requests movies and shows, works out why something will not play, and explains lag with live data from raven.

Its chat app is under way: a standalone app, and later a helper window that drops into raven. Sign-in is raven's: friends sign in with their raven account (email and password, Supabase), and sparrow asks raven whose each token is. The chat page (`web/`) talks to sparrow's chat API and runs locally through Vite; sparrow also runs its agent and tools, the Seerr webhook and the scheduled jobs, and still writes the notices it would send to its log.

sparrow is the suite's maester: it serves the house, answers its questions, and sends the ravens.

```
Friends (sparrow's chat app, standalone or inside raven)
        │
   sparrow  (Claude tool-use agent, FastAPI for webhooks, SQLite)
        │
 ┌──────┼──────────┬──────────┬──────────┐
raven  Seerr     Sonarr    Radarr    SABnzbd
                 (x2)      (x2)      (x2)
```

## Contents

- [What it does](#what-it-does)
- [Roadmap and tracker](#roadmap-and-tracker)
- [Tech stack](#tech-stack)
- [Structure](#structure)
- [Getting started](#getting-started)
- [Docs](#docs)

## What it does

| A friend says                                  | sparrow does                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "get Dune in 4K"                               | Finds the title through Seerr, asks which one if ambiguous, requests it as that friend; one Seerr leaves pending waits there for the admin                          |
| "is The Bear on the server?"                   | Finds it in raven, with each library's copy and a link that opens it there                                                                                        |
| "where's my request?"                          | Merges Seerr status, the arr queue and SABnzbd progress into one ETA                                                                                              |
| "this won't play"                              | Finds what they just played in raven, probes the file, then replaces it through a confirmed, capped, audited flow                                                 |
| "the Dune on the server is a cam"              | Records it as a Seerr issue, and swaps the copy once a second friend reports it                                                                                   |
| "S02E07 of The Bear is missing"                | Searches the missing episodes on the host that owns the show; tells the admin about whole missing seasons                                                         |
| "it's laggy"                                   | Reads their own live stream in raven (converted or not, at home or away, the file), the last speed test, and gives one concrete fix                               |
| "is raven down?"                               | Pings every service behind the server at once and says what is up and what is down                                                                                |
| "which Dune should I watch on hotel wifi?"     | Lists each of raven's files of it with its bitrate and recommends the one the connection carries                                                                  |
| "how do I install Raven on my Mac?"            | Walks through it from sparrow's own guide, the player's Quality menu included                                                                                     |

For the admin:

- a daily digest: requests, issues, replacements, stalled or failed downloads per host, free space and when each volume fills
- a weekly NAS report, anything degraded at the top
- stalled downloads blocklisted and searched again on their own, and 4K requests refused while their volume is nearly full
- "why did Dune fail?" answered from SABnzbd and the arr's history
- tier overrides

Admin approvals, maintenance windows, the kill switch and the console's `/audit`, `/pending` and `/forecast` were removed: nothing in the deployed app reached them, since notices only reach the log. Git history holds that code for when sparrow's app delivers notices.

Everything sparrow can change goes through a small set of scoped tools with permission tiers and confirmations. There is no shell, no generic API passthrough.

## Roadmap and tracker

Work is tracked in [GitHub Issues](https://github.com/codebend3r/maester/issues): one issue per epic (label `epic`) with stories attached as sub-issues, milestones M1 to M5 for phases, and the [maester roadmap board](https://github.com/users/codebend3r/projects/1) for status.

The catalog of epics and stories lives in [`scripts/catalog.py`](../../scripts/catalog.py) at the repo root. [`docs/roadmap.md`](../../docs/roadmap.md) and the issues are both rendered from it by `scripts/sync_tracker.py`, so edit the catalog and re-run the sync rather than editing either by hand.

The board follows the issues. `uv run python scripts/sync_board.py`, run from the repo root, lists where it has drifted (status, fields, missing items, finished epics, roadmap checkboxes), and `--apply` fixes it.

| Milestone | Goal                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| M1        | Walking skeleton: a friend can chat with sparrow and it answers using a read-only tool |
| M2        | Requests in 1080p and 4K through Seerr                                               |
| M3        | Troubleshooting: playback diagnosis, guarded replacement, lag explanation            |
| M4        | Admin and onboarding: approvals, digests                                             |
| M5        | Engagement: recommendations, weekly posts                                            |

## Tech stack

| Part      | Choice                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| Language  | Python 3.12, `uv`, `ruff`, `pytest`, run through the workspace's Nx and Bun                     |
| LLM       | Anthropic Python SDK, Messages API tool-use loop, `claude-sonnet-5-5` default, prompt caching   |
| Chat      | sparrow's own app (`@sparrow/web`): React 19, Vite 8, TanStack Query, zustand, SCSS modules        |
| Web       | FastAPI: sparrow's `/api` (chat streamed as server-sent events), the Seerr webhook, `/health`     |
| Sign-in   | raven's Supabase accounts: the page's bearer token, checked with raven's `GET /api/me`          |
| Storage   | SQLite on a `/data` volume: users, conversations, audit log, reports, pending actions           |
| Services  | raven, Seerr, Sonarr, Radarr, SABnzbd over their REST APIs                                      |
| Hosting   | Docker Compose on a Synology NAS                                                                |

## Structure

sparrow is the `apps/sparrow/` folder of an Nx workspace; the [root README](../../README.md) covers the workspace.

```
apps/sparrow/
├── api/                    the @sparrow/api Nx project: a Python 3.12 package run through uv
│   ├── package.json        Nx targets: dev, sandbox, test, eval, lint:py, format
│   ├── pyproject.toml, uv.lock
│   ├── sparrow/
│   │   ├── agent/          tool-use loop, tool registry, guardrails, prompts
│   │   ├── clients/        one httpx client per service, each with an in-memory fake
│   │   ├── tools/          the scoped tools the model can call, grouped by area
│   │   ├── playback/       playback reports: plays in raven, file health, the replace flow
│   │   ├── perf/           lag: raven streams, host load, the speed test, which file a connection carries
│   │   ├── chat/           the chat service, identity and tiers, the admin's tier command
│   │   ├── web/            FastAPI app: the API, the token check against raven, webhooks, /health
│   │   ├── jobs/           scheduled work: the digest, the sweeper, space samples, the NAS report
│   │   ├── store/          SQLite schema, migrations, audit log
│   │   ├── evals/          the eval runner and the fake world a case runs in
│   │   ├── sandbox.py      the chat API over an eval case's fakes, with no sign-in, for testing
│   │   ├── app.py          wires settings into clients, store, agent and web app
│   │   ├── config.py       environment, read once
│   │   └── *.py            shared modules: service registry, title ownership, media, notices
│   ├── evals/cases/        scripted conversations against the fakes, one YAML file each (checked by `sparrow/evals/seed.py`; an unknown key fails the case)
│   └── tests/
├── web/                    the @sparrow/web Nx project: the chat page, React on Vite
├── docs/                   architecture, deferred work, NAS deployment
├── Dockerfile              the image, built from the repo root
├── docker-compose.yml      the container on Meleys
├── .env.example            copy to .env beside it
└── VERSION
```

Repo tooling (tracker catalog and sync, board setup and sync, NAS deploy, version bump) lives in [`scripts/`](../../scripts) at the repo root.

## Getting started

**Prerequisites.** [Bun](https://bun.sh) at the version the root `package.json` pins, and [uv](https://docs.astral.sh/uv/) (`brew install uv`); uv fetches Python 3.12 from `api/.python-version` if it is missing. You also need an Anthropic API key for the server (local testing runs on Claude Code instead; see Sandbox), the URLs and API keys of the services, and a running raven with accounts on (`RAVEN_URL`). The file health check needs `ffmpeg` on your `PATH`; the Docker image ships it, along with Ookla's `speedtest` CLI. Outside Docker, leave `SPEEDTEST_HOST` empty so the speed test is off.

```bash
git clone https://github.com/codebend3r/maester.git
cd maester
bun install                                     # Nx, and the git hooks: ruff on staged Python files
cp apps/sparrow/.env.example apps/sparrow/.env  # fill in service URLs, API keys and the Anthropic key
bun run dev:sparrow                             # the API and jobs on :8020, the chat page on :5190
```

`.env` lives beside `docker-compose.yml`, in `apps/sparrow/`, where compose reads it too. Keep none at the repo root: Nx loads a root `.env` into every task it runs.

Checks run through Nx from the repo root: `bunx nx run @sparrow/api:test`, `bunx nx run @sparrow/api:lint:py`, `bunx nx run @sparrow/api:format:check`, or `bun run verify` for every project. Evals: `bunx nx run @sparrow/api:eval` (fake model), or from `apps/sparrow/`, `uv run --project api sparrow-eval` for the real model against fake services.

**Sign-in.** sparrow runs no sign-in of its own. Its page signs in to raven's Supabase project with the person's raven email and password, reading where from sparrow's `GET /api/auth/config` (raven's own answer, relayed), and sends the access token as `Authorization: Bearer`. sparrow asks raven's `GET /api/me` at `RAVEN_URL` whose it is, caching each answer for 30 seconds by the token's hash and never storing the token; the token rides along only so the person's tools read raven as them. A request without one raven accepts gets a 401 and the page signs in again. What someone may do is sparrow's call: an account raven's owner hasn't approved (pending or removed) is turned away with a 403 telling them to ask raven's owner; raven's owner is the admin; any other approved member is a friend; and the admin can set any user's tier with `POST /api/admin/users/{user_id}/tier`. A friend is matched to a Seerr user by email, so requests go to Seerr as them.

**Chat.** The chat page is `web/` (`@sparrow/web`), at http://localhost:5190 in development, where Vite proxies `/api` to sparrow on port 8020. Its routes are `POST /api/chat` (one turn, streamed as server-sent events), `/api/chat/pick`, `/api/chat/decide`, `/api/chat/forget` and `GET /api/chat/usage`, all for a friend or above. The page is sparrow's design (the icon rail, the sidebar with the sandbox's controls, the conversation, and the model and token budget under the composer) in raven's Verdigris colours. The image doesn't serve the page yet, and there is no inbox, so everything sparrow would tell someone (ready messages, the digest, the NAS report) still goes to its log (`docs/deferred.md`, L-4 to L-8).

**Sandbox.** To try questions and read the answers without the NAS or a sign-in, run `bun run sandbox:sparrow` and open http://localhost:5190. It serves the same chat API over an eval case's fake services (`api/evals/cases/`, or a blank world), except raven: it searches the real library at `RAVEN_URL` (from the environment or `apps/sparrow/.env`; http://localhost:5174 when unset), so "is Dune on the server?" gets a real answer, with each title shown under the reply with a link to every copy in raven. On a Mac the sandbox reaches raven through `curl` (`sparrow/clients/curl.py`), since macOS's Local Network privacy can keep the project's Python off the LAN. It keeps everything in memory, asks no sign-in, listens on 127.0.0.1 only, and restarts itself whenever sparrow's code changes (starting the conversation fresh). The page then shows the sandbox bar (pick the case, the tier, start over), the case's own messages with what each one expects, and under every reply the tool calls it made, their arguments and answers, the notices it sent, and whether it met the case. The conversation survives a page reload (it is kept in the browser, tied to the sandbox's current world, so a sandbox restart or another case starts it fresh); a turn that breaks shows the exception behind its error reference. The model is sparrow's default, Claude Sonnet 5.5 (`--model` names another), reached through headless Claude Code on your own sign-in (`claude -p`), never an API key: only the deployed server uses `ANTHROPIC_API_KEY`. The sandbox needs `claude` on your `PATH`, signed in. For working on the page itself, `uv run --project api sparrow-sandbox --model fake` from `apps/sparrow/` answers every turn with a scripted line, and `--case <file stem>` opens a case first.

**raven.** `RAVEN_URL` is raven's address, http://192.168.50.6:8484 on the NAS, and sparrow won't boot without it. Every read of raven goes as the person asking, with their own token, so raven's rules for their account apply: `search_library` and `newest_in_library` see the libraries they may, `recent_sessions` reads their own play history (`/api/history`), `session_report` their own live streams (`/api/streams/mine`), `pick_version` the files of a title (`/api/items/{id}`), and only the admin's `server_status` reads everyone's streams (`/api/streams`). sparrow holds no raven token of its own. Its links open the title's page there, so use an address friends' browsers open too.

**Seerr and the arrs.** sparrow works out which host holds a title's 1080p or 4K copy from Seerr's own records, so each Radarr and Sonarr in Seerr's settings must use the same address (host, port and base path) as its `RADARR_<HOST>_URL` or `SONARR_<HOST>_URL` here. A server Seerr reaches by another name is refused rather than guessed.

**Seerr webhook.** In Seerr, Settings, Notifications, Webhook: set the URL to `http://<sparrow host>:8020/webhooks/seerr`, set *Authorization Header* to the value of `SEERR_WEBHOOK_SECRET`, keep the default JSON payload, and tick *Request Approved*, *Request Declined*, *Request Available*, *Issue Resolved* and *Issue Reopened*. Friends then hear when the admin approves or declines their request in Seerr, and get a message pointing at raven when it is ready; and resolving a playback report's issue in Seerr closes the report. Other ticked types are acknowledged and ignored.

**File health check.** The container mounts the media shares read-only (`apps/sparrow/docker-compose.yml`) and `MEDIA_ROOTS` lists them; nothing outside them is read. When Sonarr or Radarr report paths under other names than the mounts, map them with `MEDIA_PATH_MAP`.

**Deploy.** [`docs/nas-deployment.md`](docs/nas-deployment.md) covers running it as a container on the NAS.

## Docs

- [`docs/roadmap.md`](../../docs/roadmap.md): milestones, epics, stories, with issue links (at the repo root)
- [`docs/architecture.md`](docs/architecture.md): components, instance registry, permission tiers, guardrails
- [`docs/nas-deployment.md`](docs/nas-deployment.md): first boot, updates, media mounts and data for the container on the NAS
- [`docs/deferred.md`](docs/deferred.md): work left out of each epic's PR, why, and where it lands
