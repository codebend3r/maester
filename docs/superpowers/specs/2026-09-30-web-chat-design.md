# luwin's web chat

Date: 2026-09-30. Status: approved in conversation, awaiting written review.
Amended 2026-10-01 for the Nx workspace
(`2026-10-01-nx-workspace-design.md`): the frontend is React on Vite instead
of Next.js, served by the maester container instead of a second one, and
every path now sits under `apps/maester/`.
Amended 2026-10-03 by the suite rename
(`2026-10-02-suite-rename-design.md`): the assistant is luwin, in
`apps/luwin/`. Its first chat surface is gone and its store started fresh,
keyed by `user_id`, which covers most of steps 1 and 2 below. luwin is now
meant to be a standalone chat app and a helper window inside raven and
rookery, and rookery may own sign-in, so sections 2 and 5 are revisited
before they are built.

Paths: module paths such as `maester/chat/service.py` and `tests/` are
relative to `apps/maester/api/`; `docs/`, `.env.example` and compose are
relative to `apps/maester/`.

## Goal

luwin gets its own chat app. Friends open a web page, sign in with
Plex, and chat with maester to request movies and shows or to report a
title that won't play. The admin signs in the same way and gets an
approval queue.

Who it is for: the same people as today, the Plex server's friends, most
of them away from the LAN and on a phone. Success is a friend opening the
page, signing in once, and getting the same request and report flows the
first chat surface gave, with ready notices waiting for them on their next visit.

## What stays

The agent loop, tool registry and tiers, guardrails, rate limits, memory,
the Seerr, Plex, Wizarr and per-host arr clients, playback diagnosis and
the guarded replace flow, performance diagnostics, the SQLite store, the
Seerr webhook, the eval harness, and the Docker deploy on Meleys. The
chat service (`maester/chat/service.py`) and the `Notifier` protocol
(`maester/notify.py`) were built as the seam for this swap and keep their
contracts.

## Decisions made

| Question | Decision |
| --- | --- |
| Sign-in | Plex PIN flow, owned by the API |
| Admin approvals | An admin view in the same web app |
| Ready and resolved notices | In-app inbox, no email |
| Frontend | React on Vite in `apps/maester/web/`, with weirwood's web tooling and conventions |
| Hosting | The existing maester container serves the built app; one HTTPS origin via the reverse proxy or tunnel |
| Ownership of auth and sessions | FastAPI owns everything; the web app is a thin client |
| Existing data | Not migrated; users start fresh, keyed by Plex account id |

The "FastAPI owns everything" choice was made over a Next.js
backend-for-frontend (auth split across two languages, a service token
to trust) and over server components forwarding cookies (complexity a
chat page does not need). The tier rules, store and tests already live in
Python, so the security-relevant logic stays there and the web side
stays a UI project. Nothing in the app uses server rendering, so the
amendment drops Next.js for a static React build the API serves, which
matches weirwood's web app in the same workspace.

## 1. Deployment and routing

One service in `docker-compose.yml`, as today: `maester`, the FastAPI app
on port 8020. It serves the API under `/api/*`, `/health`, and the built
web app for every other path, with `index.html` as the fallback for the
app's client-side routes. The image builds the web app in a Bun stage from
the repo root and copies its `dist/` in.

The reverse proxy or tunnel exposes one HTTPS origin and forwards
everything to `maester`. One origin means the session cookie needs no CORS.
The proxy itself is out of scope; `PUBLIC_URL` tells the API what origin it
is served as.

Local development: Vite's dev server proxies `/api/*` to
`http://localhost:8020` so the same frontend code runs unchanged.

The API keeps `/health`. The Seerr webhook moves to `/api/webhooks/seerr`
so the one proxy rule covers it; the Seerr notification agent's URL is
updated in the docs.

## 2. Identity

### Sign-in

Plex's PIN flow, owned by the API. The API is a Plex app with a fixed
client identifier (`PLEX_CLIENT_ID`, generated once, kept in `.env`) and
product name "maester".

- `POST /api/auth/plex/start` creates a strong PIN at plex.tv and returns
  `{pin_id, auth_url}`. The browser opens `auth_url`.
- `POST /api/auth/plex/complete` with `{pin_id}` checks the PIN once. While
  the PIN has no token it returns `{status: "pending"}`. When it does, the
  API fetches the Plex account (`id`, `username`, `email`, `thumb`),
  creates a session, sets the cookie and returns `{status: "ok", user}`.
  The friend's Plex token is discarded immediately and never stored.
- `POST /api/auth/logout` deletes the session and clears the cookie.
- `GET /api/me` returns the signed-in user and tier, or 401.

### Tier

Resolved on every request, so a change takes effect immediately.

1. A `tier_override` on the user row wins, as today.
2. The account that owns the Plex server is ADMIN. The owner is found once
   at boot from `PLEX_TOKEN` (`/myplex/account` on the server, or
   plex.tv `/api/v2/user` with that token) and compared by Plex id.
3. An account matching a Seerr user by email or Plex username is FRIEND.
   Seerr already imports the server's Plex friends, so this is the same
   "who has access" answer the link flow used to reach through the admin.
4. TRUSTED comes only from the override.
5. Anyone else is UNLINKED and is refused the chat with a reason.

### Session

A random 32-byte id in a cookie named `maester_session`: httpOnly, Secure,
SameSite=Lax, path `/`, 30 days. Sessions live in a new `sessions` table
(`id`, `user_id`, `created_at`, `expires_at`, `last_seen_at`). Expired
sessions are pruned when a new one is created. `SESSION_SECRET` signs the
cookie value so a tampered cookie is rejected before a database lookup.

### Store changes

- `users` is keyed by `plex_id` (text). Columns: `plex_username`,
  `plex_email`, `thumb`, `seerr_user_id`, `tautulli_user_id`,
  `tier_override`, `created_at`, `last_seen_at`. The Seerr match is
  refreshed at sign-in and cached on the row for tools that need the
  Seerr user id.
- `LinkStatus`, the link status on `users`, `SeerrUserTaken` and the
  one-link-per-Seerr-user migration go away. `NotLinked` stays as the
  error tools raise for an UNLINKED user.
- Every table's chat account column (`conversations`, `audit_log`,
  `reports`, `pending_actions`, `held_calls`) is `user_id`, holding the
  Plex id. Ready notices go to the inbox (section 3).
- Since nothing is migrated, this is one new initial migration replacing
  `001` to `007`, and the deployed `maester-data/maester.db` is removed
  on deploy.

### Code changes

`chat/identity.py` keeps `IdentityService` and `resolve_tier`, drops
`RoleMap`, `start_link`, `whoami` and `LINK_TTL`, and gains
`sign_in(account)` (upsert the user, refresh the Seerr match) and
`user_for(session_id)`. The `link_account` admin tool is removed.

## 3. Chat and inbox API

All routes need a valid session. An UNLINKED user gets 403 with
`{reason: "unlinked"}` so the page can show the invite message.

- `POST /api/chat` with `{text}` streams Server-Sent Events:
  - `text`: one chunk of the reply, split as today's `split_reply` does.
  - `buttons`: `{pending_id, kind: "confirm" | "choice", summary,
    options}` for a destructive tool's confirmation or a tool's choice
    picker.
  - `notice`: `{text}` when the turn escalated to the admin (the
    `ESCALATED` message).
  - `done`: `{turn_id}`; `error`: `{ref}` on a failed turn, using the
    existing error reference.
  This wraps `ChatService.reply()` without changing it.
- `POST /api/chat/decide` with `{pending_id, choice}` calls
  `ChatService.decide()`, which already decides who may press what. The
  response streams the same events, since an approved action runs through
  the agent.
- `GET /api/chat/history?before=<id>&limit=50` returns recent turns from
  `conversations` for reload.

### Inbox

A `WebNotifier` implements `Notifier`:

- `DirectMessage(to, text, about)` becomes a row in a new `inbox` table:
  `id`, `user_id`, `kind` (`dm`), `text`, `about` (JSON: media type, TMDB
  id, 4K, title), `pending_id` (null), `created_at`, `read_at`.
- `AdminPost(text)` and `ApprovalPost(text, pending_id)` become rows for
  the admin user with `kind` `admin` and `approval`.
- `deliver()` never raises and returns nothing undeliverable, since a row
  insert is the delivery. If the admin has never signed in, admin notices
  are filed under the owner's Plex id and appear on first sign-in.

Routes:

- `GET /api/inbox` returns unread notices, newest last, and `unread`.
- `POST /api/inbox/read` with `{ids}` marks them read.
- `POST /api/inbox/{id}/report` starts the report flow for a ready
  notice: it builds a report message from `about` (title, copy and
  TMDB id) and runs it through `ChatService.reply()` as that user,
  streaming events like `/api/chat`.

`UNLINKED_HELP` tells a stranger to "ask the admin or the friend who
invited you for an invite".

### Protection

The existing per-user `RateLimiter` keys by user id and carries over
unchanged. Every write route requires `Content-Type: application/json`,
which with SameSite=Lax is sufficient CSRF protection for a same-origin
app. Responses set `Cache-Control: no-store`.

## 4. Admin

Gated on the ADMIN tier; the API enforces it regardless of what the page
shows.

- `GET /api/admin/pending` lists open `pending_actions`: id, kind, action,
  summary, requester (Plex username), age.
- `POST /api/admin/pending/{id}` with `{decision: "approve" | "deny"}`
  calls `ChatService.decide()` as the admin. It records who decided, runs
  the approved tool, and files the requester's notice, as today.
- `GET /api/admin/users` lists known users with derived tier, override,
  Seerr match and last seen.
- `POST /api/admin/users/{plex_id}/tier` with `{tier: "friend" |
  "trusted" | "admin" | null}` sets or clears the override, replacing the
  `/tier` command.

Admin tools that already run through chat (kill switch, digests, limits)
keep doing so from the admin's chat box.

## 5. The web app

`apps/maester/web/` (`@maester/web`): React 19 on Vite, TypeScript, SCSS
modules, no UI library, client-side routes. Tooling and code conventions
follow weirwood's web app (`apps/weirwood/web`): oxlint, oxfmt, `tsgo`,
targets inferred from `package.json` scripts.

- `/login`: a "Sign in with Plex" button. Calls start, opens `auth_url`
  in a new tab, polls complete every two seconds until `ok`, then goes to
  `/`. An `unlinked` result shows "ask for an invite" with the admin's
  Plex username.
- `/`: the chat. Loads history and the inbox; unread notices render as
  messages from maester with a badge, and a ready notice carries a
  "Something's wrong" button that posts to `/api/inbox/{id}/report`.
  Sending a message opens the SSE stream and appends chunks as they
  arrive; `buttons` events render inline and post to `/api/chat/decide`.
  Mobile-first layout: a scrolling message list and a fixed composer.
- `/admin`: the approval queue with Approve and Deny, the admin inbox, the
  users table with a tier control, and the chat box. Linked from the
  header only when `/api/me` says ADMIN.
- A small client module wraps fetch, SSE parsing and the JSON content
  type. No global state library; React state per page.
- `vite.config.ts` proxies `/api/*` to `API_URL` (default
  `http://localhost:8020`) in development only.
- Build: `vite build` to `dist/`. `apps/maester/Dockerfile` gains a Bun
  stage that installs the workspace and builds `@maester/web`, and the
  final image copies `dist/` to the directory FastAPI serves (`WEB_DIR`,
  unset in development, as weirwood's server does). No second container.
  CI runs `typecheck`, `lint:ts`, `lint:css`, `format:check` and `build`
  through Nx with the Python checks. No JS unit tests in this pass; the
  logic that matters lives in the API.

## 6. Removal and docs

Removed by the suite rename: the first chat surface's modules, tests,
dependency and settings, role-based tiers, emoji reactions and
`sent_messages`. Still to remove here: the link flow and the
`link_account` tool, once sign-in replaces them.

Config: `REQUIRED` becomes `ANTHROPIC_API_KEY`, `SEERR_URL`,
`SEERR_API_KEY`, `PLEX_URL`, `PLEX_TOKEN`, `PLEX_CLIENT_ID`,
`SESSION_SECRET`, `PUBLIC_URL`. `.env.example` follows.

Docs: `apps/maester/README.md`, `docs/architecture.md` and
`docs/nas-deployment.md` are rewritten for the web app and the Plex
sign-in. The Seerr
webhook URL in the README becomes `/api/webhooks/seerr`. In the roadmap
catalog (`scripts/catalog.py` at the repo root), E2 becomes "Web chat and identity" with
stories for sign-in, sessions and tiers, the chat API, the inbox, and the
web app; E6 and E7 lose their channel and role wording. Milestone M1's
sentence becomes "A friend can sign in and chat with maester, and it
answers using a read-only tool."

Existing branches `e6-admin-console` and `e7-onboarding-accounts` were
started against the first chat surface. They are not touched by this work;
whatever survives in them is rebased or re-cut afterwards.

## 7. Testing

Pytest, against a fake plex.tv client in `maester/clients`:

- Sign-in: start returns a PIN and URL; complete is pending until the fake
  PIN has a token, then sets a cookie; the owner becomes ADMIN; a Seerr
  match becomes FRIEND; a stranger is UNLINKED and gets 403 on chat; an
  expired, missing or tampered session gets 401; logout clears it.
- Chat: the SSE event sequence for a plain reply, a confirm, a choice and
  a failed turn, through the TestClient with the fake model; decide
  rejects the wrong user; history pages.
- Inbox: `WebNotifier` files DMs, admin posts and approvals to the right
  user and never raises; the report route runs the report message as
  the user.
- Admin: pending lists and decides; non-admin gets 403; tier override
  changes the next request's tier.
- Seerr webhook: one case where a ready notification lands in the
  requester's inbox with `about` filled.
- Static app: with `WEB_DIR` set, a client route returns `index.html`,
  an asset returns itself, and an unknown `/api/*` path is still a JSON
  404.
- Evals and every existing tool test are unchanged.

## Order of work

The first chat surface comes out first, because the store and identity
changes break its code, and the app must stay bootable at every step. After that the
API is built before any UI, so each step is testable with curl. One PR
per step.

1. Done in the suite rename: the first chat surface, its tests,
   dependency and settings are deleted; a `LogNotifier` stands in so the
   webhook still works; the app boots as the web server and the jobs.
2. Store: `users` by Plex id, `sessions` and `inbox` on top of the fresh
   initial migration, which already has `user_id` everywhere.
3. Identity: fake and real plex.tv client, `sign_in`, sessions, tiers, the
   auth routes and `/api/me`.
4. Chat: SSE `/api/chat`, `/api/chat/decide`, history.
5. Inbox: `WebNotifier` replaces the stand-in, the inbox routes, the
   report route, the Seerr webhook wired to it.
6. Admin routes.
7. Config, compose, docs and the roadmap catalog.
8. Web app: scaffold and login, then chat, then admin, then the Bun stage
   in the maester image and FastAPI serving the build.
