# raven desktop downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let raven player keep a raven server's titles on the Mac it runs on (a movie, a saga, a show, a season or one episode, original bytes plus sidecar subtitles), play them with no server at all, send where you stopped and that you watched them back to the server when it is next reachable, show the disk's free space and each download's size, and delete a download ten minutes after it was watched when the viewer asked for that.

**Architecture:** Everything lives in the desktop's main process under `src/main/downloads/`, beside the servers: a `raven://download` link from raven web is read by `LinkOpener`, trusted like a play link, expanded into files through five new allowlisted reads, shown to the viewer as an ask, and only then queued. The queue fetches each file with HTTP ranges from the server's best media origin with a media ticket (the direct media spec's plane), or from the stored origin with the session's cookie when the server advertises no origin, and writes `userData/downloads/<serverId>/<mediaId>/video.<container>`. `downloads.json` holds the state through the same `JsonStore` as `player-state.json`. A download plays as a local file through `grant`, with its sidecars carried on the file `LoadTarget`; `sync.ts` sends pending plays and positions through `recordPlay` and `saveProgress`; `autoDelete.ts` keeps one timer per watched entry. The renderer holds opaque ids and views only: a Downloads page, a dialog in the Shell, a Settings section and a Home button.

**Tech Stack:** Electron 44 (`session.fetch`, `net.fetch`, `shell.showItemInFolder`), Node `fs/promises` (`statfs`, `mkdir`, `rm`, `rename`, `open`), `@raven/core` guards and `toQueryString`, React 19 with TanStack Query 5 and react-router in the renderer, bun test for main and renderer, Playwright for e2e against `fixtureServer`, Nx 23 over Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-10-17-raven-desktop-downloads-design.md` (all sections). It builds on `2026-10-12-raven-desktop-design.md` (P6, server titles) and `2026-10-16-raven-direct-media-design.md` (Phase 1: media origins and tickets).

## Global Constraints

- Everything in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`: no `any`, no casts, no `interface`, no enums, no loops, one object parameter, guards at every boundary, `@/` imports with no extension, no em or en dashes anywhere, comments only for a non-obvious why, SCSS modules laid out with grid and `gap`, tokens from `libs/raven/ui/src/styles/globals.scss`, a visible `:focus-visible` with `--focus-ring`, motion only under `prefers-reduced-motion: no-preference`, every page usable at 320px.
- `libs/raven/core` stays platform-agnostic: no DOM, no Node, no `URLSearchParams` (`toQueryString`).
- Main-process modules take Electron, the file system, the network and timers as parameters and import `electron` with `import type` only; `main.ts` alone wires them. A new log line goes through the app's log; it names a download by its title through `loggable`, never by a path, a file name, a cookie or a ticket.
- The renderer never holds a path, an origin, a cookie or a ticket: a download is a `downloadId`, a file a `fileId`, a server a `serverId`, all `isOpaqueId`.
- Constants, verbatim from the spec: `DOWNLOAD_MAX_FILES = 500`, `SPACE_RESERVE_BYTES = 2 * 1024 ** 3`, `PROGRESS_STEP_BYTES = 8 * 1024 ** 2`, `DOWNLOAD_STALL_MS = 30_000`, `DOWNLOAD_CONCURRENCY = 2`, `SYNC_DEBOUNCE_MS = 2000`, `SYNC_RETRY_MS = 300_000`, `AUTO_DELETE_DELAY_MS = 600_000`, `ASK_TTL_MS = 600_000`, `PROBE_TIMEOUT_MS = 2000`, `MEDIA_PROBE_BYTES` and `MEDIA_TICKET_REFRESH_SECONDS` from `@raven/core`, `LOCKED_STATUS` (423) from `@raven/core`, the downloads events at most four a second (`DOWNLOADS_EVENT_MS = 250`).
- Link forms: `raven://download?server=<origin>&media=<id>`, `...&item=<id>`, `...&saga=<libraryId>:<tmdbId>`; exactly one of the three; read with `readPlayLink`'s strictness (bare http or https origin, no unknown or repeated keys, no hash, 4096 characters at most).
- Disk layout: `userData/downloads/<serverId>/<mediaId>/video.<container>` (`.part` while downloading), `subtitles/<trackId>.vtt`; `userData/downloads.json`, version 1. `<container>` is `MediaItem.container` and must match `/^[a-z0-9]{1,8}$/u`; a sidecar's `<trackId>` must match `/^external-\d+$/u`.
- Copy fixed by the spec: Downloads page empty state "Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player."; the delete question "Delete <title>? <size> will be freed."; the notices "Downloaded <title>", "Deleted <title> after watching", "Could not download <title>: <why>", "Downloading <n> <kind> from <server>"; the refusals "That is more than raven player downloads at once.", "Not enough space", "The file changed on the server", "<server> locked this library again"; the recents' and the player's "Downloaded from <server>"; the web button "Download to raven player"; the Settings line "Downloads are kept in raven player's data folder".
- Commits follow the `commit-format` skill (`MAE:` subject, short bullets, no attribution). PRs follow `pr-format`. Each PR targets the branch before it; the first targets `main`.
- Before each commit: `bunx nx affected -t typecheck lint:ts lint:css format:check test` passes for the projects touched (lefthook runs lint-staged on commit and `verify` on push; never skip them, never `--no-verify`).

## Rulings (where the spec is silent or the repo's shape says otherwise)

1. **The stack is built on `main` as it stands, before the direct media client stack lands.** The spec waits for `direct-media-client` so that core's `pickOrigin` and `MediaAccess` exist; the user then asked for the stack now. The server side of the media plane and the contract (`isMediaOrigins`, `isMediaTicket`, `MEDIA_PROBE_BYTES`, `MEDIA_TICKET_REFRESH_SECONDS`, `getMediaOrigins`, `getMediaTicket`) are on `main`; `pickOrigin` is not. `mediaAccess.ts` therefore picks with its own rule (Ruling 6) and builds its own URLs; Task 19 notes in the spec's outcomes that the pick is swapped for core's `pickOrigin` once that lands, a one-function follow-up.
2. **The ask rides as a reply and as an event, like `playServer`.** `LinkOpener.open` answers `{ type: 'downloadAsk', ask }`; `eventForOpen` turns that reply into the `downloadAsk` event for a link that came through `open-url`, and `applyReply` shows the dialog for one that came through File > Open Link. The Shell holds the open ask in state and renders `DownloadDialog`.
3. **A locked or hidden library is asked about inside the download dialog.** `DownloadAsk.status` is one of `ready`, `locked` and `hidden`: `locked` when any expansion read answered `LOCKED_STATUS`, `hidden` when one answered 404 while `getAdminLock` says the lock is on and available. The dialog shows the shared `UnlockDialog` (`secret: 'pin'` or `'adminPassword'`, unlocking through `serverApiFor({ client, serverId })` as `ServerPage` does), then sends `{ type: 'retryDownloadAsk', askId }`, and main expands again under the same `askId` and answers a fresh `downloadAsk`. The ask carries `serverId` for this; it is an opaque id the page already holds for server titles.
4. **An ask lives ten minutes in main.** `ASK_TTL_MS = 600_000`; `confirmDownload` or `retryDownloadAsk` on an ask past that, or unknown, is refused with `DOWNLOAD_MESSAGES.askGone`.
5. **The five new allowlisted calls are `getItem`, `getLibrary`, `getSagas`, `getMediaOrigins` and `getMediaTicket`.** `allowlist.ts`'s `Route` kind `media` becomes `numbered` with `read: ({ id, body })`, so an item id and a library id are captured by the same digits-only pattern as a media id; the `AllowedCall` variants are `{ name: 'getItem'; itemId: number }`, `{ name: 'getLibrary'; libraryId: number }`, `{ name: 'getSagas'; libraryId: number }`, `{ name: 'getMediaOrigins' }`, `{ name: 'getMediaTicket'; mediaId: number }`. All five are reads (`isWrite` false) and `GET`.
6. **The desktop's origin pick.** Every origin `getMediaOrigins` lists is probed at once with `GET {origin.url}/api/media-origins/ping?bytes=<MEDIA_PROBE_BYTES>` through a `ProbeFetch` main builds from `net.fetch` with `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'` and `AbortSignal.timeout(PROBE_TIMEOUT_MS)`. Among the origins that answered 200 within the timeout, the pick is the first by kind rank (`lan` 0, `tailnet` 1, `public` 2) and then by time to first byte. None answering, or no origin listed, picks `null`: the cookie path. The pick is held in memory per server until `forget(serverId)` (a fetch that failed to connect, the server's removal) and never persisted.
7. **A ticket is read per file, held in memory, and renewed by aborting the fetch.** `fetchToFile` takes an `AbortSignal`; the queue aborts a running fetch `MEDIA_TICKET_REFRESH_SECONDS` before the ticket's `expiresAt` (reason `refresh`), reads a new ticket and fetches again from the bytes on disk. A `401` or `423` from the media origin reads a new ticket once and resumes; a second `401` fails the file as `unauthorized`, a second `423` pauses the server's files as relocked (Ruling 9).
8. **The `.part` is appended through a `PartFile` seam.** `openPart(path)` answers `{ size: () => Promise<number>; append: (chunk: Uint8Array) => Promise<void>; truncate: () => Promise<void>; close: () => Promise<void> }`; main builds it on `fs/promises.open(path, 'a+')`. `fetchToFile` calls `size()` once to build the `Range` header, `truncate()` when the server answers `200` to a ranged request or a `content-range` that does not start at the size, and `close()` always. The queue persists the entry's `bytes` only after `close()` resolved, so a crash leaves a `.part` the resume can trust.
9. **A relock pauses the group with a message.** The `paused` status gains `message: string | null`: `null` for the viewer's own Pause, `DOWNLOAD_MESSAGES.relocked(serverName)` when the server answered `LOCKED_STATUS`, `DOWNLOAD_MESSAGES.noSpace` for the rest of a group whose next file did not fit. Resume on a relocked entry sends the page to the unlock flow: the `downloads` view carries `needsUnlock: boolean` and the row's Resume opens `UnlockDialog` as the ask dialog does, then sends `resumeDownload`.
10. **Watched is decided in main, on every `savePosition` for a download's file.** `noteWatched` sets `watchedAt` when `watchedAt === null` and `position / duration >= watchedPercent / 100`, `duration` being the request's, falling back to the entry's. The first `savePosition` after an `openDownload` sets `pending.play`; every one sets `pending.position` and `pending.at`. `END_MARGIN_S` from `playerState` still clears the local resume spot as for any file.
11. **"Playing" for the auto-delete deferral is read off the source the player resolved.** `main.ts` wraps the file branch of `resolveSourceWith`: resolving a file source tells `downloads.notePlaying({ fileId })`, resolving a server source and the player's activity `onShowing(false)` tell `downloads.notePlaying(null)`. A timer that fires while its entry is the one playing is held and runs when `notePlaying` moves off it.
12. **Downloads join the recents as files.** A downloaded file's recent is the existing `file` kind by path; `desktopService.viewOf` and `describeFile` ask `downloads.fromLabelOf({ path })`, which answers "Downloaded from <server>" for a path under the downloads folder and `null` otherwise, in which case today's folder name is shown. Deleting a download removes its recent and its resume spot through `removeRecent` and a new `forgetResume(state, { path })`.
13. **No grouping of rows.** The list is sorted by `createdAt` descending with a group's rows kept together in `order` under the group's newest row, as the spec says; `sortDownloads(entries)` in `downloadState.ts` is the one place that order lives.
14. **The web button is one component, placed four times.** `DownloadButton` takes `target: DownloadTarget` and renders nothing while `opensInRavenPlayer` is off. `PlayableItemView` (movie and episode pages both render through it) passes `{ kind: 'media', mediaId: primary.id }`; `SeasonPage` and `ShowPage` pass `{ kind: 'item', itemId }`; `SagaPage` passes `{ kind: 'saga', libraryId: library.id, tmdbId: saga.tmdbId }` beside Play all.
15. **The fixture server grows a media plane and a library.** `startFixtureServer` gains `mediaPlane: boolean` (default false). On, `GET /api/media-origins` lists `elsewhere` as `lan`, `GET /api/media-origins/ping` answers random bytes, `GET /api/media/:id/ticket` answers `{ ticket: 'fixture-ticket-<id>', expiresAt: now + 21_600 }` behind the lock, and `elsewhere` serves `/api/media/:id/file` and `/subtitles/external-0` when `?t=fixture-ticket-<id>` is present (401 otherwise, never reading a cookie). Always: `GET /api/libraries/1` (name `Fixture Library`, `watchedPercent` 90, `@Public()` so served before the unlock), `GET /api/libraries/1/sagas` (one saga `tmdbId` `'100'`, name `Fixture Saga`, media first and second), `GET /api/items/10` (show `Fixture Show`, one season child id 11), `GET /api/items/11` (season, episodes whose `primary` are first and second). `FixtureRequest` gains `hasTicket: boolean`; the ticket value never reaches the log.
16. **Space is read where downloads live.** `readSpace` calls `statfs(downloadsDir)` after `mkdir(downloadsDir, { recursive: true })`; `free = bavail * bsize`, `total = blocks * bsize`, `used` is the sum of every entry's `bytes` (ready entries count `size`).
17. **Deleting a server deletes its downloads.** `trust.remove` already calls `onRemoved(serverId)`; `main.ts` adds `downloads.removeServer(serverId)` there, which aborts that server's fetches, drops its entries, forgets its pick and removes `downloads/<serverId>`. Settings' removal question says "Remove <name>? This signs raven player out of it and deletes its <n> downloads." when `n > 0`, read from the downloads query.

## Review Focus

1. A show of 120 episodes queued at night and the laptop shut at 40: on launch the queue resumes from each `.part` with a `Range` request and the badge shows what is left (Task 11's relaunch test).
2. A saga whose first movie was downloaded last week: the ask counts and sizes only the files not yet on disk, and queues only those (Task 6's dedupe test).
3. A ticket that lapses at hour six of a 60 GB file over a slow link: the fetch is aborted ten minutes before and resumes with a new ticket at the same byte (Task 11's refresh test).
4. The disk fills while a file downloads: the file fails with "Not enough space", keeps its `.part`, the rest of its group waits paused with the same message, and nothing else on the computer is touched (Task 10's ENOSPC test and Task 11's group test).
5. The viewer watches an episode to the end, quits, and reopens the app eleven minutes later while that episode is the first thing they play: the deletion fires at launch, sees the file playing, and waits until they leave it (Task 16's deferral test).

## PR stack

| PR | Branch | Base | Tasks | Spec |
| --- | --- | --- | --- | --- |
| 1 | `offline-mode` (this worktree) | `main` | 1, 2 | The link |
| 2 | `offline-state` | PR 1 | 3 to 8 | Expanding a link, State, Space, the ask |
| 3 | `offline-fetch` | PR 2 | 9 to 12 | Fetching a file, the Downloads page |
| 4 | `offline-play` | PR 3 | 13 to 15 | Playing a download, Reaching the server |
| 5 | `offline-delete` | PR 4 | 16 | Auto-delete |
| 6 | `offline-web` | PR 5 | 17 to 19 | Web app, e2e, docs |

Each PR: `gh pr create --base <base branch>` with the `pr-format` body. The spec and this plan go in PR 1's first commit.

---

## PR 1: the link

### Task 1: `downloadLinkFor` in core

**Files:**
- Modify: `libs/raven/core/src/playLink.ts`
- Test: `libs/raven/core/src/playLink.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DownloadTarget =
    | { kind: 'media'; mediaId: number }
    | { kind: 'item'; itemId: number }
    | { kind: 'saga'; libraryId: number; tmdbId: string }
  export type DownloadRequest = { origin: string; target: DownloadTarget }
  export const downloadLinkFor: (request: DownloadRequest) => string
  ```
  `downloadLinkFor` throws `RangeError` for an id that is not `isMediaId`, and for a `tmdbId` that is not `/^[1-9]\d{0,15}$/u`.

- [ ] **Step 1: Write the failing tests** in `playLink.test.ts`, beside `playLinkFor`'s:

```ts
describe('downloadLinkFor', () => {
  it('names a file', () => {
    expect(downloadLinkFor({ origin: 'https://raven.example', target: { kind: 'media', mediaId: 7 } }))
      .toBe('raven://download?server=https%3A%2F%2Fraven.example&media=7')
  })
  it('names an item', () => { /* ...&item=10 */ })
  it('names a saga by library and collection', () => { /* ...&saga=1%3A100 */ })
  it('throws for an id that is not one', () => {
    expect(() => downloadLinkFor({ origin: 'https://raven.example', target: { kind: 'media', mediaId: 0 } })).toThrow(RangeError)
    expect(() => downloadLinkFor({ origin: 'https://raven.example', target: { kind: 'saga', libraryId: 1, tmdbId: 'abc' } })).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd libs/raven/core && bun test src/playLink.test.ts`
Expected: FAIL, `downloadLinkFor` is not exported.

- [ ] **Step 3: Implement** `DownloadTarget`, `DownloadRequest` and `downloadLinkFor` in `playLink.ts`, with `toQueryString` as `playLinkFor` uses it, switching on `target.kind` with a `never` default.

- [ ] **Step 4: Run the tests**

Run: `cd libs/raven/core && bun test src/playLink.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (the spec and this plan go in this first commit)

```bash
git add docs/superpowers/specs/2026-10-17-raven-desktop-downloads-design.md docs/superpowers/plans/2026-10-17-raven-desktop-downloads.md libs/raven/core/src/playLink.ts libs/raven/core/src/playLink.test.ts
git commit -m "MAE: build raven://download links in core"
```

### Task 2: `readDownloadLink` and the opener's refusal

**Files:**
- Modify: `apps/raven/desktop/src/shared/playLink.ts`
- Modify: `apps/raven/desktop/src/main/servers/linkOpener.ts`
- Test: `apps/raven/desktop/src/shared/playLink.test.ts`, `apps/raven/desktop/src/main/servers/linkOpener.test.ts`

**Interfaces:**
- Consumes: `DownloadRequest`, `DownloadTarget` from `@raven/core` (Task 1).
- Produces: `export const readDownloadLink: (link: string) => DownloadRequest | null` in `shared/playLink.ts`; `LINK_MESSAGES.downloadsSoon = 'raven player cannot download titles yet.'` and `LINK_MESSAGES.unreadable` reworded to `'raven player could not read that link. It opens raven://play and raven://download links and raven watch pages.'`.

- [ ] **Step 1: Write the failing tests.** In `shared/playLink.test.ts`: `readDownloadLink` reads the three forms (`media=7`, `item=10`, `saga=1%3A100`) to `{ origin, target }`; returns null for two targets at once, for none, for a repeated key, for an `at` key, for a hash, for `saga=1:abc`, for a watch page, and for a `raven://play` link; `downloadLinkFor` round-trips through it for each form. In `linkOpener.test.ts`: `open` on a download link answers `{ type: 'refused', message: LINK_MESSAGES.downloadsSoon }` without calling `trust`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/raven/desktop && bun test src/shared/playLink.test.ts src/main/servers/linkOpener.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement.** In `shared/playLink.ts`, `readRavenLink` dispatches on `url.host` (`play` as today, `download` to a new `readDownloadQuery`), sharing the strictness checks; `DOWNLOAD_KEYS = new Set(['server', 'media', 'item', 'saga'])`; `readDownloadLink` mirrors `readPlayLink` and accepts only `raven:`. In `linkOpener.ts`, `open` tries `readPlayLink`, then `readDownloadLink`; a download link answers `refused` with `downloadsSoon`; neither answers `unreadable` as today.

- [ ] **Step 4: Run the tests**

Run: `cd apps/raven/desktop && bun test src/shared src/main/servers/linkOpener.test.ts`
Expected: PASS

- [ ] **Step 5: Verify and commit**

Run: `bunx nx affected -t typecheck lint:ts format:check test`
Expected: all green.

```bash
git add apps/raven/desktop/src/shared/playLink.ts apps/raven/desktop/src/shared/playLink.test.ts apps/raven/desktop/src/main/servers/linkOpener.ts apps/raven/desktop/src/main/servers/linkOpener.test.ts
git commit -m "MAE: read raven://download links in raven player"
```

- [ ] **Step 6: Open PR 1** with `gh pr create --base main` and the `pr-format` body, then `git switch -c offline-state`.

---

## PR 2: state, expansion and the ask

### Task 3: five reads join the allowlist

**Files:**
- Modify: `apps/raven/desktop/src/main/servers/allowlist.ts`
- Test: `apps/raven/desktop/src/main/servers/allowlist.test.ts`, `apps/raven/desktop/src/main/servers/serverCalls.test.ts`

**Interfaces:**
- Produces: the `AllowedCall` variants of Ruling 5; `requestFor` paths `/api/items/${itemId}`, `/api/libraries/${libraryId}`, `/api/libraries/${libraryId}/sagas`, `/api/media-origins`, `/api/media/${mediaId}/ticket`, all `GET` with `body: null`; `isWrite` false for all five.

- [ ] **Step 1: Write the failing tests.** In `allowlist.test.ts`: `matchCall` reads each of the five paths to its call (`GET /api/items/10` to `{ name: 'getItem', itemId: 10 }`, and so on); refuses `GET /api/items/10/` , `GET /api/items/010`, `GET /api/media-origins/ping`, `GET /api/media-origins?x=1`, `POST /api/items/10`, and any of the five with a body; `requestFor` round-trips each through `matchCall`; `isWrite` is false for each. In `serverCalls.test.ts`: `call` with `{ name: 'getMediaTicket', mediaId: 7 }` sends `GET /api/media/7/ticket` to the stored origin with `accept: application/json`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/raven/desktop && bun test src/main/servers/allowlist.test.ts src/main/servers/serverCalls.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** per Ruling 5: rename the `media` route kind to `numbered` with `read: ({ id, body })`, add the five routes, the five `requestFor` cases and the five `isWrite` cases. Update the doc comment on `matchCall` ("One of the thirteen calls").

- [ ] **Step 4: Run the tests**

Run: `cd apps/raven/desktop && bun test src/main/servers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/raven/desktop/src/main/servers/allowlist.ts apps/raven/desktop/src/main/servers/allowlist.test.ts apps/raven/desktop/src/main/servers/serverCalls.test.ts
git commit -m "MAE: allow raven player to read items, libraries, sagas, media origins and tickets"
```

### Task 4: the downloads state and its store

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/downloadState.ts`
- Create: `apps/raven/desktop/src/main/downloads/downloadStore.ts`
- Test: `apps/raven/desktop/src/main/downloads/downloadState.test.ts`, `apps/raven/desktop/src/main/downloads/downloadStore.test.ts`

**Interfaces:**
- Consumes: `loadJson`, `JsonStore`, `StateFs` from `@/main/stateStore`; `isOpaqueId` from `@/shared/protocol`; core combinators.
- Produces, in `downloadState.ts`:
  ```ts
  export const DOWNLOADS_FILE = 'downloads.json'
  export const isDownloadKind = oneOf(['movie', 'episode', 'season', 'show', 'saga'])
  export const isDownloadGroup = object({ kind: isDownloadKind, title: isString, order: isNumber })
  export const isSidecar = object({ trackId: isString, title: isString, language: isString })
  export const isDownloadStatus = union(
    object({ kind: oneOf(['queued']) }),
    object({ kind: oneOf(['downloading']), bytes: isNumber }),
    object({ kind: oneOf(['paused']), bytes: isNumber, message: nullable(isString) }),
    object({ kind: oneOf(['failed']), bytes: isNumber, message: isString }),
    object({ kind: oneOf(['ready']) }),
  )
  export const isPending = object({ play: isBoolean, position: nullable(isNumber), at: isNumber })
  export const isDownloadEntry = object({
    downloadId: isOpaqueId, serverId: isOpaqueId, mediaId: isMediaId, label: isString,
    group: isDownloadGroup, container: isString, size: isNumber, duration: nullable(isNumber),
    watchedPercent: isNumber, sidecars: listOf(isSidecar), status: isDownloadStatus,
    autoDelete: isBoolean, watchedAt: nullable(isNumber), pending: isPending, createdAt: isNumber,
  })
  export const isDownloadsState = object({ version: oneOf([1]), entries: listOf(isDownloadEntry), autoDeleteDefault: isBoolean })
  export type DownloadEntry = Infer<typeof isDownloadEntry>; export type DownloadsState = Infer<typeof isDownloadsState>
  export type DownloadStatus = Infer<typeof isDownloadStatus>; export type DownloadKind = Infer<typeof isDownloadKind>
  export const EMPTY_DOWNLOADS: DownloadsState
  export const NO_PENDING: Pending = { play: false, position: null, at: 0 }
  export const entryById = (state: DownloadsState, { downloadId }: { downloadId: string }) => DownloadEntry | null
  export const entryByMedia = (state, { serverId, mediaId }) => DownloadEntry | null
  export const queue = (state, { entries }: { entries: readonly DownloadEntry[] }) => DownloadsState   // appends, skipping a serverId+mediaId already present
  export const start = (state, { downloadId }) => DownloadsState        // queued|paused|failed -> downloading at its bytes
  export const advance = (state, { downloadId, bytes }) => DownloadsState
  export const pause = (state, { downloadId, message }: { downloadId: string; message: string | null }) => DownloadsState
  export const pauseServer = (state, { serverId, message }) => DownloadsState   // every queued or downloading entry of the server
  export const resume = (state, { downloadId }) => DownloadsState        // paused|failed -> queued
  export const fail = (state, { downloadId, message }) => DownloadsState
  export const finish = (state, { downloadId }) => DownloadsState
  export const remove = (state, { downloadId }) => DownloadsState
  export const removeServer = (state, { serverId }) => DownloadsState
  export const setAutoDelete = (state, { downloadId, autoDelete }) => DownloadsState
  export const setAutoDeleteDefault = (state, { autoDelete }) => DownloadsState
  export const noteWatched = (state, { downloadId, position, duration, at }: { downloadId: string; position: number; duration: number | null; at: number }) => DownloadsState
  export const notePending = (state, { downloadId, play, position, at }: { downloadId: string; play: boolean; position: number | null; at: number }) => DownloadsState
  export const clearPending = (state, { downloadId, sentPosition }: { downloadId: string; sentPosition: number | null }) => DownloadsState  // play false; position null only when it still equals sentPosition
  export const bytesOf = (entry: DownloadEntry) => number   // ready: size; else status.bytes or 0
  export const sortDownloads = (entries: readonly DownloadEntry[]) => DownloadEntry[]   // Ruling 13
  ```
  Every transition on an unknown id returns `state` itself (same reference), so `JsonStore.update` writes nothing.
- Produces, in `downloadStore.ts`: `export type DownloadsStore = JsonStore<DownloadsState>`; `export const loadDownloads = ({ fs, file, now }: { fs: StateFs; file: string; now: () => number }) => Promise<DownloadsState>` through `loadJson` with `isDownloadsState` and `EMPTY_DOWNLOADS`; `export const DOWNLOADS_DEBOUNCE_MS = 1000`.

- [ ] **Step 1: Write the failing tests.** `downloadState.test.ts`: a fixture `entry(overrides)`; the guard accepts `EMPTY_DOWNLOADS` and a full entry and rejects a `status.kind` it does not know; `queue` appends in order and skips a `serverId`+`mediaId` already there; `start` from queued, paused and failed keeps the bytes and refuses from ready and downloading (same reference); `advance` only while downloading; `pause` keeps bytes and the message; `pauseServer` touches only that server's queued and downloading entries; `resume` makes paused and failed queued; `fail` and `finish`; `remove`, `removeServer`; `setAutoDelete`, `setAutoDeleteDefault`; `noteWatched` sets `watchedAt` at `position/duration >= watchedPercent/100`, keeps an earlier one, uses the entry's duration when the request's is null, sets nothing when both are null; `notePending`; `clearPending` keeps a newer position; `bytesOf`; `sortDownloads` puts a group's rows together in `order` under the group's newest `createdAt`, newest group first; every transition on an unknown id returns the same reference. `downloadStore.test.ts`: a missing file loads `EMPTY_DOWNLOADS`; an unreadable file is renamed `.corrupt-<now>` and loads empty (as `stateStore.test.ts` does for the player state).

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/raven/desktop && bun test src/main/downloads`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement** both modules. Pure functions, spread and `map`, no mutation.

- [ ] **Step 4: Run the tests**

Run: `cd apps/raven/desktop && bun test src/main/downloads`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/raven/desktop/src/main/downloads/downloadState.ts apps/raven/desktop/src/main/downloads/downloadState.test.ts apps/raven/desktop/src/main/downloads/downloadStore.ts apps/raven/desktop/src/main/downloads/downloadStore.test.ts
git commit -m "MAE: keep raven player's downloads in downloads.json"
```

### Task 5: free space and the reserve

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/space.ts`
- Test: `apps/raven/desktop/src/main/downloads/space.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SPACE_RESERVE_BYTES = 2 * 1024 ** 3
  export type SpaceFs = { mkdir: (path: string) => Promise<void>; statfs: (path: string) => Promise<{ bavail: number; bsize: number; blocks: number }> }
  export type Space = { free: number; total: number }
  export const readSpace = ({ fs, dir }: { fs: SpaceFs; dir: string }) => Promise<Space>
  export const fits = ({ bytes, free }: { bytes: number; free: number }) => boolean   // bytes + SPACE_RESERVE_BYTES <= free
  export const DOWNLOADS_DIR = 'downloads'
  export const downloadsDirFor = ({ userData }: { userData: string }) => string
  export const entryDirFor = ({ userData, serverId, mediaId }) => string                 // downloads/<serverId>/<mediaId>
  export const videoPathFor = ({ userData, serverId, mediaId, container }) => string     // throws RangeError unless /^[a-z0-9]{1,8}$/u
  export const partPathFor = (same) => string
  export const sidecarPathFor = ({ userData, serverId, mediaId, trackId }) => string     // throws RangeError unless /^external-\d+$/u
  ```

- [ ] **Step 1: Write the failing tests.** `readSpace` makes the folder first, then multiplies `bavail` and `blocks` by `bsize`; `fits` at the boundary (`bytes + reserve === free` fits, one more does not); the path builders refuse `container: '../x'` and `trackId: 'embedded-0'` with `RangeError` and build the spec's layout for `mkv` and `external-2`; every path builder refuses a `serverId` that is not `isOpaqueId`.

- [ ] **Step 2: Run to see them fail**, implement, run again (`cd apps/raven/desktop && bun test src/main/downloads/space.test.ts`), then commit:

```bash
git add apps/raven/desktop/src/main/downloads/space.ts apps/raven/desktop/src/main/downloads/space.test.ts
git commit -m "MAE: read the disk's free space and lay out raven player's downloads folder"
```

### Task 6: expanding a link into files

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/expand.ts`
- Test: `apps/raven/desktop/src/main/downloads/expand.test.ts`

**Interfaces:**
- Consumes: `ServerCalls['call']` (Task 3's calls); `isItemDetails`, `isMediaItem`, `isLibrary`, `isSagaList`, `isAdminLock`, `mediaLabel`, `LOCKED_STATUS` from `@raven/core`; `DownloadTarget` (Task 1).
- Produces:
  ```ts
  export const DOWNLOAD_MAX_FILES = 500
  export type ExpandedFile = { media: MediaItem; label: string; group: { kind: DownloadKind; title: string; order: number }; watchedPercent: number }
  export type Expansion =
    | { ok: true; kind: DownloadKind; title: string; files: ExpandedFile[] }
    | { ok: false; reason: 'locked' | 'hidden' | 'gone' | 'unreachable' | 'tooMany' | 'unreadable'; message: string }
  export const EXPAND_MESSAGES = { tooMany: 'That is more than raven player downloads at once.', gone: (name: string) => `That title is not on ${name} any more.`, unreadable: (name: string) => `${name} answered with something raven player could not read.` } as const
  export const expandTarget = ({ calls, serverId, serverName, target, skip }: { calls: Pick<ServerCalls, 'call'>; serverId: string; serverName: string; target: DownloadTarget; skip: (mediaId: number) => boolean }) => Promise<Expansion>
  export const episodeLabel = ({ season, episode, title }: { season: number | null; episode: number | null; title: string }) => string   // 'S02E04 Trojan Horse', or the title alone without numbers
  ```
  Order: an episode's `season * 10000 + episode` (0 when null), a saga movie's index, a movie's 0. Group title: the show's title, the saga's name, the movie's own `mediaLabel`. Kind: `media` whose `item` is an episode gives `episode`, else `movie`; `item` by `ItemDetails.type`; `saga` is `saga`. `watchedPercent` from `getLibrary(media.libraryId).settings.watchedPercent`, read once per library. A `skip(mediaId)` file is left out of `files` but still counted toward `DOWNLOAD_MAX_FILES`. A read answering `LOCKED_STATUS` is `locked`; a 404 is `hidden` when `getAdminLock` answers `{ state: 'on', available: true }`, else `gone`; `ok: false` from `calls` is `unreachable` with its message; a body a guard refuses is `unreadable`.

- [ ] **Step 1: Write the failing tests** with a fake `calls` keyed by `${method} ${path}` answering `{ ok: true, status, body }`: a `media` target reads the file and its library; an `item` that is a show reads the show, then each season in order, and lists each episode's `primary` with the right order and labels; a season; an episode item (`versions[0]`); a saga picks the one whose `tmdbId` matches and orders its media; a missing saga is `gone`; `skip` leaves a file out but counts it; 501 episodes answer `tooMany`; a 423 answers `locked`; a 404 with the admin lock on answers `hidden`, with it off `gone`; an unreachable call carries its message; a body that is not an item answers `unreadable`; the library is read once for two episodes of one library.

- [ ] **Step 2: Run to see them fail**, implement, run again (`cd apps/raven/desktop && bun test src/main/downloads/expand.test.ts`), then commit:

```bash
git add apps/raven/desktop/src/main/downloads/expand.ts apps/raven/desktop/src/main/downloads/expand.test.ts
git commit -m "MAE: expand a download link into the files raven player will fetch"
```

### Task 7: the ask, in protocol, service and main

**Files:**
- Modify: `apps/raven/desktop/src/shared/protocol.ts`
- Create: `apps/raven/desktop/src/main/downloads/downloadService.ts`
- Modify: `apps/raven/desktop/src/main/servers/linkOpener.ts`, `apps/raven/desktop/src/main/openBatch.ts`, `apps/raven/desktop/src/main/desktopService.ts`, `apps/raven/desktop/src/main/main.ts`, `apps/raven/desktop/src/renderer/Shell/openReply.ts`, `apps/raven/desktop/src/renderer/SettingsPage/Servers.tsx` (only the exhaustive `switch` over replies)
- Test: `apps/raven/desktop/src/shared/protocol.test.ts`, `apps/raven/desktop/src/main/downloads/downloadService.test.ts`, `apps/raven/desktop/src/main/servers/linkOpener.test.ts`, `apps/raven/desktop/src/main/desktopService.test.ts`

**Interfaces:**
- Produces in `protocol.ts`:
  ```ts
  export const isDownloadAskStatus = union(
    object({ kind: oneOf(['ready']), title: isString, downloadKind: isDownloadKind, files: isNumber, bytes: isNumber, free: isNumber, fits: isBoolean }),
    object({ kind: oneOf(['locked']) }),
    object({ kind: oneOf(['hidden']) }),
  )
  export const isDownloadAsk = object({ askId: isOpaqueId, serverId: isOpaqueId, serverName: isString, autoDelete: isBoolean, status: isDownloadAskStatus })
  export type DownloadAsk = Infer<typeof isDownloadAsk>
  export const isDownloadView = object({
    downloadId: isOpaqueId, label: isString, group: isDownloadGroup, serverName: isString, size: isNumber,
    status: isDownloadStatus, autoDelete: isBoolean, watched: nullable(isNumber), deletesAt: nullable(isNumber), needsUnlock: isBoolean,
  })
  export type DownloadView = Infer<typeof isDownloadView>
  export const isSpaceView = object({ free: isNumber, total: isNumber, used: isNumber })
  export type SpaceView = Infer<typeof isSpaceView>
  ```
  (`isDownloadKind`, `isDownloadGroup`, `isDownloadStatus` move from `downloadState.ts` into `protocol.ts`, which `downloadState.ts` imports; the shared file is the one place the page and main read them from.)
  Requests added to `isDesktopRequest`: `confirmDownload { askId, autoDelete }`, `declineDownload { askId }`, `retryDownloadAsk { askId }`, `listDownloads`, `openDownload { downloadId }`, `pauseDownload { downloadId }`, `resumeDownload { downloadId }`, `retryDownload { downloadId }`, `deleteDownload { downloadId }`, `setDownloadAutoDelete { downloadId, autoDelete }`, `pauseAllDownloads`, `resumeAllDownloads`, `deleteAllDownloads`, `readSpace`, `setDownloadDefaults { autoDelete }`, `showDownloadsFolder`. Replies: `downloadAsk { ask }`, `downloads { downloads: listOf(isDownloadView), autoDeleteDefault }`, `space { space }`. Events: `downloadAsk { ask }`, `downloads { downloads, autoDeleteDefault }`.
- Produces in `downloadService.ts` (this task builds the ask half; Tasks 11, 14, 15 and 16 add to it):
  ```ts
  export const ASK_TTL_MS = 600_000
  export const DOWNLOAD_MESSAGES = {
    askGone: 'That download request has expired. Open the title in raven on the web and choose Download to raven player again.',
    unknown: 'That download is no longer in raven player.',
    queued: ({ files, kind, label, serverName }: { files: number; kind: DownloadKind; label: string; serverName: string }) => string,   // 'Downloading 3 movies from Vhagar'; one file: 'Downloading <label> from Vhagar'
    noSpace: 'Not enough space', changed: 'The file changed on the server', relocked: (name: string) => `${name} locked this library again`,
    downloaded: (label: string) => `Downloaded ${label}`, failed: ({ label, why }) => `Could not download ${label}: ${why}`,
    deletedAfterWatching: (label: string) => `Deleted ${label} after watching`,
  } as const
  export type DownloadServiceDeps = {
    store: DownloadsStore; config: ConfigStore; calls: Pick<ServerCalls, 'call'>; userData: string
    space: SpaceFs; timers: Timers; now: () => number; newId: () => string
    send: (event: DesktopEvent) => void; warn: (message: string) => void
  }
  export type DownloadService = {
    ask: (input: { serverId: string; target: DownloadTarget }) => Promise<DesktopReply>     // downloadAsk or refused
    retryAsk: (input: { askId: string }) => Promise<DesktopReply>
    confirm: (input: { askId: string; autoDelete: boolean }) => Promise<DesktopReply>      // queues entries, answers downloads, sends the notice through `send`
    decline: (input: { askId: string }) => DesktopReply
    list: () => DesktopReply                                                                // downloads
    readSpace: () => Promise<DesktopReply>                                                  // space
    setDefaults: (input: { autoDelete: boolean }) => DesktopReply
    views: () => DownloadView[]
    dispose: () => void
  }
  export const createDownloadService = (deps: DownloadServiceDeps) => DownloadService
  ```
  `ask` expands with `expandTarget` (skipping ids `entryByMedia` finds), reads space, holds `{ serverId, target, expansion, at }` under a fresh `askId`, and answers the `DownloadAsk` (`autoDelete` from `autoDeleteDefault`). Asks older than `ASK_TTL_MS` are dropped on the next `ask`, `retryAsk` or `confirm`. `confirm` builds one `DownloadEntry` per expanded file (`status: { kind: 'queued' }`, `sidecars: []` for now, `pending: NO_PENDING`, `createdAt: now()`), calls `queue`, sends `{ type: 'notice', message: DOWNLOAD_MESSAGES.queued(...) }` and a `downloads` event, and answers `downloads`. Every `store.update` is followed by a `downloads` event, coalesced to one per `DOWNLOADS_EVENT_MS`.
- `LinkOpener` gains `downloads: Pick<DownloadService, 'ask'>` in its deps: a download link, once trusted, answers `downloads.ask({ serverId: outcome.server.id, target })`. `eventForOpen` maps `downloadAsk` to the event; `applyReply` gains `showDownloadAsk: (ask: DownloadAsk) => void` and the new reply cases (`downloads`, `space` return). `desktopService` gains `downloads: DownloadService` in its deps and routes the sixteen requests; `main.ts` builds the store (`loadDownloads`, `createJsonStore` with `DOWNLOADS_DEBOUNCE_MS`, in the shutdown's `stores`), the service, and hands it to the opener and the desktop service.

- [ ] **Step 1: Write the failing tests.** `protocol.test.ts`: each new request, reply and event passes its guard and a `downloadAsk` reply with a path-like field is refused (object has no such key, so `object` refuses extra keys as it does today: check that behaviour holds). `downloadService.test.ts` with fake `calls` (as Task 6), a store over `createJsonStore` with `fakeTimers`, and a recorded `send`: `ask` on a movie answers `ready` with the file count, bytes, free and fits; a locked expansion answers `locked`; `retryAsk` after the fake server unlocks answers `ready`; `confirm` queues the entries, skipping one already present, sends the notice `Downloading 2 episodes from Vhagar` and a `downloads` event, and answers `downloads`; `confirm` on an unknown or expired ask (advance `now` by `ASK_TTL_MS + 1`) answers `refused` with `askGone`; `decline` drops the ask; `setDefaults` changes `autoDeleteDefault` and the next ask's `autoDelete`. `linkOpener.test.ts`: a trusted download link answers what `downloads.ask` answered, and a declined trust answers `done` without asking. `desktopService.test.ts`: `confirmDownload` and `listDownloads` reach the download service.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/raven/desktop && bun test src/shared src/main/downloads src/main/servers src/main/desktopService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** the protocol, the service, the opener's download branch, `eventForOpen`, `applyReply`, the desktop service's routing, the Servers page's reply `switch`, and `main.ts`'s wiring (`space: { mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined), statfs: (path) => statfs(path) }`).

- [ ] **Step 4: Run the tests**

Run: `cd apps/raven/desktop && bun run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/raven/desktop/src
git commit -m "MAE: ask before raven player downloads what a link names"
```

### Task 8: the download dialog in the Shell

**Files:**
- Create: `apps/raven/desktop/src/renderer/Shell/DownloadDialog.tsx`, `apps/raven/desktop/src/renderer/Shell/DownloadDialog.module.scss`
- Create: `apps/raven/desktop/src/renderer/desktop/downloadsApi.ts`
- Modify: `apps/raven/desktop/src/renderer/Shell/Shell.tsx`
- Test: `apps/raven/desktop/src/renderer/Shell/DownloadDialog.test.tsx`, `apps/raven/desktop/src/renderer/Shell/Shell.test.tsx`

**Interfaces:**
- Consumes: `DownloadAsk`, the `downloadAsk` event and reply (Task 7); `UnlockDialog`, `Button` from `@raven/ui`; `serverApiFor` from `@/renderer/desktop/serverApi`; `formatBytes` from `@raven/core`.
- Produces in `downloadsApi.ts`: `export const DOWNLOADS_KEY = ['desktop', 'downloads'] as const`; `export const SPACE_KEY = ['desktop', 'space'] as const`; `export const useDownloads = () => UseQueryResult<{ downloads: DownloadView[]; autoDeleteDefault: boolean }>` (queryFn sends `listDownloads`); `export const applyDownloadsEvent = ({ queryClient, event })` sets `DOWNLOADS_KEY` data from a `downloads` event; `export const useSpace = () => UseQueryResult<SpaceView>`.
- Produces `DownloadDialog = ({ ask, onClose }: { ask: DownloadAsk; onClose: () => void })`: a `dialog` labelled "Download to raven player"; for `ready`, the question "Download <title> (<files> <kind plural>, <formatBytes(bytes)>) from <serverName>?", the line "<formatBytes(free)> free on this disk." or, when `!fits`, "Needs <bytes>; <free> free." with no Download button; a checkbox "Delete once watched" starting at `ask.autoDelete`; Cancel sends `declineDownload`, Download sends `confirmDownload` and closes. For `locked` and `hidden`, the `UnlockDialog` with `SERVER_COPY.pinHint` or `adminHint` from `serverServices`, unlocking through `serverApiFor`, whose `onUnlocked` sends `retryDownloadAsk`; the reply replaces `ask` (the Shell's `showDownloadAsk` is called with the new ask). The Shell handles the `downloadAsk` event and reply by setting `ask` state, and the `downloads` event through `applyDownloadsEvent`.

- [ ] **Step 1: Write the failing tests.** `DownloadDialog.test.tsx` through `renderDesktop` with `fakeClient`: a ready ask shows the question with `3 movies, 41.2 GB` and `412 GB free on this disk.`; Download sends `confirmDownload` with the checkbox's value and closes; Cancel sends `declineDownload`; an ask that does not fit shows `Needs 41.2 GB; 12.0 GB free.` and no Download button; a locked ask shows the PIN dialog and, after `unlock` answers, sends `retryDownloadAsk`. `Shell.test.tsx`: a `downloadAsk` event opens the dialog; a `downloads` event seeds `DOWNLOADS_KEY`.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/raven/desktop && bun run test:renderer`
Expected: FAIL

- [ ] **Step 3: Implement** the three files and the Shell changes. Layout as `OpenLinkDialog` does: a grid, tokens, `--focus-ring`.

- [ ] **Step 4: Run the tests, then lint the SCSS**

Run: `cd apps/raven/desktop && bun run test:renderer && bun run lint:css`
Expected: PASS

- [ ] **Step 5: Verify and commit**

Run: `bunx nx affected -t typecheck lint:ts lint:css format:check test`

```bash
git add apps/raven/desktop/src/renderer
git commit -m "MAE: show the download ask in raven player"
```

- [ ] **Step 6: Open PR 2** with `gh pr create --base offline-mode`, then `git switch -c offline-fetch`.

---

## PR 3: fetching and the Downloads page

### Task 9: media origins, the pick and the tickets

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/mediaAccess.ts`
- Test: `apps/raven/desktop/src/main/downloads/mediaAccess.test.ts`

**Interfaces:**
- Consumes: `ServerCalls['call']` with `getMediaOrigins` and `getMediaTicket` (Task 3); `isMediaOrigins`, `isMediaTicket`, `MEDIA_PROBE_BYTES`, `LOCKED_STATUS` from `@raven/core`.
- Produces:
  ```ts
  export const PROBE_TIMEOUT_MS = 2000
  export const ORIGIN_KIND_RANK = { lan: 0, tailnet: 1, public: 2 } as const satisfies Record<MediaOriginKind, number>
  export type ProbeFetch = (input: { url: string; timeoutMs: number }) => Promise<{ status: number; firstByteMs: number }>
  export type Access = { kind: 'origin'; url: string; ticket: string; expiresAt: number } | { kind: 'cookie' }
  export type AccessOutcome = { ok: true; access: Access } | { ok: false; reason: 'locked' | 'unreachable' | 'unreadable'; message: string }
  export type MediaAccess = {
    accessFor: (input: { serverId: string; mediaId: number }) => Promise<AccessOutcome>
    forget: (serverId: string) => void
  }
  export const pickReachable = (probes: readonly { origin: MediaOrigin; status: number; firstByteMs: number }[]) => MediaOrigin | null
  export const fileUrlFor = ({ access, origin, mediaId }: { access: Access; origin: string; mediaId: number }) => string      // `${access.url}/api/media/${mediaId}/file?t=${encodeURIComponent(ticket)}` or `${origin}/api/media/${mediaId}/file`
  export const sidecarUrlFor = ({ access, origin, mediaId, trackId }) => string   // throws RangeError unless /^external-\d+$/u
  export const createMediaAccess = ({ calls, serverOf, probe, now, warn }: { calls: Pick<ServerCalls, 'call'>; serverOf: (serverId: string) => ServerEntry | null; probe: ProbeFetch; now: () => number; warn: (message: string) => void }) => MediaAccess
  ```
  `accessFor` reads the origins once per server (held until `forget`), probes them all at once, picks with `pickReachable` (Ruling 6); a `null` pick answers `{ kind: 'cookie' }`; a pick reads `getMediaTicket` and answers `origin` with `expiresAt` in epoch milliseconds (`ticket.expiresAt * 1000`). A ticket read answering `LOCKED_STATUS` is `locked`; `ok: false` is `unreachable`; a body `isMediaTicket` refuses is `unreadable`. An origins read that fails or is unreadable logs a warning and picks `null`. Nothing logs a ticket or an origin's URL beyond its kind.

- [ ] **Step 1: Write the failing tests.** `pickReachable`: lan beats a faster public; among two lan the faster first byte; a 500 or a timed-out probe is skipped; none answering picks null. `createMediaAccess` with fake `calls` and `probe`: no origins listed gives `cookie` and no probe; two origins probed at once (both probes started before either answers) and the lan one picked; the ticket read once per `accessFor`; the origins read once per server across two files; `forget` reads them again; a 423 on the ticket is `locked`; the warning on a bad origins body names no URL. URL builders: the ticket is `encodeURIComponent`ed; the cookie path has no `?t=`; `sidecarUrlFor` refuses `embedded-0`.

- [ ] **Step 2: Run to see them fail**, implement, run again (`cd apps/raven/desktop && bun test src/main/downloads/mediaAccess.test.ts`), then commit:

```bash
git add apps/raven/desktop/src/main/downloads/mediaAccess.ts apps/raven/desktop/src/main/downloads/mediaAccess.test.ts
git commit -m "MAE: pick a media origin and hold a ticket for raven player's downloads"
```

### Task 10: one file, with ranges, to disk

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/fetchFile.ts`
- Test: `apps/raven/desktop/src/main/downloads/fetchFile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROGRESS_STEP_BYTES = 8 * 1024 ** 2
  export const PROGRESS_STEP_MS = 1000
  export const DOWNLOAD_STALL_MS = 30_000
  export type StreamFetch = (input: { url: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
    status: number; headers: { get: (name: string) => string | null }; body: ReadableStream<Uint8Array> | null
  }>
  export type PartFile = { size: () => Promise<number>; append: (chunk: Uint8Array) => Promise<void>; truncate: () => Promise<void>; close: () => Promise<void> }
  export type FetchOutcome =
    | { ok: true; bytes: number }
    | { ok: false; reason: 'aborted' | 'unreachable' | 'stalled' | 'changed' | 'locked' | 'unauthorized' | 'space' | 'status'; status: number | null; bytes: number }
  export const fetchToFile = ({ fetch, url, part, expectedSize, signal, timers, now, stallMs, onProgress }: {
    fetch: StreamFetch; url: string; part: PartFile; expectedSize: number; signal: AbortSignal; timers: Timers; now: () => number; stallMs?: number
    onProgress: (bytes: number) => void
  }) => Promise<FetchOutcome>
  export const contentRangeStart = (header: string | null) => number | null   // 'bytes 1024-2047/4096' -> 1024
  ```
  Behaviour: `from = await part.size()`; `from > 0` sends `Range: bytes=${from}-` and expects `206` with `content-range` starting at `from`, else `truncate()` and start over from 0 (one restart at most, then `changed`); `from === 0` expects `200`. `401` is `unauthorized`, `423` `locked`, `416` `changed`, any other non-2xx `status`. Chunks are appended; `onProgress(bytes)` after every `PROGRESS_STEP_BYTES` or `PROGRESS_STEP_MS`, whichever comes later, and once at the end. A read that takes longer than `stallMs` (a `timers.set` reset on every chunk) aborts the body and answers `stalled`. `bytes > expectedSize` while reading, or `bytes !== expectedSize` at the end, is `changed` and the part is truncated. An `append` rejecting with `code === 'ENOSPC'` is `space`, keeping the part. `signal` aborted is `aborted`, keeping the part. `close()` runs in every case before the outcome is returned.

- [ ] **Step 1: Write the failing tests** with a fake `StreamFetch` built from `ReadableStream`s and a fake `PartFile` over a `Uint8Array[]`: a whole file (200, right size) with progress calls at the step; a resume (`Range: bytes=4096-`, 206, `content-range: bytes 4096-8191/8192`) appends after the bytes on disk; a 200 on a resume truncates and starts over; a `content-range` from another byte truncates; a short body is `changed` and truncated; a long body is `changed`; a stall with `fakeTimers` is `stalled`; `ENOSPC` from `append` is `space` with the part kept; 401 and 423 and 416 and 500; an abort mid-body is `aborted` with the bytes so far; `close` is called on every path.

- [ ] **Step 2: Run to see them fail**, implement, run again (`cd apps/raven/desktop && bun test src/main/downloads/fetchFile.test.ts`), then commit:

```bash
git add apps/raven/desktop/src/main/downloads/fetchFile.ts apps/raven/desktop/src/main/downloads/fetchFile.test.ts
git commit -m "MAE: fetch one file to disk with ranges for raven player"
```

### Task 11: the queue, and the service's download side

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/downloadQueue.ts`
- Modify: `apps/raven/desktop/src/main/downloads/downloadService.ts`, `apps/raven/desktop/src/main/main.ts`, `apps/raven/desktop/src/main/desktopService.ts`
- Test: `apps/raven/desktop/src/main/downloads/downloadQueue.test.ts`, `apps/raven/desktop/src/main/downloads/downloadService.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 9, 10.
- Produces:
  ```ts
  export const DOWNLOAD_CONCURRENCY = 2
  export type QueueFs = {
    mkdir: (path: string) => Promise<void>; rename: (from: string, to: string) => Promise<void>
    rm: (path: string) => Promise<void>; openPart: (path: string) => Promise<PartFile>
    writeFile: (path: string, text: string) => Promise<void>
  }
  export type DownloadQueueDeps = {
    store: DownloadsStore; serverOf: (serverId: string) => ServerEntry | null; access: MediaAccess
    /** The session's fetch, cookies along, for the cookie kind; a bare fetch with no cookie for an origin. Both `redirect: 'error'`. */
    fetchFor: (input: { serverId: string; access: Access }) => StreamFetch
    calls: Pick<ServerCalls, 'call'>; fs: QueueFs; space: SpaceFs
    userData: string; timers: Timers; now: () => number; warn: (message: string) => void
    onFinished: (entry: DownloadEntry) => void; onFailed: (entry: DownloadEntry) => void
  }
  export type DownloadQueue = {
    kick: () => void                                   // starts up to DOWNLOAD_CONCURRENCY queued entries
    pause: (input: { downloadId: string }) => Promise<void>
    resume: (input: { downloadId: string }) => void
    retry: (input: { downloadId: string }) => void
    pauseAll: () => Promise<void>; resumeAll: () => void
    remove: (input: { downloadId: string }) => Promise<void>        // aborts, removes the entry's folder, drops the entry
    removeServer: (input: { serverId: string }) => Promise<void>    // aborts, removes downloads/<serverId>, drops the entries, access.forget
    dispose: () => void                                              // aborts every fetch; the entries stay as they are for the next launch
  }
  export const createDownloadQueue = (deps: DownloadQueueDeps) => DownloadQueue
  ```
  Per file: `fits` against `readSpace`, else `fail` with `noSpace` and `pause` the rest of the entry's group (same `serverId` and `group.title`, queued ones) with `noSpace`; `access.accessFor`; `locked` pauses the server's entries with `relocked(name)` through `pauseServer`; `start`; `mkdir(entryDir)`; `fetchToFile` with `fetchFor({ serverId, access })`, progress through `advance`; an origin ticket is renewed by aborting `MEDIA_TICKET_REFRESH_SECONDS * 1000` before `expiresAt` through a `timers.set` and fetching again (Ruling 7); `unauthorized` or `locked` from the fetch refetches the ticket once; after the video, each sidecar (from `getTracks`, filtered as `serverSources.sidecarsOf` does) is fetched whole with `fetchFor` and `writeFile`, a failure logged and skipped, and the entry's `sidecars` set; then `rename(part, video)` and `finish`, `onFinished(entry)`. A `.part` is never removed by a failure, only by `remove`. `kick` is called after every state change that can free a slot.
- `downloadService` gains the queue and the sixteen request handlers for this PR: `pause`, `resume` (a relocked entry's resume goes through the queue as any), `retry`, `remove` (answers `downloads`), `pauseAll`, `resumeAll`, `removeAll`, `removeServer`, `showFolder` (through a `showItemInFolder: (path: string) => void` dep), and `readSpace` adds `used`. `views()` fills `needsUnlock` (paused with the relocked message), `watched: null` for now, `deletesAt: null` for now. `onFinished` sends the notice `downloaded(label)`, `onFailed` sends `failed({ label, why })`. At construction the service calls `queue.kick()` once the store is loaded, so a launch resumes what was left. `desktopService.removeOne` calls `downloads.removeServer` after `trust.remove` answers true (Ruling 17 puts the call in `main.ts`'s `onRemoved`; do it there, not in `desktopService`).
- `main.ts` wires: `fetchFor` from `sessions.sessionOf(serverId).fetch` for the cookie kind and `net.fetch` with `credentials: 'omit'` for the origin kind, both `redirect: 'error'`; `probe` from `net.fetch` as Ruling 6; `fs` from `fs/promises` (`openPart` over `open(path, 'a+')`); `showItemInFolder` from `shell.showItemInFolder`; the queue's `dispose` in `before-quit` before the stores flush.

- [ ] **Step 1: Write the failing tests.** `downloadQueue.test.ts` with fake access (`origin` with a far `expiresAt`), fake `StreamFetch` recording URLs and headers, fake fs, fake space, `fakeTimers`: two files start at once and the third waits; the first file's URL carries `?t=` and the fetch is the origin one; the cookie kind uses the session fetch with no `t`; a file that does not fit fails `noSpace` and its group waits paused with that message while another group's file starts; a relock (`locked` access) pauses the server's entries with `relocked`; a `paused` entry resumed is `queued` and starts with `Range` from its bytes (through `part.size()`); `retry` after `failed`; `pauseAll` aborts and marks paused with `null`; the ticket refresh: `expiresAt` 15 minutes away aborts the fetch after 5 minutes of fake time, reads a new ticket and fetches again with the new `t`; `unauthorized` once refetches the ticket, twice fails; a finished file has its part renamed, its sidecar written under `subtitles/external-0.vtt`, its `sidecars` set, and `onFinished` called; `remove` of a downloading entry aborts and removes its folder; `removeServer` removes `downloads/<serverId>`; a relaunch (a store seeded with a `downloading` entry at 4096 bytes and a part of that size) resumes with `Range: bytes=4096-`; `dispose` aborts and leaves the entries. `downloadService.test.ts` adds: `pauseDownload` through to the queue; `readSpace` sums `used`; `deleteAllDownloads` answers an empty list; a finished file sends the `Downloaded <label>` notice.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/raven/desktop && bun test src/main/downloads`
Expected: FAIL

- [ ] **Step 3: Implement** the queue, the service's additions, and `main.ts`'s wiring.

- [ ] **Step 4: Run the tests**

Run: `cd apps/raven/desktop && bun run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/raven/desktop/src/main
git commit -m "MAE: download files two at a time with ranges in raven player"
```

### Task 12: the Downloads page, Home's button and the Settings section

**Files:**
- Create: `apps/raven/desktop/src/renderer/DownloadsPage/DownloadsPage.tsx`, `DownloadsPage.module.scss`, `DownloadRow.tsx`
- Create: `apps/raven/desktop/src/renderer/SettingsPage/Downloads.tsx`, `Downloads.module.scss`
- Modify: `apps/raven/desktop/src/renderer/routes.tsx`, `apps/raven/desktop/src/renderer/HomePage/HomePage.tsx` (and its module), `apps/raven/desktop/src/renderer/SettingsPage/SettingsPage.tsx`, `apps/raven/desktop/src/renderer/SettingsPage/Servers.tsx` (the removal question, Ruling 17), `apps/raven/desktop/src/renderer/test/render.tsx` (`STUB_ROUTES` gains `downloads`)
- Test: `DownloadsPage.test.tsx`, `HomePage.test.tsx`, `SettingsPage/Downloads.test.tsx`, `Servers.test.tsx`

**Interfaces:**
- Consumes: `useDownloads`, `useSpace`, `DOWNLOADS_KEY`, `SPACE_KEY` (Task 8); `DownloadView`, `SpaceView`; `formatBytes`; `Button`, `UnlockDialog`.
- Produces: the route `downloads`; `DownloadsPage` (a `main` labelled "Downloads": header with Back, the title, the line "<used> of downloads · <free> free of <total>" and a `meter` labelled "Disk", Pause all / Resume all while anything is queued or downloading; a `ul` of `DownloadRow`s from `useDownloads().downloads` as main sorted them; the empty state); `DownloadRow` (label, "<group.title> · <serverName>", size, status: `progress` with "<bytes> of <size>" while downloading, "Waiting", "Paused" or its message, "Failed: <message>", a watched `progress` as Home's recents when ready; Play (ready only, sends `openDownload` and applies the reply through `useOpenReply`), Pause/Resume/Retry, a "Delete once watched" switch (`input type="checkbox" role="switch"`, sends `setDownloadAutoDelete`), Delete asking "Delete <label>? <size> will be freed." inline as `Servers` asks before a removal; Resume on `needsUnlock` opens `UnlockDialog` first); Home's `Button icon="download" aria-label="Downloads"` beside Settings with a badge `<span class=badge aria-hidden>` and the label "Downloads, 3 in progress" when `n > 0`; Settings' `Downloads` section: the "Delete once watched by default" switch (`setDownloadDefaults`), "Delete all downloads" with a confirmation, the line and "Show in Finder" (`showDownloadsFolder`).

- [ ] **Step 1: Write the failing tests** through `renderDesktop` with a `fakeClient` whose `request` answers `listDownloads` and `readSpace` from fixtures: rows render by status with the right text; Play sends `openDownload`; Pause, Resume, Retry, the switch and Delete (after the question) send their requests; a relocked row's Resume shows the PIN dialog; the meter's value and the space line; the empty state; Pause all appears only while something is in progress; Home shows the badge count and the label; Settings' section sends `setDownloadDefaults` and `showDownloadsFolder`, and Delete all asks first; the Servers removal question counts the server's downloads.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/raven/desktop && bun run test:renderer`
Expected: FAIL

- [ ] **Step 3: Implement.** Grids with `gap`, named areas for the row, tokens, 320px.

- [ ] **Step 4: Run the tests and lint**

Run: `cd apps/raven/desktop && bun run test:renderer && bun run lint:css`
Expected: PASS

- [ ] **Step 5: Verify and commit**

Run: `bunx nx affected -t typecheck lint:ts lint:css format:check test`

```bash
git add apps/raven/desktop/src/renderer
git commit -m "MAE: show raven player's downloads, the disk's space and a Downloads button on Home"
```

- [ ] **Step 6: Open PR 3** with `gh pr create --base offline-state`, then `git switch -c offline-play`.

---

## PR 4: playing a download and reaching the server

### Task 13: sidecars on a file target

**Files:**
- Modify: `apps/raven/desktop/src/main/player/playerService.ts`, `apps/raven/desktop/src/main/main.ts`
- Modify: `apps/raven/desktop/test/player.native.ts` (one case)
- Test: `apps/raven/desktop/src/main/player/playerService.test.ts`

**Interfaces:**
- Produces: `export type LocalSidecar = { path: string; title: string; language: string }`; `LoadTarget`'s file variant becomes `{ kind: 'file'; path: string; sidecars: readonly LocalSidecar[] }`; `resolveSourceWith` gains `sidecarsOf: (fileId: string) => readonly LocalSidecar[]` in its deps and fills the list; `snapshot` adds a file target's sidecars with `sub-add <path> auto <title> <language>` within the same `SIDECAR_BUDGET_MS` as a server's. `main.ts` passes `sidecarsOf: () => []` until Task 14.

- [ ] **Step 1: Write the failing tests.** `playerService.test.ts`: a file target with one sidecar sends `sub-add` with its path after `loadfile`; with none sends no `sub-add`; `resolveSourceWith` carries what `sidecarsOf` answers. `test/player.native.ts`: read the file first; add a case that loads a local clip with one `.vtt` sidecar (write a small VTT beside the clip in a temp folder) and sees the subtitle track in `track-list` with its title.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/raven/desktop && bun test src/main/player/playerService.test.ts`
Expected: FAIL. (`test:native` runs only on an Apple Silicon Mac with the CI-built addon; run it when the addon is present: `bun run test:native`.)

- [ ] **Step 3: Implement**, then run the tests (`bun test src/main/player`, and `bun run test:native` where possible), then commit:

```bash
git add apps/raven/desktop/src/main/player apps/raven/desktop/src/main/main.ts apps/raven/desktop/test/player.native.ts
git commit -m "MAE: carry sidecar subtitles on a local file in raven player"
```

### Task 14: opening a download, its recents, resume and watched

**Files:**
- Modify: `apps/raven/desktop/src/main/downloads/downloadService.ts`, `apps/raven/desktop/src/main/desktopService.ts`, `apps/raven/desktop/src/main/playerState.ts`, `apps/raven/desktop/src/main/main.ts`
- Test: `downloadService.test.ts`, `desktopService.test.ts`, `playerState.test.ts`

**Interfaces:**
- Consumes: `Grants` (`grant`, `fileOf`), `StateStore`, `resumeFor`, `watchedShare`, `removeRecent`; Task 13's `sidecarsOf`.
- Produces in `downloadService`: deps gain `grants: Grants`, `state: StateStore`, `stat: (path) => Promise<{ size: number; mtimeMs: number }>`; methods `open: (input: { downloadId: string }) => Promise<DesktopReply>` (grants `videoPathFor(...)`, remembers `fileId -> downloadId`, builds `queue` from the group's other `ready` entries after this one in `order`, answers `play`); `sidecarsOf: (fileId: string) => readonly LocalSidecar[]`; `fromLabelOf: (input: { path: string }) => string | null` (Ruling 12); `notePosition: (input: { fileId: string; position: number; duration: number | null }) => void` (Ruling 10, `pending.play` true on the first call after `open`); `notePlaying: (input: { fileId: string | null }) => void` (Ruling 11, stored for Task 16); `views()` fills `watched` through `watchedShare(state, { file })` with the file's facts from `stat`. In `playerState.ts`: `export const forgetResume = (state: PlayerState, { path }: { path: string }) => PlayerState`. `remove` in the service calls `removeRecent` and `forgetResume` on the player state. `desktopService.describeFile` and `viewOf` use `fromLabelOf`; `recordPosition` calls `downloads.notePosition` after saving. `main.ts` passes `sidecarsOf: downloads.sidecarsOf` to `resolveSourceWith` and wraps the file branch for `notePlaying` (Ruling 11); `attachPlayer`'s `onShowing(false)` calls `downloads.notePlaying({ fileId: null })`.

- [ ] **Step 1: Write the failing tests.** `downloadService.test.ts`: `open` on a ready entry grants the video path and answers `play` with the group's later ready entries queued in order (a `queued` one left out); `open` on one not ready is refused with `unknown`; `sidecarsOf` lists the entry's sidecar paths under `subtitles/`; `fromLabelOf` answers "Downloaded from Vhagar" for the entry's path and null for `/Movies/x.mkv`; `notePosition` sets `pending.play` once and `pending.position` each time, and `watchedAt` when `position/duration` reaches `watchedPercent/100`; `remove` drops the recent and the resume spot; `views` carries `watched`. `desktopService.test.ts`: `describeFile` on a granted download answers `folder: 'Downloaded from Vhagar'`; `listRecents` shows the same `from`. `playerState.test.ts`: `forgetResume`.

- [ ] **Step 2: Run to see them fail**, implement, run `cd apps/raven/desktop && bun run test:main`, then commit:

```bash
git add apps/raven/desktop/src/main
git commit -m "MAE: play a download in raven player as a local file and note what was watched"
```

### Task 15: reaching the server

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/sync.ts`
- Modify: `apps/raven/desktop/src/main/downloads/downloadService.ts`, `apps/raven/desktop/src/main/main.ts`
- Test: `apps/raven/desktop/src/main/downloads/sync.test.ts`, `downloadService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SYNC_DEBOUNCE_MS = 2000
  export const SYNC_RETRY_MS = 300_000
  export type Sync = { touch: (input: { downloadId: string }) => void; runAll: () => Promise<void>; dispose: () => void }
  export const createSync = ({ store, calls, timers, now, warn }: { store: DownloadsStore; calls: Pick<ServerCalls, 'call'>; timers: Timers; now: () => number; warn: (message: string) => void }) => Sync
  ```
  `touch` debounces `SYNC_DEBOUNCE_MS` per entry, then sends `recordPlay` when `pending.play`, then `saveProgress` with `pending.position` when not null; a 2xx clears what was sent through `clearPending({ sentPosition })`; `ok: false`, 401, 403, 404 and 423 leave `pending` as it is (404 and 403 logged once per entry); `runAll` touches every entry with something pending and is called at launch and every `SYNC_RETRY_MS` while anything is pending (a `timers.set` the service arms). `recordPlay` is sent at most once per touch. The service calls `sync.touch` after `notePosition`, `sync.runAll` when the Downloads page is listed (`list`) and at construction, and `sync.runAll` best effort before a deletion.

- [ ] **Step 1: Write the failing tests** with fake `calls` and `fakeTimers`: a touch sends nothing until the debounce; then `POST plays` and `PUT progress` in that order with the position; a second touch within the debounce sends once with the newer position; a 204 clears both; a position saved between send and answer is kept; an unreachable call keeps pending and the retry timer sends it again after `SYNC_RETRY_MS`; a 404 keeps pending, is logged once, and is not sent again until the next `runAll`; `dispose` clears the timers.

- [ ] **Step 2: Run to see them fail**, implement, run `cd apps/raven/desktop && bun run test:main`, verify with `bunx nx affected -t typecheck lint:ts format:check test`, then commit:

```bash
git add apps/raven/desktop/src/main
git commit -m "MAE: send a download's plays and positions to its server when it is reachable"
```

- [ ] **Step 3: Open PR 4** with `gh pr create --base offline-fetch`, then `git switch -c offline-delete`.

---

## PR 5: auto-delete

### Task 16: the ten-minute clock

**Files:**
- Create: `apps/raven/desktop/src/main/downloads/autoDelete.ts`
- Modify: `apps/raven/desktop/src/main/downloads/downloadService.ts`
- Test: `apps/raven/desktop/src/main/downloads/autoDelete.test.ts`, `downloadService.test.ts`, `DownloadsPage.test.tsx` (the "Deletes in 7 minutes" line)

**Interfaces:**
- Produces:
  ```ts
  export const AUTO_DELETE_DELAY_MS = 600_000
  export type AutoDelete = {
    rebuild: () => void                                  // from the store: every ready entry with autoDelete and watchedAt
    schedule: (input: { downloadId: string }) => void    // at max(now, watchedAt + delay); from now when switched on after watched (spec: my call)
    cancel: (input: { downloadId: string }) => void
    playbackLeft: () => void                             // runs any deletion held while its file played
    deletesAt: (input: { downloadId: string }) => number | null
    dispose: () => void
  }
  export const createAutoDelete = ({ store, timers, now, isPlaying, remove, onDeleted }: {
    store: DownloadsStore; timers: Timers; now: () => number
    isPlaying: (downloadId: string) => boolean; remove: (downloadId: string) => Promise<void>; onDeleted: (entry: DownloadEntry) => void
  }) => AutoDelete
  ```
  The service: `rebuild` at construction; `schedule` after `noteWatched` sets `watchedAt` and after `setAutoDelete(true)` on a watched entry; `cancel` on `setAutoDelete(false)` and on `remove`; `playbackLeft` when `notePlaying` moves off an entry; `onDeleted` sends the notice `deletedAfterWatching(label)` and the `downloads` event; `views()` fills `deletesAt`; the row shows "Deletes in <n> minutes" from `deletesAt`.

- [ ] **Step 1: Write the failing tests** with `fakeTimers`: fires at `watchedAt + delay`; fires at once when that is past (launch after eleven minutes); `rebuild` arms one timer per eligible entry and none for a `queued` one; `schedule` on a switch-on after watched fires `delay` from now; `cancel` disarms; a timer firing while `isPlaying` holds the deletion, and `playbackLeft` runs it; `remove` is awaited before `onDeleted`; `dispose` clears every timer. Service tests: the notice and the event on deletion; the row test shows "Deletes in 7 minutes" for a `deletesAt` seven minutes out.

- [ ] **Step 2: Run to see them fail**, implement, run `cd apps/raven/desktop && bun run test`, verify with `bunx nx affected -t typecheck lint:ts lint:css format:check test`, then commit:

```bash
git add apps/raven/desktop/src
git commit -m "MAE: delete a watched download ten minutes later in raven player"
```

- [ ] **Step 3: Open PR 5** with `gh pr create --base offline-play`, then `git switch -c offline-web`.

---

## PR 6: the web button, e2e and docs

### Task 17: Download to raven player on the web

**Files:**
- Create: `apps/raven/web/src/components/DownloadButton/DownloadButton.tsx`, `DownloadButton.test.tsx`
- Modify: `apps/raven/web/src/components/PlayableItemView/PlayableItemView.tsx`, `apps/raven/web/src/pages/SeasonPage/SeasonPage.tsx`, `apps/raven/web/src/pages/ShowPage/ShowPage.tsx`, `apps/raven/web/src/pages/SagaPage/SagaPage.tsx`, `apps/raven/web/src/pages/SettingsPage/SettingsPage.tsx`
- Test: the four pages' tests, `SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `downloadLinkFor`, `DownloadTarget` (Task 1); `usePlayerPrefs`, `Button` from `@raven/ui`; `ravenPlayer` from `@/lib/ravenPlayer`.
- Produces: `DownloadButton = ({ target }: { target: DownloadTarget }) => JSX | null`: null while `opensInRavenPlayer` is off; else `<Button icon="download" onClick>` reading "Download to raven player", calling `ravenPlayer.open(downloadLinkFor({ origin: window.location.origin, target }))`. Placement per Ruling 14. The Settings hint becomes "Offers raven player for videos this browser cannot play, in the player's settings, and Download to raven player on a title's page. Turn it on only where raven player is installed."

- [ ] **Step 1: Write the failing tests.** `DownloadButton.test.tsx`: nothing while the pref is off; with it on, clicking spies `ravenPlayer.open` with the saga link. Each page's test: the button appears with the pref on, with the right link (movie: `media=<primary.id>`; season and show: `item=<id>`; saga: `saga=<libraryId>:<tmdbId>`). Settings: the new hint text.

- [ ] **Step 2: Run to see them fail**

Run: `bunx nx run @raven/web:test`
Expected: FAIL

- [ ] **Step 3: Implement**, run `bunx nx run @raven/web:test` (its coverage floors must hold), then commit:

```bash
git add apps/raven/web/src
git commit -m "MAE: offer Download to raven player on raven web's title pages"
```

### Task 18: the fixture's media plane and the downloads e2e

**Files:**
- Modify: `apps/raven/desktop/e2e/fixtureServer.ts`
- Create: `apps/raven/desktop/e2e/downloads.e2e.ts`

**Interfaces:**
- Produces in the fixture (Ruling 15): `startFixtureServer({ clips, mode, now, mediaPlane })`; `FIXTURE_ITEMS = { library: 1, show: 10, season: 11, saga: '100' }`; `FixtureRequest.hasTicket`.
- The suite, one `test.describe.serial` per fixture mode, with `withApp`, `openUrl`, `stubTrustPrompt`, `requestFromPage`:
  1. media plane on: a `raven://download` link for `media=1` asks (the dialog's question names `Fixture One`), Download queues it, the file is fetched from `elsewhere` with `hasTicket` and no cookie, the row reads ready with `formatBytes(size)`, and `downloads.json` under `userData` holds one `ready` entry.
  2. media plane off: the same link fetches from the home listener with `hasUnlock` and no `t`.
  3. throttle at a byte, Pause, Resume: the next file request carries a `Range` header.
  4. offline play and the late report: `hang()` the fixture (every request now waits), Play the download from the Downloads page and see `expectPlayingNatively` with the title, press `k` to pause (a save the server cannot hear), then `close()` the fixture and start a new one, which listens on another port, so the server stays unreachable for the app: the download still plays. Then, in a second launch against a fixture at the stored origin (keep the first fixture's port by passing `port` to `startFixtureServer`, a new option that defaults to 0), poll for `PUT /api/media/1/progress` and `POST /api/media/1/plays` to arrive. The app's retry is five minutes, so this launch sets the test hook `RAVEN_DESKTOP_SYNC_RETRY_MS=2000`, read only unpackaged as `RAVEN_DESKTOP_BUDGET_MS` is.
  5. a `item=11` link downloads both episodes, Home's badge shows `2`, then `1`, then none.
  6. Delete removes the row and the entry's folder.
  7. `downloads.json` seeded before launch with a `ready` entry whose `watchedAt` is eleven minutes ago and `autoDelete` true, and a matching file on disk: the folder is gone and the notice "Deleted Fixture One after watching" shows after launch.

- [ ] **Step 1: Add the test hook.** In `src/main/downloads/sync.ts` keep `SYNC_RETRY_MS`; in `main.ts` read `RAVEN_DESKTOP_SYNC_RETRY_MS` only when `!app.isPackaged` (a helper `syncRetryFrom({ isPackaged, env })` beside `budgetWindowFrom` in `budgets.ts`, with a unit test that a packaged app ignores it), and add it to `withoutTestHooks` in `src/build/smokeVerdict.ts` and to the CLAUDE.md test-hook list in Task 19.

- [ ] **Step 2: Extend the fixture and write the suite.** Build first: `bunx nx run @raven/desktop:build`.

- [ ] **Step 3: Run the suite**

Run: `cd apps/raven/desktop && bun run e2e -- downloads.e2e.ts`
Expected: PASS on an Apple Silicon Mac with the CI-built addon under `libs/raven/mpv/resources/darwin-arm64`; elsewhere, report that the suite could not run here and that the `🖥️ Desktop` check runs it.

- [ ] **Step 4: Commit**

```bash
git add apps/raven/desktop/e2e apps/raven/desktop/src/main/budgets.ts apps/raven/desktop/src/main/budgets.test.ts apps/raven/desktop/src/main/main.ts apps/raven/desktop/src/build/smokeVerdict.ts
git commit -m "MAE: prove raven player's downloads end to end against the fixture server"
```

### Task 19: docs

**Files:**
- Modify: `apps/raven/README.md` (a "Downloads" subsection under "raven player (macOS)", after "Servers and handoff"), `apps/raven/CLAUDE.md` (the bridge bullet: thirteen calls, the five names; the test hooks bullet: `RAVEN_DESKTOP_SYNC_RETRY_MS`; the Desktop section: downloads live in `src/main/downloads`, the layout on disk, "a download fetches from the server's media origin with a ticket, or from the stored origin with the cookie when it lists none"), `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (Follow-ups: "Downloads: swap `mediaAccess`'s pick for core's `pickOrigin` once the direct media client stack lands; a folder picker for downloads; grouping rows by show or saga"), `docs/superpowers/specs/2026-10-16-raven-direct-media-design.md` (Client changes: the desktop line gives way to "The desktop's downloads fetch through the media plane; see the downloads spec."), `docs/superpowers/specs/2026-10-17-raven-desktop-downloads-design.md` (Status: shipped as PRs <numbers>; an "Outcomes" section with Rulings 1, 6 and 7 restated, and anything that differed).

- [ ] **Step 1: Write the docs.** README: what Download to raven player does, where the files live, the Downloads page, Delete once watched and its ten minutes, what reaches the server and when, that a ticket or the cookie is used.

- [ ] **Step 2: Verify**

Run: `bunx nx affected -t typecheck lint:ts lint:css format:check test one-command-per-script typescript-only`
Expected: all green; and `grep -rn -P '\x{2013}|\x{2014}' apps/raven/README.md apps/raven/CLAUDE.md docs/superpowers/specs/2026-10-17-raven-desktop-downloads-design.md docs/superpowers/plans/2026-10-17-raven-desktop-downloads.md` prints nothing.

- [ ] **Step 3: Commit and open PR 6**

```bash
git add apps/raven/README.md apps/raven/CLAUDE.md docs/superpowers/specs
git commit -m "MAE: document raven player's downloads"
gh pr create --base offline-delete
```

---

## Self-review notes

- Spec coverage: the link (1, 2); what the viewer sees (8, 12, 16, 17); processes and files (4, 5, 11); state (4); expanding (6, 7); space (5); fetching (9, 10, 11); playing (13, 14); reaching the server (15); auto-delete (16); protocol (7); security (3, 5, 9, 11: ids only, path builders that refuse, no cookie on an origin, no ticket in a log); web (17); testing (every task, 18); order of work (the PR table); docs (19).
- Names used across tasks: `DownloadsStore`, `DownloadEntry`, `DownloadView`, `DownloadAsk`, `Access`, `MediaAccess`, `StreamFetch`, `PartFile`, `SpaceFs`, `QueueFs`, `LocalSidecar`, `videoPathFor`, `sidecarPathFor`, `entryByMedia`, `noteWatched`, `notePending`, `clearPending`, `fromLabelOf`, `notePlaying`, `sidecarsOf`; each is defined in the task its Interfaces block names.
- Review Focus 1 to 5 are pinned by the tests named in them (Tasks 11, 6, 11, 10 and 11, 16).
