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
| "it's laggy"                                   | Reads the live stream from Tautulli (transcode, relay, bandwidth), server load, and gives one concrete fix         |
| "can my brother get access?"                   | Puts an invite request in the admin queue; on approval, issues a Wizarr invite                                     |

Everything the bot can change goes through a small set of scoped tools with permission tiers and button confirmations. There is no shell, no generic API passthrough.

## Roadmap and tracker

Work is tracked in [GitHub Issues](https://github.com/codebend3r/maester/issues): one issue per epic (label `epic`) with stories attached as sub-issues, milestones M1 to M5 for phases, and the [maester roadmap board](https://github.com/users/codebend3r/projects/1) for status.

The catalog of epics and stories lives in [`scripts/catalog.py`](scripts/catalog.py). [`docs/roadmap.md`](docs/roadmap.md) and the issues are both rendered from it by `scripts/sync_tracker.py`, so edit the catalog and re-run the sync rather than editing either by hand.

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
| Web       | FastAPI for Seerr and Tautulli webhooks plus `/health`                                          |
| Storage   | SQLite on a `/data` volume: user links, conversations, audit log, reports, pending actions      |
| Services  | Seerr, Sonarr, Radarr, SABnzbd, Tautulli, Plex, Wizarr over their REST APIs                     |
| Hosting   | Docker Compose on a Synology NAS                                                                 |

## Structure

Planned layout; it fills in as the epics land.

```
maester/
├── maester/
│   ├── agent/          tool-use loop, tool registry, guardrails, prompts
│   ├── clients/        one httpx client per service, each with an in-memory fake
│   ├── tools/          the scoped tools the model can call, grouped by area
│   ├── chat/           discord bot, views (buttons, pickers), identity
│   ├── web/            FastAPI app: webhooks and /health
│   ├── jobs/           scheduled work: digests, sweeps, reminders
│   ├── store/          SQLite schema, migrations, audit log
│   ├── guides/         device setup guides the model answers from
│   └── config.py       environment, read once
├── evals/              scripted conversations against the fakes
├── tests/
├── scripts/            catalog.py, sync_tracker.py, deploy-nas.sh
└── docs/
```

## Getting started

```bash
git clone https://github.com/codebend3r/maester.git
cd maester
cp .env.example .env     # fill in service URLs, API keys, Discord and Anthropic tokens
uv sync
uv run lefthook install  # git hooks: ruff check --fix and ruff format on staged files
uv run maester           # starts the Discord bot and the web app on one loop
```

Checks: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`. Evals: `uv run maester-eval` (real model against fake services) or `uv run maester-eval --model fake`.

**Discord setup.** Create an application at discord.com/developers, add a bot, turn on the *Message Content* and *Server Members* privileged intents, and invite it with the `bot` and `applications.commands` scopes (permissions: View Channels, Send Messages, Read Message History, Embed Links). Put the bot token, your server id, the requests and admin channel ids, and the trusted and admin role ids in `.env`. Friends DM the bot or mention it in the requests channel; `/link`, `/whoami` and `/forget` are slash commands; the admin sets or clears a member's tier with `/tier`.

**Deploy.** `docs/nas-deployment.md` covers running it as a container on the NAS.

## Docs

- [`docs/roadmap.md`](docs/roadmap.md): milestones, epics, stories, with issue links
- [`docs/architecture.md`](docs/architecture.md): components, instance registry, permission tiers, guardrails
