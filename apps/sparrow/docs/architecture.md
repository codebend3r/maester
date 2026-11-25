# Architecture

## Components

```
                ┌──────────────────────────────────────────────┐
 chat app ────▶ │ chat/      chat service, identity, tier admin │
                │    │                                          │
                │    ▼                                          │
                │ agent/     Messages API loop ── tools/ ───────┼──▶ clients/ ──▶ raven, Seerr, Sonarr,
                │    │        registry, tiers, guardrails       │                Radarr, SABnzbd
                │    ▼                                          │
                │ store/     SQLite: users, conversations,      │
                │            audit_log, reports, pending        │
                │                                               │
          Seerr │ web/       FastAPI: /api, webhooks, /health   │
 webhooks ────▶ │ jobs/      digests, sweeps, reminders         │
                └──────────────────────────────────────────────┘
```

One process, one container, one SQLite file on `/data`. The FastAPI app and the scheduled jobs share an asyncio loop. sparrow's chat app (`@sparrow/web`, later also a helper window inside raven) talks to `chat/` through `/api`. Sign-in is raven's (below).

## Instance registry

Two NAS hosts each run their own Sonarr, Radarr and SABnzbd (see `wizteros/docs/arr-stack.md`). raven and Seerr are single. sparrow never talks to "Sonarr"; it talks to `sonarr[meleys]` or `sonarr[vermithor]`.

- Instances are declared in env as `SONARR_MELEYS_URL`, `SONARR_MELEYS_API_KEY`, and so on (`sparrow/registry.py`). An instance with a URL but no API key fails boot, named with the other missing variables.
- Every tool that touches an arr instance takes `host` and logs it in the audit row.
- A title's owning host is resolved per copy (standard or 4K) through Seerr, the one ownership rule described under Tools. When it can't be settled, the tool refuses rather than guessing.

## Permission tiers

| Tier       | Who                                  | Can                                                                                  |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| unapproved | A raven account not approved (yet)   | Nothing: refused at the door, told to ask raven's owner                              |
| friend     | Any account raven's owner approved   | Search, check availability and status, see their own plays and streams; with a Seerr match, request 1080p and report problems |
| trusted    | Friends the admin trusts             | Everything above, request 4K                                                         |
| admin      | raven's owner                        | Everything, tier overrides, download history, the arrs' own lists, everyone's streams |

Tiers are resolved on every request (`chat/identity.py`): an account raven hasn't approved (pending or revoked) gets no tier, whatever else is stored; then a per-user override in SQLite wins; then raven's owner is the admin; then any approved member is a friend. Trusted comes only from the override. Acting as someone in Seerr takes a Seerr match by email (`ToolContext.linked_user()`), so a friend Seerr doesn't know chats, but their requests and reports are refused. The tool list sent to the model is filtered by tier, and the server rejects out-of-tier calls independently of the model.

## Sign-in

sparrow runs no sign-in. Its page signs in to raven's Supabase project with the person's raven account (email and password, as Wren's web app does) and sends the access token as `Authorization: Bearer` on every `/api` call.

- **Whose a token is.** `web/auth.py`'s `AccountVerifier` asks raven's `GET /api/me` at `RAVEN_URL` with the token (`clients/raven.py`'s `me`: `{id, email, status, isOwner}`, or None on raven's 401). Each answer is cached for 30 seconds by the token's SHA-256, so a page's burst of requests costs one lookup and a short raven outage goes unnoticed. sparrow never stores the token; it rides along with the request (`Viewer.chat_user`, `ChatUser.raven_token`) into the tools' `ToolContext.raven_token`, so `ToolContext.raven` reads raven as the person asking and raven's own per-account rules apply. sparrow holds no raven token of its own.
- **Who they are here.** `IdentityService.refresh` upserts the user under the raven account id with their email, raven status and whether they own raven, and checks their Seerr match when due: daily once matched, so someone Seerr drops loses it, and at most once a minute while unmatched. Only the email matches, against a Seerr user's email.
- **The page's config.** `GET /api/auth/config`, open without a token like `/health`, relays raven's own answer (Supabase's URL and publishable key), so the page asks only sparrow.
- **Refusals**, as JSON from `Auth` (the seam every route depends on): 401 `{reason: "signed_out"}` when there's no token or raven doesn't accept it; 503 `{reason: "sign_in_unavailable"}` when raven can't be asked and nothing is cached, so the page doesn't loop through sign-in; 403 `{reason: "not_approved"}` for an account raven's owner hasn't approved, on every route but the config; 403 `{reason: "not_admin"}` on admin routes. Writes take `application/json` only (415 otherwise), and sparrow sends no CORS headers. `/api/*` answers `Cache-Control: no-store`.
- **Routes.** `GET /api/me` (`{user: {id, email}, tier}`) and `POST /api/admin/users/{user_id}/tier` (`{tier: friend | trusted | admin | null}`, the admin's alone, audited as `/tier`).
- **Chat routes** (`web/chat.py`), for a friend or above: `POST /api/chat` with `{text}` runs one turn and streams it as server-sent events: `text` for each chunk of the reply, `confirm` for each action waiting on the user's press, `choices` for a picker, `titles` for the titles a tool found (a tool returns `Ok(content, titles=...)`: what the model reads, and each title's links, shown once per turn), then `done`, or `error` with a reference when the turn broke outside the agent. `POST /api/chat/pick` sends a picker's choice as the next message and streams the same way; `POST /api/chat/decide` with `{pending_id, approve}` settles a Confirm or Cancel press through `ChatService.decide`, which lets only the requester press; `POST /api/chat/forget` starts the conversation fresh; `GET /api/chat/usage` gives the model and the user's tokens today against `USER_TOKENS_PER_DAY` (the limiter's own count; the sandbox keeps one that counts without refusing), which the page's footer shows. A turn keeps running when the browser leaves mid-stream, and its notices go to the `Notifier`. Each event's body is a pydantic model (`web/chat.py`), the shape `@sparrow/web`'s guards check; a notice is `{kind: admin_post | direct_message, text, to}`.
- **The sandbox** (`sandbox.py`, `uv run sparrow-sandbox`) serves the same chat routes over an eval case's fakes (raven and the arrs aside: it reads the real raven at `RAVEN_URL` with no token, as a browser against a raven with accounts off does, http://localhost:5175 when unset, and the admin's arr tools reach the real Radarr, Sonarr and Lidarr `.env` names, through curl on a Mac) and an in-memory store, with no sign-in: every request is the eval user, at the tier the page picks. Its stream also carries `tool` (each call, its arguments and its answer, from the agent's `on_tool` hook), `notice` and `failure` (the exception behind a broken turn's error reference) events, so the page shows what a reply rests on. It runs Claude Sonnet 5.5 at medium effort unless `--model` names another, through headless Claude Code on the developer's own sign-in (`agent/claude_code.py`, which stands in for the SDK client: each model call is a `claude -p` that sees sparrow's tools through a list-only MCP server (`agent/claude_code_tools.py`); the model's native call is read off the event stream and the run stopped before it executes, so the loop, tools and tiers are the same as against the API), never an API key, which only the deployed server uses. It listens on 127.0.0.1 only, reloads (through uvicorn's reloader and the `app` factory) whenever sparrow's code changes, and the container never runs it.

## Tools

| Tool               | Tier    | What it does                                                                                              |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `session_report`   | friend  | The user's own live streams in raven: how raven sends each (as it is, remuxed, converted), at home or away, the file and the player, and one fix for lag; every finding and the stats behind it with `details` |
| `speed_test`       | friend  | Tests the servers' internet connection from the NAS sparrow runs on: the upload the streams going out leave free, in plain words; rationed |
| `pick_version`     | friend  | A movie's files in raven with their bitrates and the one recommended for the user's connection (the speed they give, the last speed test), with what to pick in the player's Quality menu |
| `service_health`   | friend  | Pings raven, Seerr and every host's Sonarr, Radarr and SABnzbd at once, each with its own timeout; what is up, what is down and why; kept for 60 s |
| `server_status`    | friend  | Each NAS's CPU and memory from the fleet monitor, and for the admin raven's streams (conversions, away from home, what it sends); says whether load could be why things are slow |
| `search_media`     | friend  | Seerr (TMDB) search; several plausible matches become a picker labeled with availability                |
| `request_media`    | friend  | 1080p request as the friend (`X-API-User`); for shows, seasons already there are left out and listed; if Seerr leaves it pending, the reply's `pending` says it waits there for the admin |
| `request_media_4k` | trusted | 4K request as the friend; if Seerr leaves it pending, it waits there for the admin; with its volume nearly full (or unreadable), nothing is sent and the call refuses |
| `download_history` | admin   | Why a copy's download failed or is stuck: the owning arr's history and queue, with SABnzbd's record of the same downloads |
| `arr_overview`     | admin   | How a Radarr, Sonarr or Lidarr is set up and doing, per host: version, root folders with free space and what each holds, the custom filters saved in its list and their rules, tags, quality profiles, disks, health warnings, the queue, and title counts |
| `arr_titles`       | admin   | An arr's movies, series or artists as its own list picks them: a saved custom filter (every rule read against the title's record, a rule it can't read refused), part of the title or path, what is on disk, monitored; sorted, counted and sized |
| `arr_history`      | admin   | An arr's latest grabs, imports, failed downloads and deletions, newest first, narrowed to one kind of event if asked |
| `arr_move`         | admin, destructive | Moves the titles a filter, title or path picks to one root folder, or each to its letter folder under a parent (`/Meleys/Movies/L`, `#` for a digit), through the arr, which moves the files; every destination must be one of its root folders |
| `follow_show`      | friend  | Monitors a show in its owning Sonarr so future seasons download; refuses any host but the owner        |
| `search_library`   | friend  | Looks a title up in raven (`RAVEN_URL`): every unlocked library holding it, with year, quality (4K, 1080p, HDR) or episode count, and a link to its page in raven; the first answer to "is it on the server?" |
| `newest_in_library` | friend | The latest released movies or TV shows in raven: every unlocked movie or show library listed by release date (a show's premiere), newest first, nothing still to come, each title once with its libraries and a link to it in raven |
| `search_people` | friend | An actor, director, writer or producer by name, from raven's people: their titles on the server (each with a link), their latest released work from TMDB marked on the server or not, and what is still to come; narrowed by kind and job. Falls back to raven's own credits when TMDB's filmography isn't available |
| `check_availability` | friend | Where a title stands with Seerr: its 1080p and 4K copies, each season's status, the owning Sonarr host; for anime, English-audio coverage per season |
| `request_status`   | friend  | The friend's open Seerr requests; once approved, the owning host's queue and SABnzbd merged into a percent and ETA, with stalls and failures explained |
| `find_collection`  | friend  | A movie's TMDB collection as a picker of its entries with availability, led by "all missing" |
| `request_collection` | friend | One request per missing entry, summed up; refuses up front when the Seerr movie quota can't cover it |
| `recent_sessions`  | friend  | The friend's latest plays in raven (their own history), as a picker of title, copy (1080p or 4K) and episode |
| `report_problem`   | friend  | Files a playback report on a confirmed copy: file check, a decision from stored evidence, a Seerr issue as the friend |
| `list_tracks`      | friend  | One copy's audio and subtitle tracks read from the file (and subtitle files beside it), with English audio by the dub audit's rules |
| `replace_media`    | friend, destructive | Blocklists the grab behind a reported file, deletes it and searches again on the owning host; needs stored evidence and Confirm; refuses past the daily cap |
| `find_gaps`        | friend  | Searches a show's aired, monitored episodes that have no file on the owning host; whole missing seasons go to the admin |
| `setup_guide`      | friend  | A setup guide for raven in a browser or Raven on a Mac (`sparrow/guides/`), which the model answers from rather than from memory |

A tool's arguments are its handler's signature: the registry builds a pydantic model from its type hints (what the model reads about one goes in `Annotated[..., Field(description=...)]`), and that model is both the schema the model sees and the strict check every model call and every confirmed call goes through. A bool is not an int, nothing is coerced, and null fills only an optional argument. `tests/fixtures/tool_schemas.json` pins every schema the model sees.

`english_dub` on either request tool adds the `DUB_TAG` tag to the Seerr request (Seerr passes request tags to Sonarr or Radarr, where a release profile can prefer dual-audio releases) and picks the `DUB_PROFILE` quality profile when the server has one. English audio is read from Sonarr's analysis of each episode file (`mediaInfo.audioLanguages`), with the language rule of the `anime-missing-dub` audit (`sparrow/dub.py`).

A title's owning host is resolved per copy (`sparrow/library.py`), as an `Owner`: the arr and the title's id there. Radarr and Sonarr answer the same verbs for a title's files, deletes and searches (`sparrow/clients/arr.py`), and what differs between a movie and a show at that level is a row of `KINDS` (`sparrow/kinds.py`); only finding the one file a copy names differs, a `MovieOwner` (Radarr) holding one file per movie and a `ShowOwner` (Sonarr) one per episode. Seerr records, for the standard and the 4K copy, which of its Radarr/Sonarr servers took it and the title's id there (`serviceId`/`externalServiceId` and their `4k` twins). Each Seerr server (`/api/v1/settings/radarr` and `/sonarr`) is matched to the registry host whose URL has the same host, port and base path, so a title with a 1080p copy on one host and a 4K copy on the other resolves correctly for each. A title Seerr never sent anywhere is looked up by TMDB or TVDB id on every instance that is not one of Seerr's 4K servers. A Seerr server matching no configured instance, two instances holding the title, or an instance that can't answer is `OwnerUnknown`: refused, never guessed.

## Destructive actions

Deleting a file, blocklisting a release, moving an arr's titles: all of these are `destructive=True` tools.

1. The tool does not act. It returns a pending action with a human-readable summary.
2. The chat layer renders Confirm/Cancel buttons that only the asking user can press, expiring after 5 minutes.
3. On confirm, the action runs, is audited, and the admin is notified.
4. Destructive runs (only button presses make them) go one at a time in the runner, each audited before the next starts, so a cap counted from the audit log can't be raced.

A model call and a Confirm press pass the same admission (`ToolRunner._admit`: the tool exists, suits the caller's tier, and the input fits its schema) before anything runs. The admin approval queue, the kill switch and maintenance windows were removed: nothing in the deployed app could reach them (no route flipped the switch or started a window, and approvals only ever reached the log). Git history holds that code.

A handler answers with plain JSON or with exactly one of the `Result` variants (`sparrow/agent/tools.py`): `Ok(content, notices, titles, choices)`, `Refused(reason, notices)` or `Failed(content, notices, retryable)`, so a result that both succeeds and fails can't be built. `offer(items, notes)` builds the `Ok` for a picker: at most ten choices become buttons, and the model is told which were left off. Every tool refuses one way: `Refused(reason)` reaches the model as an error and is audited as not ok, so a daily cap never counts it; bad arguments are refused this way at the tool boundary too, and a caller with no Seerr link (`NotLinked`, raised by `ctx.linked_user()`) is turned into the same refusal by the runner. A refusal is for an action that can't be taken (nothing left to request, a quota, the wrong host, no evidence); a lookup that finds nothing (no search results, no open requests, no collection) answers with that. A refusal is final; a `Failed` step is final unless the tool marks it `retryable` (a service that didn't answer), and a raised exception always is retryable. The runner turns each into a `ToolOutcome` whose `status` is one of `Done`, `Errored(retryable)`, `AwaitingConfirmation` or `Cancelled`, and the chat layer matches on it.

The model never sees a confirmation as something it can perform; the button press is out of band.

## Notices and confirmations

Anything sent outside the current reply is a notice (`sparrow/notify.py`), one of two kinds: `AdminPost(text)` or `DirectMessage(to, text)`. Replies, decisions, webhooks and scheduled jobs all produce notices and hand them to the app's `Notifier`. Until sparrow's chat app delivers them, `LogNotifier` writes each to the log and counts it as delivered. Delivery is best effort per notice: `deliver()` never raises and returns the notices it could not send. A reply is sent first, then its notices.

A decision names its pending action by id, so one made after a restart still lands. A pending action's own expiry decides when a decision is too late.

A press always runs a tool call through the runner, with the same admission and audit as the model's calls: the requester presses Confirm, and the destructive call they asked for runs as them (Cancel runs nothing). The outcome goes into their conversation, so their next turn sees it. The runner adds a "confirmed" admin post unless the tool posted its own `AdminPost`. A press whose run fails in the tool itself (an arr down) is reopened, so the requester can press again; a press whose tool no longer exists is closed.

The conversation is stored a step at a time: an assistant message that called tools is saved together with their results in one transaction, so the stored history never holds a `tool_use` without its `tool_result` (the API rejects that on replay). A tool call cut off by `max_tokens` runs nothing and isn't saved.

- If a turn fails after a tool acted (a model error, say), the agent raises `TurnFailed` with the partial reply, and the error reply still carries its confirmations and notices.

A DM about a title carries it as `DirectMessage.about` (a `Titled` copy), so sparrow's chat app can offer to report a problem with that copy straight from the message.

Tools act as the friend through `ToolContext.linked_user()`: the caller's link, whose `seerr_user_id` goes out as Seerr's `X-API-User` on a request and as an issue's `userId`; Callers without one are refused with `NotLinked`. "Linked" is one rule in the store (the user's email matched a Seerr user), behind `Store.active_link()` and `Store.active_link_by_seerr_id()`, which tools and the ready DM use. An email is one raven account, and a Seerr user matches one email, so a request and its ready DM belong to one person; should two users ever match the same Seerr user, the one seen last gets its notices. A `ToolContext` always carries the real store and settings; nothing mints its own.

## Prompt injection

Friends' messages and every tool result (titles, overviews, file names, Seerr issue text) are untrusted. The system prompt states that tool results are data. The registry has no shell, HTTP passthrough or filesystem tools, so the worst an injected instruction can do is call a scoped tool the user already had access to, and destructive ones still need the button. The eval harness keeps an injection case.

## Playback reports and the replace flow

```
report ──▶ identify item (recent_sessions: the friend's plays in raven) ──▶ friend confirms the copy
       ──▶ report_problem(item, kind)
              wont_play: file health check (ffprobe + short decode, read-only mount)
              subtitles / audio: track listing ──▶ for_admin: Seerr issue, admin asked, stop
              wrong-file kinds: the friend's word
       ──▶ decision from stored evidence for that file
              │ no failed check and one reporter ──▶ recorded, Seerr issue, stop
              ▼ failed check, or 2+ reporters: replaceable, Seerr issue
       ──▶ replace_media(report, host)   [destructive: Confirm; re-checks evidence; capped; audited]
              │ over REPLACE_DAILY_CAP ──▶ refused until the day is over
              ▼
              mark grab failed (blocklist) ──▶ delete file ──▶ search, on the owning host
```

A report is one model (`sparrow/playback/`) about a `Copy` (`sparrow/media.py`, a leaf module every layer shares: a movie, a show or one episode, in its 1080p or 4K copy), whose file its owning arr locates (`MovieOwner.locate`, `ShowOwner.locate`), and a kind whose policy (`reports.POLICIES`) names its diagnosis strategy and whether a new copy fixes it. Kinds: `wont_play`, `wrong_title`, `wrong_episode`, `cam`, `hardcoded_subs`, `subtitles`, `audio`, `other`. Each strategy returns its own result (`diagnosis.py`: `FileChecked`, `TrackList`, `TheirWord`), which carries its summary, its data for the model and its lines for the Seerr issue.

- **Which play.** raven keeps every sitting with a video in the viewer's own history (`GET /api/history`), so a play that failed at once is there too. Each play names raven's item (the movie, or the episode and its show), whose TMDB id finds the title in Seerr; the file played says which copy it was, a 4K file being the 4K copy (`playback/plays.py`). A play raven can't name a title for is listed in the notes instead.
- **The file, not the player.** raven converts on the fly what a player can't play as it is, so a file that won't play is checked itself; there is no player check.
- **File health.** `health.check_health` decodes around the moment a friend named ("freezes at 1:12:30"), or the start, middle and end, and returns `ok`, `truncated`, `corrupt` or `unreadable` with the evidence. Only the file can fail the check: `truncated` needs a movie under 70% of its runtime or a stretch inside the file's claimed length that decodes nothing, and `corrupt` needs a known sign of a damaged stream (`CORRUPTION`). A moment named past the file's end is only noted. Known ffmpeg noise is ignored, and anything else ffmpeg prints (a read error, a missing decoder, an unknown line) makes the check `unreadable`, which never justifies a replacement.
- **Evidence, not the model's word.** A report is stored with the file's host, id, release group and health verdict, and its `decision` (`advised`, `replaceable`, `recorded`, `for_admin`), written once from the evidence each report of that file testifies to (`Testimony`, `Evidence`). A replaceable report may be replaced only when a stored check of that very file failed, or two or more people reported it; a report whose Seerr issue was resolved doesn't testify. `replace_media` checks this again when the friend presses Confirm, and acts only on the friend's own report, only while the file is still the one reported.
- **Status.** A report is `open` until its file is replaced, then `replaced`: `Reports.mark_replaced` moves every open report of the file at once and touches no other, so no stale read can move one back; a second press is refused, since `replace_media` acts only on an open report and the runner runs destructive tools one at a time. The `escalated` and `declined` statuses went with the approval flow; migrations 003 and 004 moved such reports back to `open`.
- **Seerr issue.** Every report opens a Seerr issue as the friend against Seerr's media id, naming the season and episode, with the diagnosis, the decision and, for track problems, the file's tracks. The friend is named as `userId` in the body, not with `X-API-User` as requests are: Seerr's issue route files as `userId` for a caller with MANAGE_ISSUES (sparrow's key), so the issue is the friend's whatever their own issue permissions. A replacement adds a comment with every step. Resolving the issue in Seerr resolves the report.
- **Replacement.** Steps run in order and stop at the first that doesn't go through: the grab behind the file (found through the arr's import history, `fileId`) is marked failed, which blocklists the release (a file with no grab behind it stops here and is left to the admin; a release already marked failed isn't marked twice); the movie or episode file is deleted (through its owner, the same verb on either arr); the movie, or every episode the file held, is searched. The arrs take no reason for a blocklist entry, so the reason stays on the report and in the admin's notice. An arr that didn't answer before anything was deleted leaves the press open to try again (`Failed(..., retryable=True)`). The friend is told which copy and every step; the admin gets one notice with path, size, reason and release group. Once the owning arr holds a new file for the copy, everyone who reported the old one gets one DM about it (`jobs/landed.py`, following replacements for two weeks), so a report about it reaches the new file.
- **Cap.** At most `REPLACE_DAILY_CAP` friend-confirmed replacements in any 24 hours, counted from the audit log (refusals don't count). Past it, the call refuses until the day is over. The runner runs destructive tools one at a time, so two confirmations at once can't both slip under the cap.

`find_gaps` compares Sonarr's episodes with the files on the owning host: aired, monitored episodes without a file are searched and listed; a season missing every aired episode goes to the admin instead of being searched blindly.

### File access

There is no filesystem tool. The health check and `list_tracks` name a title and copy; the path always comes from the owning arr's file record, and `MediaPaths` maps it onto the container's read-only mounts (`MEDIA_PATH_MAP`, for arrs that see the shares under other names) and refuses anything that resolves outside `MEDIA_ROOTS`, symlinks and `..` included. `MEDIA_ROOTS` itself refuses `/` and relative paths, and a decode checks its path against the roots again. ffprobe and ffmpeg run without a shell as async subprocesses, each capped by `PROBE_TIMEOUT_SECONDS` and two at a time, with the path passed as `file:<path>`; a process whose asker was cancelled is killed.

## Performance diagnostics

"It's laggy" is answered from live data, not guesses (`sparrow/perf/`).

- **Server load.** `server_status` reads each NAS's CPU and memory from the fleet monitor, where one is set up, and for the admin raven's live streams (`GET /api/streams`, which raven answers its owner alone): how many, how many it converts or remuxes, how many go away from home, and what it sends (`perf/load.py`). A NAS is busy when its CPU reaches `BUSY_CPU_PERCENT` (85) or its memory `BUSY_MEMORY_PERCENT` (90). The reply says whether load is a plausible cause in three states: yes, unlikely (every NAS read and none busy), or unknown. It says "fine" only of CPU and memory it actually read.
- **Fleet monitor.** CPU and memory per NAS come from wizteros' fleet monitor (`clients/fleet.py`), read from `/fleet/cpu` and `/fleet/memory` (and `/fleet` for the weekly NAS report) only, with a static bearer token (`FLEET_MONITOR_TOKEN`), and only when `FLEET_MONITOR_URL` and the token are set. The monitor has no guard for such a token yet, so it stays unset until wizteros adds one. A host's vitals are the last reading of the past five minutes.
- **Speed test.** `speed_test(host)` runs Ookla's speedtest CLI inside sparrow's own container (`clients/speedtest.py`): the Dockerfile pins version 1.2.0 by checksum, and it runs the way ffprobe does (`clients/process.py`: no shell, a fixed argv, a timeout, killed if its asker goes away). It can only test from `SPEEDTEST_HOST`, the NAS the container runs on; the hosts share one internet connection, so that stands for all of them. The test shares the upload with the streams already going out, so the upload it finds is the headroom, put in plain words (`perf/uplink.py`). A test briefly fills the upload for everyone, so a result is reused for 10 minutes (`REUSE`) and a new test runs at most every 20 (`MIN_GAP`), failed or not.
- **Lag advice.** `session_report` reads the friend's own live streams (`GET /api/streams/mine`, a route raven added for this: the caller's streams alone, approved accounts only), each with its title's files (`GET /api/items/{id}`) and the last speed test while it's within 10 minutes (never a new one) (`perf/lag.py`). A stream is away from home when its address isn't on the home network. Each rule finds its cause in a stream or doesn't, says the cause and the fix in words only when it applies, and names a typed `Fix`: `other_version`, `other_player`, `lower_quality`.
  - raven says how it sends a stream (`direct`, `remux`, `transcode`) and the size the viewer picked, not why. A conversion with no size picked of a file that isn't plain H.264 (HEVC, AV1, HDR, Dolby Vision) is read as the player's: the fix is a plain version of the title when there is one, else Raven, the Mac app, which plays every file as it is.
  - Away from home a file played as it is is weighed against the tightest of a typical connection away from home and the servers' free upload plus what this stream already takes: too heavy, it's a lighter version when one fits, else a size in the player's Quality menu; a nearly full upload calls for a smaller size too. A table per place (`AT_HOME`, `AWAY`) gives precedence; the friend gets the first finding, and every finding and the stats only with `details=true`.
- **Versions and connections.** A title's files come from raven's item (`perf/versions.py`), found for a Seerr title by searching raven and matching the TMDB id, and are named as friends name them (`RavenFile.name`: "4K HDR (HEVC)"). A file fits a connection when its average bitrate times `PEAK_ALLOWANCE` (1.5) is under the tightest known limit; away from home with nothing measured, a connection is taken to carry `REMOTE_COMFORT_KBPS` (20 Mbps). A size to pick is one of raven's own (`RAVEN_QUALITIES`, `STREAM_QUALITIES` in `@raven/core`), which cap a converted stream's bitrate. `pick_version` recommends against the tightest of the speed the friend gives and the servers' free upload at the last speed test. Movies only.
- **Service health.** Every client has one liveness call, `ping`, on the cheapest route that shows it is up: raven's `/api/health`, Seerr's `/api/v1/status`, each arr's `/api/v3/system/status`, and a one-slot SABnzbd queue, which refuses a wrong key in its answer rather than with an HTTP error. The fakes share one `Downable` mixin. `service_health` pings them all at once, each under `PING_TIMEOUT` (5 s), and keeps the answer for 60 s (`HEALTH_TTL`).
- **Shared answers.** Answers worth sharing across calls (a speed test, a health check) are kept in the agent's `Memo`, handed to tools as `ToolContext.memo`. A typed key (`Key[T]`: `SPEED_TEST`, `HEALTH`) names each question and the type of its answer. It lives in memory; a restart only costs one more lookup.

## Admin jobs and tools

What sparrow does for the admin (`sparrow/jobs/`, and the admin tools). The one admin write left is the tier override behind `POST /api/admin/users/{user_id}/tier` (`sparrow/web/api.py`), audited as `/tier`; anyone but the admin is refused by `Auth.admin` before it runs. The console's `/kill`, `/audit`, `/pending`, `/forecast` and `/maintenance`, the approval queue and the kill switch were removed, since nothing in the deployed app reached them; git history holds them for when sparrow's app delivers notices.

- **Storage-aware 4K.** `sparrow/storage.py` reads free space per volume: each arr's root folders mapped to the disk they sit on (the longest mount path), merged when two arrs or two hosts see one disk (same path and size, free space within 10 GB). Before a 4K request goes to Seerr, the volume Seerr's 4K server puts it on (its root folder, or the arr's only one) is checked: at `STORAGE_PAUSE_4K_PERCENT` or past it, or when it can't be read, nothing is sent and the call refuses, saying why.
- **Stalled-download sweeper.** Every `SWEEP_MINUTES` (`jobs/sweep.py`), each host's Radarr and Sonarr queue is read. A download is stuck when its arr flags it (warning or error) or when it stops moving while downloading; paused, queued, delayed or a client that can't be reached is waiting, not stuck, and a download the arr didn't grab for a title it knows (added to the client by hand) isn't the sweeper's to touch. `queue_watch` times each download across sweeps and restarts. Stuck past `STALLED_HOURS`: removed from the client with its release blocklisted, and its movie or episodes searched again on the same host; if the search then doesn't start, the admin is told to run it, since the download is out of the queue. A title that stalls again within 30 days of a re-search is posted to the admin once instead. A download one queue read misses keeps its row a day, so it isn't timed or surfaced again from scratch. Each host's queue is swept at once. Each action is audited (`sweep_stalled`) and kept in `stalls` for the digest.
- **Disk forecast.** At 03:00 each volume's free space is sampled into `space_samples` (keyed by path, size and the hosts that see it; a day an arr can't answer is skipped, since a shared volume would come back looking like another). The forecast fits a straight line through the last 30 days (least squares) and says when each volume reaches zero at that rate, once it has 7 days of samples. The digest carries any under 30 days.
- **Bad releases.** A report stores its file's release group: the arr's, or the `-GROUP` at the end of the file name (`sparrow/releases.py`). A group with `BAD_RELEASE_REPORTS` distinct reported files in 30 days (a report the player explains doesn't count) gets a block suggestion in the digest, a custom format or a release profile, once per 30 days (claim source `bad_release`).
- **Download history.** `download_history` (admin) reads the owning host's arr history and queue for one copy, and SABnzbd's history and queue on that host for the same download ids: its failure message and the repair and unpack steps that went wrong. A named host must hold the copy; with none named the owner is found. The model gives the admin the cause and the next step.
- **Daily digest.** At `DIGEST_TIME` in `TZ` (`jobs/digest.py`), one admin post: the last day's requests and where each stands, Seerr's open issues, the last day's replacements, per host the sweeper's actions, what an arr flags as stuck and SABnzbd's failures, every volume's free space with any forecast under 30 days, release groups to block, and anything that couldn't be read. A section with nothing to say is left out.
- **Weekly NAS report.** On `NAS_REPORT_DAY` at the digest's time (`jobs/nas.py`): each NAS from the fleet monitor's `/fleet` (heard from or not, `/volume1` usage, memory, load, the hottest chip, containers down or unhealthy, uptime over the last day) and the media volumes from the arrs, anything past a limit first. SMART isn't read (the monitor has no SMART probe and sparrow no SSH), and the report says so.
- **Scheduled jobs.** `sparrow/jobs/` runs each job `At` a time of day in `TZ` (daily, or one day a week) or `Every` so often, on the app's loop: the sweeper, the free-space sample, the digest, the NAS report, and the check for replaced copies that landed. A slot is claimed (source `job`) before it runs, so a restart never runs one twice, and a slot missed while down still runs on start within 6 hours. A job that fails is logged and runs at its next time.

## Onboarding and accounts

Accounts are raven's: people sign up in raven, and raven's owner approves them. sparrow changes none of that, and the system prompt tells someone asking for access to ask raven's owner.

- **Setup help.** `sparrow/guides/` holds a markdown guide per app (raven in a browser, Raven on a Mac), each ending with what they share: the player's Quality menu, a connection too slow for the file, audio and subtitles. The model answers from `setup_guide`, not from memory.

## Storage

SQLite, migrations numbered under `sparrow/store/migrations/` (sparrow's store started fresh when raven's accounts replaced the old sign-in: one `001` schema keyed by raven account id, and a database from before that is refused on open), and one store module per table (`sparrow/store/`) joined into `Store`. Tables: `users`, `conversations`, `audit_log`, `reports`, `pending_actions` (confirmations only), `claims`, `queue_watch`, `stalls`, `space_samples`, and later `preferences`. Nothing in the file is a source of truth for media; Seerr and the arrs are.

`reports` holds every playback report: who, which copy (title, TMDB id, 4K or not, season and episode) and which file (host, arr file id, path, release group), the health verdict and diagnosis, the friend's description, its decision (written once) and status (moved by compare-and-set), its Seerr issue and when it was resolved. `claims` holds what's done once a window, per source and key: Seerr webhook deliveries acted on (source `seerr`), scheduled job slots run (source `job`), release groups suggested for a block (source `bad_release`, once a month per group), and replaced copies friends were told landed (source `landed`). Each source prunes its own claims older than its window as it claims. `queue_watch` and `stalls` the sweeper's view of the queues and what it did; `space_samples` a day's free space per volume.

## Seerr webhook

`POST /webhooks/seerr` serves every Seerr notification type. The `Authorization` header must equal `SEERR_WEBHOOK_SECRET`; with no secret configured, every call is refused. The payload is checked by `SeerrPayload` (a pydantic model of the default template; fields sparrow doesn't read are ignored, since an admin may extend the template) and becomes a `SeerrNotification` and dispatched by type through `seerr_routes()` (`sparrow/seerr_events.py`); a route's handler returns notices, which go out through the app's `Notifier`. Types without a route are acknowledged and ignored.

Deduplication is opt-in per route, for handlers whose repeat would reach a person twice. Such a route claims the event in `claims` (source `seerr`; the key is the type plus the request or issue it concerns) before its handler runs, so a repeat inside its window (15 minutes for the ready DM, sized for Seerr's rescans) is acknowledged without acting. A later repeat is news and gets through, and idempotent routes (a report-row update) take every delivery. The claim is released when the handler fails or one of its notices could not be delivered.

| Type              | Handler         | Effect                                                                   |
| ----------------- | --------------- | ------------------------------------------------------------------------ |
| `MEDIA_AVAILABLE` | `ready_to_watch`| DMs the linked requester: title, version (1080p or 4K), and raven's address; dedupes for 15 minutes. The DM carries the title, so sparrow's chat app can offer to report a problem with it |
| `MEDIA_APPROVED`  | `decided_in_seerr` | Looks the request up in Seerr and DMs the linked requester the admin's decision; dedupes for 15 minutes |
| `MEDIA_DECLINED`  | `decided_in_seerr` | The same, declined |
| `ISSUE_RESOLVED`  | `issue_status`  | Marks the reports behind the issue resolved and DMs each reporter once; idempotent, no dedupe |
| `ISSUE_REOPENED`  | `issue_status`  | Clears the reports' resolved time; idempotent, no dedupe |

## Deployment

Docker Compose on Meleys, run from `apps/sparrow/` in the repo copy at `/volume1/docker/maester`, next to `stripe-bridge`. Media shares are bind-mounted read-only for the health check, and `MEDIA_ROOTS` lists them; the image installs ffmpeg and the pinned speedtest CLI (`SPEEDTEST_HOST=meleys`). `scripts/deploy-nas.sh` rsyncs the repo over the SMB share and excludes `.env` and the data folder (`sparrow-data/`).
