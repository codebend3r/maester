# raven auth desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** raven player signs in to a raven server whose accounts are on, keeps that sign-in safely in main, shows the pending and removed states, and plays server titles (subtitles, seeks and downloads included) with account-bound tickets, so the desktop release can ship before the server's enforcement cutover. Servers with accounts `off`, and servers too old to have `/api/auth/config`, keep working as today.

**Architecture:** Main owns one `@supabase/auth-js` client per server, built from that server's public auth config, which main validates and pins in `desktop-config.json` at the trust boundary. Its storage adapter keeps the session as one `safeStorage`-encrypted file per server, or in memory alone when encryption is unavailable. Main adds `Authorization: Bearer` to every allowlisted call to a server whose accounts are `ready`, refreshing once on a `signed_out` refusal. The renderer sees an `AccountView` (state, email, whether the sign-in is remembered, the sign-in host), never a token. Native playback of such a server goes through a loopback media relay in main: mpv opens `http://127.0.0.1:<port>/<secret>/file`, and the relay forwards each request (every seek, reconnect and sidecar) to the server with an account ticket it mints, reuses for four minutes and renews itself, so no ticket, JWT or refresh token ever enters an mpv URL, header or log. Downloads mint a fresh account ticket per fetch run. Create account and Forgot password open the server's configured web origin.

**Tech Stack:** Electron 44 (`safeStorage`, `net.fetch`, `session.fetch`, `shell.openExternal`, `node:http` in main), `@supabase/auth-js` 2.117.2 (pinned exactly; the same release as the web's `@supabase/supabase-js`), `@raven/core` contracts from #239, React 19 with TanStack Query and zustand in the renderer, bun test, Playwright e2e against `fixtureServer`, node `--test` against headless libmpv.

**Spec:** `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md`, section "Desktop compatibility, not a suite migration", step 5 of "Implementation order", and the Desktop/playback row of "Focused technical checks". Parent plan: `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (PR 2 findings on tickets). Branch `raven-auth-desktop`, PR #254 with base `main` (#247 merged).

## Decisions (2026-10-18)

- **D1, for the whole stack: servers without accounts keep today's behavior exactly.** A server whose auth is `off`, or a pre-#239 server (`legacy`, answering 404 to `/api/auth/config`), keeps the admin password and the per-browser PIN as they work today. Only a server whose auth is `ready` changes (Task 12).
- **Downloads use account tickets.** Task 9 stays as written.
- **The desktop requires an approved account on servers with auth `ready`**, as the web does (#247), whether or not the server enforces it yet.
- **The loopback relay is adopted** over a server-side renewal endpoint (Task 8).

## Global Constraints

- **Rebase first (done).** `raven-auth-ui` was cut before #244 (constants for the desktop's literal identifiers, `HTTP_HEADERS` in `src/shared/httpHeaders.ts`, `ACCESS_KINDS` in `mediaAccess.ts`), #245 and #242 reached `main`. #247 has since merged, so this branch is rebased on `main` and every task was written against that code.
- Contracts come from `@raven/core` (#239): `AUTH_PATHS`, `AUTH_REFUSALS`, `AUTH_CONFIG_STATES`, `AUTH_HEADERS`, `AUTH_SCHEME`, `isAuthConfig`, `isAccount`, `isAuthRefusal`, `isMediaTicket`, `MEMBER_STATUSES`. Core additions are only those Task 1 names.
- Account tickets (server, #239): opaque `account.<base64url>`, bound to one media id, reusable until they expire at the earlier of five minutes and the issuing JWT's expiry, process-local (a server restart forgets them), at most 32 live per account and 2048 in all. Issued by `POST /api/auth/media/:id/ticket` with Bearer, an approved account and the library PIN unlock (`@PrivateBy('media')`); redeemed by `?t=` on the media plane routes (`file`, `stream`, `subtitles`), where membership is rechecked with the stored JWT on every request and the PIN lock is passed. A continuous response is checked once, when it starts.
- No ticket, JWT, refresh token, password or email-link token in a URL mpv, the page or the log sees. The relay's per-load secret is a local capability: 32 random bytes, valid only while its load plays, blanked in mpv's warnings.
- The renderer never holds a token, a ticket, a Supabase URL or key, or the relay's address. It sends a password once, in the `signIn` request; main never logs a request body.
- Accounts `off`, `unavailable`, or a server answering `/api/auth/config` with 404 (older than #239): no Bearer, no sign-in UI, server titles keep the cookie path (`Cookie: raven_unlock=...` on the loadfile), downloads keep today's access, and the admin password and the PIN unlock work as today (D1). `ready`: the desktop gates itself as the web does (#247): a server title or download needs an approved account, whether or not the server enforces it yet.
- Main-process modules take Electron as parameters and import `electron` with `import type` only; `main.ts` alone wires them. Test hooks are read only when `app.isPackaged` is false.
- Repo rules (root `CLAUDE.md`, `apps/raven/CLAUDE.md`): no casts, `any`, enums, `interface`, non-null `!` or loops; `type` aliases; named exports; `@/` imports with no extension; every identifier string (state, kind, path, header, storage key, event) an `as const` value declared once; discriminated unions switched exhaustively with a `never` default; one object parameter; early returns; no comments restating code; no em or en dashes, UI copy included. SCSS modules, grid with `gap`, tokens only, `max-width` queries from `30rem/40rem/48rem/64rem`, motion under `prefers-reduced-motion: no-preference`, visible `:focus-visible`, a label on every control, no dead selectors. Shared renderer state in zustand under `src/renderer/stores/`, server data in TanStack Query. Exact dependency versions.
- Tasks run as `bunx nx run @raven/desktop:test` (or `:typecheck`, `:lint:ts`, `:lint:css`, `:format:check`) from the worktree root; `test:native` and `e2e` need the CI-built `libs/raven/mpv/resources/darwin-arm64` (Task 15).

## Review Focus

- A seek, an audio or subtitle switch (mpv's refresh seek) or a lavf reconnect 30 minutes into a film, past many ticket lifetimes and a JWT refresh, keeps playing (Tasks 8, 14).
- Removing the account mid-play: the next relayed request is refused and the player says access was removed, not "lost its connection"; buffered bytes keep playing until they run out (Task 8).
- The relay serves only the current load's two paths, only `GET` and `HEAD`, only on `127.0.0.1`, and a stale secret answers 404 with nothing sent upstream (Task 8).
- A server whose public auth config changes its Supabase URL, key or web origin after it was pinned: no password goes to the new host until the person says yes in main's own prompt (Task 5).
- `safeStorage` unavailable, or a stored blob that no longer decrypts (keychain refused, file corrupt): signed out, the blob removed, nothing on disk in the clear, Settings says sign-in is not remembered (Task 3).
- Logs after a sign in, a refresh, a play with seeks, a download and a sign out hold no password, email, Bearer token, JWT, refresh token, ticket, `token_hash` or relay secret (Task 10, e2e Task 14).
- An `off` server, and a pre-#239 server answering 404, still add, play with the PIN cookie, unlock with the admin password and download (D1; Tasks 5, 12, 14).

---

### Task 0: Spike, no repo code

**Files:** scratchpad only (`desktop-spike/`). Outcomes recorded below.

- [x] **Step 1:** Run `@supabase/auth-js` 2.117.2 in a real Electron 44.7.0 main process with a storage adapter over `safeStorage`, and with the memory fallback.
- [x] **Step 2:** Read how account tickets are issued and redeemed on the server, then play a ticketed URL in mpv 0.41.0 (the pinned libmpv's version) past the ticket's expiry, directly and through a loopback relay, with a sidecar and a removal mid-play.
- [x] **Step 3:** Check the rest: relay throughput, a pre-#239 server's answer to `/api/auth/config`, and what the keychain already holds for raven player.

**Spike results (2026-10-18):**

- **Version.** `@supabase/auth-js` 2.117.2 (2026-09-25), the release `@supabase/supabase-js` 2.117.2 in `@raven/web` is built from; 2.117.3 is under two weeks old. Its only dependency is `tslib`, so main takes `auth-js` alone rather than `supabase-js` with realtime, storage and PostgREST.
- **auth-js in Electron main.** No browser global is needed (`window`, `document`, `localStorage` are undefined in main). With `storage`, `persistSession: true`, `detectSessionInUrl: false`: `signInWithPassword` writes one session item (about 500 characters) under `storageKey`; a new client over the same storage restores it with `getSession()`; `getSession()` within 90 s of expiry refreshes, rotates the refresh token, writes the new session and emits `TOKEN_REFRESHED`; a spent refresh token is refused (`refresh_token_not_found`); `signOut()` calls `/logout` and removes the session, `-user` and code-verifier keys; a wrong password is `invalid_credentials`, status 400. With `autoRefreshToken: true` auth-js runs its 30 s ticker in Node unconditionally (it refreshed at 30 s on a 125 s token); the plan uses `autoRefreshToken: false` and refreshes lazily, so idle servers cost nothing. auth-js is lockless by default in this release. These ran against a stub of Auth's token and logout endpoints: Docker hung starting `supabase_kong_raven`, so the local stack never came up (PR 1 already validated rotation and reuse refusal on the real stack).
- **safeStorage.** `isEncryptionAvailable()` is true on this Mac; the encrypted file holds neither the JWT (`eyJ`) nor the refresh token in the clear. On macOS it uses the `<app name> Safe Storage` keychain item, which raven player already has today because Chromium encrypts its cookies with it, so encrypting sessions adds no new keychain item or prompt. The memory fallback writes nothing and a relaunch is signed out.
- **Tickets in mpv URLs fail.** With the ticket in the URL mpv holds (TTL shortened to 8 s), a seek outside the cache after expiry got three `401`s (lavf's reconnects) and mpv ended the file with reason `eof`, not an error. A `403` (removed account) also ends as `eof`. So a ticket in the URL cannot survive a later seek, reconnect or mpv refresh seek, and an account refusal must be read off the relay, not mpv.
- **The relay works.** mpv loading `http://127.0.0.1:<port>/<secret>/file`, with the relay adding a ticket it renews before expiry and re-minting once on a `401`: four seeks, each after the ticket had expired, all played (time-pos 42.4, 12.5, 57.4, 27.5 for 40, 10, 55, 25). One ticket per renewal window, no upstream refusals. `sub-add` through the relay fetched the sidecar once, at the add, and never again across seeks. Revoking the account made the next relayed range request `403`, mpv ended the file, and the relay saw the refusal.
- **Throughput.** Loopback relay of a 138 MB file: about 7 Gb/s against 6 to 9 Gb/s direct, far past a 4K remux.
- **Old servers.** `SpaFallbackFilter` answers a miss under `/api/` with a JSON 404, never `index.html`, so a pre-#239 server answers `/api/auth/config` with 404: the probe falls back to `GET /api/lock` and the server is treated as accounts `off`. v0.6.2, the last release, predates #239.
- **Not run:** the real raven server issuing account tickets to the relay (the guard and ticket code were read, and #239's tests cover them), the local Supabase walkthrough (Docker), and the pinned libmpv itself (no CI-built resources in this checkout). Task 14's native test and Task 15's walkthrough cover them.

### Task 1: Core additions

**Files:**
- Modify: `libs/raven/core/src/contract.ts`, `libs/raven/core/src/player.ts`, their tests; `apps/raven/web/src/lib/authRoutes.ts`

**Interfaces:**
- Produces: `AUTH_ROUTES` (the web's sign-in, sign-up, check-email, confirm, forgot, reset and pending paths) moved verbatim into `contract.ts`; `apps/raven/web/src/lib/authRoutes.ts` re-exports it (`export { AUTH_ROUTES } from '@raven/core'`) so no web caller changes.
- The move must keep every web import working. #247's review commit restructured `authRoutes.ts`: it also holds `AUTH_QUERY`, `HOME_PATH`, `safeReturnPath`, `signInPath`, `checkEmailPath` and `confirmUrl`, which read `AUTH_ROUTES` themselves, so the file imports it from `@raven/core` for its own use as well as re-exporting it, and only `AUTH_ROUTES` moves.
- Produces: `PLAYER_ERROR_REASONS.account = 'account'`: the server refused this account (signed out, pending or removed). No `@raven/ui` code switches on the reasons exhaustively; check with a grep.

- [x] **Step 1:** Tests: `AUTH_ROUTES` values unchanged, `isPlayerErrorReason('account')`.
- [x] **Step 2:** Implement; `bunx nx run-many -t test typecheck -p @raven/core @raven/web @raven/ui`.
- [x] **Step 3:** Commit `MAE: share raven's auth routes and an account error reason`.

### Task 2: Allowlisted account calls

**Files:**
- Modify: `apps/raven/desktop/src/main/servers/allowlist.ts`, `allowlist.test.ts`

**Interfaces:**
- Produces: `CALL_NAMES.getAuthConfig` (`GET AUTH_PATHS.config`), `getMe` (`GET AUTH_PATHS.me`), `getAccountTicket` (`POST AUTH_PATHS.ticket` with the media id, no body), matched by the same digits-only pattern as the other numbered routes, built from `AUTH_PATHS` rather than new literals.
- `isPageCall` is false for all three; `isWrite` false (a ticket changes nothing a quit must wait for). `SERVER_METHODS` unchanged.

- [x] **Step 1:** Tests: each matches and round-trips through `requestFor`; a body, query, extra slash or `0` id refuses; the page cannot make any of them.
- [x] **Step 2:** Implement; tests pass.
- [x] **Step 3:** Commit `MAE: allow raven player's account calls in main`.

### Task 3: Encrypted session storage

**Files:**
- Create: `apps/raven/desktop/src/main/accounts/sessionStore.ts`, `sessionStore.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts` (wiring only)

**Interfaces:**
- Produces: `type SafeStorage = Pick<Electron.SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>` (as a `type` import).
- Produces: `createSessionStore({ dir, safeStorage, isForcedMemory, fs, warn }): SessionStore` with `storageFor(serverId): SupportedStorage` (auth-js's synchronous `getItem`, `setItem`, `removeItem`), `isRemembered(): boolean`, `forget(serverId): Promise<void>`, `clearOrphans({ keep }): Promise<void>`.
- Disk: `userData/accounts/<serverId>.bin`, the server's whole storage map as JSON, `encryptString`ed, written with mode `0o600` in a `0o700` folder through a temp file and rename. Read once per server, on first use. Never written when encryption is unavailable or `isForcedMemory`.
- A blob that fails to decrypt or parse is removed and reads as empty; the warning names the server id only.
- Test hook: `RAVEN_DESKTOP_SAFE_STORAGE=off` (unpackaged only) sets `isForcedMemory`.

- [x] **Step 1:** Tests with a fake `SafeStorage` and fs: round trip; nothing written when unavailable or forced; the file never contains the plaintext; corrupt and undecryptable blobs read empty and are removed; `forget` removes the file; `clearOrphans` removes ids the config no longer holds and ignores names that are not opaque ids.
- [x] **Step 2:** Implement; wire in `main.ts` with `safeStorage` and the hook; orphans cleared beside `clearOrphanPartitions`.
- [x] **Step 3:** Commit `MAE: keep raven player's sign-ins encrypted with safeStorage`.

### Task 4: Account sessions in main

**Files:**
- Create: `apps/raven/desktop/src/main/accounts/accountSessions.ts`, `accountSessions.test.ts`, `authEndpoints.ts`, `authEndpoints.test.ts`
- Modify: `apps/raven/desktop/package.json` (`@supabase/auth-js` 2.117.2), `bun.lock`

**Interfaces:**
- Produces: `signInOriginOf(value: string): string | null` in `authEndpoints.ts`: an `https` origin, or `http` on `localhost`, `127.0.0.1` or `[::1]`, with no credentials, path, query or hash (the server's `readAuthConfig` rule, written for the client). `type SignInConfig = { supabaseUrl: string; publishableKey: string; webUrl: string }` and `signInConfigOf(config: AuthConfig): SignInConfig | null`.
- Produces: `createAccountSessions({ storageFor, configOf, fetch, now, warn })` with:
  - `signIn({ serverId, email, password }): Promise<SignInOutcome>`, `SignInOutcome` a union keyed by `SIGN_IN_OUTCOMES` (`signedIn`, `wrongPassword` for `invalid_credentials`, `unconfirmed` for `email_not_confirmed`, `rateLimited`, `unavailable` for a network or 5xx failure).
  - `accessToken({ serverId, minValidityMs }): Promise<string | null>`: the session's token, refreshed first when it expires within `minValidityMs` (default auth-js's 90 s margin through `getSession()`; `TICKET_MIN_VALIDITY_MS = 360_000` for tickets so a ticket gets its full five minutes).
  - `refresh(serverId): Promise<string | null>`: one forced `refreshSession()`; a rejected refresh token signs the server out locally.
  - `signOut(serverId): Promise<void>`: `signOut({ scope: 'local' })` best effort, then the storage is removed whatever the network said (auth-js keeps the session when `/logout` fails for another reason than 401, 403 or 404).
  - `forget(serverId)`: drops the client and its storage.
- The client: `new AuthClient({ url: <supabaseUrl>/auth/v1, headers: { apikey }, storage, storageKey: 'raven-player-session', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, fetch })`, one per server, rebuilt when its pinned config changes. `fetch` is main's `net.fetch` with `redirect: 'error'` and no credentials, so no server cookie rides to Supabase.
- As built: `createAccountSessions` also takes `timers`. auth-js retries an unreachable refresh with backoff for up to 30 s, so `getSession`, `refreshSession` and `signOut` race `AUTH_DEADLINE_MS` (5 s): past it, `accessToken` keeps a still valid token, `refresh` answers null and keeps the session, and `signOut` clears the storage anyway. The storage from Task 3 is async (`getItem`, `setItem` and `removeItem` answer promises, which auth-js awaits), so the first read can load the file. `fetch` is `AuthFetch = (url, init) => Promise<Response>`; main.ts adapts `net.fetch` to it in Task 6.

- [x] **Step 1:** Tests over a stub Auth fetch: sign in persists through `storageFor`; a new instance restores; near expiry refreshes and rotates; `minValidityMs` forces a refresh earlier; a failed refresh signs out; each error code maps to its outcome; sign out clears storage even when `/logout` answers 500; no token appears in any warning.
- [x] **Step 2:** Add the dependency (exact), implement; `test:main`, `typecheck:main` pass; knip sees it imported.
- [x] **Step 3:** Commit `MAE: hold raven server sessions in raven player's main process`.

### Task 5: Auth config, pinning and the trust probe

**Files:**
- Modify: `apps/raven/desktop/src/main/desktopConfig.ts`, `servers/serverCalls.ts` (`probeServer`), `servers/serverTrust.ts`, `servers/trustPrompt.ts`, their tests
- Create: `apps/raven/desktop/src/main/accounts/authConfigs.ts`, `authConfigs.test.ts`

**Interfaces:**
- `desktop-config.json` version 4: each `ServerEntry` gains `signIn: SignInConfig | null`, the pinned endpoints. Versions 1 to 3 upgrade with `signIn: null`; `pickServer` rebuilds it field by field through `signInOriginOf`.
- `probeServer` reads `GET /api/auth/config`: a valid `AuthConfig` is a raven server (a `ready` one whose endpoints fail `signInConfigOf` is refused as `TRUST_OUTCOME_KINDS.badSignIn`, "That server's sign-in settings are not ones raven player can use."); a 404 falls back to today's `GET /api/lock` check (a server older than accounts); anything else is unreachable. Consent still comes before any request to a new origin. A `ready` probe pins `signIn` with the new entry.
- `createAuthConfigs({ calls, config, confirm, warn })` with `stateOf(serverId): Promise<AuthState>` (`AUTH_STATES`: `off`, `legacy`, `unavailable`, `ready` with its `SignInConfig`, `unreachable`), cached in memory per server, read again on sign in, on a `401` or `503` from the server, and on `refreshAccount`. A `ready` config that differs from the pin asks with main's own sheet, "<server> now signs in through <host>. Use it?" (Cancel default); yes re-pins and drops the old session, no leaves the server unusable for sign in until asked again. An entry with `signIn: null` pins on its first `ready` read.

- [x] **Step 1:** Tests: config upgrade from 3 with `signIn: null` and bad stored endpoints dropped; probe outcomes for `off`, `ready`, `unavailable`, 404 then lock, 404 then no lock, HTML, bad endpoints; a changed config asks once and only a yes re-pins; the pin is never replaced silently.
- [x] **Step 2:** Implement; tests pass.
- [x] **Step 3:** Commit `MAE: probe raven servers through their public auth config`.

### Task 6: Bearer on server calls and the account view

**Files:**
- Modify: `apps/raven/desktop/src/main/servers/serverCalls.ts`, `serverCalls.test.ts`, `apps/raven/desktop/src/shared/protocol.ts`, `protocol.test.ts`, `apps/raven/desktop/src/main/desktopService.ts`, `desktopService.test.ts`, `apps/raven/desktop/src/main/main.ts`
- Create: `apps/raven/desktop/src/main/accounts/accountService.ts`, `accountService.test.ts`

**Interfaces:**
- `createServerCalls` takes `authorize: ({ serverId }) => Promise<string | null>` and `onRefused: ({ serverId }) => Promise<string | null>` (the refresh). A server whose state is `ready` gets `Authorization: Bearer <token>` (`AUTH_HEADERS.authorization`, `AUTH_SCHEME`) on every call; a `401` whose body is `AUTH_REFUSALS.signedOut` refreshes once and repeats the call once. Others get no header.
- Protocol: `ACCOUNT_STATES` (`off`, `unavailable`, `signedOut`, `pending`, `revoked`, `approved`, `failed`) and `isAccountView = object({ serverId, state, email: nullable(isString), isOwner: isBoolean, isRemembered: isBoolean, signInHost: nullable(isString) })`. Requests `readAccount { serverId }`, `refreshAccount { serverId }`, `signIn { serverId, email, password }` (password at most `MAX_SECRET`), `signOut { serverId }`, `openAccountPage { serverId, page: 'signUp' | 'forgot' }` (`ACCOUNT_PAGES`). Reply `account { account: AccountView }`; event `account { account }` when main's view of it changes (a refresh failed, a relayed request was refused).
- `accountService`: the view from the auth state, the session and `GET /api/me` (an `Account` narrows `pending`, `revoked`, `approved`; `401` `signedOut`; `503` or the network `failed`, never a sign out). `openAccountPage` opens `<webUrl><AUTH_ROUTES.signUp | forgot>` from the pin through `openExternal`, never a URL the page sent. Signing out and removing a server end that server's relay loads and downloads' account access.
- Logging: "signed in to <server name>", "signed out of <server name>", outcome kinds only; never the email.

- [x] **Step 1:** Tests: Bearer only for `ready`; refresh once then success; a second `401` signs out and does not loop; `/api/me` 503 is `failed` and keeps the session; each request narrows at the boundary and a bad one is refused; the page never receives a token (assert on every reply in the test).
- [x] **Step 2:** Implement; wire into `main.ts` and `desktopService`; tests pass.
- [x] **Step 3:** Commit `MAE: sign raven player in to raven servers from main`.

### Task 7: The renderer's account screens

**Files:**
- Create: `apps/raven/desktop/src/renderer/desktop/accountApi.ts`, `.test.ts`; `apps/raven/desktop/src/renderer/Account/SignInForm.tsx`, `SignInForm.module.scss`, `SignInForm.test.tsx`; `apps/raven/desktop/src/renderer/Account/AccountRefused.tsx`, `.module.scss`, `.test.tsx`
- Modify: `apps/raven/desktop/src/renderer/SettingsPage/Servers.tsx`, `Servers.module.scss`, `Servers.test.tsx`; `apps/raven/desktop/src/renderer/Shell/Shell.tsx` (the `account` event invalidates the server's account query)

**Interfaces:**
- `useAccount(serverId)` (TanStack Query, key `['desktop', 'account', serverId]` declared once beside `SERVERS_KEY`), `signIn`, `signOut`, `openAccountPage` over the client.
- `SignInForm`: email (`type="email"`, `autoComplete="username"`), password (`autoComplete="current-password"`), Sign in, and links Create account and Forgot password that ask main to open the web pages. Copy: wrong password "Email or password is wrong."; unconfirmed "Confirm your email first. The link is in your inbox."; rate limited "Wait a moment before trying again."; unavailable "<server> could not sign you in right now. Try again."; "Signs in with <host>." under the form; when not remembered, "raven player cannot keep your sign-in on this Mac, so you sign in again after quitting."
- `AccountRefused`: "Waiting for approval" (pending) or "Your access was removed" (revoked), with Check again (`refreshAccount`) and Sign out.
- Settings > Servers: each `ready` server's row shows the email and status, Sign in (opens `SignInForm` in the row) or Sign out; `off` and legacy rows show nothing new; `unavailable` says "Accounts are unavailable on <server> right now."

- [x] **Step 1:** Tests: each outcome's copy and an invalid password field; links send `openAccountPage` with the right page; the password field is cleared after any answer; Check again turning approved re-renders; no row shows sign-in for `off`.
- [x] **Step 2:** Implement; `test:renderer`, `lint:css`, `typecheck:renderer` pass.
- [x] **Step 3:** Commit `MAE: sign in to a raven server from raven player's Settings`.

### Task 8: The loopback media relay

**Files:**
- Create: `apps/raven/desktop/src/main/servers/mediaRelay.ts`, `mediaRelay.test.ts`, `accountTickets.ts`, `accountTickets.test.ts`
- Modify: `apps/raven/desktop/src/main/servers/serverSources.ts`, `serverSources.test.ts`, `apps/raven/desktop/src/main/player/playerService.ts` (blank relay URLs in warnings), `apps/raven/desktop/src/main/main.ts`

**Interfaces:**
- `createAccountTickets({ calls, sessions, now })`: `ticketFor({ serverId, mediaId, isFresh }): Promise<TicketOutcome>` minting with `getAccountTicket` after `accessToken({ minValidityMs: TICKET_MIN_VALIDITY_MS })`, holding one per `(serverId, mediaId)` until `now() + ACCOUNT_TICKET_RENEW_MS` (`240_000`, timed by raven player's clock, never the server's `expiresAt`). Outcomes: `ticket`, `refused` with the `AuthRefusal` reason, `locked` (423), `gone` (404), `unreachable`. `forget(serverId)`.
- `createMediaRelay({ listen, fetchUpstream, tickets, newSecret, warn })` where `listen` is a `node:http` server on `127.0.0.1` port 0, started on first use. `open({ server, mediaId, sidecarTrackIds })` answers `{ fileUrl, sidecarUrls, loadId }` under a fresh secret; opening another load, `close(loadId)`, `closeServer(serverId)` and `closeAll()` retire secrets. A request: unknown secret or path, or a method other than `GET`/`HEAD`, is 404 with nothing sent upstream; else `fetchUpstream` (main's `net.fetch`, `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`) to `<origin>/api/media/<id>/<file | subtitles/external-N>?t=<ticket>` with only `Range` forwarded; a `401` mints once more and repeats; status and `content-type`, `content-length`, `content-range`, `accept-ranges` pass back; the upstream fetch aborts when mpv closes the request. `refusalOf(loadId)` answers the last `403` reason or the second `401`.
- `serverSources.resolve`: a `ready` server with an approved session resolves to the relay's URLs and `headerFields: ''`; mint the first ticket before `loadfile`, so a refused or locked title is refused before mpv opens anything; a signed-out or refused account resolves `{ ok: false }` with the account copy. `off` and legacy servers are unchanged. `explain` checks `relay.refusalOf` first and answers `PLAYER_ERROR_REASONS.account` with "Sign in to <server> again." or "Your access to <server> was removed.", and sends the `account` event.
- Constants: `ACCOUNT_TICKET_RENEW_MS = 240_000`, `TICKET_MIN_VALIDITY_MS = 360_000`, `RELAY_SECRET_BYTES = 32`, `RELAY_HOST = '127.0.0.1'`.

- [x] **Step 1:** Tests for `accountTickets` with a fake clock: reuse within the window, renewal after it, `isFresh` re-mints, outcomes per status, never more than one mint in flight per title.
- [x] **Step 2:** Tests for the relay over an in-process fake upstream: Range forwarded and 206 passed back; a stale or unknown secret and `POST` are 404 and the upstream hears nothing; an expired ticket's `401` re-mints once; a second `401` and a `403` are recorded for `refusalOf`; closing the downstream aborts the upstream; no secret, ticket or URL in any warning.
- [x] **Step 3:** Tests for `serverSources`: ready plus approved goes through the relay, signed out refuses before mpv, `off` keeps the cookie header, `explain` answers `account`.
- [x] **Step 4:** Implement; `playerService` blanks the relay base in mpv warnings the way it blanks a file's path; tests pass.
- [x] **Step 5:** Commit `MAE: play raven server titles through a ticketed loopback relay`.

### Task 9: Downloads with account tickets

**Files:**
- Modify: `apps/raven/desktop/src/main/downloads/mediaAccess.ts`, `downloadQueue.ts`, `expand.ts`, `downloadService.ts` and their tests; `apps/raven/desktop/src/shared/protocol.ts` (`DOWNLOAD_ASK_KINDS.account`); `apps/raven/desktop/src/renderer/Shell/DownloadDialog.tsx`, `.test.tsx`; `apps/raven/desktop/src/main/main.ts`

**Interfaces:**
- `ACCESS_KINDS.account`: `{ kind: 'account'; url: string; ticket: string }` for a `ready` server: the picked media origin, or the server's own origin when none answers, with a ticket from `accountTickets.ticketFor({ isFresh: true })` read for each fetch run. No proactive abort: the server checks a ticket only when a request starts, so a long file keeps streaming; a `401` reads one more ticket and resumes from the bytes on disk (the existing path); a `403` fails the group with the account copy and sends the `account` event.
- Expansion and the ask: a `ready` server whose account is not approved answers `DownloadAskStatus` `account` with the `AccountView`; the dialog shows `SignInForm` or `AccountRefused` and then `retryDownloadAsk`.
- `fetchDownload` for `account` access uses main's bare fetch (no cookie); sidecars share the file's ticket (the subtitles route carries the same media id).

- [x] **Step 1:** Tests: a `ready` server's file and sidecar URLs carry an `account.` ticket and no cookie; a run past five minutes is never aborted for renewal; a `401` resumes with a new ticket once; a `403` fails with the account copy; `off` servers keep `cookie` and `origin` access unchanged; a signed-out ask shows sign in and the retry expands.
- [x] **Step 2:** Implement; tests pass.
- [x] **Step 3:** Commit `MAE: download from raven servers with account tickets`.

### Task 10: Redaction

**Files:**
- Modify: `apps/raven/desktop/src/main/log/log.ts`, `log.test.ts`

**Interfaces:**
- `redact` also blanks: an `authorization` header or field, `Bearer <anything>`; a JWT-shaped string (`eyJ` then two dot-separated base64url runs); the values of `access_token`, `refresh_token`, `provider_token`, `token_hash`, `token`, `apikey` as JSON fields, query parameters or form fields; a `t` query parameter and any `account.<base64url>` ticket; the `maester-auth` cookie and its chunks, and `sb-*-auth-token`; a relay URL's secret segment; an email address (`<email>`). Every new pattern keeps `redact` idempotent and linear on a long run of near matches (add each to the existing quadratic-input test).

- [x] **Step 1:** Tests for each form in plain text, JSON, escaped JSON, `util.inspect` and a URL; idempotence; the quadratic guard.
- [x] **Step 2:** Implement; tests pass.
- [x] **Step 3:** Commit `MAE: redact sign-in tokens, tickets and emails from raven player's log`.

### Task 11: The server page asks for an account

**Files:**
- Modify: `apps/raven/desktop/src/renderer/ServerPage/ServerPage.tsx`, `ServerPage.module.scss`, `ServerPage.test.tsx`, `serverServices.ts`

**Interfaces:**
- `ServerTitle` reads `useAccount(serverId)` before the title: `signedOut` shows `SignInForm` in place of the player and loads the title once approved; `pending` and `revoked` show `AccountRefused`; `failed` shows `CannotRead` with Try again; `off`, `unavailable` and `approved` go on as today.
- `onEngineError` with reason `account` re-reads the account (the gate then shows the form or the refusal) and keeps the last saved position for a resume after signing in again.
- A title read refused with an `ApiError` whose `refusal` is set re-reads the account the same way.

- [x] **Step 1:** Tests per state; an `account` engine error mid-play shows the refusal and a later approval resumes at the last saved position; `off` renders today's flow untouched.
- [x] **Step 2:** Implement; tests pass.
- [x] **Step 3:** Commit `MAE: ask for a raven account before playing a server title`.

### Task 12: No admin-password calls to servers with accounts

D1 keeps the admin password for servers without accounts, so nothing is removed: on a server whose auth is `ready` the desktop never makes an admin-password call, since enforcement replaces admin-password authorization with the account (spec step 6) and the call would grant nothing; on `off` and `legacy` servers the admin unlock keeps working exactly as today.

**Files:**
- Modify: `apps/raven/desktop/src/main/servers/serverCalls.ts` (or wherever Task 6 resolves the auth state per call), `downloads/expand.ts`, `apps/raven/desktop/src/renderer/ServerPage/ServerPage.tsx`, `serverServices.ts`, `Shell/DownloadDialog.tsx`, their tests; their tests (the e2e and native `ready` cases for the admin lock moved to Task 14, after Task 13 gave the fixture accounts)

**Interfaces:**
- `getAdminLock` and `unlockAdmin` stay in `CALL_NAMES`, `ROUTES`, `requestFor`, `isWrite` and `isPageCall`, as do `API_PATHS.admin`, `adminUnlock`, `raven_admin` in `SERVER_COOKIES`, the `adminPassword` secret and `DOWNLOAD_ASK_KINDS.hidden`. For a `ready` server main refuses both calls before any request is sent (refused and logged like any call the server's state does not allow), and `raven_admin` is never sent with that server's media.
- On a `ready` server, a title or download hidden by an admin lock (404) is "not on <server> any more": the page never offers the admin password there, and `expand` never answers `hidden`. On `off` and `legacy` servers the 404 still asks for the admin password and the unlock lifts it.
- `log.ts` keeps its `raven_admin` and password patterns. Knip must report nothing left behind: every admin-lock export still has its `off`/`legacy` reader.

- [x] **Step 1:** Update tests first: for a `ready` server the page cannot make either call and main sends nothing; a 404 shows the gone copy with no admin-password prompt; an `off` and a `legacy` server still ask for the admin password on a 404 and the unlock lifts the lock.
- [x] **Step 2:** Implement; `bunx nx run @raven/desktop:test`, `typecheck`, `lint:ts` and `bun run dead-code` pass.
- [x] **Step 3:** Commit `MAE: keep the admin password away from raven servers with accounts`.

### Task 13: Fixture server accounts

**Files:**
- Modify: `apps/raven/desktop/e2e/fixtureServer.ts`

**Interfaces:**
- `FixtureMode.accounts`: `{ kind: 'off' } | { kind: 'legacy' } | { kind: 'ready'; status: MemberStatus; ticketMs: number; jwtSeconds: number }`. `ready` serves `AUTH_PATHS.config` naming the fixture's own origin as `supabaseUrl` and `webUrl`, a stub Auth at `/auth/v1/token` (password and refresh grants, rotation) and `/auth/v1/logout`, `AUTH_PATHS.me` from the Bearer, `AUTH_PATHS.ticket` minting `account.` tickets that expire after `ticketMs`, and file and sidecar routes that take them (`401` expired, `403` pending or revoked). `legacy` answers 404 to `/api/auth/config`. `setStatus(status)` changes the account mid-test. `requests` records `hasBearer` and whether `t` was an account ticket, never its value.

- [x] **Step 1:** Implement with a small unit test of the stub's grants and ticket expiry under `test:main` if it fits there, else exercised by Task 14.
- [x] **Step 2:** Commit `MAE: give raven player's fixture server accounts and tickets`.

### Task 14: e2e and native tests

**Files:**
- Modify: `apps/raven/desktop/e2e/server.e2e.ts`, `e2e/logs.e2e.ts`, `e2e/security.e2e.ts`, `test/player.native.ts`, and `src/main/player/playerService.ts` (the native suite found a bug: a refused seek near a relayed title's end ran out as `ended` instead of the account refusal)
- Create: `apps/raven/desktop/e2e/accounts.e2e.ts`

**Interfaces / cases:**
- `accounts.e2e.ts` (headless mpv): add a `ready` server, sign in from Settings, play, seek after `ticketMs` several times, switch the sidecar, keep playing; a pending account shows "Waiting for approval" and Check again lets it in after `setStatus('approved')`; `setStatus('revoked')` mid-play shows "Your access to <server> was removed."; relaunch with the same profile is still signed in; relaunch with `RAVEN_DESKTOP_SAFE_STORAGE=off` is signed out and Settings says sign-in is not remembered; Sign out then play asks to sign in; Create account opens `<webUrl>/sign-up` (stub `shell.openExternal` as the e2e already does).
- `server.e2e.ts`: an `off` server and a `legacy` one still add, play with the PIN cookie, unlock with the admin password and download; a `ready` one refuses both admin-password calls, shows the gone copy with no `/api/admin*` request in the fixture's log (Task 12's e2e case). Its probe expectations, and `security.e2e.ts`'s, changed with Task 5: the probe reads `/api/auth/config` first.
- `logs.e2e.ts`: after the account flow, `raven.log` holds none of the password, email, Bearer, any `eyJ` string, the refresh token, any `account.` ticket or the relay secret.
- `security.e2e.ts`: the page cannot call `getAuthConfig`, `getMe`, `getAccountTicket`, reach the relay (CSP `connect-src 'self'`), or get a token in any reply.
- `test/player.native.ts`, new suite "account titles through the relay against headless libmpv": seek past the ticket's life repeatedly and after a forced JWT refresh; an audio switch after expiry (mpv's refresh seek); a sidecar is fetched once; removal mid-play is an `account` error and mpv opens nothing more; the relay hears nothing after the load ends.

- [x] **Step 1:** Write the cases; run `bunx nx run @raven/desktop:e2e` and `bunx nx run @raven/desktop:test:native` locally (with Task 15 step 1's native resources).
- [x] **Step 2:** Commit `MAE: test raven player's sign-in, relay and redaction end to end`.

### Task 15: Docs, verification and the PR

**Files:**
- Modify: `apps/raven/CLAUDE.md` (Desktop: main owns account sessions and the relay; the allowlist's real call list; the new test hook beside the others; `safeStorage` and the memory fallback; logs never hold tokens, tickets or emails), `apps/raven/README.md` (desktop sign-in, which servers need it, the relay, old servers), the root `CLAUDE.md` only if a target or hook list changes, `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (link this plan in the `raven-auth-desktop` row; tick what ships), `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md` (status line).

- [x] **Step 1:** Get the CI-built native resources: download the `🎞️ Desktop native` job's artifact for this branch's latest run into `libs/raven/mpv/resources/darwin-arm64` (gitignored), or restore `fetch:libmpv` and `build:native` from Nx Cloud with `NX_CLOUD_ACCESS_TOKEN` set. Never build libmpv cold here.
- [x] **Step 2:** `bunx nx run @raven/desktop:test`, `:typecheck`, `:lint:ts`, `:lint:css`, `:format:check`, `:test:native`, `:e2e`, then `bun run verify` from the worktree root. All pass.
- [x] **Step 3:** Local walkthrough when Docker is healthy: `bunx nx run @raven/supabase:db:start`, raven server with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RAVEN_WEB_URL` and a small library, `bunx nx run @raven/desktop:dev` with a throwaway `RAVEN_DESKTOP_USER_DATA`. Sign in as `friend@maester.test`, play and seek for longer than five minutes, then remove access from the owner's Settings > Users on the web and seek again; sign in as `waiting@maester.test` and see Pending. Stop the stack after (`db:stop`). Note what was and was not seen.
- [x] **Step 4:** Not verifiable here, listed in the PR: a packaged, ad hoc signed build's keychain behaviour after an update, the cloud project's real JWT lifetime, and a production server with enforcement on (that is `raven-auth-enforcement`).
- [x] **Step 5:** Commit `MAE: document raven player's sign-in`; the controller pushes and syncs PR #254 (base `main`) per `pr-format`, with screenshots of Settings > Servers signed in and out, the sign-in form's errors, and the pending and removed screens.

---

## Open risks

- **Rebase cost.** #244 rewrote most desktop files this plan touches; Tasks 6, 8, 9 and 12 must start from the rebased code or they will conflict everywhere.
- **Server restart mid-film.** Account tickets are process-local; the relay recovers by minting again on the `401`, but a server that restarts while the account's JWT is near expiry needs the refresh first. Task 14's native suite covers a forced refresh.
- **Ticket cap.** 32 live tickets per account: one per title per four minutes stays far below it, but a download queue of many files mints one per run, and a fast queue of short files would mint faster than tickets expire. `DOWNLOAD_MINTS` in `mediaAccess.ts` holds the bound: each server's downloads mint at most 16 in any five minutes (a ticket's life), and a run past that waits for the oldest mint to age out, abandonably, rather than fail; the 401 re-read counts too. The other 16 stay free for playback on every device. Task 9 asserts it on a fake clock.
- **Keychain on updates.** The app is signed ad hoc, so a macOS update may ask again for the existing `raven player Safe Storage` item. That already applies to the cookies; a refusal now also signs the person out (Task 3), which is the safe failure.
- **No real stack in the spike.** Docker hung; the auth-js results came from a stub of Auth's endpoints and PR 1's real-stack checks. Task 15 step 3 closed it (below).

## Walkthrough findings (Task 15, step 3)

Run on the local Supabase stack with a real raven server (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RAVEN_WEB_URL`, one 8-minute 720p library file with a sidecar) and raven player launched with a throwaway profile and headless mpv. A logging proxy sat in front of the server, trickling the file past its first 2 MB so mpv could not hold it all and each seek was a new request.

- Seen: the server added and "Not signed in."; sign in as `friend@maester.test`; native playback through the relay; the sidecar fetched once; seeks at 9 s, 113 s, 217 s and 331 s into the play. The first ticket served every request for 3 minutes 35 seconds. The seek at 331 s, past that ticket's five minutes, minted a new one with the Bearer and played with no player error.
- Seen: the owner removing `friend@maester.test` mid-play (through the server's `POST /api/auth/members/:id/status`, which Settings > Users calls), then a seek: the server answered the relay `403`, the player emitted the `account` error "Your access to <server> was removed." and showed "Your access was removed".
- Seen: a relaunch still signed in, and `waiting@maester.test` showing "Waiting for approval".
- Not seen: the removal from the web's Settings > Users screen itself (the same call was made directly), Create account and Forgot password opening a real browser (stubbed, as in the e2e), and a download against the real server.


## Self-review

- **Spec coverage:** main owns the session and adds Bearer (Tasks 4, 6); `safeStorage` with a memory fallback (Task 3); safe account state only (Task 6); in-app email and password sign in, pending and removed (Tasks 7, 11); Create account and Forgot password open the server's web origin (Task 6); trust probing through public auth config with endpoints validated and pinned (Task 5); native playback with account tickets, subtitles and repeated seeks, nothing long-lived in media URLs (Task 8, tested in Task 14); obsolete admin-password calls never made to a `ready` server, and kept for `off` and `legacy` ones per D1 (Task 12); credentials, email-link tokens and tickets redacted (Task 10); local files untouched (no task changes the file source, and Task 14 keeps the existing local suites); `off` and pre-#239 servers keep working (Tasks 5, 14).
- **Beyond the spec's list:** downloads (Task 9), because a download is server media and would stop at the cutover otherwise.
- **Consistency:** `SignInConfig`, `ACCOUNT_STATES`, `AccountView`, `accountTickets.ticketFor`, `ACCOUNT_TICKET_RENEW_MS`, `TICKET_MIN_VALIDITY_MS` and `relay.refusalOf` are named once and reused.
