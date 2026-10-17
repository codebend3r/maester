# raven direct media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split raven on Netlify into a control plane (JSON, cookies, events, still proxied by Netlify) and a media plane (streams, files, subtitles) that the browser fetches straight from Vhagar over the fastest HTTPS origin it can reach, authorised by short-lived tickets; then make playback survive a dropped connection, step down to a transcode when the route cannot carry the file, let the viewer pick a quality, and show a stats overlay that says what is happening.

**Architecture:** The server learns its media origins, the web origins allowed to call them and a ticket secret from three env vars; a `@MediaPlane()` route mark is the one list of routes that get CORS headers and accept a `?t=` ticket, read by a Fastify `onRequest` hook and by `LockGuard`. `@raven/core` gets the contract (`isMediaOrigins`, `isMediaTicket`), a pure `pickOrigin`, and URL builders that take a `MediaAccess` (an origin and its ticket). `@raven/ui` probes the origins, keeps the pick in a sessionStorage-backed store, holds the ticket in a TanStack query, and hands a `MediaPlane` to the player through the `HtmlSource`; the web host wires it in `WatchPage`, the desktop passes nothing and is unchanged. Phase 2 lives in `streamSource` (resume, ticket refresh), a pure `starvation` rule read by a hook in `Stage`, and `usePlaybackLadder` (step down once, forced height). Diagnostics is a `StatsOverlay` fed by `EngineStats`.

**Tech Stack:** NestJS 12 on Fastify (hooks, `SetMetadata`), Node `crypto` (HMAC-SHA256, `timingSafeEqual` through `@shared/server`'s `sameSecret`), vitest for the server, React 19 + TanStack Query 5 + zustand `persist` for the client, bun test + happy-dom for `@raven/ui` and `@raven/web`, Nx 23 over Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-10-16-raven-direct-media-design.md` (all of Phase 1, Phase 2, Diagnostics, Tests and the Decisions section). Phase 3 is deferred by the spec itself.

## Global Constraints

- Everything in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`: no `any`, no casts, no `interface`, no enums, no loops, one object parameter, guards at every boundary, `@/` imports, no em or en dashes anywhere, comments only for a non-obvious why, SCSS modules with grid layout and tokens only.
- `libs/raven/core` stays platform-agnostic: no DOM, no Node, no `URLSearchParams` (use `toQueryString`), `lib: ["ES2023"]`.
- Every API shape is a guard in `libs/raven/core/src/contract.ts` and its type is `Infer<typeof guard>`.
- Every media origin and every web origin is an `https://` origin with no path, except a host of `localhost` which may be `http://`; anything else is dropped with a logged problem (spec: "Every origin must be HTTPS").
- Ticket lifetime is 6 hours (`MEDIA_TICKET_SECONDS = 21_600`); the client refreshes 10 minutes before the end (`MEDIA_TICKET_REFRESH_SECONDS = 600`); the probe body is 262,144 bytes (`MEDIA_PROBE_BYTES`); the probe timeout is 2,000 ms; the preference band is 20%; the visibility re-probe threshold is 10 minutes.
- Resume: at most 3 attempts with 1, 2 and 4 second backoff; the count resets after 30 seconds of clean reading. Step down: buffer ahead under 5 seconds for 10 seconds while delivered bits per second are below 1.2 × the file's `bitrate`; never back up within one play.
- Copy fixed by the spec: `Switched to 1080p: the connection is slower than this file.` (the height from the server's `maxHeight`, `4K` for 2160); the quality picker's options are `Original`, `4K`, `1080p`, `720p`; the overlay toggles on `i`.
- Commits follow the `commit-format` skill (`MAE:` subject, short bullets, no attribution). PRs follow `pr-format`. Each PR targets the branch before it; the first targets `redesign`.
- Before each commit: `bunx nx affected -t typecheck lint:ts format:check test` passes for the projects touched (lefthook runs lint-staged on commit and `verify` on push; never skip them).

## Rulings (where the spec is silent or the repo's shape says otherwise)

1. **One route mark, `@MediaPlane()`, names the media plane.** The spec lists the CORS routes and the ticket routes separately but they are the same set. `MediaPlane()` in `apps/raven/server/src/media/mediaPlaneMark.ts` marks `GET /api/media/:id/stream`, `/file`, `/subtitles/:trackId` and `GET /api/media-origins/ping`; `routeMarks` reads it, the CORS hook builds its path matchers from it, `LockGuard` accepts a ticket only on a route that carries it, and `lockMarkProblems` refuses a `@MediaPlane()` route that is not `GET` or is marked `PrivateBy` with anything but `'media'`. Tickets therefore never open `/api/media/:id`, `/tracks`, `/streams` or `/ticket` itself.
2. **Thumbnails stay on the control plane.** The spec puts `/thumbnail` and `thumbnailUrl` on the media plane, but a grid shows thousands of thumbnails and each would need a ticket. They keep today's relative URL and cookie; the player's poster is one of them. Only the stream, the file and the subtitles move.
3. **The client passes a `MediaAccess` per call rather than a `mediaBaseUrl` at construction.** The web app's `api` is a module singleton and the picked origin changes while the app runs, so `fileUrl`, `streamUrl` and `getSubtitles` take `access?: MediaAccess | null` (`{ origin: MediaOrigin; ticket: string }`), and build `${origin.url}${path}` with `t=<ticket>` when given, else today's relative URL. `createApiClient`'s signature is unchanged, so the desktop is untouched.
4. **The media plane is on only with origins and a usable secret.** `GET /api/media-origins` answers `{ origins: [] }` unless `RAVEN_MEDIA_ORIGINS` has at least one valid entry and `RAVEN_MEDIA_SECRET` decodes from base64 to 32 bytes or more; a start with origins but no usable secret logs one warning naming the env var. `GET /api/media/:id/ticket` answers 503 while the secret is unusable. A client that sees no origins never asks for a ticket, so the Vhagar-served web app and the desktop behave exactly as today.
5. **A web origin entry may hold one `*`, as the whole first hostname label**, matching exactly one label: `https://*--raven-player.netlify.app` admits `https://deploy-preview-12--raven-player.netlify.app` and not `https://a.b--raven-player.netlify.app`. Matching compares scheme, host and port; `Origin: null` never matches.
6. **The ticket refresh is timed from receipt, not from `expiresAt`.** Both sides import `MEDIA_TICKET_SECONDS` from `@raven/core`; the client refetches `MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS` seconds after the ticket arrived, so a client clock that is minutes off the server's changes nothing. `expiresAt` stays in the response for display and for the Phase 2 "expired" path.
7. **A pick younger than 10 minutes in `sessionStorage` is used without probing.** The spec probes "on app start"; a reload within the session should not cost 256 KB per origin again. Older than that, or on `online`, on `visibilitychange` to visible after 10 minutes hidden, or when a stream cannot connect, every origin is probed again.
8. **The step shows in the player's own notice slot, not the web app's `PlaybackNote`.** `PlaybackNote` is the grid badge ("Won't play in this browser") and is not in the player. `PlayerChrome` gets a `notice` prop rendered where "Resumed at" sits, cleared after 6 seconds, which the ladder's step fills with the spec's sentence.
9. **Starvation is one rule for both delivery kinds.** A sample a second of `{ aheadSeconds, deliveredRatio }`: for a stream, `deliveredRatio` is delivered bits per second over the file's `bitrate`; for direct play, which has no byte count, it is buffered seconds gained per wall second (the `<video>`'s `progress`). Ten consecutive samples with `aheadSeconds < 5` and `deliveredRatio < 1.2` step down; a seek resets the window; a null ratio (no `bitrate` in the index) never steps down.
10. **The quality pick persists per browser and forces one transcode height.** `usePlayerPrefs.quality` is `'original' | 2160 | 1080 | 720`; anything but `original` makes the ladder `['transcode']` with that height, which `GET /api/media/:id/stream` takes as `?height=` (one of `PLAYBACK_CHOICES.maxHeight`, applied to a transcode only, else 400). The group shows only when the server's `transcoding` is `on`; otherwise a stored pick is ignored and the ladder is today's.
11. **No Playwright for the web app.** The spec's e2e row is covered by the manual check in Task 9 (Vite at `http://localhost:5173` against a server with `lan:http://localhost:8484`), which the `localhost` exception in the Global Constraints exists for. The desktop harness is unchanged.
12. **The ping is capped.** `bytes` defaults to `MEDIA_PROBE_BYTES` and is clamped to 1 to 1,048,576; the bytes come from one 1 MiB buffer filled with `randomBytes` at construction, never from disk, with `cache-control: no-store` and `content-type: application/octet-stream`. It is `@Public()` and `@MediaPlane()`.
13. **A 423 on a cross-origin stream refreshes the ticket once.** `createStreamSession` gets `onLocked?: () => Promise<boolean>`; the session awaits it on a 401 or 423, reloads once at the same spot when it answers true (the `url` builder reads the ticket through a ref, so the new one is used without rebuilding the session), and fails with today's message when it answers false. A relocked library therefore still ends in Unplayable, as it does now.

## Review Focus

1. A copied "file link" pasted into VLC after 6 hours answers 423 with no page to enter the PIN. The copy message should say the link works for 6 hours (Task 9's test checks the message).
2. A laptop that slept at home and woke elsewhere holds a `lan` pick that no longer resolves; the first stream must report it and the player must move to the new pick without the viewer doing anything (Task 8's unreachable test).
3. A client clock 15 minutes ahead of the server would, with an `expiresAt`-based refresh, let the ticket lapse before the refresh; the refresh must be timed from receipt (Task 7's timing test).
4. A seek empties the buffer and the throughput ramps from zero; the step-down window must start over on a seek or every seek on a slow link transcodes (Task 12's reset test).
5. Safari in a private window throws on `sessionStorage`; the store must still pick an origin and keep it in memory (Task 7's storage test).

## PR stack

| PR | Branch | Base | Tasks | Spec |
| --- | --- | --- | --- | --- |
| 1 | `direct-media-play` (this worktree) | `main` | 1 to 5 | Phase 1, server side |
| 2 | `direct-media-client` | PR 1 | 6 to 9 | Phase 1, browser side, Netlify docs |
| 3 | `direct-media-stats` | PR 2 | 10 | Diagnostics |
| 4 | `direct-media-resume` | PR 3 | 11 | Phase 2, resume instead of fail |
| 5 | `direct-media-stepdown` | PR 4 | 12 | Phase 2, step down on bandwidth |
| 6 | `direct-media-quality` | PR 5 | 13 | Phase 2, quality picker |

Each PR: `gh pr create --base <base branch>` with the `pr-format` body. The spec file (already in the worktree) goes in PR 1's first commit.

The stack sits on `main`, not on `redesign` (decided 2026-10-17, after the plan was drafted against `redesign`'s tip). `redesign` is rebased onto `direct-media-quality` once PR 6 is open, with its conflicts resolved there, so it lands over the stack. Two consequences for the tasks: the player chrome on `main` is older than the one this plan was read against (`SettingsMenu` is one menu with no `menus.ts` sections, `Stage.tsx` has no `playbackFacts`), so Tasks 10, 12 and 13 read those files as they stand on the branch before touching them, and "the `playback` section" in them means the one menu; and a Ruling that names a `redesign` file that does not exist on the branch is applied to the file that holds that role on `main`.

---

## PR 1: the server's media plane

### Task 1: Config and the media plane's env vars

**Files:**
- Create: `apps/raven/server/src/media/mediaPlaneConfig.ts`
- Test: `apps/raven/server/src/media/mediaPlaneConfig.test.ts`
- Modify: `apps/raven/server/src/config.ts` (`ServerConfig`, `readServerConfig`), `apps/raven/server/src/config.test.ts`
- Modify: `apps/raven/.env.example`, `apps/raven/README.md` (Configuration table)
- Modify: `libs/raven/core/src/contract.ts` (the origin guards)
- Commit also: `docs/superpowers/specs/2026-10-16-raven-direct-media-design.md`, `docs/superpowers/plans/2026-10-17-raven-direct-media.md`

**Interfaces:**
- Produces in `@raven/core` (`contract.ts`): `isMediaOriginKind = oneOf(['lan', 'tailnet', 'public'])`, `isMediaOrigin = object({ kind: isMediaOriginKind, url: isString })`, `isMediaOrigins = object({ origins: listOf(isMediaOrigin) })`, `isMediaTicket = object({ ticket: isString, expiresAt: isNumber })`, types `MediaOriginKind`, `MediaOrigin`, `MediaOrigins`, `MediaTicket`, and the constants `MEDIA_TICKET_SECONDS = 21_600`, `MEDIA_TICKET_REFRESH_SECONDS = 600`, `MEDIA_PROBE_BYTES = 262_144`.
- Produces in `mediaPlaneConfig.ts`: `type MediaPlaneConfig = { origins: MediaOrigin[]; webOrigins: string[]; secret: Buffer | null; problems: string[] }`; `readMediaPlaneConfig(env: NodeJS.ProcessEnv): MediaPlaneConfig`; `parseMediaOrigins(value: string | undefined): { origins: MediaOrigin[]; problems: string[] }`; `parseWebOrigins(value: string | undefined): { origins: string[]; problems: string[] }`; `readMediaSecret(value: string | undefined): { secret: Buffer | null; problems: string[] }`; `isAllowedWebOrigin({ origin, allowed }: { origin: string | undefined; allowed: readonly string[] }): boolean`; `MEDIA_PLANE_ENV = { origins: 'RAVEN_MEDIA_ORIGINS', webOrigins: 'RAVEN_WEB_ORIGINS', secret: 'RAVEN_MEDIA_SECRET' } as const`.
- `ServerConfig` gains `mediaPlane: MediaPlaneConfig`.

- [ ] **Step 1: Write the failing tests** in `mediaPlaneConfig.test.ts`

```ts
describe('parseMediaOrigins', () => {
  it('reads kind:url entries best first and keeps their order', () => {
    expect(parseMediaOrigins('lan:https://raven.home.example.com, tailnet:https://raven.tail.ts.net').origins)
      .toEqual([{ kind: 'lan', url: 'https://raven.home.example.com' }, { kind: 'tailnet', url: 'https://raven.tail.ts.net' }])
  })
  it('strips a trailing slash and drops a path, a query, an unknown kind or a missing kind, naming each', () => {
    const parsed = parseMediaOrigins('lan:https://a.example/,lan:https://a.example/api,vpn:https://b.example,https://c.example')
    expect(parsed.origins).toEqual([{ kind: 'lan', url: 'https://a.example' }])
    expect(parsed.problems).toHaveLength(3)
  })
  it('drops an http origin unless its host is localhost', () => {
    expect(parseMediaOrigins('lan:http://192.168.1.2:8484').origins).toEqual([])
    expect(parseMediaOrigins('lan:http://localhost:8484').origins).toEqual([{ kind: 'lan', url: 'http://localhost:8484' }])
  })
  it('is empty for unset or blank', () => {
    expect(parseMediaOrigins(undefined)).toEqual({ origins: [], problems: [] })
    expect(parseMediaOrigins('  ')).toEqual({ origins: [], problems: [] })
  })
})
describe('parseWebOrigins and isAllowedWebOrigin', () => {
  it('keeps exact https origins and http://localhost, and drops the rest', ...)  // 'https://raven-player.netlify.app,http://localhost:5173,http://evil.example,https://x.example/path'
  it('matches a * as exactly one first label', () => {
    const allowed = parseWebOrigins('https://*--raven-player.netlify.app').origins
    expect(isAllowedWebOrigin({ origin: 'https://deploy-preview-12--raven-player.netlify.app', allowed })).toBe(true)
    expect(isAllowedWebOrigin({ origin: 'https://a.b--raven-player.netlify.app', allowed })).toBe(false)
    expect(isAllowedWebOrigin({ origin: 'https://raven-player.netlify.app', allowed })).toBe(false)
  })
  it('refuses a * anywhere but as the whole first label', ...)  // 'https://raven-*.netlify.app' and 'https://a.*.netlify.app' are dropped with a problem; 'https://*.netlify.app' is kept
  it('never matches a missing origin or "null"', ...)
  it('compares the port', ...)  // 'http://localhost:5173' does not admit 'http://localhost:4173'
})
describe('readMediaSecret', () => {
  it('decodes base64 of 32 bytes or more', ...)  // randomBytes(32).toString('base64') -> secret.length 32
  it('refuses fewer than 32 bytes, non-base64 text, unset and blank, with a problem', ...)
})
describe('readMediaPlaneConfig', () => {
  it('adds a problem and keeps no origins when origins are set without a usable secret', ...)
  it('keeps origins and secret together when both are usable', ...)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/media/mediaPlaneConfig.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the guards and constants to `contract.ts`** (beside `isPlaybackMode`), then implement `mediaPlaneConfig.ts` with the signatures above. `parseMediaOrigins` splits on commas, trims, splits each entry at its first `:`; an entry's url is accepted when `URL.canParse`, `new URL(url).origin === url.replace(/\/+$/, '')` and the protocol is `https:`, or `http:` with hostname `localhost`. A problem is one sentence naming the entry. `isAllowedWebOrigin` turns a pattern with `*` into a check that the given origin's host, split on `.`, equals the pattern's host split on `.` label by label, with the `*` label matching any non-empty label without a `.`.

- [ ] **Step 4: Wire it into `config.ts`** (`mediaPlane: readMediaPlaneConfig(env)`), and add a `config.test.ts` case that an env with nothing set gives `mediaPlane: { origins: [], webOrigins: [], secret: null, problems: [] }`.

- [ ] **Step 5: Run the tests**

Run: `bunx nx run @raven/server:test -- src/media/mediaPlaneConfig.test.ts src/config.test.ts`
Expected: PASS

- [ ] **Step 6: Document the env vars.** `.env.example` gets a `# --- Media plane (Netlify) ---` block with the spec's three lines and their comments; the README's Configuration table gets three rows (`RAVEN_MEDIA_ORIGINS`, `RAVEN_WEB_ORIGINS`, `RAVEN_MEDIA_SECRET`, each "unset", with the `*` rule and the `localhost` exception stated in one clause each).

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-10-16-raven-direct-media-design.md docs/superpowers/plans/2026-10-17-raven-direct-media.md libs/raven/core/src/contract.ts apps/raven/server/src/media/mediaPlaneConfig.ts apps/raven/server/src/media/mediaPlaneConfig.test.ts apps/raven/server/src/config.ts apps/raven/server/src/config.test.ts apps/raven/.env.example apps/raven/README.md
git commit -m "MAE: read raven's media origins, web origins and ticket secret"
```

### Task 2: Media tickets

**Files:**
- Create: `apps/raven/server/src/media/mediaTickets.ts`
- Test: `apps/raven/server/src/media/mediaTickets.test.ts`
- Modify: `apps/raven/server/src/appModule.ts` (provider)

**Interfaces:**
- Consumes: `ServerConfig['mediaPlane'].secret`, `MEDIA_TICKET_SECONDS` and `MediaTicket` from `@raven/core`, `sameSecret` from `@shared/server`.
- Produces: `@Injectable() class MediaTickets` with `constructor(@Inject(SERVER_CONFIG) config: ServerConfig)`, `get isOn(): boolean`, `issue({ id, now = Date.now() }: { id: number; now?: number }): MediaTicket` (throws `Error('RAVEN_MEDIA_SECRET is not set')` when off), `verify({ ticket, id, now = Date.now() }: { ticket: string; id: number; now?: number }): boolean`. Ticket format: `base64url("<id>.<expiresAt>")` + `.` + `base64url(HMAC-SHA256(secret, "<id>.<expiresAt>"))`; `expiresAt` is `now + MEDIA_TICKET_SECONDS * 1000` in ms.

- [ ] **Step 1: Write the failing tests**

```ts
const config = (secret: Buffer | null): ServerConfig => ({ ...readServerConfig({}), mediaPlane: { origins: [], webOrigins: [], secret, problems: [] } })
it('signs a ticket that verifies for its id until it expires', () => {
  const tickets = new MediaTickets(config(randomBytes(32)))
  const { ticket, expiresAt } = tickets.issue({ id: 7, now: 1_000_000 })
  expect(expiresAt).toBe(1_000_000 + 21_600_000)
  expect(tickets.verify({ ticket, id: 7, now: expiresAt - 1 })).toBe(true)
  expect(tickets.verify({ ticket, id: 7, now: expiresAt })).toBe(false)
})
it('rejects another id, a tampered payload, a tampered signature and nonsense', ...)  // id 8; payload byte changed; signature char changed; 'abc'; ''
it('rejects a ticket signed with another secret', ...)
it('is off without a secret: isOn false, issue throws, verify false', ...)
```

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/server:test -- src/media/mediaTickets.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `MediaTickets`**, comparing the signature with `sameSecret` (constant time, as the PIN is), and register it in `AppModule`'s providers after `LockService`.

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/server/src/media/mediaTickets.ts apps/raven/server/src/media/mediaTickets.test.ts apps/raven/server/src/appModule.ts
git commit -m "MAE: sign and verify raven's media tickets"
```

### Task 3: The `@MediaPlane()` mark, and the lock guard that honours a ticket

**Files:**
- Create: `apps/raven/server/src/media/mediaPlaneMark.ts`
- Modify: `apps/raven/server/src/routeMarks.ts` (`RouteMark.mediaPlane`), `apps/raven/server/src/lock/lockGuard.ts` (`lockMarkProblems`, `LockGuard`), `apps/raven/server/src/requestParts.ts` (`query`), `apps/raven/server/src/playback/playbackController.ts`, `apps/raven/server/src/media/mediaController.ts`
- Test: `apps/raven/server/src/lock/lockGuard.test.ts`

**Interfaces:**
- Produces: `MediaPlane = () => SetMetadata(MEDIA_PLANE, true)`, `isMediaPlaneRoute(targets: MarkTargets): boolean` in `mediaPlaneMark.ts`; `RouteMark` gains `mediaPlane: boolean`; `requestParts` returns `{ params, query, cookie }` with `query: Record<string, unknown>`.
- `lockMarkProblems` adds: `"<METHOD> <path> is marked MediaPlane but is not a GET"` and `"<METHOD> <path> is marked MediaPlane but is held by PrivateBy('<x>') rather than 'media'"`.
- `LockGuard` gains `@Inject(MediaTickets) tickets`; before the cookie check, when `mark === 'media'`, the route is `isMediaPlaneRoute` and `query.t` is a string that `tickets.verify({ ticket, id })`, it returns true.

- [ ] **Step 1: Write the failing tests** in `lockGuard.test.ts`: `routeMarks` reports `mediaPlane: true` for a `@MediaPlane()` route and false otherwise (extend the `ThingsController` with `@MediaPlane() @Get(':id/bytes')`); a `@MediaPlane() @Put(':id/x')` and a `@MediaPlane() @PrivateBy('item') @Get(':id/y')` each yield the problem strings above; the `CONTROLLERS` inventory lists exactly `GET /api/media/:id/stream`, `GET /api/media/:id/file` and `GET /api/media/:id/subtitles/:trackId` as media plane (Task 4 adds `GET /api/media-origins/ping` to this assertion).

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/server:test -- src/lock/lockGuard.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the mark, the inventory field, the two problems, `requestParts.query` and the guard's ticket branch.** Mark `stream`, `subtitle` and `file` with `@MediaPlane()`. Keep the guard's error paths exactly as they are for a missing or bad ticket (404 under the admin lock, 423 otherwise).

- [ ] **Step 4: Run to verify pass.** Run the file and `bunx nx run @raven/server:test` whole. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/server/src/media/mediaPlaneMark.ts apps/raven/server/src/routeMarks.ts apps/raven/server/src/lock/lockGuard.ts apps/raven/server/src/lock/lockGuard.test.ts apps/raven/server/src/requestParts.ts apps/raven/server/src/playback/playbackController.ts apps/raven/server/src/media/mediaController.ts
git commit -m "MAE: mark raven's media plane routes and open them with a ticket"
```

### Task 4: The media origins routes and the ticket route

**Files:**
- Create: `apps/raven/server/src/media/mediaOriginsController.ts`
- Modify: `apps/raven/server/src/playback/playbackController.ts` (`GET :id/ticket`), `apps/raven/server/src/appModule.ts` (`CONTROLLERS`), `libs/raven/core/src/apiClient.ts` (`getMediaOrigins`, `getMediaTicket`, `pingUrl`)
- Test: `apps/raven/server/src/appMediaPlane.test.ts` (new, the e2e file for PRs 1 and 6), `libs/raven/core/src/apiClient.test.ts`

**Interfaces:**
- `MediaOriginsController` at `api/media-origins`: `@Get()` answers `MediaOrigins` with `cache-control: no-store`, `{ origins: [] }` while `MediaTickets.isOn` is false; `@Public() @MediaPlane() @Get('ping')` streams `bytes` (Ruling 12) with `cache-control: no-store`, `content-type: application/octet-stream`, `content-length`. On construction it logs each `config.mediaPlane.problems` entry with `Logger.warn`.
- `PlaybackController.ticket`: `@Get(':id/ticket')` answers `MediaTicket` with `cache-control: no-store`; throws `ServiceUnavailableException('Set RAVEN_MEDIA_SECRET to hand out media tickets.')` when off; checks `fileOf(id)` first so an unknown id is 404.
- `ApiClient` gains `getMediaOrigins(): Promise<MediaOrigins>` (`/api/media-origins`, guard `isMediaOrigins`), `getMediaTicket(id: number): Promise<MediaTicket>` (`/api/media/${id}/ticket`, guard `isMediaTicket`), `pingUrl({ origin, bytes = MEDIA_PROBE_BYTES }: { origin: MediaOrigin; bytes?: number }): string` (`${origin.url}/api/media-origins/ping?bytes=<n>`).

- [ ] **Step 1: Write the failing e2e tests** in `appMediaPlane.test.ts`, set up as `appLock.test.ts` is (temp dirs, `testConfig`, one library with one encoded clip from `@/test/clips`, the admin cookie), but with `config.mediaPlane` set by hand to two origins, `webOrigins: ['https://raven-player.netlify.app', 'https://*--raven-player.netlify.app', 'http://localhost:5173']` and a 32-byte secret:

```ts
it('lists the media origins best first, uncached', ...)        // GET /api/media-origins -> 200, body equals the two, cache-control no-store
it('answers the ping with the bytes asked for, capped at 1 MiB, from nothing on disk', ...)  // ?bytes=1000 -> content-length 1000; ?bytes=99999999 -> 1048576; no query -> 262144; GET /api/media-origins/ping with no cookie works
it('hands out a ticket for a video the browser may see, uncached', ...)  // 200, isMediaTicket, expiresAt about now + 6 h
it('answers 404 for a ticket for a video that is not there', ...)
it('lists no origins and answers 503 for a ticket when the secret is unusable', ...)  // a second app with secret null
```

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/server:test -- src/appMediaPlane.test.ts`. Expected: FAIL, 404s.

- [ ] **Step 3: Implement the controller and the ticket route; add `MediaOriginsController` to `CONTROLLERS`; add the three client calls** with an `apiClient.test.ts` case each (URL, guard refusal on a bad body).

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run @raven/server:test -- src/appMediaPlane.test.ts src/lock/lockGuard.test.ts` and `bunx nx run @raven/core:test`. Expected: PASS, including the inventory assertion from Task 3.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/server/src/media/mediaOriginsController.ts apps/raven/server/src/playback/playbackController.ts apps/raven/server/src/appModule.ts apps/raven/server/src/appMediaPlane.test.ts libs/raven/core/src/apiClient.ts libs/raven/core/src/apiClient.test.ts
git commit -m "MAE: advertise raven's media origins and hand out tickets"
```

### Task 5: CORS and the private network preflight on the media plane

**Files:**
- Create: `apps/raven/server/src/media/mediaPlaneCors.ts`
- Test: `apps/raven/server/src/media/mediaPlaneCors.test.ts`, `apps/raven/server/src/appMediaPlane.test.ts`
- Modify: `apps/raven/server/src/app.ts`

**Interfaces:**
- Produces: `mediaPlanePaths(controllers: readonly Type[]): string[]` (the `path` of every `mediaPlane` route mark); `pathMatcher(paths: readonly string[]): (path: string) => boolean` (`:name` segments match one non-empty segment; the query string is cut before matching); `preflightHeaders({ origin, wantsPrivateNetwork }: { origin: string; wantsPrivateNetwork: boolean }): Record<string, string>`; `responseHeaders(origin: string): Record<string, string>`; `registerMediaPlaneCors({ fastify, isMediaPlanePath, isAllowedOrigin }: { fastify: FastifyInstance; isMediaPlanePath: (path: string) => boolean; isAllowedOrigin: (origin: string | undefined) => boolean }): void`.
- Headers, exactly: preflight `access-control-allow-origin: <origin>`, `vary: Origin`, `access-control-allow-methods: GET, HEAD, OPTIONS`, `access-control-allow-headers: range`, `access-control-max-age: 600`, and `access-control-allow-private-network: true` only when the request carried `access-control-request-private-network: true`; response `access-control-allow-origin`, `vary: Origin` (appended to an existing `vary`), `access-control-expose-headers: content-length, content-range, accept-ranges`. Never `access-control-allow-credentials`.
- The hook is `onRequest`: an `OPTIONS` to a media plane path from an allowed origin is answered 204 with the preflight headers there and then; a `GET` or `HEAD` to one from an allowed origin gets the response headers set on the reply (so an error reply, 423 included, carries them too); anything else passes untouched.

- [ ] **Step 1: Write the failing unit tests** in `mediaPlaneCors.test.ts`: `pathMatcher(['/api/media/:id/stream'])` matches `/api/media/12/stream?mode=remux` and not `/api/media/12/stream/x`, `/api/media//stream` or `/api/media/12/tracks`; `preflightHeaders` with and without the private network ask; `responseHeaders` carries no credentials header; `mediaPlanePaths(CONTROLLERS)` equals the four paths.

- [ ] **Step 2: Write the failing e2e tests** in `appMediaPlane.test.ts`:

```ts
it('answers the preflight for an allowed origin, with the private network allowance when asked', ...)  // OPTIONS /api/media/<id>/stream, origin netlify, access-control-request-method GET, access-control-request-private-network true -> 204 + headers
it('answers the preflight for a deploy preview and for localhost', ...)
it('gives a foreign origin no CORS headers at all, on the preflight and on the stream', ...)  // origin https://evil.example -> OPTIONS 404 (no CORS), GET stream with ticket has no access-control-allow-origin
it('plays a locked library's stream cross-origin with a ticket and no cookie, with CORS headers', ...)  // lock the library; GET /api/media/<id>/stream?mode=remux&t=<ticket> with origin netlify, no cookie -> 200, allow-origin, expose-headers; same for /file (206 with range) and /subtitles/<id>
it('refuses the stream with a ticket for another video, an expired one and a tampered one (423)', ...)  // and 404 under the admin lock
it('opens nothing else with a ticket: /api/media/:id and /api/media/:id/ticket stay 423, /api/items/:id stays 423', ...)
it('leaves a same-origin stream with the cookie as it was', ...)
```

- [ ] **Step 3: Run to verify failure.** Expected: FAIL (no headers, OPTIONS 404).

- [ ] **Step 4: Implement `mediaPlaneCors.ts` and register it in `createApp`** right after `compressResponses`: `registerMediaPlaneCors({ fastify: app.getHttpAdapter().getInstance(), isMediaPlanePath: pathMatcher(mediaPlanePaths(CONTROLLERS)), isAllowedOrigin: (origin) => isAllowedWebOrigin({ origin, allowed: config.mediaPlane.webOrigins }) })`. Update the comment in `app.ts` that says "one port and no CORS".

- [ ] **Step 5: Run to verify pass.** Run: `bunx nx run @raven/server:test`. Expected: PASS.

- [ ] **Step 6: Commit, then open PR 1**

```bash
git add apps/raven/server/src/media/mediaPlaneCors.ts apps/raven/server/src/media/mediaPlaneCors.test.ts apps/raven/server/src/appMediaPlane.test.ts apps/raven/server/src/app.ts
git commit -m "MAE: answer CORS and the private network preflight on raven's media plane"
git push -u origin direct-media-play
gh pr create --base main --title "MAE: serve raven's media plane straight from Vhagar" --body "<pr-format body>"
```

---

## PR 2: the browser's media plane

Branch: `git switch -c direct-media-client` from the tip of PR 1.

### Task 6: `pickOrigin`, `MediaAccess` and the URL builders

**Files:**
- Create: `libs/raven/core/src/mediaOrigins.ts`
- Test: `libs/raven/core/src/mediaOrigins.test.ts`, `libs/raven/core/src/apiClient.test.ts`
- Modify: `libs/raven/core/src/apiClient.ts`, `libs/raven/core/src/index.ts`, every caller of `fileUrl` and `streamUrl` (`libs/raven/ui/src/components/Player/useMediaSource.ts`, `apps/raven/web/src/pages/WatchPage/WatchPage.tsx`)

**Interfaces:**
- Produces in `mediaOrigins.ts`: `type OriginProbe = { origin: MediaOrigin; firstByteMs: number; bytesPerSecond: number }`; `ORIGIN_KIND_RANK = { lan: 0, tailnet: 1, public: 2 } as const satisfies Record<MediaOriginKind, number>`; `PREFERENCE_BAND = 0.2`; `pickOrigin(probes: readonly OriginProbe[]): MediaOrigin | null`. A probe's score is its effective throughput for the probe body, `MEDIA_PROBE_BYTES / (firstByteMs / 1000 + MEDIA_PROBE_BYTES / bytesPerSecond)` in bytes per second, so latency and bandwidth both count. The best is the highest score; among the probes whose score is at least `(1 - PREFERENCE_BAND)` of the best, the lowest `ORIGIN_KIND_RANK` wins, then the lowest `firstByteMs`. Empty input gives null.
- Produces in `apiClient.ts`: `type MediaAccess = { origin: MediaOrigin; ticket: string }`; `fileUrl({ id, access = null }: { id: number; access?: MediaAccess | null }): string`; `streamUrl({ id, mode, start, audio, access = null })`; `getSubtitles({ id, trackId, window = 0, access = null })`. With `access`, the URL is `${access.origin.url}${path}` and the query gains `t: access.ticket` (through `toQueryString`); without, exactly today's.

- [ ] **Step 1: Write the failing tests**

```ts
describe('pickOrigin', () => {
  // every probe below has firstByteMs 10 unless said, so the score is its bytesPerSecond
  it('takes the fastest when the others are more than 20% slower', ...)   // public 100e6 vs lan 70e6 -> public
  it('prefers lan over tailnet over public within the band', ...)          // lan 85e6, tailnet 100e6, public 100e6 -> lan; tailnet 85e6, public 100e6 -> tailnet
  it('counts latency: a slow first byte pulls a fast link down', ...)      // lan 100e6 at 2000 ms vs public 50e6 at 10 ms -> public (lan's score is about 128 kB/s)
  it('breaks a tie in kind by time to first byte', ...)
  it('is null with nothing answered', ...)
})
// apiClient.test.ts
it('builds media URLs on the access origin with its ticket, and relative ones without', () => {
  const access = { origin: { kind: 'lan', url: 'https://raven.home.example' }, ticket: 'abc.def' }
  expect(api.fileUrl({ id: 3, access })).toBe('https://raven.home.example/api/media/3/file?t=abc.def')
  expect(api.streamUrl({ id: 3, mode: 'remux', start: 0, audio: null, access })).toBe('https://raven.home.example/api/media/3/stream?mode=remux&start=0&t=abc.def')
  expect(api.fileUrl({ id: 3 })).toBe('/api/media/3/file')
})
it('fetches subtitles from the access origin with the ticket', ...)  // the fake fetch records the URL
```

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/core:test`. Expected: FAIL.

- [ ] **Step 3: Implement**, export `mediaOrigins` from `index.ts`, and update the two callers to the object parameter (no behaviour change yet: they pass no `access`).

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run-many -t typecheck test -p @raven/core @raven/ui @raven/web @raven/desktop`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/raven/core/src/mediaOrigins.ts libs/raven/core/src/mediaOrigins.test.ts libs/raven/core/src/apiClient.ts libs/raven/core/src/apiClient.test.ts libs/raven/core/src/index.ts libs/raven/ui/src/components/Player/useMediaSource.ts apps/raven/web/src/pages/WatchPage/WatchPage.tsx
git commit -m "MAE: pick a media origin and build media URLs with a ticket"
```

### Task 7: Probing the origins, keeping the pick, holding the ticket

**Files:**
- Create: `libs/raven/ui/src/stores/mediaOrigin.ts`, `libs/raven/ui/src/lib/probeOrigins.ts`, `libs/raven/ui/src/lib/useMediaOriginProbe.ts`, `libs/raven/ui/src/components/Player/useMediaPlane.ts`
- Test: `libs/raven/ui/src/lib/probeOrigins.test.ts`, `libs/raven/ui/src/stores/mediaOrigin.test.ts`, `libs/raven/ui/src/components/Player/useMediaPlane.test.tsx`
- Modify: `libs/raven/ui/src/lib/playerQueries.ts`, `libs/raven/ui/src/lib/playerQueryKeys.ts`, `libs/raven/ui/src/index.ts`, `libs/raven/ui/src/test-setup.ts` (reset the new store)

**Interfaces:**
- `stores/mediaOrigin.ts`: zustand `persist` to `window.sessionStorage` under `raven-media-origin`, `createJSONStorage(() => window.sessionStorage)` inside a `try` that falls back to in-memory on throw; state `{ pick: { origin: MediaOrigin; at: number } | null; isProbing: boolean; setPick: (pick) => void; clearPick: () => void; setProbing: (isProbing: boolean) => void }`; `PICK_FRESH_MS = 600_000`.
- `lib/probeOrigins.ts`: `type ProbeFetch = (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>`; `probeOrigin({ origin, api, fetch, now, timeoutMs = 2000 }): Promise<OriginProbe | null>` (null on timeout, a non-ok answer, a thrown fetch or a short body); `probeOrigins({ origins, api, fetch, now, timeoutMs }): Promise<OriginProbe[]>` runs them in parallel with `Promise.all`. `firstByteMs` is `now()` at the first `reader.read()` resolving minus `now()` before `fetch`; `bytesPerSecond` is the body's bytes over the time from first byte to `done`.
- `lib/useMediaOriginProbe.ts`: `useMediaOriginProbe({ api, fetch = window.fetch, now = performance.now }): { reprobe: () => void }`; on mount, calls `api.getMediaOrigins()`; with none, `clearPick` and done; with some, probes unless the stored pick is younger than `PICK_FRESH_MS`; sets `pick` to `pickOrigin(probes)` with `at: Date.now()` (or clears it when `pickOrigin` gives null); re-probes on `window` `online`, on `document` `visibilitychange` to visible when hidden for at least 10 minutes, and when `reprobe()` is called. A probe already running is not started twice. The hook is the web host's; the store is read by `useMediaPlane`.
- `playerQueries.ts`: `mediaTicket: (id: number) => queryOptions({ queryKey: queryKeys.mediaTicket(id), queryFn: () => api.getMediaTicket(id), staleTime: Infinity, retry: false, refetchInterval: (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000 })`.
- `components/Player/useMediaPlane.ts`: `type MediaPlane = { access: MediaAccess | null; refreshTicket: () => Promise<boolean>; reportUnreachable: () => void }`; `useMediaPlane({ api, mediaId, reprobe }: { api: ApiClient; mediaId: number; reprobe: () => void }): MediaPlane`. `access` is non-null only when the store has a pick and the ticket query has data; `refreshTicket` refetches the query and answers whether it succeeded; `reportUnreachable` calls `reprobe`. The ticket query is `enabled` only with a pick.
- Exports from `index.ts`: `useMediaOriginProbe`, `useMediaPlane`, `useMediaOrigin` (the store), type `MediaPlane`.

- [ ] **Step 1: Write the failing tests**

```ts
// probeOrigins.test.ts
it('measures time to first byte and throughput of the body', ...)   // a fake fetch with a clock the test advances: first read at +50 ms, done at +250 ms with 262144 bytes -> firstByteMs 50, bytesPerSecond 1_310_720
it('gives null on timeout, a non-ok answer, a thrown fetch and a short body', ...)
it('probes every origin in parallel', ...)   // two origins, both fetches started before either resolves
// mediaOrigin.test.ts
it('keeps the pick in sessionStorage', ...)
it('still works when sessionStorage throws', ...)   // Object.defineProperty(window, 'sessionStorage', { get: () => { throw ... } }); setPick then read back from the store
// useMediaPlane.test.tsx (renderHook inside a QueryClientProvider, the api faked)
it('has no access without a pick and never asks for a ticket', ...)
it('has access once the pick and the ticket are in, and refreshes the ticket from receipt', ...)   // fake timers: the second getMediaTicket call comes at 5 h 50 min after the first, whatever expiresAt says
it('refreshTicket answers false when the server refuses', ...)
it('reportUnreachable asks for a new probe', ...)
```

Also `useMediaOriginProbe` cases in `useMediaPlane.test.tsx` (or its own file): no origins clears the pick and probes nothing; a fresh stored pick is kept without probing; a stale one is probed; `online` re-probes; `visibilitychange` re-probes only after 10 minutes hidden.

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/ui:test`. Expected: FAIL.

- [ ] **Step 3: Implement** the store, the probe, the hook, the query and `useMediaPlane`; reset the store in `test-setup.ts` as `usePlayerPrefs` is.

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run @raven/ui:test`. Expected: PASS, coverage floors kept.

- [ ] **Step 5: Commit**

```bash
git add libs/raven/ui/src/stores/mediaOrigin.ts libs/raven/ui/src/stores/mediaOrigin.test.ts libs/raven/ui/src/lib/probeOrigins.ts libs/raven/ui/src/lib/probeOrigins.test.ts libs/raven/ui/src/lib/useMediaOriginProbe.ts libs/raven/ui/src/components/Player/useMediaPlane.ts libs/raven/ui/src/components/Player/useMediaPlane.test.tsx libs/raven/ui/src/lib/playerQueries.ts libs/raven/ui/src/lib/playerQueryKeys.ts libs/raven/ui/src/index.ts libs/raven/ui/src/test-setup.ts
git commit -m "MAE: probe raven's media origins and hold a ticket for the player"
```

### Task 8: The player streams from the media plane

**Files:**
- Modify: `libs/raven/ui/src/components/Player/engine.ts` (`HtmlSource`), `libs/raven/ui/src/components/Player/useMediaSource.ts`, `libs/raven/ui/src/lib/streamSource.ts`
- Test: `libs/raven/ui/src/lib/streamSource.test.ts`, `libs/raven/ui/src/components/Player/useMediaSource.test.tsx` (new)

**Interfaces:**
- `HtmlSource`'s server variant gains `mediaPlane?: MediaPlane`.
- `sourceFor({ api, id, mode, audio, mime, access }: { ...; access: () => MediaAccess | null }): VideoSource` reads `access()` each time a stream URL is built, and once for the file URL. `useMediaSource` keeps `source.mediaPlane?.access` in a ref it updates in an effect and builds the source with `access: () => ref.current`. The attach effect depends on `access?.origin.url`, and on `access?.ticket` only for direct play: a stream reads the new ticket from the ref on its next request, while a `<video src>` holds its URL and would keep asking with the old ticket until it died, so the file is re-attached at the position it was at, once per refresh.
- `createStreamSession` gains `onUnreachable?: () => void`, called once when the first `fetch` of a load rejects (a `TypeError`, not an abort) before any fragment arrived; the session still fails as today after it. `useMediaSource` passes `source.mediaPlane?.reportUnreachable` only when `access` is non-null (a same-origin failure is not a bad pick).

- [ ] **Step 1: Write the failing tests.** `streamSource.test.ts`: a fetch that throws `TypeError` calls `onUnreachable` once and then `onError`; a fetch that answers 500 does not call it. `useMediaSource.test.tsx`, with the `Harness` from `playerHooks.test.tsx`'s `useMediaSource` case (happy-dom has no `MediaSource`, so streams are checked through `sourceFor` and files through the element): `sourceFor` with an `access` that answers a new ticket on the second call gives a stream `url(0)` carrying the new one; in `direct` mode with `mediaPlane.access` set, `video.getAttribute('src')` is `https://raven.home.example/api/media/<id>/file?t=<ticket>`, a ticket change re-sets it, and with `access` null it is `/api/media/<id>/file`.

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run @raven/ui:test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/raven/ui/src/components/Player/engine.ts libs/raven/ui/src/components/Player/useMediaSource.ts libs/raven/ui/src/components/Player/useMediaSource.test.tsx libs/raven/ui/src/lib/streamSource.ts libs/raven/ui/src/lib/streamSource.test.ts
git commit -m "MAE: stream raven's video from the picked media origin"
```

### Task 9: The web host wires it, and the docs say so

**Files:**
- Create: `apps/raven/web/src/components/MediaOriginProbe/MediaOriginProbe.tsx`
- Modify: `apps/raven/web/src/main.tsx`, `apps/raven/web/src/pages/WatchPage/WatchPage.tsx`, `apps/raven/README.md` ("On Netlify"), `apps/raven/CLAUDE.md` (one line under Conventions on the media plane and `@MediaPlane()`)
- Test: `apps/raven/web/src/pages/WatchPage/WatchPage.test.tsx` (extend the existing file if there is one, else create)

**Interfaces:**
- `MediaOriginProbe` renders nothing and calls `useMediaOriginProbe({ api })`; it sits inside `SharedPlaybackPolicy` in `main.tsx`, and exposes `reprobe` through a tiny context `MediaOriginProbeContext` (`useReprobe(): () => void`) that `WatchPlayer` reads.
- `WatchPlayer`: `const mediaPlane = useMediaPlane({ api, mediaId: media.id, reprobe: useReprobe() })`; the source becomes `{ kind: 'server', media, api, mediaPlane }`; `copyLink` uses `api.fileUrl({ id: media.id, access: mediaPlane.access })`, absolute through `new URL(..., window.location.origin)` only when relative, and the copied message becomes `Link copied. Paste it into VLC or IINA to play it there; it works for 6 hours.` when `access` is set, today's sentence otherwise.

- [ ] **Step 1: Write the failing tests.** `WatchPage.test.tsx`: with a stubbed `useMediaOrigin` pick and a stubbed ticket query, the copied link is `https://raven.home.example/api/media/<id>/file?t=<ticket>` and the message names the 6 hours; without a pick, the link is on `window.location.origin` and the message is today's.

- [ ] **Step 2: Run to verify failure.** Run: `bunx nx run @raven/web:test`. Expected: FAIL.

- [ ] **Step 3: Implement**, then update the README's "On Netlify" paragraph that begins "Every `/api` request goes through Netlify, video included" to describe the control plane and the media plane: the three env vars, the probe, the ticket, that thumbnails and JSON still go through Netlify, and the Vhagar setup list from the spec (lan: a DSM reverse proxy rule or Caddy, a DNS-challenge certificate and a local DNS record; tailnet: Tailscale Serve; public: unchanged Funnel). Add the `localhost` dev recipe: `RAVEN_MEDIA_ORIGINS=lan:http://localhost:8484 RAVEN_WEB_ORIGINS=http://localhost:5173 RAVEN_MEDIA_SECRET=$(openssl rand -base64 32)`.

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run-many -t typecheck lint:ts format:check test -p @raven/web @raven/ui`. Expected: PASS.

- [ ] **Step 5: Manual check (Ruling 11).** Start the server with the dev recipe above and `nx run @raven/web:dev`; open `http://localhost:5173`, play a clip; in the Network tab the stream request goes to `http://localhost:8484/api/media/<id>/stream?...&t=...` with `access-control-allow-origin: http://localhost:5173`, and `/api/media/<id>/tracks` still goes to `:5173`. Stop the server, reload: the page falls back to the relative URL. Note the result in the PR body's Testing section.

- [ ] **Step 6: Commit, then open PR 2**

```bash
git add apps/raven/web/src/components/MediaOriginProbe/MediaOriginProbe.tsx apps/raven/web/src/main.tsx apps/raven/web/src/pages/WatchPage/WatchPage.tsx apps/raven/web/src/pages/WatchPage/WatchPage.test.tsx apps/raven/README.md apps/raven/CLAUDE.md
git commit -m "MAE: play raven on Netlify through the media plane"
git push -u origin direct-media-client
gh pr create --base direct-media-play --title "MAE: fetch raven's video straight from Vhagar in the browser" --body "<pr-format body>"
```

---

## PR 3: Stats for nerds

Branch: `git switch -c direct-media-stats` from PR 2's tip.

### Task 10: The delivery meter and the overlay

**Files:**
- Create: `libs/raven/ui/src/lib/deliveryMeter.ts`, `libs/raven/ui/src/components/Player/StatsOverlay.tsx`, `libs/raven/ui/src/components/Player/StatsOverlay.module.scss`, `libs/raven/ui/src/components/Player/useLiveStats.ts` (moved out of `PlaybackInfo.tsx`)
- Test: `libs/raven/ui/src/lib/deliveryMeter.test.ts`, `libs/raven/ui/src/components/Player/StatsOverlay.test.tsx`
- Modify: `libs/raven/ui/src/lib/streamSource.ts`, `libs/raven/ui/src/components/Player/engine.ts` (`EngineStats`), `useMediaSource.ts`, `useHtmlEngine.tsx`, `useNativeEngine.tsx`, `Stage.tsx` (`PlayerChrome`), `PlaybackInfo.tsx`, `lib/shortcuts.ts` (the `i` row's `isStats` note), `ShortcutsDialog.tsx` if it reads it

**Interfaces:**
- `deliveryMeter.ts`: `createDeliveryMeter({ windowMs = 10_000 }): { record: ({ bytes, at }: { bytes: number; at: number }) => void; bitsPerSecond: (at: number) => number }` over a sliding window; bits in the window over `min(windowMs, at - firstRecordAt)` seconds, 0 before the first record.
- `streamSource.ts`: `type Delivery = { bitsPerSecond: number; aheadSeconds: number; restarts: number }`; `StreamSession` gains `readDelivery: () => Delivery`; `createStreamSession` takes `now?: () => number` in `environment` (default `Date.now`), records every chunk's length, and counts `restarts` (0 until PR 4 adds resumes; a seek that starts a new stream is not a restart).
- `EngineStats` gains `origin: MediaOrigin | null` and `delivery: { bitsPerSecond: number | null; aheadSeconds: number; restarts: number } | null`; the html engine fills `origin` from `source.mediaPlane?.access?.origin`, `delivery` from the session for a stream and `{ bitsPerSecond: null, aheadSeconds: <from the element's buffered at currentTime>, restarts: 0 }` for direct play; the native engine fills both null.
- `useMediaSource` returns `{ readDelivery: () => Delivery | null }`.
- `EngineActions.toggleStats` is now set by the html engine; `useHtmlEngine` returns `renderStats: () => ReactNode` and `PlayerChrome` takes `renderStats?: () => ReactNode` and renders it over the picture, under the header.
- `StatsOverlay({ readStats, mode, media }: { readStats: () => EngineStats; mode: PlaybackMode; media: MediaItem | null })`: a `<section aria-label="Playback stats">` holding a `<dl>` in the top right with Origin (`lan https://raven.home.example` or `same as the page`), Mode (`Direct play` / `Remux` / `Transcode`), Source bitrate (`formatBitrate(media.bitrate)`), Delivered (`formatBitrate(bitsPerSecond)` or `n/a`), Buffer ahead (`12.3 s`), Dropped frames (`n of m`), Restarts; refreshed by `useLiveStats` once a second. No live region: a screen reader would otherwise hear it every second.

- [ ] **Step 1: Write the failing tests.** `deliveryMeter.test.ts`: 1,048,576 bytes recorded over 10 s reads 838,860.8 bits per second; a record older than the window drops out; 0 before any record. `StatsOverlay.test.tsx`: renders every row from a fake `readStats`; `n/a` for direct play's delivered; `same as the page` without an origin. `streamSource.test.ts`: `readDelivery().aheadSeconds` follows the buffered range and `bitsPerSecond` follows the chunks. A `PlayerChrome` test that `i` toggles the overlay for the html engine (extend `playerEngine.test.tsx`'s shortcut case).

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement.** Move `useLiveStats` to its own file and import it in both panels.

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run-many -t typecheck lint:ts lint:css format:check test -p @raven/ui @raven/web @raven/desktop`. Expected: PASS.

- [ ] **Step 5: Commit, then open PR 3**

```bash
git add libs/raven/ui/src/lib/deliveryMeter.ts libs/raven/ui/src/lib/deliveryMeter.test.ts libs/raven/ui/src/lib/streamSource.ts libs/raven/ui/src/lib/streamSource.test.ts libs/raven/ui/src/components/Player/StatsOverlay.tsx libs/raven/ui/src/components/Player/StatsOverlay.module.scss libs/raven/ui/src/components/Player/StatsOverlay.test.tsx libs/raven/ui/src/components/Player/useLiveStats.ts libs/raven/ui/src/components/Player/engine.ts libs/raven/ui/src/components/Player/useMediaSource.ts libs/raven/ui/src/components/Player/useHtmlEngine.tsx libs/raven/ui/src/components/Player/useNativeEngine.tsx libs/raven/ui/src/components/Player/Stage.tsx libs/raven/ui/src/components/Player/PlaybackInfo.tsx libs/raven/ui/src/components/Player/playerEngine.test.tsx libs/raven/ui/src/lib/shortcuts.ts
git commit -m "MAE: show stats for nerds in raven's browser player"
git push -u origin direct-media-stats
gh pr create --base direct-media-client --title "MAE: add a stats overlay to raven's browser player" --body "<pr-format body>"
```

---

## PR 4: resume instead of fail

Branch: `git switch -c direct-media-resume` from PR 3's tip.

### Task 11: Resume from the buffered end, and refresh an expired ticket

**Files:**
- Modify: `libs/raven/ui/src/lib/streamSource.ts`, `libs/raven/ui/src/components/Player/useMediaSource.ts`
- Test: `libs/raven/ui/src/lib/streamSource.test.ts`, `libs/raven/ui/src/components/Player/useMediaSource.test.tsx`

**Interfaces:**
- Constants in `streamSource.ts`: `RESUME_ATTEMPTS = 3`, `RESUME_BACKOFF_MS = [1000, 2000, 4000] as const`, `CLEAN_READ_MS = 30_000`.
- `StreamEnvironment` gains `delay?: (ms: number) => Promise<void>` (default `setTimeout`).
- `createStreamSession` gains `onLocked?: () => Promise<boolean>` (Ruling 13).
- `load(from, { keep })`: `keep: true` skips `buffer.remove(0, Infinity)` and only aborts the cut-off fragment, so what is buffered stays. A resume is `load(bufferedEnd - STREAM_TIME_SHIFT, { keep: true })` where `bufferedEnd` is the end of the buffered range containing the playhead, or the last range's end.
- The error path in `load`: a rejection that is not an abort, while the generation is current, after at least one chunk was appended in this stream, and with `attempts < RESUME_ATTEMPTS` (attempts reset to 0 when `now - lastFailureAt > CLEAN_READ_MS`): `restarts += 1`, `await delay(RESUME_BACKOFF_MS[attempts])`, resume. Otherwise `fail` as today. A non-ok response with status 401 or 423 and `onLocked`: `if (await onLocked()) load(from, { keep: true })` once per load, else `fail` with today's message.
- `useMediaSource` passes `onLocked: source.mediaPlane?.refreshTicket` only when `access` is non-null.

- [ ] **Step 1: Write the failing tests** in `streamSource.test.ts` with an instant `delay` that records the waits and a `now` the test advances:

```ts
it('resumes from the buffered end after a dropped connection, keeping what is buffered', ...)  // stream 'from-0' delivers [1,3],[3,5] then the reader rejects; fetched[1] is 'from-4' (5 - shift); bufferState.ranges still holds [1,5]; readDelivery().restarts is 1
it('backs off 1, 2 then 4 seconds and gives up on the fourth drop', ...)   // delays [1000, 2000, 4000]; onError called once after the fourth
it('counts again after 30 seconds of clean reading', ...)
it('fails at once when nothing arrived before the drop', ...)   // no chunk appended -> onError, no resume
it('refreshes the ticket once on 423 and reloads at the same spot', ...)  // onLocked resolves true -> second fetch; a second 423 -> onError
it('fails on 423 when the ticket cannot be refreshed', ...)
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement.** Keep the fake buffer's cut-off fragment rule in mind: a resume must `buffer.abort()` before appending (as `load` already does) and must not remove ranges.

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run @raven/ui:test`. Expected: PASS.

- [ ] **Step 5: Commit, then open PR 4**

```bash
git add libs/raven/ui/src/lib/streamSource.ts libs/raven/ui/src/lib/streamSource.test.ts libs/raven/ui/src/components/Player/useMediaSource.ts libs/raven/ui/src/components/Player/useMediaSource.test.tsx
git commit -m "MAE: resume raven's stream after a dropped connection"
git push -u origin direct-media-resume
gh pr create --base direct-media-stats --title "MAE: resume raven's converted stream instead of failing" --body "<pr-format body>"
```

---

## PR 5: step down on bandwidth

Branch: `git switch -c direct-media-stepdown` from PR 4's tip.

### Task 12: The starvation rule, the ladder's step and the notice

**Files:**
- Create: `libs/raven/ui/src/lib/starvation.ts`, `libs/raven/ui/src/components/Player/useStarvationWatch.ts`
- Test: `libs/raven/ui/src/lib/starvation.test.ts`, `libs/raven/ui/src/components/Player/useStarvationWatch.test.tsx`, `libs/raven/ui/src/components/Player/playerHooks.test.tsx` (the ladder), `libs/raven/ui/src/components/Player/playerEngine.test.tsx` (the notice)
- Modify: `libs/raven/ui/src/components/Player/usePlaybackLadder.ts`, `Player.tsx`, `Stage.tsx`, `Player.module.scss` if the notice needs a class

**Interfaces:**
- `starvation.ts`: `type StarvationSample = { aheadSeconds: number; deliveredRatio: number | null }`; `STARVED_AHEAD_SECONDS = 5`, `STARVED_RATIO = 1.2`, `STARVED_SAMPLES = 10`; `createStarvationWatch(): { sample: (s: StarvationSample) => boolean; reset: () => void }` answering true on the tenth consecutive starved sample and then never again (one step per play).
- `useStarvationWatch({ readStats, state, mode, bitrate, onStarved }: { readStats: () => EngineStats; state: VideoState; mode: PlaybackMode; bitrate: number | null; onStarved: (() => void) | null })`: a 1 s interval while `onStarved` is non-null and playback is not paused; the ratio is `delivery.bitsPerSecond / bitrate` for a stream and, for direct play, the growth of the buffered end around `state.time` since the last sample in seconds per second; `reset()` whenever `state.time` jumps by more than 2 s between samples (a seek).
- `usePlaybackLadder`'s `playing` case becomes `{ status: 'playing'; mode; fail; stepDown: (() => void) | null; notice: string | null }`. `stepDown` is non-null when the ladder holds `'transcode'` after the current step and no step down has happened in this play; calling it moves to `transcode` and sets `notice` to `Switched to ${label}: the connection is slower than this file.` for 6 s, where `label` is `4K` when the server's `maxHeight` is 2160 and `${maxHeight}p` otherwise.
- `Stage` takes `onStarved?: (() => void) | null` and `notice?: string | null`; `PlayerChrome` renders `notice` in the resume slot when `resumedAt` is null.

- [ ] **Step 1: Write the failing tests.** `starvation.test.ts`: 10 starved samples fire once, a healthy sample in between restarts the count, `reset` restarts it, a null ratio never fires, 9 samples do not. `useStarvationWatch.test.tsx` (fake timers): a stream at 0.8× with 2 s ahead for 10 s calls `onStarved`; a seek at second 6 postpones it to second 16; direct play with a buffered end growing 0.5 s per second and 2 s ahead fires; paused does not sample. Ladder test: `stepDown` moves remux to transcode once, is null afterwards, and the notice reads `Switched to 1080p: the connection is slower than this file.` with the default settings; with `maxHeight: 2160` it says `4K`. Chrome test: the notice renders and the resume notice wins while it is shown.

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement.** The 6 s clearing lives in `usePlaybackLadder` (a timer set when the step happens).

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run-many -t typecheck lint:ts lint:css format:check test -p @raven/ui @raven/web @raven/desktop`. Expected: PASS.

- [ ] **Step 5: Commit, then open PR 5**

```bash
git add libs/raven/ui/src/lib/starvation.ts libs/raven/ui/src/lib/starvation.test.ts libs/raven/ui/src/components/Player/useStarvationWatch.ts libs/raven/ui/src/components/Player/useStarvationWatch.test.tsx libs/raven/ui/src/components/Player/usePlaybackLadder.ts libs/raven/ui/src/components/Player/Player.tsx libs/raven/ui/src/components/Player/Stage.tsx libs/raven/ui/src/components/Player/playerHooks.test.tsx libs/raven/ui/src/components/Player/playerEngine.test.tsx
git commit -m "MAE: step raven's player down to a transcode when the connection starves"
git push -u origin direct-media-stepdown
gh pr create --base direct-media-resume --title "MAE: step down to a transcode when the route cannot carry the file" --body "<pr-format body>"
```

---

## PR 6: the quality picker

Branch: `git switch -c direct-media-quality` from PR 5's tip.

### Task 13: A forced height, end to end

**Files:**
- Modify: `apps/raven/server/src/playback/playbackController.ts` (`height`), `apps/raven/server/src/playback/playback.test.ts`, `libs/raven/core/src/apiClient.ts` (`streamUrl.height`), `libs/raven/core/src/apiClient.test.ts`, `libs/raven/core/src/contract.ts` (`QUALITY_PICKS`, `isQualityPick`), `libs/raven/ui/src/stores/playerPrefs.ts`, `libs/raven/ui/src/components/Player/usePlaybackLadder.ts`, `Player.tsx`, `Stage.tsx`, `useHtmlEngine.tsx`, `useMediaSource.ts`, `SettingsMenu.tsx`, `PlaybackInfo.tsx`
- Test: `libs/raven/ui/src/components/Player/playerHooks.test.tsx`, `libs/raven/ui/src/components/Player/Player.test.tsx` (the menu)

**Interfaces:**
- Server: `stream` reads `@Query('height') height: string | undefined`; `wholeNumber(height)` must be one of `PLAYBACK_CHOICES.maxHeight` else `BadRequestException('height must be 2160, 1080 or 720')`; passed to `streamArgs` as `maxHeight: forced ?? playback.maxHeight`, and ignored (not an error) for `mode=remux`.
- Core: `QUALITY_PICKS = ['original', 2160, 1080, 720] as const`, `isQualityPick = oneOf(QUALITY_PICKS)`, `type QualityPick`; `streamUrl` gains `height?: number | null` which becomes `height=<n>` when non-null.
- `usePlayerPrefs` gains `quality: QualityPick` (default `'original'`) and `setQuality`, persisted.
- `usePlaybackLadder` takes `quality: QualityPick`; with a number and `policy.transcoding === 'on'`, the ladder is `{ modes: ['transcode'], audio, height: quality }`; `playing` gains `height: number | null` (the forced height, else null), threaded `Stage` → `useHtmlEngine` → `useMediaSource` → `streamUrl`.
- `SettingsMenu`'s `playback` section gets a `QualityGroup` (a `fieldset` with legend `Quality`, options `Original`, `4K`, `1080p`, `720p`) above Speed, shown only when `canPickQuality` (the policy's `transcoding === 'on'`), with `quality` and `onPickQuality` props; `PlaybackInfo`'s Conversion line uses the forced height when given.

- [ ] **Step 1: Write the failing tests.** `playback.test.ts`: `?mode=transcode&height=720` scales to 720 (assert on the ffmpeg args the test harness already inspects, or on the probed output height if it runs ffmpeg), `height=999` is 400, `mode=remux&height=720` is 200. `apiClient.test.ts`: `height` in the URL. Ladder: `quality: 720` gives `['transcode']` with `height: 720`; `quality: 720` with `transcoding: 'remuxOnly'` gives today's ladder and `height: null`. Menu: the group shows the four options with the stored one checked, picking one calls `setQuality`, and it is absent when transcoding is `remuxOnly`.

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify pass.** Run: `bunx nx run-many -t typecheck lint:ts lint:css format:check test -p @raven/server @raven/core @raven/ui @raven/web @raven/desktop`. Expected: PASS.

- [ ] **Step 5: Commit, then open PR 6**

```bash
git add apps/raven/server/src/playback/playbackController.ts apps/raven/server/src/playback/playback.test.ts libs/raven/core/src/apiClient.ts libs/raven/core/src/apiClient.test.ts libs/raven/core/src/contract.ts libs/raven/ui/src/stores/playerPrefs.ts libs/raven/ui/src/components/Player/usePlaybackLadder.ts libs/raven/ui/src/components/Player/Player.tsx libs/raven/ui/src/components/Player/Stage.tsx libs/raven/ui/src/components/Player/useHtmlEngine.tsx libs/raven/ui/src/components/Player/useMediaSource.ts libs/raven/ui/src/components/Player/SettingsMenu.tsx libs/raven/ui/src/components/Player/PlaybackInfo.tsx libs/raven/ui/src/components/Player/playerHooks.test.tsx libs/raven/ui/src/components/Player/Player.test.tsx
git commit -m "MAE: let a viewer pick the quality in raven's player"
git push -u origin direct-media-quality
gh pr create --base direct-media-stepdown --title "MAE: add a quality picker to raven's player" --body "<pr-format body>"
```

---

## After the stack

- Rebase `redesign` onto `direct-media-quality`'s tip (`git rebase direct-media-quality` on `redesign`), resolve every conflict keeping both the redesign's chrome and the stack's behaviour, run `bunx nx run-many -t typecheck lint:ts lint:css format:check test -p @raven/ui @raven/web @raven/desktop`, and `git push --force-with-lease origin redesign`. PR 197 (`redesign` into `main`) then shows only the redesign over the stack.
- Run the `reviews-cover-whole-branch` rule on each PR before asking for review: `origin/<base>...HEAD`, every commit.
- README's rollout list for Vhagar (spec "Rollout"): ship with the env vars unset, then `tailnet` only, then `lan`; measure with the overlay at home and away; decide on Phase 3 and the public route. The spec's open questions 1 to 4 and 8 are answered then.
