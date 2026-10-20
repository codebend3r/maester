# raven device apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one raven app, `@raven/app`, to iPhone, iPad, Apple TV and Android TV: browse, search, resume, play, mark watched and favourite against a raven server, sharing the web's query layer, player state and helpers instead of copying them, and playing every file the web can through the platform's player with the server's new HLS output.

**Architecture:** Two extraction PRs move the pure helpers into `@raven/core` and the query layer and player state into a DOM-free `@raven/ui/headless` entry, with web and desktop importing them back. The server gains `GET /api/media/:id/hls/...`: a VOD playlist planned from the file's keyframes (remux) or a fixed six-second grid (transcode), with segments cut on demand by one ffmpeg per session into `<dataDir>/hls/<session>/`. The app is an Expo project on the `react-native-tvos` fork at `apps/raven/app`, `expo-router` over one route tree, screens rendering through layout components that pick the touch or the focus layout, and `react-native-video` playing direct files or HLS by media ticket.

**Tech Stack:** Expo 58 on `react-native-tvos`, `expo-router`, `react-native-video` 6.19.3, TanStack Query 5, zustand 5, NestJS 12 on Fastify with vitest, ffmpeg and ffprobe, bun test, `jest-expo` for native screens, Maestro, Nx 23 over Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-10-17-raven-device-apps-design.md` (all sections). It builds on `2026-10-12-raven-desktop-design.md` (servers, sessions, D1) and `2026-10-16-raven-direct-media-design.md` (media origins, tickets, `pickOrigin`).

## Global Constraints

- Everything in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`: no `any`, no casts, no `interface`, no enums, no loops, one object parameter, guards at every boundary, identifiers from `as const` objects declared once, `@/` imports with no extension, no em or en dashes anywhere, comments only for a non-obvious why, no dead code (knip), named exports only.
- `libs/raven/core` stays platform-agnostic and dependency-free: no DOM, no Node, no React, no zustand, no TanStack, no `URLSearchParams` (`toQueryString`), no `import.meta.env`.
- `@raven/ui/headless` imports no `react-dom`, no `react-router-dom`, no SCSS and no `.css`, and reads no DOM global (`window`, `document`, `localStorage`, `EventSource`, `HTMLElement`) at module evaluation or anywhere in its graph. React, TanStack Query and zustand are allowed.
- Every symbol is exported from exactly one place. A module that moves is deleted from its old home; importers change their import, no re-export shims.
- Dependencies are pinned exactly (`bun add x@1.2.3`), never a range. Versions the spike ran: Expo 58.0.14, `react-native-tvos` 0.88.0-0, `react-native-video` 6.19.3, `@react-native-tvos/config-tv` 0.1.7, Metro 0.87.1, Babel 7.29.
- HLS values from the spec: six-second nominal segments (`HLS_SEGMENT_SECONDS = 6`), keyframe-gap limit twenty seconds (`HLS_MAX_KEYFRAME_GAP_SECONDS = 20`, else 409), session idle sixty seconds (`HLS_IDLE_MS = 60_000`), at most the last thirty segments kept (`HLS_KEPT_SEGMENTS = 30`), timestamps on `STREAM_TIME_SHIFT`.
- Apple direct play: container `mp4` or `mov`; video `h264` or `hevc`; audio `aac`, `ac3`, `eac3`, `alac`, `flac`; `mp4` with `hevc` answers maybe. HLS audio copies `aac`, `ac3`, `eac3`, `alac`, `flac` and turns `dts`, `truehd`, `opus`, `vorbis` (and anything else) into E-AC-3 keeping the channel count.
- Copy fixed by the spec: "This server can't hand out media tickets. Set `RAVEN_MEDIA_SECRET` on it to play in the app" (shown without the backticks in the UI).
- The app calls only `@ForViewers()` and `@Public()` reads plus `saveProgress`, `recordPlay`, the watched and favourite changes, `unlock`, `getMediaTicket` and the media plane; never an `@AdminOnly()` route.
- Commits follow `commit-format` (`MAE:` subject, short bullets, no attribution); PRs follow `pr-format`, concise (300 to 400 words). Each PR targets the branch before it; PR 1 targets `main`.
- Before each commit: `bunx nx affected -t typecheck lint:ts lint:css format:check test` passes for the touched projects. Never `--no-verify`. Before each PR: the thermo-nuclear review over the whole branch, its fixes in one final commit, then `bun run verify`.

## Rulings (where the spec is silent, or the code says otherwise)

1. **Core takes only what is pure; the rest of a module stays or goes to headless.** The extraction map found React, router or zustand inside several modules on the spec's core list. They split:
   - `tableSort`: `sortRows`, `nextSort`, `ARIA_SORTS` and the types go to core; `useTableSort` stays in web as `apps/raven/web/src/lib/useTableSort.ts`. Web's `SortDirection` is renamed `ColumnDirection` (core already exports `SortDirection` for library sorts) and `TABLE_SORT_DIRECTIONS` keeps its name.
   - `routeQuery`: `ROUTE_STATES`, `RouteQuery`, `RoutePending` and `routeState` go to core; `useRouteId` and `useRouteItem` stay in web.
   - `version` stays in web: it reads `import.meta.env` and `#package`.
   - `edits` goes to headless (Task 7), not core: it builds TanStack edits.
   - `selection`, `pageBackdrop` and `unlockPrompt` go to headless (Tasks 7 and 8), not core: they are zustand stores and core has no dependencies.
   - `shortcuts` goes to core with `KEYS`, which leaves `keyboard.ts` for a pure `libs/raven/core/src/keys.ts`; `isTypingTarget`, `isShortcut` and `useKeyShortcut` stay in ui's `keyboard.ts`, importing `KEYS` from core.
   - `themes` goes to core; the half of `themes.test.ts` that reads `globals.scss` and `themes.scss` stays in ui as `libs/raven/ui/src/styles/themes.test.ts`, importing `THEMES` from core.
2. **`itemLinks` builds its query with `toQueryString`.** Line 43's `URLSearchParams` is the only change in behaviour the move allows, and the existing tests pin the output.
3. **The moved tests use core's fixtures.** Builders a moved test needs that core's `src/test/fixtures.ts` lacks (`matchedMovie` and the rest) are added there with web's shapes; a test whose assertion leaned on web's default ids sets the id explicitly. Web keeps its own fixtures for its own tests.
4. **The web's api-bound modules become factories over an `ApiClient`, as `playerQueriesFor(api)` already is.** In headless: `ravenQueriesFor(api)`, `mediaMutationsFor({ api })`, `watchedChangeFor({ api })`, `serverEventsFor({ api, openEvents })`. Web keeps one binding file per factory at the old path (`lib/queries.ts` becomes `export const { librariesQuery, ... } = ravenQueriesFor(api)`; `lib/useMediaMutations.ts` becomes `export const { useMediaMutations } = mediaMutationsFor({ api })`), so its eighty importers do not change. The app calls the same factories per active server.
5. **`edits` names keys through `queryKeys`, never through a bound query.** Every `itemQuery(id).queryKey` in `edits.ts` becomes `queryKeys.item(id)` (the keys `queries.ts` pairs with each factory), so edits needs no api.
6. **There is no `PlayerServicesProvider` and no `sharedPlaybackPolicy`.** The spec predates `7f8414c8`. The headless entry carries `usePlayerServices` (the zustand store in `libs/raven/ui/src/stores/playerServices.ts`) and `usePlaybackPolicy`; nothing else is lifted under those names.
7. **`usePlayerPrefs` is configured with its storage.** It is created with `persist(..., { name: 'raven-player', skipHydration: true })` and no storage. Headless exports `configurePlayerPrefs({ storage }: { storage: StateStorage })`, which calls `usePlayerPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })` then `usePlayerPrefs.persist.rehydrate()`. Web's `main.tsx`, the desktop renderer's entry and both `test-setup.ts` files call it with `window.localStorage` before anything renders; the app passes AsyncStorage.
8. **`useVideoState` splits at the reducer.** `libs/raven/ui/src/components/Player/videoState.ts` holds `Ranges`, `VideoState`, `VIDEO_EVENTS`, `VideoEvent`, `initialVideoState` and `videoReducer`; `useVideoState.ts` keeps the hook and `bufferedRanges` and imports the rest. `fromPlayerEvent` imports from `videoState`.
9. **`useServerEvents` takes its event source.** `serverEventsFor({ api, openEvents }: { api: ApiClient; openEvents: (url: string) => ServerEventSource })` where `ServerEventSource = { addEventListener: (type: string, listener: (event: { data: string }) => void) => void; close: () => void }`. Web passes `(url) => new EventSource(url)`; the app passes `react-native-sse`'s `EventSource` (Task 18).
10. **HLS segments are cut with an explicit list, not ffmpeg's own timer.** One ffmpeg per run, as the spike ran it (spec, "HLS muxing (2026-10-19)"): `-seek_timestamp 1 -ss <boundary n>` before `-i` with `-copyts` and no `-start_at_zero`, so the run keeps the file's own clock, which the plan's boundaries are on (spec, "FFmpeg versions"), `-copypriorss 0` after the input (with B-frames ffmpeg seeks 3/23 s early and a copy would keep the GOP before), `-output_ts_offset <STREAM_TIME_SHIFT> -avoid_negative_ts disabled`, then `-f segment -segment_format mp4 -segment_format_options movflags=frag_keyframe+empty_moov+default_base_moof+frag_discont+delay_moov:use_editlist=0:avoid_negative_ts=disabled` (without the last three each file's `tfdt` restarts at zero; without `delay_moov` an AC-3 or E-AC-3 track fails the run), `-segment_times` set to the boundaries after `n` minus boundary `n` (the segment muxer adds the run's first video pts to each entry and indexes the list by files written in this run; before FFmpeg 6.0, as Debian 12's 5.1 in the server image, it adds nothing, so there the entries are the boundaries plus `STREAM_TIME_SHIFT`), `-segment_time_delta 0.005` and `-segment_start_number <n>`. A restart at `n` then cuts exactly the segments a run from zero would: same first pts, same video packets, identical `mdat` on remux. Each output file is `ftyp moov moof mdat...`; the server serves the first file of a run's `ftyp moov` as `init` (every run's first file has the same bytes) and each file's bytes after `moov` as segment `n`. AVPlayer and ExoPlayer both play this, per-file `mfhd` numbers restarting at 1 included, and both play across a restart's join, where a remux's audio has a gap about as long as the video's reorder delay and a transcode's overlaps by up to one audio frame (spec, "HLS muxing"). On transcode (spec, "Transcode cuts"): the plan starts on the video stream's first pts and each boundary sits on a frame of its `r_frame_rate`; the seek is `-ss <boundary n - half a frame - format.start_time>` with no `-seek_timestamp`, since the decoder trims at `-ss` plus the start time; `-fps_mode passthrough -enc_time_base demux` (`-1` before FFmpeg 6.1) keeps each frame's own timestamp; for an MPEG-TS source whose keyframes are stored by the time the run starts (the master starts their probe and never waits for it) the video input seeks to just before the keyframe at or before the boundary and `-vf trim=start=<boundary - half a frame>` cuts it, while a second input of the same file with the exact `-ss` gives the audio (`1:a:N`); `-force_key_frames` at each boundary from `n` onwards minus half a frame; and `-segment_time_delta` is half a frame. ffmpeg's `-f hls` is not used: its cut rule is a grid anchored on each run's start, which a restart moves.
11. **Remux boundaries follow the keyframes.** Segment 0 starts at the first keyframe; segment `k + 1` starts at the first keyframe at or after segment `k`'s start plus `HLS_SEGMENT_SECONDS`. The last ends at the duration. A gap between consecutive boundaries over `HLS_MAX_KEYFRAME_GAP_SECONDS` makes the remux plan `null` (the 409). Keyframes are read once per file with `ffprobe -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0` (packets, no decoding) and stored as a JSON array of seconds truncated to three decimals, never rounded (a keyframe rounded up lies after the real one, so `-copypriorss 0` drops it and the run writes no video), in a new `media.keyframes TEXT` column (migration 31), cleared by `markChanged` as `tracks` is.
12. **HLS paths avoid a parameter with a suffix.** Fastify's router splits on `.` and `-`, and track ids are `embedded-0`. The routes are:
    ```
    GET /api/media/:id/hls/master.m3u8?mode=&audio=&quality=&t=
    GET /api/media/:id/hls/:session/video.m3u8?t=
    GET /api/media/:id/hls/:session/init?t=
    GET /api/media/:id/hls/:session/segment/:n?t=
    GET /api/media/:id/hls/:session/subtitles/:trackId?t=          (a WebVTT playlist)
    GET /api/media/:id/hls/:session/subtitles/:trackId/:n?t=       (one six-second VTT segment)
    ```
    `master.m3u8` mints the session (16 random bytes, base64url) holding `mode`, `audio` and `quality`; no ffmpeg runs until a segment is asked for. Every URI in a playlist is absolute-path and carries the request's `t`, since a relative URI does not inherit the query. A ticket lives `MEDIA_TICKET_SECONDS` (six hours); a session outliving it is the app's to reopen.
13. **A session runs at most ten segments ahead.** When the run has written `HLS_RUN_AHEAD = 10` segments past the highest asked for, the server sends ffmpeg `SIGSTOP`, and `SIGCONT` when a request comes within that. A request for segment `n` waits (up to `HLS_SEGMENT_WAIT_MS = 30_000`) when `n` lies in `[next, next + 2]` of the running run, is served from the folder when written, and otherwise kills the run and starts one at `n`, though only once the run has written the first segment it was started for, or has failed to within `HLS_SEGMENT_WAIT_MS` (it has stalled, and waiting on it again would hold every request), so two far requests cannot keep replacing each other's runs. A session unasked for `HLS_IDLE_MS` rests: its run is killed and its files deleted, but it is kept, so a request after a long pause resumes it with a new run at that segment; it is forgotten once `MEDIA_TICKET_SECONDS` pass since its last request. Sessions are capped at `HLS_SESSION_CAP = 8`; minting a ninth drops the longest idle. `<dataDir>/hls` is emptied at startup, and `MediaArtifacts.discard` drops a media's sessions.
14. **Subtitle segments slice the existing VTT.** The segment route asks `SubtitlesService` for the track's VTT (the windows covering the segment, or the whole sidecar), parses it with core's `parseWebVtt`, keeps the cues overlapping `[6n, 6n + 6)`, and writes them with a new core `formatWebVtt({ cues, timestampMap })`, whose header carries `X-TIMESTAMP-MAP=MPEGTS:<STREAM_TIME_SHIFT * 90000>,LOCAL:00:00:00.000`. `SubtitlesService` extracts with `-start_at_zero`, so its cues are the file's time minus the file's start time, while HLS video keeps the file's own clock: the route adds the file's start time (ffprobe's `format.start_time`) to every cue before writing it. Picture-based tracks get no rendition.
15. **HLS audio.** `hlsAudioArgs(track)`: copy when the codec is one of `HLS_COPY_AUDIO = ['aac', 'ac3', 'eac3', 'alac', 'flac']`; otherwise `-c:a eac3 -ac <min(channels, 6)> -b:a <640k for 6, 448k for 3 to 5, 224k for 1 or 2>`. Remux and transcode both use it; the MSE stream route keeps its stereo AAC.
16. **One route tree, layouts by platform.** The spec's `(phone)/` and `(tv)/` groups would duplicate every route file. The app has one tree under `app/`; each route renders a screen from `src/screens/`, and screens render `src/layouts/` components (`Shelf`, `Grid`, `ItemLayout`, `PlayerChrome`) whose index picks the touch or the focus variant from `Platform.isTV`. A screen never reads `Platform.isTV`. Route paths are `APP_ROUTES` in `src/routes.ts`.
17. **The app holds its own cookie.** Requests go through `servers/serverFetch.ts`, which sends `credentials: 'omit'`, adds `Cookie: <name>=<value>` from the server's jar and reads `set-cookie` from `unlock`'s response. The jar keeps only the unlock cookie, whose name moves from the desktop's `SERVER_COOKIES` to a core constant `UNLOCK_COOKIE` if core does not already declare it (Task 17 checks the server's source for it). Cookies live in `expo-secure-store` under `raven.cookie.<serverId>`; the server list, theme and player prefs in `@react-native-async-storage/async-storage`. If `expo-secure-store` does not build for tvOS, Task 17 stores the cookie in AsyncStorage and says so in the app's `CLAUDE.md`.
18. **Design tokens come from the built `@raven/ui/designTokens`, themes from a new parse.** Vite inlines `globals.scss?raw` at build, so Metro reads plain strings. Core gains `parseThemes(scss: string): Record<string, Record<string, string>>` beside `parseTokens`; `designTokens.ts` exports `themeTokens = parseThemes(themes)` too. The app turns tokens into React Native values in `src/theme/nativeTokens.ts`: `rem` times 16, colours as written (they are hex), anything it cannot express dropped with a test pinning which.
19. **The e2e runs against a real server.** `@raven/server` gains `src/e2e/fixtureServer.ts` and a `serve:fixture` script: it encodes two short clips with the test helpers' `encodeRichClip`, writes them as a one-movie, one-show library under a temp `DATA_DIR`, sets a PIN and a `RAVEN_MEDIA_SECRET`, starts the app on a fixed port and scans. Maestro flows in `apps/raven/app/e2e/` point at it.
20. **Android TV builds and tests on Linux.** GitHub's macOS arm64 runners cannot run the Android emulator, so `android-tv` jobs run on `ubuntu-24.04` with KVM. The Apple builds and the tvOS e2e run on `macos-26`. Both join the `🖥️ Desktop` gate's `needs`.
21. **The real-device pass is the user's.** Task 32 writes the M1 to M15 checklist into the app's README with an empty result column; nobody in CI can fill it.
22. **Apple TV direct-plays only files with no text subtitles.** The system panel lists only HLS renditions, so on `tvos` a direct-playable file with a sidecar or embedded text track starts at `remux`, where its subtitles are renditions.

## Review Focus

1. A Blu-ray remux whose GOPs are irregular (one 0.5 s, the next 9 s): the remux playlist's durations sum to the file's duration, every boundary is a keyframe, and a seek to the middle restarts ffmpeg on exactly that boundary (Task 12's irregular-keyframe test, Task 13's restart test).
2. A viewer scrubs back and forth across an hour three times in ten seconds: each far request kills the previous run, at most one ffmpeg runs for the session, and no folder outlives its session (Task 13's thrash test).
3. The server has no `RAVEN_MEDIA_SECRET`: sign-in says so in the spec's words and playback works through the cookie header, direct and HLS alike (Task 17's 503 test, Task 24's cookie-header test).
4. The web after the extraction: every page, the player and the desktop renderer behave as before, prefs survive a reload, and no test was weakened to pass (Tasks 4 and 8 run the full web and desktop suites and compare test counts before and after).
5. A TV with the app left on Home overnight: the ticket and the Query cache refresh on focus return, and pressing Play next morning plays instead of failing on a stale ticket (Task 24's ticket-age test).

## PR stack

| PR | Branch | Base | Tasks | Spec step |
| --- | --- | --- | --- | --- |
| 1 | `device-core` | `main` | 1 to 4 | 1. core takes the pure helpers |
| 2 | `device-headless` | PR 1 | 5 to 8 | 2. ui's headless entry |
| 3 | `device-hls` | PR 2 | 9 to 14 | 3. Server: HLS route |
| 4 | `device-app` | PR 3 | 15 to 19 | 4. App scaffold |
| 5 | `device-browse` | PR 4 | 20 to 22 | 5. Library, Item, search |
| 6 | `device-play-touch` | PR 5 | 23 to 25 | 6. Player on iPhone and iPad |
| 7 | `device-play-tv` | PR 6 | 26, 27 | 7. Player on Apple TV |
| 8 | `device-android-tv` | PR 7 | 28, 29 | 8. Android TV |
| 9 | `device-polish` | PR 8 | 30 to 32 | 9. Settings, themes, polish |

The plan and the spec's status change go in PR 1's first commit. Each PR: thermo review, one fix commit, `bun run verify`, `git push -u origin <branch>`, `gh pr create --base <base>`.

---

## PR 1: core takes the pure helpers

Each task: move the file with `git mv` (so `--follow` keeps history), rewrite its imports to core's `@/`, export it from `libs/raven/core/src/index.ts` (one `export * from '@/<module>'` line, alphabetical), point every importer at `@raven/core`, move its test beside it, and run core's, ui's, web's and desktop's tests. No behaviour change.

### Task 1: the plan, and the ui helpers move to core

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-raven-device-apps-design.md` (status line: "approved 2026-10-18; plan `docs/superpowers/plans/2026-10-18-raven-device-apps.md`")
- Create: this plan
- Move: `libs/raven/ui/src/lib/{tokens,themes,trackLabels,shortcuts}.ts` and tests to `libs/raven/core/src/`
- Create: `libs/raven/core/src/keys.ts` (`KEYS`, moved out of `libs/raven/ui/src/lib/keyboard.ts`)
- Create: `libs/raven/ui/src/styles/themes.test.ts` (the SCSS half of the old themes test)
- Modify: `libs/raven/ui/src/index.ts`, `libs/raven/ui/src/styles/designTokens.ts`, ui's player files, web's DesignPage and theme files, desktop's `PlayPage/playerServices.ts`

**Interfaces:**
- Produces from `@raven/core`: `TOKEN_GROUPS`, `TokenGroup`, `DesignToken`, `parseTokens`, `contrastRatio`, `THEME_TONES`, `ThemeTone`, `THEMES`, `ThemeId`, `DEFAULT_THEME`, `isThemeId`, `themeOf`, `TrackLabel`, `audioLabel`, `subtitleLabel`, `KEYS`, `PLAYER_ACTIONS`, `SEEK_EDGES`, `PlayerAction`, `KeyPress`, `shortcutFor`, `shortcutRows`, `SPEEDS`, `stepSpeed`, `stepCaptionScale`, unchanged signatures.

- [ ] **Step 1:** Commit the plan and the spec's status line alone: `MAE: plan raven's device apps`.
- [ ] **Step 2:** Add `libs/raven/core/src/trackLabels.test.ts` (it had none): `audioLabel` of an English 5.1 E-AC-3 track and `subtitleLabel` of a forced sidecar track equal what the player shows today (read the expected strings off the current implementation before moving it). Run `bunx nx run @raven/ui:test`; PASS.
- [ ] **Step 3:** Move the four modules and `KEYS`; split `themes.test.ts`. Run `bunx nx run-many -t typecheck test -p @raven/core @raven/ui @raven/web @raven/desktop`; PASS, with the same test count per project as before plus the new one.
- [ ] **Step 4:** Commit: `MAE: move raven's tokens, themes, track labels and shortcuts to core`.

### Task 2: the small web helpers move to core

**Files:**
- Move: `apps/raven/web/src/lib/{entryKeys,letters,jumpScale,mediaProgress,plural,history}.ts` and tests to `libs/raven/core/src/`
- Merge: `apps/raven/web/src/lib/libraryKinds.ts` into `libs/raven/core/src/libraryKinds.ts` (`KINDS`, `LIBRARY_ICON_LABELS`, `libraryIconOf`); its test into core's
- Merge: `apps/raven/web/src/lib/sagas.ts` into `libs/raven/core/src/sagas.ts` (`sagaFacts`, `sagaRuntime`, `sagaPath`, `sagaTargets`)
- Modify: every web importer (see the extraction map; about forty files)

**Interfaces:**
- Produces from `@raven/core`, unchanged signatures: `mediaEntryKey`, `showEntryKey`, `seasonEntryKey`, `episodeEntryKey`, `sagaEntryKey`, `SPECIAL_LETTERS`, `LETTERS`, `Letter`, `letterOf`, `mediaLetter`, `showLetter`, `JumpScale`, `niceStep`, `jumpScale`, `progressOf`, `timeLeftOf`, `plural`, `HistoryDay`, `historyDays`, `finishedNote`, `historyNote`, `KINDS`, `LIBRARY_ICON_LABELS`, `libraryIconOf`, `sagaFacts`, `sagaRuntime`, `sagaPath`, `sagaTargets`.
- `sagaTargets` writes its kinds from core's `WatchTarget` kind constant, not `'item'` and `'media'` literals (find the constant beside `WatchTarget`; declare it there if missing).

- [ ] **Step 1:** Add the missing tests in their new home: `plural.test.ts` (`plural({ n: 1, one: 'file', many: 'files' })` is `'1 file'`, `n: 1200` is `'1,200 files'`), `sagas.test.ts` (`sagaPath({ libraryId: 3, saga })` is the web's current path for that saga; `sagaTargets` lists each film's target in order).
- [ ] **Step 2:** Move and merge, port the tests to core's fixtures (Ruling 3). Run the four projects' `typecheck test`; PASS.
- [ ] **Step 3:** Commit: `MAE: move raven's small web helpers to core`.

### Task 3: itemFacts, itemLinks and the pure halves of tableSort and routeQuery move to core

**Files:**
- Move: `apps/raven/web/src/lib/{itemFacts,itemLinks}.ts` and tests to core
- Move: `sortRows`, `nextSort`, `ARIA_SORTS`, `AriaSort`, `SortColumn`, `ActiveSort`, `TABLE_SORT_DIRECTIONS` and `ColumnDirection` to `libs/raven/core/src/tableSort.ts`; `useTableSort` to `apps/raven/web/src/lib/useTableSort.ts`
- Move: `ROUTE_STATES`, `RouteQuery`, `RoutePending`, `routeState` to `libs/raven/core/src/routeQuery.ts`; the hooks stay in `apps/raven/web/src/lib/routeQuery.ts`
- Modify: importers (about fifty)

**Interfaces:**
- Produces from `@raven/core`: everything `itemFacts.ts` and `itemLinks.ts` export today, unchanged; `ColumnDirection` (web's old `SortDirection`); `routeState({ id, query })`.

- [ ] **Step 1:** In the moved `itemLinks.test.ts`, assert the query a `cardLink` or `inLibrary` builds for a value needing escaping (`search: 'a&b c'`) is byte for byte what `URLSearchParams` gave (read it off the current code first). Run; PASS against the old code.
- [ ] **Step 2:** Move, replace `URLSearchParams` with `toQueryString` (Ruling 2), rename `SortDirection` to `ColumnDirection`. Run the four projects' `typecheck test`; PASS.
- [ ] **Step 3:** Commit: `MAE: move raven's item facts, links, table sort and route state to core`.

### Task 4: prove the extraction changed nothing

- [ ] **Step 1:** Run `bun run verify` from the worktree root; PASS. Compare the four projects' summed test count with `main`'s (run in the main checkout); it is equal or higher, and every deleted test has its twin in core.
- [ ] **Step 2:** Grep core for `window`, `document`, `localStorage`, `URLSearchParams`, `react`, `zustand`, `@tanstack`: nothing outside comments.
- [ ] **Step 3:** Thermo review, fix commit, push, open PR 1 against `main`.

---

## PR 2: ui's headless entry

### Task 5: the entry, the split reducer and the no-DOM test

**Files:**
- Create: `libs/raven/ui/src/headless.ts` (named re-exports, values and `export type` on separate lines, as `index.ts`)
- Create: `libs/raven/ui/src/components/Player/videoState.ts` (Ruling 8)
- Modify: `libs/raven/ui/vite.config.ts` (`lib.entry.headless: 'src/headless.ts'`), `libs/raven/ui/package.json` (`"./headless": { "types": "./dist/headless.d.ts", "default": "./dist/headless.js" }`)
- Create: `libs/raven/ui/headless-check/{headless.test.ts,bunfig.toml}`, an empty bunfig so ui's happy-dom preload never runs, run by a new `test:headless` script (`bun --cwd headless-check test`) chained into `test` with `--sequential`; ui's own bunfig ignores the folder; listed in `nx.includedScripts`
- Modify: `fromPlayerEvent.ts`, `engine.ts`, `PlayerServices.ts` import paths; `index.ts` stops exporting what headless exports

**Interfaces:**
- Produces from `@raven/ui/headless`: `Ranges`, `VideoState`, `VIDEO_EVENTS`, `VideoEvent`, `initialVideoState`, `videoReducer`, `rangesFrom`, `fromPlayerEvent`, `EngineActions`, `EngineStats`, `EngineHandle`, `HtmlSource`, `NativePlayer`, `ENGINE_KINDS`, `Engine`, `sourceKey`, `sendQuietly`, and the types of `PlayerServices.ts`.
- If `PlayerServices.ts`'s type import of `IconName` drags `Icon.module.scss` into `dist/headless.d.ts`'s graph, move the icon name constant to `libs/raven/ui/src/components/Icon/iconNames.ts` and import it from there in both.

- [ ] **Step 1: Write the failing test** `headless.test.ts`:
  ```ts
  test('the headless entry loads with no DOM', async () => {
    expect(typeof globalThis.window).toBe('undefined')
    const entry = await import('@raven/ui/headless')
    expect(entry.videoReducer).toBeFunction()
  })
  test('the headless bundle reaches for no DOM package or stylesheet', () => {
    // read dist/headless.js and every chunk it imports, transitively
    expect(imports).not.toContainAnyOf(['react-dom', 'react-router-dom'])
    expect(files.some((file) => file.endsWith('.css'))).toBeFalse()
  })
  ```
- [ ] **Step 2:** Run `bunx nx run @raven/ui:test`; FAIL (no `./headless` export).
- [ ] **Step 3:** Split the reducer, add the entry and export. Run `bunx nx run-many -t typecheck test build -p @raven/ui @raven/web @raven/desktop`; PASS.
- [ ] **Step 4:** Commit: `MAE: add raven ui's headless entry with the player state`.

### Task 6: the player's stores and queries join headless

**Files:**
- Modify: `libs/raven/ui/src/stores/playerPrefs.ts` (Ruling 7), `libs/raven/ui/src/headless.ts`
- Modify: `apps/raven/web/src/main.tsx`, `apps/raven/web/src/test-setup.ts`, `libs/raven/ui/src/test-setup.ts`, the desktop renderer's entry and test setup (call `configurePlayerPrefs({ storage: window.localStorage })`)
- Create: `libs/raven/ui/src/stores/playerPrefs.test.ts`

**Interfaces:**
- Produces from `@raven/ui/headless`: `usePlayerPrefs`, `CONTROLS_LINGER_SECONDS`, `configurePlayerPrefs({ storage }: { storage: StateStorage })`, `usePlayerServices`, `useHostServices`, `useHostPlayer`, `playerQueriesFor`, `playerQueryKeys`.

- [ ] **Step 1: Write the failing test** `playerPrefs.test.ts`: with a `Map`-backed `StateStorage` holding `{"state":{"volume":0.4},"version":<current>}` under `raven-player`, `configurePlayerPrefs({ storage })` makes `usePlayerPrefs.getState().volume` `0.4`; a later `setVolume(0.7)` writes `0.7` into that storage. (Use the store's real field and action names.)
- [ ] **Step 2:** Run; FAIL. Implement. Run ui, web and desktop `test`; PASS (web's prefs tests still read and write `localStorage`).
- [ ] **Step 3:** Commit: `MAE: let raven's player prefs take their storage`.

### Task 7: the web's query layer moves to headless

**Files:**
- Move: `apps/raven/web/src/lib/{queryClient,invalidate,optimistic,edits}.ts` and tests to `libs/raven/ui/src/data/`
- Move: `apps/raven/web/src/stores/unlockPrompt.ts` to `libs/raven/ui/src/stores/unlockPrompt.ts`
- Create: `libs/raven/ui/src/data/ravenQueries.ts` (`ravenQueriesFor(api)`, the body of today's `queries.ts` with `api` a parameter; it spreads `playerQueriesFor(api)`'s `tracks` and `playbackSettings` where `queries.ts` aliases them)
- Modify: `apps/raven/web/src/lib/queries.ts` (one destructuring binding, Ruling 4), `edits.ts` (Ruling 5)
- Add `@tanstack/react-query` and `zustand` to ui's `peerDependencies` if missing (they are there today; check)

**Interfaces:**
- Produces from `@raven/ui/headless`: `createQueryClient`, `queryKeys`, `mutationKeys`, every `after*` from `invalidate`, `EDITED_PARTS`, `Edit`, `editAll`, `edit`, `useOptimisticMutation`, `withoutEntry`, `itemFavouriteEdits`, `favouriteEdits`, `watchedEdits`, `librarySettingsEdits`, `useUnlockPrompt`, `ravenQueriesFor(api: ApiClient): RavenQueries` with `type RavenQueries = ReturnType<typeof ravenQueriesFor>`, `HISTORY_SHOWS`, `HistoryShow`.

- [ ] **Step 1:** Add `libs/raven/ui/src/data/ravenQueries.test.ts`: `ravenQueriesFor(api).itemQuery(5).queryKey` equals `queryKeys.item(5)`, and its `queryFn` calls `api.getItem(5)` (a fake `ApiClient` built with `createApiClient({ fetch })` and a recording fetch).
- [ ] **Step 2:** Move, bind, rewrite edits' keys. Run ui, web, desktop `typecheck test`; PASS.
- [ ] **Step 3:** Commit: `MAE: move raven's query layer to ui's headless entry`.

### Task 8: the web's data hooks and shared stores move to headless

**Files:**
- Move to `libs/raven/ui/src/data/`: `useMediaMutations.ts` (as `mediaMutationsFor`), `useWatchedChange.ts` (as `watchedChangeFor`), `usePlaybackPolicy.ts`, `useServerEvents.ts` (as `serverEventsFor`, Ruling 9), with their tests
- Move to `libs/raven/ui/src/stores/`: `selection.ts`, `pageBackdrop.ts`, with tests
- Modify: web binding files at the old paths (Ruling 4); web's `AppShell` passes `openEvents: (url) => new EventSource(url)`

**Interfaces:**
- Produces from `@raven/ui/headless`: `mediaMutationsFor({ api }): { useMediaMutations }`, `watchedChangeFor({ api }): { useWatchedChange, useWatchedToggle }`, `usePlaybackPolicy({ queries }: { queries: RavenQueries }): PlaybackPolicy | null`, `serverEventsFor({ api, openEvents }): { useServerEvents }`, `ServerEventSource`, `createSelectionStore`, `SelectionStore`, `usePageBackdrop`.

- [ ] **Step 1:** Add `useServerEvents.test.tsx` beside the moved hook: a fake `openEvents` records the URL (`api.eventsUrl()`), and a `library` event with a JSON payload invalidates the keys `afterLibraryEvent` names; unmounting calls `close()`.
- [ ] **Step 2:** Move and bind. Run `bun run verify`; PASS. Compare test counts with PR 1's head as in Task 4.
- [ ] **Step 3:** Commit: `MAE: move raven's data hooks and shared stores to ui's headless entry`.
- [ ] **Step 4:** Thermo review, fix commit, push, open PR 2 against `device-core`.

---

## PR 3: the server's HLS route

### Task 9: spike the segment muxing (scratchpad, not committed)

- [ ] **Step 1:** In the scratchpad, cut a remux of a test clip with an irregular GOP (`encodeRichClip`'s settings plus `-g 240 -keyint_min 12 -sc_threshold 40`) using Ruling 10's command from segment 0 and again from segment 4; split init and segments as the ruling says; write a VOD playlist. Check with `ffprobe -show_packets` that segment 4 of both runs has the same first `pts` and packet count.
- [ ] **Step 2:** Serve the folder with `bunx serve` and play it in the tvOS simulator through a throwaway Expo app with `react-native-video` (reuse the device spike's scratch app if it is still in the scratchpad, else `bunx create-expo-app` with the TV template), seeking past the middle. Then in the Android TV emulator.
- [ ] **Step 3:** Record in the spec's "Spike results" a short "HLS muxing (2026-10-18)" table: does the per-file split play on each player, does a restart match, the ffmpeg version. If the split is refused, decide the `-f hls` fallback and rewrite Ruling 10 and Tasks 12 and 13 accordingly before going on. Commit the spec change: `MAE: record the HLS muxing spike in raven's device apps spec`.

### Task 10: HLS contract, client URLs and VTT writing in core

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (`HLS_PATHS`, `HLS_PARAMS`, the constants in Global Constraints, `HLS_COPY_AUDIO`, `isHlsSessionId`), `libs/raven/core/src/apiClient.ts` (`hlsUrl`), `libs/raven/core/src/subtitles.ts` (`formatWebVtt`)
- Test: `contract.test.ts`, `apiClient.test.ts`, `subtitles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HLS_PATHS = {
    master: '/api/media/:id/hls/master.m3u8',
    video: '/api/media/:id/hls/:session/video.m3u8',
    init: '/api/media/:id/hls/:session/init',
    segment: '/api/media/:id/hls/:session/segment/:n',
    subtitles: '/api/media/:id/hls/:session/subtitles/:trackId',
    subtitleSegment: '/api/media/:id/hls/:session/subtitles/:trackId/:n',
  } as const
  // client
  hlsUrl({ id, mode, audio, quality, access }: { id: number; mode: StreamMode; audio: number | null; quality: StreamQuality | null; access: MediaAccess | null }): string
  formatWebVtt({ cues, timestampMap }: { cues: readonly SubtitleCue[]; timestampMap: { mpegts: number; local: number } | null }): string
  isHlsSessionId(value: unknown): value is string   // 22 base64url characters
  ```

- [ ] **Step 1: Write the failing tests:** `hlsUrl({ id: 7, mode: STREAM_MODES.remux, audio: 1, quality: null, access: { origin: { kind: MEDIA_ORIGIN_KINDS.lan /* core's kind constant */, url: 'https://nas.local:8443' }, ticket: 'abc' } })` is `'https://nas.local:8443/api/media/7/hls/master.m3u8?mode=remux&audio=1&t=abc'`; with `access: null` it is relative to the client's `baseUrl`. `parseWebVtt(formatWebVtt({ cues, timestampMap: null }))` round-trips three cues including one spanning an hour boundary, and with a map the second line is `X-TIMESTAMP-MAP=MPEGTS:90000,LOCAL:00:00:00.000`.
- [ ] **Step 2:** Run `bunx nx run @raven/core:test`; FAIL. Implement. PASS.
- [ ] **Step 3:** Commit: `MAE: add the HLS paths and VTT writing to raven's core`.

### Task 11: keyframes, probed once and stored

**Files:**
- Modify: `apps/raven/server/src/db/database.ts` (migration 31: `ALTER TABLE media ADD COLUMN keyframes TEXT`), `apps/raven/server/src/media/mediaIndex.ts` (`storedKeyframes(id): number[] | null`, `saveKeyframes({ id, keyframes })`, `markChanged` clears `keyframes`), `apps/raven/server/src/ffmpeg/ffmpegService.ts` (`probeKeyframes(path): Promise<number[]>`)
- Create: `apps/raven/server/src/hls/keyframesService.ts` (`KeyframesService.of({ id, path }): Promise<number[]>`, stored first, probed and saved otherwise, one probe in flight per id)
- Test: `database.test.ts`, `mediaIndex.test.ts`, `hls/keyframesService.test.ts` (real ffprobe on an `encodeRichClip` clip with `-g 48`)

- [ ] **Step 1: Write the failing tests:** opening a version-30 database migrates to 31 with `keyframes` null; `KeyframesService.of` on a ten-second clip at 24 fps with `-g 48` answers `[0, 2, 4, 6, 8]` (within 0.05), saves it, a probe of `[0.0, 30.488792, 79.996583]` stores `[0, 30.488, 79.996]` (truncated, not rounded: Ruling 11), and a second call does not spawn ffprobe (count spawns through a subclassed `FfmpegService`); `markChanged` makes it probe again.
- [ ] **Step 2:** Run `bunx nx run @raven/server:test`; FAIL. Implement (Ruling 11's ffprobe command; keep packets whose `flags` contain `K`). PASS.
- [ ] **Step 3:** Commit: `MAE: probe and keep a raven file's keyframes`.

### Task 12: segment plans and playlists, pure

**Files:**
- Create: `apps/raven/server/src/hls/segmentPlan.ts`, `apps/raven/server/src/hls/playlists.ts`, tests beside them

**Interfaces:**
- Produces:
  ```ts
  type SegmentPlan = { boundaries: readonly number[]; duration: number }   // boundaries[k] is segment k's start
  remuxPlan({ keyframes, duration }): SegmentPlan | null                  // Ruling 11
  transcodePlan({ duration }): SegmentPlan                                // 0, 6, 12, ...
  segmentDurations(plan): number[]
  runSegmentTimes({ plan, from }): number[]                               // Ruling 10: boundaries after `from`, minus boundary `from`
  masterPlaylist({ variant, subtitles, codecs, resolution, bandwidth, query }): string
  mediaPlaylist({ plan, initUri, segmentUri: (n: number) => string }): string
  subtitlePlaylist({ duration, segmentUri }): string
  ```
- `masterPlaylist` writes `#EXTM3U`, `#EXT-X-VERSION:7`, `#EXT-X-INDEPENDENT-SEGMENTS` (transcode only), one `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME=<subtitleLabel>,LANGUAGE=<lang>,DEFAULT=NO,AUTOSELECT=<forced ? YES : NO>,FORCED=<YES|NO>,URI=<...>` per text track, and one `#EXT-X-STREAM-INF:BANDWIDTH=..,CODECS="<video>,<audio>",RESOLUTION=WxH[,SUBTITLES="subs"]`. The spike's playlists left `#EXT-X-INDEPENDENT-SEGMENTS` out and played; open-GOP remux segments begin with leading pictures, so `masterPlaylist` writes the tag only for transcode. `mediaPlaylist` writes `#EXT-X-PLAYLIST-TYPE:VOD`, `#EXT-X-TARGETDURATION:<ceil(max)>`, `#EXT-X-MAP:URI=<init>`, `#EXTINF:<three decimals>,` per segment, `#EXT-X-ENDLIST`.

- [ ] **Step 1: Write the failing tests:** `remuxPlan({ keyframes: [0, 0.5, 9.5, 10, 13, 16.2, 30], duration: 31 })` boundaries are `[0, 9.5, 16.2, 30]` and its durations `[9.5, 6.7, 13.8, 1]` sum to 31. A keyframe list with a 21-second gap answers `null`. `transcodePlan({ duration: 13 })` is `[0, 6, 12]` with durations `[6, 6, 1]`. `runSegmentTimes` for the spike's plan `[0, 15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042]` from 4 is `[10, 18.084, 28.084, 38.584]` (to the millisecond), and from the last segment is `[]` (no `-segment_times` at all). `mediaPlaylist` for that plan matches a golden string. `masterPlaylist` lists a forced English sidecar with `FORCED=YES,AUTOSELECT=YES` and omits a PGS track.
- [ ] **Step 2:** Run; FAIL. Implement. PASS.
- [ ] **Step 3:** Commit: `MAE: plan raven's HLS segments and write their playlists`.

### Task 13: HLS sessions and their ffmpeg runs

**Files:**
- Create: `apps/raven/server/src/hls/hlsSessions.ts` (`HlsSessions`), `apps/raven/server/src/hls/segmentFiles.ts` (the init and segment split of Ruling 10: `splitSegmentFile(bytes): { init: Uint8Array; media: Uint8Array }`, reading top-level box sizes)
- Modify: `apps/raven/server/src/ffmpeg/args.ts` (`hlsArgs({ input, plan, from, mode, audio, encoder, maxHeight, quality, tonemap, folder })`, the exact flags of Ruling 10 with `runSegmentTimes` from Task 12, `hlsAudioArgs(track)` per Ruling 15), `apps/raven/server/src/ffmpeg/ffmpegService.ts` (`segment(args): ChildProcess`, tracked and killed on destroy like `stream`), `apps/raven/server/src/media/mediaArtifacts.ts` (drop sessions), `apps/raven/server/src/appModule.ts` (provider; empty `<dataDir>/hls` on start)

**Interfaces:**
- Produces:
  ```ts
  class HlsSessions {
    mint({ mediaId, mode, audio, quality }): HlsSession          // Ruling 12, 13 (cap, eviction)
    get({ mediaId, session }): HlsSession | null
    init({ session }): Promise<Uint8Array>
    segment({ session, n }): Promise<Uint8Array>                 // waits, serves, or restarts (Ruling 13)
    drop({ mediaId }): void
  }
  type HlsSession = { id: string; mediaId: number; mode: StreamMode; audio: number | null; quality: StreamQuality | null; plan: SegmentPlan }
  ```
- Timers and the clock come in through the constructor, so tests drive idle and waits.

- [ ] **Step 1: Write the failing tests** `hlsSessions.test.ts` (real ffmpeg, a 40-second clip, `hwAccel: 'none'`): segment 0 then 1 come from one run (one spawn); segment 5 after 1 kills and respawns at 5 and its first packet's pts is boundary 5 plus `STREAM_TIME_SHIFT`; segment 5's bytes from a fresh session equal those from the restarted one; on a clip with B-frames (`encodeRichClip` with `-bf 2`), segment 6 from a run started at 0 and from a run started at 5 has the same first pts, the same video packet count and the same `mdat`, and every segment's `tfdt` is its first dts on the shifted clock, not zero; asking 0, 5, 2, 6, 1 within a second leaves one ffmpeg alive and finally serves every segment; after `HLS_IDLE_MS` without requests the run is killed and the folder is gone; minting a ninth session drops the longest idle; a run that writes ten past the asked segment gets `SIGSTOP` (spy on `kill`). `args.test.ts`: `hlsArgs` from segment 4 of the spike's plan pins the spike's command (spec, "HLS muxing (2026-10-19)"), `-copypriorss 0`, `frag_discont`, `-segment_time_delta 0.005` and the relative `-segment_times` included; `hlsAudioArgs` of a 7.1 TrueHD track is `['-c:a', 'eac3', '-ac', '6', '-b:a', '640k']`, of AAC stereo `['-c:a', 'copy']`.
- [ ] **Step 2:** Run; FAIL. Implement. PASS.
- [ ] **Step 3:** Commit: `MAE: run raven's HLS sessions on demand`.

### Task 14: the HLS controller

**Files:**
- Create: `apps/raven/server/src/hls/hlsController.ts` (`@Controller('api/media') @PrivateBy('media')`, every route `@MediaPlane() @Get(...)`, paths from `HLS_PATHS` minus the `/api/media` prefix)
- Modify: `appModule.ts` (`CONTROLLERS`), `apps/raven/server/src/http.ts` (`RAVEN_CONTENT_TYPES.m3u8: 'application/vnd.apple.mpegurl'`, `segment: 'video/iso.segment'`), `lockGuard.test.ts`, `mediaPlaneCors.test.ts`, `appMediaPlane.test.ts` (add the six paths to their route lists)
- Test: `apps/raven/server/src/appHls.test.ts`

- [ ] **Step 1: Write the failing tests** `appHls.test.ts` against `createApp`: master for a remux returns 200 `application/vnd.apple.mpegurl`, names one variant, and every URI carries `t=`; the video playlist's `EXTINF`s sum to the duration within 0.01; `init` and `segment/0` return bytes `ffprobe` reads; `transcoding: off` refuses master with 403 in both modes, `remuxOnly` refuses transcode with 403; a file with a 25-second keyframe gap answers 409 to remux; a bad `:session` or `:n` answers 404; a ticket for another id answers 423 (404 with the admin lock on); the subtitle playlist and segment for an `external-0` sidecar return VTT with the `X-TIMESTAMP-MAP` header and the cues of that window, shifted by the file's start time (a clip encoded with `-output_ts_offset 2.5` puts a cue at 1 s at 3.5 s); no media response (init, segment) carries `content-encoding`; playlists and WebVTT segments may.
- [ ] **Step 2:** Run; FAIL. Implement. PASS. Run `bun run verify`; PASS.
- [ ] **Step 3:** Commit: `MAE: serve raven's media over HLS for native players`.
- [ ] **Step 4:** Update `apps/raven/README.md` (the HLS route under the server's API section) in the same commit or a docs commit. Thermo review, fix commit, push, open PR 3 against `device-headless`.

---

## PR 4: the app scaffold

### Task 15: the project, its tooling and its pins

**Files:**
- Create: `tooling/tsconfig/react-native.json` (extends the base: `jsx: react-native`, `lib: ["ES2023"]`, `types: ["react-native-tvos"]` or the fork's types package, `moduleSuffixes` left default)
- Create: `apps/raven/app/{package.json,tsconfig.json,.oxlintrc.json,.oxfmtrc.json,.gitignore,app.config.ts,metro.config.ts,babel.config.ts,index.ts,README.md,CLAUDE.md}`
- Modify: `knip.ts` (an `apps/raven/app` entry: `index.ts`, `app/**/*.tsx`, `app.config.ts`, `metro.config.ts`, `babel.config.ts`), `.github/workflows/pull-request-checks.yml` (later, Task 19), root `CLAUDE.md` (table row for `@raven/app`), `apps/raven/CLAUDE.md` (an "App" section: the jest/bun split, the polyfills, Ruling 16)

**Decisions:**
- `package.json`: `"name": "@raven/app"`, `"version"` equal to the workspace's, `"main": "index.ts"`, exact pins (Global Constraints). Check npm for a stable `react-native-tvos` 0.88 first (`npm view react-native-tvos versions --json`); if one exists pin it, else pin `0.88.0-0` and say so in the app's `CLAUDE.md`. React and `react-dom`-free: the app's `react` must be the repo's `19.3.0` if the fork's peer range allows; if not, pin what the fork requires and record why.
- `.gitignore`: `/ios/`, `/android/`, `/.expo/`, `/node_modules/`. `.oxlintrc.json` extends `tooling/oxlint/react.json`, ignores those folders, overrides `env.browser` off, allows default exports in `app/**` (expo-router needs them) and the three config files. `.oxfmtrc.json` identical options to web's plus the ignores.
- Scripts (one command each, all in `nx.includedScripts`): `start` (`expo start`), `prebuild:ios` (`expo prebuild --platform ios --clean`), `prebuild:tvos` (`EXPO_TV=1 expo prebuild --platform ios --clean`; an env prefix is still one command), `prebuild:android-tv` (`EXPO_TV=1 expo prebuild --platform android --clean`), `build:ios`, `build:tvos`, `build:android-tv` (`xcodebuild`/`gradlew` for simulators), `typecheck` (`tsgo --noEmit`), `lint:ts`, `lint:ts:fix`, `format`, `format:check`, `test` (`bun test --dots src`), `test:screens` (`jest`), `e2e` (`maestro test e2e`). None is named `build`, so `verify` does not try a simulator build (Ruling 20); `test:screens` joins `verify` and `affected` by name in the root `package.json`.
- `nx`: `projectType: application`, tags `scope:raven`, `lang:ts`.
- Metro: `watchFolders: [workspaceRoot]`, `resolver.nodeModulesPaths` app then root, the `@/` alias to `src/` in `resolveRequest`, package exports on.

- [ ] **Step 1:** Scaffold; `bun install`; run `bunx nx run @raven/app:typecheck` and `lint:ts` and `format:check`; PASS. `bun run verify`; PASS (the typescript-only and one-command checks included).
- [ ] **Step 2:** `bunx nx run @raven/app:prebuild:tvos` then `build:tvos`; the simulator app builds. Same for iOS and, on this Mac, Android TV. Nothing generated is tracked (`git status` clean but for the intended files).
- [ ] **Step 3:** Commit: `MAE: scaffold raven's device app`.

### Task 16: polyfills, the shared layer and the platform object

**Files:**
- Create: `apps/raven/app/src/polyfills.ts` (the formatjs imports and `en` data, in the spec's order), `apps/raven/app/index.ts` (imports polyfills first, then `expo-router/entry`)
- Create: `apps/raven/app/src/platform/platform.ts` (`APP_PLATFORMS = { ios: 'ios', tvos: 'tvos', androidTv: 'androidTv' } as const`, `platformOf({ os, isTV }): AppPlatform`)
- Create: `apps/raven/app/src/theme/nativeTokens.ts` (Ruling 18), core's `parseThemes` and ui's `themeTokens` export
- Test: `platform.test.ts`, `nativeTokens.test.ts`, `libs/raven/core/src/tokens.test.ts` (parseThemes)

- [ ] **Step 1: Write the failing tests:** `platformOf({ os: 'ios', isTV: true })` is `'tvos'`; `nativeTokens` turns `--space-4: 1rem` into `16` and `--color-night: #15201e` into `'#15201e'`; `parseThemes` of `themes.scss` gives seven themes each with `--color-night`.
- [ ] **Step 2:** Run; FAIL. Implement. PASS.
- [ ] **Step 3:** Build and launch on the tvOS simulator with a temporary Home that renders `formatAgo` from core and `usePlayerPrefs` from headless; it renders (screenshot to the PR's screenshots ref). Commit: `MAE: load raven's core and headless layer in the app`.

### Task 17: servers, sessions and sign-in

**Files:**
- Create: `apps/raven/app/src/servers/{serverList.ts,serverFetch.ts,cookieJar.ts,serverStore.ts}` and tests; `src/stores/activeServer.ts` (zustand: `servers`, `activeId`, `add`, `remove`, `activate`); `src/screens/SignIn.tsx`; `app/sign-in.tsx`
- Modify: core (`UNLOCK_COOKIE` if missing, Ruling 17), desktop's `cookieHeader.ts` imports it

**Interfaces:**
- Produces:
  ```ts
  type AppServer = { id: string; name: string; origin: string; addedAt: number }
  addServer({ servers, origin, name, id, at }): { kind: 'added'; servers: AppServer[] } | { kind: 'invalid' } | { kind: 'taken' }
  serverFetchFor({ server, jar, fetch }): FetchLike           // credentials omit, Cookie header, set-cookie read
  readUnlockCookie(setCookie: string | null): string | null
  apiFor(server): ApiClient                                   // createApiClient({ baseUrl: server.origin, fetch: serverFetchFor(...) })
  ```
- Sign-in flow: origin field (validated with core's or the desktop's origin rules; lift `serverOriginOf` and `isServerOrigin` from `apps/raven/desktop/src/shared/playLink.ts` to core if they are pure, so app and desktop share them), `getLock()`, PIN field when `available && !unlocked`, `unlock({ pin })`, then `getMediaTicket` on any media id from `getHome()` to learn whether tickets work: a 503 shows the spec's copy and keeps the cookie path.

- [ ] **Step 1: Write the failing tests:** `addServer` refuses `http://nas:8080/path` and a duplicate origin; `readUnlockCookie('raven_unlock=abc; Path=/api; HttpOnly; SameSite=Strict')` is `'abc'`, and ignores other cookies; `serverFetchFor` sends `Cookie: raven_unlock=abc` and `credentials: 'omit'`, and stores a new cookie from `unlock`'s `set-cookie`.
- [ ] **Step 2:** Run; FAIL. Implement. PASS. Render test of `SignIn` under `jest-expo` (`test:screens`): entering an origin and a PIN calls `unlock` and navigates to Home; a 503 ticket shows the copy.
- [ ] **Step 3:** Commit: `MAE: sign raven's app in to a server`.

### Task 18: Home on both layouts

**Files:**
- Create: `src/data/useAppQueries.ts` (`ravenQueriesFor(apiFor(active))`, memoised per server id), `src/screens/Home.tsx`, `src/layouts/{index.ts,Shelf.touch.tsx,Shelf.focus.tsx,Card.tsx}`, `app/_layout.tsx` (QueryClientProvider with headless `createQueryClient()`, redirect to sign-in without an active server), `app/index.tsx`, `src/routes.ts`
- Add `react-native-sse` (exact) for `serverEventsFor`'s `openEvents`

- [ ] **Step 1:** `test:screens` for Home: with a fake api answering a `Home` of Continue watching and two shelves, both layouts render the shelf titles and cards; the focus layout's first card has focus on mount (`hasTVPreferredFocus`).
- [ ] **Step 2:** Run; FAIL. Implement (focused card scaled 1.08 and ringed in the theme's focus colour; motion only when `AccessibilityInfo.isReduceMotionEnabled()` is false). PASS. Screenshot iPhone, iPad and Apple TV simulators.
- [ ] **Step 3:** Commit: `MAE: show raven's home on phones, tablets and TVs`.

### Task 19: CI, the fixture server, e2e and the allowlist test

**Files:**
- Create: `apps/raven/server/src/e2e/fixtureServer.ts`, `serve:fixture` script (Ruling 19)
- Create: `apps/raven/app/e2e/{signIn.yaml,home.yaml}`, `apps/raven/app/src/servers/allowlist.ts` (`APP_CALLS`: the `ApiClient` method names the app may call) and `allowlist.test.ts`
- Create: `libs/raven/core/src/appClientCalls.ts` (`APP_CLIENT_CALLS`: each call the app may make, as `{ method, path }` with `:id` templates). The app's `src/servers/allowlist.ts` wraps its `ApiClient` so a call outside the list throws, and `apps/raven/server/src/appClients.test.ts` checks the list against `routeMarks(CONTROLLERS)`: every entry matches a route, none is `@AdminOnly`, and every non-GET is in the spec's write list. A project may not import another's files, so the list lives in core and both read it.
- Modify: `.github/workflows/pull-request-checks.yml`: `app-apple` (macos-26: install, `prebuild:tvos`, `build:tvos`, `prebuild:ios`, `build:ios`, Maestro on the tvOS simulator against `serve:fixture`), `app-android-tv` (ubuntu-24.04 with KVM: `prebuild:android-tv`, `build:android-tv`; its e2e arrives in Task 29); both in the `desktop` gate's `needs`. Root `package.json`: `app:e2e` alias like `desktop:e2e`.

- [ ] **Step 1:** Write `appClients.test.ts`; FAIL until `APP_CLIENT_CALLS` exists; implement; PASS.
- [ ] **Step 2:** Run the Maestro flows locally on the tvOS simulator against `serve:fixture`: sign in with the fixture PIN, Home shows the fixture movie. PASS.
- [ ] **Step 3:** Commit: `MAE: build and test raven's app in CI`. Thermo review, fix commit, push, open PR 4 against `device-hls`; CI green.

---

## PR 5: Library, Item and search

### Task 20: Library

- **Files:** `src/screens/Library.tsx`, `app/library/[id].tsx`, `src/layouts/Grid.{touch,focus}.tsx`, tests.
- Uses `KIND_RULES`, `coherentSettings`, `sortsFor`, `viewsFor`, `groupingsFor`, `LETTERS`, `jumpScale` from core and `ravenQueries`' listing query. Sort and grouping pickers are the platform's (an action sheet on touch, a focusable list on TV).
- [ ] **Step 1:** `test:screens`: a movies library lists posters in the default sort; switching to a sort `sortsFor` allows refetches with it; a sort it does not allow is not offered; a show library groups by letter as the web does.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: browse a raven library in the app`.

### Task 21: Item

- **Files:** `src/screens/Item.tsx`, `app/item/[id].tsx`, `src/layouts/ItemLayout.{touch,focus}.tsx`, tests.
- Movie, show, season and episode from `itemQuery`; facts from core's `movieFacts`, `showFacts`, `episodeFacts`, `fileFacts`; Play or Resume from `progressOf` and `watchLink`; Mark watched through `watchedChangeFor`, Favourite through `mediaMutationsFor` with `itemFavouriteEdits`.
- [ ] **Step 1:** `test:screens`: a half-watched movie shows Resume and the time left; Mark watched calls `markWatched` and the button flips optimistically; a show lists its seasons, a season its episodes.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: show a raven title in the app`.

### Task 22: Search

- **Files:** `src/screens/Search.tsx`, `app/search.tsx`, tests.
- Debounced: searches when typing pauses for 200 ms (the web's `SEARCH_DELAY_MS`; read it from web's `useSearch` and lift the constant to core) or on submit, never per keystroke. On TV the platform keyboard.
- [ ] **Step 1:** `test:screens` with fake timers: typing "dune" fires one search after the pause; submitting fires at once; clearing shows nothing.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: search raven from the app`. Thermo review, fix commit, push, open PR 5 against `device-app`.

---

## PR 6: the player on iPhone and iPad

### Task 23: what each platform plays

- **Files:** `src/platform/canPlay.ts` and test.
- Produces `canPlayFor(platform: AppPlatform): { canPlay: CanPlay; canStream: CanPlay }` over core's mime strings (`containerMimeType`, `videoCodecString`, `audioCodecString`, `streamMimeType`), the Apple table from Global Constraints, the Android TV table from the spec (Task 28 fills it; until then Android TV answers like Apple).
- [ ] **Step 1:** Tests: on `ios`, `planPlayback` for an MP4 H.264 AAC file starts `direct`; MKV HEVC TrueHD starts `remux`; MP4 HEVC under `hev1` is direct with remux after it; AV1 MKV goes to `transcode`; `transcoding: off` with an MKV leaves no mode and a problem.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: tell raven's planner what Apple devices play`.

### Task 24: media access: tickets, origins and the cookie fallback

- **Files:** `src/servers/mediaAccess.ts` and test.
- Produces `mediaAccessFor({ api, server, now })`: `{ source({ media, mode, audio, quality }): Promise<{ uri: string; headers: Record<string, string> }> }`. Probes `getMediaOrigins` with core's `pingUrl` and `pickOrigin` on launch and on `NetInfo` change; reads a ticket per media, renews `MEDIA_TICKET_REFRESH_SECONDS` before `expiresAt` (milliseconds, as the desktop found) and whenever older than that on use; on a 503 ticket returns the stored origin with `headers: { Cookie: ... }`.
- [ ] **Step 1:** Tests: a LAN origin answering fastest is picked; a ticket within the refresh margin is renewed before a source is built; a 503 ticket gives the cookie header on both a file and an HLS URI.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: reach raven's media from the app by ticket`.

### Task 25: the touch player

- **Files:** `src/screens/Player.tsx`, `app/play/[mediaId].tsx`, `src/layouts/PlayerChrome.touch.tsx`, `src/player/usePlaybackSession.ts` and tests; add `react-native-video` (exact) and `@react-native-community/netinfo` (exact).
- The ladder: start at the plan's first mode, step down on `onError` or no `onLoad` within 15 s, from the current position. Controls: play and pause, scrub, ten-second skips, audio and subtitle pickers (direct play: the file's tracks through `selectedAudioTrack`/`selectedTextTrack` and sidecar `textTracks` from the VTT route; HLS: the renditions), PiP and AirPlay on. Progress through `saveProgress` every 10 s and on pause and exit, `recordPlay` once past the library's watched percentage, as the web's `useWatchProgress` (read its intervals and rules; lift them to headless if they are inline constants).
- [ ] **Step 1:** Tests (bun for `usePlaybackSession`'s reducer, jest for the screen): an error in `direct` reloads `remux` at the same position; a 409 on remux goes to `transcode`; reaching 90% of a library with `watchedPercent` 90 calls `recordPlay` once.
- [ ] **Step 2:** FAIL, implement, PASS. Manual on the iPhone and iPad simulators against `serve:fixture`: direct MP4 and HLS remux of the MKV both play and resume. Screenshots. Commit: `MAE: play raven titles on iPhone and iPad`. Thermo review, fix commit, push, open PR 6 against `device-browse`.

---

## PR 7: the player on Apple TV

### Task 26: the system transport

- **Files:** `src/layouts/PlayerChrome.focus.tsx` and test.
- `react-native-video` with `controls` on (AVPlayerViewController), the audio and subtitle choices given as HLS renditions so the system's panel lists them, title and synopsis through the info panel metadata (`metadata` prop). Ruling 22 decides direct play.
- [ ] **Step 1:** Test: on `tvos`, a direct-playable MP4 with a sidecar starts in `remux`; without one, in `direct`. FAIL, implement, PASS.
- [ ] **Step 2:** Manual in the tvOS simulator: Siri remote swipe scrubs, Menu leaves and saves progress, subtitles pick from the panel. Commit: `MAE: play raven titles on Apple TV`.

### Task 27: focus and the remote

- **Files:** `src/layouts/focus.ts` (helpers: `useTvBack`, focus guides between shelves), tests; Maestro `e2e/play.yaml`.
- Menu on Home asks nothing and exits as tvOS expects; Menu elsewhere goes back. Focus returns to the card that opened a screen.
- [ ] **Step 1:** Maestro flow: sign in, Home, select the fixture movie, Play, wait for playback, Menu, Home shows it under Continue watching. PASS in the tvOS simulator.
- [ ] **Step 2:** Commit: `MAE: drive raven's TV app from the remote`. Thermo review, fix commit, push, open PR 7 against `device-play-touch`.

---

## PR 8: Android TV

### Task 28: ExoPlayer's table and the d-pad player

- **Files:** `src/platform/canPlay.ts` (the Android TV table: containers `mkv`, `mp4`, `mov`, `webm`; video `h264`, `hevc`, `av1`, `vp9`; audio `aac`, `ac3`, `eac3`, `opus`, `vorbis`, `flac`, `mp3`; `dts` and `truehd` maybe), `src/layouts/PlayerChrome.focus.tsx` (on Android TV raven's controls, driven by `useTVEventHandler`), tests.
- [ ] **Step 1:** Tests: on `androidTv`, MKV HEVC E-AC-3 starts `direct`; MKV with TrueHD is direct with remux after; d-pad left and right seek ten seconds. FAIL, implement, PASS.
- [ ] **Step 2:** Manual in the Android TV emulator. Commit: `MAE: play raven titles on Android TV`.

### Task 29: Android TV e2e

- **Files:** `.github/workflows/pull-request-checks.yml` (`app-android-tv` runs the Maestro flows on the emulator with `reactivecircus/android-emulator-runner` pinned by commit SHA), `e2e` flows parameterised by platform.
- [ ] **Step 1:** CI green on the PR. Commit: `MAE: test raven's app on Android TV in CI`. Thermo review, fix commit, push, open PR 8 against `device-play-tv`.

---

## PR 9: Settings, themes and polish

### Task 30: Settings

- **Files:** `src/screens/Settings.tsx`, `app/settings.tsx`, tests; `src/stores/appPrefs.ts` (theme, prefer direct play, allow transcode, away-from-home max height `2160 | 1080 | 720`, persisted to AsyncStorage).
- Servers (add, rename, remove, switch; removing clears its cookie and its cached queries), theme from `THEMES`, playback. The playback policy the planner sees is the server's narrowed by these.
- [ ] **Step 1:** Tests: switching servers clears the Query cache and Home refetches from the new one; "allow transcode" off removes `transcode` from the plan; away-from-home cap 1080 passes `quality` and `maxHeight` to `hlsUrl` when the picked origin is `public`.
- [ ] **Step 2:** FAIL, implement, PASS. Commit: `MAE: add settings to raven's app`.

### Task 31: themes

- **Files:** `src/theme/useTheme.ts` (zustand), every layout reads colours from it.
- [ ] **Step 1:** Test: picking Patina gives the light logo and Patina's `--color-night`; the choice survives a relaunch. FAIL, implement, PASS. Screenshots of two themes on TV and phone. Commit: `MAE: theme raven's app`.

### Task 32: docs and the device pass

- **Files:** `apps/raven/README.md` (an "raven app (iPhone, iPad, Apple TV, Android TV)" section: install with a Personal Team, sideload the APK, weekly reinstall, watchman), `apps/raven/app/README.md` (dev loop, the M1 to M15 checklist with an empty result column, Ruling 21), root `CLAUDE.md` (the app's Mac-only targets beside the desktop's), the spec's status ("implemented through PR 9").
- [ ] **Step 1:** `bun run verify`; PASS. Commit: `MAE: document raven's device app`. Thermo review, fix commit, push, open PR 9 against `device-android-tv`.
