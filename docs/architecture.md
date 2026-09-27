# Architecture

## Components

```
                ┌──────────────────────────────────────────────┐
 Discord ─────▶ │ chat/      discord.py client, views, identity │
                │    │                                          │
                │    ▼                                          │
                │ agent/     Messages API loop ── tools/ ───────┼──▶ clients/ ──▶ Seerr, Sonarr, Radarr,
                │    │        registry, tiers, guardrails       │                SABnzbd, Tautulli, Plex, Wizarr
                │    ▼                                          │
                │ store/     SQLite: users, conversations,      │
                │            audit_log, reports, pending        │
                │                                               │
 Seerr/Tautulli │ web/       FastAPI webhooks, /health          │
 webhooks ────▶ │ jobs/      digests, sweeps, reminders         │
                └──────────────────────────────────────────────┘
```

One process, one container, one SQLite file on `/data`. The Discord client and the FastAPI app share an asyncio loop.

## Instance registry

Two NAS hosts each run their own Sonarr, Radarr, SABnzbd and Tautulli (see `wizteros/docs/arr-stack.md`). Seerr, Plex and Wizarr are single. maester never talks to "Sonarr"; it talks to `sonarr[meleys]` or `sonarr[vermithor]`.

- Instances are declared in env as `SONARR_MELEYS_URL`, `SONARR_MELEYS_API_KEY`, and so on.
- Every tool that touches an arr instance takes `host` and logs it in the audit row.
- A title's owning host is resolved per copy (standard or 4K) through Seerr, the one ownership rule described under Tools. When it can't be settled, the tool refuses rather than guessing.

## Permission tiers

| Tier      | Who                         | Can                                                                                     |
| --------- | --------------------------- | --------------------------------------------------------------------------------------- |
| unlinked  | Anyone the bot does not know| Get help, start `/link`                                                                 |
| friend    | Linked Plex user            | Search, request 1080p, check availability and status, report problems, see own stats    |
| trusted   | Friends the admin trusts    | Everything above, request 4K (goes to approval), request invites for others            |
| admin     | The server owner            | Everything, approve, kill switch, tier overrides, audit log, download history           |

Tiers come from Discord roles with a per-user override in SQLite. The tool list sent to the model is filtered by tier, and the server rejects out-of-tier calls independently of the model.

## Tools

| Tool               | Tier    | What it does                                                                                              |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `server_status`    | friend  | Streams, transcodes and bandwidth per host                                                                |
| `search_media`     | friend  | Seerr (TMDB) search; several plausible matches become a picker labeled with availability                |
| `request_media`    | friend  | 1080p request as the friend (`X-API-User`); for shows, seasons already there are left out and listed    |
| `request_media_4k` | trusted | 4K request as the friend; if Seerr leaves it pending, the admin approves or declines it with buttons    |
| `decide_4k_request` | admin, button-only | The admin's Approve/Deny on a pending 4K request: approves or declines it in Seerr and DMs the requester |
| `link_account`     | admin, button-only | The admin's Approve/Deny on a /link request: activates or revokes the link and DMs the friend |
| `follow_show`      | friend  | Monitors a show in its owning Sonarr so future seasons download; refuses any host but the owner        |
| `check_availability` | friend | Versions on Plex (1080p, 4K, HEVC re-encode) with size and bitrate, episodes per season, a Plex deep link per copy; for anime, English-audio coverage per season |
| `request_status`   | friend  | The friend's open Seerr requests; once approved, the owning host's queue and SABnzbd merged into a percent and ETA, with stalls and failures explained |
| `find_collection`  | friend  | A movie's TMDB collection as a picker of its entries with availability, led by "all missing" |
| `request_collection` | friend | One request per missing entry, summed up; refuses up front when the Seerr movie quota can't cover it |
| `recent_sessions`  | friend  | The friend's live and recent plays on every Tautulli host, as a picker of title, copy (1080p or 4K) and episode |
| `report_problem`   | friend  | Files a playback report on a confirmed copy: player check, file check, a decision from stored evidence, a Seerr issue as the friend |
| `list_tracks`      | friend  | One copy's audio and subtitle tracks read from the file (and subtitle files beside it), with English audio by the dub audit's rules |
| `replace_media`    | friend, destructive | Blocklists the grab behind a reported file, deletes it and searches again on the owning host; needs stored evidence and Confirm; capped per day |
| `decide_replacement` | admin, button-only, destructive | The admin's Approve/Deny on a replacement over the daily cap; runs it and DMs the friend |
| `find_gaps`        | friend  | Searches a show's aired, monitored episodes that have no file on the owning host; whole missing seasons go to the admin |

`english_dub` on either request tool adds the `DUB_TAG` tag to the Seerr request (Seerr passes request tags to Sonarr or Radarr, where a release profile can prefer dual-audio releases) and picks the `DUB_PROFILE` quality profile when the server has one. English audio is read from Sonarr's analysis of each episode file (`mediaInfo.audioLanguages`), with the language rule of the `anime-missing-dub` audit (`maester/dub.py`).

A title's owning host is resolved per copy (`maester/library.py`), as a `MovieOwner` (Radarr) or `ShowOwner` (Sonarr) that speaks its arr's API for the copy's files, deletes and searches. Seerr records, for the standard and the 4K copy, which of its Radarr/Sonarr servers took it and the title's id there (`serviceId`/`externalServiceId` and their `4k` twins). Each Seerr server (`/api/v1/settings/radarr` and `/sonarr`) is matched to the registry host whose URL has the same host, port and base path, so a title with a 1080p copy on one host and a 4K copy on the other resolves correctly for each. A title Seerr never sent anywhere is looked up by TMDB or TVDB id on every instance that is not one of Seerr's 4K servers. A Seerr server matching no configured instance, two instances holding the title, or an instance that can't answer is `OwnerUnknown`: refused, never guessed.

## Destructive actions

Deleting a file, blocklisting a release, issuing an invite, changing a share: all of these are `destructive=True` tools.

1. The tool does not act. It returns a pending action with a human-readable summary.
2. The chat layer renders Confirm/Cancel buttons that only the asking user can press, expiring after 5 minutes.
3. On confirm, the action runs, is audited, and the admin channel is notified.
4. Some actions (4K requests, invites) go to the admin approval queue instead of the user's own confirmation; a replacement over the daily cap goes there after the friend confirms it.
5. A global kill switch (`KillSwitch`, checked by the runner) disables every destructive tool immediately, including a button-only one an admin's Approve would run.

A tool can fail on its own terms: `Result(content, is_error=True)` reaches the model as an error and is audited as not ok, so a daily cap never counts it. Such a failure is final unless the tool marks it `retryable` (a service that didn't answer); a raised exception always is retryable.

The model never sees a confirmation as something it can perform; the button press is out of band.

## Notices and approvals

Anything posted outside the current reply is a notice (`maester/notify.py`), one of three kinds: `AdminPost(text)`, `ApprovalPost(text, pending_id)` (an admin post with Approve/Deny buttons), or `DirectMessage(to, text)`. Replies, button decisions and webhooks all produce notices, and the Discord bot delivers them as the app's `Notifier`, so nothing outside `chat/` imports Discord. Delivery is best effort per notice: `deliver()` never raises and returns the notices it could not send. A reply is sent first, then its notices.

Decision buttons are persistent: each carries `decide:<pending id>:<approve|deny>` as its custom id, and the bot registers `DecisionButton` at startup, so a press after a deploy still lands. A pending action's own expiry decides when a press is too late.

A button press always runs a tool call through the runner, with the same checks and audit as the model's calls. The two kinds of pending action differ only in who presses and what runs:

- **Confirm**: the requester presses Confirm, and the destructive call they asked for runs as them (Cancel runs nothing). The outcome goes into their conversation, so their next turn sees it. The runner adds a "confirmed" admin post unless the tool posted its own (an `AdminPost`, or an `ApprovalPost` when the confirmed call went to the admin instead, which the requester is told plainly).
- **Approve**: an admin presses Approve or Deny, and a button-only admin tool runs as that admin with `approved` set by the press. Button-only tools (`@tool(..., tier=Tier.ADMIN, button_only=True)`) are never shown to the model and never run from a model call. `link_account` (a /link request), `decide_4k_request` and `decide_replacement` are the three today.

A tool asks the admin by returning `Result(content, notices=(), approval=None)`:

- `notices` go out as they are (an `AdminPost`, a `DirectMessage`).
- `Approval(notice, summary, decide, args)` names the decide tool and its arguments. The runner checks `args` against that tool's schema, stores the pending action, posts `notice` with Approve/Deny buttons, and tells the model the action waits on the admin. If the approval cannot be raised, the admin still gets `notice` as a plain post, and the call is an error.
- The call that raised the approval is audited with the approval's id, so daily caps never count a call that only asked. The decision is audited under the decide tool's name.
- A press whose run fails in the tool itself (Seerr down) is reopened, so the admin can press again; decide tools must be safe to run twice. A press whose tool no longer exists is closed.
- If a turn fails after a tool acted (a model error, say), the agent raises `TurnFailed` with the partial reply, and the error reply still carries its confirmations and notices.

A DM about a title carries it as `DirectMessage.about` (a `MediaRef`). The bot hands every sent DM to `ChatService.remember_dm`, which stores the message id against the title in `sent_messages`, so a reaction can be traced back: a thumbs-down on a ready-to-watch DM becomes a message saying something's wrong with that copy, and the report flow starts there (`ChatService.react`, from `on_raw_reaction_add`).

Tools act as the friend through `ToolContext.linked_user()`: the caller's active link, whose `seerr_user_id` goes out as Seerr's `X-API-User`; `ctx.link_of(discord_id)` gives anyone else's, for a tool acting on someone's behalf. Callers without one are refused with `NotLinked`. "Active" is one rule in the store (approved, and naming a Seerr user), behind `Store.active_link()` and `Store.active_link_by_seerr_id()`, which tiers, tools and the ready DM all use. A Seerr user has at most one live (pending or active) link, enforced by a unique index (migration `004`, which also revoked older duplicates), so a request and its ready DM belong to one person. A `ToolContext` always carries the real store and settings; nothing mints its own.

## Prompt injection

Friends' messages and every tool result (titles, overviews, file names, Seerr issue text) are untrusted. The system prompt states that tool results are data. The registry has no shell, HTTP passthrough or filesystem tools, so the worst an injected instruction can do is call a scoped tool the user already had access to, and destructive ones still need the button. The eval harness keeps an injection case.

## Playback reports and the replace flow

```
report ──▶ identify item (recent_sessions: Tautulli plays on every host) ──▶ friend confirms the copy
       ──▶ report_problem(item, kind)
              wont_play: player check against CLIENT_LIMITS
              │ player limit found ──▶ the fix, Seerr issue, stop
              ▼
              file health check (ffprobe + short decode, read-only mount)
              subtitles / audio: track listing ──▶ for_admin: Seerr issue, admin asked, stop
              wrong-file kinds: the friend's word
       ──▶ decision from stored evidence for that file
              │ no failed check and one reporter ──▶ recorded, Seerr issue, stop
              ▼ failed check, or 2+ reporters: replaceable, Seerr issue
       ──▶ replace_media(report, host)   [destructive: Confirm; re-checks evidence; capped; audited]
              │ over REPLACE_DAILY_CAP ──▶ admin approval ──▶ decide_replacement
              ▼
              mark grab failed (blocklist) ──▶ delete file ──▶ search, on the owning host
```

A report is one model (`maester/playback/`): an `Item` (movie, or one episode, in its 1080p or 4K copy), located through its owning arr's file records (`items.locate`), and a kind whose policy (`reports.POLICIES`) says how it is diagnosed and whether a new copy fixes it. Kinds: `wont_play`, `wrong_title`, `wrong_episode`, `cam`, `hardcoded_subs`, `subtitles`, `audio`, `other`.

- **Player first.** `client_limits.CLIENT_LIMITS` is a table of known player limits, each a match on a play's facts (`Playback`: client, codecs, and the server's decision per stream, from a live session or a finished play's history row and `get_stream_data`) plus its cause and one concrete fix: Dolby Vision profile 7 off a Shield, HEVC the player can't decode, TrueHD/DTS passed through, PGS subtitles burned in. The file's Dolby Vision profile comes from ffprobe for a finished play. Only when no rule matches is the file checked. A player fix must not shield a broken file for good, so a friend who already got one for this file and reports it again has the file checked instead. The performance epic reuses the table.
- **File health.** `health.check_health` decodes around the moment a friend named ("freezes at 1:12:30"), or the start, middle and end, and returns `ok`, `truncated`, `corrupt` or `unreadable` with the evidence, by the maintainer's audit rules (a movie under 70% of its runtime is truncated; known ffmpeg noise is ignored). Only `truncated` and `corrupt` count as failed; `unreadable` (a missing mount, a format ffmpeg can't parse, a timeout) never justifies a replacement.
- **Evidence, not the model's word.** A report is stored with the file's host, id, release group and health verdict. A replaceable report may be replaced only when a stored check of that very file failed, or two or more people reported it; a report the player explains doesn't count, a report whose Seerr issue was resolved no longer counts, and once the admin declines replacing a file, nothing replaces it. `replace_media` checks this again when the friend presses Confirm, acts only on the friend's own report while it can still lead to a new copy (not one waiting on the admin, declined or replaced), and only while the file is still the one reported.
- **Seerr issue.** Every report opens a Seerr issue as the friend (the admin key may file for another user) against Seerr's media id, naming the season and episode, with the diagnosis, the decision and, for track problems, the file's tracks. A replacement adds a comment with every step. Resolving the issue in Seerr resolves the report.
- **Replacement.** Steps run in order and stop at the first that doesn't go through: the grab behind the file (found through the arr's import history, `fileId`) is marked failed, which blocklists the release (a file with no grab behind it stops here and is left to the admin; a release already marked failed isn't marked twice); the movie or episode file is deleted (`MovieOwner` or `ShowOwner` speaks its arr's API); the movie, or every episode the file held, is searched. The arrs take no reason for a blocklist entry, so the reason stays on the report and in the admin's notice. An arr that didn't answer before anything was deleted leaves the press open to try again (`Result.retryable`). The friend is told which copy, every step and when to try again; the admin gets one notice with path, size and reason.
- **Cap.** At most `REPLACE_DAILY_CAP` friend-confirmed replacements in any 24 hours, counted from the audit log (refusals and calls that only asked for approval don't count). Past it, the confirmed request goes to the admin; what they approve is their call and isn't counted. Checking and replacing happen under one lock, and the runner writes the audit row as the tool returns, so two confirmations at once can't both slip under the cap.

`find_gaps` compares Sonarr's episodes with the files on the owning host: aired, monitored episodes without a file are searched and listed; a season missing every aired episode goes to the admin instead of being searched blindly.

### File access

There is no filesystem tool. The health check and `list_tracks` name a title and copy; the path always comes from the owning arr's file record, and `MediaPaths` maps it onto the container's read-only mounts (`MEDIA_PATH_MAP`, for arrs that see the shares under other names) and refuses anything that resolves outside `MEDIA_ROOTS`, symlinks and `..` included. ffprobe and ffmpeg run without a shell as async subprocesses, each capped by `PROBE_TIMEOUT_SECONDS` and two at a time, with the path passed as `file:<path>`.

## Storage

SQLite, migrations numbered under `maester/store/migrations/`. Tables: `users`, `conversations`, `audit_log`, `reports`, `pending_actions`, `webhook_events`, `sent_messages`, and later `space_samples`, `preferences`. Nothing in the file is a source of truth for media; Seerr and the arrs are.

`reports` holds every playback report: who, which copy (title, TMDB id, 4K or not, season and episode) and which file (host, arr file id, path, release group), the health verdict and diagnosis, the friend's description, what became of it (`advised`, `replaceable`, `recorded`, `for_admin`, `escalated`, `replaced`, `declined`), its Seerr issue and when it was resolved or replaced. `sent_messages` maps a DM's message id to the title it was about, for a month.

## Seerr webhook

`POST /webhooks/seerr` serves every Seerr notification type. The `Authorization` header must equal `SEERR_WEBHOOK_SECRET`; with no secret configured, every call is refused. The payload is parsed into a `SeerrNotification` and dispatched by type through `seerr_routes()` (`maester/seerr_events.py`); a route's handler returns notices, which go out through the bot as the `Notifier`. Types without a route are acknowledged and ignored.

Deduplication is opt-in per route, for handlers whose repeat would reach a person twice. Such a route claims the event in `webhook_events` (type plus the request or issue it concerns) before its handler runs, so a repeat inside its window (15 minutes for the ready DM, sized for Seerr's rescans) is acknowledged without acting. A later repeat is news and gets through, and idempotent routes (a report-row update) take every delivery. The claim is released when the handler fails or one of its notices could not be delivered.

| Type              | Handler         | Effect                                                                   |
| ----------------- | --------------- | ------------------------------------------------------------------------ |
| `MEDIA_AVAILABLE` | `ready_to_watch`| DMs the linked requester: title, version (1080p or 4K), a Plex deep link; dedupes for 15 minutes. The DM carries the title, so a thumbs-down on it opens a report |
| `ISSUE_RESOLVED`  | `issue_status`  | Marks the reports behind the issue resolved and DMs each reporter once; idempotent, no dedupe |
| `ISSUE_REOPENED`  | `issue_status`  | Clears the reports' resolved time; idempotent, no dedupe |

## Deployment

Docker Compose on Meleys at `/volume1/docker/maester`, next to `stripe-bridge`. Media shares are bind-mounted read-only for the health check, and `MEDIA_ROOTS` lists them; the image installs ffmpeg. `scripts/deploy-nas.sh` rsyncs the repo over the SMB share and excludes `.env` and `maester-data/`.
