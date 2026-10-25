# raven device apps: iPhone, iPad, Apple TV and Android TV

Status: approved 2026-10-18; implemented through PR 9 (Settings, themes and polish), as nine stacked PRs built from the plan, `docs/superpowers/plans/2026-10-18-raven-device-apps.md`. Account sign-in on the app is PR 10 (plan Ruling 28). The real-device pass over M1 to M15 is the user's (plan Ruling 21): its checklist is in `apps/raven/app/README.md`, with the result column still empty, beside the app's known gaps. This builds on the desktop spec, `2026-10-12-raven-desktop-design.md` (its `Engine` and `PlayerServices` contracts, its server list and per-server sessions, and its D1 plan to lift the query layer out of the web app), and on the direct media spec, `2026-10-16-raven-direct-media-design.md` (media origins and media tickets, which are how a native player fetches video without a cookie). It was written from the conversation of 2026-10-17 without a brainstorm; every choice below is either what the user settled in that conversation, marked "decided", or the author's call, marked as such.

## Context

raven's clients today are a browser and the macOS desktop player. iPhone and iPad already play raven in Safari, through `ManagedMediaSource`, but as a web page: no icon on the home screen, no Picture in Picture, no AirPlay, no background audio, and a sign-in that lives in a cookie Safari may drop. Apple TV and Android TV have no client at all: tvOS has no browser engine, and a TV's browser is not something anyone watches a film in.

This adds one app, **raven**, built once and shipped to four screens: iPhone, iPad, Apple TV and Android TV. It is a viewer's app: browse, search, resume, play, mark watched and favourite. Managing the library stays in the web app.

Decided with the user:

- **One codebase for all four screens**, React Native through Expo on the `react-native-tvos` fork. It is the only mainstream stack that reaches both Apple TV and Android TV from one project, and it imports `@raven/core` unchanged.
- **The app lives in this workspace**, at `apps/raven/app`, as an Nx project under the repo's rules: TypeScript only, Nx targets from `package.json` scripts, bun test where it can run.
- **Video plays through the platform's player**: AVPlayer on iPhone, iPad and Apple TV, ExoPlayer on Android TV, both behind `react-native-video`. No libmpv in this app.
- **The server gains an HLS route**, because AVPlayer plays HLS and progressive MP4 only, never the fMP4 over MSE stream the browser uses, and never MKV. Android TV uses the same route when it cannot direct play.
- **The pure logic now sitting in `@raven/ui` and `@raven/web` moves out first**, so the app shares one query layer, one player state machine and one set of helpers with the web and desktop instead of copying them. No library is duplicated.
- **Android TV is "for fun"**: it ships from the same code with the same screens, and it never holds the Apple screens back. A feature that works on Apple TV but not yet on Android TV is fine.
- **Distribution starts free.** A Personal Team in Xcode installs the app on the user's own iPhone, iPad and Apple TV, expiring weekly. The paid Apple Developer Program (TestFlight, year-long installs, the App Store) is a later decision, and the same membership would also notarize the desktop app.

## Goals

- On Apple TV, from the home screen to a playing 4K HEVC remux in under three remote clicks once signed in: Continue watching, pick, play.
- Every file the web player can play, the app can play, by direct play where the device decodes it and by the server's remux or transcode where it does not, with the same step-down ladder the web uses.
- Where you stopped, what you watched and what you favourited are the server's, as they are from the browser: Continue watching and the watched marks come out the same on every client.
- One app, two layouts: a touch layout for iPhone and iPad, a focus-driven layout for the two TVs, over the same screens, data and player.
- Nothing is copied from the web app. The app imports what the web app imports.

## Non-goals

- Managing the library: scanning, matching, editing metadata, images, playback settings, the admin lock. The admin routes are never called. If an admin wants those on a tablet, the web app is there.
- Offline downloads on iPhone and iPad. The `raven://download` link and the desktop's download ledger are a follow-up, once the desktop's downloads have shipped and shown what the server needs.
- Android phones and tablets. The Android TV build runs on them, but no layout is designed for them.
- Accounts or per-viewer anything. The server has one PIN and one set of progress.
- Casting, Chromecast, SharePlay. AirPlay is whatever AVPlayer gives for free.
- Replacing the browser's MSE pipeline. HLS is a second output of the same ffmpeg, for native players; the web keeps its stream.

## Anti-goals

- A player that only plays MP4. If the app cannot play the user's MKV remuxes it has failed, however good the screens look.
- A second query layer, a second player reducer, a second `itemFacts`. The moment the app carries a copy of something the web has, the two drift. The extraction PRs come first for this reason.
- A TV layout that is the phone layout scaled up. Focus, the Siri remote's swipe and the Android remote's d-pad are the interaction model; a design that needs a pointer has failed.
- A route that needs the PIN cookie on a media request. Native players do not carry cookies reliably; media goes by ticket.

## What the viewer sees

### Sign in

The first launch asks for the server's address, as the desktop's Settings does, and the PIN if the server has one. The app keeps a list of servers, one active at a time, exactly the desktop's model: a name, an origin, a session. Switching servers is in Settings.

### Home

The server's `GET /api/home`: Continue watching, Recently added, and the libraries. On TV, horizontal shelves with a focused card grown and lit by the theme's focus ring. On a phone, the same shelves scrolled vertically.

### Library

A library's grid, with the sorts, views and groupings `KIND_RULES` allows for its kind, the same `coherentSettings` the web applies. Letter and group folders as the web shows them. A search box per the repo's rule: debounced, searches when typing pauses or on Enter, never on each keystroke. On TV the on-screen keyboard is the platform's.

### Item

A movie, a show, a season or an episode: poster, backdrop, synopsis, cast, the files on the card, a Play or Resume button, Mark watched, Favourite. The same facts `itemFacts` computes for the web.

### Player

The platform's player with raven's own controls on top where the platform lets it, and the platform's where it does not:

- **iPhone and iPad**: raven's controls, as the web's, over `react-native-video`. Picture in Picture and AirPlay through AVPlayer. Background audio off; this is video.
- **Apple TV**: the system transport is what people expect from the Siri remote, so the player uses AVPlayerViewController's controls, with raven adding the audio and subtitle pickers through HLS renditions and the info the panel shows. A custom control strip on tvOS is the author's call to avoid: it would fight the remote's gestures.
- **Android TV**: `react-native-video`'s ExoPlayer with raven's controls driven by the d-pad.

Progress is reported as the web reports it (`saveProgress`, `recordPlay`, the watched percentage per library), so the server's Continue watching and History are right whichever client played.

### Settings

Servers, the theme from `THEMES` (the seven the web has), and playback: prefer direct play, allow transcode, the maximum resolution the app asks for away from home. No server settings.

## The app

### Project

`apps/raven/app`, package `@raven/app`, an Expo app on the `react-native-tvos` fork, `expo-router` for navigation. Scripts, each one command and listed in `nx.includedScripts`:

| Script | Does |
| --- | --- |
| `start` | Metro for a device or simulator |
| `prebuild:apple`, `prebuild:android` | Generates the native projects; the Apple one with `EXPO_TV=1` for the tvOS target |
| `build:ios`, `build:tvos`, `build:android-tv` | Simulator or emulator builds, for CI and the e2e |
| `typecheck`, `lint:ts`, `format`, `format:check`, `test` | As every project |
| `e2e` | Maestro flows on the tvOS simulator and the Android TV emulator; macOS only, so it sits with the desktop's Mac-only targets |

The native projects (`ios/`, `android/`) are generated and gitignored. Everything checked in is TypeScript and the Expo config.

### Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Runtime | Expo SDK on `react-native-tvos`, the newest the fork supports | TV needs the fork; Expo gives prebuild, config plugins and the dev client |
| Navigation | `expo-router` | File routes, one tree, platform layouts by `Platform.isTV` |
| Data | TanStack Query and zustand | What the web and `@raven/ui` already use; the shared query layer needs them |
| Video | `react-native-video` | AVPlayer and ExoPlayer behind one component, HLS and progressive on both, subtitle and audio track selection, PiP |
| Styling | React Native styles from the shared tokens | No SCSS on native; `@raven/ui/designTokens` supplies the values, `THEMES` the themes |
| Tests | bun test for everything that imports no `react-native`; see Testing for the rest | The repo's runner first |

### Structure

```
apps/raven/app/
  app/                 expo-router routes: (phone)/ and (tv)/ layouts over shared screens
  src/
    screens/           Home, Library, Item, Player, Settings, SignIn: one component each, layout-agnostic
    layouts/           PhoneShelf, TvShelf, focus helpers, the two Player chromes
    platform/          canPlay tables, the Platform object the shared layer wants
    servers/           the server list, sessions, the cookie jar, tickets
    stores/            app-only zustand stores
  app.config.ts, metro.config.ts, babel.config.ts (see Repo fit)
```

The screens take their data from the shared query hooks and render through layout components picked by platform. A screen never reads `Platform.isTV` itself; the layout does.

## Playing

### The ladder

`planPlayback` in `@raven/core` already takes a policy and a `canPlay`. The app gives it a table per platform instead of the browser's `canPlayType`, and the ladder is the web's: direct play, then the server's remux, then its transcode, stepping down from the same spot when a mode fails to start or decode.

### Apple: iPhone, iPad, Apple TV

AVPlayer plays progressive MP4 and MOV over HTTP ranges, and HLS. Nothing else.

- **Direct play**: `container` is `mp4` or `mov`, `videoCodec` is `h264` or `hevc` (any bit depth, HDR10 and Dolby Vision profile 5 or 8 included on Apple TV 4K; Dolby Vision profile 7, which lives in MKV, is never direct), `audioCodec` is `aac`, `ac3`, `eac3`, `alac` or `flac`. The source is `GET /api/media/:id/file?t=<ticket>` on the chosen media origin. HEVC in MP4 under the `hev1` tag may refuse, so `canPlay` answers "maybe" for `mp4` and `hevc`, and a refusal steps down.
- **Remux** (MKV, and anything the table refuses by container only): the HLS route in remux mode. Video copied, re-tagged `hvc1` for HEVC as the MSE stream does. Audio the device decodes is copied; DTS, DTS-HD, TrueHD, Opus and Vorbis are transcoded to E-AC-3 keeping the channel count, since AVPlayer passes E-AC-3 through to a receiver.
- **Transcode**: the HLS route in transcode mode, the server's encoder, tone mapping and quality settings as the web gets them, capped by the app's away-from-home resolution setting.
- **Subtitles**: HLS subtitle renditions built from the server's WebVTT route, so AVPlayer shows them with the system's subtitle styling and picker. Sidecar and embedded alike, since the server already serves both as VTT.

### Android TV

ExoPlayer plays MKV, MP4 and HLS, and decodes HEVC, AV1, VP9 and H.264; DTS and TrueHD depend on the device's passthrough.

- **Direct play**: the file route by ticket, for `mkv`, `mp4`, `mov` and `webm` with any video codec the device reports and audio it decodes or passes through. The table starts generous and narrows from what fails in use.
- **Remux and transcode**: the same HLS route. ExoPlayer plays the same playlists AVPlayer does.

### HDR

On Apple TV, HLS carries HDR10 and Dolby Vision when the segments do, and AVPlayer switches the display. The HLS route copies the colour metadata on remux. Tone mapping on transcode follows the server's existing setting. Nothing in the app decides HDR.

## Server: the HLS route

A new output of the same ffmpeg, next to `GET /api/media/:id/stream`, marked `@MediaPlane()` and held by `PrivateBy('media')` so a ticket opens it:

```
GET /api/media/:id/hls/master.m3u8?mode=remux|transcode&audio=<index>&t=<ticket>
GET /api/media/:id/hls/video.m3u8?mode=...&audio=...&t=...
GET /api/media/:id/hls/sub/:trackId.m3u8?t=...
GET /api/media/:id/hls/:session/:n.m4s?t=...
GET /api/media/:id/hls/:session/init.mp4?t=...
```

- **The playlist is the whole film from the start**, a VOD playlist listing every segment with its duration, so the player's scrubber is the real timeline and a seek is a request for segment `n`. This is how Plex and Jellyfin do it, and it is what makes seeking on a TV feel right. A growing playlist that follows ffmpeg would make the scrubber lie.
- **Segments are produced on demand.** A session is one ffmpeg run writing segments to a temp folder (`-f segment`, fMP4, six seconds nominal). A request for a segment the session has not written, outside the window it is writing towards, kills the session's ffmpeg and starts one at that segment's start time. A request for a written segment is served from the folder. The server's existing rule holds: the moment the client lets go, ffmpeg is killed; after sixty seconds without a request a session's ffmpeg is killed and its folder deleted, while the session itself is kept so that a player paused for longer resumes it.
- **Segment boundaries.** On transcode, `-force_key_frames` every six seconds makes the segments equal and the playlist exact. On remux, video is copied, so segments can only start on the file's keyframes: the server probes the keyframe timestamps once per file (`ffprobe -skip_frame nokey`), keeps them beside the tracks it already caches, and the playlist's segment durations are the real keyframe gaps. A file whose keyframe gaps exceed twenty seconds plays through transcode instead; the playlist route says so with a 409 the app treats as a step down.
- **Timestamps** keep the file's own clock plus `STREAM_TIME_SHIFT` ("FFmpeg versions" below). The MSE stream keeps `-start_at_zero`, so its timestamps are the file's minus the file's start time: the two outputs differ by that start time, which is zero for most files. Progress reports from an HLS player use the playlist's clock, the player's own position from the first segment's start, never a segment's pts.
- **Audio** is selected per session with the same `audio` query as the stream route. Changing the audio track in the player is a new session at the current time.
- **Subtitles** are a subtitle rendition per track in the master playlist, each a WebVTT playlist cut into the same six-second windows from the existing VTT route, so the existing route does the work and nothing new parses subtitles.
- **Settings** apply as to the stream route: transcoding off refuses both modes with 403, remux only refuses transcode.
- **Load**: one ffmpeg per session, one session per device. The segment folder is bounded: at most the last thirty segments of a session are kept.

Nothing changes for the stream route or the browser.

## Reaching the server

- **Servers and sessions.** The app keeps the desktop's model: a list of servers with a name and an origin, one active, each with its own cookie jar. The PIN unlock is `POST /api/lock/unlock` as the web does it, and the cookie is held per server by the app, never by the system's shared jar (the Android TV build and the iOS build both pin their jars to the app).
- **Tickets.** Every media request the native player makes, file, playlist or segment, carries a media ticket (`?t=`) from `GET /api/media/:id/ticket`, refreshed by the app before it expires. This needs `RAVEN_MEDIA_SECRET` set on the server; a server that answers 503 to the ticket route is told to the viewer in plain words on sign-in ("This server can't hand out media tickets. Set `RAVEN_MEDIA_SECRET` on it to play in the app"), and the app falls back to sending the server's cookie as a request header through `react-native-video`'s `headers`, which works on both players for direct play and HLS alike. Tickets are the path; the header is the fallback for a server not yet configured.
- **Media origins.** `GET /api/media-origins` and `pickOrigin` from the direct media spec apply unchanged: on launch and on network change the app probes the origins and plays from the fastest. A native app has no mixed-content rule, but iOS and tvOS block plain `http://` through App Transport Security, so a dev build that reaches a LAN origin without TLS sets `NSAllowsLocalNetworking` in the Expo config; the server's list stays HTTPS-only and release builds do not relax it.
- **Allowlist.** Like the desktop, the app calls a fixed set of viewer routes and nothing marked `@AdminOnly()`. The set is the `@ForViewers()` and `@Public()` reads plus `saveProgress`, `recordPlay`, the watched and favourite changes, `unlock`, `ticket` and the media plane. A test in the app asserts the set against the server's route marks so a new admin route can never slip in.

## Extraction: what moves before the app exists

Three PRs, no behaviour change, each leaving web and desktop importing from the new home.

### `@raven/core` takes the pure helpers

From `apps/raven/web/src/lib`: `itemFacts`, `itemLinks`, `entryKeys`, `edits`, `history`, `letters`, `libraryKinds` (the web's, merged with core's own), `mediaProgress`, `tableSort`, `plural`, `sagas`, `version`, `routeQuery`, `jumpScale`. From `apps/raven/web/src/stores`: `selection`, `pageBackdrop`, `unlockPrompt`, each with its storage, if any, taken as a parameter. From `@raven/ui`: `parseTokens`, `themes`, `trackLabels`, `shortcuts`. Their tests move with them. Anything that touches `window`, `document` or `localStorage` stays where it is.

### `@raven/ui` gains a DOM-free entry

A new subpath export, `@raven/ui/headless`, beside `./canPlay` and `./designTokens`, built from a second entry whose module graph imports no `react-dom` and no SCSS:

- the player state: `useVideoState`'s reducer and types, `fromPlayerEvent`, the `Engine` and `PlayerServices` contracts, `PlayerServicesProvider`;
- the query layer lifted from web: `queries`, `queryClient`, `invalidate`, `useMediaMutations`, `useWatchedChange`, `usePlaybackPolicy`, `sharedPlaybackPolicy`, `optimistic`, `useServerEvents` with its event source taken as a parameter, joined by ui's own `playerQueries` and `playerQueryKeys`;
- `playerPrefs`, with `createJSONStorage`'s storage passed in instead of `window.localStorage`.

One more thing the spike found about core itself: `format.ts` builds `Intl.RelativeTimeFormat` and `grouping.ts` builds `Intl.DateTimeFormat` at module scope, and `languageName.ts` builds `Intl.DisplayNames`. Hermes, the engine under React Native, has no `Intl.RelativeTimeFormat` and no `Intl.DisplayNames`, so importing core crashes the app at startup with "undefined cannot be used as a constructor". The app's entry file loads the formatjs polyfills (`@formatjs/intl-getcanonicallocales`, `intl-locale`, `intl-pluralrules`, `intl-relativetimeformat`, `intl-displaynames`, with their `en` locale data) before anything imports core, which the spike verified on both TVs. Core stays as it is: the polyfills are the platform's concern, as `fetch` is.

A test imports the built `headless` entry under bun with no DOM globals and fails if anything in it reaches for one. The web app and the desktop renderer import the lifted modules back from here. This is the desktop spec's D1 extraction, done now because a third client needs it.

### `@raven/web` keeps what is the browser's

`api.ts`, `clipboard`, `posters`, `holdInPlace`, `logoTone`, `useSelectable`, `useScrollReset`, `useSearch`, `useReturnFocus`, `useHoverBackdrop`, the `theme` and `sideMenu` stores, and every component.

## Repo fit

- **TypeScript only.** Expo and Metro default to `metro.config.js` and `babel.config.js`, but the spike showed that Expo 58's Metro and Babel read `metro.config.ts` and `babel.config.ts` directly, and `app.config.ts` has always been supported. The app has no JavaScript files and the rule holds as written. The generated `ios/` and `android/` folders are gitignored, so their build scripts never meet the check.
- **One command per script.** Expo's CLI commands are single commands; chains use `bun run --sequential`.
- **Imports** go through `@/` with no extension; Metro's resolver is given the alias in `metro.config.ts`, matching `tsconfig.json`.
- **Tooling.** A fourth tsconfig preset, `tooling/tsconfig/react-native.json`, extends the base with `jsx: react-native` and the fork's types. `tooling/oxlint/react.json` applies as is. No gale, no SCSS, no `tooling/web`.
- **Nx.** The app's `nx` block lists its scripts, tags `scope:raven` and `lang:ts`, and `implicitDependencies` on nothing: its imports of `@raven/core` and `@raven/ui` are the graph. `verify` and `affected` run its `typecheck`, `lint:ts`, `format:check` and `test`; the builds and `e2e` are Mac-only and sit behind the `🖥️ Desktop` check with the desktop's.
- **Versioning.** `bump_version.sh` bumps `@raven/app` with the rest; the Expo config reads `version` from `package.json` and sets `ios.buildNumber` and `android.versionCode` from the CI run number.

## Testing

- **bun test** for every module that imports nothing from `react-native`: `platform/canPlay` tables, the servers and tickets logic, the allowlist test, the stores, and the shared layer's tests which already run that way.
- **Screens and layouts**: `jest-expo`, as a second `test:screens` script listed in `includedScripts`. The spike showed bun cannot get there: React Native ships Flow-typed source bun cannot parse, a Babel preload that strips it then trips over Babel's module interop under bun, and the native-module mocks of React Native's jest setup still wait behind that. The limit is written in the app's `CLAUDE.md`: jest for files that render a native component, bun for everything else, never both for one file.
- **e2e**: Maestro flows on the tvOS simulator and the Android TV emulator against a raven server started from the repo with a fixture library, as the desktop's e2e does: sign in, open Home, play a title, scrub, resume. Mac only.
- **Server**: the HLS route gets vitest coverage like the stream route: playlist arithmetic from keyframe lists, session restart on an out-of-window segment, cleanup, the 403s and the 409.
- **Real devices**: the user's Apple TV 4K and an Android TV, installed from Xcode and Android Studio. The playback ladder is checked against the desktop spec's M1 to M15 media set on the NAS.

## Distribution

- **Now**: a Personal Team in Xcode, installs from Xcode to the user's own devices, reinstalled weekly. Android TV sideloads an APK over `adb` with no account at all.
- **Later, if wanted**: the Apple Developer Program for TestFlight and year-long installs, which also unlocks Developer ID signing for the desktop app. Google Play for Android TV if it is ever more than for fun.
- **CI** builds the simulator and emulator apps on every PR that touches the app or what it imports, and attaches them to the release like the desktop's artifacts. No signing in CI until a certificate exists.

## Order of work (one PR each, spike first)

0. **Spike**: done on 2026-10-17, results below.
1. **core takes the pure helpers.** Web and ui import them back. No behaviour change.
2. **ui's headless entry.** The player state and the lifted query layer, with the no-DOM test. Web and desktop import back.
3. **Server: HLS route**, keyframe probing, sessions, subtitle renditions, tests.
4. **App scaffold**: the Nx project, the tsconfig preset, Expo config, the servers and sign-in screen, Home on both layouts, CI builds.
5. **Library, Item, search** on both layouts.
6. **Player on iPhone and iPad**: the ladder, tickets, origins, progress, watched.
7. **Player on Apple TV**: the system controls, HLS renditions, focus.
8. **Android TV**: ExoPlayer direct play table, d-pad controls, its e2e.
9. **Settings, themes, polish**, and the real-device pass over M1 to M15.

Each PR is reviewed as a whole branch against `main` and lands on its own, per the workspace's stacked-PR practice.

## Spike results (2026-10-17)

A throwaway Expo app on the TV fork, built in a scratch folder outside the workspace, importing `@raven/core` from its built `dist` and playing Apple's public "bip bop" HLS stream through `react-native-video`. It ran on the Apple TV 4K simulator (tvOS 27, Xcode 27) and on an Android TV emulator (Android 16, API 36, `tv_4k` profile). Both played the stream: tvOS through AVPlayer, Android TV through ExoPlayer, each reporting `Platform.isTV` true.

| Question | Answer |
| --- | --- |
| Do Metro and Babel read `.ts` configs? | Yes. A resolver only `metro.config.ts` knows and a plugin only `babel.config.ts` knows both showed up in the bundle, and on both screens. No JavaScript file is needed. |
| Does core import and run? | Yes, once the Intl polyfills load first (see Extraction). Without them the app crashes at startup on `Intl.RelativeTimeFormat`. |
| Does the fork's Expo SDK build on this Xcode? | Yes. Expo 58.0.14 pairs with React Native 0.88, and the fork's matching build is `react-native-tvos@0.88.0-0`, a prerelease: the fork's stable tags lag one minor behind. The generated project is a true tvOS target (`SDKROOT appletvos`, deployment target 16.4) and still needs CocoaPods, which was not on this Mac and had to be installed. |
| Can bun test render a native component? | No. See Testing. |
| Does Android TV build from the same project? | Yes. `EXPO_TV=1` prebuild emits the leanback launcher and the no-touchscreen feature, Gradle 9.4 builds it with Android Studio's bundled JDK, and the APK runs on the TV emulator. |

Versions the spike ran, which PR 4 pins: Expo 58.0.14, `react-native-tvos` 0.88.0-0, `react-native-video` 6.19.3, `@react-native-tvos/config-tv` 0.1.7, Metro 0.87.1, Babel 7.29.

Two things the spike learned about the dev loop:

- **Metro needs watchman on this Mac.** Without it, Metro served stale bundles after every file change, and even after `bun add`, until restarted with `--clear`. The app's README says to `brew install watchman`, and the `start` script fails fast when it is missing.
- **The simulator plays audio through the Mac.** A test stream with sound is audible at the desk. Worth knowing before an e2e run.

Not verified by the spike, left for PR 4: Metro resolving `@raven/core` through the Bun workspace symlink (the spike's `file:` dependency copied core into `node_modules`), `@formatjs/intl-displaynames`'s `exports` map, which Metro warns about and falls back from, HDR output, and anything on a real device.

### HLS muxing (2026-10-19)

A throwaway spike in a scratch folder, on ffmpeg 9.0.2 (Homebrew, `libx265` and `libx264`). Two 90-second clips with an irregular GOP, built from twelve lavfi sources of uneven length so scene cuts land between the forced keyframes, encoded with `-g 240 -keyint_min 12 -sc_threshold 40`: an HEVC MKV (x265's default open GOP, so CRA keyframes with leading pictures) and an H.264 MP4 at 24000/1001 fps, whose keyframes fall between milliseconds. The segment plan is Ruling 11's, from the keyframes ffprobe lists. Each output file was split after `moov` into `init.mp4` and the segment, written into a VOD playlist (`EXT-X-VERSION:7`, `EXT-X-MAP`, `EXT-X-PLAYLIST-TYPE:VOD`), served over HTTP and played by AVFoundation on the Mac, by AVPlayer in the Apple TV 4K simulator (tvOS 27) through `react-native-video` 6.19.3 on Expo 58.0.14 and `react-native-tvos` 0.88.0-0, and by ExoPlayer (Media3 1.8.0) in the Android TV emulator (API 36) through the same app. The pinned versions built as they are.

| Question | Answer |
| --- | --- |
| Does a run started at segment 4 cut the same segments as a run from 0? | Yes, once four things the ruling did not list are added (below). Segments 4 to 8 then have the same first pts and the same video packet count in both runs, on both clips, and from starts at 1, 3, 5 and 8 on the MP4. On remux their `mdat` is byte for byte the same; on transcode the counts and pts match and the bytes differ slightly, as an encoder's do. |
| Do the per-file splits make a valid fMP4 stream? | Yes. `tfdt` runs on across segments with gaps under a millisecond, the inits from every run's first file are byte-identical, and each segment's `mfhd` sequence numbers start again at 1. ffmpeg's own HLS reader decodes every variant without a warning. |
| Do AVPlayer and ExoPlayer play it? | Yes, both, remux (HEVC tagged `hvc1`, AAC copied) and transcode (H.264). Each loaded the 89.959-second duration, seeked from 4 seconds to 38 or 50.5 and played on to the end, across the join between a segment from the first run and one from the restarted run. AVPlayer reported no errors and no stalls; ExoPlayer decoded with `c2.goldfish.hevc.decoder` and `c2.goldfish.h264.decoder` with no errors. The restarting per-file `mfhd` numbers bothered neither. |
| Is the `-f hls` fallback needed? | No. Measured anyway, its cut rule is a catch-up grid anchored on the run's own start: segment `k` ends at the first keyframe at or after `start + 6(k + 1)`, so a short segment follows a long gap, and a restart numbers and cuts from the new start. It is not restart-invariant against a plan from the keyframes. |

What Ruling 10's command needed besides what it lists, each found by a run that went wrong without it:

- **`-segment_times` is relative to the run's first video packet,** not the file's clock: the segment muxer adds the reference stream's first pts to every entry, and indexes the list by files written in this run, not by `-segment_start_number`. Absolute times made a run from segment 4 write one file to the end.
- **`-copypriorss 0` after the input.** With B-frames, ffmpeg seeks 3/23 of a second before `-ss`, lands on the keyframe before, and a stream copy keeps that whole earlier GOP. `-copypriorss 0` drops what comes before `-ss`.
- **`frag_discont`, `use_editlist=0` and `avoid_negative_ts=disabled` in `-segment_format_options`.** Without them each file's `tfdt` starts again at zero; the outer `-avoid_negative_ts disabled` does not reach the inner MP4 muxer.
- **Keyframe times truncated, never rounded, and `-segment_time_delta 0.005`.** A keyframe at 79.996583 rounded to 79.997 made `-copypriorss 0` drop it and the run wrote no video at all; one at 30.488792 rounded up made the cut miss it by a segment. Truncated times sit at or just before the real keyframe, and the five-millisecond delta absorbs the sub-millisecond error left in the relative times, well under one frame at 120 fps.

The command the server runs, here for a remux from segment 4 of the HEVC clip (boundaries 41.458, 51.458, 59.542, 69.542, 80.042), as amended by the version check below:

```
ffmpeg -seek_timestamp 1 -ss 41.458 -copyts -i <input> -copypriorss 0 \
  -map 0:v:0 -map 0:a:<audio> -c:v copy -tag:v hvc1 <hlsAudioArgs> \
  -sn -dn -map_metadata -1 -map_chapters -1 \
  -output_ts_offset 1 -avoid_negative_ts disabled \
  -f segment -segment_format mp4 \
  -segment_format_options movflags=frag_keyframe+empty_moov+default_base_moof+frag_discont+delay_moov:use_editlist=0:avoid_negative_ts=disabled \
  -segment_times 10.000,18.084,28.084,38.584 -segment_time_delta 0.005 \
  -segment_start_number 4 -segment_list pipe:1 -segment_list_type flat <folder>/seg_%d.mp4
```

A transcode replaces `-c:v copy -tag:v hvc1` with the encoder's arguments, and its seek and cuts differ ("Transcode cuts" below). `-segment_list pipe:1` prints each file's name on stdout once the muxer has flushed and finished it, which is how the server knows a segment is whole.

**FFmpeg versions (2026-10-19, Task 13).** The spike ran 9.0.2 only. CI's checks install Ubuntu 24.04's ffmpeg, 6.1.1, and the server image is `node:24-slim`, Debian 12 (bookworm), whose ffmpeg is 5.1.9. The HLS tests ran on all three in Docker. Two differences changed the command:

- **`-segment_times` became relative in FFmpeg 6.0.** From 6.0 the segment muxer adds the run's first video pts to each entry (`reference_stream_first_pts` in `segment.c`). 5.1 compares each entry with the packets' output timestamps as they are, so there a relative list cut a restarted run's first segment at its next keyframe. The server reads the version once (`ffmpeg -version`). Before 6.0 it passes the same cuts as output timestamps: boundary plus `STREAM_TIME_SHIFT`.
- **The file's own clock, not `-start_at_zero`.** With `-start_at_zero` the output clock is the file's pts minus the file's start time, while the plan's boundaries are the file's pts as ffprobe lists them. A file whose start time is not zero then has its segments land off the plan. Ubuntu's 6.1 encoder gives the test clip an AAC start of -0.023 s, so its segments start 23 ms late, and a timestamp list on 5.1 could not be written without knowing the start. The run therefore keeps the file's clock: `-copyts` without `-start_at_zero`, and `-seek_timestamp 1`, so that `-ss` is read as a timestamp rather than as an offset from the file's start. On 5.1, 6.1 and 9.0 alike, a run's segment `k` now starts at boundary `k` plus `STREAM_TIME_SHIFT`, for MKV and MP4 clips and for one starting at 2.5 s, and a run from segment 4 or 5 cuts what a run from 0 does. Subtitles extracted with `-start_at_zero` sit on the older clock, so the HLS route (Task 14) has to shift their cues by the file's start time.

`-copypriorss 0`, the segment muxer's MP4 options, `-segment_time_delta` and `-segment_list pipe:1` behave the same on all three. Only the tests' pacing needed a change: `-readrate_initial_burst` is new in 6.1, so they pace with `-readrate` alone.

**`delay_moov` (Task 14).** The spike's clips carried AAC. An AC-3 or E-AC-3 track, copied or encoded from DTS, TrueHD or Opus, fails the run with "Cannot write moov atom before AC3 packets": the muxer reads the track's `dac3` box from its first packet. `delay_moov` in the movflags fixes it, and an AAC run's init and media bytes are the same with or without it.

**Transcode cuts (Task 14 fix round).** Three things the remux command gets right by cutting on real keyframes went wrong for a transcode, each measured on 9.0.2 and fixed and tested on 5.1, 6.1 and 9.0:

- **The seek.** With `-copyts` and no `-start_at_zero`, a decoder drops the frames before `-ss` plus the file's start time, whatever `-seek_timestamp` says; only the demuxer's seek reads `-ss` as a timestamp. A transcode of an MKV starting at 2.5 s from `-seek_timestamp 1 -ss 2.5` began at 5.0, and a TS starting near an hour would have written nothing. A transcode therefore seeks with no `-seek_timestamp` and `-ss` counted from the start: boundary minus half a frame minus `format.start_time`, left out when that is not positive. A copy keeps `-seek_timestamp 1`, where the trim does not apply.
- **The anchor.** On 6.0 and later the segment muxer counts `-segment_times` from the run's first video pts, so the plan must start on the video's first frame, the video stream's `start_time`, not on `format.start_time`, which is often the first audio packet. With video 0.08 s after audio, a run's cuts missed the forced keyframes by a frame and landed on the next natural one. `format.start_time` now only seeks and shifts subtitle cues.
- **The frame grid.** Six seconds is not a whole number of frames at 23.976, so a forced keyframe at `6k` falls between frames and lands on whichever one a run's own start rounds to; runs from 0 and from 3 or 5 parted at segment 7. The transcode plan puts each boundary on a frame of the video's `r_frame_rate` counted from its first frame, every keyframe time and `-ss` sits half a frame before its boundary, and `-segment_time_delta` is half a frame, so each lands on the boundary's frame and no other. `-fps_mode passthrough -enc_time_base demux` keeps every frame's own timestamp (`demux` arrived in 6.1, and 6.0 refuses it; 5.1 to 8.x take `-1`, which 9.0 refuses; the server names it by the version it already reads): by default the encoder moves frames onto a grid from 0 at `1/fps`, and a clip whose frames sit half a frame off that grid (video at 2.58 s, 25 fps) came out 20 ms off the plan.

Runs from 0, 3 and 7 of a 70-second 23.976 fps clip whose picture starts 0.125 s after its sound cut every segment at the same first pts with the same frame count on all three versions. A Matroska file's duration counts from 0 on its own clock, so its end is its duration; elsewhere the end is the start plus the duration.

- **MPEG-TS (Task 14 fix round 2).** A transport stream has no seek index, and ffmpeg indexes every one of its packets as a keyframe, so a seek lands mid-GOP and the decoder starts at the next real keyframe, which can be past the boundary. On 6.0 and later that late first frame also moves every later cut of the run, since `-segment_times` count from it: a restart at segment 2 of a TS with ten-second GOPs began 8 s late, cut segment 5 four frames long and never wrote segment 6. A transcode of a TS therefore reads the video from just before the keyframe at or before the boundary, from the keyframes the remux probe lists, and trims it exactly with `trim=start=<boundary - half a frame>` ahead of the scale and tone map filters; the audio comes from a second input of the same file that keeps the exact `-ss`, mapped `1:a:N`. Runs from 0 and from 2 then cut the same segments, first pts and frame count, on 5.1, 6.0, 6.1 and 9.0. The master playlist starts that probe in the background and never waits for it, since the run from 0 needs no keyframes; a restart before the probe has stored them falls back to the single input and the server says once that it may start late. Other containers keep the single input, which seeks to the keyframe before the boundary by their index. A remux is unaffected, since it seeks to keyframes.
- **One build of ffprobe and ffmpeg.** The transcode seek counts from `format.start_time` as ffprobe reads it, and builds disagree on it (5.1 and 6.1 put an AAC-primed file's at -0.023 s, 9.0 at 0), so the server warns at start when the two report different versions.

One seam remains at a restart: where a segment from one run meets one from the next, the audio of the two does not meet exactly. Within one run, segments meet exactly. Measured on 9.0.2 at a restart at 12 s of B-frame clips (Task 14 fix round 3):

- **Remux, audio copied or encoded.** The run before cuts its audio at the boundary keyframe's dts, as the segment muxer splits all streams there in decode order. The restart's audio begins at the boundary itself: copied, at the first whole packet at or after it (`-copypriorss 0` drops those before); encoded, at the first frame it encodes there. The two leave a gap about as long as the video's reorder delay: 0.06 to 0.09 s here, and 0.09 to 0.21 s in the spike.
- **Transcode, audio copied or encoded.** The run before carries its audio up to the boundary. The restart's audio begins within one audio frame of it: copied AAC up to 0.02 s before or just after, and encoded E-AC-3 0.03 s before, since the encoder starts on a frame boundary of its own. The two overlap by up to one audio frame.

The review of Task 14 also measured copied AAC in a restarted segment starting about 0.17 s early, an overlap. Both players played through a gap in the spike; an overlap is not verified on them.

Limits: the transcode plan assumes a constant frame rate. With a variable one, a restart on 6.0 and later can still miss a cut when its first frame sits more than half a frame from its boundary; snapping the boundaries to the probed frame pts is a follow-up.

Not verified: real devices, HDR and Dolby Vision, a real film's GOP, sources with edit lists, AC-3 and E-AC-3 in the fMP4 segments, `EXT-X-INDEPENDENT-SEGMENTS` with open-GOP remux segments (the spike's playlists left the tag out), subtitle renditions, and the on-demand server itself: the spike served pre-cut folders, and both players fetched every segment of a small file at once, which Ruling 13's run-ahead limit has to bear. The Android emulator decoded at about two thirds of real time, a limit of the headless emulator, not of the stream.

## Left to the builder

- The exact `canPlay` tables per platform. Start from Apple's documented formats and ExoPlayer's, narrow from what fails on the real devices.
- The segment length (six seconds is the author's starting point) and the keyframe-gap limit for remux.
- How the TV shelves page: all at once from `/api/home`, or by library as focus nears the end.
- The focus order and the back-button behaviour on each TV, within the platform's conventions.
- The look of the two layouts, from the Verdigris tokens and themes. The design page in the web app is the reference; nothing is re-themed.

## Risks

- **The fork lags.** `react-native-tvos` follows React Native a release or two behind, and Expo's TV support follows the fork. The app pins both and upgrades deliberately, like the desktop pins Electron.
- **`react-native-video` on tvOS.** Supported, but the tvOS path gets less use than iOS. The spike plays HLS there before anything else is built.
- **Dolby Vision profile 7.** MKV remuxes carrying it play as HDR10 on Apple TV through the remux route, not Dolby Vision. Profile 8 in MP4 is fine. Documented, not fixed.
- **Vhagar's CPU.** Transcodes on a Synology are the transcoding spec's problem, not this one's, but a TV asking for a 4K transcode will show it. The app's resolution cap exists for this.
- **Weekly reinstalls** on the free team are a chore on an Apple TV. This is the pressure that will decide the paid program.
- **Jest in the repo.** A second test runner enters the workspace for one project. Contained by the rule in the app's `CLAUDE.md`.
- **A prerelease fork.** Expo 58 wants React Native 0.88, and the fork only has 0.88 as a prerelease today. Either the app pins that prerelease until the fork's `0.88-stable` tag lands, or it starts on Expo 57 with the fork's stable 0.87. PR 4 decides from what the fork has published by then.
