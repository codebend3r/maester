# Suite sign-in on Supabase

Date: 2026-10-17. Status: draft, open for revision before implementation.

## Context

Today the suite's sign-in is rookery: a NestJS server that signs people in with a Plex PIN and mints an opaque `maester_session` cookie. Only luwin checks that cookie, through `POST /internal/session`. raven has no accounts at all: a library PIN, an admin password, and one shared set of progress and favourites. rookery isn't deployed anywhere yet. We are dropping Plex sign-in and moving the whole suite (rookery, raven web, server and desktop, luwin) onto Supabase Auth. People get the full email and password workflow (sign up, verify email, sign in, forgot and reset password, sign out), and Google sign-in comes last as an add-on.

## Decisions (from the user, 2026-10-17)

- **Supabase:** a new `maester` project in the Codebend3r org (Pro plan, about $10 a month). Auth config, hooks and tables live as code in the repo and run locally with the Supabase CLI.
- **Single sign-on:** a shared parent domain. rookery hosts every sign-in page. The apps sit on subdomains of one domain and share the Supabase session cookie, so one sign-in covers every app. localhost works in dev, because cookies ignore ports. Netlify deploy previews stay signed out. Desktop signs in inside the app.
- **Sign-ups:** anyone can sign up and verify their email, but the apps refuse them until an admin approves them on a rookery admin page.
- **raven:** sign-in is required, for approved accounts only. Progress, plays, watched and favourites become per account, and today's rows go to the owner. An admin role replaces `ADMIN_PASSWORD`. The library PIN stays.
- **luwin:** only its sign-in moves. It verifies Supabase tokens, and the owner and friends are matched by account email instead of Plex account. Its Plex, Seerr and Tautulli tools stay.
- **Plex:** Plex sign-in goes everywhere. raven's Plex-style file naming (`{edition-…}`, `{tmdb-…}`, extras folders) is a file convention, not Plex, and stays.
- **Delivery:** a stack of PRs, one per step, built by subagents, with spikes first.

## Architecture

```
rookery.<domain> (static SPA, Netlify)        raven.<domain> (Netlify)          luwin
  login, signup, confirm, forgot, reset,        no sign-in page; redirects         verifies JWT
  pending, account, admin approvals             to rookery when signed out         (PyJWT, JWKS)
        |  @supabase/ssr browser client                |  same cookie                  |
        +------ cookie `maester-auth`, Domain=<domain> +-------------------------------+
        |                                              |
        v                                              v  /api proxied to Vhagar (Funnel)
  Supabase Auth (maester project)  <---JWKS---  raven server: Bearer, or the cookie on GET/HEAD only
  members table + RLS + RPCs                     raven desktop: session in main, Bearer, mpv on tickets
  Custom Access Token Hook adds claim  maester: { status, role }
```

- **Identity:** Supabase `sub` (UUID). Membership lives in `public.members`. A trigger creates a pending row when an email is confirmed. The access token hook copies `status` and `role` into a `maester` claim. Servers verify tokens locally against JWKS and never refresh them; browsers refresh.
- **Email links** are `token_hash` links handled by `verifyOtp` at rookery `/auth/confirm`, so a link opened in another browser still works. PKCE `/auth/callback` arrives with Google.
- **Admin writes** go only through security definer RPCs (`list_members`, `set_member_status`, `set_member_role`), which check `private.is_admin()` against the table, not the possibly stale token. RLS allows reads only.
- **CSRF in raven:** the cookie never authorizes a write. Every non-GET needs `Authorization: Bearer`, and a sibling subdomain can't set that without a preflight raven never answers.

## Nx reorganization

| Project | Change | Why |
|---|---|---|
| `@rookery/supabase` (`apps/rookery/supabase`) | **Add.** The CLI's `supabase/` folder as an Nx project: `config.toml`, migrations, email templates, seed, pgTAP tests. Scripts `db:keys`, `db:start`, `db:start:ci`, `db:stop`, `db:reset`, `test:db`, `lint:db`, `deploy` (`deploy:db` then `deploy:config`). The CLI runs with `--workdir ..`. `supabase` CLI pinned exactly, and added to the root `trustedDependencies` | Auth as code, beside the product that owns sign-in |
| `@shared/auth` (`libs/shared/auth`) | **Add.** Runs anywhere (`types: []`), no deps. `MEMBER_STATUSES`, `MEMBER_ROLES`, `Membership` union, `SuiteClaims` and `isSuiteClaims`, `membershipOf`, `AUTH_COOKIE = 'maester-auth'`, `supabaseIssuer`, `supabaseJwksUrl`, `ROOKERY_PAGES` and `rookeryUrl({ rookeryUrl, page, returnTo })`, the `Refusal` union and `isRefusal`, the `SessionCheck` union | One contract for every app; raven, rookery and luwin (mirrored in Python) speak it |
| `@shared/auth-web` (`libs/shared/auth-web`) | **Add.** Browser and React. `createSuiteClient({ supabaseUrl, publishableKey, cookieDomain, isSecure })` over `@supabase/ssr` with a fixed cookie name, `createSessionStore({ auth })`, `useSuiteSession({ store })` on `useSyncExternalStore`, `goToRookery(...)` | Two consumers, rookery web and raven web. Kept separate from `@shared/auth` so DOM code and supabase-js stay out of servers |
| `@shared/server` | **Keep and extend** with `src/session.ts`: `readAccessToken({ authorization, cookie })` (Bearer first, then the chunked `maester-auth.0..n` cookie with its `base64-` prefix) and `createSessionVerifier({ supabaseUrl, keys, clockToleranceSeconds })` on `jose` (`createRemoteJWKSet`, `iss`, `aud: 'authenticated'`, ES256/RS256), returning `SessionCheck` instead of throwing | After rookery's server goes, raven server is its only consumer. Folding it into raven is churn that collides with the raven PRs, so reword its CLAUDE.md paragraph and revisit later |
| `@rookery/server` | **Delete,** with `apps/rookery/Dockerfile`, `.dockerignore`, `docker-compose.yml` and its smoke-test entry. `safeReturnTo` and its test move to `@rookery/web` | Supabase is the server now; rookery web is static |
| `@raven/core` | Depends on `@shared/auth` for the refusal contract. Adds `isMe`, `isAuthConfig`, an `accessToken` hook on `createApiClient` (sent only to its own origin, never to media origins), `ApiError.refusal`, `getMe` and `getAuthConfig`. Drops the admin lock calls and guards | One source of truth for the refusal bodies |
| `@raven/ui`, `@raven/mpv` | `UnlockDialog` loses its admin password mode. mpv is unchanged | |

Also considered: merging rookery's styles into `@raven/ui`. Not doing it, because the tokens differ and the desktop spec keeps `@raven/ui` raven-only.

Path changes to make alongside: `apps/raven/Dockerfile` and `Dockerfile.dockerignore` (add `libs/shared/auth`), the root `package.json` (`dev:rookery` runs `@rookery/web:dev` only), the root `CLAUDE.md` project table and `@shared/server` paragraph, `README.md`, `.claude/skills/create-new-worktree/SKILL.md`, `apps/raven/CLAUDE.md`, and `bun.lock`.

## Part A: Supabase project as code (`apps/rookery/supabase`)

- **`config.toml`:**
  - `site_url` is `http://localhost:5180`, and the redirect allowlist holds rookery only (`/**`). `[remotes.production]` gives the cloud `site_url`, redirect URLs and SMTP (`env(SUPABASE_AUTH_SMTP_PASS)`).
  - `jwt_expiry = 3600`, refresh token rotation with a 10 s reuse interval.
  - `enable_confirmations`, `double_confirm_changes` and `secure_password_change` are all on. luwin trusts the `email` claim, so this must hold.
  - Minimum password length 10, plus leaked-password protection.
  - Rate limits set. `[auth.sessions] inactivity_timeout = "720h"`.
  - `[auth.hook.custom_access_token]` points at `public.custom_access_token_hook`.
  - Google is present but `enabled = false` until the last PR.
  - Storage, realtime, edge runtime and analytics are off. Mailpit is on locally. `signing_keys_path` points at a gitignored ES256 key from `db:keys`, so local JWKS matches cloud.
- **Templates:** `confirmation`, `recovery`, `email_change`, `password_changed`. Each link is `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=…`, and `redirectTo` is always `<rookery>/auth/confirm?return_to=…`.
- **Migration `members`:**
  - The table, its check constraints (`admins_are_approved`) and the `private.is_admin()` function.
  - The `enrol_confirmed_user` trigger on `auth.users`, which fires on insert or on update of `email_confirmed_at` and `email`, and keeps the email in sync.
  - RLS: read your own row, admins read all, `supabase_auth_admin` reads for the hook.
  - The three RPCs. You can't change your own row, and revoking resets the role.
  - Optional, if spike S11 holds: revoking deletes the target's `auth.sessions`.
- **Migration `access_token_hook`:** plain plpgsql that never raises. A missing row gives `pending`/`member`. Execute is granted to `supabase_auth_admin` only.
- **Seed (local):** `admin@`, `friend@`, `waiting@` and `gone@maester.test`, with one dev password.
- **First cloud admin, from the runbook:** sign up, then run one `update public.members …` in the SQL editor, then sign in again. There's no "first sign-up becomes admin" logic, because it races.
- **pgTAP:** enrolment, RLS, RPC refusals, and the hook's claims and grants.
- **CI:** `test:db` and `lint:db` need Docker, so `verify` and `affected` skip them, the way they skip `e2e`. A new `🗄️ Supabase` job in `pull-request-checks.yml` runs them, and one sentence is added to the root `CLAUDE.md` rule.
- **Deploy is manual:** `supabase link`, then `bunx nx run @rookery/supabase:deploy`, with `db push` before `config push`. The dashboard is read-only by policy, because `config push` overwrites it.

## Part B: rookery web rewrite (`apps/rookery/web`)

- **Routes:**

  | Route | What it does |
  |---|---|
  | `/login` | Already signed in and approved with a `return_to`: forwards at once (the single sign-on bounce) |
  | `/signup` | Leads to `/check-email`, which has a resend button with a 60 s cooldown |
  | `/auth/confirm` | `verifyOtp`, then strips the token hash. Then: email goes to `/pending` or `return_to`, recovery goes to `/reset` |
  | `/forgot` | Same copy whether the account exists or not |
  | `/reset` | Set a new password |
  | `/logout` | Signs out with `scope: 'local'`, then goes to a safe `return_to` |
  | `/` | Account: email, status, app links, Sign out, Sign out everywhere, Admin link |
  | `/pending` | "Check again" calls `refreshSession` so the hook reissues the claim |
  | `/admin` | Tabs Waiting, Members, Removed. Approve, Remove access, Make admin, Remove admin, never on your own row |
  | `*` | Redirects to `/` |

- **`src/lib`:**
  - `env.ts`: `readSuiteEnv` reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, an optional `VITE_COOKIE_DOMAIN`, and `VITE_APP_ORIGINS` as `name=origin` pairs. That one list drives both the `return_to` allowlist and the account page's links. `envDir` is `apps/rookery`.
  - `suite.ts`: the client, session store and context.
  - `auth.ts`: the test seam, `createAuth({ client })`. Each method returns `{ kind: 'ok' } | { kind: 'failed'; problem }`.
  - `problems.ts`: Supabase error codes to `AuthProblem` to copy (`as const satisfies`), with no dashes.
  - `members.ts`: RPC wrappers plus the `isMemberRow` guard.
  - `returnTo.ts`: moved from the server, now on bun test.
  - `browser.ts`: `goTo` plus `replaceUrl`.
- **State** is discriminated unions throughout: `SuiteSession`, `FormState`, `ConfirmState`, `AdminState`. `RequireSession` guards the account, pending, reset and admin pages.
- **Components:** `Field`, `PasswordField`, `SubmitButton`, `Notice`. All grid, every motion inside `prefers-reduced-motion: no-preference`.
- **Plex removed:** `lib/api.ts`, all Plex copy and the Vite proxy go. `--color-plex*` is renamed `--color-lantern*` with the same values, and `--color-well` and `--color-ok` are added.
- **Netlify:** a new site with `netlify.toml` (build `bunx nx run @rookery/web:build`, SPA fallback, immutable assets). A small Vite plugin emits `_headers` (CSP with `connect-src 'self' <supabase>`, `frame-ancestors 'none'`, no-referrer) and fails the build when the Supabase env is missing.
- **Tests:** bun with happy-dom. `renderAt(ui, { route, session })`, `spyOn(auth, …)` and `spyOn(browser, 'goTo')`, plus unit tests for problems, auth, returnTo, env and members.

## Part C: luwin (`apps/luwin/api`)

- **Token check:** `pyjwt[crypto]` pinned exactly. Keys are fetched with luwin's async `HttpClient` into `PyJWKSet.from_dict`.
- **New `luwin/clients/supabase.py`:** `SupabaseAuthClient`, which reads the JWKS document, plus `FakeJwks`. It replaces `clients/rookery.py`.
- **New `luwin/web/session.py`:**
  - `COOKIE = "maester-auth"`, the contract with `@shared/auth`.
  - `access_token(headers, cookies)` uses the same rules as the TS side.
  - `Account` holds the user id, email, status, role and display name.
  - `TokenVerifier` caches the key set, refetches on an unknown `kid` at most every 30 s, pins the algorithms, and checks `iss`, `aud`, a 30 s leeway and the `maester` claim. If no key set can be loaded at all it raises `SignInUnavailable`, which answers 503.
- **`web/auth.py`:** `Auth` gets `account`, `signed_in` (approved only), `linked` and `admin`. Refusals: 401 `signed_out` with `sign_in`, 403 `pending`/`revoked` with `account`, and 503.
- **`chat/identity.py`:** the owner is the account whose email matches plex.tv's owner email. Friends are matched to Seerr and Tautulli by email only. `plex_username` now comes from the Seerr match, and `plex_id`, `plex_email` and `thumb` go.
- **Migration `003_users_from_supabase.sql`:** rebuilds `users`, keyed by the Supabase `sub`, empty. rookery never ran, so there are no ids to carry over.
- **Config:** drop `ROOKERY_URL` and `ROOKERY_SERVICE_TOKEN`, and warn if either is still set. Add a required `SUPABASE_URL`. Keep `ROOKERY_PUBLIC_URL`.
- **Tests:** a P-256 key fixture with a `mint(**claims)` helper, plus `test_auth`, a new `test_session` (with cookie fixtures captured in spike S3), `test_identity`, `test_clients`, `test_config` and `test_store`.
- **Docs:** README, `architecture.md`, `nas-deployment.md`, `deferred.md` and `.env.example`. Friends must sign up with the email their Plex and Seerr accounts use.

## Part D: raven (`@raven/server`, `@raven/web`, `@raven/desktop`)

**Server authentication** (new `src/auth/`):
- **Config:** `signInConfig.ts` returns a `SignInConfig` union (`off` or `on`) from:
  - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `ROOKERY_URL`
  - an optional `AUTH_COOKIE_DOMAIN` and `RAVEN_WEB_URL`

  When it is unset, `/api/health` still answers (so the smoke test passes) and account routes answer 503.
- **Keys:** `JWKS` is provided through DI, so tests pass `createLocalJWKSet`.
- **Guard order:** `AuthGuard`, then `LockGuard`, then `AdminGuard`, all global.
- **Where the token comes from:** `tokenOf({ method, authorization, cookie })` takes Bearer first, and the cookie only on GET and HEAD. Those cover the requests the browser makes itself: `<img>`, a same-origin `<video>`, MSE fetches and `EventSource`. There is never a token in the query string.
- **New mark `@WithoutAccount()`:** only on `GET /api/health`, `GET /api/auth/config` and `GET /api/media-origins/ping`. `assertRoutesMarked` refuses it on a non-GET route, with `@AdminOnly`, with `PrivateBy` or on a parameterized path. A test pins that list of three.
- **Who is calling:** a `Caller` union (`account`, `ticket` or `anyone`) is kept in a `WeakMap` keyed by request. The `@SignedIn()` param decorator reads it, and repositories take `accountId` in their object parameters.
- **Media tickets:** always issuable (from a stored secret when `RAVEN_MEDIA_SECRET` is unset), bound to the account, and refused once that account is known to be revoked.
- **SSE** ends at token expiry so it reconnects with a fresh cookie.
- **Cache headers:** `/api` replies default to `private, no-cache` with `vary: Authorization, Cookie`.
- **New routes:** `GET /api/auth/config` (open) and `GET /api/me`. The `accounts` table holds `id`, `email`, `display_name`, `role`, `status` and `first_seen_at`/`last_seen_at`, upserted at most once a minute.

**The admin role replaces ADMIN_PASSWORD:**
- **Deleted:** `admin/adminService.ts`, `adminController.ts`, the `raven_admin` cookie, the `settings` admin secret (a migration deletes it), core's admin calls, `UnlockDialog`'s admin mode, and the desktop allowlist's admin calls.
- **`AdminGuard`** checks `role === 'admin'` and refuses with 403 `not_admin`.
- **`@ForViewers()`** now means "any approved account".
- **LockGuard** behaves as today: members get a 404 on locked libraries, and admins without the PIN get a 423.
- **The PIN cookie** is bound to the account, so the next person on the same browser doesn't inherit the unlock.
- **Web:** `useCanManage` comes from `meQuery`'s role in a new `lib/me.ts`. `lib/adminLock.ts`, `AdminLockSection` and `useFollowAdminLock` go.

**Per-account data** (append-only migrations):
- `playback_progress`, `favourites` and `plays` are rebuilt with an `account_id` (keys `(media_id, account_id)`, plus account indexes). Existing rows go to a sentinel account, `legacy`.
- The first approved admin who signs in adopts the `legacy` rows in one transaction, which is logged. Deploy note: the owner signs in first.
- Code changes:
  - `mediaSql.ts`: the watched fragments take `@account`.
  - `mediaRepository.ts`, `viewingRepository.ts` and `watchedRepository.ts`: `accountId` in every method's object parameter.
  - Controllers: media, home, favourites, watched, libraries, items and match.
  - Helpers: `itemChildren.ts` and `movieSplits.ts`.
  - Tests: `test/repositories.ts`, `test/queryPlans.ts` statistics and `listingPlans.test.ts` patterns, plus isolation tests where account B sees none of A's data.
- Server events carry no per-account data, so they stay shared.
- **Optional:** a `library_views` table makes library pin, sort, view and group-by per account.

**raven web:**
- **Boot:** `main.tsx` fetches `/api/auth/config`, builds the client with `createSuiteClient`, and wraps the app in a `SessionGate`. Signed out, the gate redirects to rookery `/login?return_to=` (with a one-minute loop guard). A 403 `pending` or `revoked` redirects to rookery `/pending`. A 503 shows an "unavailable" screen.
- **`lib/auth.ts`:**
  - `accessToken()` is synchronous, so the `keepalive` progress save never waits.
  - A 401 triggers one refresh, then a retry.
  - `retry` skips 401, 403 and 404.
  - SSE reopens after a refresh.
- **Settings:** a new Account section at the top with "Sign out", which goes to rookery `/logout?return_to=`.
- **Deleted:** `pages/SignInPage` and the `/sign-in` route.
- **Netlify:** the site moves to `raven.<domain>`, and `RAVEN_WEB_ORIGINS` gains it. The server's own copy of the web app redirects to `RAVEN_WEB_URL`.

**raven desktop:**
- **Session:** held in main.
  - `main/auth/authVault.ts` encrypts it into userData with `safeStorage`, and keeps it in memory only when encryption isn't available.
  - `main/auth/authSessions.ts` holds one `@supabase/auth-js` client per Supabase project. Servers on the same project share a session.
- **Servers:** the trust probe reads `GET /api/auth/config` instead of `/api/lock`. The desktop config moves to version 4 with each server's auth config.
- **Calls:** `serverCalls` adds Bearer. The allowlist splits into page routes and main-only routes (`getTicket`, `getAuthConfig`).
- **mpv** plays on `?t=` tickets, because ffmpeg reuses its first header on every seek and a 1-hour token would break seeks. `cookieHeader.ts` goes.
- **Renderer:**
  - `SignIn/SignInScreen.tsx` (email and password, naming the sign-in host) and `AwaitingApproval.tsx`.
  - "Create account" and "Forgot password" open rookery in the system browser.
- **Logs** also redact Bearer tokens, token JSON fields, `code_verifier`, `t=`/`code=` values, `maester-auth` and email addresses.
- **e2e:** the fixture server gains a fake GoTrue signed with `jose`, Bearer checks and tickets. `security.e2e.ts` checks that no secrets reach `raven.log`.

## PR stack

Each PR leaves main working when merged in order. Each is built by an implementer subagent and checked by a reviewer subagent.

| # | PR | Then deploy |
|---|---|---|
| 0 | Spec `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md`, which supersedes `2026-10-09-shared-sign-in-design.md` and gets a builder check. Then the spikes, with results written back. Then `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` | |
| 1 | `@rookery/supabase`: config, migrations, hook, templates, seed, pgTAP, `🗄️ Supabase` CI job, runbook | **D1**: create the `maester` project, set up SMTP and sender DNS, link and deploy, bootstrap the owner as admin |
| 2 | `@shared/auth`, `@shared/auth-web` and `@shared/server` `session.ts`, with contract tests against captured cookies | |
| 3 | luwin on Supabase | after D2 |
| 4 | rookery web on Supabase, with `@rookery/server` and its Docker, compose and smoke entry deleted, and docs updated | **D2**: Netlify site at `rookery.<domain>` |
| 5 | raven core contract, plus raven server auth that only observes: accounts table, `/api/auth/config`, `/api/me`, `@WithoutAccount`, account-bound tickets, cache defaults | |
| 6 | raven web: session gate, redirect to rookery, Bearer, sign out, `SignInPage` deleted | **D3**: raven web at `raven.<domain>`, Vhagar `.env` |
| 7 | raven desktop: in-app sign-in, Bearer from main, mpv on tickets | desktop release before PR 8 |
| 8 | raven server enforces sign-in (401, 403, 503; LockGuard through `Caller`; SSE expiry) | set the Vhagar env before merging, since `update.sh` deploys within 5 minutes |
| 9 | Admin role replaces `ADMIN_PASSWORD` across raven; the PIN cookie is bound to the account | |
| 10 | Per-account progress, plays, watched and favourites, with legacy adoption | the owner signs in first; approve others after this ships |
| 11 | Optional: per-account library views | |
| 12 | Google sign-in: Google Cloud OAuth client, `[auth.external.google]` turned on, rookery's "Continue with Google" and `/auth/callback`, a check of automatic linking by verified email, desktop Google through the system browser and PKCE on `raven://auth/callback` | |

**Spikes, run first and merging nothing:**

| # | Spike | What it settles |
|---|---|---|
| S1 | Local stack in the Nx layout | `--workdir`, the CLI postinstall in CI and Netlify, `db:keys` versus `signing_keys.json`, the minimal `-x` service set, `/**` redirect URLs |
| S2 | The hook's claim | Present on password sign-in, `verifyOtp` and refresh; when an approval shows up |
| S3 | `@supabase/ssr` cookies | The custom name, the `base64-` prefix, chunking; captured fixtures for the TS and Python tests |
| S4 | Cookie sharing | Across localhost ports and real subdomains in Chrome, Firefox and Safari; two subdomain tabs refreshing at once against the reuse interval |
| S5 | jose | Remote JWKS, ES256, error mapping, on Node 24 and vitest |
| S6 | PyJWT | `PyJWKSet` with Supabase's ES256 key; whether the JWKS endpoint needs an `apikey` |
| S7 | Netlify's `/api` proxy | Forwards the chunked cookie and Authorization, streams SSE, doesn't cache |
| S8 | Email links | Opened on another device; a recovery session with `secure_password_change`; resend cooldown |
| S9 | `config push` | Covers remotes, `env()` SMTP, templates and the hook; what only the dashboard can set |
| S10 | Types | `client.auth` and `client.rpc` fit the narrow ports without a cast |
| S11 | Revoke | A definer function can delete `auth.sessions` on Cloud |
| S12 | Seed | Local `auth.users` and `auth.identities` rows that can actually sign in |
| S13 | mpv | `?t=` tickets with sidecar subtitles and a seek an hour in |
| S14 | Electron | `@supabase/auth-js` in main, and whether `safeStorage` raises a keychain prompt in CI e2e |

## Calls made in planning, open for review

- **rookery's server:** deleted. rookery web becomes a static Netlify site.
- **`@shared/server`:** kept with one consumer.
- **The auth libs:** two new ones, not one.
- **Cookie:** fixed to `maester-auth`, not Supabase's default `sb-<ref>-auth-token`, so local and cloud match.
- **Email links:** `token_hash` plus `verifyOtp`, not PKCE.
- **Enrolment:** happens when the email is confirmed, so admins only see verified sign-ups.
- **raven's pending accounts:** sent to rookery's `/pending`. raven web has no screen of its own; desktop has one.
- **Locked libraries:** stay admin-only, as today, where members get a 404 even with the PIN. The spec will flag whether members should be able to use the PIN.
- **Revocation:** takes up to 1 hour through the access token, made immediate by deleting sessions if S11 holds. Tickets are refused for revoked accounts.
- **luwin's admin:** only the owner-by-email is admin, plus the existing tier override. The suite's `admin` role doesn't make someone a luwin admin.
- **Prerequisites the owner provides:**
  - a dedicated parent domain, with nothing else under it, since the session cookie is readable by every page on it
  - an SMTP provider (Resend, Postmark or SES) with SPF, DKIM and DMARC, because Supabase's built-in email only reaches org members
  - a Google Cloud OAuth client for PR 12

## Verification

- **Every PR:** `bun run verify` (or `bun run affected`), and lefthook's pre-push hook. `bunx nx run @rookery/supabase:test:db` and `:lint:db` locally with Docker, and in the `🗄️ Supabase` job. `bunx nx run @luwin/api:test`. Desktop e2e (`bunx nx run @raven/desktop:e2e`) on Apple Silicon and the `🖥️ Desktop` job.
- **Locally, end to end:**
  1. `bunx nx run @rookery/supabase:db:keys` once, then `:db:start`.
  2. `bun run dev:rookery` and `bun run dev:raven`, with both on `localhost`.
  3. Sign up on :5180, open the email in Mailpit (:54324), confirm, and land on `/pending`.
  4. Sign in as the seeded admin, approve on `/admin`, then "Check again" and land back in raven at :5173.
  5. Play a title, then sign in as `friend@` in another browser and check its progress and favourites are separate.
  6. Sign out from raven Settings: rookery `/logout` runs, and raven redirects to login.
  7. Call luwin's `GET /api/me` with `Authorization: Bearer <token>`.
- **Security:** after each migration, check the Supabase MCP `get_advisors` (security and performance) on the cloud project. Check that the anon key can't read `members` or call the RPCs.
- **After each deploy:**
  - D1 is a real sign-up with SMTP delivery.
  - D2 checks the `Domain=<domain>` cookie on rookery.
  - D3 checks raven on `raven.<domain>` picks up the session, that SSE streams through Netlify, and that `vhagar-update.sh` backs up before migrating.
  - The desktop release signs in and plays on a ticket.
