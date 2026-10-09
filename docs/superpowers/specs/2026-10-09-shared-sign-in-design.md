# Shared sign-in: rookery's first version, and luwin trusting it

Date: 2026-10-09. Status: approved in conversation, awaiting written review.

Replaces section 2 (Identity) of the web chat spec
(`2026-09-30-web-chat-design.md`) and its `/login` page in section 5. The
rest of that spec (chat, inbox, admin, the rest of the web app) stands.

Paths: `apps/rookery/` is new; luwin's module paths such as
`luwin/web/auth.py` are relative to `apps/luwin/api/`.

## Goal

luwin and rookery share one sign-in. A friend signs in once, with their
Plex account, and is signed in to both. rookery owns the sign-in; luwin
trusts it instead of running a Plex PIN flow of its own.

Success: a friend opens luwin, is sent to rookery, signs in with Plex in
the same tab, lands back in luwin signed in, and stays signed in to both
for 30 days. Signing out in either place signs them out of both. The
owner of the Plex server is luwin's admin without any setup.

## Decisions made

| Question | Decision |
| --- | --- |
| What an account is | rookery's own user id, with the Plex account linked to it as a login. Email or passkey logins can be added later as more logins, without migrating users |
| Who owns what | rookery authenticates (who you are). Each app authorizes (what you may do): luwin keeps tiers, owner detection, Seerr matching and overrides |
| Who can sign in | Anyone Plex authenticates. luwin refuses strangers with the "ask for an invite" message, which needs to know who they are |
| How luwin trusts rookery | An opaque session cookie set by rookery, which luwin checks with rookery's internal endpoint and caches for 30 seconds |
| Hosting | Not decided. Built for subdomains of one dedicated parent domain; one origin needs only a base path for rookery's web build (section 1). If the apps end up on unrelated domains, luwin's one seam is replaced by a redirect-based login and nothing else in luwin changes |
| rookery's scope | Sign-in only: Sign in with Plex, the shared session, sign-out, and the internal session lookup. No account page, no access management |
| rookery's stack | NestJS on Fastify with SQLite, React on Vite: raven's stack and conventions |
| Plex tokens | rookery stores none. A friend's token is discarded right after sign-in; only luwin keeps the owner's `PLEX_TOKEN` |
| raven | Out of scope. It joins later the way luwin does |

The shared cookie was chosen over short-lived signed tokens (a refresh
flow, signing keys in two languages, sign-out that lags) and over rookery
as an OIDC provider (a provider and a client in every app, far beyond
sign-in only). Both stay open behind luwin's seam.

## 1. Shape and deployment

rookery is a new product, `apps/rookery/`, laid out like raven:

- `@rookery/server` in `apps/rookery/server`: NestJS 12 on Fastify,
  better-sqlite3, vitest. Port 8030.
- `@rookery/web` in `apps/rookery/web`: React 19 on Vite, SCSS modules,
  bun test with happy-dom. The server serves its build from `WEB_DIR`.
- `apps/rookery/Dockerfile` (built from the repo root, with its own
  `Dockerfile.dockerignore`), `docker-compose.yml`, `.env.example`,
  `CLAUDE.md` and `README.md`.
- No `libs/rookery/core` until a second consumer needs rookery's types.
- Unversioned for now, like raven.

### The session cookie

`maester_session`: HttpOnly, SameSite=Lax, path `/`, 30 days. Secure
whenever `PUBLIC_URL` is https, so local development works over http.

- With `COOKIE_DOMAIN` set, the cookie carries that `Domain` and every
  subdomain under it receives it (subdomain hosting).
- With it unset, the cookie stays on rookery's host (one origin, and local
  development, since cookies are not scoped by port).

Subdomains are what this version builds and tests for. One origin also
works for the cookie, but both apps serve `/api/*`, so the proxy would
give each its own path prefix; rookery's `PUBLIC_URL` would then carry
the prefix and its web build would need a matching base path. That
setting is added only if hosting settles on one origin.

Deploy rule: the parent domain is dedicated to the suite, such as
`*.maester.example.com`. The browser sends the cookie to every host under
`COOKIE_DOMAIN`, so Seerr, Wizarr or anything else on a public subdomain
must sit outside it.

### Network

luwin reaches rookery at its LAN address (`ROOKERY_URL`), as it reaches
every other service. Browsers are sent to `ROOKERY_PUBLIC_URL`. The proxy
or tunnel should not expose `/internal/*`; the service token guards it
either way.

## 2. rookery: sign-in

### Flow

One tab throughout, with no popups or polling, since most friends are on
a phone.

1. An app sends the browser to `<rookery>/login?return_to=<url>`. The page
   shows a "Sign in with Plex" button.
2. The button calls `POST /api/auth/plex/start` with `{return_to}`.
   - `return_to` is kept only if it is a rookery path (starting with one
     `/`) or an absolute URL whose origin is in `APP_ORIGINS`. Anything
     else becomes `/`.
   - rookery creates a strong PIN at plex.tv, saves a `pending_sign_ins`
     row with the PIN's id and code and `return_to`, and sets
     `rookery_pin`: the row's random id, HttpOnly, SameSite=Lax, host-only,
     path `/auth/plex`, 15 minutes.
   - It returns `{auth_url}`: Plex's auth app URL with client id
     `maester`, the PIN code, product `maester`, and `forwardUrl` set to
     `<PUBLIC_URL>/auth/plex/callback`. The page navigates there.
3. Plex sends the browser to `GET /auth/plex/callback`. rookery loads the
   pending row named by `rookery_pin` and checks the PIN at plex.tv, up to
   five times a second apart, since the token can trail the redirect.
   - Token present: rookery fetches the Plex account (`id`, `username`,
     `email`, `thumb`) with it and discards the token. It finds the user by
     the `('plex', <id>)` login or creates both, refreshes the login's
     username and email and the user's `display_name` (the Plex username),
     email and thumb, creates a session, sets
     `maester_session`, deletes the pending row, clears `rookery_pin`, and
     answers 303 to `return_to`.
   - No token after the retries: 303 to `/login?error=not_approved`.
   - No cookie, or no live pending row: `/login?error=expired`.
   - plex.tv fails or times out: `/login?error=plex_unavailable`.
   Each keeps `return_to` on the way back to `/login`.

### Signing out

`<rookery>/logout?return_to=<url>` is a page that calls
`POST /api/auth/logout` with `{return_to}`. rookery deletes the session
row, clears the cookie with the same `Domain` it was set with, and returns
`{next}`, the validated `return_to` (or `/login`), which the page
navigates to.

### Routes

- `POST /api/auth/plex/start`: `{return_to?}` to `{auth_url}`.
- `GET /auth/plex/callback`: the redirect target above.
- `POST /api/auth/logout`: `{return_to?}` to `{next}`.
- `GET /api/me`: `{user: {id, display_name, email, thumb}}`, or 401.
- `POST /internal/session`: section 3.
- `GET /health`: ungated.

Write routes require `Content-Type: application/json`. rookery sends no
CORS headers, so a page on a sibling subdomain cannot make a credentialed
JSON request: the browser's preflight fails. Responses under `/api/*` and
`/internal/*` set `Cache-Control: no-store`.

### Data

SQLite with append-only migrations tracked by `user_version`, as raven's
`DatabaseService` does.

- `users`: `id` (random UUID, text), `display_name`, `email`, `thumb`,
  `created_at`, `last_seen_at`.
- `logins`: `provider`, `subject`, `user_id` (references `users`),
  `username`, `email`, `created_at`, `last_used_at`. Primary key
  `(provider, subject)`. Plex is `('plex', <Plex account id>)`.
- `sessions`: `token_hash` (primary key), `user_id`, `created_at`,
  `expires_at`, `last_seen_at`. The cookie value is 32 random bytes,
  base64url; only its SHA-256 is stored, so a leaked database hands out no
  sessions. A session lasts a fixed 30 days from sign-in. Expired rows are
  pruned whenever a session is created. No signing secret is needed: the
  token cannot be guessed and is looked up by its hash.
- `pending_sign_ins`: `id`, `plex_pin_id`, `plex_code`, `return_to`,
  `created_at`. Rows older than 15 minutes are pruned whenever a sign-in
  starts.

### Pages

- `/login`: the button, and a message for each `error`.
- `/logout`: signs out and moves on.
- `/`: "Signed in as <name>" with a sign-out button, or a redirect to
  `/login`.

### Config

| Variable | Required | What |
| --- | --- | --- |
| `PUBLIC_URL` | yes | rookery's own public origin, for `forwardUrl` and the Secure flag |
| `SERVICE_TOKEN` | yes | The bearer token apps present to `/internal/session` |
| `APP_ORIGINS` | no | Comma-separated origins `return_to` may point at, such as `https://luwin.maester.example.com` |
| `COOKIE_DOMAIN` | no | The parent domain for `maester_session`; unset for one origin |
| `PORT`, `HOST`, `DATA_DIR`, `WEB_DIR` | no | As raven's server reads them; `PORT` defaults to 8030 |

A missing required variable stops rookery on boot, naming it. The plex.tv
product and client identifier are fixed to `maester`, the same headers
luwin's plex.tv client sends.

## 3. rookery: the internal session lookup

`POST /internal/session` with `Authorization: Bearer <SERVICE_TOKEN>` and
`{token}`, the cookie's value. The token travels in the body so it stays
out of access logs.

- 200: `{user: {id, display_name, email, thumb}, plex: {id, username,
  email}, expires_at}`. The session's and user's `last_seen_at` move
  forward, at most once a minute.
- 404: `{reason: "unknown" | "expired"}`.
- 401: the bearer token is missing or wrong, compared in constant time.

There is one service token. raven, when it joins, gets its own.

## 4. luwin: trusting the session

### Config

`ROOKERY_URL` (LAN address), `ROOKERY_PUBLIC_URL` and
`ROOKERY_SERVICE_TOKEN` join `REQUIRED`. The web chat spec's
`PLEX_CLIENT_ID`, `SESSION_SECRET` and `PUBLIC_URL` are dropped: luwin
runs no sign-in, keeps no sessions, and its page knows its own address for
`return_to`.

### The seam

- `luwin/clients/rookery.py`: a `Rookery` protocol with
  `session(token) -> Account | None`, an HTTP client, and a `FakeRookery`
  that can be taken down, like the other clients' fakes. `None` means
  unknown or expired; an unreachable rookery raises.
- `luwin/web/auth.py`: the `SessionVerifier`, which reads
  `maester_session`, asks rookery, and caches each account for 30 seconds
  keyed by the token's hash. A FastAPI dependency turns the account into
  luwin's user and tier, or refuses:
  - No cookie, unknown or expired: 401 `{reason: "signed_out", sign_in:
    "<ROOKERY_PUBLIC_URL>/login"}`.
  - rookery unreachable and nothing cached: 503 `{reason:
    "sign_in_unavailable"}`, so the page says to try again instead of
    looping through sign-in.
  - UNLINKED, on the chat and inbox routes: 403 `{reason: "unlinked",
    admin: <the owner's Plex username>}`.

If the apps ever land on unrelated domains, a different `SessionVerifier`
(signed tokens or OIDC) replaces this one and the routes behind it do not
change.

### Users and tiers

luwin's `users` table, in the fresh initial migration:

- `user_id` holds rookery's user id.
- `status` and `linked_at` go. `plex_id`, `thumb`, `last_seen_at` and
  `seerr_checked_at` join `plex_email`, `plex_username`, `seerr_user_id`,
  `tautulli_user_id`, `tier_override` and `created_at`.
- Each verified account upserts the row, refreshing Plex id, username,
  email and thumb.

Tier is resolved on every request, by the web chat spec's rules:

1. `tier_override` wins.
2. The owner of the Plex server is ADMIN. The owner's Plex id is looked up
   once at boot from `PLEX_TOKEN` (plex.tv `/api/v2/user`) and compared
   with the account's `plex.id`.
3. A Seerr user matching the account's email or Plex username is FRIEND.
   The match, and the Tautulli user id beside it, are cached on the row:
   re-checked daily once matched, and at most once a minute while not, so
   a friend invited a minute ago gets in on their next message.
4. TRUSTED comes only from the override.
5. Anyone else is UNLINKED.

`chat/identity.py` keeps `IdentityService` and `resolve_tier`, gains the
upsert and Seerr refresh above, and drops `start_link`, `whoami`,
`LINK_TTL` and `ALREADY_LINKED`. `LinkStatus`, `SeerrUserTaken` and the
`link_account` tool go. `NotLinked` stays as the error tools raise for an
UNLINKED user.

### Routes

- `GET /api/me`: `{user: {id, display_name, thumb}, tier}`, or the 401
  above.
- The web chat spec's tier route becomes
  `POST /api/admin/users/{user_id}/tier`, keyed by rookery's user id.
- No sign-in or sign-out routes. luwin's page links to
  `<ROOKERY_PUBLIC_URL>/logout?return_to=<its own URL>`.

Write routes require `Content-Type: application/json` and luwin sends no
CORS headers, as in section 2.

### The web app

The web chat spec's `/login` page is gone. On a 401 the app navigates to
`sign_in` with `return_to` set to the current URL. Before it does, it
notes the time in session storage; if another 401 arrives within a minute
of coming back, it shows "You're signed in, but luwin can't see the
session. Check `COOKIE_DOMAIN`." instead of redirecting again. Session
storage reads and writes are wrapped, and without it the app redirects as
usual.

## 5. Testing

### rookery (vitest, a fake plex.tv client injected by DI token)

- Start: an allowed `return_to` is kept, a foreign origin or `//host`
  becomes `/`; a pending row and `rookery_pin` are set; `auth_url` carries
  the client id, code and `forwardUrl`.
- Callback: a claimed PIN creates the user and login, stores a hash and
  never the token, sets the cookie with HttpOnly, SameSite=Lax, path `/`,
  30 days, Secure only for an https `PUBLIC_URL` and `Domain` only with
  `COOKIE_DOMAIN`, and answers 303 to `return_to`. The same Plex id twice
  is the same user. A token that appears on a retry signs in. Not
  approved, a missing or stale pending row, and plex.tv failing each land
  on `/login` with their error.
- Logout: the row is deleted and the cookie cleared with the same
  `Domain`; `next` is validated like `return_to`.
- Internal: a missing or wrong bearer token is 401, an unknown or expired
  session 404, a live one 200 with `user` and `plex`; `last_seen_at`
  moves at most once a minute.
- Pruning: expired sessions and stale pending sign-ins go.
- Config: a missing required variable stops boot, naming it.
- Static app: a client route returns `index.html`, an asset returns
  itself, an unknown `/api/*` path is a JSON 404.
- Web: the login page's message per error, and the logout page posting
  and navigating to `next`.

### luwin (pytest, `FakeRookery`)

- Verifier: no cookie, unknown and expired are 401 with `sign_in`;
  rookery down with nothing cached is 503; a cached account skips the
  second call within 30 seconds and is asked again after.
- Tiers: the owner is ADMIN; a Seerr match is FRIEND; a stranger gets 403
  `unlinked` with the admin's name; an override wins on the next request;
  an unmatched user is re-checked after a minute; the row refreshes from
  the account.
- The link flow's tests go. Evals and every other test are unchanged.

## 6. Docs and wiring

- rookery: `README.md` (what it is, running it, deploying it on Meleys,
  the dedicated parent domain, keeping `/internal/*` off the proxy),
  `CLAUDE.md`, `.env.example`.
- CI: rookery's scripts join their `nx.includedScripts`, so typecheck,
  lint, format, test and build run through Nx with the rest. A smoke-test
  job builds the image and checks `/health`, like raven's.
- luwin: `.env.example` gains the `ROOKERY_*` variables; `README.md`,
  `docs/architecture.md` and `docs/nas-deployment.md` say sign-in lives
  in rookery.
- Root: the `CLAUDE.md` project table gains `@rookery/server` and
  `@rookery/web`; `README.md` drops "(planned)" from rookery.
- The tracker catalog is left to the web chat spec's step 7.

## Order of work

One PR per step; every app stays bootable.

1. rookery scaffold: both projects, config, the database and its first
   migration, `/health`, serving the web build, Docker, compose and CI.
2. rookery sign-in: the plex.tv client and its fake, pending sign-ins, the
   callback, sessions, logout, `/api/me`, and the three pages.
3. rookery's internal session lookup.
4. luwin: the rookery client and fake, the verifier, the `users` changes,
   tiers, `/api/me`, and the link flow's removal. It depends only on the
   contract in section 3, so it can be built against the fake alongside
   steps 1 to 3. It deploys after rookery is running on Meleys, since
   luwin refuses to boot without the `ROOKERY_*` variables.

The web chat spec then continues from its step 4. Its step 2 shrinks to
the `inbox` table, and its step 3 is replaced by step 4 here.

## Out of scope

- raven joining the sign-in.
- Email or passkey logins, an account page, signed-in devices.
- Access management: invites, access requests and expiry stay in luwin.
- Signed tokens or OIDC.
- Choosing the domain, and configuring the proxy or tunnel.
