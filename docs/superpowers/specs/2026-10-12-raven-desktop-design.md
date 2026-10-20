# raven desktop: a player-first Electron app on shared React UI and embedded mpv

Status: audited against `main` at `5b793f68` on 2026-10-18. Phase 1's implementation, P1 through P7, is merged for **raven player on macOS arm64**. This does not mean every hardware check or performance budget passed. Phase 2 and 3 are not implemented. Download confirmation, resumable transfers and the Downloads page are merged, but downloaded-title playback, progress replay and timed deletion are not complete. The tables below separate those states.

This is the canonical desktop spec, consolidating the original 2026-10-12 desktop design and the 2026-10-14 player-first design. The current deployment decision below takes precedence over the older standalone-library roadmap: **Vhagar is the only server/database for now.** Embedded-server and local-library plans remain deferred, not prerequisites for browsing Vhagar. Companion designs are `2026-10-12-raven-transcoding-design.md`, `2026-10-16-raven-direct-media-design.md` and `2026-10-17-raven-desktop-downloads-design.md`.

The server spike and the macOS half of the native video spike ran on 2026-10-12. "Spike outcomes" preserves their historical evidence and the P7 measurements. A successful spike, a merged implementation and a hardware-validated release are different milestones.

## Current deployment: Vhagar only

- **The only current raven server and authoritative library database is Vhagar at <http://192.168.50.6:8484/>.** The stored origin, which has no trailing slash, is `http://192.168.50.6:8484`.
- Library metadata, scans, matching, server-title progress and history belong to that instance. Desktop is a client of Vhagar, not another raven server or a replica of its database. Do not add an embedded server, another library database or database replication in the current scope.
- Local-file playback remains supported without a server. The desktop's JSON preferences, recents, local resume records and download queue are client state, not an independent library database. Future downloaded media and pending progress reports do not change Vhagar's authority.
- This is a deployment and scope decision, **not an existing hardcoded restriction**. A fresh profile still starts with an empty server list; main accepts explicitly trusted server origins and caps that list at 20. Add Vhagar through Settings or a confirmed link; no default server, migration or single-server enforcement is implemented by this documentation change. Keep the trust prompt and session isolation. Test fixture servers are not additional deployed databases.
- Use Vhagar for integration acceptance. Its LAN address requires connectivity to that network; this spec does not claim that Netlify or an off-LAN client can reach it. Advertised media origins are byte-delivery endpoints, not additional authoritative raven databases. Do not expose the plaintext HTTP address publicly or bypass the normal trust/unlock boundaries.

## Implementation status on main

Completed means the implementation is merged, not that all manual acceptance has passed. Commit ids are representative milestones, not an exhaustive history.

| Feature | Status | Evidence or remaining work |
| --- | --- | --- |
| P0 integration feasibility | Conditional pass, recorded | `b3a916c2`; real browser/Finder and HDR checks were not all exercised |
| P1 engine/chrome split | Completed and merged | `c97b11df`; state-driven progress and host-owned services |
| P2 shared player UI | Completed and merged | `c29bb143`; `libs/raven/ui`, shared tokens and core's `languageName` |
| P3 native mpv foundation | Completed and merged | `c1398e71` and follow-up fixes; wrapper, surface, pinned source build and native tests |
| P4 desktop shell and local files | Completed and merged | `a8859a32` (#179); grants, open/drop handling, recents, resume and HTML fallback |
| P5 native playback | Completed and merged; hardware acceptance incomplete | `d50098ad`, `82e946b3`, `d30c3df5`; tracks, output settings, next in folder and stats |
| P6 server-title playback and web handoff | Completed and merged | `51774c43`, `88927204`, `aafe059a`, `3eed4bca`; trust, unlocks, isolated sessions and server progress/history |
| P7 packaging and release infrastructure | Completed and merged | `f109f7d8`, `bae4800e`, `90a65aa3`; native bundle, ad hoc signing, DMG/ZIP/sources/checksums, updates, diagnostics and CI |
| Download links, confirmation and persisted queue | Completed and merged | `d86dd798`, `4dc1b33f`, `53454f1c` (#206); expansion, unlocks, size/free-space display and queueing |
| Download transfers and Downloads page | Completed and merged | `1762dc8f` (#208); resumable original-file/sidecar transfers, media origins/tickets with cookie fallback, pause/resume/retry/delete and disk usage |
| Downloaded-title playback, progress replay and timed deletion | Not completed | The Downloads page offers Play but main still refuses `openDownload`; watched/deletion views remain empty and offline sync/auto-delete timers are not wired |
| D1 remaining shared UI and thin web shell | Not completed | Library pages, router, queries and API singleton remain in web; no shared `Platform` seam |
| D2 embedded-server entry | Not completed; deferred | No production `startServer` or `./start` export; outside the Vhagar-only scope |
| D3 standalone local libraries | Not completed; deferred | No local host, chooser, desktop scans/matching or local library database |
| D4 in-app Vhagar library browsing and slow-link transcoding | Not completed | No remote library host/proxy, Connection lost screen or native MKV-transcode path |
| D5 Intel Mac and full library distribution | Not completed | No macOS x64 pipeline; standalone ffmpeg bundling remains deferred with the embedded server |
| D6 Windows and Linux | Not completed | No platform spikes, native surfaces, packaging or CI for those platforms |
| Full hardware and packaged-app acceptance | Not completed | XDR/120 Hz, full media/output matrix and manual Finder/Dock/browser/Gatekeeper checks remain owed |
| All performance budgets | Not completed | Idle Home memory measured 424 MB against 300 MB; cold launch, cold open-to-frame, paused CPU and ten-minute M2 memory remain unmeasured |
| Developer ID signing, notarization and silent updates | Not completed | Signing/notarization hooks exist but are not enabled; current signing is ad hoc and updates notify only |

### Code changes since the first-release design

- **Services use zustand, not a React context.** `libs/raven/ui/src/stores/playerServices.ts` exposes `useHostPlayer`; the player-owning component waits for it to return true before rendering the player. Desktop bridge, notice and download-dialog state also live in renderer stores. The old player-services provider and the proposed shared-state `RavenProvider` are not current APIs; D1 must use stores under the workspace rules.
- **The player contracts grew.** `EngineHandle.readStats`, optional `EngineActions.toggleStats`, optional HTML-server `mediaPlane`, and optional host services for favourites, menu actions, track picks, traffic lights, fixed volume, handoff and native-error recovery are implemented. The shared player also carries the Verdigris/theme redesign and the browser's Playback info panel. A host does not get favourites or server actions unless it supplies them.
- **The server allowlist grew from eight to thirteen calls.** The three item/library/saga reads support download expansion. Media-origin and media-ticket calls are main-only; they are refused when requested by the renderer. Section 4 records the exact boundary.
- **Web and downloads use media origins; desktop streaming still uses cookies.** Web uses the shared origin-probe/ticket helpers and an optional `HtmlSource.mediaPlane`. Desktop downloads now select/probe media origins, renew tickets and fall back to server-session cookies when no origin is advertised. Streaming through `src/main/servers/serverSources.ts` still builds the trusted server's `/file` and sidecar URLs with its session cookies; it has not adopted the download media-access path.
- **Downloads now transfer files, but offline playback is not wired.** #208 adds the ranged transfer worker, original video/sidecar fetching, launch recovery, sleep/wake handling, pause/resume/retry/delete, Downloads page, Home badge and Settings controls on top of #206's consent/expansion. Version-1 `downloads.json` remains the guarded queue/store. The row's Play sends `openDownload`, which main explicitly refuses pending the playback slice. `watched` and `deletesAt` are still null; storing the delete-on-watched preference does not implement progress replay or the deletion timer.
- **Navigation also changed.** `5b793f68` (#216) adds web history-aware Back controls and the shared `useCanGoBack` helper; the player leave action follows the host's own history. Preserve that behavior during D1 rather than restoring the original fixed back-link design.
- **Build/tooling differs from the original sketches.** Main is bundled with Bun, preload is bundled CommonJS, CSS linting uses gale, and protocol/engine/source identifiers use imported `as const` constants. The exact contracts live in source rather than copied TypeScript examples here.
- **Native cleanup has a merged fix.** `58df5c30` (#193) finishes Node exit cleanup on the loop thread after off-thread termination. Native tests cover abandoned engines; the old blanket teardown-segfault warning is no longer an accurate description of current main. Explicitly destroying mpv before the window remains required.

## Context

The current goal is a desktop client of Vhagar that also plays local files. The longer-term standalone goal, installing raven and scanning/matching local folders without a NAS or Docker, is retained below as a deferred design, not current scope. Nothing may be written twice:

- the business logic stays in `@raven/core` and `@raven/server`;
- the React UI moves into a new library, `@raven/ui`, that both `@raven/web` and `@raven/desktop` render.

The player holds most of the value and most of the risk (the native video surface), but is coupled to the least code. It ships before the full UI extraction, the embedded server and library modes.

raven player opens a local video file or a title on a raven server through libmpv under raven's own React controls. It is not a second product: it is `@raven/desktop` with only its player built. The product name becomes "raven" when library modes arrive; its bundle id and data directory do not change.

The original web-only escape was "Copy file link" for VLC or IINA. That lost raven's controls, progress and history, and failed for a locked library because its cookie stayed in the browser. The implemented shared `libs/raven/ui/src/components/Player/Unplayable.tsx` now also offers "Open in raven player" when the web host's setting is on. Copy remains available; the desktop uses its own trusted session and unlock flow.

### Delivery phases and architectures

| Phase | Scope | Targets |
| --- | --- | --- |
| 1: raven player | Local files, server-title handoff, native playback, resume and recents; no embedded server or library browsing | macOS arm64 (Apple Silicon) |
| 2: library client, not started | Remaining shared UI, Vhagar library browsing and slow-link transcoding; embedded server and local libraries deferred | macOS arm64, then macOS x64 (Intel) |
| 3: additional platforms | Native surfaces, platform validation, CI and packaging | Windows x64 and Linux x64; Linux initially uses X11 |

Windows arm64 and Linux arm64 are not specified. The current player ships neither standalone ffmpeg nor an embedded server. A Vhagar-only library client does not require them: server-side transcoding belongs to Vhagar. The deferred standalone mode would add them; FFmpeg inside libmpv is already present.

### The playback goal

These are acceptance goals, not a statement that the complete codec/HDR/output matrix has been verified. The current implementation and outstanding hardware checks are listed above.

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
| Standalone ffmpeg | Not bundled in the Vhagar-only client; portable jellyfin-ffmpeg builds remain a deferred embedded-server proposal |

### Player-first application decisions

| Question | Answer |
| --- | --- |
| A new app, or the start of desktop raven? | The start of desktop raven: `apps/raven/desktop` (`@raven/desktop`), product name "raven player" until the library modes ship |
| App identity | Bundle id `io.github.codebend3r.raven`; `userData` pinned to `~/Library/Application Support/raven` from the first build, so the rename to "raven" moves no data |
| What it plays | Local files the user opened, and titles on raven servers the user added |
| How server titles arrive | A `raven://play` link from raven web, a pasted raven link, or Open Recent. No library browsing |
| Fallback | The web engine for local files Chromium decodes; server titles open in the browser |
| Renderer origin | `app://raven`, a privileged custom scheme served from the asar, with a memory router |
| How the renderer reaches a server | Main owns network access. Thirteen calls are allowlisted, eleven available to the renderer and two main-only; mpv currently reads direct server URLs with session cookies |
| Window count | One |
| Local state | JSON files in `userData`, written atomically and checked with core's guards on read |
| Updates | Check GitHub Releases and say so; no silent install while builds are ad hoc signed |
| Crashes | Local minidumps and a rotating log; no third party, no telemetry |
| Tests | `bun test` for units, Playwright's Electron support for end to end, headless libmpv tests (section 9) |

## What exploration found

These are historical design-time findings, before production desktop implementation. Paths, counts and duplicated helpers in this section describe that exploration, not the audited current tree. "Implementation status on main" and the source contracts below describe current code.

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
apps/raven/server   @raven/server   deployed on Vhagar; embedded `startServer` export deferred
```

`@raven/ui` is raven's own library, not a suite-wide one. rookery has different tokens (`--color-parchment` against raven's `--color-bark`) and shares no components.

Current `@raven/ui` contains the shared player, primitives, unlock dialog, styles and player/media-plane helpers. Library pages and the API singleton remain in web. D1 extracts the rest; a production `startServer` remains deferred with standalone mode.

## 1. `libs/raven/ui` (`@raven/ui`)

### Player extraction (P2, merged)

This records the completed extraction boundary. The remaining library UI is still D1 work.

- **What moved from `apps/raven/web/src`:**
  - `components/Player/`, `components/Button/`, `components/Icon/`;
  - `lib/canPlay.ts`, `lib/keyboard.ts`, `lib/shortcuts.ts`, `lib/streamSource.ts`, `lib/trackLabels.ts` and their tests;
  - `stores/playerPrefs.ts`;
  - `styles/` (`globals.scss`, `elements.scss`, `designTokens.ts`), since every module the player brings uses the tokens and the desktop renderer needs them too;
  - `managed-media-source.d.ts`, which `streamSource.ts` needs.
- **What stays in web:** `lib/api.ts`, `lib/queries.ts`, `lib/queryClient.ts`, `lib/invalidate.ts`, `lib/itemLinks.ts`, `lib/usePlaybackPolicy.ts` and `stores/unlockPrompt.ts`. They serve the whole library, and the player reaches what it needs of them through `PlayerServices` and its `HtmlSource`.
- **`languageName`** was deduplicated into core at P2; shared track labels and web's ImageEditor now import it (section 6).
- **`UnlockDialog`** moved into UI at P6 and is shared by web and desktop.
- **Build, config and tests** follow "Exports and build" below from the first extraction.
- **Current exports:** `Player`, `useHostPlayer`, engine/services/state types, shared primitives, `UnlockDialog`, player/media-plane/query/theme/token helpers and `@raven/ui/styles.css`. `libs/raven/ui/src/index.ts` and package exports are authoritative.
- **Docs:** the root `CLAUDE.md` CSS section and `apps/raven/CLAUDE.md` point raven's `globals.scss` and `elements.scss` at `libs/raven/ui/src/styles/`, and `@raven/ui` joins the project table. The `/design` page's import of `globals.scss` follows the file.
- The Docker image still builds `@raven/web`; `libs/raven/ui` is already included in `apps/raven/Dockerfile.dockerignore`.

#### P2 extraction adjustments

The P1 closure also includes `lib/playerQueries.ts`. It moves with its tests, while the web query client reuses the three `playerQueryKeys` definitions exported by UI so cache identity and invalidation stay unchanged. `lib/tokens.ts` and its tests move because the shared `designTokens.ts` depends on them. The `/design` page itself stays in web until D1, importing `@raven/ui/designTokens`.

The built package exports the shared Button/Icon primitives, Controls (for the existing design page), player preferences, keyboard helpers, token helpers, `playerQueriesFor` and `playerQueryKeys` where the remaining web UI needs them. Two narrowly scoped built module entries, `@raven/ui/canPlay` and `@raven/ui/designTokens`, retain the host tests' module boundaries. Vite emits one capability implementation, imported by the player and exposed through the public subpath, not a source alias or injected test-only production API.

Player tests are split by ownership. Engine, chrome, track, subtitle, navigation and shortcut scenarios move into UI, with a local PlayerServices fixture and query/router harness. Clipboard, server progress/history and browser host integration stay in web's `WatchPlayer.test.tsx`; it also verifies that mocking the public capability module affects the built player. Both test targets retain the 96% line and 88% function floors and count their own source, not library dist. UI adds source-named timeline, video state, fullscreen and shortcut tests. Core's single `languageName` accepts an optional fallback spelling so track labels and ImageEditor retain their existing invalid-tag behavior.

### Remaining extraction (D1, not implemented)

Use `git mv` for the files that still remain in `apps/raven/web/src` so history follows the files: library components, pages, stores, helpers, query layer, router and tests. Do not move the player/styles/declarations a second time. Keep extraction separate from behavioral changes, preserving the current media-plane, themes, handoff and favourites behavior. This client work needs no embedded server or new database.

### Player engines and chrome

The implemented contracts are in `libs/raven/ui/src/components/Player/engine.ts`; use those types rather than duplicating a parallel shape. Discriminants use `ENGINE_KINDS` from UI and `PLAYER_SOURCE_KINDS` from core.

| Contract | Current responsibilities |
| --- | --- |
| `EngineActions` | Play, pause, seek, volume/mute, rate, audio, subtitle and subtitle scale; optional `toggleStats` for a native overlay |
| `EngineHandle` | `VideoState`, duration, position ref, tracks, actions, surface, focus restoration, whether subtitles are drawn by the engine, and `readStats` |
| `EngineStats` | Engine label, viewport dimensions/scale, decoded frame size and dropped/total frames where available |
| `NativePlayer` | Guarded command/reply channel and event subscription, not raw mpv access |
| `HtmlSource` | Server media plus API client and optional `mediaPlane`, or a local granted-file URL |
| `Engine` | HTML source, or native player plus a guarded core `PlayerSource` |

- **Both engines are implemented.** `Player` chooses the native branch or HTML player; HTML `Stage` calls `useHtmlEngine`, and `NativeStage` calls `useNativeEngine`. Both render `PlayerChrome`. Engine-specific hooks stay in separate components, not conditionally selected within one hook sequence.
- **HTML** uses `useVideoState`, `useVideoEvents`, `useMediaSource` and `streamSource.ts`. Local files play directly with no server tracks. Web server sources can use the media-plane origin/ticket path.
- **Native** sends `PlayerCommand`s and folds `PlayerEvent`s into the same reducer through `fromPlayerEvent`. mpv draws its own subtitles; the chrome never reaches into a video element.
- **Ended state is implemented.** `played` and `sought` clear `ended`; up-next/progress follow state rather than element events.
- **Progress** starts on the first unpaused/non-waiting state, saves on a 10 s move or pause, saves the end position, and saves/leaves on unmount. `pagehide` also saves; optional `progress.duration` receives a newly learned positive duration.
- **Diagnostics have two paths.** HTML Playback info uses `readStats` and library file facts; native Video Info toggles mpv's built-in overlay. No live native stats event was added to the core protocol.

### Services

The shared player imports no web singleton. Its host supplies the `PlayerServices` contract in `libs/raven/ui/src/components/Player/PlayerServices.ts` through the zustand store in `libs/raven/ui/src/stores/playerServices.ts`.

The component whose lifetime owns the player calls `useHostPlayer(services)` and renders `<Player>` only after it returns true. This prevents a new player's first render from reading the previous host's resume/title. Desktop's `NativePlaying` and `HtmlPlaying` are separate hosts when switching engines; services are not passed through a React context.

| Services | Current contents |
| --- | --- |
| Required | Title/duration/resume/back/up-next, progress sink, nullable poster and escape action |
| Progress sink | `started`, `save`, `left`; optional learned `duration` callback |
| Escape presentation | Optional icon, hint and host-owned feedback, including clipboard failures |
| Optional host integrations | `hostActions`, `favourite`, `trackPicks`, `chrome`, `isVolumeFixed`, `unplayableNote`, `handoff`, `onEngineError` |

- `focusSurface` preserves Start over/focus behavior without exposing a video DOM node. The host owns clipboard APIs and action feedback.
- Web's `WatchPage` still builds services from its API singleton for server progress/history and navigation. Player query factories use the `HtmlSource` client and shared query keys, preserving web cache identity/invalidation.
- Desktop saves local progress/tracks in its client JSON state and sends server-title progress/history to Vhagar through main. D1 changes host-side API injection, not the engine/services contracts or their lifetime rules.

### Why the split happens in place first

The split lands in `@raven/web`, with no visible change, before any file moves. Its diff then reviews as logic, and the move after it reviews as a pure `git mv`, which keeps `git log --follow` working. This is P1, before the player extraction at P2.

### The platform seam (D1, not implemented)

The shared library UI still needs a discriminated browser/desktop `Platform` contract, an injected API client and query factories, and desktop output/player actions. `PlayerCommand`, `PlayerEvent` and `OutputSettings` already live in core. Declare identifiers as imported `as const` values and derive types from their source, as current code does.

Use a zustand store and selectors, with a host initialization boundary, not a new React context/provider for shared state. The earlier `RavenProvider` sketch is superseded by the workspace's store rule. The host retains the library-required TanStack Query and router providers. A proposed `useRaven` selector API is future work, not an export today.

Keep the existing player-services host lifetime and native/HTML fallback. Retain "This computer" as per-machine client settings. General "Switch server" and a local/remote chooser are not required for the Vhagar-only deployment. Future library-mode fallback and routing still need the explicit origin/security decision in section 4.

### Replacing the `api` singleton (D1, not implemented)

- Remove `lib/api.ts` from the shared import graph when D1 lands. Each host will build its client and inject it through the planned platform/store boundary.
- `lib/queries.ts` becomes factories over the host's injected API client, initialized once at the host/store boundary.
- These files will take the API through the planned store selectors instead of the singleton import:
  - `lib/useMediaMutations.ts`, `lib/useServerEvents.ts` (`api.eventsUrl()`) and `lib/streamSource.ts` callers
  - `invalidate.ts`, wherever it touches the client
  - the remaining importers, which take `api` or `queries` through the planned store selectors; 55 was the exploration-time count

  This is planned mechanical work, not the current implementation. Inject the client at the host boundary so the same UI works in web and desktop without importing the web singleton. Vhagar remains the intended sole authoritative library for both clients.

Keep `NativePlayer` and `PlayerServices` rather than reimplementing the player. Library-mode engine selection and direct-then-remote-transcode policy are not wired today. Native pages must remain transparent over mpv, which draws subtitles and switches tracks without reloading.


### Exports and build

- **Planned full-library exports** (current player-only exports are listed above):
  - host initialization/store selectors, `ravenRoutes`, the `Platform` types and guards for desktop actions; these are planned, not current exports
  - the UI building blocks the desktop renderer uses for its own screens: `AppShell`, the dialog and button primitives, and `UnlockDialog`
  - `@raven/ui/styles.css`
- D1 will export the remaining web `AppRoutes.tsx` route tree as `ravenRoutes` route objects. That export does not exist today. Each host will make its own router and may add routes.
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
  - `gale.json` extends `tooling/gale/recommended-scss.json` and `tooling/gale/rules.json`; gale replaced stylelint. `.oxfmtrc.json` is identical to the others.
- **Tests move with their files.** They run with `bun test`, happy-dom and the SCSS loader in `tooling/web`. The UI harness seeds/resets the player-services store and uses query/router providers; production-like test hosts call `useHostPlayer`. D1's harness must initialize the planned platform store rather than add a context. Native-engine tests use a fake `NativePlayer`.
- **Tokens already moved:** `globals.scss`, `elements.scss` and `designTokens.ts` are in `libs/raven/ui/src/styles/`, with shared theme definitions beside them. The redesigned `/design` page remains in web until D1.

## 2. `@raven/web`: shared player first, thin shell later

### First release: "Open in raven player"

- **A per-browser setting,** "Open videos in raven player", in the Playback section of Settings, stored with `usePlayerPrefs`. It is off by default: a page cannot tell whether an app is installed, and an unhandled `raven://` link does nothing in Chrome and shows an error in Safari.
- **When it is on:**
  - Unplayable offers "Open in raven player" as its primary action, above "Copy file link".
  - The player's settings menu offers it too, with the current position as `at`, after pausing.
- The link carries `location.origin` as the server and the up-next ids the web already has from Play all.

### Phase 2: thin shell (D1, not implemented)

The intended remaining files in `apps/raven/web` are `index.html`, `vite.config.ts` (with the `/api` proxy) and `src/main.tsx`. `main.tsx` does the following:

- imports the fonts and `@raven/ui/styles.css`;
- builds `createApiClient({ fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === 'PUT' }) })`, the logic moved from today's `lib/api.ts`;
- initializes the planned browser platform/store and renders the library-required query/router providers around `createBrowserRouter(ravenRoutes)`; no shared-state context/provider is added.

The Docker image already builds `@raven/web` after UI through Nx's dependency build. `libs/raven/ui` is already allowed in `apps/raven/Dockerfile.dockerignore`; preserve that inclusion. The GHCR publish check reads the same allowlist, so shared-library changes republish the image.

## 3. `@raven/server`: one embeddable entry (deferred D2)

This section preserves the standalone-mode proposal. It is not implemented and is outside the current Vhagar-only scope. The production server's `main.ts` still sizes the threadpool, reads config, creates the app and listens directly; there is no production `startServer` export. Do not make D2 a prerequisite for Vhagar library browsing.

- Add `src/startServer.ts`, which exports `startServer({ env }): Promise<{ url: string; close: () => Promise<void> }>`. It runs `sizeThreadpool`, `readServerConfig(env)`, `createApp`, then `listen`.
- `close` drops open connections before it closes the app: `getHttpServer().closeAllConnections()`, or the Fastify adapter created with `forceCloseConnections: true`. Nest's `app.close()` otherwise waits on a stream's connection, which Chromium keeps open after its window is gone; the spike's quit stalled 5 s mid-stream and the host was killed. With it, the host closes in under 15 ms.
- Reduce `main.ts` to `await startServer({ env: process.env })`.
- In `apps/raven/server/package.json`, add `"exports": { "./start": { "types": "./dist/startServer.d.ts", "default": "./dist/startServer.js" } }`.
- Docker's `node dist/main.js` is unchanged. No module moves, and Nest stays, because Electron runs Node.

## 4. `apps/raven/desktop` (`@raven/desktop`)

### Why Electron over Tauri

- **Node is built in.** It supports the main-process native player, file grants and session APIs without another runtime. The original embedded-server rationale also remains technically feasible: a future Node server could run in a `utilityProcess`, whereas Tauri would need a Node sidecar. That server is not running in the current client.
- **The UI renders in one engine everywhere.** Electron is Chromium on every OS, the engine the web app is already built and tested against. Tauri means WKWebView on macOS and WebKitGTK on Linux.
- **Video does not depend on either.** libmpv draws it natively (section 5), so Chromium's codec list no longer limits the desktop. Chromium's `<video>` and MSE remain only as the fallback engine, where `checkDirectPlay` and `planPlayback` still pick direct, remux or transcode on their own.
- **Config stays TypeScript.** Electron Forge reads `forge.config.ts`, so the TypeScript-only rule holds.

### Current player layout

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
  src/main/servers/       trusted servers, isolated sessions, allowlisted API calls and cookie-backed sources
  src/main/downloads/     downloads.json, consent/expansion, media access, resumable transfers and queue
  src/main/log/           rotating redacted log
  src/main/player/        the player service: owns @raven/mpv, resolves sources, answers the bridge (section 5)
  src/main/updates.ts     the release check
  src/preload/preload.ts  contextBridge.exposeInMainWorld('ravenDesktop', ...): requests, file drops, the player's MessagePort
  src/renderer/main.tsx   query/router setup and desktop bridge initialization
  src/renderer/stores/    zustand desktop bridge, notices and download ask
  src/renderer/routes.tsx memory routes: Home, Play, Server, Settings, Downloads
  src/renderer/HomePage/  open, drop, recents and Downloads badge
  src/renderer/DownloadsPage/ transfers, disk usage, pause/resume/retry/delete; Play not wired in main
  src/renderer/PlayPage/  the Player from @raven/ui with the native engine, or html as the fallback
  src/renderer/ServerPage/    server title, unlocks and browser fallback
  src/renderer/Shell/         navigation, open-link dialog and download-confirmation dialog
  src/renderer/SettingsPage/  servers, "This computer", updates, recents and download controls
```

Scripts are one command each and listed in `nx.includedScripts`. There are no hosts to bundle. `build:main` uses `bun build --target node --format esm --external electron` rather than tsc plus tsc-alias. A sandboxed preload cannot load ESM or workspace packages, so `build:preload` bundles it to one CommonJS file with `bun build --format cjs`, leaving `electron` external. Vite builds the renderer; tsgo separately checks main/preload/renderer types. `e2e` runs Playwright on macOS CI, outside portable `verify` (section 7).

### Processes

- **Main:** the window, the menus, the grants, the state store, the servers, and the player service with libmpv. It never blocks: libmpv is async only (section 5), file reads are async, and the state store writes off the hot path.
- **Renderer:** one sandboxed window loaded from `app://raven`. It holds no paths, no cookies and no network access beyond its own origin.
- **No utility process** in current code. D2/D3's embedded host is deferred; D4 must decide whether Vhagar browsing needs a local proxy host or a different secured integration.

### Opening files

Every way in ends in the same call in the main process, `grant(path)`. It checks that the path is an existing regular file and that `isVideoFile` accepts its name, then returns a random `fileId` and remembers the path for the session. The renderer only ever holds ids.

- **Open dialog** (`dialog.showOpenDialog`, video types only) and **Open Recent** (the native menu, through `app.addRecentDocument`).
- **Drag and drop on the window:** the page hands the dropped `File` to the preload, which calls `webUtils.getPathForFile`. A `File` the page made itself has no path there, so a compromised page cannot name one. Multiple files: the first plays and the rest become the up-next list, in the order dropped.
- **Finder, the Dock icon and file associations:** `open-file` events, listened for in `will-finish-launching` so a cold launch catches them, and queued until the window is ready. Document types come from `VIDEO_EXTENSIONS` by UTI (`public.movie`, `public.mpeg-4`, `com.apple.quicktime-movie`, `public.avi`, `public.mpeg-2-transport-stream`, plus imported declarations for `org.matroska.mkv` and `org.webmproject.webm`), never by bare extension, so `.ts` source files stay with the editor. `LSHandlerRank` is `Alternate`: installing the app takes nothing over until the user picks "Always Open With".
- **Next in folder:** when a local file ends, the next video in its folder by natural order (`Intl.Collator` with `numeric`) plays, and the Next button shows it as soon as playback starts. Folder siblings with video extensions count as granted, as mpv's and IINA's autoload do.
- **Opening while playing** saves the current position first, then replaces the video. There is one window.

### Server titles

- **Servers are added on purpose.** For the current deployment, add Vhagar at `http://192.168.50.6:8484`. Settings still supports a general trusted-server list; each entry has an opaque id, stored origin and editable name. The initial name is derived from its origin, not discovered from a server-name endpoint. Adding one from a link shows a native dialog from main, so the page cannot fake consent and nothing is fetched before agreement. Main probes `/api/lock` after consent.
- **The play link:** `raven://play?server=<origin>&media=<id>&at=<seconds>&next=<id>,<id>`. A pasted `https://<origin>/watch/<id>` (Open Link, Command L) reads the same way. `readPlayLink` in `src/shared/` parses both into a `PlayRequest` and rejects anything else: an origin that is not http or https or has a path, query or credentials, a media id that is not a positive whole number, a negative `at`, more than 100 `next` ids.
- **One session per server**, `persist:server:<serverId>`, for the same reason as the per-mode library sessions below: cookies are scoped by host, and one server's unlock must not ride along to another.
- **The allowlist.** The renderer's `ApiClient` uses a bridged fetch. Main checks method, full path and body against `src/main/servers/allowlist.ts`, rebuilding its request from narrowed fields. Thirteen calls exist: the original eight (`getMedia`, `getTracks`, `saveProgress`, `recordPlay`, `getLock`, `unlock`, `getAdminLock`, `unlockAdmin`), three download-expansion reads (`getItem`, `getLibrary`, `getSagas`), and two main-only calls (`getMediaOrigins`, `getMediaTicket`). `isPageCall` refuses the last two at the renderer boundary; the renderer can invoke eleven. Calls use the trusted server's session, refuse redirects and time out after 10 s. Replies are capped at 1,048,576 characters, except saga expansion at eight times that cap. Six reads may be in flight per server, with two extra slots reserved for PUT/POST calls. Off-list calls are refused and logged.
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
| Update-check preference and last check | `desktop-config.json`, version 4 | none | none | on change/check |
| Download queue and delete-on-watched default | `downloads.json`, version 1 | server id and media id | expansion capped at 500 files | on queue/state change; flush on quit |
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

### Library hosts and layout (unimplemented proposal)

The local host and chooser below are deferred with D2/D3. Vhagar browsing is future D4 client work and must not add another server/database. This layout preserves the original host/proxy option, not an assertion that it exists or a requirement to ship local mode first. Re-evaluate the remote origin/routing/security integration before implementation.

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
  src/renderer/main.tsx   planned platform-store setup, query provider and router of shared plus desktop routes
  src/renderer/ChooserPage/  first run: "Run on this computer" or "Connect to a server", built from @raven/ui parts
  src/renderer/ConnectionLost/  shown when the remote server cannot be reached
```

### Proposed library-mode transport (not implemented)

The original library-mode design loads the renderer from `http://127.0.0.1:<port>` with `baseUrl: ''`. Cookies, SSE and the API then stay same-origin, exactly as in the browser.

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

**Library-client decision gate (D4 now, D3 only if revived):** whether player-only screens move to a library host's origin or keep `app://` remains open; the host/proxy is not implemented. The player depends on `PlayerServices`, not the origin. Before in-app Vhagar browsing ships, record the origin, routing, frame validation, media-ticket ownership and CSP changes here, preserving the current security baseline. Do not copy the player-only `connect-src 'self'` policy unchanged if the integration needs additional connections.

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
- **ffmpeg (deferred standalone mode only):** the Vhagar-only client needs no standalone ffmpeg. If local mode returns, a `fetch:ffmpeg` script downloads a pinned jellyfin-ffmpeg portable build per platform (macOS arm64 and x64 in phase 2; Windows x64 and Linux x64 when those platforms ship). It has zimg, the SIMD tone mapper `tonemapx` and the hardware filters the transcoding spec uses. It is GPL, which matters only if the app is distributed publicly.
- **libmpv:** a `fetch:libmpv` script, in `@raven/mpv`, places the pinned libmpv for the platform beside the addon (section 5).
- **Scripts** (one command each, chained with `bun run --sequential`, all in `nx.includedScripts`):
  - `build`: `build:clean`, `build:renderer` (vite), `build:main` (bun build), `build:preload` (bun build); host builds are future work only if the chosen library integration needs them
  - `typecheck`: parallel `typecheck:main`, `typecheck:preload` and `typecheck:renderer`
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

Current helper ownership and remaining D1 work:

- `languageName` already lives in `libs/raven/core/src/languageName.ts`; both shared track labels and web's ImageEditor import it. Do not repeat that move.
- Rating `score` lookups and sortable `COLUMNS` still exist in web's MediaList and ShowViews, with media/show-specific shapes. Consolidating reusable logic remains D1 work, preserving those distinctions.
- Web's `pages/LibraryPage/librarySections.ts` still owns the tab rules. Moving the pure rules beside core's `KIND_RULES` remains D1 work.

Also in core: `OutputSettings`, the "This computer" shape, with `isOutputSettings`. The renderer, preload and main process import it with the player protocol below, so the bridge has one contract.

Other UI helpers belong in shared UI when their consumers move, not in core merely because there are two React hosts. `shortcuts` and player selection already live in UI; library helpers such as `jumpScale`, `letters`, `itemFacts` and `history` still live in web. D1 moves the remaining reachable helpers and tests without inventing unused exports.

### Player protocol

`libs/raven/core/src/player.ts` owns the implemented guards and derives their types with `Infer`. It is the source of truth, not a copied shape in this document. Runtime identifiers come from `PLAYER_SOURCE_KINDS`, `PLAYER_COMMANDS`, `PLAYER_EVENTS`, `PLAYER_ERROR_REASONS` and `PLAYER_REFUSAL_REASONS`.

| Boundary | Current contract |
| --- | --- |
| `PlayerSource` | Granted `fileId`, or trusted `serverId` plus `mediaId`; never a renderer-authored path or URL |
| `PlayerCommand` | `load`, `play`, `pause`, `seek`, `audio`, `subtitle`, `volume`, `speed`, `subtitleScale`, `stats`, `stop` |
| Load fields | Source, start time, nullable audio index and nullable subtitle id |
| `PlayerEvent` | Time, buffered ranges, paused/waiting, duration/rate, `MediaTracks`, ended, or error with reason/message |
| `PlayerRequest` | Request id and guarded command |
| `PlayerReply` | Matching id and `ok: true`, or `ok: false` with both refusal `reason` and `message` |
| Refusal reasons | `refused` for a rejected command; `engine` when the native engine is gone and cannot answer again |
| `OutputSettings` | Audio profile, device, passthrough formats and spatial-audio preference, with core guards/defaults |

- `stats` toggles mpv's built-in overlay. HTML Playback info reads the engine handle; no native stats stream crosses the bridge.
- Shape guards reject non-finite numbers through `isNumber`; main validates ids/track indexes and clamps values where applied: volume 0 to 1, speed 0.25 to 4, subtitle scale 0.5 to 3, and seek to the duration. Do not treat numeric shape acceptance alone as a filesystem or server grant.
- `player.test.ts` covers variants and malformed fields. The separate desktop request/reply/event guards live in `apps/raven/desktop/src/shared/protocol.ts`, including the newer download ask/queue views.

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
- **Updates:** at launch, at most once a day, and from the menu, the app reads up to five pages of `codebend3r/maester`'s GitHub releases and selects a stable version carrying the arm64 DMG, rather than trusting `/releases/latest`, which may name a build without the app. A newer one shows a quiet notice with a link to its release page. Squirrel.Mac requires a Developer ID signature, so silent updates wait for one; `updates.ts` is shaped so the notice can become an install then. The check can be switched off.
- **Version:** the app takes the workspace's shared version, so `version-bump` covers it and About shows it.
- **Crash reports:** `crashReporter.start({ uploadToServer: false })` keeps minidumps in `crashDumps`. A rotating log (5 files of 1 MB in `logs`) records launches, opens, the bridge's refusals, mpv's warnings and errors, and the budget marks. Help offers Show Logs, Show Crash Reports and Copy Diagnostics (app, Electron, mpv and FFmpeg versions, `hwdec` support, the display's refresh rate and EDR headroom). Nothing leaves the machine unless the user sends it.

### CI and release

- **Portable PR checks:** `✅ Checks` runs workspace format/type/lint/unit/build and dead-code/dead-CSS targets on Ubuntu, distributed through Nx Agents when the token is available. `@raven/mpv:build` compiles only the TypeScript wrapper; native builds/tests remain separate macOS targets.
- **macOS PR jobs:** `🎞️ Desktop native` builds/audits/tests pinned native resources and hands them to parallel `📦 Desktop app` and desktop playback jobs. App builds/makes/audits/smokes the package; playback runs main-service native tests and Playwright e2e. The aggregate required `🖥️ Desktop` check depends on all of them. Outputs include app artifacts and matching native sources. These automated/headless jobs do not certify the visual hardware matrix.
- **Release:** `.github/workflows/desktop-release.yml` runs on three-component version tags (including prerelease suffixes), not four-component build tags. It checks the app version, builds/signs/audits/smokes arm64, and attaches the DMG, ZIP, matching sources tarball and `SHA256SUMS`. A path-filtered PR or dispatch is a dry run, never publication. Developer ID signing/notarization are wired but disabled.

- **Future matrix:** add macOS x64 and package both DMG and ZIP per architecture. Standalone ffmpeg bundling stays deferred with local mode. Build libmpv or restore it from the cache keyed by pinned sources; build the addon and run `bunx nx run @raven/desktop:make`. Windows x64 and Linux x64 join with their own CI runners and installer or package formats only after D6's platform spikes pass.
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
  - downloads cover link/queue/store guards, consent/expansion, space reporting, ranged transfer/recovery, media access, queue controls and Downloads/Settings UI; downloaded-title playback, offline progress replay and timed deletion remain unwired;
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
| 120 Hz pacing and EDR remain unmeasured despite the P5 merge | Record XDR measurements before claiming HDR/120 Hz acceptance. If they fail, ship the documented `target-colorspace-hint=no` fallback and record the gap |
| Gatekeeper blocks an ad hoc signed download | The release notes cover "Open Anyway". Developer ID signing and notarization are already wired, off until there is a certificate |
| A web page fires `raven://` links at the app | Only added servers play; an unknown origin needs a native confirmation; links carry ids, not URLs; nothing is fetched before consent |
| A crafted file exploits FFmpeg inside libmpv | Files open only by the user's action; libmpv runs without scripts or ytdl; the pinned libmpv is rebuilt for FFmpeg security releases |
| The split regresses the web player | P1 and P2 ship with no visible change, the Player's tests pass unchanged, and M1 and M2 are checked by hand in Chrome and Safari |
| The main process stalls while playing | Async libmpv only, small JSON on the bridge, lag logged and asserted in e2e |
| Playwright's Electron support is experimental | e2e drives the page and `electronApp.evaluate` only; a break pins Playwright and never blocks the unit tests |
| A handoff names the web origin rather than Vhagar's own origin | Desktop still builds cookie-backed URLs from the trusted origin; use Vhagar's origin on its reachable LAN. Web's media-origin/ticket path has landed, but desktop streaming and a canonical handoff-origin change have not |
| Distributing GPL libmpv brings source/notice obligations | P7 includes matching pinned sources, patches and build scripts in the release assets; preserve that source offer and provenance with every public binary |
| The slice grows into the full desktop app | The non-goals above, and exit criteria on every step |

## Rollout

1. P1 and P2 merge behind no flag: the web player must look and behave exactly as before, checked on Vhagar after the deploy.
2. P3 to P6 produce an unsigned app on every PR (the macOS job's artifact) for testing by hand.
3. P7 tags the first release with the dmg. The web setting is turned on per browser, by hand, where the app is installed.
4. Continue in the same app with D1 then D4 for Vhagar browsing; D2/D3 stay deferred. Intel and other platforms follow the future matrix. Complete the owed hardware/budget checks rather than treating the implementation merge as acceptance.

Turning the web setting off withdraws the handoff; the app needs nothing from the web to play local files.

## Decision rationale

These choices describe the first release unless a later phase is named.

| Question | Answer | Why |
| --- | --- | --- |
| A separate app, or the start of desktop raven? | The start, in `@raven/desktop` | One native stack, one release pipeline, one update channel; data and associations carry over |
| Browse servers inside the app? | No | Browsing is the full `@raven/ui` move, most of the cost; the web already does it |
| How does the renderer reach a server? | Thirteen main-process calls, eleven renderer-callable; mpv still uses direct cookie-backed server URLs | No local port/proxy or cookies/tickets in the renderer. Origin/ticket calls are main-only. Library transport remains a D4 decision |
| Fallback for server titles | The browser | The web player is already that fallback, with every rung of its ladder |
| More than one window? | No | One libmpv surface is what the spike proved; nothing asks for two videos at once |
| Take over double-click on install? | No, `Alternate` rank | Installing a player should not change what Finder does until the user says so |
| Only one deployed server/database? | Vhagar at `http://192.168.50.6:8484` for now | The desktop is a client; embedded/local-library databases and multi-server deployment are deferred, not secretly implemented by the existing server-list UI |
| Intel Macs? | Later | Halves the libmpv build; the spike and the test matrix are Apple Silicon |
| Convert for slow links? | Later, direct play only | Needs the transcoding spec's mkv container; a home network and Tailscale carry a remux |
| Local library database or client JSON? | Client JSON only | The sole authoritative library database stays on Vhagar. Local preferences/resume/queue records do not require better-sqlite3; an embedded database is deferred |
| Auto-update? | Notify only | Squirrel.Mac needs a Developer ID signature |
| Telemetry? | None | A self-hosted suite; local logs and Copy Diagnostics cover bug reports |
| Test runner | `bun test`, Playwright for e2e | The same runner as the web; main-process code is written to run without Electron |
| Name | "raven player", with `userData` pinned to `raven` | Says what it does today, and renaming later moves nothing |
| Thumbnails in recents | Not yet | Needs a frame grab through mpv; text rows with progress are enough to start |

## What full desktop raven inherits

- `@raven/ui` with its player exports, build and tokens. D1 moves the remaining folders and injects the library API/query factories through a store, preserving `useHostPlayer`.
- The player chrome, both engines, `ended` state, protocol, bridge, `MediaTracks` mapping, native surface and "This computer" settings. Do not reimplement them for library modes.
- The macOS arm64 libmpv build, addon and CI; x64 is added later rather than blocking the player release.
- The app identity, pinned `userData`, security baseline, fuses, menus, file associations, `raven://`, persisted player state, logs, crash reports, update check and release workflow.
- D4 must decide whether Vhagar library browsing shares a host origin with the player or retains `app://`; D3 has the same obligation only if local mode is revived. The player itself is origin-independent.

## Order of work (one PR each)

The original milestones remain numbered for history; the current status table above records what actually merged, sometimes through several commits. Future steps use separate focused PRs. Spikes are throwaway evidence, not production implementations. With Vhagar as the only server/database, D1 then D4 is the library-client direction; D2 and D3 are parked and are not dependencies for Vhagar browsing. D4's slow-link native playback still requires the companion transcoding work's MKV stream support.

### Completed feasibility spikes

1. **Server spike, thrown away. Done 2026-10-12: passed.** Ran `startServer` from a bun-bundled file in an Electron `utilityProcess`, loaded better-sqlite3, and played direct, remux and transcode streams through the web engine, locally and through the remote proxy. See "Spike outcomes".
2. **Native video spike, macOS arm64 half, thrown away. Done 2026-10-12: conditional pass.** Criteria:
   - patched libmpv loads in Electron's main process;
   - M2 plays with `hwdec-current=videotoolbox` and no drops over 10 minutes at 60 and 120 Hz;
   - video stays below the page through navigation, resizing, fullscreen and detached DevTools;
   - on an XDR display, EDR highlights exceed the UI's white and M4 has correct colours;
   - 100 load and stop cycles and quitting end without deadlock;
   - without libmpv, the web engine plays.

   The test Mac could not validate 120 Hz or EDR. Those original pre-P5 gates remain owed after the implementation merge; the Risks table defines the SDR-only fallback if they fail. Existing measurements remain a conditional pass, not a claim that every performance target passed.

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
5. **P5: native playback, implementation merged.** `useNativeEngine`, `NativeStage`, the macOS surface, bridge, track mapping, title bar, next in folder, output settings and stats exist. M1 to M15 on the required outputs is still an acceptance target, not a completed hardware claim.
6. **P6: server titles.** Servers in Settings, the play link and the trust prompt, a session per server, the allowlist, `UnlockDialog` moved to `@raven/ui`, progress and history to the server, up next from the link, the browser fallback; the web setting and its two "Open in raven player" actions.
7. **P7: release.** libmpv bundled and signed in the app, `desktop-release.yml` for arm64, the update check, the crash reporter and logs, Copy Diagnostics, and the docs: the root `CLAUDE.md` project table, `apps/raven/CLAUDE.md`, `apps/raven/README.md`, and this spec's outcomes.

### Phase 2: Vhagar library client, then macOS x64 (not implemented)

1. **D1: finish the shared UI extraction.** Move remaining library UI, query layer, router and tests into `@raven/ui`; add the injected `Platform` seam/store selectors and remaining core dedup. Web becomes thin without losing media-plane or redesigned-player behavior. Preserve `useHostPlayer`; do not reintroduce shared-state contexts.
2. **D2: embedded-server entry, deferred.** The old `startServer`, connection-dropping `close` and `./start` proposal remains in section 3. Do not implement it for the current single-server deployment.
3. **D3: standalone local libraries, deferred.** No embedded library host, local database, chooser, desktop scanning or matching is required now. Revisit only with a new scope decision. Local-file playback is already implemented and is not D3.
4. **D4: Vhagar library browsing.** Follow D1 directly, without D2/D3. Revisit the proposed remote host/proxy versus `app://` integration, recording origin/routing/CSP/IPC and media-plane decisions before shipping. Add browsing, connection-loss handling and native slow-link MKV transcodes while preserving handoff and trust. MKV transcoding depends on the companion server work on Vhagar; a generic Switch server workflow is deferred rather than required for one instance.
5. **D5: library-client distribution and Intel Macs.** Extend libmpv/addon builds and the release matrix to macOS x64, preserve arm64 and test the shipped client features on each architecture. Standalone ffmpeg bundling remains deferred with D2/D3. Rename the product to "raven" only when library browsing ships, preserving bundle id and `userData`.

### Phase 3: Windows x64 and Linux x64

6. **D6: platform spikes, then implementation.** First run throwaway native video spikes:
   - **Windows x64:** W1 or W3 draws controls over video through resizing, snapping, maximizing and fullscreen; HDR10 passes with Windows HDR on; TrueHD Atmos reaches a receiver.
   - **Linux x64, X11 on GNOME and KDE:** W3 works with VAAPI decoding on Intel.
   - **Both:** without libmpv, full library mode plays through the web engine.

   Write outcomes here. Then, one PR each: the Windows surface and pinned libmpv; the Linux surface and system libmpv. Add each platform's CI runner, release entry and packages with its implementation.

### Follow-ups

Match the display's refresh rate to video; report the screen's colourspace from the moltenvk context; switch Windows into HDR for an HDR title; Now Playing and media keys (MPNowPlayingInfoCenter, SMTC, MPRIS); Wayland with HDR on Linux; advertise the server's canonical origin for web handoff; consider recents thumbnails.

Release: Developer ID signing and notarization once a certificate exists (`signingFrom` already reads `RAVEN_SIGN_IDENTITY` and `RAVEN_NOTARIZE_PROFILE`), then silent updates through Squirrel.Mac, which needs that signature. `hdiutil create`, `attach` and `detach` print a deprecation warning on macOS 27 that points to `diskutil image`; the dmg maker swaps to it when the runners reach macOS 27. The workflows pass `NX_CLOUD_ACCESS_TOKEN` to Nx. P7's recorded runs had no token and rebuilt libmpv cold; verify the secret and a real cache hit before claiming restoration works. Secret provisioning is external to the repository and was not rechecked in this code audit. A fallback without Nx Cloud needs more than `NX_CACHE_DIRECTORY`: Nx 23 finds a cached task only through its database in `.nx/workspace-data`, named for the machine's hardware UUID, so a restored `.nx/cache` misses on a new runner. The fallback would cache that folder too and rename the database to the runner's UUID, or cache `fetch:libmpv`'s outputs and skip the target when they are restored. Idle memory on Home measures about 425 MB packaged and unpackaged against the 300 MB budget: find what holds it, or revisit the budget. Give the update check one stable place to read, so it no longer pages through a list GitHub sorts by tag name: either `main-smoke-test.yml` stops marking its `vX.Y.Z.N` build releases `--latest` (or makes them prereleases), so `/releases/latest` names the app's release again, or `desktop-release.yml` publishes a fixed pointer such as a `latest.json` asset on a dedicated tag. Until then, more than 5 pages of 100 between the newest release and a `v0.10.0` listed after it could still hide that release.

Downloads (`2026-10-17-raven-desktop-downloads-design.md`) add five allowlisted calls, thirteen in all, two of them (`getMediaOrigins`, `getMediaTicket`) main's alone. A download picks its media origin with core's `pickOrigin`, as the web player does. Their follow-ups: a folder picker for downloads; grouping rows by show or saga.

At the next addon rebuild: move `access-references=no` into init options (the service already sets it before loads and refuses loads if it fails); pass playlist entry ids (`start-file` and its entry id), so stale-event gating no longer depends on reply ordering. The old cleanup follow-up has a merged fix in `58df5c30` (#193), which finishes async exit cleanup on Node's loop thread; retain abandonment/reclamation tests and explicit destroy-before-window ordering.

Real-hardware acceptance remains owed despite the P5 implementation being merged: picture beneath the actual transparent player page (the window-surface smoke used an empty page), fullscreen, detached DevTools, and XDR/120 Hz measurements. Do not describe the P1-to-P7 merge as proof those gates passed. If HDR validation fails, use the documented `target-colorspace-hint=no` fallback and record the narrowed support.

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
9. **`desktop-config.json` is version 4,** with `updates: { isEnabled, checkedAt }`; a launch check is due when it is on and `checkedAt` is missing, a day old or in the future. The menu's check always runs.
10. **Unpackaged, the launch check runs only with `RAVEN_DESKTOP_RELEASES_URL` set,** so `dev` and e2e never call GitHub on their own.
11. **Logs live in `~/Library/Logs/raven`** (section 7's `logs`), pinned with `app.setAppLogsPath`: `raven.log`, then `raven.log.1` to `raven.log.4`, each at most 1,048,576 bytes, the folder `0o700` and the files `0o600`. Crash dumps go to `<userData>/Crashpad`.
12. **What the log never holds:** cookie values, request bodies, PINs, passwords, file paths or file names. Opens are logged as `open file .mkv` or `open server title 7 on <server name>`; every line is redacted, stripped of control characters and cut at 4,096 characters, and at most 200 lines are written per 10 s, with one count of the dropped.
13. **The budget marks are always on and always logged,** packaged too: `raven-launch-ms`, `raven-quit-ms`, `raven-open-to-frame-ms`, `raven-memory-idle-mb`, `raven-memory-playing-mb` and `raven-cpu-paused-percent`. `raven-quit-ms` runs from the first `before-quit` to `will-quit`, so it does not include the final log flush that follows.
14. **No addon rebuild in P7.** It reused the addon and libmpv exercised by P5/P6 CI. This is historical release scope, not evidence that every earlier addon issue remains open: main already contains #193's loop-thread cleanup fix. The remaining init-option and playlist-id items are in Follow-ups.
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
- **Deferred local-mode acceptance, only if D2/D3 return to scope:** `bunx nx run @raven/desktop:make` builds an app. Choose "Run on this computer", add a local folder, and let the scan and TMDB matching finish. Then:
  - Play M1 to M15.
  - Lock a library, restart, and use the PIN dialog.
  - Quit while a video plays, and check that the app is gone within 1 s and that no `node` or `ffmpeg` processes remain.
- **After D4 and D5, desktop Vhagar library client:** connect to `http://192.168.50.6:8484` from its reachable network, then browse, play M2 directly, seek outside the cache, and switch audio and subtitles. Enter the admin password if Vhagar's admin lock is on, then unlock a locked library with its PIN. Throttle the link below M2's bitrate and check that the transcode is offered and plays. Stop the remote and check that Connection lost appears.
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
