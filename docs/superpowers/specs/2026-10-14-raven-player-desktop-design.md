# raven player: the desktop player first, on the way to desktop raven

Status: proposed, not yet reviewed. Decided autonomously from the request ("a standalone desktop for raven player"); open to review in the PR. It builds on `2026-10-12-raven-desktop-design.md` ("the desktop spec" below) and changes only that spec's order of work. Every decision there that this spec does not name still stands. macOS on Apple Silicon ships first.

## Context

The desktop spec designs a desktop raven that scans, matches and plays with no NAS. It reaches native playback only at its step 8, after three large pieces of work: moving all of `@raven/web` into `@raven/ui` (step 3), embedding the server (step 5) and building local mode (step 6). The player holds most of the value and most of the risk (the native video surface), but it is coupled to the least code. So it should ship first.

raven player is that first release: a desktop app that opens a video file, or a title on a raven server, and plays it through embedded libmpv under raven's own React controls. It is not a second product. It is `@raven/desktop` with only its player built, and the desktop spec's library modes join it later in the same app.

Today the web player's way out is the Unplayable screen's "Copy file link", which says to paste the link into VLC or IINA (`apps/raven/web/src/components/Player/Unplayable.tsx`). That loses raven's controls, its progress and its history. It also fails for a locked library, because the unlock cookie stays in the browser. raven player replaces that way out.

### Goals

- **Play anything well.** Every codec, HDR format, audio format and subtitle format the desktop spec's playback goal lists plays through libmpv, with raven's chrome, shortcuts and look.
- **Open files the way a Mac player does.** Open dialog, drag and drop onto the window or the Dock icon, Finder's "Open With", double-click once the user makes raven player the default, Open Recent, and the next video in the folder.
- **Pick up where you left off.** Local files remember where they stopped and which tracks played. Server titles save progress and history to the server, so the web and the app agree.
- **Play server titles from raven web.** "Open in raven player" hands a title to the app, which plays the original file directly, with its own unlock for locked libraries.
- **Never leave the user stuck.** Without libmpv, a local file Chromium can decode plays through the web engine, and a server title opens in the browser.
- **Lay the ground the full desktop app builds on**: `@raven/ui`, `@raven/mpv`, the bridge, the app shell, the release pipeline.

### Non-goals

- Browsing a server's libraries inside the app. That is the desktop spec's step 3 and remote mode (step 9); raven web already browses well.
- An embedded server, scanning, matching or metadata for local files.
- Converting anything. Server titles play the original file only; the transcode for slow links waits for the transcoding spec's mkv container (desktop spec step 9).
- Intel Macs, Windows and Linux. The desktop spec's step 11 and its x64 builds still apply later.
- Playlists beyond "next in folder" and the web's up-next list, picture in picture, casting, streaming URLs that are not raven servers.
- Silent auto-update and any telemetry.

### Who it is for

| Story | What it needs |
| --- | --- |
| A file the browser cannot play (TrueHD, PGS, Dolby Vision) shows Unplayable on raven web; the viewer clicks "Open in raven player" and it plays with every track | `raven://` handoff, a trusted server, direct play through mpv, the server's PIN |
| A viewer double-clicks a downloaded MKV in Finder | file associations, `open-file` on a cold launch |
| A viewer watches half a film, quits, and opens it next week | resume positions and track picks in the local store |
| A viewer works through a season folder | next video in the folder, natural order |
| A viewer on a Mac with a receiver wants Atmos to reach it | "This computer" output settings (desktop spec section 5) |
| libmpv fails to load on a machine | the web engine for local files, the browser for server titles, a clear message |

### What exploration found

- **The player's state is engine agnostic, its effects are not.** `videoReducer` and the `VideoEvent` union in `apps/raven/web/src/components/Player/useVideoState.ts` know nothing of `<video>`, and `Player.tsx` only picks a mode and hands over to `Stage`. Everything else reads or drives the element:
  - `useWatchProgress.ts` saves on the element's `timeupdate`, `pause`, `playing` and `ended`;
  - `useUpNext.ts` listens for `ended`;
  - `usePlayerActions.ts` sets `volume`, `muted`, `playbackRate` and calls `play()` and `pause()` on `videoRef.current`;
  - `Stage.tsx` restores volume on `loadedmetadata` and draws `SubtitleOverlay` from `useSubtitleCues`.

  The split therefore moves those three hooks onto `VideoState` and an actions object, and `VideoState` needs an `ended` flag it lacks today.
- **The Player's import closure is small.** Outside `components/Player` it reaches `components/Button`, `components/Icon`, eleven files in `lib/` (`api`, `canPlay`, `invalidate`, `itemLinks`, `keyboard`, `queries`, `queryClient`, `shortcuts`, `streamSource`, `trackLabels`, `usePlaybackPolicy`) and two stores (`playerPrefs`, and `unlockPrompt` through `queryClient.ts`).
- **Seven files in that closure reach the `api` singleton**, directly or through `lib/queries.ts`: `Stage.tsx` (poster), `useMediaSource.ts` (`fileUrl`, `streamUrl`), `Unplayable.tsx` (poster, file link), `useWatchProgress.ts` (`saveProgress`, `recordPlay`), `useTrackSelection.ts` (`tracksQuery`), `useSubtitleCues.ts` (`subtitlesQuery`) and `lib/usePlaybackPolicy.ts` (`playbackSettingsQuery`). The desktop spec replaces the singleton across 55 importers; the player alone needs only these seven.
- **The track shapes already fit mpv.** `isMediaTracks`, `isAudioTrack` and `isSubtitleTrack` in `libs/raven/core/src/contract.ts` carry an audio `index` that counts like ffmpeg's `0:a:N`, subtitle ids `embedded-N` and `external-N`, and a `supported` flag for picture subtitles. mpv's `track-list` maps onto them, so `SettingsMenu` works unchanged.
- **Player preferences need no change.** `usePlayerPrefs` (`stores/playerPrefs.ts`) persists volume, caption size and the last audio and subtitle languages in `localStorage` under `raven-player`, which an Electron renderer keeps per session.
- **Core already names video files.** `VIDEO_EXTENSIONS`, `isVideoFile` and `titleFromFileName` in `libs/raven/core/src/media.ts` give the file allowlist and a label for a local file.
- **The server calls the player needs are few:** `getMedia` (`GET /api/media/:id`), `getTracks` (`GET /api/media/:id/tracks`), `saveProgress` (`PUT /api/media/:id/progress`), `recordPlay` (`POST /api/media/:id/plays`), `getLock` (`GET /api/lock`), `unlock` (`POST /api/lock/unlock`), `getAdminLock` (`GET /api/admin`) and `unlockAdmin` (`POST /api/admin/unlock`). The PIN sets `raven_unlock` (`apps/raven/server/src/lock/lockService.ts`) and the admin password `raven_admin` (`apps/raven/server/src/admin/adminService.ts`).
- **The guards have one idiom.** Every shape is a guard built from `object`, `oneOf`, `union`, `nullable` and `listOf` in `libs/raven/core/src/schema.ts`, with the type read off it by `Infer`; a discriminated union is a `union` of `object`s whose `type` is a one-value `oneOf` (`isLibraryBackdrop`, `isHomeShelf`). The bridge protocol follows it.
- **Fullscreen is the page's.** `useFullscreen` in `useStageChrome.ts` calls `document.documentElement.requestFullscreen`, which Electron turns into the window's fullscreen.

## Decisions

| Question | Answer |
| --- | --- |
| A new app, or the start of desktop raven? | The start of desktop raven: `apps/raven/desktop` (`@raven/desktop`), product name "raven player" until the library modes ship |
| App identity | Bundle id `io.github.codebend3r.raven`; `userData` pinned to `~/Library/Application Support/raven` from the first build, so the rename to "raven" moves no data |
| What it plays | Local files the user opened, and titles on raven servers the user added |
| How server titles arrive | A `raven://play` link from raven web, a pasted raven link, or Open Recent. No library browsing |
| Video engine | libmpv through `@raven/mpv`, exactly as the desktop spec's section 5 |
| Fallback | The web engine for local files Chromium decodes; server titles open in the browser |
| Platforms | macOS arm64 |
| Renderer origin | `app://raven`, a privileged custom scheme served from the asar, with a memory router |
| How the renderer reaches a server | It does not. The main process makes eight allowlisted API calls in the server's own session, and mpv reads the file directly |
| Windows | One |
| Local state | JSON files in `userData`, written atomically and checked with core's guards on read |
| Updates | Check GitHub Releases and say so; no silent install while builds are ad hoc signed |
| Crashes | Local minidumps and a rotating log; no third party, no telemetry |
| Tests | `bun test` for units, Playwright's Electron support for end to end, the desktop spec's headless libmpv tests |

## Target layout

```
libs/raven/core     + src/player.ts: the player protocol and its guards
libs/raven/ui       NEW, player only for now: components/Player, Button, Icon, UnlockDialog, the player's lib helpers, playerPrefs, styles
libs/raven/mpv      NEW: the N-API addon, the macOS surface and the typed wrapper (desktop spec section 5)
apps/raven/web      renders the Player from @raven/ui; adds "Open in raven player"
apps/raven/desktop  NEW: main, preload and renderer for raven player
```

## 1. The player chrome and its engines

The desktop spec's section 1 ("The player engine") splits the Player into chrome and engine. This spec keeps that split and pins down the types, plus one seam the desktop spec leaves to its later `Platform`: the services the player needs from whoever hosts it.

### Engines

```ts
import type { ApiClient, MediaItem, MediaTracks, PlayerCommand, PlayerEvent, PlayerSource } from '@raven/core'
import type { ReactNode, RefObject } from 'react'
import type { VideoState } from '@/components/Player/useVideoState'

/** What the chrome asks of whichever engine plays. The chrome never touches a <video>. */
export type EngineActions = {
  play: () => void
  pause: () => void
  seek: (time: number) => void
  setVolume: (level: { volume: number; muted: boolean }) => void
  setRate: (rate: number) => void
  setAudio: (index: number | null) => void
  setSubtitle: (id: string | null) => void
  setSubtitleScale: (scale: number) => void
}

/** One engine's side of the stage: what the chrome draws, and what it calls. */
export type EngineHandle = {
  state: VideoState
  duration: number | null
  /** Where playback is between renders, for the progress saves. */
  position: RefObject<number>
  tracks: MediaTracks | null
  actions: EngineActions
  /** The picture: a <video> for html; nothing for native, which draws under the page. */
  surface: ReactNode
  /** mpv draws every subtitle format itself, so SubtitleOverlay stays out. */
  drawsSubtitles: boolean
}

/** The bridge to a native player, as the desktop's preload hands it over. */
export type NativePlayer = {
  send: (command: PlayerCommand) => Promise<void>
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
}

/** What the html engine plays. A local file has no server behind it: no tracks to pick, nothing to convert. */
export type HtmlSource =
  | { kind: 'server'; media: MediaItem; api: ApiClient }
  | { kind: 'file'; url: string }

export type Engine =
  | { kind: 'html'; source: HtmlSource }
  | { kind: 'native'; player: NativePlayer; source: PlayerSource }
```

- **The native variant arrives at P5;** P1 builds the html engine alone behind these types.
- **One component per engine.** `HtmlStage` calls `useHtmlEngine` and `NativeStage` calls `useNativeEngine`; both render the shared `PlayerChrome` with the handle. Choosing a hook by `engine.kind` inside one component would break the rules of hooks when the engine changes, so `Stage` switches on the kind and keys the child by it, with the `never` check in `default`.
- **`useHtmlEngine`** is today's code behind the handle: `useVideoState`, `useVideoEvents`, `useMediaSource` and `streamSource.ts`. For a `file` source it plays the URL directly and reports no tracks.
- **`useNativeEngine`** sends `PlayerCommand`s and folds `PlayerEvent`s into the same `videoReducer` (section 3 has the mapping).
- **`VideoState` gains `ended`**, and `VideoEvent` gains `{ type: 'ended' }`. `played` and `sought` clear it. `useUpNext` and `useWatchProgress` read it instead of the element's `ended` event.
- **`usePlayerActions` calls `EngineActions`**, never `videoRef.current`. Its `act` switch keeps its shape and its `never` check.
- **`useWatchProgress` reads state transitions:** the first `paused: false` with `waiting: false` is "started", a move of 10 s or more saves, a change to paused saves, `ended` saves the duration, and unmounting saves the last position.

### Services

The player stops importing the `api` singleton. A `PlayerServices` context gives it what it needs, and each host provides its own:

```ts
/** Where watch progress goes: the server for its titles, the desktop's own store for a local file. */
export type ProgressSink = {
  /** Frames really played for the first time: the server's history entry. */
  started: () => void
  save: (position: number) => void
  /** The player is closing, with where it stopped. */
  left: (position: number) => void
}

/** What the player shows and links to, apart from the picture. */
export type PlayerTitle = {
  label: string
  duration: number | null
  /** Where to pick up, or 0 to start at the top. */
  resumeAt: number
  backTo: string
  next: { to: string; state: unknown; label: string } | null
}

export type PlayerServices = {
  title: PlayerTitle
  progress: ProgressSink
  /** The poster behind the html engine and Unplayable; null when there is none. */
  posterUrl: string | null
  /** Shown on Unplayable: the web's "Copy file link", the desktop's "Open in browser". */
  escape: { label: string; run: () => void } | null
}
```

- The web's `WatchPage` builds `PlayerServices` from the singleton for now: `api.saveProgress`, `api.recordPlay`, `afterWatching` on leaving, `watchLink` for the next item. The queries the html engine runs (`tracksQuery`, `subtitlesQuery`, `playbackSettingsQuery`) become factories over the `ApiClient` in the `HtmlSource`, keyed by the same `queryKeys` entries so the web's invalidation still reaches them.
- When the desktop spec's step 3 brings `RavenProvider` and `Platform`, `PlayerServices` is built from `useRaven()` instead; nothing in the player changes.

### Why the split happens in place first

The split lands in `@raven/web`, with no visible change, before any file moves. Its diff then reviews as logic, and the move after it reviews as a pure `git mv`, which keeps `git log --follow` working. This is the desktop spec's step 4, moved to the front.

## 2. `@raven/ui`, starting with the player

- **What moves, by `git mv` from `apps/raven/web/src`:**
  - `components/Player/`, `components/Button/`, `components/Icon/`;
  - `lib/canPlay.ts`, `lib/keyboard.ts`, `lib/shortcuts.ts`, `lib/streamSource.ts`, `lib/trackLabels.ts` and their tests;
  - `stores/playerPrefs.ts`;
  - `styles/` (`globals.scss`, `elements.scss`, `designTokens.ts`), since every module the player brings uses the tokens and the desktop renderer needs them too;
  - `managed-media-source.d.ts`, which `streamSource.ts` needs.
- **What stays in web:** `lib/api.ts`, `lib/queries.ts`, `lib/queryClient.ts`, `lib/invalidate.ts`, `lib/itemLinks.ts`, `lib/usePlaybackPolicy.ts` and `stores/unlockPrompt.ts`. They serve the whole library, and the player reaches what it needs of them through `PlayerServices` and its `HtmlSource`.
- **`languageName`** is written twice today (`lib/trackLabels.ts` and `components/ImageEditor/ImageEditor.tsx`). One copy moves to core now, as the desktop spec's section 6 plans, because `trackLabels.ts` moves.
- **`UnlockDialog`** moves at step P6, when the desktop needs it.
- **Build, config and tests** are exactly the desktop spec's section 1 "Exports and build": Vite library mode into `dist/styles.css` and ESM, `build:types`, `build:aliases`, the React stack as peer dependencies, `scope:web`, tests under `bun test` and happy-dom with the SCSS loader in `tooling/web`.
- **Exports for now:** `Player`, `PlayerServicesProvider`, the engine and services types, `UnlockDialog` (from P6) and `@raven/ui/styles.css`.
- **Docs:** the root `CLAUDE.md` CSS section and `apps/raven/CLAUDE.md` point raven's `globals.scss` and `elements.scss` at `libs/raven/ui/src/styles/`, and `@raven/ui` joins the project table. The `/design` page's import of `globals.scss` follows the file.
- The Docker image keeps building `@raven/web`; add `libs/raven/ui` to `apps/raven/Dockerfile.dockerignore`, as the desktop spec says.

## 3. The player protocol in `@raven/core`

The desktop spec's section 6 puts `PlayerCommand` and `PlayerEvent` in `libs/raven/core/src/player.ts`. They change in two ways: `load` names a `PlayerSource` rather than a `mediaId`, because a local file has none; and `tracks` carries `MediaTracks`, so the settings menu reads one shape from either engine.

```ts
import { isMediaTracks } from '@/contract'
import { type Infer, isBoolean, isNumber, isString, listOf, nullable, object, oneOf, union } from '@/schema'

/**
 * What the player opens. The renderer names a server title or a file the
 * main process granted it, never a path or a URL.
 */
export const isPlayerSource = union(
  object({ kind: oneOf(['server']), serverId: isString, mediaId: isNumber }),
  object({ kind: oneOf(['file']), fileId: isString }),
)

export type PlayerSource = Infer<typeof isPlayerSource>

export const isPlayerCommand = union(
  object({
    type: oneOf(['load']),
    source: isPlayerSource,
    start: isNumber,
    audio: nullable(isNumber),
    subtitle: nullable(isString),
  }),
  object({ type: oneOf(['play']) }),
  object({ type: oneOf(['pause']) }),
  object({ type: oneOf(['seek']), time: isNumber }),
  object({ type: oneOf(['audio']), index: nullable(isNumber) }),
  object({ type: oneOf(['subtitle']), id: nullable(isString) }),
  object({ type: oneOf(['volume']), volume: isNumber, muted: isBoolean }),
  object({ type: oneOf(['speed']), rate: isNumber }),
  object({ type: oneOf(['subtitleScale']), scale: isNumber }),
  object({ type: oneOf(['stats']) }),
  object({ type: oneOf(['stop']) }),
)

export type PlayerCommand = Infer<typeof isPlayerCommand>

const isTimeRange = object({ start: isNumber, end: isNumber })

export const isPlayerErrorReason = oneOf(['open', 'decode', 'network', 'locked', 'engine'])

export const isPlayerEvent = union(
  object({ type: oneOf(['time']), time: isNumber }),
  object({ type: oneOf(['buffered']), ranges: listOf(isTimeRange) }),
  object({ type: oneOf(['paused']), paused: isBoolean }),
  object({ type: oneOf(['waiting']), waiting: isBoolean }),
  object({ type: oneOf(['duration']), duration: nullable(isNumber) }),
  object({ type: oneOf(['rate']), rate: isNumber }),
  object({ type: oneOf(['tracks']), tracks: isMediaTracks }),
  object({ type: oneOf(['ended']) }),
  object({ type: oneOf(['error']), reason: isPlayerErrorReason, message: isString }),
)

export type PlayerEvent = Infer<typeof isPlayerEvent>

/** A command on the player's MessagePort, answered by a reply with the same id. */
export const isPlayerRequest = object({ id: isNumber, command: isPlayerCommand })

export const isPlayerReply = union(
  object({ id: isNumber, ok: oneOf([true]) }),
  object({ id: isNumber, ok: oneOf([false]), message: isString }),
)
```

- `stats` toggles mpv's own stats overlay (`script-binding stats/display-stats-toggle`). The diagnostics event the desktop spec lists (the video's live parameters) stays out of the event union: mpv draws the overlay, so nothing needs to cross the bridge for it.
- Guards check shape, not range. The main process clamps where it applies a value: volume to 0 to 1, speed to 0.25 to 4, subtitle scale to 0.5 to 3, seek to the duration.
- Tests in `player.test.ts` accept one valid value per variant and reject each malformed field, as `contract.test.ts` does.

### From mpv to the reducer

| mpv | `PlayerEvent` | `VideoEvent` |
| --- | --- | --- |
| `time-pos`, at most 4 a second | `time` | `moved`, with the last buffered ranges |
| `demuxer-cache-state` `seekable-ranges` | `buffered` | `buffered` |
| `pause` | `paused` | `played` or `paused` |
| `paused-for-cache`, `seeking` | `waiting` | `waiting` or `flowing` |
| `duration` | `duration` | `duration` |
| `speed` | `rate` | `rate` |
| `track-list` | `tracks` | none: it feeds the settings menu |
| `end-file` with reason `eof` | `ended` | `ended` |
| `end-file` with reason `error` | `error` | none: the stage shows Unplayable |

The mapping is a pure function in `@raven/ui` (`fromPlayerEvent`), tested on its own.

### Tracks from mpv

The player service turns mpv's `track-list` into `MediaTracks` with a pure function (`tracksFromMpv`):

- **Audio:** entries of type `audio` in order. `index` is the position among them, so it means what the server's `0:a:N` means and a remembered pick carries between web and desktop. mpv's `aid` is the entry's `id`. `language` goes through core's `languageTag`; `channels` comes from `demux-channel-count`.
- **Subtitles:** entries of type `sub`. Embedded ones are `embedded-N` by position; external ones are `external-N` in the order they were added. `supported` is always true, since mpv draws PGS, VobSub and DVB.
- **`defaultAudio`** is the entry flagged default, else the first; **`frameRate`** is `container-fps`.

## 4. `apps/raven/desktop` (`@raven/desktop`) as raven player

### Layout

```
apps/raven/desktop/
  package.json            deps: @raven/core, @raven/ui, @raven/mpv (workspace:*), electron 44, @electron-forge/*, @electron-forge/plugin-fuses; dev: @playwright/test
  forge.config.ts         Info.plist document types from core's VIDEO_EXTENSIONS, the raven:// scheme, fuses, asar.unpack *.node, signing behind env vars
  vite.config.ts          renderer build, the same shape as web's
  playwright.config.ts    end-to-end tests against `electron .`
  index.html
  tsconfig.json           references tsconfig.main.json (tooling/tsconfig/node.json) and tsconfig.renderer.json (react.json)
  src/shared/             the desktop's own requests and replies, as guards; the play link parser
  src/main/main.ts        single-instance lock, open-file and open-url queues, app:// protocol, window, menus, quit
  src/main/grants.ts      which files the renderer may open, by opaque id
  src/main/stateStore.ts  player-state.json: recents, resume positions, track picks, window bounds
  src/main/servers.ts     desktop-config.json servers, a session per server, the allowlisted API calls
  src/main/player/        the player service: owns @raven/mpv, resolves sources, answers the bridge (desktop spec section 5)
  src/main/updates.ts     the release check
  src/preload/preload.ts  contextBridge.exposeInMainWorld('ravenDesktop', ...): requests, file drops, the player's MessagePort
  src/renderer/main.tsx   PlayerServicesProvider and a memory router: Home, Play, Settings
  src/renderer/HomePage/  open, drop, recents
  src/renderer/PlayPage/  the Player from @raven/ui with the native engine, or html as the fallback
  src/renderer/SettingsPage/  servers, "This computer", updates, recents
```

Scripts follow the desktop spec's section 4 (one command each, all in `nx.includedScripts`), with two changes: there are no hosts to bundle, and the preload is its own build. A sandboxed preload cannot load ESM or workspace packages, so `build:preload` bundles it to one CommonJS file with `bun build --format cjs`, leaving `electron` external. `e2e` runs Playwright and is not part of `verify`, because it needs macOS and libmpv; the macOS CI job runs it (section 8).

### Processes

- **Main:** the window, the menus, the grants, the state store, the servers, and the player service with libmpv. It never blocks: libmpv is async only (desktop spec section 5), file reads are async, and the state store writes off the hot path.
- **Renderer:** one sandboxed window loaded from `app://raven`. It holds no paths, no cookies and no network access beyond its own origin.
- **No utility process** in this slice. The desktop spec's hosts arrive with its steps 5 and 6.

### Opening files

Every way in ends in the same call in the main process, `grant(path)`. It checks that the path is an existing regular file and that `isVideoFile` accepts its name, then returns a random `fileId` and remembers the path for the session. The renderer only ever holds ids.

- **Open dialog** (`dialog.showOpenDialog`, video types only) and **Open Recent** (the native menu, through `app.addRecentDocument`).
- **Drag and drop on the window:** the page hands the dropped `File` to the preload, which calls `webUtils.getPathForFile`. A `File` the page made itself has no path there, so a compromised page cannot name one. Multiple files: the first plays and the rest become the up-next list, in the order dropped.
- **Finder, the Dock icon and file associations:** `open-file` events, listened for in `will-finish-launching` so a cold launch catches them, and queued until the window is ready. Document types come from `VIDEO_EXTENSIONS` by UTI (`public.movie`, `public.mpeg-4`, `com.apple.quicktime-movie`, `public.avi`, `public.mpeg-2-transport-stream`, plus imported declarations for `org.matroska.mkv` and `org.webmproject.webm`), never by bare extension, so `.ts` source files stay with the editor. `LSHandlerRank` is `Alternate`: installing the app takes nothing over until the user picks "Always Open With".
- **Next in folder:** when a local file ends, the next video in its folder by natural order (`Intl.Collator` with `numeric`) plays, and the Next button shows it as soon as playback starts. Folder siblings with video extensions count as granted, as mpv's and IINA's autoload do.
- **Opening while playing** saves the current position first, then replaces the video. There is one window.

### Server titles

- **Servers are added on purpose.** Settings lists them; each has an id, an origin and a name read from the server. Adding one from a link shows a native dialog from the main process ("Add the raven server at https://raven.example.ts.net?"), so the page cannot fake the consent, and nothing is fetched before the user agrees.
- **The play link:** `raven://play?server=<origin>&media=<id>&at=<seconds>&next=<id>,<id>`. A pasted `https://<origin>/watch/<id>` (Open Link, Command L) reads the same way. `readPlayLink` in `src/shared/` parses both into a `PlayRequest` and rejects anything else: an origin that is not http or https or has a path, query or credentials, a media id that is not a positive whole number, a negative `at`, more than 100 `next` ids.
- **One session per server**, `persist:server:<serverId>`, for the same reason as the desktop spec's per-mode sessions: cookies are scoped by host, and one server's unlock must not ride along to another.
- **The allowlist.** The renderer's `ApiClient` is `createApiClient({ fetch: bridgedFetch })`, so the player calls the same typed methods the web does. `bridgedFetch` sends `{ serverId, method, path, body }` to the main process, which runs it with `ses.fetch` only when the method and path match one of the eight calls listed in "What exploration found". Anything else is refused and logged. Replies are JSON and small, so the main process stays quiet.
- **mpv reads the file itself:** `/api/media/:id/file` with the session's `raven_unlock` and `raven_admin` cookies as a `Cookie` header (desktop spec section 5, "Sources"), with the cache forced on. Sidecar subtitles from the server's track list are added with `sub-add` against `/api/media/:id/subtitles/<trackId>`, the same way.
- **Locked libraries:** a `403` on `getMedia` opens `UnlockDialog` for the PIN. While the server's admin lock hides locked libraries the title answers `404`, so the app asks for the admin password first, then the PIN, as the desktop spec's Verification describes for remote mode.
- **Progress and history** go to the server through the same calls the web makes. Quitting waits up to 1 s for saves in flight.
- **Fallback:** without libmpv, a server title opens at `<origin>/watch/<id>` in the default browser.

### Screens

- **Home** is a grid of two regions: an "Open a video" panel (button and drop target) and the recent list. Below `48rem` they stack. Each recent is a `li` holding a button with the title, where it came from (the folder, or the server's name), a `progress` element labelled with the share watched, and a remove button labelled "Remove from recents". Dragging files over the window shows a "Drop to play" overlay sharing the region's named grid area. Recents show no thumbnails in this slice.
- **Play** is the Player with the native engine, or the html engine as the fallback. Back and Escape return Home.
- **Settings** (Command comma) holds the servers (add, rename, remove, which also clears that server's session), "This computer" (the desktop spec's output profile, device and passthrough formats), the update check switch and "Clear recents".
- All of it is SCSS modules on raven's tokens from `@raven/ui`: grids with `gap`, no flex, no margins for spacing, `--focus-ring` on `:focus-visible`, desktop first, working at 320px. Every motion sits in `prefers-reduced-motion: no-preference`.

### Window

- `titleBarStyle: 'hiddenInset'`, so the video fills the window. The traffic lights sit over the player's header; the header pads by a `--titlebar-inset` the desktop renderer sets, and the lights hide and show with the controls (`setWindowButtonVisibility`), as IINA does.
- Window bounds persist; the window opens on the display it closed on, or the main one if that display is gone.
- Fullscreen is the page's request, which Electron makes the window's; the native surface follows the bounds (desktop spec section 5).

### Menus

| Menu | Items |
| --- | --- |
| raven player | About, Settings (Command comma), Check for Updates, Hide, Quit |
| File | Open (Command O), Open Recent with Clear Menu, Open Link (Command L), Close Window (Command W) |
| Playback | Play or Pause, Skip Back, Skip Forward, Next, Video Info. Shown with no accelerators; each sends its `PlayerAction` to the page, and Video Info sends `stats` |
| View | Enter Full Screen (Control Command F) |
| Window, Help | the standard roles; Keyboard Shortcuts, Show Logs, Show Crash Reports, Copy Diagnostics |

Single keys stay with the page, as on the web. A menu accelerator on Space or an arrow would fire before the page sees the key and break the PIN field and the volume slider.

### State that persists

| What | Where | Key | Cap | Written |
| --- | --- | --- | --- | --- |
| Servers | `desktop-config.json` (the desktop spec's file) | server id | 20 | on change |
| "This computer" output settings | `desktop-config.json` | none | none | on change |
| Recents | `player-state.json` | a local path, or a server id and media id | 50, newest first | on open |
| Resume positions, local files | `player-state.json` | path, with size and modified time to notice a replaced file | 1,000, least recently played dropped | every 10 s of play, on pause and on close, debounced 2 s |
| Track picks, local files | `player-state.json` | path | 1,000 | on pick |
| Window bounds | `player-state.json` | none | none | on move or resize, debounced |
| Server cookies | Electron session `persist:server:<serverId>` | | | by Electron |
| Volume, caption size, preferred languages | the renderer's `localStorage`, `usePlayerPrefs` unchanged | | | as on the web |

- Server titles keep their resume position on the server only; track picks for them follow the language preferences, as on the web.
- Each file is read once at launch and checked with guards built from core's combinators. A file that fails the check is kept as `<name>.corrupt-<time>` and the app starts empty, so a bad write never stops it launching.
- Writes go to a temporary file and are renamed over the old one. The last write happens on `before-quit`.
- Resume follows the web's rule in `Stage.tsx`: resume when the position is past 0 and more than 10 s from the end; reaching the end clears it.

### Security

- **Window:** `contextIsolation`, `sandbox` (and `app.enableSandbox()`), no `nodeIntegration`, no `webviewTag`. `will-navigate` refuses anything off `app://raven`; `setWindowOpenHandler` denies every window and sends http and https links to `shell.openExternal`.
- **Content Security Policy,** sent by the `app://` handler: `default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. The `app://` handler resolves paths inside the renderer's folder and refuses any that leave it.
- **Permissions:** every permission request and check is denied except `fullscreen`.
- **IPC:** one `invoke` channel for requests and the player's MessagePort. The main process checks that each message comes from the app's own frame (`senderFrame.url` on `app://raven`) and narrows it with its guard before acting. Replies are narrowed by the renderer at the same boundary, as `createApiClient` narrows API replies.
- **Files:** only granted ids open. The html fallback reads a granted file through a `raven-file://<fileId>` scheme that serves byte ranges and nothing else.
- **mpv:** the desktop spec's hardening (no scripts, no ytdl, no default bindings) plus `load` accepting only a `PlayerSource`; mpv never sees a path or URL the renderer wrote.
- **Fuses**, set in `forge.config.ts`: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- **Test hooks** (mpv with `vo=null` and `ao=null`) are read from the environment only when `app.isPackaged` is false.

### Keyboard and accessibility

- The page keeps every shortcut the web player has (`lib/shortcuts.ts`), and the shortcuts dialog lists them. Home and Settings follow the usual tab order, and arriving on a screen focuses its heading or first control.
- Every control has a label; the bezel's text stays in its `aria-live` region.
- The native video view is not an accessibility element, so VoiceOver reads the page's controls, not an empty view over them.
- `prefers-reduced-motion` follows macOS's Reduce Motion in Chromium; the bezel, the overlay and the chrome's fade respect it.
- Captions under mpv scale with the same caption size preference (`sub-scale`).

## 5. raven web: "Open in raven player"

- **A per-browser setting,** "Open videos in raven player", in the Playback section of Settings, stored with `usePlayerPrefs`. It is off by default: a page cannot tell whether an app is installed, and an unhandled `raven://` link does nothing in Chrome and shows an error in Safari.
- **When it is on:**
  - Unplayable offers "Open in raven player" as its primary action, above "Copy file link".
  - The player's settings menu offers it too, with the current position as `at`, after pausing.
- The link carries `location.origin` as the server and the up-next ids the web already has from Play all.

## 6. Performance budgets

| What | Budget | How it is measured |
| --- | --- | --- |
| Launch to window shown | 800 ms cold, 400 ms warm, on an M1 | Marks from the first line of `main.ts` to `ready-to-show`, written to the log. e2e asserts the median of 5 launches stays under twice the budget on CI |
| Finder "Open With" on a cold launch to first frame | 1.5 s for a local file | `open-file` to mpv's `playback-restart`, in the log |
| First frame, seeks, A/V sync, track switches | The desktop spec's pass criteria | As there |
| Dropped frames, event loop lag | The desktop spec's pass criteria: 0 drops in 10 minutes on an XDR display, lag p99 under 20 ms | `frame-drop-count` and `decoder-frame-drop-count`; `monitorEventLoopDelay` in the main process |
| Renderer JavaScript | 250 KB gzipped | The Vite build report, printed in the macOS CI job |
| Memory, idle on Home | 300 MB across every process | The sum of `app.getAppMetrics()` working sets after 60 s |
| Memory, playing M2 | 700 MB plus mpv's demuxer cache, which is capped (desktop spec section 5) | The same, sampled every 10 s while M2 plays for 10 minutes |
| CPU while paused | under 2% of one core | `app.getAppMetrics()` CPU usage over 60 s |

The page stays quiet while video plays (desktop spec section 5, "The bridge"): while the controls are hidden, nothing on the Play screen repaints.

## 7. Packaging, signing, updates and crash reports

- **Packaging:** Electron Forge makes a dmg and a zip for arm64. libmpv and the addon sit outside the asar, every Mach-O signed (desktop spec section 5, "Bundling libmpv"). No ffmpeg ships: there is no server to run it.
- **Signing:** ad hoc for now, as the desktop spec says. `forge.config.ts` wires Developer ID signing and notarization (`osxSign` and `osxNotarize` with a keychain profile) behind environment variables, off until a certificate exists. The first launch of an ad hoc build needs the "Open Anyway" step in Privacy and Security once; the release notes say how.
- **Updates:** at launch, at most once a day, and from the menu, the app reads the latest release of `codebend3r/maester` from GitHub and compares versions. A newer one shows a quiet notice with a link to its release page. Squirrel.Mac requires a Developer ID signature, so silent updates wait for one; `updates.ts` is shaped so the notice can become an install then. The check can be switched off.
- **Version:** the app takes the workspace's shared version, so `version-bump` covers it and About shows it.
- **Crash reports:** `crashReporter.start({ uploadToServer: false })` keeps minidumps in `crashDumps`. A rotating log (5 files of 1 MB in `logs`) records launches, opens, the bridge's refusals, mpv's warnings and errors, and the budget marks. Help offers Show Logs, Show Crash Reports and Copy Diagnostics (app, Electron, mpv and FFmpeg versions, `hwdec` support, the display's refresh rate and EDR headroom). Nothing leaves the machine unless the user sends it.

## 8. CI and release

- **PR checks:** the Ubuntu matrix picks up `@raven/ui`, `@raven/mpv` and `@raven/desktop` through `run-many`. For that to hold, `@raven/mpv`'s `build` compiles only the TypeScript wrapper; the addon is its own target (`build:native`, cmake-js), and its headless tests are `test:native`. Neither runs on Ubuntu.
- **A macOS job** (`🖥️ Desktop`) joins `pull-request-checks.yml` on an arm64 runner: restore or build libmpv (cached by its pinned sources), `build:native`, `test:native`, the desktop `build`, `e2e`, then `make`, uploading the unsigned app as a workflow artifact for manual testing. It runs on every PR, like every other check.
- **Release:** `.github/workflows/desktop-release.yml` on `v*` tags, as the desktop spec's section 7 describes, arm64 only for now: build, sign ad hoc, attach the dmg, the zip and `SHA256SUMS` to the GitHub release.

## 9. Testing

- **Units (`bun test`):**
  - in `@raven/ui`: the reducer with `ended`, `fromPlayerEvent`, the chrome against a fake engine handle, `useWatchProgress` against scripted state, and the existing `Player.test.tsx` and `playerHooks.test.tsx` passing unchanged after the split;
  - in core: every guard in `player.ts`;
  - in `@raven/desktop`: `readPlayLink`, `tracksFromMpv`, the allowlist, the grants, the state store against a fake file system (corrupt file, cap, debounce), the natural folder order. Main-process modules take Electron's pieces as arguments, so these run without Electron.
- **Headless libmpv (`test:native`):** the desktop spec's tests (load, seek, track switch, stop, a hundred destroys), plus `track-list` on an MKV that ffmpeg generates with two audio tracks, an embedded subtitle and a sidecar.
- **End to end (Playwright `_electron`, macOS job):**
  - launch, open a generated clip through the main process, see the title, play, pause, seek, quit, reopen and see "Resumed at";
  - recents after a relaunch; removing one;
  - the security checks: `require` and `process` are undefined in the page; navigating to another origin is refused; `window.open` is denied; a request off the allowlist is refused; a play link to an unknown server shows the prompt and fetches nothing;
  - the launch budget.
- **Manual matrix,** on an XDR display, an SDR display and headphones (receiver passthrough when one is at hand):
  - M1 to M15 from the desktop spec's table, opened from Finder, by drag and drop, and through a server;
  - a cold "Open With", a double-click once raven player is the default, a drop onto the Dock icon;
  - quitting mid-film, then reopening: the position comes back locally and on the server;
  - sleep and wake mid-film; unplugging the external display mid-film;
  - a locked library, with and without the admin lock;
  - the server going away mid-film: the error says so, and the position saved last stays.

## Risks

| Risk | Mitigation |
| --- | --- |
| An Electron upgrade breaks the native surface (Chromium re-sorting subviews) | Pin Electron's major. Each upgrade is its own PR that runs the surface checklist; the addon logs every re-sort it repairs |
| 120 Hz pacing and EDR are still unmeasured (desktop spec step 2) | Measured on an XDR display before P5 ships. If they fail, P5 ships with `target-colorspace-hint=no` and the gap written into the spec |
| Gatekeeper blocks an ad hoc signed download | The release notes cover "Open Anyway". Developer ID signing and notarization are already wired, off until there is a certificate |
| A web page fires `raven://` links at the app | Only added servers play; an unknown origin needs a native confirmation; links carry ids, not URLs; nothing is fetched before consent |
| A crafted file exploits FFmpeg inside libmpv | Files open only by the user's action; libmpv runs without scripts or ytdl; the pinned libmpv is rebuilt for FFmpeg security releases |
| The split regresses the web player | P1 and P2 ship with no visible change, the Player's tests pass unchanged, and M1 and M2 are checked by hand in Chrome and Safari |
| The main process stalls while playing | Async libmpv only, small JSON on the bridge, lag logged and asserted in e2e |
| Playwright's Electron support is experimental | e2e drives the page and `electronApp.evaluate` only; a break pins Playwright and never blocks the unit tests |
| raven web on Netlify hands off its own origin, so video would come through Netlify's proxy | The prompt names the origin; the README says to add the server's own origin; a server advertising its canonical origin is a follow-up |
| GPL libmpv makes a public build GPL in effect | Distribution is personal, as in the desktop spec; a public release needs the source offer first |
| The slice grows into the full desktop app | The non-goals above, and exit criteria on every step |

## Rollout

1. P1 and P2 merge behind no flag: the web player must look and behave exactly as before, checked on Vhagar after the deploy.
2. P3 to P6 produce an unsigned app on every PR (the macOS job's artifact) for testing by hand.
3. P7 tags the first release with the dmg. The web setting is turned on per browser, by hand, where the app is installed.
4. After a few weeks of use, the remaining desktop spec steps continue in the same app.

Turning the web setting off withdraws the handoff; the app needs nothing from the web to play local files.

## Questions decided without asking

| Question | Answer | Why |
| --- | --- | --- |
| A separate app, or the start of desktop raven? | The start, in `@raven/desktop` | One native stack, one release pipeline, one update channel; data and associations carry over |
| Browse servers inside the app? | No | Browsing is the full `@raven/ui` move, most of the cost; the web already does it |
| How does the renderer reach a server? | Through eight allowlisted calls made by the main process; mpv reads files directly | No local port, no proxy, no CORS, no cookies in the renderer, and a compromised page can do only eight things. The desktop spec's proxy host comes with library browsing |
| Fallback for server titles | The browser | The web player is already that fallback, with every rung of its ladder |
| More than one window? | No | One libmpv surface is what the spike proved; nothing asks for two videos at once |
| Take over double-click on install? | No, `Alternate` rank | Installing a player should not change what Finder does until the user says so |
| Intel Macs? | Later | Halves the libmpv build; the spike and the test matrix are Apple Silicon |
| Convert for slow links? | Later, direct play only | Needs the transcoding spec's mkv container; a home network and Tailscale carry a remux |
| SQLite or JSON? | JSON | A few hundred small records; better-sqlite3 arrives with the embedded server |
| Auto-update? | Notify only | Squirrel.Mac needs a Developer ID signature |
| Telemetry? | None | A self-hosted suite; local logs and Copy Diagnostics cover bug reports |
| Test runner | `bun test`, Playwright for e2e | The same runner as the web; main-process code is written to run without Electron |
| Name | "raven player", with `userData` pinned to `raven` | Says what it does today, and renaming later moves nothing |
| Thumbnails in recents | Not yet | Needs a frame grab through mpv; text rows with progress are enough to start |

## What the full desktop raven inherits

- `@raven/ui` with its build, exports and tokens; the desktop spec's step 3 moves the remaining folders into it, and `PlayerServices` is then built from `useRaven()`.
- The chrome, both engines and the `ended` state: its step 4 is done.
- `@raven/mpv`, the libmpv CI build, the macOS surface, the bridge and "This computer": its steps 7 and 8 are done for arm64.
- The app shell: security baseline, fuses, menus, file associations, `raven://`, logs and crash reports, the update check and the release workflow.
- Still to decide at its step 6: whether the player screens move to the host's origin with the library or keep `app://`. Nothing in the player depends on which.
- One change to that spec's section 6: `PlayerCommand`'s `load` takes a `source` (this spec's section 3), and `tracks` carries `MediaTracks`.

The desktop spec's order of work then reads: steps 1 and 2 (done); this spec's P0 to P7; the rest of step 3; step 5; step 6 (local mode and the chooser, when "raven player" becomes "raven"); step 9 (remote mode with the library and the mkv transcode); step 10 for ffmpeg and x64; steps 11 and 12 unchanged. Steps 4, 7 and 8 are covered here.

## Order of work (one PR each)

Each step is its own PR, stacked on the one before, built by subagents with an implementer and a reviewer per task. Spikes come first and are thrown away; their outcomes are written back into this spec.

0. **P0: spike, thrown away.** In a scratch Electron 44 app, packaged and signed ad hoc:
   - `open-file` from Finder reaches a cold launch, with document types from `extendInfo`;
   - a `raven://` link from Safari and Chrome reaches `open-url`, cold and warm;
   - `webUtils.getPathForFile` in a sandboxed preload returns a dropped file's path, and '' for a `File` the page made;
   - `ses.fetch` in a `persist:server:<id>` session keeps the `raven_unlock` cookie from `/api/lock/unlock` and sends it on the next call (if not, the service keeps the jar through `ses.cookies`);
   - the page loads from `app://raven` with the CSP header, and the player's MessagePort reaches it through the preload;
   - the owed XDR checks from the desktop spec's step 2, if an XDR display is at hand.
1. **P1: split the Player into chrome and engine, in `@raven/web`.** The html engine only, `ended` in `VideoState`, `EngineActions`, and `PlayerServices` in place of the singleton in the seven files. No visible change.
2. **P2: create `@raven/ui` with the player.** `git mv` only, plus `languageName` into core, the build, the Dockerfile allowlist and the docs. No visible change.
3. **P3: `@raven/mpv`.** The addon, the wrapper, the macOS arm64 libmpv build with both patches, `fetch:libmpv`, `build:native`, `test:native` and the macOS CI job (desktop spec step 7, arm64 only).
4. **P4: the protocol and the app.** `player.ts` in core; the `node.json` tsconfig and oxlint presets (desktop spec section 4); `@raven/desktop` with the `app://` renderer, the security baseline and fuses, menus, Home, the grants, open dialog, drop, `open-file` and document types, the state store, the html engine for local files, and the e2e suite. M1 plays through the html engine.
5. **P5: native playback.** `useNativeEngine`, `NativeStage`, the macOS surface, the bridge, `tracksFromMpv`, the title bar behaviour, next in folder, "This computer" and the stats overlay (desktop spec step 8). M1 to M15 play from local disk.
6. **P6: server titles.** Servers in Settings, the play link and the trust prompt, a session per server, the allowlist, `UnlockDialog` moved to `@raven/ui`, progress and history to the server, up next from the link, the browser fallback; the web setting and its two "Open in raven player" actions.
7. **P7: release.** libmpv bundled and signed in the app, `desktop-release.yml` for arm64, the update check, the crash reporter and logs, Copy Diagnostics, and the docs: the root `CLAUDE.md` project table, `apps/raven/CLAUDE.md`, `apps/raven/README.md`, and this spec's outcomes.

## Verification

- **Checks:** `bun run verify` passes for every project, and the git hooks pass on every commit.
- **After P1 and P2:** `bunx nx run @raven/ui:test` and `bunx nx run @raven/web:test` pass; `bun run dev:raven` behaves exactly as before; the Docker smoke test returns a healthy `/api/health` and serves `/`; M1 and M2 play in Chrome and Safari as before.
- **After P3:** `bunx nx run @raven/mpv:test:native` passes on the macOS runner, with no hang across a hundred destroys.
- **After P4 to P7:** `bunx nx run @raven/desktop:e2e` passes on the macOS runner; `bunx nx run @raven/desktop:make` builds an app that:
  - opens M1 to M15 from Finder, by drop and from Open Recent, meeting the desktop spec's pass criteria on each output;
  - meets every budget in section 6;
  - resumes local files after a quit, and leaves the server's position within 10 s of where a server title stopped;
  - plays a title handed over from raven web on Vhagar, including one in a locked library with the admin lock on;
  - with libmpv removed, plays M1 through the web engine and opens a server title in the browser;
  - quits within 1 s while a video plays, leaving no process behind.
- **Security:** each check in section 9's end to end list passes, and a manual attempt to drop a page-made `File` opens nothing.

## Sources

- The desktop spec and its sources: `docs/superpowers/specs/2026-10-12-raven-desktop-design.md`
- The transcoding spec: `docs/superpowers/specs/2026-10-12-raven-transcoding-design.md`
- The web player's design: `docs/superpowers/specs/2026-10-08-raven-player-design.md`
- Electron security checklist: <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron `protocol.handle` and privileged schemes: <https://www.electronjs.org/docs/latest/api/protocol>
- Electron `webUtils.getPathForFile`: <https://www.electronjs.org/docs/latest/api/web-utils>
- Electron `open-file`, `open-url`, `addRecentDocument` and `setAsDefaultProtocolClient`: <https://www.electronjs.org/docs/latest/api/app>
- Electron `net.fetch` and `ses.fetch`: <https://www.electronjs.org/docs/latest/api/net>, <https://www.electronjs.org/docs/latest/api/session>
- Electron MessagePorts: <https://www.electronjs.org/docs/latest/tutorial/message-ports>
- Electron fuses: <https://www.electronjs.org/docs/latest/tutorial/fuses>
- Electron crash reporter: <https://www.electronjs.org/docs/latest/api/crash-reporter>
- Electron auto updates and Squirrel.Mac's signing requirement: <https://www.electronjs.org/docs/latest/api/auto-updater>
- Electron Forge macOS signing and notarization: <https://www.electronforge.io/guides/code-signing/code-signing-macos>
- Electron Forge fuses plugin: <https://www.electronforge.io/config/plugins/fuses>
- Apple document types and imported type declarations: <https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes>, <https://developer.apple.com/documentation/bundleresources/information-property-list/utimportedtypedeclarations>
- Playwright's Electron support: <https://playwright.dev/docs/api/class-electron>
- mpv properties (`track-list`, `demuxer-cache-state`, `end-file`): <https://mpv.io/manual/master/#properties>
