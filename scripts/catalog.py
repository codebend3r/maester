"""The roadmap as data: milestones, epics and stories.

Both ``docs/roadmap.md`` and the GitHub issues are rendered from this file by
``scripts/sync_tracker.py``, so the doc and the tracker cannot drift apart.
Edit here, then re-run the sync.
"""

MILESTONES = [
    (
        "M1",
        "Walking skeleton",
        "A friend can chat with luwin and it answers using a read-only tool.",
    ),
    ("M2", "Requests", "Friends request movies and shows in 1080p and 4K through luwin."),
    (
        "M3",
        "Troubleshooting",
        "Playback problems are diagnosed before anything is replaced; lag is explained with live data.",
    ),
    ("M4", "Admin and onboarding", "Approvals, digests and Wizarr invites run from chat."),
    ("M5", "Engagement", "luwin gives friends reasons to come back."),
]

# Each epic: key, title, milestone, area label, summary, stories.
# Each story: title, size (S/M/L), priority (P0/P1/P2), user story, acceptance criteria.
EPICS = [
    {
        "key": "E0",
        "title": "Foundation",
        "milestone": "M1",
        "area": "infra",
        "summary": "Project skeleton, configuration, service clients, storage, container and CI. Everything later epics build on.",
        "stories": [
            {
                "title": "Project scaffold",
                "size": "S",
                "priority": "P0",
                "story": "As the maintainer, I want a Python 3.12 project with uv, ruff, pytest and pre-commit so that every later change has lint and tests from day one.",
                "criteria": [
                    "`uv sync` installs the project and dev dependencies",
                    "`uv run ruff check .` and `uv run pytest` pass on an empty package",
                    "Package layout is `maester/` with `maester/__main__.py` as the entrypoint",
                    "pre-commit runs ruff format and ruff check on staged files",
                ],
            },
            {
                "title": "Config and secrets loading",
                "size": "S",
                "priority": "P0",
                "story": "As the maintainer, I want configuration read from the environment once, with a fail-fast on missing required values, so that a misconfigured container dies on boot naming what is missing.",
                "criteria": [
                    "`maester/config.py` reads every variable in one place; other modules import from it",
                    "`require(*names)` raises naming every missing variable at once (port from wizteros `config.py`)",
                    "`.env.example` lists every variable with a comment",
                    "Tests cover the happy path and the missing-variable error",
                ],
            },
            {
                "title": "Service instance registry",
                "size": "M",
                "priority": "P0",
                "story": "As the maintainer, I want Sonarr, Radarr, SABnzbd and Tautulli addressed by host name (meleys, vermithor) so that no tool ever acts on the wrong stack.",
                "criteria": [
                    "Registry loads named instances from env (`SONARR_MELEYS_URL`, `SONARR_VERMITHOR_URL`, ...)",
                    "Seerr, Plex and Wizarr are singletons",
                    "Every tool that touches an arr instance takes a `host` argument and logs it",
                    "A media item resolves to its owning host by path prefix or arr root folder",
                ],
            },
            {
                "title": "API clients with fakes",
                "size": "L",
                "priority": "P0",
                "story": "As a developer, I want thin httpx clients for Seerr, Sonarr, Radarr, Tautulli, Plex, Wizarr and SABnzbd, each with an in-memory fake, so that tools and evals run without a live stack.",
                "criteria": [
                    "One module per service under `maester/clients/`, async, with typed return dataclasses",
                    "Each client has a `Fake*` sibling implementing the same interface",
                    "Wizarr client ports the wizteros quirks (expiry honors only 1/7/30 days; `used_by` repr parsing)",
                    "Recorded JSON fixtures under `tests/fixtures/` for at least one call per client",
                ],
            },
            {
                "title": "SQLite store and audit log",
                "size": "M",
                "priority": "P0",
                "story": "As the maintainer, I want every tool call recorded with who asked, the arguments and the result, so that any action the bot took can be traced later.",
                "criteria": [
                    "SQLite file on `/data`, schema created on boot, migrations numbered",
                    "Tables: `users` (chat id to Plex/Seerr identity, tier), `conversations`, `audit_log`, `reports`",
                    "`audit.record(user, tool, args, result, ok)` is called by the tool runner, never by tools",
                    "An admin command can dump the last N audit rows",
                ],
            },
            {
                "title": "Container, compose and NAS deploy",
                "size": "M",
                "priority": "P0",
                "story": "As the maintainer, I want a Dockerfile, a compose file and a deploy script for Meleys so that the bot runs next to stripe-bridge with one command.",
                "criteria": [
                    "`python:3.12-slim` image, non-root user, `/data` volume",
                    "`docker-compose.yml` with `env_file: .env`, restart policy and a `/health` healthcheck",
                    "`scripts/deploy-nas.sh` rsyncs to `/volume1/docker/maester` over the SMB share, excluding `.env` and `maester-data/` (pattern from wizteros)",
                    "`docs/nas-deployment.md` documents first boot and updates",
                ],
            },
            {
                "title": "CI on pull requests",
                "size": "S",
                "priority": "P1",
                "story": "As the maintainer, I want lint and tests to run on every PR so that a red check blocks a merge.",
                "criteria": [
                    "`.github/workflows/pull-request-checks.yml` runs ruff check, ruff format --check and pytest",
                    "Concurrency cancels superseded runs on the same branch",
                    "Branch protection on `main` requires the check",
                ],
            },
        ],
    },
    {
        "key": "E1",
        "title": "Agent core",
        "milestone": "M1",
        "area": "agent",
        "summary": "The Claude tool-use loop, the tool registry with permission tiers, memory, guardrails and an eval harness.",
        "stories": [
            {
                "title": "Tool-use loop on the Messages API",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want the bot to answer in natural language and call tools when it needs data, so that I can talk to it instead of learning commands.",
                "criteria": [
                    "`maester/agent/loop.py` runs the Messages API with `tools`, executes `tool_use` blocks and feeds `tool_result` back until `end_turn`",
                    "System prompt and tool definitions carry `cache_control` for prompt caching",
                    "Streaming is used so long replies start rendering early",
                    "Model id comes from config, default `claude-opus-5-5`",
                    "Max tool iterations per turn is capped and the cap is logged",
                ],
            },
            {
                "title": "Tool registry with permission tiers",
                "size": "M",
                "priority": "P0",
                "story": "As the maintainer, I want each tool declared with a minimum tier (friend, trusted, admin) so that a friend never even sees a tool they cannot use.",
                "criteria": [
                    "`@tool(tier=..., destructive=...)` decorator registers name, JSON schema and handler",
                    "The tool list sent to the model is filtered by the caller's tier",
                    "A call to a tool outside the tier is rejected server-side too, and audited",
                    "No shell, HTTP passthrough or filesystem tools exist in the registry",
                ],
            },
            {
                "title": "Per-user conversation memory",
                "size": "S",
                "priority": "P1",
                "story": 'As a friend, I want the bot to remember what we were just talking about so that "the second one" or "yes, that one" works.',
                "criteria": [
                    "History stored per user in SQLite, trimmed to a token budget",
                    "A forget command or an idle timeout clears the thread",
                    "Tool results larger than a threshold are summarized before being stored",
                ],
            },
            {
                "title": "Guardrails for destructive tools",
                "size": "M",
                "priority": "P0",
                "story": "As the maintainer, I want destructive actions confirmed by a button press outside the model, plus rate and cost limits per user, so that a crafted message cannot make the bot delete files or run up a bill.",
                "criteria": [
                    "Tools marked `destructive=True` return a pending action; the chat layer renders Confirm/Cancel and only the original user can confirm",
                    "Per-user limits: messages per hour, tool calls per day, token spend per day; exceeding them replies with a friendly message",
                    "Prompt-injection eval case: content inside tool results is treated as data, and the system prompt says so",
                    "A global kill switch disables destructive tools instantly",
                ],
            },
            {
                "title": "Eval harness",
                "size": "M",
                "priority": "P1",
                "story": "As a developer, I want scripted conversations run against fake services so that prompt or tool changes are checked before deploy.",
                "criteria": [
                    "`evals/` holds YAML cases: messages in, expected tool calls and reply assertions out",
                    "Cases cover: simple request, ambiguous title, 4K request by a friend tier, injection attempt, replace flow with and without confirmation",
                    "`uv run maester-eval` runs them and prints pass/fail per case",
                ],
            },
        ],
    },
    {
        "key": "E2",
        "title": "Chat and identity",
        "milestone": "M1",
        "area": "chat",
        "summary": "luwin's first chat surface, account linking to Plex/Seerr users, tiers, and interactive buttons. The surface has since been removed so luwin can become its own app.",
        "stories": [
            {
                "title": "First chat surface with DMs and a requests channel",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to message luwin directly or mention it in the requests channel and get an answer, so that I can use it where the group already talks.",
                "criteria": [
                    "A chat client that answers direct messages and mentions in configured channels",
                    "Typing indicator while the agent works",
                    "Replies over 2000 chars are split on paragraph boundaries",
                    "Errors reply with a short apology and are logged with the trace id",
                ],
            },
            {
                "title": "Account linking",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to link my chat account to my Plex user once so that requests are made as me and luwin knows what I have watched.",
                "criteria": [
                    "Linking asks for the Plex email or username, matches against Seerr users, and stores the pair pending admin confirmation",
                    "Admin gets an approve/deny button; on approve the link becomes active",
                    "Unlinked users get the unlinked-user flow",
                    "Asking who I am shows the linked identity and tier",
                ],
            },
            {
                "title": "Tiers for friends, trusted friends and the admin",
                "size": "S",
                "priority": "P1",
                "story": "As the maintainer, I want tiers (friend, trusted, admin) so that what someone can do follows who they are to the server.",
                "criteria": [
                    "Each tier is resolved from config and the store",
                    "Tier is resolved on every message, never cached across tier changes",
                    "A stored override per user can raise or lower the tier from an admin command",
                ],
            },
            {
                "title": "Confirmation and choice buttons",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to pick from a short list of matches or confirm an action with a button so that I do not have to type exact titles.",
                "criteria": [
                    "A disambiguation view shows up to 5 options with year and poster thumbnail",
                    "Confirm/Cancel view times out after 5 minutes and only the asking user can press",
                    "Button results are fed back into the conversation as a tool result",
                ],
            },
            {
                "title": "Unlinked-user flow",
                "size": "S",
                "priority": "P1",
                "story": "As a newcomer, I want the bot to tell me how to get access when it does not know me, so that I am not stuck.",
                "criteria": [
                    "Unlinked users get a short explanation and how to link",
                    "If they have no Plex access at all, the reply points at the invite request flow (E7)",
                    "No tools other than help are exposed to unlinked users",
                ],
            },
        ],
    },
    {
        "key": "E3",
        "title": "Requests",
        "milestone": "M2",
        "area": "requests",
        "summary": "Searching, disambiguating and requesting movies and shows in 1080p and 4K through Seerr, with status and ready notifications.",
        "stories": [
            {
                "title": "Search and disambiguate titles",
                "size": "M",
                "priority": "P0",
                "story": 'As a friend, I want to say "get Dune" and be asked which one if there are several, so that the right title is requested.',
                "criteria": [
                    "`search_media(query)` tool calls Seerr search (TMDB) and returns id, type, title, year, overview, poster",
                    "Results already available or already requested are labeled as such",
                    "When more than one plausible match exists the bot presents the picker instead of guessing",
                    'Vague descriptions ("the heist movie with the guy from Severance") are handled by the model choosing search terms, then confirming',
                ],
            },
            {
                "title": "Request a movie in 1080p",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to request a movie and have it show up in Seerr under my name, so that my quotas and history apply.",
                "criteria": [
                    "`request_media(tmdb_id, type, is_4k=false)` posts to Seerr with the `X-API-User` header set to the linked user",
                    "Seerr quota or permission errors are explained in plain language",
                    "The reply includes the Seerr request id and whether it auto-approved",
                    "Audit log records the request",
                ],
            },
            {
                "title": "Request in 4K with admin approval",
                "size": "M",
                "priority": "P0",
                "story": "As a trusted friend, I want to ask for a 4K version and have it wait for the admin, so that 4K storage is used deliberately.",
                "criteria": [
                    "`is_4k=true` requests go to the 4K server or profile configured in Seerr",
                    "Friend tier is told 4K is trusted-only; trusted tier requests land in the admin approval queue (E6)",
                    "The bot explains the size trade-off when a 1080p copy already exists",
                ],
            },
            {
                "title": "TV requests by season",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to request all seasons, specific seasons, or only future episodes of a show, so that I get what I actually want.",
                "criteria": [
                    'Seasons parsed from natural language ("season 2 and 3", "just the latest", "everything")',
                    "Existing seasons on the server are excluded from the request and mentioned in the reply",
                    '"Follow future seasons" sets the show to monitored in the owning Sonarr',
                ],
            },
            {
                "title": "Availability lookup with a Plex deep link",
                "size": "S",
                "priority": "P0",
                "story": 'As a friend, I want to ask "is Dune on the server?" and get versions plus a link that opens Plex, so that I can start watching right away.',
                "criteria": [
                    "`check_availability(tmdb_id)` reports available versions (1080p, 4K, HEVC re-encode) from Seerr and Plex",
                    "Reply includes a `https://app.plex.tv/desktop/#!/server/<machine>/details?key=...` link",
                    "For TV, reports which seasons and how many episodes are present",
                ],
            },
            {
                "title": "Request status with an ETA",
                "size": "M",
                "priority": "P1",
                "story": 'As a friend, I want to ask "where\'s my request?" and get one answer combining Seerr, the arr queue and SABnzbd, so that I do not have to check three apps.',
                "criteria": [
                    "`request_status(user)` lists the user's open Seerr requests with state",
                    "For each, the owning host's Sonarr/Radarr queue and SABnzbd progress are merged into a percent and ETA",
                    "Stalled or failed downloads are called out with the reason from history",
                ],
            },
            {
                "title": "Ready notifications",
                "size": "M",
                "priority": "P1",
                "story": "As a friend, I want a DM when my request is ready to watch, so that I do not have to keep asking.",
                "criteria": [
                    "FastAPI route receives the Seerr webhook (media available event) with a shared secret",
                    "The requester is resolved to their chat account and gets a DM with title, version and Plex link",
                    "Duplicate webhooks do not produce duplicate DMs",
                    "Reporting a problem from the DM opens a playback report (E4)",
                ],
            },
            {
                "title": "Collection requests",
                "size": "S",
                "priority": "P2",
                "story": 'As a friend, I want to say "get all the Mission Impossible movies" and have every entry requested, so that franchises are one ask.',
                "criteria": [
                    "TMDB collection lookup through Seerr; the picker shows the entries with availability",
                    "One request per missing entry, summarized in a single reply",
                    "Friend-tier quotas still apply; the bot explains when the collection exceeds them",
                ],
            },
            {
                "title": "Dub-aware anime requests",
                "size": "M",
                "priority": "P1",
                "story": 'As a friend who watches dubbed anime, I want to ask for "Frieren, English dub" and be told up front if only Japanese audio is available, so that I am not surprised after it downloads.',
                "criteria": [
                    "Anime is detected from TMDB keywords or genre and the Sonarr series type",
                    "The bot checks existing files for an English audio track (same logic as the anime dub audit) and reports coverage per season",
                    "A dub preference is stored on the request and passed as a tag to Sonarr so a dual-audio profile is used when one exists",
                ],
            },
        ],
    },
    {
        "key": "E4",
        "title": "Playback issues",
        "milestone": "M3",
        "area": "playback",
        "summary": 'Diagnose "it won\'t play" reports before touching anything, then replace the file through a guarded flow when it is really broken.',
        "stories": [
            {
                "title": "Identify the item being reported",
                "size": "S",
                "priority": "P0",
                "story": 'As a friend, I want to say "this won\'t play" without naming the file, so that reporting a problem takes one message.',
                "criteria": [
                    "`recent_sessions(user)` pulls the user's current and last few sessions from Tautulli",
                    'The bot confirms the item ("Dune (2021), the 4K version?") before doing anything',
                    "If nothing recent exists, it asks for the title and uses the search picker",
                ],
            },
            {
                "title": "Diagnose the client side first",
                "size": "L",
                "priority": "P0",
                "story": "As the maintainer, I want the bot to check whether a playback failure is the client's fault before blaming the file, so that working files are not deleted.",
                "criteria": [
                    "`session_diagnosis(session)` reports transcode decision, transcode reasons, container/video/audio codecs and the client platform from Tautulli",
                    "Known client limits are encoded (Dolby Vision profile 7, HEVC on older devices, TrueHD/DTS passthrough, PGS subtitle burn-in)",
                    "The reply gives the friend a concrete client-side fix when one applies",
                    "Only when no client cause is found does the flow move to the file health check",
                ],
            },
            {
                "title": "File health check",
                "size": "M",
                "priority": "P0",
                "story": 'As the maintainer, I want the bot to probe and partially decode the file on a read-only mount, so that "broken" is measured rather than assumed.',
                "criteria": [
                    "Media shares mounted read-only in the container",
                    '`probe_file(path)` runs ffprobe and a short decode; "freezes at 1:12:30" runs the decode around that timestamp',
                    "Result is one of ok, truncated, corrupt, unreadable, with the evidence",
                    "Probe time is capped and runs in a worker so the bot stays responsive",
                ],
            },
            {
                "title": "Open a Seerr issue for every report",
                "size": "S",
                "priority": "P1",
                "story": "As the maintainer, I want every report recorded as a Seerr issue, so that there is an audit trail in a tool I already use.",
                "criteria": [
                    "`open_issue(media, type, message)` creates the issue as the reporting user",
                    "The issue body includes the diagnosis summary and the bot's decision",
                    "Resolving the issue in Seerr updates the report row in SQLite via webhook",
                ],
            },
            {
                "title": "Guarded replace flow",
                "size": "L",
                "priority": "P0",
                "story": "As the maintainer, I want a bad file blocklisted, deleted and re-searched on the right host in one confirmed step, so that replacements are consistent and reversible in intent.",
                "criteria": [
                    "`replace_media(item, host, reason)` is destructive: requires the button confirmation from E1",
                    "Steps: mark the grab failed in arr history (blocklists the release), delete the file via `moviefile`/`episodefile`, run `MoviesSearch`/`EpisodeSearch`",
                    "Runs only when the health check failed or two or more distinct users reported the same item",
                    "Every step is audited and the friend is told what happened and roughly when to retry",
                ],
            },
            {
                "title": "Replacement guardrails",
                "size": "S",
                "priority": "P0",
                "story": "As the maintainer, I want a daily cap on replacements, a notification on every delete and a kill switch, so that a bad day cannot empty a library.",
                "criteria": [
                    "Configurable cap per day; hitting it queues the request for admin approval instead",
                    "The admin gets a message per delete with the file path, size and reason",
                    "The E1 kill switch disables `replace_media` immediately",
                ],
            },
            {
                "title": "Wrong-file reports",
                "size": "M",
                "priority": "P1",
                "story": "As a friend, I want to report that the file is the wrong movie, a cam, or has hardcoded foreign subs, so that the copy is swapped even though it technically plays.",
                "criteria": [
                    "Report types: wrong_title, wrong_episode, cam, hardcoded_subs, other",
                    "These go through the replace flow with the reason tagged in the blocklist entry",
                    "Repeated reports from one release group are counted for the bad-release detection story (E6)",
                ],
            },
            {
                "title": "Subtitle and audio issue reports",
                "size": "M",
                "priority": "P2",
                "story": "As a friend, I want to report missing subtitles, out-of-sync audio or a missing English dub, so that the problem is tracked even before it can be auto-fixed.",
                "criteria": [
                    "Reports are recorded and a Seerr issue opened with the track listing from ffprobe",
                    '"Does this have Spanish subs?" is answered from the track listing',
                    "Bazarr search or sync is triggered when Bazarr is configured; otherwise the admin is notified",
                ],
            },
            {
                "title": "Missing-episode reports",
                "size": "S",
                "priority": "P1",
                "story": 'As a friend, I want to say "S02E07 of The Bear is missing" and have the gap searched, so that I do not have to wait for the admin to notice.',
                "criteria": [
                    "`find_gaps(series)` compares Sonarr's episode list with files present on the owning host",
                    "Only the missing episodes are searched, and the reply lists them",
                    "Whole-season gaps are surfaced to the admin rather than searched blindly",
                ],
            },
        ],
    },
    {
        "key": "E5",
        "title": "Performance diagnostics",
        "milestone": "M3",
        "area": "perf",
        "summary": "Explain lag and choppy playback with live session, server and network data, and give a concrete fix.",
        "stories": [
            {
                "title": "Live session report with relay detection",
                "size": "M",
                "priority": "P0",
                "story": 'As a friend, I want to say "it\'s laggy" and be told what my stream is actually doing, so that I know whether it is me, the server or the file.',
                "criteria": [
                    "`session_report(user)` from Tautulli `get_activity`: bitrate, direct play/stream/transcode, LAN vs WAN, relay flag, client and player",
                    "Relayed streams are called out explicitly with the relay bandwidth cap",
                    "The report names the host serving the stream",
                ],
            },
            {
                "title": "Server load per host",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want to know if the server is busy when things are slow, so that I can wait or pick a lighter version.",
                "criteria": [
                    "Active streams, transcodes and total outbound bandwidth per host from Tautulli",
                    "CPU and memory per NAS from the fleet monitor API where available",
                    "Reply says whether load is a plausible cause",
                ],
            },
            {
                "title": "On-demand speed test",
                "size": "S",
                "priority": "P1",
                "story": "As a friend, I want the bot to check the server's upload speed when I report lag, so that ISP problems are visible.",
                "criteria": [
                    "`speed_test(host)` runs a speed test from the NAS, cached for 10 minutes and rate-limited",
                    "Result compared against the sum of current stream bitrates",
                    "Reply states headroom in plain language",
                ],
            },
            {
                "title": "Advice generation",
                "size": "M",
                "priority": "P0",
                "story": "As a friend, I want one concrete fix instead of a wall of stats, so that I can get back to watching.",
                "criteria": [
                    "Findings map to fixes: disable relay, set remote quality to Original or lower it, turn subtitles off, pick the 1080p or HEVC version, wait for the server",
                    'The stats are available on request ("show me the details")',
                    "Advice text is covered by eval cases",
                ],
            },
            {
                "title": "Service health checks",
                "size": "S",
                "priority": "P1",
                "story": 'As a friend, I want to ask "is Plex down?" and get a real answer, so that I do not message the admin at midnight.',
                "criteria": [
                    "`service_health()` pings Plex, Seerr, both Sonarr/Radarr/SABnzbd/Tautulli instances and Wizarr",
                    "Reply lists what is up and down and any known maintenance window (E6)",
                    "Health is cached for 60 seconds",
                ],
            },
            {
                "title": "Version picking for slow connections",
                "size": "S",
                "priority": "P2",
                "story": "As a friend on a bad connection, I want to be told which version of a title will stream well, so that I do not start a 4K remux over hotel wifi.",
                "criteria": [
                    "For a title with several versions, the reply lists bitrate per version and recommends one for the measured connection",
                    "Heavy remuxes watched often over WAN are flagged to the admin as re-encode candidates",
                ],
            },
        ],
    },
    {
        "key": "E6",
        "title": "Admin console",
        "milestone": "M4",
        "area": "admin",
        "summary": "Everything the admin does from chat: approvals, digests, limits, stalled downloads, log reading and NAS health.",
        "stories": [
            {
                "title": "Approval queue with buttons",
                "size": "M",
                "priority": "P0",
                "story": "As the admin, I want 4K requests, invites and over-cap replacements to land in one channel with approve/deny buttons, so that I can act from my phone.",
                "criteria": [
                    "Pending actions table in SQLite with type, requester, payload, decision",
                    "A message to the admin per pending action; Approve/Deny resolves it and notifies the requester",
                    "Approvals for Seerr requests call the Seerr approve endpoint",
                ],
            },
            {
                "title": "Daily digest",
                "size": "M",
                "priority": "P1",
                "story": "As the admin, I want a morning summary of requests, issues, replacements, failed downloads and disk space, so that I see the state of the server in one message.",
                "criteria": [
                    "A scheduled job sends it to the admin at a configured time",
                    "Sections: new requests, open issues, replacements, stalled or failed downloads per host, free space per volume",
                    "Empty sections are omitted",
                ],
            },
            {
                "title": "Admin commands",
                "size": "S",
                "priority": "P0",
                "story": "As the admin, I want commands for the kill switch, tier overrides and the audit log, so that I can intervene without SSH.",
                "criteria": [
                    "`/kill on|off`, `/tier @user trusted`, `/audit [n]`, `/pending`",
                    "Commands are admin-tier only and audited themselves",
                ],
            },
            {
                "title": "Storage-aware limits",
                "size": "S",
                "priority": "P1",
                "story": "As the admin, I want 4K requests paused automatically when a volume is nearly full, so that a download cannot wedge a NAS.",
                "criteria": [
                    "Free space per root folder from each arr instance",
                    "Threshold from config; over it, 4K requests are queued for approval and the friend is told why",
                ],
            },
            {
                "title": "Stalled download sweeper",
                "size": "M",
                "priority": "P1",
                "story": "As the admin, I want stuck queue items detected and re-searched, so that requests do not sit forever.",
                "criteria": [
                    "Scheduled job scans both hosts' queues for items stalled longer than a threshold",
                    "Stalled items are removed with blocklist and re-searched; the digest reports them",
                    "Items that stall twice are surfaced for manual action instead",
                ],
            },
            {
                "title": "Disk usage forecast",
                "size": "S",
                "priority": "P2",
                "story": "As the admin, I want to know roughly when each volume fills at the current request rate, so that I can plan drives before it hurts.",
                "criteria": [
                    "Daily free-space samples per volume stored in SQLite",
                    "`/forecast` reports days-until-full per volume from a linear fit over the last 30 days",
                    "Digest includes the forecast when under 30 days",
                ],
            },
            {
                "title": "Bad-release detection",
                "size": "S",
                "priority": "P2",
                "story": "As the admin, I want to be told when one release group keeps producing reported files, so that I can block it in the arr profiles.",
                "criteria": [
                    "Reports and replacements record the release group parsed from the filename",
                    "When a group crosses a threshold in 30 days the digest suggests a custom format or blocklist rule",
                ],
            },
            {
                "title": "Download log reading",
                "size": "M",
                "priority": "P1",
                "story": 'As the admin, I want to ask "why did Dune fail?" and get a plain-English answer from SABnzbd and arr history, so that I do not have to read three logs.',
                "criteria": [
                    "`download_history(item, host)` pulls SABnzbd history and arr events for the item",
                    "The model summarizes the failure cause and the next action",
                    "Admin tier only",
                ],
            },
            {
                "title": "Maintenance windows",
                "size": "S",
                "priority": "P2",
                "story": "As the admin, I want to announce a restart and have the bot hold requests until the stack is back, so that friends are not confused by failures.",
                "criteria": [
                    "`/maintenance start|end [message]` posts an announcement and sets a flag",
                    "During maintenance, request and replace tools reply that they will run afterwards, and the queued work runs at end",
                ],
            },
            {
                "title": "Weekly NAS health report",
                "size": "M",
                "priority": "P2",
                "story": "As the admin, I want a weekly SMART, temperature and volume report across all five NASes, so that failing drives are caught early.",
                "criteria": [
                    "Data from the fleet monitor API where present, otherwise over SSH using the synology helper pattern",
                    "Sent to the admin with anything degraded at the top",
                ],
            },
        ],
    },
    {
        "key": "E7",
        "title": "Onboarding and accounts",
        "milestone": "M4",
        "area": "onboarding",
        "summary": "Wizarr invites, device setup help, access changes and expiry reminders.",
        "stories": [
            {
                "title": "Invite requests through Wizarr",
                "size": "M",
                "priority": "P0",
                "story": "As a trusted friend, I want to ask for access for someone else and have the admin approve it, so that new people are onboarded without a group chat thread.",
                "criteria": [
                    "`request_invite(for_whom, note)` creates a pending action in the approval queue",
                    "On approval the Wizarr client creates an invite with the configured expiry and libraries",
                    "The invite link is sent to the requester to forward, and the expiry is stated",
                ],
            },
            {
                "title": "Device setup help",
                "size": "S",
                "priority": "P1",
                "story": "As a newcomer, I want setup instructions for my TV or streaming stick, including how to turn off relay and set quality, so that my first stream works.",
                "criteria": [
                    "Guides for Apple TV, Roku, Fire TV, Android TV, iOS/Android, web, stored as markdown under `maester/guides/`",
                    "The model answers from the guides, not from memory",
                ],
            },
            {
                "title": "Library and 4K access requests",
                "size": "S",
                "priority": "P1",
                "story": "As a friend, I want to ask for access to another library or the 4K tier and have it go to the admin, so that access changes are one message.",
                "criteria": [
                    "Pending action with the requested change; on approval the Wizarr or Plex share is updated and, for 4K, the tier raised",
                ],
            },
            {
                "title": "Access expiry reminders",
                "size": "S",
                "priority": "P2",
                "story": "As a friend, I want a reminder before my access expires, so that I am not cut off mid-season.",
                "criteria": [
                    "Daily job checks Wizarr user expiries and DMs the user at 7 and 1 days out",
                    "Reminder text is configurable and points at the contribution link if one exists",
                ],
            },
        ],
    },
    {
        "key": "E8",
        "title": "Engagement",
        "milestone": "M5",
        "area": "engagement",
        "summary": "Recommendations, digests, stats and social features that give friends reasons to come back.",
        "stories": [
            {
                "title": "Personal recommendations",
                "size": "M",
                "priority": "P1",
                "story": "As a friend, I want suggestions based on what I have watched, preferring what is already on the server, so that I find something tonight.",
                "criteria": [
                    "`watch_history(user)` from Tautulli feeds the model with genres, recent titles and ratings",
                    "Suggestions that are on the server come with a Plex link; others come with an offer to request",
                ],
            },
            {
                "title": "Weekly newly-added post",
                "size": "S",
                "priority": "P1",
                "story": "As a friend, I want a weekly post of what landed on the server, so that I do not miss new additions.",
                "criteria": [
                    "Scheduled job lists additions from Tautulli's recently added, grouped by library, with posters",
                    "Posted to the configured channel",
                ],
            },
            {
                "title": "Plex Wrapped",
                "size": "M",
                "priority": "P2",
                "story": "As a friend, I want a yearly summary of my watching, so that I can share it with the group.",
                "criteria": [
                    "`/wrapped [year]` builds hours watched, top shows and movies, top genres and longest binge from Tautulli",
                    "Rendered as an embed with a shareable image",
                ],
            },
            {
                "title": "Auto-request from the Plex watchlist",
                "size": "M",
                "priority": "P2",
                "story": "As a friend, I want titles I add to my Plex watchlist requested automatically, so that I can use the Plex app as my request list.",
                "criteria": [
                    "Opt-in per user; watchlist synced via Seerr's watchlist feature or the plex.tv API",
                    "4K and quota rules still apply; the friend is DMed about anything that needs approval",
                ],
            },
            {
                "title": "Cleanup suggestions",
                "size": "S",
                "priority": "P2",
                "story": "As the admin, I want a list of titles nobody has watched in N months, so that I can free space deliberately.",
                "criteria": [
                    "Admin-only tool joins Tautulli history with library items and sizes",
                    "Output sorted by size, with the last watcher and date",
                ],
            },
            {
                "title": "What's new for me",
                "size": "S",
                "priority": "P2",
                "story": "As a friend, I want new additions filtered to the genres I actually watch, so that the weekly post is relevant to me.",
                "criteria": [
                    "Per-user genre profile from Tautulli history",
                    "`/new` returns the last two weeks of additions ranked by that profile",
                ],
            },
            {
                "title": "Resume nudges",
                "size": "S",
                "priority": "P2",
                "story": "As a friend, I want to be told when a show I was watching has a new season, so that I pick it back up.",
                "criteria": [
                    "Opt-in DM when a new season or episode lands for a show the user watched in the last 90 days",
                    "Respects quiet hours",
                ],
            },
            {
                "title": "Group picks",
                "size": "M",
                "priority": "P2",
                "story": "As a group of friends, we want to ask for something none of us have seen, so that movie night starts faster.",
                "criteria": [
                    "`/pick @a @b @c` intersects unwatched titles across the named users' Tautulli histories",
                    "Filters by genre or runtime from the message",
                ],
            },
            {
                "title": "Quiet hours and notification preferences",
                "size": "S",
                "priority": "P1",
                "story": "As a friend, I want to control when and what the bot DMs me, so that it is helpful instead of noisy.",
                "criteria": [
                    "`/notify` sets quiet hours and toggles ready, resume and weekly notifications",
                    "All scheduled DMs check preferences before sending",
                ],
            },
            {
                "title": "Server Oscars",
                "size": "S",
                "priority": "P2",
                "story": "As a friend, I want a monthly post with the most-watched title and a vote for best request, so that the group has something to argue about.",
                "criteria": [
                    "A monthly job shares top titles from Tautulli and a vote for best request of the month",
                    "Results announced a week later",
                ],
            },
            {
                "title": "Shared watchlists",
                "size": "M",
                "priority": "P2",
                "story": "As a group of friends, we want to build a list together and request all of it at once, so that a themed marathon is one step.",
                "criteria": [
                    "`/list create|add|show|request <name>` with per-list membership",
                    "Requesting a list runs each title through the normal request rules",
                ],
            },
        ],
    },
]

AREA_LABELS = {
    "agent": "The Claude tool-use loop, registry and guardrails",
    "chat": "luwin's chat surface and identity",
    "requests": "Requesting and finding media",
    "playback": "Playback issue reports and file replacement",
    "perf": "Lag and network diagnostics",
    "admin": "Admin console and scheduled jobs",
    "onboarding": "Wizarr invites and account help",
    "engagement": "Recommendations, digests and social features",
    "infra": "Scaffold, config, clients, storage, deploy and CI",
}
