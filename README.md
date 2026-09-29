# maester

An AI concierge for a private Plex server. Friends talk to it on Discord in plain language; it requests movies and shows, works out why something will not play, explains lag with live server data, and hands the admin an approval queue instead of a group chat thread.

A maester serves the house, answers its questions, and sends the ravens.

```
Friends (Discord DMs, #requests)
        │
   maester  (Claude tool-use agent, FastAPI for webhooks, SQLite)
        │
 ┌──────┼──────────┬──────────┬──────────┬──────────┬──────────┐
Seerr  Sonarr    Radarr    SABnzbd   Tautulli    Plex     Wizarr
       (x2)      (x2)      (x2)      (x2)
```

## Contents

- [What it does](#what-it-does)
- [Roadmap and tracker](#roadmap-and-tracker)
- [Tech stack](#tech-stack)
- [Structure](#structure)
- [Getting started](#getting-started)
- [Docs](#docs)

## What it does

| A friend says                                  | maester does                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "get Dune in 4K"                               | Finds the title through Seerr, asks which one if ambiguous, requests it as that friend, queues 4K for approval    |
| "is The Bear on the server?"                   | Reports the seasons and versions present, with a link that opens Plex                                              |
| "where's my request?"                          | Merges Seerr status, the arr queue and SABnzbd progress into one ETA                                               |
| "this won't play"                              | Finds their session, checks the client first (codec, Dolby Vision, subtitle burn-in), probes the file, then replaces it through a confirmed, capped, audited flow |
| "the Dune on the server is a cam"              | Records it as a Seerr issue, and swaps the copy once a second friend reports it                                    |
| "S02E07 of The Bear is missing"                | Searches the missing episodes on the host that owns the show; tells the admin about whole missing seasons         |
| "it's laggy"                                   | Reads the live stream from Tautulli (transcode, relay, bandwidth), server load, and gives one concrete fix         |
| "is Plex down?"                                | Pings every service behind the server at once and says what is up and what is down                                |
| "which Dune should I watch on hotel wifi?"     | Lists each version's bitrate and recommends the one the connection carries; tells the admin about much-streamed remuxes |
| "can my brother get access?"                   | Puts an invite request in the admin queue; on approval, issues a Wizarr invite                                     |

For the admin, in one private channel:

- every approval (4K and pending requests, `/link` requests, replacements over the daily cap) with Approve/Deny buttons, and `/pending` to see them all again
- a daily digest: requests, issues, replacements, stalled or failed downloads per host, free space and when each volume fills
- a weekly NAS report, anything degraded at the top
- stalled downloads blocklisted and searched again on their own, and 4K requests held while their volume is nearly full
- "why did Dune fail?" answered from SABnzbd and the arr's history
- `/kill`, `/tier`, `/audit`, `/forecast`, and `/maintenance`, which holds requests and replacements until the stack is back

Everything the bot can change goes through a small set of scoped tools with permission tiers and button confirmations. There is no shell, no generic API passthrough.

## Roadmap and tracker

Work is tracked in [GitHub Issues](https://github.com/codebend3r/maester/issues): one issue per epic (label `epic`) with stories attached as sub-issues, milestones M1 to M5 for phases, and the [maester roadmap board](https://github.com/users/codebend3r/projects/1) for status.

The catalog of epics and stories lives in [`scripts/catalog.py`](scripts/catalog.py). [`docs/roadmap.md`](docs/roadmap.md) and the issues are both rendered from it by `scripts/sync_tracker.py`, so edit the catalog and re-run the sync rather than editing either by hand.

The board follows the issues. `uv run python scripts/sync_board.py` lists where it has drifted (status, fields, missing items, finished epics, roadmap checkboxes), and `--apply` fixes it.

| Milestone | Goal                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| M1        | Walking skeleton: a friend can DM the bot and it answers using a read-only tool     |
| M2        | Requests in 1080p and 4K through Seerr                                              |
| M3        | Troubleshooting: playback diagnosis, guarded replacement, lag explanation           |
| M4        | Admin and onboarding: approvals, digests, Wizarr invites                            |
| M5        | Engagement: recommendations, weekly posts, Plex Wrapped                             |

## Tech stack

| Part      | Choice                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| Language  | Python 3.12, `uv`, `ruff`, `pytest`                                                             |
| LLM       | Anthropic Python SDK, Messages API tool-use loop, `claude-opus-5-5` by default, prompt caching  |
| Chat      | `discord.py` (DMs, a requests channel, buttons for confirmation and choice)                     |
| Web       | FastAPI for the Seerr webhook plus `/health` (a Tautulli webhook comes later)                   |
| Storage   | SQLite on a `/data` volume: user links, conversations, audit log, reports, pending actions      |
| Services  | Seerr, Sonarr, Radarr, SABnzbd, Tautulli, Plex, Wizarr over their REST APIs                     |
| Hosting   | Docker Compose on a Synology NAS                                                                 |

## Structure

```
maester/
├── maester/
│   ├── agent/          tool-use loop, tool registry, guardrails, prompts
│   ├── clients/        one httpx client per service, each with an in-memory fake
│   ├── tools/          the scoped tools the model can call, grouped by area
│   ├── playback/       playback reports: plays, player limits, file health, the replace flow
│   ├── perf/           lag: host load, the speed test, which version a connection carries
│   ├── chat/           discord bot, views (buttons, pickers), identity
│   ├── web/            FastAPI app: webhooks and /health
│   ├── jobs/           scheduled work: the digest, the sweeper, space samples, the NAS report
│   ├── store/          SQLite schema, migrations, audit log
│   ├── evals/          the eval runner and the fake world a case runs in
│   ├── app.py          wires settings into clients, store, agent, bot and web app
│   ├── config.py       environment, read once
│   └── *.py            shared modules: service registry, title ownership, media, notices
├── evals/cases/        scripted conversations against the fakes, one YAML file each
├── tests/
├── scripts/            tracker catalog and sync, board setup and sync, NAS deploy, version bump
└── docs/
```

Still to come: `maester/guides/` for the device setup guides the model answers from (E7).

## Getting started

**Prerequisites.** [uv](https://docs.astral.sh/uv/) (`brew install uv`); `uv sync` fetches Python 3.12 from `.python-version` if it is missing. You also need an Anthropic API key, a Discord bot (below), and the URLs and API keys of the services. The file health check needs `ffmpeg` on your `PATH`; the Docker image ships it, along with Ookla's `speedtest` CLI. Outside Docker, leave `SPEEDTEST_HOST` empty so the speed test is off.

```bash
git clone https://github.com/codebend3r/maester.git
cd maester
cp .env.example .env     # fill in service URLs, API keys, Discord and Anthropic tokens
uv sync
uv run lefthook install  # git hooks: ruff check --fix and ruff format on staged files
uv run maester           # starts the Discord bot and the web app on one loop
```

Checks: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`. Evals: `uv run maester-eval` (real model against fake services) or `uv run maester-eval --model fake`.

**Discord setup.** Create an application at discord.com/developers, add a bot, turn on the *Message Content* and *Server Members* privileged intents, and invite it with the `bot` and `applications.commands` scopes (permissions: View Channels, Send Messages, Read Message History, Embed Links). Put the bot token, your server id, the requests and admin channel ids, and the trusted and admin role ids in `.env`. Friends DM the bot or mention it in the requests channel; `/link`, `/whoami` and `/forget` are slash commands. The admin's commands are `/tier`, `/kill`, `/audit`, `/pending`, `/forecast` and `/maintenance`; approvals, the digest and the NAS report post in the admin channel, and maintenance announcements in the requests channel.

**Seerr and the arrs.** maester works out which host holds a title's 1080p or 4K copy from Seerr's own records, so each Radarr and Sonarr in Seerr's settings must use the same address (host, port and base path) as its `RADARR_<HOST>_URL` or `SONARR_<HOST>_URL` here. A server Seerr reaches by another name is refused rather than guessed.

**Seerr webhook.** In Seerr, Settings, Notifications, Webhook: set the URL to `http://<maester host>:8020/webhooks/seerr`, set *Authorization Header* to the value of `SEERR_WEBHOOK_SECRET`, keep the default JSON payload, and tick *Request Pending Approval*, *Request Approved*, *Request Declined*, *Request Available*, *Issue Resolved* and *Issue Reopened*. Every request waiting on approval then reaches the admin channel with buttons, wherever it was made; friends get a DM with a Plex link when their request is ready (a thumbs-down on it reports a problem); and resolving a playback report's issue in Seerr closes the report. Other ticked types are acknowledged and ignored.

**File health check.** The container mounts the media shares read-only (`docker-compose.yml`) and `MEDIA_ROOTS` lists them; nothing outside them is read. When Sonarr or Radarr report paths under other names than the mounts, map them with `MEDIA_PATH_MAP`.

**Deploy.** `docs/nas-deployment.md` covers running it as a container on the NAS.

## Docs

- [`docs/roadmap.md`](docs/roadmap.md): milestones, epics, stories, with issue links
- [`docs/architecture.md`](docs/architecture.md): components, instance registry, permission tiers, guardrails
- [`docs/nas-deployment.md`](docs/nas-deployment.md): first boot, updates, media mounts and data for the container on the NAS
- [`docs/deferred.md`](docs/deferred.md): work left out of each epic's PR, why, and where it lands
