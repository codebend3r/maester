# raven desktop: a player-first Electron app on shared React UI and embedded mpv

Status: phase 1 is built through P7, the first release of raven player for macOS arm64 (`docs/superpowers/plans/2026-10-17-raven-desktop-release.md`); "P7 release outcomes" under "Spike outcomes" records where it narrowed this spec, the budgets measured, and the hardware checks still owed. Phase 2 and 3 are not started. This is the canonical desktop spec, consolidating the original 2026-10-12 desktop design and the 2026-10-14 player-first design. The first release is **raven player on macOS arm64**; library modes and other architectures follow in the same app. The companion server work remains in `2026-10-12-raven-transcoding-design.md`.

The server spike and the macOS half of the native video spike ran on 2026-10-12. "Spike outcomes" records their results, including the XDR checks still owed; a spike passing does not mean the production implementation has shipped.

## Context

The goal is a desktop raven that runs on its own: install it, point it at local folders, and it scans, matches and plays with no NAS and no Docker. It can also connect to an existing raven server such as Vhagar's. Nothing may be written twice:

- the business logic stays in `@raven/core` and `@raven/server`;
- the React UI moves into a new library, `@raven/ui`, that both `@raven/web` and `@raven/desktop` render.

The player holds most of the value and most of the risk (the native video surface), but is coupled to the least code. It ships before the full UI extraction, the embedded server and library modes.

raven player opens a local video file or a title on a raven server through libmpv under raven's own React controls. It is not a second product: it is `@raven/desktop` with only its player built. The product name becomes "raven" when library modes arrive; its bundle id and data directory do not change.

Today the web player's way out is the Unplayable screen's "Copy file link", which says to paste the link into VLC or IINA (`apps/raven/web/src/components/Player/Unplayable.tsx`). That loses raven's controls, progress and history, and fails for a locked library because the unlock cookie stays in the browser. The player-first release replaces that way out.

### Delivery phases and architectures

| Phase | Scope | Targets |
| --- | --- | --- |
| 1: raven player | Local files, server-title handoff, native playback, resume and recents; no embedded server or library browsing | macOS arm64 (Apple Silicon) |
| 2: full desktop raven | Full shared UI, embedded server, local libraries, remote library browsing and slow-link transcoding | macOS arm64, then macOS x64 (Intel) |
| 3: additional platforms | Native surfaces, platform validation, CI and packaging | Windows x64 and Linux x64; Linux initially uses X11 |

Windows arm64 and Linux arm64 are not specified. The initial player release ships neither standalone ffmpeg nor an embedded server. The full desktop release adds them; FFmpeg inside libmpv is present from the first release.

### The playback goal

The desktop app has to be as fast and smooth as the hardware allows, on the newest desktop technology. Concretely:

- **Every widely supported codec plays directly in 4K**: H.264, HEVC (8, 10 and 12-bit), AV1, VP9, VC-1, MPEG-2 and MPEG-4, decoded on the GPU wherever the GPU can.
- **HDR is shown as HDR** on an HDR output (a Mac's EDR display, an HDR TV over HDMI), and tone mapped well on an SDR one. HDR10, HDR10+, HLG and Dolby Vision profiles 5, 7 and 8 all play with correct colour.
- **Audio is never needlessly converted.** TrueHD Atmos and DTS-HD MA bitstream to an AV receiver where the OS allows it; otherwise they decode to multichannel PCM. Stereo and headphones get a proper downmix.
- **Every subtitle format shows**, including PGS, VobSub, DVB and styled ASS.
- **Transcoding is the exception**, used only when a remote link is too slow for the original. The server side makes that transcode fast and HDR aware.

The web player cannot meet this goal: Chromium's `<video>` re-encodes TrueHD, DTS and AC3 to stereo AAC, cannot show picture subtitles, has no Dolby Vision, and needs a transcode for anything outside its short codec list. So the desktop app plays video through **embedded libmpv**, drawn natively under raven's own React controls, and keeps the web player as its fallback.

### First-release goals

- **Play anything well.** Every codec, HDR format, audio format and subtitle format the playback goal above lists plays through libmpv, with raven's chrome, shortcuts and look.
- **Open files the way a Mac player does.** Open dialog, drag and drop onto the window or the Dock icon, Finder's "Open With", double-click once the user makes raven player the default, Open Recent, and the next video in the folder.
- **Pick up where you left off.** Local files remember where they stopped and which tracks played. Server titles save progress and history to the server, so the web and the app agree.
- **Play server titles from raven web.** "Open in raven player" hands a title to the app, which plays the original file directly, with its own unlock for locked libraries.
- **Never leave the user stuck.** Without libmpv, a local file Chromium can decode plays through the web engine, and a server title opens in the browser.
- **Lay the ground the full desktop app builds on**: `@raven/ui`, `@raven/mpv`, the bridge, the app shell, the release pipeline.

### First-release non-goals

- Browsing server libraries inside the app. raven web already browses well; desktop browsing arrives in phase 2.
- An embedded server, scanning, matching or metadata for local files.
- Converting anything. Server titles play the original file only; slow-link transcoding arrives with phase 2 and the companion spec's mkv container.
- Intel Macs, Windows and Linux; their builds follow the arm64 player release.
- Playlists beyond "next in folder" and the web's up-next list, picture in picture, casting, or streaming URLs that are not raven servers.
- Silent auto-update and any telemetry.

### Who the first release is for

| Story | What it needs |
| --- | --- |
| A file the browser cannot play (TrueHD, PGS, Dolby Vision) shows Unplayable on raven web; the viewer clicks "Open in raven player" and it plays with every track | `raven://` handoff, a trusted server, direct play through mpv, the server's PIN |
| A viewer double-clicks a downloaded MKV in Finder | file associations, `open-file` on a cold launch |
| A viewer watches half a film, quits, and opens it next week | resume positions and track picks in the local store |
| A viewer works through a season folder | next video in the folder, natural order |
| A viewer on a Mac with a receiver wants Atmos to reach it | "This computer" output settings (section 5) |
| libmpv fails to load on a machine | the web engine for local files, the browser for server titles, a clear message |

## Decisions

| Question | Answer |
| --- | --- |
| Video engine | libmpv (`vo=gpu-next`, libplacebo), embedded under the React controls; the web player is the fallback |
| Platforms | macOS arm64 for the player first; macOS x64 with full desktop. Windows x64 and Linux x64 later, once their half of the video spike passes |
| Where libmpv runs | Electron's main process, behind a small N-API addon, `@raven/mpv` |
| macOS surface | One window: an NSView with a `CAMetalLayer` at the bottom of the window's content view, under the page, through libmpv's moltenvk context patch. Proven by the spike |
| Windows surface (later) | One window with mpv's child window under Chromium's (W1), or an overlay controls window (W3) if the spike rules W1 out |
| Linux surface (later) | W3 under X11 (`--ozone-platform=x11`) |
| Where libmpv comes from | macOS: our own CI build with the moltenvk patch and our resize patch. Later, Windows: shinchiro's builds; Linux: the system's libmpv 0.40 or newer |
| Where ffmpeg comes from | jellyfin-ffmpeg portable builds, for the embedded server |

### Player-first application decisions

| Question | Answer |
| --- | --- |
| A new app, or the start of desktop raven? | The start of desktop raven: `apps/raven/desktop` (`@raven/desktop`), product name "raven player" until the library modes ship |
| App identity | Bundle id `io.github.codebend3r.raven`; `userData` pinned to `~/Library/Application Support/raven` from the first build, so the rename to "raven" moves no data |
| What it plays | Local files the user opened, and titles on raven servers the user added |
| How server titles arrive | A `raven://play` link from raven web, a pasted raven link, or Open Recent. No library browsing |
| Fallback | The web engine for local files Chromium decodes; server titles open in the browser |
| Renderer origin | `app://raven`, a privileged custom scheme served from the asar, with a memory router |
| How the renderer reaches a server | It does not. The main process makes eight allowlisted API calls in the server's own session, and mpv reads the file directly |
| Window count | One |
| Local state | JSON files in `userData`, written atomically and checked with core's guards on read |
| Updates | Check GitHub Releases and say so; no silent install while builds are ad hoc signed |
| Crashes | Local minidumps and a rotating log; no third party, no telemetry |
| Tests | `bun test` for units, Playwright's Electron support for end to end, headless libmpv tests (section 9) |

## What exploration found

These are the design-time findings, before production desktop implementation.

- **`@raven/core` was built for a second client.** `createApiClient({ baseUrl, fetch })` takes an injected fetch and origin (`libs/raven/core/src/apiClient.ts:145`). The direct-play check takes a pluggable `CanPlay` (`playback.ts`). It uses no DOM or Node APIs.
- **The server is already embeddable.** `createApp({ config })` in `apps/raven/server/src/app.ts` returns an app that is not listening yet, and `main.ts` is three lines. `readListenConfig` accepts `PORT=0` and any `HOST`, `DATA_DIR` and `WEB_DIR` (`libs/shared/server/src/env.ts`).
- **The server serves the web build on its own origin** (`serveWebApp`). That is why `/api`, the PIN cookie (`SameSite=Strict; Path=/api`), SSE and MSE streaming need no CORS today.
- **`@raven/web` is almost all reusable UI.** 45 component folders, 15 pages, the Player hooks, and the TanStack Query layer (`lib/queries.ts`, `queryClient.ts`, `invalidate.ts`). It also has 4 zustand stores, the MSE engine (`lib/streamSource.ts`) and the styles. Only `main.tsx` (fonts, `QueryClientProvider`, `BrowserRouter`) and `index.html` are specific to the web app.
- **The one seam is the API client.** `lib/api.ts` builds a same-origin `api` singleton, and 55 files import it.
- **The player is its own full-page route,** `watch/:id`, outside `AppShell` (`AppRoutes.tsx:41`), so a native video surface can fill the window while it shows.
- **Nothing depends on rookery**, so a standalone build loses nothing by leaving it out.
- **At the initial exploration there was no production desktop app**, Electron or Tauri integration, or CI publishing desktop binaries. The completed throwaway spikes are recorded below.

### Player-specific findings

- **The player's state is engine agnostic, its effects are not.** `videoReducer` and the `VideoEvent` union in `apps/raven/web/src/components/Player/useVideoState.ts` know nothing of `<video>`, and `Player.tsx` only picks a mode and hands over to `Stage`. Everything else reads or drives the element:
  - `useWatchProgress.ts` saves on the element's `timeupdate`, `pause`, `playing` and `ended`;
  - `useUpNext.ts` listens for `ended`;
  - `usePlayerActions.ts` sets `volume`, `muted`, `playbackRate` and calls `play()` and `pause()` on `videoRef.current`;
  - `Stage.tsx` restores volume on `loadedmetadata` and draws `SubtitleOverlay` from `useSubtitleCues`.

  The split therefore moves those three hooks onto `VideoState` and an actions object, and `VideoState` needs an `ended` flag it lacks today.
- **The Player's import closure is small.** Outside `components/Player` it reaches `components/Button`, `components/Icon`, eleven files in `lib/` (`api`, `canPlay`, `invalidate`, `itemLinks`, `keyboard`, `queries`, `queryClient`, `shortcuts`, `streamSource`, `trackLabels`, `usePlaybackPolicy`) and two stores (`playerPrefs`, and `unlockPrompt` through `queryClient.ts`).
- **Seven files in that closure reach the `api` singleton**, directly or through `lib/queries.ts`: `Stage.tsx` (poster), `useMediaSource.ts` (`fileUrl`, `streamUrl`), `Unplayable.tsx` (poster, file link), `useWatchProgress.ts` (`saveProgress`, `recordPlay`), `useTrackSelection.ts` (`tracksQuery`), `useSubtitleCues.ts` (`subtitlesQuery`) and `lib/usePlaybackPolicy.ts` (`playbackSettingsQuery`). The full UI extraction replaces the singleton across 55 importers; the player alone needs only these seven.
- **The track shapes already fit mpv.** `isMediaTracks`, `isAudioTrack` and `isSubtitleTrack` in `libs/raven/core/src/contract.ts` carry an audio `index` that counts like ffmpeg's `0:a:N`, subtitle ids `embedded-N` and `external-N`, and a `supported` flag for picture subtitles. mpv's `track-list` maps onto them, so `SettingsMenu` works unchanged.
- **Player preferences need no change.** `usePlayerPrefs` (`stores/playerPrefs.ts`) persists volume, caption size and the last audio and subtitle languages in `localStorage` under `raven-player`, which an Electron renderer keeps per session.
- **Core already names video files.** `VIDEO_EXTENSIONS`, `isVideoFile` and `titleFromFileName` in `libs/raven/core/src/media.ts` give the file allowlist and a label for a local file.
- **The server calls the player needs are few:** `getMedia` (`GET /api/media/:id`), `getTracks` (`GET /api/media/:id/tracks`), `saveProgress` (`PUT /api/media/:id/progress`), `recordPlay` (`POST /api/media/:id/plays`), `getLock` (`GET /api/lock`), `unlock` (`POST /api/lock/unlock`), `getAdminLock` (`GET /api/admin`) and `unlockAdmin` (`POST /api/admin/unlock`). The PIN sets `raven_unlock` (`apps/raven/server/src/lock/lockService.ts`) and the admin password `raven_admin` (`apps/raven/server/src/admin/adminService.ts`).
- **The guards have one idiom.** Every shape is a guard built from `object`, `oneOf`, `union`, `nullable` and `listOf` in `libs/raven/core/src/schema.ts`, with the type read off it by `Infer`; a discriminated union is a `union` of `object`s whose `type` is a one-value `oneOf` (`isLibraryBackdrop`, `isHomeShelf`). The bridge protocol follows it.
- **Fullscreen is the page's.** `useFullscreen` in `useStageChrome.ts` calls `document.documentElement.requestFullscreen`, which Electron turns into the window's fullscreen.

## Target layout

```
libs/raven/core     @raven/core     unchanged role, plus the player protocol the desktop bridge carries
libs/raven/ui       @raven/ui       NEW: every component, page, hook, store, the query layer, styles and tokens
libs/raven/mpv      @raven/mpv      NEW: N-API addon over libmpv, with its native video surfaces and a typed wrapper
apps/raven/web      @raven/web      thin: index.html, main.tsx, vite.config.ts, browser Platform
apps/raven/desktop  @raven/desktop  NEW: Electron main + preload + a thin renderer like web's, desktop Platform
apps/raven/server   @raven/server   unchanged, plus a `startServer` export the desktop app embeds
```

`@raven/ui` is raven's own library, not a suite-wide one. rookery has different tokens (`--color-parchment` against raven's `--color-bark`) and shares no components.

The first release creates only the player portion of `@raven/ui` and leaves the server unchanged. The remaining UI folders and `startServer` arrive in phase 2.

## 1. `libs/raven/ui` (`@raven/ui`)

### Player extraction (P2)

- **What moves, by `git mv` from `apps/raven/web/src`:**
  - `components/Player/`, `components/Button/`, `components/Icon/`;
  - `lib/canPlay.ts`, `lib/keyboard.ts`, `lib/shortcuts.ts`, `lib/streamSource.ts`, `lib/trackLabels.ts` and their tests;
  - `stores/playerPrefs.ts`;
  - `styles/` (`globals.scss`, `elements.scss`, `designTokens.ts`), since every module the player brings uses the tokens and the desktop renderer needs them too;
  - `managed-media-source.d.ts`, which `streamSource.ts` needs.
- **What stays in web:** `lib/api.ts`, `lib/queries.ts`, `lib/queryClient.ts`, `lib/invalidate.ts`, `lib/itemLinks.ts`, `lib/usePlaybackPolicy.ts` and `stores/unlockPrompt.ts`. They serve the whole library, and the player reaches what it needs of them through `PlayerServices` and its `HtmlSource`.
- **`languageName`** is written twice today (`lib/trackLabels.ts` and `components/ImageEditor/ImageEditor.tsx`). One copy moves to core at P2 because `trackLabels.ts` moves (section 6).
- **`UnlockDialog`** moves at step P6, when the desktop needs it.
- **Build, config and tests** follow "Exports and build" below from the first extraction.
- **Exports for now:** `Player`, `PlayerServicesProvider`, the engine and services types, `UnlockDialog` (from P6) and `@raven/ui/styles.css`.
- **Docs:** the root `CLAUDE.md` CSS section and `apps/raven/CLAUDE.md` point raven's `globals.scss` and `elements.scss` at `libs/raven/ui/src/styles/`, and `@raven/ui` joins the project table. The `/design` page's import of `globals.scss` follows the file.
- The Docker image keeps building `@raven/web`; add `libs/raven/ui` to `apps/raven/Dockerfile.dockerignore`.

#### P2 extraction adjustments

The P1 closure also includes `lib/playerQueries.ts`. It moves with its tests, while the web query client reuses the three `playerQueryKeys` definitions exported by UI so cache identity and invalidation stay unchanged. `lib/tokens.ts` and its tests move because the shared `designTokens.ts` depends on them. The `/design` page itself stays in web until D1, importing `@raven/ui/designTokens`.

The built package exports the shared Button/Icon primitives, Controls (for the existing design page), player preferences, keyboard helpers, token helpers, `playerQueriesFor` and `playerQueryKeys` where the remaining web UI needs them. Two narrowly scoped built module entries, `@raven/ui/canPlay` and `@raven/ui/designTokens`, retain the host tests' module boundaries. Vite emits one capability implementation, imported by the player and exposed through the public subpath, not a source alias or injected test-only production API.

Player tests are split by ownership. Engine, chrome, track, subtitle, navigation and shortcut scenarios move into UI, with a local PlayerServices fixture and query/router harness. Clipboard, server progress/history and browser host integration stay in web's `WatchPlayer.test.tsx`; it also verifies that mocking the public capability module affects the built player. Both test targets retain the 96% line and 88% function floors and count their own source, not library dist. UI adds source-named timeline, video state, fullscreen and shortcut tests. Core's single `languageName` accepts an optional fallback spelling so track labels and ImageEditor retain their existing invalid-tag behavior.

### Remaining extraction (D1)

After the player release, use `git mv` for the remaining files from `apps/raven/web/src` so history follows the files: `components/`, `pages/`, `stores/`, `styles/`, `lib/`, `AppRoutes.tsx`, `managed-media-source.d.ts` and `test/`. Make the move its own PR with no behavior change.

### Player engines and chrome

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
  /** Restores keyboard focus without exposing the picture's DOM to chrome; safe without a surface. */
  focusSurface: () => void
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
- **`useNativeEngine`** sends `PlayerCommand`s and folds `PlayerEvent`s into the same `videoReducer` (section 6 has the mapping).
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
  /** Optional host-owned action feedback, including clipboard success or failure. */
  escapeFeedback?: string | null
}
```

- P1 also preserves the browser's Start over focus through `EngineHandle.focusSurface` and its clipboard feedback through optional `PlayerServices.escapeFeedback`. The HTML engine safely ignores focus when its surface is unavailable; the host owns clipboard APIs and feedback text.
- The web's `WatchPage` builds `PlayerServices` from the singleton for now: `api.saveProgress`, `api.recordPlay`, `afterWatching` on leaving, `watchLink` for the next item. The queries the html engine runs (`tracksQuery`, `subtitlesQuery`, `playbackSettingsQuery`) become factories over the `ApiClient` in the `HtmlSource`, keyed by the same `queryKeys` entries so the web's invalidation still reaches them.
- When D1 brings `RavenProvider` and `Platform`, `PlayerServices` is built from `useRaven()` instead; nothing in the player changes.

### Why the split happens in place first

The split lands in `@raven/web`, with no visible change, before any file moves. Its diff then reviews as logic, and the move after it reviews as a pure `git mv`, which keeps `git log --follow` working. This is P1, before the player extraction at P2.

### The platform seam (phase 2)

Add `src/platform/platform.ts`:

```ts
export type Platform =
  | { kind: 'browser'; api: ApiClient }
  | { kind: 'desktop'; api: ApiClient; desktop: DesktopActions; player: NativePlayer | null }

export type DesktopActions = {
  switchServer: () => Promise<void>
  readOutput: () => Promise<OutputSettings>
  writeOutput: (input: { output: OutputSettings }) => Promise<void>
}
```

`PlayerCommand`, `PlayerEvent` and `OutputSettings` live in `@raven/core` (section 6), because the desktop's main process checks them too and core is the one place both can import.

- Add `RavenProvider({ platform, children })`. It creates the query client (`createQueryClient`, which moves in from web) and puts `{ platform, queries }` in context.
- Add `useRaven()`, which returns that context.
- `player` is `null` when libmpv failed to load or its surface could not be made. Full library modes use the web engine; the standalone player uses the first-release fallback in section 4.
- Desktop-only affordances read `platform.kind === 'desktop'` and use `&&` in JSX. The full desktop adds "Switch server" and retains the player's "This computer":
  - **"Switch server"** in the Settings page.
  - **"This computer"** in the Settings page's Playback section: the audio output profile, the output device and the passthrough formats (section 5). They are kept per machine in the desktop config, not in the server's settings.
- The earlier "Open in system player" action is gone: mpv plays everything a system player would.

### Replacing the `api` singleton

- `lib/api.ts` goes away. The app now builds the client and passes it in through `Platform`.
- `lib/queries.ts` becomes `queriesFor(api)`, built once by `RavenProvider`.
- These files take the API from `useRaven()` instead of the import:
  - `lib/useMediaMutations.ts`, `lib/useServerEvents.ts` (`api.eventsUrl()`) and `lib/streamSource.ts` callers
  - `invalidate.ts`, wherever it touches the client
  - the 55 importers, which take `api` or `queries` from `useRaven()`

  This is mechanical churn but has to happen. It is the only way two apps can point the same UI at different origins without a mutable global.

`NativePlayer` is the engine contract above. `PlayerServices` is built from `useRaven()` without changing the player. `Stage` selects native playback when the platform has a player, otherwise html. In library modes `planPlayback` receives `canPlay: () => true` for native playback: the ladder is direct play, then the remote transcode when direct play fails at runtime. The native page and `--color-stage` are transparent on the watch route; mpv draws subtitles and switches tracks in place without remuxing or restarting.


### Exports and build

- **Full desktop exports** (the player-only exports above ship first):
  - `RavenProvider`, `ravenRoutes`, the `Platform` types and `isDesktopActions` (a guard)
  - the UI building blocks the desktop renderer uses for its own screens: `AppShell`, the dialog and button primitives, and `UnlockDialog`
  - `@raven/ui/styles.css`
- `ravenRoutes` is the `<Route>` tree from today's `AppRoutes.tsx`, exported as route objects. Each app then makes its own router and can add routes.
- **Buildable, like core**, so consumers read `dist`. This keeps the repo's `@/` rule intact, because each project's alias only resolves inside its own build.
  - `build`:
    - `build:clean`
    - `build:bundle`: `vite build` in library mode. It compiles the SCSS modules into `dist/styles.css` and the TSX into ESM, with react, react-dom, react-router-dom, @tanstack/react-query, zustand and @raven/core left external.
    - `build:types`: `tsc -p tsconfig.build.json --emitDeclarationOnly`
    - `build:aliases`: `tsc-alias`
  - `dev`: `vite build --watch`, so `bun run dev:raven` rebuilds the library while the web app's Vite reloads.
- **Config files:**
  - `package.json` names `@raven/ui`, lists the React stack as peer dependencies and `@raven/core` as `workspace:*`, carries `nx.includedScripts`, and has the tag `scope:web`.
  - `tsconfig.json` extends `tooling/tsconfig/react.json` and includes `../../../tooling/web`.
  - `.oxlintrc.json` extends `tooling/oxlint/react.json` and exempts `vite.config.ts` from the named-exports rule.
  - `.stylelintrc` extends `tooling/stylelint/rules.json`. `.oxfmtrc.json` is identical to the others.
- **Tests move with their files.** They keep running with `bun test` and happy-dom, using the SCSS loader in `tooling/web`. Player-only tests use `PlayerServicesProvider` and a fake engine handle. At D1, the shared `test/` render helper wraps in `RavenProvider` with a fake browser platform; the native engine's tests use a fake `NativePlayer`.
- **Tokens:** `globals.scss`, `elements.scss` and `designTokens.ts` move to `libs/raven/ui/src/styles/`. The `/design` page moves with them.

## 2. `@raven/web`: shared player first, thin shell later

### First release: "Open in raven player"

- **A per-browser setting,** "Open videos in raven player", in the Playback section of Settings, stored with `usePlayerPrefs`. It is off by default: a page cannot tell whether an app is installed, and an unhandled `raven://` link does nothing in Chrome and shows an error in Safari.
- **When it is on:**
  - Unplayable offers "Open in raven player" as its primary action, above "Copy file link".
  - The player's settings menu offers it too, with the current position as `at`, after pausing.
- The link carries `location.origin` as the server and the up-next ids the web already has from Play all.

### Phase 2: thin shell

What stays in `apps/raven/web`: `index.html`, `vite.config.ts` (with the `/api` proxy) and `src/main.tsx`. `main.tsx` does the following:

- imports the fonts and `@raven/ui/styles.css`;
- builds `createApiClient({ fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === 'PUT' }) })`, the logic moved from today's `lib/api.ts`;
- renders `<RavenProvider platform={{ kind: 'browser', api }}>` around `createBrowserRouter(ravenRoutes)`.

The Docker image keeps building `@raven/web`, and Nx's `^build` builds `@raven/ui` first. Add `libs/raven/ui` to the allowlist in `apps/raven/Dockerfile.dockerignore`. The GHCR publish check reads the same allowlist, so library changes republish the image.

## 3. `@raven/server`: one embeddable entry (phase 2)

- Add `src/startServer.ts`, which exports `startServer({ env }): Promise<{ url: string; close: () => Promise<void> }>`. It runs `sizeThreadpool`, `readServerConfig(env)`, `createApp`, then `listen`.
- `close` drops open connections before it closes the app: `getHttpServer().closeAllConnections()`, or the Fastify adapter created with `forceCloseConnections: true`. Nest's `app.close()` otherwise waits on a stream's connection, which Chromium keeps open after its window is gone; the spike's quit stalled 5 s mid-stream and the host was killed. With it, the host closes in under 15 ms.
- Reduce `main.ts` to `await startServer({ env: process.env })`.
- In `apps/raven/server/package.json`, add `"exports": { "./start": { "types": "./dist/startServer.d.ts", "default": "./dist/startServer.js" } }`.
- Docker's `node dist/main.js` is unchanged. No module moves, and Nest stays, because Electron runs Node.

## 4. `apps/raven/desktop` (`@raven/desktop`)

### Why Electron over Tauri

- **Node is built in.** The server is Node: NestJS, better-sqlite3, and child processes for ffmpeg. Electron runs it in a `utilityProcess`. Tauri has no Node and would need a Node sidecar binary.
- **The UI renders in one engine everywhere.** Electron is Chromium on every OS, the engine the web app is already built and tested against. Tauri means WKWebView on macOS and WebKitGTK on Linux.
- **Video does not depend on either.** libmpv draws it natively (section 5), so Chromium's codec list no longer limits the desktop. Chromium's `<video>` and MSE remain only as the fallback engine, where `checkDirectPlay` and `planPlayback` still pick direct, remux or transcode on their own.
- **Config stays TypeScript.** Electron Forge reads `forge.config.ts`, so the TypeScript-only rule holds.

### First-release layout

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
  src/main/player/        the player service: owns @raven/mpv, resolves sources, answers the bridge (section 5)
  src/main/updates.ts     the release check
  src/preload/preload.ts  contextBridge.exposeInMainWorld('ravenDesktop', ...): requests, file drops, the player's MessagePort
  src/renderer/main.tsx   PlayerServicesProvider and a memory router: Home, Play, Settings
  src/renderer/HomePage/  open, drop, recents
  src/renderer/PlayPage/  the Player from @raven/ui with the native engine, or html as the fallback
  src/renderer/SettingsPage/  servers, "This computer", updates, recents
```

Scripts follow "Build and bundling" below: one command each, all in `nx.includedScripts`. The first release has no hosts to bundle. A sandboxed preload cannot load ESM or workspace packages, so `build:preload` bundles it to one CommonJS file with `bun build --format cjs`, leaving `electron` external. `e2e` runs Playwright and is not part of `verify`, because it needs macOS and libmpv; the macOS CI job runs it (section 7).

### Processes

- **Main:** the window, the menus, the grants, the state store, the servers, and the player service with libmpv. It never blocks: libmpv is async only (section 5), file reads are async, and the state store writes off the hot path.
- **Renderer:** one sandboxed window loaded from `app://raven`. It holds no paths, no cookies and no network access beyond its own origin.
- **No utility process** in this slice. The library hosts arrive at D2 and D3.

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
- **One session per server**, `persist:server:<serverId>`, for the same reason as the per-mode library sessions below: cookies are scoped by host, and one server's unlock must not ride along to another.
- **The allowlist.** The renderer's `ApiClient` is `createApiClient({ fetch: bridgedFetch })`, so the player calls the same typed methods the web does. `bridgedFetch` sends `{ serverId, method, path, body }` to the main process, which runs it with `ses.fetch` only when the method and path match one of the eight calls listed in "What exploration found". Anything else is refused and logged. Replies are JSON and small, so the main process stays quiet.
- **mpv reads the file itself:** `/api/media/:id/file` with the session's `raven_unlock` and `raven_admin` cookies as a `Cookie` header (section 5, "Sources"), with the cache forced on. Sidecar subtitles from the server's track list are added with `sub-add` against `/api/media/:id/subtitles/<trackId>`, the same way.
- **Locked libraries:** a `423 Locked` on `getMedia` opens `UnlockDialog` for the PIN. While the server's admin lock hides locked libraries the title answers `404`, so the app asks for the admin password first, then the PIN, as Verification describes for remote mode.
- **Progress and history** go to the server through the same calls the web makes. Quitting waits up to 1 s for saves in flight.
- **Fallback:** without libmpv, a server title opens at `<origin>/watch/<id>` in the default browser.

### Screens

- **Home** is a grid of two regions: an "Open a video" panel (button and drop target) and the recent list. Below `48rem` they stack. Each recent is a `li` holding a button with the title, where it came from (the folder, or the server's name), a `progress` element labelled with the share watched, and a remove button labelled "Remove from recents". Dragging files over the window shows a "Drop to play" overlay sharing the region's named grid area. Recents show no thumbnails in this slice.
- **Play** is the Player with the native engine, or the html engine as the fallback. Back and Escape return Home.
- **Settings** (Command comma) holds the servers (add, rename, remove, which also clears that server's session), "This computer" (the output profile in section 5, device and passthrough formats), the update check switch and "Clear recents".
- All of it is SCSS modules on raven's tokens from `@raven/ui`: grids with `gap`, no flex, no margins for spacing, `--focus-ring` on `:focus-visible`, desktop first, working at 320px. Every motion sits in `prefers-reduced-motion: no-preference`.

### Window

- `titleBarStyle: 'hiddenInset'`, so the video fills the window. The traffic lights sit over the player's header; the header pads by a `--titlebar-inset` the desktop renderer sets, and the lights hide and show with the controls (`setWindowButtonVisibility`), as IINA does.
- Window bounds persist; the window opens on the display it closed on, or the main one if that display is gone.
- Fullscreen is the page's request, which Electron makes the window's; the native surface follows the bounds (section 5).

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
| Servers | `desktop-config.json` | server id | 20 | on change |
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
- Resume follows the web's rule in `Stage.tsx`: resume when the position is past 0 and more than 10 s from the end; reaching the end clears it. Server titles clear their spot at the library's **Watched at** (95% by default), the same point at which a play counts as watched.

### Security

- **Window:** `contextIsolation`, `sandbox` (and `app.enableSandbox()`), no `nodeIntegration`, no `webviewTag`. `will-navigate` refuses anything off `app://raven`; `setWindowOpenHandler` denies every window and sends http and https links to `shell.openExternal`.
- **Content Security Policy,** sent by the `app://` handler: `default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. The `app://` handler resolves paths inside the renderer's folder and refuses any that leave it.
- **Permissions:** every permission request and check is denied except `fullscreen`.
- **IPC:** one `invoke` channel for requests and the player's MessagePort. The main process checks that each message comes from the app's own frame (`senderFrame.url` on `app://raven`) and narrows it with its guard before acting. Replies are narrowed by the renderer at the same boundary, as `createApiClient` narrows API replies.
- **Files:** only granted ids open. The html fallback reads a granted file through a `raven-file://<fileId>` scheme that serves byte ranges and nothing else.
- **mpv:** section 5's hardening (no scripts, no ytdl, no default bindings) plus `load` accepting only a `PlayerSource`; mpv never sees a path or URL the renderer wrote.
- **Fuses**, set in `forge.config.ts`: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- **Test hooks** (mpv with `vo=null` and `ao=null`) are read from the environment only when `app.isPackaged` is false.

### Keyboard and accessibility

- The page keeps every shortcut the web player has (`lib/shortcuts.ts`), and the shortcuts dialog lists them. Home and Settings follow the usual tab order, and arriving on a screen focuses its heading or first control.
- Every control has a label; the bezel's text stays in its `aria-live` region.
- The native video view is not an accessibility element, so VoiceOver reads the page's controls, not an empty view over them.
- `prefers-reduced-motion` follows macOS's Reduce Motion in Chromium; the bezel, the overlay and the chrome's fade respect it.
- Captions under mpv scale with the same caption size preference (`sub-scale`).

### Phase 2: library hosts and layout

```
apps/raven/desktop/
  package.json            deps: @raven/ui, @raven/core, @raven/mpv, @raven/server (workspace:*), electron, @electron-forge/*, fastify, @fastify/static, @fastify/http-proxy
  forge.config.ts         extraResource: renderer dist, bundled hosts, ffmpeg, libmpv; asar.unpack every *.node
  vite.config.ts          renderer build, same shape as web's
  index.html
  tsconfig.json           references tsconfig.main.json (tooling/tsconfig/node.json) and tsconfig.renderer.json (react.json)
  src/main/main.ts        single-instance lock, read config, start the host, BrowserWindow, quit closes host and player
  src/main/desktopConfig.ts  JSON in userData (mode, remote URL, TMDB/OMDb keys, output settings), checked with core's schema combinators
  src/main/player/        the player service: owns @raven/mpv, resolves sources, answers the bridge, keeps the surface in place
  src/host/localHost.ts   utilityProcess entry, local mode: startServer from '@raven/server/start'
  src/host/remoteHost.ts  utilityProcess entry, remote mode: fastify serving the renderer + proxying /api/* to the remote
  src/preload/preload.ts  contextBridge.exposeInMainWorld('ravenDesktop', bridge): the desktop actions and the player's MessagePort
  src/renderer/main.tsx   RavenProvider with { kind: 'desktop', api, desktop, player } + router of ravenRoutes plus desktop routes
  src/renderer/ChooserPage/  first run: "Run on this computer" or "Connect to a server", built from @raven/ui parts
  src/renderer/ConnectionLost/  shown when the remote server cannot be reached
```

### How the library renderer reaches a server

The library-mode design loads the renderer from `http://127.0.0.1:<port>` with `baseUrl: ''`. Cookies, SSE and the API then stay same-origin, exactly as in the browser.

- **Local mode:** the host process runs the real raven server with this environment:
  - `HOST=127.0.0.1` and `PORT=0`
  - `DATA_DIR=<userData>/data` and `BROWSE_ROOT=<home>`
  - `WEB_DIR=<resources>/renderer`, so the server hands out the desktop renderer rather than the web build
  - `FFMPEG_PATH` and `FFPROBE_PATH` pointing at the bundled binaries
  - the TMDB and OMDb keys from the desktop config
- **Remote mode:** the host process runs a small Fastify server, about 40 lines. It serves the same renderer and proxies `/api/*` to the remote with `@fastify/http-proxy`, streaming request and response bodies so SSE and byte ranges pass through. The remote's `raven_unlock` cookie has no `Domain` and `Path=/api`, so it lands on the local origin unchanged. Its Fastify is created with `forceCloseConnections: true`, or an open EventSource holds up quitting (3 s in the spike).
- **One Electron session per library mode** (`partition: 'persist:local'` and `persist:remote:<origin>`). Cookies are scoped by host, not port, so every server on 127.0.0.1 would otherwise share one cookie jar: local mode, each remote and any dev server. Separate jars keep one server's unlock from riding along to another.
- Each host posts `{ url }` to the main process over `process.parentPort`, and the main process loads that URL.
- Video bytes do not go through the renderer at all; section 5 says where mpv reads them from.
- Player-only server sessions (`persist:server:<serverId>`) and library-mode sessions remain separate trust boundaries. Cookies are not copied between jars. The same trusted server ids in `desktop-config.json` identify server sources in both modes; local library sources resolve through the embedded server.

**D3 decision gate:** whether the player-only screens move to the host's origin with the library or keep `app://` remains open. The player depends on `PlayerServices`, not the origin. Before D3 ships, record the chosen origin, routing, frame validation and CSP changes here, preserving the security baseline above. The player-only `connect-src 'self'` policy cannot be copied unchanged if the chosen integration needs additional connections.

### Build and bundling

- **Library-mode window security:** retain `contextIsolation`, `sandbox`, no `nodeIntegration`, the fuses and IPC guards. For a host-loaded library renderer, restrict navigation and sender-frame checks to that host origin, and set a Content-Security-Policy (`default-src 'self'`, plus what fonts and images need). External http and https links open in the system browser. D3 records the final origin integration before it ships.
- **Bundling the hosts (phase 2):** `bun build --target node --format esm` turns each host into one file of about 3 MB. The local host leaves these external:
  - `better-sqlite3`;
  - the packages NestJS 12 loads lazily with `import()`, which bun tries to resolve but none of which load at runtime: `@nestjs/microservices`, `@nestjs/websockets`, `@nestjs/platform-express`, `@fastify/multipart`, `@fastify/view`, `class-transformer` and `class-validator`.

  The remote host needs no externals. Two facts make this simple, both confirmed by the spike:
  - The server injects every dependency with an explicit `@Inject(Token)`, so it needs no `emitDecoratorMetadata`.
  - better-sqlite3 13 is N-API (`NAPI_VERSION=10`) with a prebuilt binary, and it loads in Electron 44's Node 24 without electron-rebuild.

  This avoids packaging Bun's symlinked workspace `node_modules`. better-sqlite3 alone ships, in a `node_modules` folder beside the bundle, with its `.node` unpacked from the asar: an ESM bundle ignores `NODE_PATH`.
- **Start time:** fork to `{ url }` takes about 190 ms. `module.enableCompileCache()` inside a single-file bundle does nothing, because the file is already compiled when it runs; the main process passes `NODE_COMPILE_CACHE=<userData>/compile-cache` in the fork's env instead, for about 30 ms on later launches.
- **The fork's env replaces the whole environment.** The main process passes everything the host needs, including `UV_THREADPOOL_SIZE`, rather than relying on `sizeThreadpool()` setting it after the process has started.
- **No `__dirname` in bundled code.** Bun's bundler bakes it in as the source folder. The main process finds its files through `app.getAppPath()` and `process.resourcesPath`, and passes the hosts every path they need in their env.
- **ffmpeg (phase 2 only):** a `fetch:ffmpeg` script downloads a pinned jellyfin-ffmpeg portable build per platform (macOS arm64 and x64 in phase 2; Windows x64 and Linux x64 when those platforms ship). It has zimg, the SIMD tone mapper `tonemapx` and the hardware filters the transcoding spec uses. It is GPL, which matters only if the app is distributed publicly.
- **libmpv:** a `fetch:libmpv` script, in `@raven/mpv`, places the pinned libmpv for the platform beside the addon (section 5).
- **Scripts** (one command each, chained with `bun run --sequential`, all in `nx.includedScripts`):
  - `build`: `build:clean`, `build:renderer` (vite), `build:main` (tsc then tsc-alias), `build:preload` (bun build); add `build:hosts` (bun build) in phase 2
  - `typecheck`: `typecheck:main` and `typecheck:renderer`
  - `dev`: `electron .`
  - `package` and `make`: `electron-forge`
  - plus `lint:ts`, `lint:css`, `format` and `test`
- **New tooling presets:** `tooling/tsconfig/node.json` (Node types, no decorators) and `tooling/oxlint/node.json` (node env).

## 5. Native playback: `libs/raven/mpv` (`@raven/mpv`)

### The addon

- A thin N-API addon, roughly 600 to 900 lines of C++ (Objective-C++ for the macOS surface), on node-addon-api, built with cmake-js. No existing binding fits: mpv.js was a PPAPI plugin Chromium removed, and node-mpv drives a separate mpv process over JSON IPC, which cannot draw inside our window.
- N-API is ABI-stable, so it needs one build per OS and architecture, not one per Electron version. CI builds it in the release matrix.
- A TypeScript wrapper (`src/mpv.ts`) is the only way in. Every property value and event that comes out of the addon passes a type guard before the rest of the app sees it.
- **It runs in Electron's main process.** macOS requires that, because the video view has to live in the same process as its window; Windows and Linux follow the same shape so there is one code path.
- **The main process never blocks on mpv:**
  - the JS thread uses only the async calls, `mpv_command_async` and `mpv_set_property_async`;
  - events drain through `mpv_set_wakeup_callback` into a threadsafe function;
  - `mpv_terminate_destroy`, which blocks, runs on a worker thread.
- **Hardened by default:** `load-scripts=no`, `ytdl=no`, `osc=no`, `input-default-bindings=no`, `input-vo-keyboard=no`. Keys and mouse belong to the page. `load-scripts=no` stops user scripts only; mpv's built-in ones (stats, auto_profiles) still load, which the diagnostics overlay needs. `access-references=no` is also set (the player service sets it before the first load, refusing loads if it fails), which stops EDL, playlist and other reference files from opening paths the user never granted; the cost is that MKV ordered chapters and linked segments, mov reference files and archive references do not play.
- **Async only from JavaScript.** The spike's synchronous `getProperty` goes; every read is an observed property or an async get, and each value passes its type guard in `src/mpv.ts`.

### Surfaces

Each surface puts mpv's video under the page, so raven's React controls draw over it. The completed macOS native spike establishes the first surface; D6 settles Windows and Linux before implementation.

- **macOS: one window.**
  - Upstream mpv dropped embedding into an NSView in 0.37, and its Vulkan context always opens its own window. The "moltenvk context" patch, carried by MPVKit and by Plex's fork, takes a `CAMetalLayer*` as `wid`. We build libmpv with it.
  - The addon creates a layer-backed NSView with a `CAMetalLayer`, inserts it at the bottom of the BrowserWindow's content view, beneath the WebContentsView, and passes the layer as `wid`.
    - **It must sit in the content view, not inside the page's view.** Chromium draws all web content through one window-level compositor layer, so a view inside the WebContentsView covers the whole page. The spike tried both.
    - **Chromium re-sorts the content view's subviews** and puts views it does not own on top; docking DevTools does it. Frame-change notifications miss it. The addon hooks the content view's sort and puts the video back at the bottom afterwards; the spike repaired all four re-sorts it saw.
  - The WebContentsView's background is `#00000000` on the watch route. The window itself does not need `transparent`.
  - **DevTools open detached on the watch route.** Docked, Electron lays the DevTools view across the whole window under the page, and its opaque background shows through the transparent page, hiding the video. Electron 44 has no API to clear it.
  - **Our resize patch.** The moltenvk context never tells mpv the layer was resized. A second patch of ours checks the drawable size on each turn of mpv's event loop and caps its idle sleep at 50 ms.
  - The patched context reports no display refresh rate, so the player service sets `display-fps-override` from `screen.getDisplayMatching`, and again when the window moves to another display.
- **Windows (later): W1 if the spike passes it, W3 otherwise.**
  - **W1, one window.** Chromium draws web content into a child window of its own. The addon creates another child window at the bottom of the z-order and passes it as `wid`, so mpv sits under Chromium's content; stremio-shell-ng does the same with WebView2. The window is created transparent and frameless (Electron sets `transparent` only at creation) and uses `titleBarOverlay` for the window buttons.
  - **W3, an overlay window.** The opaque, framed main window hosts mpv's child window. A transparent, frameless window owned by it (Electron's `parent`) shows only the player controls, and only on the watch route; the main process keeps it on the main window's content bounds. The library UI keeps its native frame, at the cost of a second renderer during playback.
- **Linux (later): W3 under X11.** Electron 38 and newer default to Wayland, which cannot embed another client's surface, so the app starts with `--ozone-platform=x11`. There is no HDR on Linux in v1; Wayland and its HDR wait for libmpv's gpu-next render API.
- **Fallback:** if libmpv is missing, its version is too old, or the surface cannot be made, the standalone player uses html for supported local files and opens server titles in the browser. Full library modes set the platform's `player` to `null` and use the web engine.

### The mpv profile

- **Video:**
  - `vo=gpu-next`: libplacebo, mpv's newest renderer.
  - `hwdec=auto`: VideoToolbox on macOS; D3D11VA, NVDEC or Vulkan video on Windows; VAAPI, NVDEC or Vulkan on Linux. Codecs the GPU cannot decode fall back to the CPU (dav1d for AV1).
  - `video-sync=display-resample`, so 23.976 fps video paces evenly on a 60 or 120 Hz display.
- **HDR:**
  - On an HDR output, `target-colorspace-hint` passes HDR through: EDR on macOS, the HDR swap chain on Windows when Windows HDR is on.
  - On an SDR output, libplacebo tone maps with peak detection (`hdr-compute-peak`).
  - **On macOS the hint is set per display.** The patched context reports no target colourspace, so `target-colorspace-hint=yes` outputs PQ even to an SDR screen (macOS then tone maps it), and `auto` behaves like `no`. The player service sets `yes` only while the window's screen reports EDR headroom above 1 (`maximumPotentialExtendedDynamicRangeColorComponentValue`, read by the addon) and `no` otherwise, so libplacebo tone maps; it re-checks when the window changes display. Reporting the screen's colourspace from the context itself is a later patch.
  - Dolby Vision profiles 5 and 8 are reshaped from their RPU, so profile 5 has correct colours. Profile 7 plays its base layer.
- **Cache:** forced on (`cache=yes`) for remote URLs and for local libraries on network volumes, where mpv's `cache=auto` would see a plain file. It is sized for 4K remuxes at 100 Mb/s: `demuxer-max-bytes` about 1 GiB ahead, `demuxer-max-back-bytes` about 256 MiB behind, so short seeks back stay instant.
- **Subtitles:** mpv draws every format: ASS with its attached fonts through libass, PGS, VobSub, DVB, SRT and WebVTT. Sidecar files are added with `sub-add`.
- **Audio:** three output profiles in "This computer", plus the device from `audio-device-list`:
  - **PCM:** multichannel up to 7.1 (`audio-channels=auto-safe`). LPCM over HDMI keeps lossless audio, though Atmos objects are lost.
  - **Receiver passthrough:** `audio-spdif` with the chosen formats. Windows (WASAPI exclusive) and Linux (PipeWire) carry every format, including TrueHD and DTS-HD MA. macOS (CoreAudio exclusive) carries AC3 and DTS core; anything else decodes to PCM. The volume control is disabled while passthrough is on.
  - **Headphones:** a normalized stereo downmix, or `ao=avfoundation` on macOS for spatial audio on AirPods.
- **Diagnostics:** a shortcut toggles mpv's built-in stats overlay (`script-binding stats/display-stats-toggle`), which shows the decoder, `hwdec-current`, dropped frames and the cache.

### Sources

The renderer names a `PlayerSource`: either a granted `fileId`, or a trusted `serverId` and `mediaId`. The main-process player service resolves it, so the renderer can never point mpv at a path or URL of its choosing.

- **Opened local file (phase 1):** the path behind a granted `fileId`, validated by the main process (section 4). mpv reads the disk directly.
- **Local library mode (phase 2):** the file's path from `getMediaLocation` (`libs/raven/core/src/apiClient.ts:336`). mpv reads the disk directly; no bytes pass through the server.
- **Server title, direct (both phases):** the remote server's own `/api/media/:id/file`, not the local proxy, so there is one hop. The cookie is HttpOnly, so the renderer cannot read it; the player service reads `raven_unlock` and `raven_admin` from Electron's session cookie store and passes it to mpv as a `Cookie` header (`http-header-fields`).
- **Remote library mode, transcode (phase 2):** for a link too slow for the original, mpv plays the `container=mkv` stream from the transcoding spec, which copies TrueHD, DTS-HD and picture subtitles instead of converting them.
  - mpv runs with `rebase-start-time=no`, the engine subtracts `STREAM_TIME_SHIFT` as the web engine does, and the duration comes from the probe.
  - A seek outside the cache reloads the stream with a new `start`.
  - When `paused-for-cache` keeps recurring while `cache-speed` stays below the file's bitrate, the player offers a transcode at a bitrate under the measured speed. It waits for several stalls before offering, so one hiccup does not trigger it.

### The bridge

- **One MessagePort per window,** created by the main process and handed to the renderer through the preload. Commands carry a request id and get a reply; events flow the other way.
- **Commands are an allowlist,** each a `PlayerCommand` variant: `load` (a `PlayerSource`, a start time, an audio index, a subtitle id), `play`, `pause`, `seek`, `audio`, `subtitle`, `volume`, `speed`, `subtitleScale`, `stats`, `stop`. The main process checks each with `isPlayerCommand` and never forwards raw mpv commands; `run`, `load-script` and an arbitrary `loadfile` stay unreachable.
- **Events are `PlayerEvent` variants:** time, buffered ranges, paused, waiting, duration, rate, tracks (`MediaTracks`), ended and error. Diagnostics are drawn by mpv's own stats overlay, not sent as another event. `time-pos` is throttled to about 4 updates a second.
- **The page stays quiet while a video plays.** Every repaint of the page over the video costs the compositor a frame; in the spike, stopping the page's 10 Hz time updates cut dropped frames from about 10 to 3 in 2 minutes. While the controls are hidden, nothing on the watch route repaints: the chrome keeps the latest time in state but renders the scrubber and time label only while it is shown.
- **Main process extras:**
  - `powerSaveBlocker.start('prevent-display-sleep')` while a video plays;
  - fullscreen: the HTML fullscreen request becomes the window's, and the surface follows the window's bounds;
  - quitting stops mpv before the host.

### Tracks from mpv

The player service turns mpv's `track-list` into `MediaTracks` with a pure function (`tracksFromMpv`):

- **Audio:** entries of type `audio` in order. `index` is the position among them, so it means what the server's `0:a:N` means and a remembered pick carries between web and desktop. mpv's `aid` is the entry's `id`. `language` goes through core's `languageTag`; `channels` comes from `demux-channel-count`.
- **Subtitles:** entries of type `sub`. Embedded ones are `embedded-N` by position; external ones are `external-N` in the order they were added. `supported` is always true, since mpv draws PGS, VobSub and DVB.
- **`defaultAudio`** is the entry flagged default, else the first; **`frameRate`** is `container-fps`.

### Bundling libmpv

- **macOS:**
  - The spike built mpv v0.41.0 with MPVKit 1.0.0's `0001-player-add-moltenvk-context.patch`, which applies cleanly and registers `gpu-api=vulkan` with `gpu-context=moltenvk`, plus our resize patch. Meson ran with `-Dlibmpv=true -Dcplayer=false -Dvulkan=enabled` against Homebrew's dependencies, with `-I/opt/homebrew/include` because the patch includes a MoltenVK header. MPVKit's other two patches (a static Swift build fix and a tvOS fix) are not needed.
  - That build links about 30 Homebrew dylibs by absolute path, so it cannot ship. The release uses our own pinned CI build of the same sources (mpv, FFmpeg, libplacebo, MoltenVK, dav1d, libass and their dependencies) for arm64 first, then x64 in phase 2: self-contained, with MoltenVK bundled, every dylib's install name set to `@rpath`, and every dylib signed.
- **Windows (later):** shinchiro's `mpv-dev` builds of mpv-winbuild-cmake, a self-contained `libmpv-2.dll`. Releases roll daily, so `fetch:libmpv` pins one and checks its checksum against a mirrored copy.
- **Linux (later):** the system's libmpv, 0.40 or newer (Debian trixie, Ubuntu 26.04). An older one falls back to the web engine.
- **Licensing and signing:**
  - GPL libmpv and GPL jellyfin-ffmpeg make a distributed app GPL in effect. That matters only if the app is shared publicly.
  - On Apple Silicon every Mach-O must be signed, so the release signs libmpv and the addon ad hoc. Real signing later needs either every dylib signed or `com.apple.security.cs.disable-library-validation`.

## 6. Shared logic and player protocol in `@raven/core`

These are pure helpers that are duplicated today or sit away from their siblings. `languageName` moves at P2; the rest move with the remaining UI at D1:

- `score()` and the sortable `COLUMNS` are written twice, in `components/MediaList/MediaList.tsx` and `components/ShowCard/ShowViews.tsx`. Keep one copy in core.
- `languageName` is written twice, in `lib/trackLabels.ts` and `components/ImageEditor/ImageEditor.tsx`. Keep one copy in core.
- `pages/LibraryPage/librarySections.ts` (`SECTIONS`, `sectionsFor`) holds the tab rules for each library kind. Move it to `libs/raven/core/src/libraryKinds.ts`, next to `KIND_RULES`.

Also in core: `OutputSettings`, the "This computer" shape, with `isOutputSettings`. The renderer, preload and main process import it with the player protocol below, so the bridge has one contract.

The other pure UI helpers stay in `@raven/ui`, now that both apps share it. They are `jumpScale`, `letters`, `itemFacts`, `shortcuts`, `selection`, `playQueue` and `history`. They move to core only if a non-React client appears.

### Player protocol

`libs/raven/core/src/player.ts` owns the guards below and derives its types with `Infer`. `load` takes a `PlayerSource` so both opened files and server titles use one protocol; `tracks` carries `MediaTracks` for both engines.

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

- `stats` toggles mpv's own stats overlay (`script-binding stats/display-stats-toggle`). The video's live parameters stay out of the event union: mpv draws the overlay, so nothing needs to cross the bridge for it.
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

## 7. Packaging, signing, updates, diagnostics and CI

### First-release packaging and operations

- **Packaging:** Electron Forge makes a dmg and a zip for arm64. libmpv and the addon sit outside the asar, every Mach-O signed (section 5, "Bundling libmpv"). No ffmpeg ships: there is no server to run it.
- **Signing:** ad hoc for now. `forge.config.ts` wires Developer ID signing and notarization (`osxSign` and `osxNotarize` with a keychain profile) behind environment variables, off until a certificate exists. The first launch of an ad hoc build needs the "Open Anyway" step in Privacy & Security once; the release notes say how.
- **Updates:** at launch, at most once a day, and from the menu, the app reads the latest release of `codebend3r/maester` from GitHub and compares versions. A newer one shows a quiet notice with a link to its release page. Squirrel.Mac requires a Developer ID signature, so silent updates wait for one; `updates.ts` is shaped so the notice can become an install then. The check can be switched off.
- **Version:** the app takes the workspace's shared version, so `version-bump` covers it and About shows it.
- **Crash reports:** `crashReporter.start({ uploadToServer: false })` keeps minidumps in `crashDumps`. A rotating log (5 files of 1 MB in `logs`) records launches, opens, the bridge's refusals, mpv's warnings and errors, and the budget marks. Help offers Show Logs, Show Crash Reports and Copy Diagnostics (app, Electron, mpv and FFmpeg versions, `hwdec` support, the display's refresh rate and EDR headroom). Nothing leaves the machine unless the user sends it.

### CI and release

- **PR checks:** the Ubuntu matrix picks up `@raven/ui`, `@raven/mpv` and `@raven/desktop` through `run-many`. For that to hold, `@raven/mpv`'s `build` compiles only the TypeScript wrapper; the addon is its own target (`build:native`, cmake-js), and its headless tests are `test:native`. Neither runs on Ubuntu.
- **A macOS job** (`🖥️ Desktop`) joins `pull-request-checks.yml` on an arm64 runner: restore or build libmpv (cached by its pinned sources), `build:native`, `test:native`, the desktop `build`, `e2e`, then `make`, uploading the unsigned app as a workflow artifact for manual testing. It runs on every PR, like every other check.
- **Release:** `.github/workflows/desktop-release.yml` on `v*` tags, arm64 only for the first release: build, sign ad hoc, attach the dmg, the zip and `SHA256SUMS` to the GitHub release.

- **Phase 2 matrix:** add macOS x64, fetch the pinned standalone ffmpeg build, and package both dmg and zip for each architecture with checksums. Build libmpv or restore it from the cache keyed by pinned sources; build the addon and run `bunx nx run @raven/desktop:make`. Windows x64 and Linux x64 join with their own CI runners and installer or package formats only after D6's platform spikes pass.
- **Headless native tests:** run on macOS, with Windows and Linux runners added alongside those platforms. Generic Ubuntu checks continue to build only the TypeScript wrapper, not the addon.


### Documentation

- **Root `CLAUDE.md`:** add `@raven/ui`, `@raven/mpv` and `@raven/desktop` to the project table. In the CSS section, point raven's `globals.scss` and `elements.scss` at `libs/raven/ui/src/styles/`, and name `@raven/ui` as a styled project.
- **`apps/raven/CLAUDE.md`:** note the UI lives in `@raven/ui`, the `Platform` seam, the two player engines, the desktop hosts and the player bridge.
- **`apps/raven/README.md`:** document installation, ad hoc Gatekeeper approval, file associations, server trust, handoff, output settings, diagnostics and, when shipped, local and remote library modes.

## 8. Performance budgets

| What | Budget | How it is measured |
| --- | --- | --- |
| Launch to window shown | 800 ms cold, 400 ms warm, on an M1 | Marks from the first line of `main.ts` to `ready-to-show`, written to the log. e2e asserts the median of 5 launches stays under twice the budget on CI |
| Finder "Open With" on a cold launch to first frame | 1.5 s for a local file | `open-file` to mpv's `playback-restart`, in the log |
| First frame, seeks, A/V sync, track switches | The pass criteria in Verification | As specified there |
| Dropped frames, event loop lag | The pass criteria in Verification: 0 drops in 10 minutes on an XDR display, lag p99 under 20 ms | `frame-drop-count` and `decoder-frame-drop-count`; `monitorEventLoopDelay` in the main process |
| Renderer JavaScript | 250 KB gzipped | The Vite build report, printed in the macOS CI job |
| Memory, idle on Home | 300 MB across every process | The sum of `app.getAppMetrics()` working sets after 60 s |
| Memory, playing M2 | 700 MB plus mpv's demuxer cache, which is capped (section 5) | The same, sampled every 10 s while M2 plays for 10 minutes |
| CPU while paused | under 2% of one core | `app.getAppMetrics()` CPU usage over 60 s |

The page stays quiet while video plays (section 5, "The bridge"): while the controls are hidden, nothing on the Play screen repaints.

## 9. Testing

- **Units (`bun test`):**
  - in `@raven/ui`: the reducer with `ended`, `fromPlayerEvent`, the chrome against a fake engine handle, `useWatchProgress` against scripted state, and the existing `Player.test.tsx` and `playerHooks.test.tsx` passing unchanged after the split;
  - in core: every guard in `player.ts`;
  - in `@raven/desktop`: `readPlayLink`, `tracksFromMpv`, the allowlist, the grants, the state store against a fake file system (corrupt file, cap, debounce), the natural folder order. Main-process modules take Electron's pieces as arguments, so these run without Electron.
- **Headless libmpv (`test:native`):** `vo=null` and `ao=null` against a lavfi-generated clip: load, seek, track switch, stop, and a hundred destroys without a hang, plus `track-list` on an MKV that ffmpeg generates with two audio tracks, an embedded subtitle and a sidecar.
- **End to end (Playwright `_electron`, macOS job):**
  - launch, open a generated clip through the main process, see the title, play, pause, seek, quit, reopen and see "Resumed at";
  - recents after a relaunch; removing one;
  - the security checks: `require` and `process` are undefined in the page; navigating to another origin is refused; `window.open` is denied; a request off the allowlist is refused; a play link to an unknown server shows the prompt and fetches nothing;
  - the launch budget.
- **Manual matrix,** on an XDR display, an SDR display and headphones (receiver passthrough when one is at hand):
  - M1 to M15 from the Verification table, opened from Finder, by drag and drop, and through a server;
  - a cold "Open With", a double-click once raven player is the default, a drop onto the Dock icon;
  - quitting mid-film, then reopening: the position comes back locally and on the server;
  - sleep and wake mid-film; unplugging the external display mid-film;
  - a locked library, with and without the admin lock;
  - the server going away mid-film: the error says so, and the position saved last stays.

## Risks

| Risk | Mitigation |
| --- | --- |
| An Electron upgrade breaks the native surface (Chromium re-sorting subviews) | Pin Electron's major. Each upgrade is its own PR that runs the surface checklist; the addon logs every re-sort it repairs |
| 120 Hz pacing and EDR are still unmeasured (the native video spike) | Measured on an XDR display before P5 ships. If they fail, P5 ships with `target-colorspace-hint=no` and the gap written into the spec |
| Gatekeeper blocks an ad hoc signed download | The release notes cover "Open Anyway". Developer ID signing and notarization are already wired, off until there is a certificate |
| A web page fires `raven://` links at the app | Only added servers play; an unknown origin needs a native confirmation; links carry ids, not URLs; nothing is fetched before consent |
| A crafted file exploits FFmpeg inside libmpv | Files open only by the user's action; libmpv runs without scripts or ytdl; the pinned libmpv is rebuilt for FFmpeg security releases |
| The split regresses the web player | P1 and P2 ship with no visible change, the Player's tests pass unchanged, and M1 and M2 are checked by hand in Chrome and Safari |
| The main process stalls while playing | Async libmpv only, small JSON on the bridge, lag logged and asserted in e2e |
| Playwright's Electron support is experimental | e2e drives the page and `electronApp.evaluate` only; a break pins Playwright and never blocks the unit tests |
| raven web on Netlify hands off its own origin, so video would come through Netlify's proxy | The prompt names the origin; the README says to add the server's own origin; a server advertising its canonical origin is a follow-up |
| GPL libmpv makes a public build GPL in effect | Distribution is personal; a public release needs the source offer first |
| The slice grows into the full desktop app | The non-goals above, and exit criteria on every step |

## Rollout

1. P1 and P2 merge behind no flag: the web player must look and behave exactly as before, checked on Vhagar after the deploy.
2. P3 to P6 produce an unsigned app on every PR (the macOS job's artifact) for testing by hand.
3. P7 tags the first release with the dmg. The web setting is turned on per browser, by hand, where the app is installed.
4. After a few weeks of use, D1 to D6 continue in the same app.

Turning the web setting off withdraws the handoff; the app needs nothing from the web to play local files.

## Decision rationale

These choices describe the first release unless a later phase is named.

| Question | Answer | Why |
| --- | --- | --- |
| A separate app, or the start of desktop raven? | The start, in `@raven/desktop` | One native stack, one release pipeline, one update channel; data and associations carry over |
| Browse servers inside the app? | No | Browsing is the full `@raven/ui` move, most of the cost; the web already does it |
| How does the renderer reach a server? | Through eight allowlisted calls made by the main process; mpv reads files directly | No local port, no proxy, no CORS, no cookies in the renderer, and a compromised page can do only eight things. The proxy host comes with library browsing at D4 |
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

## What full desktop raven inherits

- `@raven/ui` with its player exports, build and tokens. D1 moves the remaining folders into it and builds `PlayerServices` from `useRaven()`.
- The player chrome, both engines, `ended` state, protocol, bridge, `MediaTracks` mapping, native surface and "This computer" settings. Do not reimplement them for library modes.
- The macOS arm64 libmpv build, addon and CI; x64 is added later rather than blocking the player release.
- The app identity, pinned `userData`, security baseline, fuses, menus, file associations, `raven://`, persisted player state, logs, crash reports, update check and release workflow.
- D3 decides whether the player screens move to the library host's origin or retain `app://`; the player itself is origin-independent.

## Order of work (one PR each)

Each implementation step is its own PR, stacked on the one before, with an implementer and a reviewer per task. Spikes come first and are thrown away; their outcomes are written back here. The companion transcoding work runs alongside; D4 requires its mkv container.

### Completed feasibility spikes

1. **Server spike, thrown away. Done 2026-10-12: passed.** Ran `startServer` from a bun-bundled file in an Electron `utilityProcess`, loaded better-sqlite3, and played direct, remux and transcode streams through the web engine, locally and through the remote proxy. See "Spike outcomes".
2. **Native video spike, macOS arm64 half, thrown away. Done 2026-10-12: conditional pass.** Criteria:
   - patched libmpv loads in Electron's main process;
   - M2 plays with `hwdec-current=videotoolbox` and no drops over 10 minutes at 60 and 120 Hz;
   - video stays below the page through navigation, resizing, fullscreen and detached DevTools;
   - on an XDR display, EDR highlights exceed the UI's white and M4 has correct colours;
   - 100 load and stop cycles and quitting end without deadlock;
   - without libmpv, the web engine plays.

   The test Mac could not validate 120 Hz or EDR. Both are measured before P5 ships; the Risks table defines the documented SDR-only fallback if those checks fail. Existing measurements remain a conditional pass, not a claim that every performance target passed.

### Phase 1: raven player, macOS arm64

0. **P0: spike, thrown away.** In a scratch Electron 44 app, packaged and signed ad hoc:
   - `open-file` from Finder reaches a cold launch, with document types from `extendInfo`;
   - a `raven://` link from Safari and Chrome reaches `open-url`, cold and warm;
   - `webUtils.getPathForFile` in a sandboxed preload returns a dropped file's path, and '' for a `File` the page made;
   - `ses.fetch` in a `persist:server:<id>` session keeps the `raven_unlock` cookie from `/api/lock/unlock` and sends it on the next call (if not, the service keeps the jar through `ses.cookies`);
   - the page loads from `app://raven` with the CSP header, and the player's MessagePort reaches it through the preload;
   - the owed XDR checks from the native video spike, if an XDR display is at hand.
1. **P1: split the Player into chrome and engine, in `@raven/web`.** The html engine only, `ended` in `VideoState`, `EngineActions`, and `PlayerServices` in place of the singleton in the seven files. No visible change.
2. **P2: create `@raven/ui` with the player.** `git mv` only, plus `languageName` into core, the build, the Dockerfile allowlist and the docs. No visible change.
3. **P3: `@raven/mpv`.** The addon, the wrapper, the macOS arm64 libmpv build with both patches, `fetch:libmpv`, `build:native`, `test:native` and the macOS CI job (arm64 only).
4. **P4: the protocol and the app.** `player.ts` in core; the `node.json` tsconfig and oxlint presets (section 4); `@raven/desktop` with the `app://` renderer, the security baseline and fuses, menus, Home, the grants, open dialog, drop, `open-file` and document types, the state store, the html engine for local files, and the e2e suite. M1 plays through the html engine.
5. **P5: native playback.** `useNativeEngine`, `NativeStage`, the macOS surface, the bridge, `tracksFromMpv`, the title bar behaviour, next in folder, "This computer" and the stats overlay (section 5). M1 to M15 play from local disk.
6. **P6: server titles.** Servers in Settings, the play link and the trust prompt, a session per server, the allowlist, `UnlockDialog` moved to `@raven/ui`, progress and history to the server, up next from the link, the browser fallback; the web setting and its two "Open in raven player" actions.
7. **P7: release.** libmpv bundled and signed in the app, `desktop-release.yml` for arm64, the update check, the crash reporter and logs, Copy Diagnostics, and the docs: the root `CLAUDE.md` project table, `apps/raven/CLAUDE.md`, `apps/raven/README.md`, and this spec's outcomes.

### Phase 2: full desktop raven, then macOS x64

1. **D1: finish the shared UI extraction.** Move the remaining components, pages, hooks, stores, query layer, router and tests into `@raven/ui`; add `Platform`, `RavenProvider`, `useRaven()` and the remaining core dedup. Web becomes the thin shell. Build `PlayerServices` from `useRaven()`; no visible web change.
2. **D2: embed the server.** Add `startServer`, connection-dropping `close` and the `./start` export (section 3).
3. **D3: local library mode.** Add the library host, chooser, local session, scanning and matching, and the origin/routing/security decision in section 4. Keep the working player, associations and state; when library modes ship, rename "raven player" to "raven" without changing bundle id or `userData`.
4. **D4: remote library mode.** Add the remote host and proxy, direct mpv URLs, mkv transcodes, Connection lost and Switch server. Preserve player handoff and per-server trust. Depends on the transcoding spec's mkv container.
5. **D5: full desktop distribution and Intel Macs.** Bundle standalone ffmpeg, extend libmpv and addon builds and the macOS release matrix to x64, and update docs. Preserve the arm64 release pipeline and test the full desktop matrix on each macOS architecture.

### Phase 3: Windows x64 and Linux x64

6. **D6: platform spikes, then implementation.** First run throwaway native video spikes:
   - **Windows x64:** W1 or W3 draws controls over video through resizing, snapping, maximizing and fullscreen; HDR10 passes with Windows HDR on; TrueHD Atmos reaches a receiver.
   - **Linux x64, X11 on GNOME and KDE:** W3 works with VAAPI decoding on Intel.
   - **Both:** without libmpv, full library mode plays through the web engine.

   Write outcomes here. Then, one PR each: the Windows surface and pinned libmpv; the Linux surface and system libmpv. Add each platform's CI runner, release entry and packages with its implementation.

### Follow-ups

Match the display's refresh rate to video; report the screen's colourspace from the moltenvk context; switch Windows into HDR for an HDR title; Now Playing and media keys (MPNowPlayingInfoCenter, SMTC, MPRIS); Wayland with HDR on Linux; advertise the server's canonical origin for web handoff; consider recents thumbnails.

Release: Developer ID signing and notarization once a certificate exists (`signingFrom` already reads `RAVEN_SIGN_IDENTITY` and `RAVEN_NOTARIZE_PROFILE`), then silent updates through Squirrel.Mac, which needs that signature. `hdiutil create`, `attach` and `detach` print a deprecation warning on macOS 27 that points to `diskutil image`; the dmg maker swaps to it when the runners reach macOS 27. The libmpv cache in CI restores nothing yet: set the `NX_CLOUD_ACCESS_TOKEN` repository secret. A fallback without Nx Cloud needs more than `NX_CACHE_DIRECTORY`: Nx 23 finds a cached task only through its database in `.nx/workspace-data`, named for the machine's hardware UUID, so a restored `.nx/cache` misses on a new runner. The fallback would cache that folder too and rename the database to the runner's UUID, or cache `fetch:libmpv`'s outputs and skip the target when they are restored. Idle memory on Home measures about 425 MB packaged and unpackaged against the 300 MB budget: find what holds it, or revisit the budget. Give the update check one stable place to read, so it no longer pages through a list GitHub sorts by tag name: either `main-smoke-test.yml` stops marking its `vX.Y.Z.N` build releases `--latest` (or makes them prereleases), so `/releases/latest` names the app's release again, or `desktop-release.yml` publishes a fixed pointer such as a `latest.json` asset on a dedicated tag. Until then, more than 5 pages of 100 between the newest release and a `v0.10.0` listed after it could still hide that release.

At the next addon rebuild: move `access-references=no` into the addon's init options; fix the addon's cleanup hook, which segfaults on teardown when a player is still alive (avoided today because mpv is destroyed, or the process killed, before Node tears down); pass playlist entry ids (`start-file` and its entry id) from the addon, so the stale-event gating no longer depends on reply ordering.

Real-hardware gates still owed before P5 ships: the picture under the transparent page (the window-surface smoke used an empty page), full screen, detached DevTools, and the XDR and 120 Hz measurement. If that measurement fails, ship with `target-colorspace-hint=no`, the fallback in Risks.

## Spike outcomes

### P7 release outcomes, 2026-10-16

P7 shipped as planned in `docs/superpowers/plans/2026-10-17-raven-desktop-release.md`. Where its Rulings change or narrow this spec:

1. **Staging.** `stage:mpv` copies exactly `raven_mpv.node`, `lib/libmpv.2.dylib`, `lib/libMoltenVK.dylib` and `provenance/` from the CI build into `staging/mpv/darwin-arm64`, and Forge's `extraResource` puts them at `Contents/Resources/mpv/darwin-arm64`, outside the asar, rather than `asar.unpack`. `package` and `make` fail when any of the three Mach-O files is missing.
2. **Inside-out signing.** The `postPackage` hook signs every Mach-O file and nested bundle ad hoc, deepest first, then the app, and never with `--deep`; it then verifies with `codesign --verify --deep --strict`.
3. **The dmg** comes from a small Forge maker over `hdiutil` and `ditto`, not `@electron-forge/maker-dmg`, whose `appdmg` needs node-gyp addons that Bun never builds.
4. **Release assets** have no spaces, and the sources ship with them: `raven-player-<version>-arm64.dmg`, `raven-player-<version>-arm64.zip`, `raven-player-<version>-sources.tar.gz` (every pinned upstream archive, both patches, the build scripts and the repository revision) and `SHA256SUMS`. The repository is public, so this is the source offer the Risks table asks of a public build.
5. **The tag filter.** `desktop-release.yml` runs on `v[0-9]+.[0-9]+.[0-9]+` and `v[0-9]+.[0-9]+.[0-9]+-*` only, not `v*`, so a `vX.Y.Z.N` build tag never builds the app. It fails fast unless the tag matches the desktop's version, waits up to 10 minutes for `release.yml`'s release, uploads with `--clobber` and appends `apps/raven/desktop/release/install-notes.md` once.
6. **The dry run** is a path-filtered `pull_request` run or a `workflow_dispatch`; neither publishes. Only a tag push runs the `publish` job.
7. **One composite action**, `.github/actions/raven-desktop-native`, builds the native pieces for the PR checks' `🎞️ Desktop native` job and the release alike. After main's #186 it restores the libmpv source build through Nx Cloud (`@raven/mpv:fetch:libmpv` is a cached Nx target). Main's #195 dropped the `.nx/cache` fallback in `actions/cache`, which never hit: Nx 23 keeps its local cache in `~/.nx/<workspace id>/cache`, so its post step found no `.nx/cache` and saved nothing. In practice nothing is restored yet: the repository has no `NX_CLOUD_ACCESS_TOKEN` secret (the jobs log it empty). `NX_CACHE_DIRECTORY` alone would not bring a local fallback back, since Nx finds a cached task through a database named for the machine (Follow-ups). Every Desktop native job and release build compiles libmpv cold, 11 to 14 minutes on the runs of 2026-10-16, inside the release job's 150-minute timeout.
8. **The update check reads the releases list,** `GET /repos/codebend3r/maester/releases?per_page=100`, not `/releases/latest`, which names a build release with no app. It takes the highest `vX.Y.Z` that is neither a draft nor a prerelease and carries `raven-player-<X.Y.Z>-arm64.dmg`, and builds the release page link from the tag. Nothing is downloaded. GitHub orders the list by tag name, not by date, so every `vX.Y.Z.N` build sorts above its own release and `v0.10.0` sorts below `v0.9.x`: the check follows `Link: rel="next"` for up to 5 pages, only to the same list on `api.github.com` (whose next links name the repository by id, `/repositories/1388607730/releases`), within one 2 MiB budget across pages, and stops early once it sees a newer release. It says this copy is the newest only when it saw a full release at or below the running version; when nothing it read carried the app it reports "GitHub listed no raven player release." as a problem. A running prerelease sits below its own release and above every older one, so `0.6.0-rc.1` is offered `0.6.0` and never `0.5.x`.
9. **`desktop-config.json` is version 3,** with `updates: { isEnabled, checkedAt }`; a launch check is due when it is on and `checkedAt` is missing, a day old or in the future. The menu's check always runs.
10. **Unpackaged, the launch check runs only with `RAVEN_DESKTOP_RELEASES_URL` set,** so `dev` and e2e never call GitHub on their own.
11. **Logs live in `~/Library/Logs/raven`** (section 7's `logs`), pinned with `app.setAppLogsPath`: `raven.log`, then `raven.log.1` to `raven.log.4`, each at most 1,048,576 bytes, the folder `0o700` and the files `0o600`. Crash dumps go to `<userData>/Crashpad`.
12. **What the log never holds:** cookie values, request bodies, PINs, passwords, file paths or file names. Opens are logged as `open file .mkv` or `open server title 7 on <server name>`; every line is redacted, stripped of control characters and cut at 4,096 characters, and at most 200 lines are written per 10 s, with one count of the dropped.
13. **The budget marks are always on and always logged,** packaged too: `raven-launch-ms`, `raven-quit-ms`, `raven-open-to-frame-ms`, `raven-memory-idle-mb`, `raven-memory-playing-mb` and `raven-cpu-paused-percent`. `raven-quit-ms` runs from the first `before-quit` to `will-quit`, so it does not include the final log flush that follows.
14. **No addon rebuild.** The three "next addon rebuild" items stay in Follow-ups; the release ships the addon and libmpv that P5 and P6 CI exercised.
15. **Copy Diagnostics** holds six lines: the app's version and whether it is packaged, macOS, Electron, Chromium and Node, mpv and FFmpeg (or why the engine is unavailable), `hwdec=auto` with `hwdec-current`, and the display's refresh rate from Electron and from mpv with the EDR headroom. No paths, file names, server origins or names, or cookies.
16. **The packaged smoke** launches the packaged binary with no test hook, waits for its launch, engine and launch-mark lines in the real `~/Library/Logs/raven/raven.log`, and sends `SIGTERM`, which runs `before-quit` (proved in Task 10; no fallback was needed), then expects the quit mark and an exit within 5 s.
17. **The version** stays the workspace's: the bundle audit checks the packaged `CFBundleShortVersionString` against `package.json`, and the release workflow checks the tag.
18. **Developer ID signing and notarization** stay wired behind `RAVEN_SIGN_IDENTITY` and `RAVEN_NOTARIZE_PROFILE`, which no workflow sets.
19. **The update notice is quiet:** an `aside` on Home and Settings only, never on a watch route, with "See what's new" and "Dismiss". The renderer never holds the release URL.

The section 4 "Locked libraries" line said a locked title answers `403`; the server answers `423 Locked`, and `404` while the admin lock hides the library. It is corrected above.

**Budgets measured** on the packaged app that `make` built for Task 10 (its app code is this branch's), on the Apple M1 Max under macOS 27.0.1 (26A434) that ran the P0 spike, with an LG HDR 5K at 60 Hz and a load average near 3.5 from other work. Three direct launches of `Contents/MacOS/raven player` with no test hook, quit with `SIGTERM`, read from `~/Library/Logs/raven/raven.log`. They came soon after a build and the Task 10 smoke, not cold since login; the first ran on an empty profile.

| Budget | Target | Measured | Notes |
| --- | --- | --- | --- |
| Launch, cold | 800 ms | owed | No launch was cold since login. The first launch on an empty profile marked `raven-launch-ms 224`; Task 10's smoke marked 226 |
| Launch, warm | 400 ms | 205 and 221 ms | The second and third launches |
| Memory, idle on Home | 300 MB | 424 MB, over | `raven-memory-idle-mb 424` after 60 s on an empty Home. Unpackaged it measured about 428 MB in Task 3. The budget is not met; see Follow-ups |
| Quit | under 1 s, no process left | 123, 151 and 104 ms | `raven-quit-ms`, which excludes the final log flush; each run exited within 1 s of `SIGTERM` and `pgrep -f "raven player"` found nothing. Task 10's smoke marked 104 |
| Finder Open With to first frame of M1, cold | 1.5 s | owed | `raven-open-to-frame-ms`, needs a person: "Testing for the PR" |
| CPU while paused | under 2% | owed | `raven-cpu-paused-percent` after playing M1 and pausing 60 s, needs a person: "Testing for the PR" |
| Memory, playing M2 for 10 minutes | 700 MB plus the demuxer cache | owed | `raven-memory-playing-mb`, "Testing for the PR" |
| XDR: EDR highlights, 0 drops in 10 minutes at 120 Hz | Verification | owed | No XDR display at hand, "Testing for the PR" |

The raw marks:

```
2026-10-16T22:19:28.780Z info raven-launch-ms 224
2026-10-16T22:19:28.968Z info raven-quit-ms 123
2026-10-16T22:19:36.709Z info raven-launch-ms 205
2026-10-16T22:19:36.891Z info raven-quit-ms 151
2026-10-16T22:19:42.510Z info raven-launch-ms 221
2026-10-16T22:20:42.436Z info raven-memory-idle-mb 424
2026-10-16T22:20:42.598Z info raven-quit-ms 104
```

The hardware gates in the plan's "Testing for the PR" remain owed to a person: Gatekeeper on a downloaded build, Finder Open With, double-click and Dock drop, Safari and Chrome `raven://` clicks, the XDR display, the budgets above marked owed, Help and updates by hand, and the app without its engine.

### P0 player integration feasibility, 2026-10-15: conditional pass

This is a new integration spike, not a rerun of the historical server and native video spikes below. No production desktop code, native build, player extraction or release artifact was added. The consolidated design remains the implementation contract for P1 to P7.

**Environment and provenance.** Ran on macOS 27.0.1 (26A434), arm64, Apple M1 Max, with Bun 1.4.3. The throwaway app and TypeScript sources were built under `/tmp/raven-desktop-p0`. Runtime versions were Electron 44.7.0, Node 24.21.0 and Chromium 152.0.7977.130. The cached upstream `electron-v44.7.0-darwin-arm64.zip` was checked against the actual [Electron 44.7.0 release checksums](https://github.com/electron/electron/releases/download/v44.7.0/SHASUMS256.txt): SHA-256 `e04e411b58a0a14375dd21b0ab4a378fd38930a702e4e20e322fee4849404c0b`. Scratch dependencies were pinned to `@electron/asar` 4.0.1 and `playwright-core` 1.64.1, outside the workspace.

The app used `app.asar`, a renamed executable and bundle id `io.github.codebend3r.raven.p0`. Every recorded acceptance launch reported `app.isPackaged === true`. `codesign --force --deep --sign -` followed by `codesign --verify --deep --strict` passed for the scratch bundle and verification passed again for its temporary installed copy. This is ad hoc signing only, not Developer ID signing, notarization, Forge packaging, production fuses or a Gatekeeper download test.

| Surface | Observed result | Limit of the evidence |
| --- | --- | --- |
| Packaged protocol and document registration | LaunchServices recorded `raven:` and the seven document UTIs from section 4, with `LSHandlerRank=Alternate`, plus imported MKV and WebM declarations | The probe wrote the intended `extendInfo` contents directly into Info.plist, not through Forge. No bare extension associations or default-handler setters were used |
| Automatic scheme dispatch | After temporary installation, plain `open 'raven://play?...'` found the registered app. A cold event was queued before ready, and a second URL arrived warm | Real LaunchServices Apple Events, not `app.emit` or argv simulation. Safari and Chrome confirmation dialogs were not exercised |
| File events | `open -a '<app>' /tmp/raven-desktop-p0/clip.mp4` delivered `open-file` both before ready on cold launch and while warm | Explicit-app LaunchServices delivery, not a Finder click, double-click or Dock drop. The fixture was a regular disk file with a video extension, not playable media |
| Privileged renderer scheme | `app://raven/` loaded scripts and HTML from the asar; `location.origin` was `app://raven` and `isSecureContext` was true | Registered before ready with `standard`, `secure`, `supportFetchAPI` and `corsEnabled`; no CSP bypass privilege |
| CSP and path containment | The response carried exactly section 4's CSP. An inline script did not execute; a fetch to the local HTTP fixture was blocked and never reached its log. Another app host was blocked by CSP; encoded traversal returned 403 | These focused probes are not the complete P4 security suite |
| Sandboxed bundled preload | One CommonJS preload with `electron` external loaded from the asar. Its actual `process.sandboxed` and `process.contextIsolated` were both true. Page `require` and `process` were undefined; a narrow invoke request and reply worked | No workspace imports at preload runtime; sandbox enabled globally and on the window |
| Player MessagePort | Main created `MessageChannelMain`, sent a port with `webContents.postMessage`, and preload transferred it with `window.postMessage`. The page sent `ping` and received `pong` through the other port | Actual transferred port through isolated preload, not a mocked bridge or a production player protocol test |
| Disk-backed File grant | CDP `DOM.setFileInputFiles` provided a disk-backed File, then a synthetic DOM drop passed that File through contextBridge. Preload `webUtils.getPathForFile` resolved its disk path; main checked a regular file and extension and returned only an opaque id | The File was real; the drop gesture was synthetic. A native Finder-to-window drag remains pending |
| Page-made File refusal | `new File([...], '/tmp/raven-desktop-p0/clip.mp4')` produced an empty path in the same preload method and returned refusal without granting a file | A page cannot turn a filename into a filesystem grant |
| Exact raven unlock-cookie attributes | A local fake server used `Path=/api; HttpOnly; SameSite=Strict`, without Max-Age, matching `lockService.ts`. In each of six packaged launches: media before unlock 403, POST unlock 200, next media call 200 with cookie present. No manual `ses.cookies.set` fallback was needed | Calls were main-process `ses.fetch`, not renderer fetch; no real raven server or credentials were used |
| Session separation and restart | `persist:server:p0-b` stayed at 403 while `persist:server:p0-a` was unlocked. The same jar sent the cookie to another port on 127.0.0.1, confirming why server partitions matter. After quit/relaunch the session cookie was absent again | `persist:` persists the jar, not session-cookie lifetime. A separate Max-Age=86400 control survived relaunch, but production raven's cookie did not. Do not promise remembered unlock across app restarts or persist it artificially |
| XDR and 120 Hz | Current display inspection found only LG HDR 5K at 60 Hz, with `maximumPotentialExtendedDynamicRangeColorComponentValue=1` | XDR highlights, HDR output and 120 Hz pacing remain pending. No libmpv, codec, frame-drop or native-surface checks were rerun |

**The temporary-directory constraint matters.** Registration under `/tmp` recorded the claims, but LaunchServices marked the app `in-temp-dir` and bare `open raven://...` failed with -10814. Explicit `open -a` still delivered both event types. With specific approval, the already signed bundle was copied to the previously absent `~/Applications/Raven P0.app` for the bounded automatic-dispatch test, then unregistered and removed. No previous raven scheme handler existed. Before/after checks confirmed that it was absent again and that the `.mp4` and `.ts` default applications were unchanged. No OS default file associations, browser settings or production app installations were changed. All scratch builds and logs stayed under `/tmp`.

**Reproduction recipe.** This is a throwaway harness, not a new repository target. The session's sources and raw evidence are under `/tmp/raven-desktop-p0`; their continued availability is not a release prerequisite. To recreate the checks independently:

1. Verify the arm64 Electron 44.7.0 archive against the linked upstream checksums, extract it, and copy the app preserving relative framework symlinks. Rename its executable and update `CFBundleExecutable`, otherwise a renamed outer app can still report `isPackaged=false`. Bundle main and preload with `bun build --target node --format cjs`, leaving `electron` external; bundle the renderer for the browser. Put them and a package.json naming main into `app.asar` with `@electron/asar` 4.0.1. Add section 4's document/URL declarations to Info.plist and sign/verify the complete app as above. Scratch compile outputs may be JavaScript; repository source/config remains TypeScript-only.
2. Register `app` as privileged before ready, serve the asar's renderer directory with `protocol.handle` and the exact CSP, deny escaping paths, and create a context-isolated sandboxed window with no Node integration. Register `open-file` and `open-url` in `will-finish-launching`; retain their values until the renderer is ready. Use a separate userData directory in `/tmp`, not the production raven directory.
3. In preload expose only a narrow invoke operation, a File-to-grant method and the port transfer. For File grants, call `webUtils.getPathForFile(file)` inside preload, refuse an empty result, and send a nonempty path only to main for validation. Transfer main's MessagePort after the renderer listener is installed, then assert a round trip. Connect Playwright 1.64.1 over a loopback CDP port for the assertions above. For the disk File, use `DOM.getDocument`, `DOM.querySelector` and `DOM.setFileInputFiles` with a filesystem path, then add that File to a DataTransfer and dispatch drop. Playwright's high-level upload initially produced a pathless File in this setup; that failure was not counted as a native-drop result.
4. Run two HTTP fixture listeners on `127.0.0.1:19446` and `:19447`. POST `/api/lock/unlock` returns an HttpOnly Strict cookie scoped to `/api`; GET `/api/media/1` returns 200 only with that cookie, else 403. Test the before/unlock/after sequence, a second `persist:server:<id>` session, the same jar on the other port, and a clean quit/relaunch after `cookies.flushStore()`. Repeat separately with Max-Age to distinguish persistent cookies from raven's actual session cookie. Log cookie presence and metadata, never cookie values. Assert the renderer's blocked fetch never reaches these listeners.
5. For automatic scheme dispatch, inspect the existing handler first. Do not replace a user's handler or overwrite an existing app. With explicit permission for a temporary non-temp install, register the signed copy and use plain `open` on the raven URL, cold then warm. Use explicit-app `open -a` for file events so no file default changes. Quit, unregister and remove only that copy in cleanup, verifying the prior scheme/file handlers are unchanged. Without that permission/location, automatic dispatch stays pending rather than failed as an Electron architecture hypothesis.

The final scratch commands `bun /tmp/raven-desktop-p0/dispatch.ts` and `bun /tmp/raven-desktop-p0/check-results.ts` both passed. The first asserted cold/warm event delivery, the renderer checks and registration cleanup; the second asserted the six exact session-cookie sequences and absence of the blocked HTTP request. Evidence files were `events.ndjson`, `renderer-results.json`, `dispatch-results.json`, `cleanup-results.json`, `checks.txt`, `signature.txt` and the HTTP request log. An earlier persistent-cookie control was kept separate, not substituted for raven's cookie behavior. Repository validation passed: `bunx nx run-many -t format:check --outputStyle=static` (9 projects, 8 cached; the root check examined 660 files), `bunx nx run maester:spellcheck` (uncached), and `git diff --check`. No files were staged.

**Verdict and remaining gates.** Conditional feasibility pass: none of the exercised bridge/security hypotheses failed. P1 may proceed without changing the architecture. Still pending are real Safari and Chrome cold/warm link clicks and their consent UI, Finder Open With and double-click behavior, native window/Dock drops, user-selected default associations, Gatekeeper on a downloaded build, and the historical XDR/120 Hz checks. P4/P6 must cover the relevant real delivery paths on the packaged app; P5 retains its display gate. This result does not certify those later milestones or native packaging/signing/source parity.

### Server feasibility spike, macOS arm64, Electron 44.7.0

Every check passed.

| Check | Result |
| --- | --- |
| better-sqlite3 in the `utilityProcess` | Loads under Node 24.21.0 (napi 10), WAL mode, no electron-rebuild |
| Local direct, remux, transcode | All play. First frame in 50 to 250 ms direct, 120 ms remux, 350 ms transcode |
| Remote direct, remux, transcode | All play through the proxy |
| Seek outside the buffer | Resumes in 0.4 s remuxing, 0.65 s transcoding: the old stream is aborted and a new ffmpeg starts |
| SSE through the proxy | An event arrives 7 ms after its trigger; the page's EventSource sees it in about 100 ms |
| Byte ranges through the proxy | 206 with the right `Content-Range` |
| Cookies through the proxy | `raven_unlock` and `raven_admin` land on 127.0.0.1 with `Path=/api`, HttpOnly and SameSite=Strict, and the locked library lists |
| Start time | About 190 ms from fork to `{ url }` |
| Quit | Clean only once `close` drops open connections (section 3) |

What it changed in this spec: `close` drops connections (section 3); the proxy forces connections closed and each mode gets its own session (section 4); the externals list, better-sqlite3's place beside the bundle, the compile cache through `NODE_COMPILE_CACHE`, the whole env passed to the fork, no `__dirname`, and the CSP (section 4, "Build and bundling").

Two facts about raven itself it surfaced: while the admin lock is on, locked libraries stay hidden until the admin password is entered, so unlocking one in remote mode starts with an admin unlock (see Verification); and the player buffers 60 s ahead, so a seek test needs a file longer than that.

### Native video feasibility spike, macOS arm64 half

Run on an Apple Silicon Mac under macOS 27 with an external LG HDR 5K display, which runs at 60 Hz only (30, 50 and 60 Hz modes) and offers no HDR mode (EDR headroom 1.0). libmpv was built as in "Bundling libmpv"; the addon was 482 lines of Objective-C++.

| Criterion | Result |
| --- | --- |
| libmpv loads in the main process | Pass: mpv v0.41.0, FFmpeg 9.0.2, `current-gpu-context=moltenvk`, `current-vo=gpu-next` |
| 4K HDR10 decodes on the GPU | Pass: `hwdec-current=videotoolbox` in every run, 0 decoder drops |
| No dropped frames in 10 minutes | Missed narrowly: 1 drop fullscreen on a generated clip, 8 on M2 from the NAS while other work ran on the Mac, 47 windowed. Stock Homebrew mpv in its own window drops 3 in 2 minutes on the same display |
| The video stays under the page | Pass through navigation, resizing, fullscreen and detached DevTools, and the controls took 7 of 7 real clicks. Docked DevTools hide the video, hence detached DevTools on the watch route |
| HDR and colour | EDR not testable on this display. With the colourspace hint, mpv output PQ to the SDR screen and macOS tone mapped it; without it, libplacebo tone mapped to BT.709. M4 (Dolby Vision profile 5) showed correct colours |
| 100 load and stop cycles, then quit | Pass: 30 s in all, a median of 247 ms per cycle; destroy took 33 ms idle and up to 299 ms mid-playback; the app exited cleanly |
| Event-loop lag | Pass: p99 under 20 ms in 179 of 180 ten-second windows (the worst 20.4 ms, including Node's 10 ms sampling period) |
| Without libmpv | Pass: a missing addon and a missing libmpv are both caught, and the web engine plays |

Verdict: a conditional pass. The embedding works, and most of the dropped frames come from this display and from the page repainting over the video. The XDR checks before P5 are still owed.

What it changed in this spec: the surface sits in the content view and survives Chromium's re-sorts, DevTools open detached, and our resize patch (section 5, "Surfaces"); the colourspace hint per display (section 5, "The mpv profile"); fewer time events and a quiet page (section 5, "The bridge"); async-only calls (section 5, "The addon"); the shippable libmpv build (section 5, "Bundling libmpv").

## Verification

- **Checks:** `bun run verify` passes for every project, and the git hooks pass on every commit.
- **After P1 and P2:** `bunx nx run @raven/ui:test` and `bunx nx run @raven/web:test` pass; `bun run dev:raven` behaves exactly as before; the Docker smoke test returns a healthy `/api/health` and serves `/`; M1 and M2 play in Chrome and Safari as before.
- **After P3:** `bunx nx run @raven/mpv:test:native` passes on the macOS runner, with no hang across a hundred destroys.
- **After P4 to P7:** `bunx nx run @raven/desktop:e2e` passes on the macOS runner; `bunx nx run @raven/desktop:make` builds an app that:
  - opens M1 to M15 from Finder, by drop and from Open Recent, meeting the pass criteria below on each output;
  - meets every budget in section 8;
  - resumes local files after a quit, and leaves the server's position within 10 s of where a server title stopped;
  - plays a title handed over from raven web on Vhagar, including one in a locked library with the admin lock on;
  - with libmpv removed, plays M1 through the web engine and opens a server title in the browser;
  - quits within 1 s while a video plays, leaving no process behind.
- **Security:** each check in section 9's end to end list passes, and a manual attempt to drop a page-made `File` opens nothing.

### Shared test media, playback criteria and full desktop checks

- **Test media.** One file per row, kept outside the repo. The media volumes hold a file for every row but three pieces. Nothing there has VP9 profile 2 HDR (M9), DVB subtitles (M11), or LPCM 7.1 and WebVTT (M15); the closest HLG runs at 25 fps (M6), and the heaviest 2160p60 file peaks at 56 Mb/s (M14). ffmpeg generates those pieces: libvpx-vp9 at 10-bit with PQ tags, the `dvbsub` encoder, `pcm_s24le` in 7.1, WebVTT, and x265 HLG at 50 fps.

  | ID | File | What it proves |
  | --- | --- | --- |
  | M1 | MP4, H.264 1080p24, AAC 2.0, mov_text | the baseline |
  | M2 | MKV, HEVC 10-bit 2160p HDR10, TrueHD 7.1 Atmos and AC3, PGS, 60 to 80 Mb/s | HDR, passthrough, picture subtitles |
  | M3 | HEVC Dolby Vision profile 8.1, E-AC3 Atmos, SRT | Dolby Vision with an HDR10 base |
  | M4 | HEVC Dolby Vision profile 5, E-AC3 | reshaping: no green or purple cast |
  | M5 | Dolby Vision profile 7 FEL, from a UHD Blu-ray | the base layer plays |
  | M6 | HLG 2160p50 | HLG |
  | M7 | HDR10+ | dynamic metadata |
  | M8 | AV1 10-bit HDR, Opus 5.1 | AV1 in hardware where the GPU has it, dav1d elsewhere |
  | M9 | WebM, VP9 profile 2 HDR | VP9 HDR |
  | M10 | H.264 High 10, FLAC, ASS with attached fonts | CPU decode, libass |
  | M11 | TS, MPEG-2 1080i, DVB subtitles | deinterlacing |
  | M12 | M2TS, VC-1, DTS-HD MA, PGS | an older Blu-ray |
  | M13 | DVD MPEG-2 480i, VobSub | VobSub |
  | M14 | HEVC 2160p60, peaks of 100 Mb/s | frame pacing under load |
  | M15 | DTS core, LPCM 7.1, SRT sidecars in UTF-8 and cp1252, WebVTT | audio variety, sidecars |

- **Pass criteria,** on each output: for macOS, a Mac XDR display, a Mac SDR display and headphones; later, an HDR TV on Windows and a receiver:
  - `hwdec-current` is not `no` wherever the GPU decodes the codec;
  - `frame-drop-count` plus `decoder-frame-drop-count` is 0 over 10 minutes on the XDR display; on a display where standalone mpv drops frames too, no more than standalone mpv drops there;
  - the first frame shows within 1 s locally, 2 s from SMB or a remote server, and 3 s through a transcode;
  - a seek inside the cache takes at most 0.2 s; outside it, 0.5 s locally and 1.5 s remotely;
  - A/V sync stays within 20 ms, and an audio or subtitle switch takes at most 0.3 s with no reload;
  - the main process's event-loop lag stays under 20 ms at p99 while playing;
  - on an HDR output `video-target-params/gamma` is `pq`; with passthrough, `audio-out-params/format` starts with `spdif-` and the receiver names the format.
- **After D1:** repeat the shared UI/web tests, unchanged development behavior and Docker smoke checks from P2.
- **After D3 and D5, desktop local library mode:** `bunx nx run @raven/desktop:make` builds an app. Choose "Run on this computer", add a local folder, and let the scan and TMDB matching finish. Then:
  - Play M1 to M15.
  - Lock a library, restart, and use the PIN dialog.
  - Quit while a video plays, and check that the app is gone within 1 s and that no `node` or `ffmpeg` processes remain.
- **After D4 and D5, desktop remote library mode:** connect to Vhagar's URL, then browse, play M2 directly, seek outside the cache, and switch audio and subtitles. Enter the admin password if Vhagar's admin lock is on, then unlock a locked library with its PIN. Throttle the link below M2's bitrate and check that the transcode is offered and plays. Stop the remote and check that Connection lost appears.
- **Full library-mode fallback:** remove libmpv from a build and check that M1 plays through the web engine. The player-only server-title fallback remains the browser. Repeat platform-specific criteria after D6.

## Sources

- mpv `--wid` and options: <https://github.com/mpv-player/mpv/blob/master/DOCS/man/options.rst>
- macOS embedding for the Vulkan context, still open upstream: <https://github.com/mpv-player/mpv/issues/13608>, <https://github.com/mpv-player/mpv/pull/17221>
- The moltenvk context patch: <https://github.com/mpvkit/MPVKit/blob/main/Sources/BuildScripts/patch/libmpv/0001-player-add-moltenvk-context.patch>, <https://github.com/plexinc/mpv/blob/release/0.37/video/out/vulkan/context_moltenvk.m>
- libmpv's render API, OpenGL and software only: <https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h>
- libmpv's client API and threading: <https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h>
- Electron's vibrancy view under the web contents: <https://github.com/electron/electron/blob/main/shell/browser/native_window_mac.mm>
- mpv under WebView2 on Windows: <https://github.com/Stremio/stremio-shell-ng>
- Electron transparent window resizing on Windows: <https://github.com/electron/electron/pull/49428>
- Electron 38 defaults to Wayland: <https://electronjs.org/blog/electron-38-0>
- Audio passthrough: <https://github.com/mpv-player/mpv/blob/master/audio/out/ao_wasapi_utils.c>, <https://github.com/mpv-player/mpv/blob/master/audio/out/ao_pipewire.c>, <https://github.com/mpv-player/mpv/blob/master/DOCS/man/ao.rst>
- libmpv's built-in defaults: <https://github.com/mpv-player/mpv/blob/master/etc/builtin.conf>
- libmpv builds: <https://github.com/shinchiro/mpv-winbuild-cmake/releases>, <https://github.com/mpvkit/MPVKit>
- jellyfin-ffmpeg: <https://github.com/jellyfin/jellyfin-ffmpeg/releases>
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
