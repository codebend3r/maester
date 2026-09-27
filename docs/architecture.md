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
- A media item resolves to its owning host by matching its file path against each instance's root folders. When no host matches, the tool refuses rather than guessing.

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
| `follow_show`      | friend  | Monitors a show in its owning Sonarr so future seasons download; refuses any host but the owner        |
| `check_availability` | friend | Versions on Plex (1080p, 4K, HEVC re-encode) with size and bitrate, episodes per season, a Plex deep link per copy; for anime, English-audio coverage per season |
| `request_status`   | friend  | The friend's open Seerr requests; once approved, the owning host's queue and SABnzbd merged into a percent and ETA, with stalls and failures explained |
| `find_collection`  | friend  | A movie's TMDB collection as a picker of its entries with availability, led by "all missing" |
| `request_collection` | friend | One request per missing entry, summed up; refuses up front when the Seerr movie quota can't cover it |

`english_dub` on either request tool adds the `DUB_TAG` tag to the Seerr request (Seerr passes request tags to Sonarr or Radarr, where a release profile can prefer dual-audio releases) and picks the `DUB_PROFILE` quality profile when the server has one. English audio is read from Sonarr's analysis of each episode file (`mediaInfo.audioLanguages`), with the language rule of the `anime-missing-dub` audit (`maester/dub.py`).

A title's owning host is the one Radarr (by TMDB id) or Sonarr (by TVDB id) that has it, asked of every instance at once (`maester/library.py`). Two owners, or an instance that cannot answer, is a refusal, never a guess.

## Destructive actions

Deleting a file, blocklisting a release, issuing an invite, changing a share: all of these are `destructive=True` tools.

1. The tool does not act. It returns a pending action with a human-readable summary.
2. The chat layer renders Confirm/Cancel buttons that only the asking user can press, expiring after 5 minutes.
3. On confirm, the action runs, is audited, and the admin channel is notified.
4. Some actions (4K requests, invites, replacements over the daily cap) go to the admin approval queue instead of the user's own confirmation.
5. A global kill switch (`/kill on`) disables every destructive tool immediately.

The model never sees a confirmation as something it can perform; the button press is out of band.

## Notices and approvals

Anything posted outside the current reply is a notice (`maester/notify.py`), one of three kinds: `AdminPost(text)`, `ApprovalPost(text, pending_id)` (an admin post with Approve/Deny buttons), or `DirectMessage(to, text)`. Replies, button decisions and webhooks all produce notices, and the Discord bot delivers them as the app's `Notifier`, so nothing outside `chat/` imports Discord. Delivery is best effort per notice: `deliver()` never raises and returns the notices it could not send. A reply is sent first, then its notices.

Decision buttons are persistent: each carries `decide:<pending id>:<approve|deny>` as its custom id, and the bot registers `DecisionButton` at startup, so a press after a deploy still lands. A pending action's own expiry decides when a press is too late.

A tool reaches the admin by returning `ForAdmin(content, notice, approval=None)`:

- Without an approval, the model gets `content` and the admin channel gets `notice`.
- With `Approval(summary, payload)`, the runner stores a pending action named after the tool, the notice gets Approve/Deny buttons, and the model is told the action waits on the admin.
- The admin's press is recorded, then applied by the tool's `settle` handler (`@tool(..., settle=...)`), run as the admin through `ToolRunner.settle()` and audited like any call. It returns `Settled(text, notices)`, typically a DM to the requester.
- If settling fails, the decision is reopened so the admin can press again; settle handlers must therefore be safe to run twice.
- If a turn fails after a tool acted (a model error, say), the agent raises `TurnFailed` with the partial reply, and the error reply still carries its confirmations and notices.

The link flow's approval is the one handler registered outside a tool (`IdentityService.finish_link`).

Tools act as the friend through `ToolContext.linked_user()`: the caller's active link, whose `seerr_user_id` goes out as Seerr's `X-API-User`. Callers without one are refused.

## Prompt injection

Friends' messages and every tool result (titles, overviews, file names, Seerr issue text) are untrusted. The system prompt states that tool results are data. The registry has no shell, HTTP passthrough or filesystem tools, so the worst an injected instruction can do is call a scoped tool the user already had access to, and destructive ones still need the button. The eval harness keeps an injection case.

## Replace flow

```
report ──▶ identify item (Tautulli session) ──▶ confirm with friend
       ──▶ client diagnosis (transcode reasons, codec support, subtitle burn-in)
              │ client cause found ──▶ advice, Seerr issue, stop
              ▼
       ──▶ file health check (ffprobe + partial decode, read-only mount)
              │ ok and single reporter ──▶ Seerr issue, stop
              ▼ failed, or 2+ reporters
       ──▶ replace_media(item, host, reason)   [destructive, capped, audited]
              mark grab failed (blocklist) ──▶ delete file ──▶ search
```

## Storage

SQLite, migrations numbered under `maester/store/migrations/`. Tables: `users`, `conversations`, `audit_log`, `reports`, `pending_actions`, `webhook_events`, `space_samples`, `preferences`. Nothing in the file is a source of truth for media; Seerr and the arrs are.

## Seerr webhook

`POST /webhooks/seerr` serves every Seerr notification type. The `Authorization` header must equal `SEERR_WEBHOOK_SECRET`; with no secret configured, every call is refused. The payload is parsed into a `SeerrNotification` and dispatched by type through `seerr_routes()` (`maester/seerr_events.py`); a route's handler returns notices, which go out through the bot as the `Notifier`. Types without a route are acknowledged and ignored.

Deduplication is opt-in per route, for handlers whose repeat would reach a person twice. Such a route claims the event in `webhook_events` (type plus the request or issue it concerns) before its handler runs, so a repeat inside its window (15 minutes for the ready DM, sized for Seerr's rescans) is acknowledged without acting. A later repeat is news and gets through, and idempotent routes (a report-row update) take every delivery. The claim is released when the handler fails or one of its notices could not be delivered.

| Type              | Handler         | Effect                                                                   |
| ----------------- | --------------- | ------------------------------------------------------------------------ |
| `MEDIA_AVAILABLE` | `ready_to_watch`| DMs the linked requester: title, version (1080p or 4K), a Plex deep link; dedupes for 15 minutes |

## Deployment

Docker Compose on Meleys at `/volume1/docker/maester`, next to `stripe-bridge`. Media shares are bind-mounted read-only for the health check. `scripts/deploy-nas.sh` rsyncs the repo over the SMB share and excludes `.env` and `maester-data/`.
