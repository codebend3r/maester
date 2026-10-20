# raven auth enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once accounts are `ready`, every protected raven route, media path and stream needs an approved account. Management becomes owner-only, the admin password stops authorizing anything, and the library PIN's unlock is bound to the account that entered it.

**Architecture:** The `AccountGuard` from #239 becomes a default-deny gate. Every route is held to an approved account unless its handler is explicitly marked open, and `@AdminOnly()` now means the owner. Each request resolves one caller: the legacy browser when accounts are off, or a session or ticket bound to an account. The PIN lock, the owner check and the listings all read that caller instead of the admin cookie. Requests that stay open (SSE and media responses) are checked again on a bounded interval. A server that once enforced accounts never falls back to anonymous access without an explicit operator opt-out.

**Tech Stack:** NestJS 12 on Fastify, `jose`, vitest, `@raven/core` guards, React 19 + TanStack Query + zustand in `@raven/web`, `@raven/ui` player queries, bun test + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md`: step 6 of "Implementation order", plus "raven server and contracts", acceptance criteria 1, 5, 6 and 8, and "Verification and cutover". Parent plan: `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (PR 2 findings: opaque five-minute account tickets, `current_membership()` per request, observation-only state). Branch `raven-auth-enforcement`, **stacked on `raven-auth-desktop`**, which is stacked on `raven-auth-ui` (#247). It was cut from `raven-auth-ui` and is rebased onto `raven-auth-desktop` before any task starts.

## Decisions (2026-10-18)

Settled by the user. The tasks below are written for them.

- **D1, servers without Supabase keep today's behavior; a server that enforced accounts fails closed.** No Supabase env means auth `off`: anonymous viewers, the admin password lock and the per-browser PIN, exactly as today. Local dev, most server tests and servers never set up for Supabase depend on it. The spec says "never silently restore anonymous access", so the first `ready` start records `accounts.enforcedAt` in SQLite `settings`. A later start whose Supabase settings are gone resolves to `unavailable`, which fails closed, never to `off`. Only `RAVEN_ACCOUNTS=off` clears the record and reopens the server, and it logs a warning on every start while set (Task 1).
- **D2, membership lookups are shared and cached for 5 s.** Concurrent lookups for the same token share one in-flight `current_membership` RPC, and an answer is reused for `MEMBERSHIP_TTL_MS = 5_000`. A status change made through raven's Users screen (`POST /api/auth/members/:id/status`) evicts that account at once, so removal through raven takes effect on the next request. A change made directly in the database takes effect within 5 s. Without this, a library page of 300 posters makes 300 RPCs (Task 7).
- **D3, only the owner unlocks locked libraries; members never see them.** Today's rule maps over: while the admin lock is on, a viewer never sees a locked library and the PIN opens nothing. Under accounts, "admin lock on" means "not the owner". A member never sees a locked library (it is not listed, and its routes answer 404), and a member's unlock is 403 `not_owner`. The unlock cookie carries the account id, so another account on the same browser cannot inherit the owner's unlock (Task 4).
- **D4, open SSE and media streams are rechecked every 60 s.** SSE and open media responses (`file`, `stream`) are rechecked every `ACCESS_RECHECK_MS = 60_000` and ended when access is removed or the token expires. "The token" is the newest unexpired one the server has seen for that account, from any Bearer, cookie or ticket mint: a client that keeps calling the API keeps its stream, and one that has gone quiet loses it at that token's expiry. Subtitles and ranges are short and are authorized per request. A client resumes an ended media response by range with a fresh ticket (Task 6).
- **D5, `/api/health` stays public and unchanged**, as the spec lists it.

### What raven player does against this server

`raven-auth-desktop` (stacked between #247 and this branch) settles the desktop side. The tasks below rely on it and change nothing in `apps/raven/desktop`.

- **Admin password.** raven player keeps `getAdminLock` and `unlockAdmin` for `off` and `legacy` (pre-#239) servers and never makes them to a `ready` server. So `/api/admin*` answering 404 under `ready` (Task 3) breaks no current client, and its `off` behavior must stay byte for byte as today.
- **Tickets.** On a `ready` server, main mints with `POST /api/auth/media/:id/ticket` (`getAccountTicket`) and Bearer. It calls `GET /api/media/:id/ticket` (`getMediaTicket`) only on `off` and `legacy` servers, where it stays the HMAC ticket. Task 5's GET unification therefore serves the web's media plane, not the desktop.
- **Native playback.** mpv plays through a loopback relay in main that holds one account ticket per title, renews it every 240 s by raven player's own clock, and mints once more on a `401`. So `@raven/ui`'s ticket refresh (Task 8) is the web's alone. What the relay needs from this server: an expired or unknown `account.` ticket is 401 `signed_out` (re-mint), a removed or pending account is 403 (stop), and every range is authorized on its own (Task 5).
- **Downloads.** Main mints one account ticket per fetch run and resumes by range on a `401`. The desktop plan's Task 9 says the server checks a ticket only when a response starts; D4 changes that, so a long download can now be ended mid-body by Task 6 when the account is removed or its newest token expires. Ending on removal is intended. Ending at expiry happens only when raven player made no Bearer call for the token's whole life; the download then resumes by range with a fresh ticket, which needs the desktop's download loop to treat a body cut short as resumable, not only a `401`. Task 10 checks it, and the desktop PR owns the fix if it does not.

## Effective access by auth state

| State | When | Open (`anyone`) | Unmarked routes | `@AdminOnly()` | Explicit account routes | `/api/admin*` | PIN |
|---|---|---|---|---|---|---|---|
| `off` | No Supabase env, no enforcement record (or `RAVEN_ACCOUNTS=off`) | open | open, as today | admin lock, as today | 503 `unavailable`, as today | as today | per browser, as today |
| `unavailable` | Partial or invalid Supabase env; or the record is set and the env is gone | open | 503 | 503 | 503 | 503 | n/a |
| `ready` | Valid `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RAVEN_WEB_URL` | open | approved account | owner (403 `not_owner`) | as marked | 404, password inert | bound to account, owner only (D3) |

Under `ready`, a Supabase or JWKS outage answers 503 on protected routes, and the open routes keep answering. No state ever downgrades to anonymous by itself.

## Route inventory (79 routes, from `routeMarks(CONTROLLERS)`)

Task 2 puts this exact table into a test, so a new route that is missing from it fails CI.

- **Open to anyone (3):** `GET /api/health`, `GET /api/auth/config`, `GET /api/media-origins/ping` (media-plane reachability probe). The web app files and SPA fallback (`serveWebApp`, outside `/api/`) and the media-plane CORS preflight (`OPTIONS`, answered in an `onRequest` hook) serve no data and stay outside the gate.
- **Any account session, pending and removed included (1):** `GET /api/me`.
- **Owner (26):** libraries: `POST /api/libraries`, `PUT /api/libraries/:id`, `DELETE /api/libraries/:id`, `POST /api/libraries/:id/scan`, `POST /api/libraries/:id/refresh`, `POST /api/libraries/:id/match`, `PUT /api/libraries/:id/sagas/:sagaId/backdrop`, `POST /api/libraries/:id/duplicates/split`, `POST /api/libraries/:id/duplicates/join`. Media: `GET /api/media/:id/location`, `DELETE /api/media/:id`, `PUT /api/media/:id/match`. Items: `PUT /api/items/:id/match`, `POST /api/items/:id/refresh`, `GET /api/items/:id/metadata`, `PUT /api/items/:id/metadata`, `GET /api/items/:id/images`, `PUT /api/items/:id/images/:kind`. Other: `GET /api/match/search`, `GET /api/fs/browse`, `PUT /api/settings/playback`, `PUT /api/settings/display`, `GET /api/streams`, `POST /api/streams/:id/stop`, `GET /api/auth/members`, `POST /api/auth/members/:id/status`.
- **Approved account (45):**
  - Library JSON: `GET /api/libraries`, `GET /api/libraries/:id`, `.../:id/history`, `.../:id/shows`, `.../:id/media`, `.../:id/in-progress`, `.../:id/favourites`, `.../:id/sagas`, `.../:id/unmatched`, `.../:id/duplicates`, `GET /api/media/:id`, `GET /api/items/:id`, `.../:id/next`, `.../:id/shuffle`, `GET /api/home`, `GET /api/home/search`, `GET /api/favourites`, `GET /api/favourites/titles`, `GET /api/people/:id`, `GET /api/settings/playback`, `GET /api/settings/display`, `GET /api/media-origins`, `GET /api/lock`.
  - Writes: `PUT /api/libraries/:id/view`, `PUT /api/media/:id/progress`, `POST /api/media/:id/plays`, `PUT /api/media/:id/favourite`, `PUT /api/items/:id/favourite`, `PUT /api/watched`, `POST /api/lock/unlock`, `POST /api/lock/lock`.
  - Artwork: `GET /api/media/:id/thumbnail`, `GET /api/items/:id/images/:kind`, `GET /api/items/:id/images/:kind/local`, `GET /api/people/:id/photo`, `GET /api/reviews/:id/avatar`, `GET /api/images/:use/:file`.
  - Playback and media plane: `GET /api/media/:id/file` (MP, ranges), `GET /api/media/:id/stream` (MP), `GET /api/media/:id/subtitles/:trackId` (MP), `GET /api/media/:id/tracks`, `GET /api/media/:id/streams`.
  - Tickets: `GET /api/media/:id/ticket`, `POST /api/auth/media/:id/ticket`.
  - SSE: `GET /api/events`.
- **Legacy admin lock (4):** `GET /api/admin`, `POST /api/admin/unlock`, `POST /api/admin/lock`, `POST /api/admin/keep-unlocked`. They pass the approved gate first, then answer 404 under `ready`.
- Fastify answers `HEAD` for every `GET`, through the same guards. The sweep covers `HEAD` too.

## Global Constraints

- The spec's failure codes: missing or invalid identity is 401 `signed_out`, pending or removed is 403 `pending`/`revoked`, a non-owner on management is 403 `not_owner`, and unavailable auth or membership infrastructure is 503 `unavailable`. Never fail open.
- Bearer takes precedence. Only `GET`/`HEAD` may fall back to the `maester-auth` cookie. Cookie-only writes are rejected, and CORS does not bypass that (media-plane CORS never allows credentials or the `Authorization` header).
- Media tickets are short-lived and account-bound, and every redemption checks current approval. A legacy HMAC ticket (`RAVEN_MEDIA_SECRET`) opens nothing under `ready`, not even past the PIN. Anonymous callers cannot mint tickets, and minting needs Bearer.
- No protected response is `public` in `cache-control`. Each carries `Vary: authorization, cookie`. Refusals are `no-store`.
- No JWT, refresh token or ticket in logs. Tokens stay in server memory only.
- Contracts come from `@raven/core`: `AUTH_CONFIG_STATES`, `AUTH_REFUSALS`, `AUTH_HEADERS`, `AUTH_METHODS`, `AUTH_PATHS`, `MEMBER_STATUSES`, `Account`, `MediaTicket`, `LockState`, `AdminLock`. Add only `ACCOUNT_TICKET_SECONDS` (Task 5). Core stays platform-agnostic.
- Server rules (`apps/raven/CLAUDE.md`): explicit `@Inject(Token)`; `assertRoutesMarked` still refuses unmarked writes and unmarked parameter routes; responses that depend on cookies are never `public`.
- Repo rules (root `CLAUDE.md`): no casts, `any`, enums, `interface`, non-null `!` outside tests, or `for` loops; `type` aliases; named exports; `@/` imports without extensions; every identifier string (route path, env name, settings key, header, refusal, requirement) is a value of an `as const` object, declared once; discriminated unions switched exhaustively with a `never` default; one object parameter; early returns; no comments that restate code; no em or en dashes, UI copy included.
- Web: shared state in zustand under `apps/raven/web/src/stores/`, server data in TanStack Query with keys in `queryKeys`. The coverage floors in `apps/raven/web/package.json` (`--lines 96 --functions 88`) must still pass.
- Tasks run through Nx from the worktree root: `bunx nx run @raven/server:test` (or `:typecheck`, `:lint:ts`, `:format:check`), the same for `@raven/web`, `@raven/ui` and `@raven/core`, then `bun run verify`.

## Review Focus

- A new route with no account mark: under `ready` it is approved-only by default, never open (Task 2's sweep runs every route anonymously).
- An owner's `raven_unlock` cookie left in a shared browser while a member signs in: the member sees no locked library and gets 404, not 423 (Task 4).
- A legacy `?t=` HMAC ticket together with a valid member cookie on a locked library's `file`: refused by the PIN lock, since the legacy-ticket bypass is off under `ready` (Task 5).
- The env file is lost on a server that enforced accounts: it starts `unavailable` and health answers, but nothing else does (Task 1).
- The JWT expires while `/api/events` is open, or the web's `EventSource` gets a 401 on reconnect: the server ends the stream, and the web opens a new one with the refreshed cookie instead of staying closed (Tasks 6 and 9).

---

### Task 0: Spike, no repo code

**Files:** scratchpad only. Record the outcomes in this plan under "Spike results" before Task 1.

- [x] **Step 1:** Rebase `raven-auth-enforcement` onto `raven-auth-desktop`. Confirm the built desktop matches "What raven player does against this server": Bearer on every allowlisted call to a `ready` server, `getAccountTicket` (POST) for the relay and downloads there, `getMediaTicket` (GET) and the admin calls only for `off` and `legacy` servers. Record any difference here; a difference changes Tasks 3, 5 or 8 before they start.
- [x] **Step 2:** In a scratch Nest app with Fastify, confirm three things: a global guard runs for the auto-generated `HEAD` of a `GET`; it runs before `ParseIntPipe` (so a refusal never depends on a valid `:id`); and it runs for an `@Sse()` route before the stream opens.
- [x] **Step 3:** Against the local stack (`bunx nx run @raven/supabase:start`) and a raven started `ready`, count the `current_membership` calls and their p50 latency for one library page load with and without coalescing. D2 is decided; this records what it saves, for the PR.
- [x] **Step 4:** In Chrome, confirm that an `EventSource` whose reconnect gets a 401 ends `CLOSED` and does not retry (Task 9 depends on it). Also confirm what a `<video>` does when its open range response is cut mid-play: a new range request, or an `error` event. With a scratch loopback relay like the desktop plan's spike, confirm the same for mpv: an upstream response the server ends mid-body makes lavf reconnect through the relay, which mints a fresh ticket, and playback goes on (D4).
- [x] **Step 5:** Write the findings here. No commit of scratch code.

**Spike results (2026-10-19):**

- **Desktop (step 1), read at `573a4476`.** It matches "What raven player does against this server". Every allowlisted call takes its token from `authorizeWith` (`accounts/accountService.ts:159-172`), which answers one only while the server is kept as `ready`, adds it as Bearer (`servers/serverCalls.ts:125-135`, `310`) and refreshes once on a `401 signed_out` (`serverCalls.ts:313-328`). The relay and downloads mint with `getAccountTicket`, `POST /api/auth/media/:id/ticket` (`servers/allowlist.ts:320-325`, `servers/accountTickets.ts:107-109`). `getMediaTicket` is made only by `downloads/mediaAccess.ts:330-333`, on the branch taken when the server is not ready (`mediaAccess.ts:459-462`). `getAdminLock` and `unlockAdmin` are refused before any request when the server is kept with accounts (`serverCalls.ts:361-366`), and `expand.ts:167` skips the admin probe there. Playback of a non-ready server is mpv on the server URL with the cookie and no ticket at all (`servers/serverSources.ts:275-292`). One fallback to know: `accountsReady.ts` takes a server as not ready when its first `stateOf` read in a session takes over 3 s, so that title plays direct (a `401` under `ready`, ended as `eof`) and its download mints with `GET /api/media/:id/ticket` plus Bearer. Task 5's GET unification serves that an account ticket, so keep GET with Bearer working there. Nothing changes in Tasks 3, 5 or 8.
- **Downloads cut mid-body (D4).** A body the server ends by closing the connection makes `fetchToFile` answer `unreachable` with the bytes on disk kept (`downloads/fetchFile.ts:214-220`). `fetchVideo` reads new access only for a renewal or a first `401`/`423` (`downloads/downloadQueue.ts:590-593`), so the cut goes to `settleFailure` (`downloadQueue.ts:530-535`) and `failUnreachable` (`downloadQueue.ts:333-337`). The file fails as "could not be reached", every other file of that server pauses, and the outage retry (`OUTAGE_RETRY_MS = 300_000`, `downloadQueue.ts:71`, armed at `744-757`) resumes it from the part by range with a freshly minted ticket (`mediaAccess.ts:441`, `isFresh: true`). So it does resume by range with a fresh ticket, but only after up to five minutes, with a visible failure and the whole server's queue paused. A body that ends cleanly but short is worse: `fetchFile.ts:222-225` truncates the part and fails the file as `changed`. Per the ledger's ruling, a desktop fix goes on `raven-auth-desktop` before Task 6: on account access, an `unreachable` outcome that moved past the bytes it started from reads new access once and resumes at once, as a renewal does.
- **Nest on Fastify (step 2).** A global `APP_GUARD` runs for the auto-generated `HEAD` of a `GET` (`HEAD /api/items/5` reached the guard with handler `item`; a refusal answered 401 with no body). It runs before `ParseIntPipe`: `GET /api/items/abc` answers 401 when the guard refuses and 400 only when it passes. It runs for an `@Sse()` route before the stream opens: a refusal is a JSON 401 with no `text/event-stream` and the handler never runs; `HEAD` of the SSE route is guarded too. When the SSE observable completes, Nest ends the response cleanly; when it errors, Nest writes `event: error` with the exception's message, then ends. Task 6 should complete it (`takeUntil`), never error it.
- **Ending a media response (Task 6).** With `Content-Length` sent, only destroying the response tells the client. A scratch Fastify route that destroyed its body stream mid-way: Node's client saw `aborted`, and `fetch` rejected with `terminated` (`other side closed`). One that ended its stream cleanly at 100 KB of 1 MB left the client waiting on the missing bytes until the keep-alive timeout (Node's 5 s in the relay run, Fastify's 72 s by default): raven player's downloads would stall for 30 s first. Task 6 ends a `file`, `stream` or subtitle response with `reply.raw.destroy()` (or destroying the read stream with an error), never a clean end, and its listening test asserts the client's read rejects.
- **Membership lookups (step 3).** Run against the real local stack (Docker was down at first and came back). raven was not started `ready` with a library: before Task 2 no library route asks for membership, so instead each simulated request made the RPC exactly as `AuthBackend.current` makes it, which is what Task 2's gate does per request. One RPC at a time (60, member token): p50 3.3 ms, p95 about 6 ms. A 300-request page (the poster-heavy case in D2) without sharing makes 300 RPCs; sent at once (HTTP/2 behind Netlify or Funnel), each request waited p50 82 ms, p95 145 ms, and 49 of 300 (56 on a rerun) failed with a socket error at the local Kong, each of which would be a 503 `unavailable` poster. Sent six at a time (a browser on HTTP/1.1), 300 RPCs add about 150 ms. With D2's sharing and 5 s reuse: 1 RPC, about 3 ms, no failures. At 100 requests: 100 RPCs (p50 wait 41 ms) against 1. The stack was stopped afterwards.
- **Chrome 155 (step 4).** An `EventSource` whose stream ends (cleanly or by a reset) fires `error` in `CONNECTING`, reconnects, and when that reconnect gets a 401 fires `error` with `readyState` `CLOSED` and never asks again (two requests in 8 s). Task 9's reopen after 5 s is needed. A `<video>` whose open `206` was cut mid-play (2.5 MB into a 12 MB file) asked again at once with `Range` from just before the cut (`bytes=2450000-`, 0.4 s later), on the same URL, with no `error` event, and played to the end. When that range got a 401, the element fired `error` code 2 (`MEDIA_ERR_NETWORK`, `PIPELINE_ERROR_READ`) at once, with 6 s played and more buffered, and the player says "The connection to the server dropped." So a cut is harmless to the web only while the ticket in the `<video>` URL still opens: Task 8's 120 s refresh, which re-attaches the file with each new ticket, keeps it so, and a removed account ends in that network error.
- **mpv through the relay (step 4).** The CI-built libmpv (mpv 0.41.0, FFmpeg 8.1.2, the addon loaded in plain Node, headless) played a 60 s MKV through a scratch relay shaped like `mediaRelay.ts`, with `stream-lavf-o=max_redirects=0,reconnect_delay_max=3` and `network-timeout=15`. The upstream destroyed its first response 3 MB in and expired that ticket. lavf logged "Stream ends prematurely" and "Will reconnect at 2944000 in 0 second(s)"; the relay's pipe failed, it destroyed mpv's response, mpv asked for `bytes=2944000-`, the held ticket got 401, the relay minted once more and got 206, and playback ran to 59.8 s and `eof` with 2 mints. The same cut with the account revoked: the reconnect got 403, mpv played what it held (to 13.9 s) and ended `eof`, and the relay saw the refusal, as the desktop reads it. A clean but short end only reconnected once the keep-alive timeout closed the socket (6 s here), another reason for Task 6 to destroy.
- **Changes to the tasks.** Task 6: destroy, never end cleanly, and test that the client's read rejects; SSE ends by completing the observable. Before Task 6: the desktop download fix above, on `raven-auth-desktop`. Tasks 3, 5, 7, 8 and 9 stand as written; Task 10 step 4's download check should see an immediate resume once that fix is in.

### Task 1: Effective auth state and the enforcement record

**Files:**
- Create: `apps/raven/server/src/auth/effectiveAuth.ts`, `apps/raven/server/src/auth/effectiveAuth.test.ts`
- Modify: `apps/raven/server/src/auth/authConfig.ts` (`AUTH_ENV.accounts`), `apps/raven/server/src/config.ts` (`isAccountsOptedOut`), `apps/raven/server/src/settings/settingsRepository.ts`, `apps/raven/server/src/appModule.ts`, `apps/raven/server/src/auth/tokenVerifier.ts`, `apps/raven/server/src/auth/authBackend.ts`, `apps/raven/server/src/auth/authController.ts`, `apps/raven/server/src/auth/accountGuard.ts`, `apps/raven/.env.example`

**Interfaces:**
- Produces: `AUTH_ENV.accounts = 'RAVEN_ACCOUNTS'` and `ACCOUNTS_OPT_OUT = 'off'`. `ServerConfig.isAccountsOptedOut: boolean` is true only for exactly `off`.
- Produces: in `SettingsRepository`, `accountsEnforcedAt(): string | null`, `markAccountsEnforced({ at }: { at: Date }): void` and `forgetAccountsEnforced(): void`, under a settings key from a `SETTINGS_KEYS` `as const` (add `accounts`; the existing literal keys move into it too).
- Produces: pure `effectiveAuth({ configured, hasEnforced, isOptedOut }: { configured: AuthConfig; hasEnforced: boolean; isOptedOut: boolean }): { auth: AuthConfig; record: EnforcementRecord }`, with `ENFORCEMENT_RECORDS = { keep: 'keep', mark: 'mark', forget: 'forget' } as const`. The rules: `ready` gives `ready` + `mark`. `unavailable` gives `unavailable` + `keep`. `off` with `isOptedOut` gives `off` + `forget`. `off` with `hasEnforced` gives `unavailable` + `keep`. Plain `off` gives `off` + `keep`. Supabase env present together with `isOptedOut` gives `unavailable` + `keep` (conflict).
- Produces: DI token `AUTH_STATE` (`Symbol('AUTH_STATE')`) holding the effective `AuthConfig`, provided by a factory that injects `SERVER_CONFIG` and `SettingsRepository`, applies the record and logs one error line for an `unavailable` caused by the record. `AUTH_VERIFY` becomes a factory over `AUTH_STATE`. `AuthBackend`, `AuthController.authConfig` and `AccountGuard` read `AUTH_STATE`, never `config.auth`.

- [x] **Step 1:** Write the `effectiveAuth` tests, one per rule above, asserting `{ auth: { state }, record }`.
- [x] **Step 2:** Run `bunx nx run @raven/server:test -- effectiveAuth`. Expected: FAIL, module missing.
- [x] **Step 3:** Implement `effectiveAuth`, the settings methods, `isAccountsOptedOut` and the `AUTH_STATE` provider.
- [x] **Step 4:** Add an app test in `appAuth.test.ts`: start `ready` on a data dir, close it, start again on the same dir with `auth: { state: off }`. `/api/auth/config` answers `{ state: 'unavailable' }`, `/api/health` 200 and `/api/libraries` 503 `unavailable`. A third start with `isAccountsOptedOut: true` answers `off`, and `/api/libraries` 200.
- [x] **Step 5:** Run the server tests. Expected: PASS, and existing tests unchanged (their fresh data dirs are never marked).
- [x] **Step 6:** In `.env.example`, replace the "not yet enforced" block with what `ready` now does, and document `RAVEN_ACCOUNTS=off` as an explicit, logged security rollback.
- [x] **Step 7:** Commit `MAE: remember that raven enforced accounts and never fall back silently`.

### Task 2: Default-deny account gate

**Files:**
- Modify: `apps/raven/server/src/auth/accountGuard.ts`, `apps/raven/server/src/auth/authSessions.ts`, `apps/raven/server/src/routeMarks.ts`, `apps/raven/server/src/health/healthController.ts`, `apps/raven/server/src/auth/authController.ts`, `apps/raven/server/src/media/mediaOriginsController.ts`, `apps/raven/server/src/test/auth.ts`
- Create: `apps/raven/server/src/test/enforced.ts`, `apps/raven/server/src/appEnforcement.test.ts`

**Interfaces:**
- Produces: `ACCOUNT_REQUIREMENTS = { anyone, session, approved, owner }` (adds `anyone`), `type AccountRequirement`, and `OpenToAnyone = () => RequireAccount(ACCOUNT_REQUIREMENTS.anyone)`. The name avoids the lock's existing `Public()`, which means something else.
- Produces: `accountRuleOf(targets: MarkTargets): { requirement: AccountRequirement; isExplicit: boolean }`. An explicit `RequireAccount` mark wins. Otherwise `@AdminOnly()` gives `owner` and anything else `approved`, with `isExplicit: false`.
- Produces: `RouteMark.account: AccountRequirement`.
- Produces: in `AuthSessions`, the union `type Caller = { kind: 'legacy' } | { kind: 'session'; session: Session; isBearer: boolean } | { kind: 'ticket'; account: Account; token: string; expiresAt: number }`, with kinds from `CALLERS`. `callerOf({ request }): Caller` defaults to `legacy`. `bindSession` takes `isBearer`.
- Gate rules: `anyone` always passes. `off`: an explicit rule is enforced as today (503 when not `ready`), and a default rule passes as `legacy`. `unavailable`: 503 for everything but `anyone`. `ready`: authenticate (Bearer first, `GET`/`HEAD` cookie fallback), then `session` needs a membership, `approved` needs `approved`, and `owner` needs `isOwner`. Every gated response gets `Vary: authorization, cookie` and `cache-control: no-store`; a handler that sets its own `private` policy (images, files) overrides it. A legacy (non-`account.`) `?t=` never authenticates under `ready`.
- Produces in `src/test/enforced.ts`: `createEnforcedApp({ root, fixture, libraryPin? }): Promise<{ app; mediaDir; ownerApi: ApiClient; ids: { library: number; video: number; item: number | null } }>`. It starts `ready` with `authFixture`, and the owner creates and scans one library. Also `CALLER_KINDS = { anonymous, unverified, pending, revoked, member, owner }` and `headersFor({ fixture, caller, via }): Promise<Record<string, string>>`, where `via` is `bearer` or `cookie` and `unverified` mints for `AUTH_TEST_IDS.missing`.

- [x] **Step 1:** Mark `HealthController.get`, `AuthController.authConfig` and `MediaOriginsController.ping` with `@OpenToAnyone()`. `me` stays `session`.
- [x] **Step 2:** In `appEnforcement.test.ts`, write `it('declares every route exactly as the inventory says')`. It asserts `routeMarks(CONTROLLERS).map(({ method, path, account }) => ...)` equals an explicit sorted table of all 79 rows from "Route inventory" above, and that the `anyone` rows are exactly the three listed.
- [x] **Step 3:** Write `it('refuses every protected route to anonymous, unverified, pending and revoked callers')`. It loops over the routes with `Array.prototype.flatMap` (`GET` routes also as `HEAD`), fills `:params` with `1`, and expects 401 `signed_out` for anonymous, 403 `pending` for unverified and pending, and 403 `revoked`. It also asserts `vary` and `no-store` on each refusal and that `anyone` routes answer without calling the fake fetcher.
- [x] **Step 4:** Write `it('refuses every write sent with only the cookie')`: every non-GET with the member's cookie gives 401 `signed_out`.
- [x] **Step 5:** Write the JWT cases against `GET /api/libraries`. Expired (`expiresIn: -60`), wrong issuer, wrong audience, an HS256 token, `alg: none` and a garbage Bearer all give 401. Fetcher `network`, `malformed` and `wrongAccount` give 503. A bad Bearer next to a valid owner cookie gives 401.
- [x] **Step 6:** Write `it('lets an approved member read, write and fetch artwork')`: the library list, media, item, home, a thumbnail and an item image (asserting `private`, never `public`), `PUT progress` with Bearer (204) and `PUT /api/watched` (204).
- [x] **Step 7:** Run. Expected: FAIL. Implement the gate, the rule reader and the caller union. Run again: PASS, and every existing test still passes (they run `off`).
- [x] **Step 8:** Commit `MAE: hold every raven route to an approved account by default`.

### Task 3: Owner-only management, the admin password retired

**Files:**
- Create: `apps/raven/server/src/auth/management.ts`
- Modify: `apps/raven/server/src/admin/adminGuard.ts`, `apps/raven/server/src/admin/adminController.ts`, `apps/raven/server/src/libraries/librariesController.ts`, `apps/raven/server/src/appModule.ts`, `apps/raven/server/src/appEnforcement.test.ts`

**Interfaces:**
- Consumes: `callerOf`, `AUTH_STATE` (Tasks 1 and 2).
- Produces: `Management.canManage({ request }: { request: FastifyRequest }): boolean`. `legacy` gives `!admin.isLocked({ cookie })`; `session` and `ticket` give `account.isOwner`. Also `Management.isLegacy(): boolean` (auth `off`).
- `AdminGuard`: under `ready`, an `@AdminOnly()` route by a non-owner throws `authFailure(AUTH_REFUSALS.notOwner)`. Under `off` it behaves as today. The gate has already refused `unavailable`.
- `AdminController`: every handler first throws `NotFoundException('This server signs in with accounts; the owner manages it.')` unless `isLegacy()`. Under `ready` it never reads or sets `raven_admin`.
- `LibrariesController.withStatus` gets `isAdmin` from `canManage`, never from `admin.isLocked`.

- [x] **Step 1:** Write `it('refuses every owner route to an approved member')`: the sweep over the 26 owner rows with member Bearer gives 403 `not_owner`.
- [x] **Step 2:** Write `it('lets the owner manage')`: owner Bearer on `PUT /api/settings/display` (200), `GET /api/streams` (200), `GET /api/fs/browse` (200), `GET /api/media/:id/location` (200), and `POST /api/libraries` then `DELETE` (204).
- [x] **Step 3:** Write `it('gives the old admin password and cookie nothing')`. With `adminPassword` set, `POST /api/admin/unlock` with the right password and member Bearer gives 404 and no `set-cookie`. A `raven_admin` cookie minted by an `off` server on the same data dir (whose admin secret is in `settings`) plus member Bearer gives 403 on `PUT /api/settings/display`. `GET /api/libraries` for the member shows `paths: []`; for the owner it shows the real paths. Owner Bearer on `GET /api/admin` also gives 404: raven player never calls it on a `ready` server, and the web stops in Task 9.
- [x] **Step 4:** Run: FAIL. Implement. Run: PASS. `appLock.test.ts`'s admin-lock suite (`off`) is unchanged and passes: D1 keeps the admin password for `off` servers, and raven player still unlocks them with it.
- [x] **Step 5:** Commit `MAE: make raven management the owner's and retire the admin password under accounts`.

### Task 4: PIN bound to the account

**Files:**
- Modify: `apps/raven/server/src/lock/lockService.ts`, `apps/raven/server/src/lock/lockGuard.ts`, `apps/raven/server/src/lock/lockController.ts`, and every `lock.viewer({ cookie })` caller: `items/itemsController.ts`, `items/matchController.ts`, `items/peopleController.ts`, `libraries/librariesController.ts`, `media/homeController.ts`, `media/watchedController.ts`. Test: `apps/raven/server/src/appEnforcement.test.ts`

**Interfaces:**
- Consumes: `Management.canManage`, `callerOf`.
- Produces: `LockService.viewer({ request }: { request: FastifyRequest }): Viewer`, `state({ request }): LockState` and `unlock({ pin, request }): Unlocking`. Controllers inject `@Req()` in place of `@Headers(cookie)`.
- Cookie value: `${expires}.${accountId}.${signature}`, signing `${expires}.${accountId}`. `accountId` is `''` for `legacy`. `isUnlocked` needs `canManage` and an `accountId` equal to the caller's. An old two-part cookie is read as locked.
- "Hidden" (locked libraries not listed, 404 rather than 423) is `!canManage`, which replaces `admin.isLocked`. Under D3, `unlock` by a non-owner under `ready` answers 403 `not_owner`, and `state` answers `{ available: false, unlocked: false }` to a non-owner.

- [x] **Step 1:** Write the tests with a locked library (`createEnforcedApp({ libraryPin: '3001' })`). The owner gets 423 on a locked video's `file`, unlocks with Bearer (200 and a `set-cookie`), then gets 200. The member sending the owner's `raven_unlock` cookie with member Bearer gets 404 on that `file` and does not see the library in `GET /api/libraries` (the Review Focus case). The member's unlock gives 403 `not_owner`. A legacy two-part cookie gives 423 to the owner.
- [x] **Step 2:** Run: FAIL. Implement. Run: PASS, and `appLock.test.ts` (`off`) is unchanged and green.
- [x] **Step 3:** Commit `MAE: bind raven's PIN unlock to the account that entered it`.

### Task 5: Account tickets on every media path

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (`ACCOUNT_TICKET_SECONDS`), `apps/raven/server/src/auth/accountTickets.ts`, `apps/raven/server/src/playback/playbackController.ts`, `apps/raven/server/src/media/mediaOriginsController.ts`, `apps/raven/server/src/lock/lockGuard.ts`, `apps/raven/server/src/auth/authController.ts`, `apps/raven/server/src/appEnforcement.test.ts`

**Interfaces:**
- Produces: `ACCOUNT_TICKET_SECONDS = 300` in core. `AccountTickets` derives its `TICKET_MS` from it.
- `GET /api/media/:id/ticket` under `ready` issues exactly what `POST /api/auth/media/:id/ticket` issues, through one `AccountTickets.issue`. Both need `caller.kind === session` with `isBearer`, otherwise 401 `signed_out`. Under `off` it stays the HMAC ticket. This keeps the web's media plane (`useMediaPlane` calls `getMediaTicket`) working with no client change. raven player does not depend on it: on a `ready` server it mints with the POST route, and it calls the GET route only on `off` and `legacy` servers.
- Redemption answers what raven player's relay and downloads branch on: an expired, unknown or other-media `account.` ticket is 401 `signed_out` (they mint again), a pending or removed account is 403 `pending`/`revoked` (they stop), and every range request is authorized on its own.
- `MediaOriginsController.list` offers origins when auth is `ready` or the media secret is set.
- `LockGuard` takes the legacy `MediaTickets.verify` path only when auth is `off`, so under `ready` a legacy HMAC ticket opens nothing, the owner's included. A member's account ticket is checked against the library's visibility again at every redemption, so a library locked after the ticket was minted refuses it at once. An owner's account ticket carries the mint-time PIN unlock and is honoured only while the caller can manage. A ticket URL is a capability for one title for up to 300 s and is not invalidated by the owner's own sign-out. The media secret warning shows only on servers without accounts.

- [x] **Step 1:** Write the ticket tests. An anonymous `GET` ticket gives 401, the member cookie only gives 401, member Bearer gives 200 with an `account.` ticket that expires within 300 s. That ticket alone plays `file` with `Range: bytes=0-99` (206 plus `content-range`), with an unsatisfiable range (416), with `HEAD` (200), and for `subtitles/:trackId` of a sidecar `.srt` (200 `text/vtt`). A ticket redeemed past its `expiresAt` (`vi.useFakeTimers({ toFake: ['Date'] })`, moved 301 s on) and a ticket for another media id give 401 `signed_out`; a new POST mint with the same Bearer plays again. After the owner sets the member `revoked` through `/api/auth/members/:id/status`, the same ticket's next range gives 403 `revoked`. A legacy HMAC ticket (server with `RAVEN_MEDIA_SECRET`) gives 401. A legacy ticket with member Bearer on a locked library's `file` gives 404 (the Review Focus case). `GET /api/media-origins` lists origins with no secret set.
- [x] **Step 2:** Run: FAIL. Implement. Run: PASS. Run `bunx nx run @raven/core:test`: PASS.
- [x] **Step 3:** Commit `MAE: open raven's media paths only to account tickets under accounts`.

### Task 6: Bounded rechecks for SSE and open media responses

**Files:**
- Create: `apps/raven/server/src/auth/accessRechecks.ts`, `apps/raven/server/src/auth/accessRechecks.test.ts`
- Modify: `apps/raven/server/src/auth/authSessions.ts`, `apps/raven/server/src/events/eventsController.ts`, `apps/raven/server/src/streams/trackStream.ts`, `apps/raven/server/src/media/mediaController.ts`, `apps/raven/server/src/playback/playbackController.ts`, `apps/raven/server/src/appModule.ts`, `apps/raven/server/src/app.ts` (`accessRecheckMs` option), `apps/raven/server/src/appEnforcement.test.ts`

**Interfaces:**
- Produces: in `AuthSessions`, `remember({ account, token, expiresAt })`, called on every successful authenticate (Bearer, cookie, and the JWT a ticket redemption rechecks with), and `freshestFor({ accountId }): { token: string; expiresAt: number } | null`. The map is bounded and pruned at expiry.
- Produces: DI token `ACCESS_RECHECK_MS` (default `60_000`, overridable through `createApp({ accessRecheckMs })`). `AccessRechecks.ended({ request }): Observable<void>`. For an account caller it emits once, then completes, on the first recheck that refuses or finds no unexpired token for the account, or that finds an integrity failure (an account mismatch, more than one or malformed membership rows); an `unavailable` recheck keeps an already-authorized stream and retries on the next tick, bounded by the last-known token's expiry, while removal ends it at once. For a `legacy` caller it never emits. The timer is cleared on unsubscribe.
- `EventsController.stream(@Req() request)` pipes `takeUntil(rechecks.ended({ request }))`. `trackStream` takes `rechecks` and subscribes, calling `connection.close()` on emit.

- [x] **Step 1:** Write the unit tests with fake timers: no emit while approved; emit after a revocation at the next tick; emit at token expiry when no fresher token was remembered; no emit at expiry when a fresher token for the same account was remembered; unsubscribe clears the timer.
- [x] **Step 2:** Write the listening-server tests (`app.listen`, `fetch`, as `app.test.ts` does for SSE) with `accessRecheckMs: 100`. Anonymous `/api/events` gives 401. Member Bearer gets the `libraryChanged` event. After revocation the body ends within 1 s. A member `file` response read slowly is cut within 1 s of revocation. A `file` response opened with a ticket whose JWT expires (minted with `fixture.mint({ expiresIn: 2 })`) is ended at that expiry when no fresher token was seen, and kept open when the member made a Bearer call with a fresh token in between (raven player's relay and progress saves). After the cut, a `Range` from the received offset with a newly minted ticket answers 206 from that offset, which is how the relay and downloads resume.
- [x] **Step 3:** Run: FAIL. Implement. Run: PASS.
- [x] **Step 4:** Commit `MAE: end raven's open streams when an account loses access`.

### Task 7: Coalesced membership lookups

**Files:**
- Create: `apps/raven/server/src/auth/membershipLookups.ts`, `apps/raven/server/src/auth/membershipLookups.test.ts`
- Modify: `apps/raven/server/src/auth/authSessions.ts`, `apps/raven/server/src/auth/authController.ts`, `apps/raven/server/src/appModule.ts`

**Interfaces:**
- Produces: `MembershipLookups.current({ token }): Promise<Account | null>`, keyed by SHA-256 of the token. Concurrent calls share one `AuthBackend.current`, and a resolved answer is reused for `MEMBERSHIP_TTL_MS = 5_000` (D2). Failures are never cached. Entries are capped at 4096. Also `forget({ accountId }): void`.
- `AuthSessions.authenticate` uses it, and so do ticket redemptions and Task 6's rechecks. `AuthController.setStatus` calls `forget` for the target after a successful change, so removal through raven's Users screen is seen by the next request and the next recheck. Owner RPCs themselves (`list`, `setStatus`) are never cached.

- [x] **Step 1:** Unit tests: 50 concurrent calls make 1 backend call; a call at TTL + 1 ms makes a second one; a rejected lookup is not reused; `forget` forces a fresh lookup.
- [x] **Step 2:** App test: the owner revokes the member through raven, and the member's next request and next ticket redemption give 403 `revoked` with no wait, inside the 5 s window (acceptance 5).
- [x] **Step 3:** Run: FAIL. Implement. Run: PASS.
- [x] **Step 4:** Commit `MAE: share raven's membership lookups between concurrent requests`.

### Task 8: The web player's tickets refresh inside the account lifetime

**Files:**
- Modify: `libs/raven/ui/src/lib/playerQueries.ts`, its test

**Interfaces:**
- Consumes: `ACCOUNT_TICKET_SECONDS` (Task 5).
- Only the web reads `mediaTicket` (through `useMediaPlane` on the watch page). raven player plays server titles natively through its relay, which renews its own tickets every 240 s, so nothing here touches the desktop.
- `TICKET_REFRESH_MS` becomes `Math.min((MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000, ACCOUNT_TICKET_SECONDS * 400)`, which is 120 s. Legacy tickets refresh more often than they need to, at no cost.

- [x] **Step 1:** Update the `mediaTicket` refetch-interval test to expect 120 000 ms after the first ticket.
- [x] **Step 2:** Run `bunx nx run @raven/ui:test`: FAIL. Implement. Run: PASS.
- [x] **Step 3:** Commit `MAE: refresh raven's media tickets inside an account ticket's life`.

### Task 9: Web follows the gated server

**Files:**
- Create: `apps/raven/web/src/lib/management.ts`, `.test.tsx`
- Modify: `apps/raven/web/src/lib/adminLock.ts`, `apps/raven/web/src/components/AdminOnly/AdminOnly.tsx`, `apps/raven/web/src/components/AppShell/AppShell.tsx`, `apps/raven/web/src/pages/SettingsPage/SettingsPage.tsx`, `apps/raven/web/src/pages/StreamsPage/StreamsPage.tsx`, `apps/raven/web/src/pages/LibrariesPage/LibrariesPage.tsx`, `apps/raven/web/src/pages/LibraryPage/SectionViews.tsx`, `apps/raven/web/src/components/AuthGate/AuthGate.tsx`, `apps/raven/web/src/lib/prefetchPlaybackSettings.tsx`, `apps/raven/web/src/components/MediaOriginProbe/MediaOriginProbe.tsx`, `libs/raven/ui/src/lib/useMediaOriginProbe.ts`, `apps/raven/web/src/lib/useServerEvents.ts`, `apps/raven/web/src/test/render.tsx`, and the tests beside each

**Interfaces:**
- Produces: `MANAGEMENT_MODES = { adminLock, owner, none } as const`, pure `managementOf({ access, adminLock }): { mode: ManagementMode; canManage: boolean }` and `useManagement()`. `disabled` gives `adminLock` with `canManage = !isAdminLocked(lock)`. `approved` gives `owner` with `canManage = account.isOwner`. Every other access kind gives `none` and `false`. `useCanManage()` returns `useManagement().canManage`. `adminLockQuery` runs only in `adminLock` mode, and the same goes for `useFollowAdminLock`.
- Copy in `owner` mode, with no "admin lock" anywhere: Settings shows "Only the owner can change these."; Streams shows "Streams are for the owner"; Libraries shows "Only the owner can add a library."; Not matched shows "Only the owner can point these at the right {title}." The `AdminLockSection` renders only in `adminLock` mode.
- `AuthGate`: `unavailable` no longer renders the outlet. It shows a panel headed "raven is temporarily unavailable", with "raven could not reach its accounts. Try again in a moment." and Try again (refetch `queryKeys.auth`).
- `PrefetchPlaybackSettings` and the origin probe run only when access is `disabled` or `approved`. `useMediaOriginProbe({ api, isEnabled })` still returns a `reprobe`, but probes nothing until `isEnabled`.
- `useServerEvents` reopens the `EventSource` `EVENTS_RETRY_MS = 5_000` after it ends `CLOSED`, and at once when the session's `accessToken` changes.

- [x] **Step 1:** Tests: `managementOf` for every access kind; an owner sees Add library, and a member sees the owner copy without one; Settings in `owner` mode has no admin lock section and makes no `/api/admin` request; the gate in `unavailable` shows the panel, not the page.
- [x] **Step 2:** Test that a signed-out visitor on `/sign-in` with `ready` config makes no request but `/api/auth/config` (the fetch spy sees only it).
- [x] **Step 3:** Test `useServerEvents` with a fake `EventSource`: an `error` with `readyState` `CLOSED` opens a new one after 5 s (fake timers), and a token change replaces the open one.
- [x] **Step 4:** Run `bunx nx run @raven/web:test` and `@raven/ui:test`: FAIL. Implement. Run: PASS, coverage floors held. `lint:css` and `typecheck` pass.
- [x] **Step 5:** Commit `MAE: let raven web follow the owner and the gated server`.

### Task 10: Docs, verification and walkthrough

**Files:**
- Modify: `apps/raven/README.md` ("Supabase account preparation" becomes "Accounts"; "Admin lock" is scoped to servers without accounts; the environment table gains `RAVEN_ACCOUNTS`), `apps/raven/CLAUDE.md` (the gate is default-deny, `@AdminOnly()` means the owner under accounts, a new route open to anyone needs `@OpenToAnyone()` and a row in the inventory test, and the "does not yet gate" sentence goes), `apps/raven/supabase/README.md` (cutover steps below), `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (PR 6 section, ticked), the spec's status line
- No source files.

- [x] **Step 1:** Confirm the server suite covers the spec's matrix: anonymous, unverified, pending, approved, revoked and owner callers across JSON, writes, artwork, SSE, files, ranges, subtitles and tickets (Tasks 2 to 7), plus JWT expiry, wrong issuer, audience and algorithm, an unavailable membership service and cache headers (Task 2). Add any missing cell to `appEnforcement.test.ts`.
- [x] **Step 2:** Run `bunx nx run-many -t test typecheck lint:ts format:check -p @raven/server @raven/core @raven/ui @raven/web`, then `bun run verify`. All pass.
- [ ] **Step 3:** Local walkthrough with the `run` skill. Start the Supabase stack and raven `ready`.
  - With curl and no credentials: `/api/libraries`, `/api/media/1/file`, `/api/media/1/thumbnail`, `/api/media/1/subtitles/0` and `/api/events` all give 401; `/api/health` gives 200; a legacy `?t=` gives 401.
  - Sign up a second account in a private window and confirm it through Mailpit. As the seeded owner, approve it.
  - The second account browses, plays direct and transcoded, seeks and shows subtitles. It sees no Add library, and a direct `PUT /api/settings/display` with its Bearer gives 403.
  - Copy its JWT and a ticket. Owner: Remove access. Its next API call with the original JWT and its next range with the original ticket give 403, and an open playback stops within 60 s.
  - Write down what was and was not seen.
- [ ] **Step 4:** Desktop walkthrough on Apple Silicon with `raven-auth-desktop`'s build against the same gated server: sign in; native playback through the relay, seeks and subtitles past five minutes, then left playing past one recheck; a pending account is refused; Remove access stops playback within 60 s. Start a download, let it run past a recheck, and remove access: it fails with the account copy. The server log shows no `/api/admin*` request from raven player. Then point the same build at an `off` server: the admin password and the PIN unlock work as today. Write down what was and was not seen, and any desktop gap (for example a download cut at token expiry that does not resume) goes to the desktop PR.
- [ ] **Step 5:** Commit `MAE: document raven's account enforcement`.
- [ ] **Step 6:** When the user asks, push and open the PR with base `raven-auth-desktop`, per `pr-format`. List in it what is not verifiable locally: Netlify forwarding of `Cookie`, `Authorization` and SSE without public caching, real SMTP, and the cloud redirect allowlist.

---

## Operator steps before production enforcement (not code)

1. Push migrations, then the auth config, to the cloud project (`@raven/supabase` tasks). Confirm the asymmetric ES256 signing key is active, leaked-password protection is on and the rate limits are set.
2. Configure the SMTP provider and the sender DNS (SPF, DKIM, DMARC). Send a real signup and recovery email, and open each link in another browser.
3. Set `site_url` and the redirect allowlist to raven's real web origins (the Netlify site and the Funnel address).
4. Bootstrap the owner (`apps/raven/supabase/README.md`): sign up and verify, set the private owner UUID, approve the owner.
5. Release the compatible desktop (`raven-auth-desktop` merged and tagged) and tell desktop users that older builds lose access.
6. Back up `/volume1/docker/raven/data` (SQLite, settings and the admin secret, for a rollback).
7. Stage the whole flow: a staging raven `ready` behind a Netlify deploy preview. Verify Netlify forwards `Cookie`, `Authorization` and SSE unbuffered, and caches no `/api` response.
8. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `RAVEN_WEB_URL` in Vhagar's `.env`. Review `RAVEN_MEDIA_ORIGINS` and `RAVEN_WEB_ORIGINS`. `ADMIN_PASSWORD` becomes inert; keep it only for the rollback. Deploy (`deploy-raven-vhagar`).
9. From outside the tailnet, run the after-enforcement checks: anonymous API, media and artwork requests fail, health answers, the owner approves a second account, it plays but cannot manage, and removal blocks its original JWT and ticket.
10. Per-account viewing data is the `raven-account-data` change ([`2026-10-18-raven-account-data.md`](2026-10-18-raven-account-data.md)): before inviting anyone, deploy it, with a backup of the data folder first, and sign in once as the owner so the history from before accounts is adopted. Without it, progress, plays, watched marks and favourites are shared by every approved account.
11. A rollback is `RAVEN_ACCOUNTS=off` with the Supabase env removed. It reopens anonymous access, so it is an explicit security decision.

## Risks

- Every protected request costs a JWKS-verified token plus a membership RPC. D2's sharing and 5 s cache bound it; a cold poster-heavy page still pays one RPC per token every 5 s.
- D2 means a status changed directly in the database, not through raven, can take up to 5 s to bite.
- `Vary: cookie` and hourly token refresh make the browser fetch images again roughly every hour.
- D4 against raven player's downloads: the desktop plan's Task 9 assumed the server checks a ticket only at the start. A download that outlives its account's newest token with no Bearer call in between is now ended mid-body, and resumes only if the desktop treats a short body as resumable (Task 10, step 4). The 32-ticket cap per account can refuse many parallel downloads; `DOWNLOAD_CONCURRENCY` is 2.
- A `<video>` whose cookie token expires mid-play gets a 401 on its next range. It relies on the Supabase client refreshing ahead of expiry, and on the player's error recovery (Task 0, step 4).
- `/api/media-origins/ping` stays open (1 MiB of noise per request), as it is today.
- `off` keeps the admin-password code alive. Removing `off` entirely is a follow-up once every server runs Supabase.

## Self-review

- **Spec coverage:** Default-deny gate and public allowlist test: Task 2. Owner-only management and the admin password inert: Task 3. PIN bound to accounts: Task 4. Account tickets, ranges, seeks and subtitles: Task 5. SSE reauthentication and bounded open streams: Task 6. Revocation with an old JWT or ticket: Tasks 5 and 7. Missing config fails closed: Task 1. Cache headers: Task 2. Web and desktop against a gated server: Tasks 8 to 10. Operator steps: the list above.
- **Consistency:** `AUTH_STATE`, `Caller`/`callerOf`, `ACCOUNT_REQUIREMENTS.anyone`/`OpenToAnyone`, `Management.canManage`, `AccessRechecks.ended`, `MembershipLookups`, `ACCOUNT_TICKET_SECONDS` and `MANAGEMENT_MODES` are each defined once and reused.
- **Decisions:** D1 is Task 1 (plus Task 3's unchanged `off` admin lock), D2 Task 7, D3 Task 4, D4 Task 6, D5 Task 2's `anyone` rows.
- **Desktop:** raven player mints with the POST ticket route on `ready` servers, so Task 5's GET unification is for the web alone and harmless to the desktop. If Task 0 finds the built desktop differs from "What raven player does against this server", fix the assumption here before Task 3.
