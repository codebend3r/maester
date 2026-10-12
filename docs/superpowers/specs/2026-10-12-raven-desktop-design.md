# raven desktop: a standalone Electron app on a shared `@raven/ui` library, playing through embedded mpv

Status: proposed, not yet reviewed. Revised the same day for native playback; the server side of that work is `2026-10-12-raven-transcoding-design.md`.

## Context

The goal is a desktop raven that runs on its own: install it, point it at local folders, and it scans, matches and plays with no NAS and no Docker. It can also connect to an existing raven server such as Vhagar's. Nothing may be written twice:

- the business logic stays in `@raven/core` and `@raven/server`;
- the React UI moves into a new library, `@raven/ui`, that both `@raven/web` and `@raven/desktop` render.

### The playback goal

The desktop app has to be as fast and smooth as the hardware allows, on the newest desktop technology. Concretely:

- **Every widely supported codec plays directly in 4K**: H.264, HEVC (8, 10 and 12-bit), AV1, VP9, VC-1, MPEG-2 and MPEG-4, decoded on the GPU wherever the GPU can.
- **HDR is shown as HDR** on an HDR output (a Mac's EDR display, an HDR TV over HDMI), and tone mapped well on an SDR one. HDR10, HDR10+, HLG and Dolby Vision profiles 5, 7 and 8 all play with correct colour.
- **Audio is never needlessly converted.** TrueHD Atmos and DTS-HD MA bitstream to an AV receiver where the OS allows it; otherwise they decode to multichannel PCM. Stereo and headphones get a proper downmix.
- **Every subtitle format shows**, including PGS, VobSub, DVB and styled ASS.
- **Transcoding is the exception**, used only when a remote link is too slow for the original. The server side makes that transcode fast and HDR aware.

The web player cannot meet this goal: Chromium's `<video>` re-encodes TrueHD, DTS and AC3 to stereo AAC, cannot show picture subtitles, has no Dolby Vision, and needs a transcode for anything outside its short codec list. So the desktop app plays video through **embedded libmpv**, drawn natively under raven's own React controls, and keeps the web player as its fallback.

### Decisions

| Question | Answer |
| --- | --- |
| Video engine | libmpv (`vo=gpu-next`, libplacebo), embedded under the React controls; the web player is the fallback |
| Platforms | macOS (arm64 and x64), Windows x64, Linux x64 |
| Where libmpv runs | Electron's main process, behind a small N-API addon, `@raven/mpv` |
| macOS surface | One window: an NSView with a `CAMetalLayer` under the page, through libmpv's moltenvk context patch |
| Windows surface | One window with mpv's child window under Chromium's (W1), or an overlay controls window (W3) if the spike rules W1 out |
| Linux surface | W3 under X11 (`--ozone-platform=x11`) |
| Where libmpv comes from | Windows: shinchiro's builds. macOS: our own CI build with the moltenvk patch. Linux: the system's libmpv 0.40 or newer |
| Where ffmpeg comes from | jellyfin-ffmpeg portable builds, for the embedded server |

### What exploration found

- **`@raven/core` was built for a second client.** `createApiClient({ baseUrl, fetch })` takes an injected fetch and origin (`libs/raven/core/src/apiClient.ts:140`). The direct-play check takes a pluggable `CanPlay` (`playback.ts`). It uses no DOM or Node APIs.
- **The server is already embeddable.** `createApp({ config })` in `apps/raven/server/src/app.ts` returns an app that is not listening yet, and `main.ts` is three lines. `readListenConfig` accepts `PORT=0` and any `HOST`, `DATA_DIR` and `WEB_DIR` (`libs/shared/server/src/env.ts`).
- **The server serves the web build on its own origin** (`serveWebApp`). That is why `/api`, the PIN cookie (`SameSite=Strict; Path=/api`), SSE and MSE streaming need no CORS today.
- **`@raven/web` is almost all reusable UI.** About 50 component folders, 17 pages, the Player hooks, and the TanStack Query layer (`lib/queries.ts`, `queryClient.ts`, `invalidate.ts`). It also has 4 zustand stores, the MSE engine (`lib/streamSource.ts`) and the styles. Only `main.tsx` (fonts, `QueryClientProvider`, `BrowserRouter`) and `index.html` are specific to the web app.
- **The one seam is the API client.** `lib/api.ts` builds a same-origin `api` singleton, and 55 files import it.
- **The player's state is already engine-agnostic.** `videoReducer` in `components/Player/useVideoState.ts` folds a `VideoEvent` union (`moved`, `sought`, `buffered`, `duration`, `played`, `paused`, `waiting`, `flowing`, `rate`) into the `VideoState` the controls draw. Only `useVideoEvents` ties it to a `<video>` element.
- **The player is its own full-page route,** `watch/:id`, outside `AppShell` (`AppRoutes.tsx:41`), so a native video surface can fill the window while it shows.
- **Nothing depends on rookery**, so a standalone build loses nothing by leaving it out.
- **There is no desktop work yet.** No Electron or Tauri, nothing on the roadmap, and no CI job that publishes binaries.

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

## 1. `libs/raven/ui` (`@raven/ui`)

### What moves

Use `git mv` from `apps/raven/web/src` so history follows the files: `components/`, `pages/`, `stores/`, `styles/`, `lib/`, `AppRoutes.tsx`, `managed-media-source.d.ts` and `test/`. Make the move its own PR with no behavior change.

### The platform seam

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

export type NativePlayer = {
  send: (command: PlayerCommand) => Promise<void>
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
}
```

`PlayerCommand`, `PlayerEvent` and `OutputSettings` live in `@raven/core` (section 6), because the desktop's main process checks them too and core is the one place both can import.

- Add `RavenProvider({ platform, children })`. It creates the query client (`createQueryClient`, which moves in from web) and puts `{ platform, queries }` in context.
- Add `useRaven()`, which returns that context.
- `player` is `null` when libmpv failed to load or its surface could not be made; the player then uses the web engine, so playback never breaks.
- Desktop-only affordances read `platform.kind === 'desktop'` and use `&&` in JSX. Two of them ship in v1:
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

### The player engine

The Player splits into the chrome and an engine.

- **The chrome** is `Controls`, `Scrubber`, `SettingsMenu`, `ShortcutsDialog`, `Bezel`, the shortcuts and `useWatchProgress`. It reads `VideoState` through the existing `videoReducer` and calls `EngineActions` (`play`, `pause`, `seek`, `setVolume`, `setRate`, `setAudio`, `setSubtitle`, `setSubtitleScale`). `useWatchProgress` reads the state instead of the element.
- **An engine** produces `VideoEvent`s and implements `EngineActions`:

  ```ts
  type Engine = { kind: 'html' } | { kind: 'native'; player: NativePlayer }
  ```

  - **html** is today's code: `<video>`, `useVideoEvents`, `useMediaSource` and `streamSource.ts`, behind the same ladder.
  - **native** sends `PlayerCommand`s and maps `PlayerEvent`s onto the same `VideoEvent`s: mpv's `time-pos` is `moved`, `pause` is `played` or `paused`, `paused-for-cache` and `seeking` are `waiting` and `flowing`, `demuxer-cache-state` is `buffered`, `speed` is `rate`, `duration` is `duration`.
- `Stage` picks the engine from `useRaven()`: native when the platform has a player, html otherwise. Under the native engine:
  - there is no `<video>`; `Stage` renders the chrome over a transparent page, and `--color-stage` in `Player.module.scss`, `html` and `body` turn transparent on the watch route;
  - audio and subtitle switches happen in place, through mpv's `aid` and `sid`, with no remux and no restart;
  - mpv draws the subtitles, so `SubtitleOverlay` and `useSubtitleCues` are not used, and the caption size maps to `sub-scale`;
  - `planPlayback` gets `canPlay: () => true`, so the ladder is direct play, then the remote transcode (section 5) if direct play fails at runtime.

Make the split its own PR with only the html engine, so the web app shows no change before any native code exists.

### Exports and build

- **Exports:**
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
- **Tests move with their files.** They keep running with `bun test` and happy-dom, using the SCSS loader in `tooling/web`. The `test/` render helper wraps in `RavenProvider` with a fake browser platform; the native engine's tests use a fake `NativePlayer`.
- **Tokens:** `globals.scss`, `elements.scss` and `designTokens.ts` move to `libs/raven/ui/src/styles/`. The `/design` page moves with them.

## 2. `@raven/web` becomes a thin shell

What stays in `apps/raven/web`: `index.html`, `vite.config.ts` (with the `/api` proxy) and `src/main.tsx`. `main.tsx` does the following:

- imports the fonts and `@raven/ui/styles.css`;
- builds `createApiClient({ fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === 'PUT' }) })`, the logic moved from today's `lib/api.ts`;
- renders `<RavenProvider platform={{ kind: 'browser', api }}>` around `createBrowserRouter(ravenRoutes)`.

The Docker image keeps building `@raven/web`, and Nx's `^build` builds `@raven/ui` first. Add `libs/raven/ui` to the allowlist in `apps/raven/Dockerfile.dockerignore`. The GHCR publish check reads the same allowlist, so library changes republish the image.

## 3. `@raven/server`: one embeddable entry

- Add `src/startServer.ts`, which exports `startServer({ env }): Promise<{ url: string; close: () => Promise<void> }>`. It runs `sizeThreadpool`, `readServerConfig(env)`, `createApp`, then `listen`.
- Reduce `main.ts` to `await startServer({ env: process.env })`.
- In `apps/raven/server/package.json`, add `"exports": { "./start": { "types": "./dist/startServer.d.ts", "default": "./dist/startServer.js" } }`.
- Docker's `node dist/main.js` is unchanged. No module moves, and Nest stays, because Electron runs Node.

## 4. `apps/raven/desktop` (`@raven/desktop`)

### Why Electron over Tauri

- **Node is built in.** The server is Node: NestJS, better-sqlite3, and child processes for ffmpeg. Electron runs it in a `utilityProcess`. Tauri has no Node and would need a Node sidecar binary.
- **The UI renders in one engine everywhere.** Electron is Chromium on every OS, the engine the web app is already built and tested against. Tauri means WKWebView on macOS and WebKitGTK on Linux.
- **Video does not depend on either.** libmpv draws it natively (section 5), so Chromium's codec list no longer limits the desktop. Chromium's `<video>` and MSE remain only as the fallback engine, where `checkDirectPlay` and `planPlayback` still pick direct, remux or transcode on their own.
- **Config stays TypeScript.** Electron Forge reads `forge.config.ts`, so the TypeScript-only rule holds.

### Layout

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

### How the renderer reaches a server

The renderer always loads from `http://127.0.0.1:<port>` with `baseUrl: ''`. Cookies, SSE and the API then stay same-origin, exactly as in the browser.

- **Local mode:** the host process runs the real raven server with this environment:
  - `HOST=127.0.0.1` and `PORT=0`
  - `DATA_DIR=<userData>/data` and `BROWSE_ROOT=<home>`
  - `WEB_DIR=<resources>/renderer`, so the server hands out the desktop renderer rather than the web build
  - `FFMPEG_PATH` and `FFPROBE_PATH` pointing at the bundled binaries
  - the TMDB and OMDb keys from the desktop config
- **Remote mode:** the host process runs a small Fastify server, about 40 lines. It serves the same renderer and proxies `/api/*` to the remote with `@fastify/http-proxy`, streaming request and response bodies so SSE and byte ranges pass through. The remote's `raven_unlock` cookie has no `Domain` and `Path=/api`, so it lands on the local origin unchanged.
- Each host posts `{ url }` to the main process over `process.parentPort`, and the main process loads that URL.
- Video bytes do not go through the renderer at all; section 5 says where mpv reads them from.

### Security, bundling and scripts

- **Window security:** `contextIsolation`, `sandbox` and no `nodeIntegration`. Navigation is limited to the host origin, and external links open in the system browser.
- **Bundling the hosts:** `bun build --target node` turns each host into one file, with `better-sqlite3` and Nest's optional lazy packages left external. Two facts make this simple:
  - The server injects every dependency with an explicit `@Inject(Token)`, so it needs no `emitDecoratorMetadata`.
  - better-sqlite3 13 is N-API with prebuilt binaries (its `binding.gyp` sets `NAPI_VERSION=10`), so it should load in Electron's Node without electron-rebuild.
  This avoids packaging Bun's symlinked workspace `node_modules`. Each host calls `module.enableCompileCache()` first, so later launches skip recompiling the bundle.
- **ffmpeg:** a `fetch:ffmpeg` script downloads a pinned jellyfin-ffmpeg portable build per platform (macOS arm64 and x64, Windows x64, Linux x64). It has zimg, the SIMD tone mapper `tonemapx` and the hardware filters the transcoding spec uses. It is GPL, which matters only if the app is distributed publicly.
- **libmpv:** a `fetch:libmpv` script, in `@raven/mpv`, places the pinned libmpv for the platform beside the addon (section 5).
- **Scripts** (one command each, chained with `bun run --sequential`, all in `nx.includedScripts`):
  - `build`: `build:clean`, `build:renderer` (vite), `build:main` (tsc then tsc-alias), `build:hosts` (bun build)
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
- **Hardened by default:** `load-scripts=no`, `ytdl=no`, `osc=no`, `input-default-bindings=no`, `input-vo-keyboard=no`. Keys and mouse belong to the page.

### Surfaces

Each surface puts mpv's video under the page, so raven's React controls draw over it. The spike (step 2 of the order of work) settles each one.

- **macOS: one window.**
  - Upstream mpv dropped embedding into an NSView in 0.37, and its Vulkan context always opens its own window. The "moltenvk context" patch, carried by MPVKit and by Plex's fork, takes a `CAMetalLayer*` as `wid`. We build libmpv with it.
  - The addon creates a layer-backed NSView with a `CAMetalLayer`, inserts it at the bottom of the BrowserWindow's content view, beneath the WebContentsView, and passes the layer as `wid`. Electron puts its vibrancy view in the same place, so the layering is proven; the addon re-asserts the order after layout changes.
  - The WebContentsView's background is `#00000000` on the watch route. The window itself does not need `transparent`.
  - The patched context reports no display refresh rate, so the player service sets `display-fps-override` from `screen.getDisplayMatching`.
- **Windows: W1 if the spike passes it, W3 otherwise.**
  - **W1, one window.** Chromium draws web content into a child window of its own. The addon creates another child window at the bottom of the z-order and passes it as `wid`, so mpv sits under Chromium's content; stremio-shell-ng does the same with WebView2. The window is created transparent and frameless (Electron sets `transparent` only at creation) and uses `titleBarOverlay` for the window buttons.
  - **W3, an overlay window.** The opaque, framed main window hosts mpv's child window. A transparent, frameless window owned by it (Electron's `parent`) shows only the player controls, and only on the watch route; the main process keeps it on the main window's content bounds. The library UI keeps its native frame, at the cost of a second renderer during playback.
- **Linux: W3 under X11.** Electron 38 and newer default to Wayland, which cannot embed another client's surface, so the app starts with `--ozone-platform=x11`. There is no HDR on Linux in v1; Wayland and its HDR wait for libmpv's gpu-next render API.
- **Fallback everywhere:** if libmpv is missing, its version is too old, or the surface cannot be made, the platform's `player` is `null` and the web engine plays instead.

### The mpv profile

- **Video:**
  - `vo=gpu-next`: libplacebo, mpv's newest renderer.
  - `hwdec=auto`: VideoToolbox on macOS; D3D11VA, NVDEC or Vulkan video on Windows; VAAPI, NVDEC or Vulkan on Linux. Codecs the GPU cannot decode fall back to the CPU (dav1d for AV1).
  - `video-sync=display-resample`, so 23.976 fps video paces evenly on a 60 or 120 Hz display.
- **HDR:**
  - On an HDR output, `target-colorspace-hint` passes HDR through: EDR on macOS, the HDR swap chain on Windows when Windows HDR is on.
  - On an SDR output, libplacebo tone maps with peak detection (`hdr-compute-peak`).
  - Dolby Vision profiles 5 and 8 are reshaped from their RPU, so profile 5 has correct colours. Profile 7 plays its base layer.
- **Cache:** forced on (`cache=yes`) for remote URLs and for local libraries on network volumes, where mpv's `cache=auto` would see a plain file. It is sized for 4K remuxes at 100 Mb/s: `demuxer-max-bytes` about 1 GiB ahead, `demuxer-max-back-bytes` about 256 MiB behind, so short seeks back stay instant.
- **Subtitles:** mpv draws every format: ASS with its attached fonts through libass, PGS, VobSub, DVB, SRT and WebVTT. Sidecar files are added with `sub-add`.
- **Audio:** three output profiles in "This computer", plus the device from `audio-device-list`:
  - **PCM:** multichannel up to 7.1 (`audio-channels=auto-safe`). LPCM over HDMI keeps lossless audio, though Atmos objects are lost.
  - **Receiver passthrough:** `audio-spdif` with the chosen formats. Windows (WASAPI exclusive) and Linux (PipeWire) carry every format, including TrueHD and DTS-HD MA. macOS (CoreAudio exclusive) carries AC3 and DTS core; anything else decodes to PCM. The volume control is disabled while passthrough is on.
  - **Headphones:** a normalized stereo downmix, or `ao=avfoundation` on macOS for spatial audio on AirPods.
- **Diagnostics:** a shortcut toggles mpv's built-in stats overlay (`script-binding stats/display-stats-toggle`), which shows the decoder, `hwdec-current`, dropped frames and the cache.

### Sources

The renderer only ever names a `mediaId`. The player service in the main process turns it into something mpv opens, so the renderer can never point mpv at a path or URL of its choosing.

- **Local mode:** the file's path from `getMediaLocation` (`libs/raven/core/src/apiClient.ts:308`). mpv reads the disk directly; no bytes pass through the server.
- **Remote mode, direct:** the remote server's own `/api/media/:id/file`, not the local proxy, so there is one hop. The cookie is HttpOnly, so the renderer cannot read it; the player service reads `raven_unlock` from Electron's session cookie store and passes it to mpv as a `Cookie` header (`http-header-fields`).
- **Remote mode, transcode:** for a link too slow for the original, mpv plays the `container=mkv` stream from the transcoding spec, which copies TrueHD, DTS-HD and picture subtitles instead of converting them.
  - mpv runs with `rebase-start-time=no`, the engine subtracts `STREAM_TIME_SHIFT` as the web engine does, and the duration comes from the probe.
  - A seek outside the cache reloads the stream with a new `start`.
  - When `paused-for-cache` keeps recurring while `cache-speed` stays below the file's bitrate, the player offers a transcode at a bitrate under the measured speed. It waits for several stalls before offering, so one hiccup does not trigger it.

### The bridge

- **One MessagePort per window,** created by the main process and handed to the renderer through the preload. Commands carry a request id and get a reply; events flow the other way.
- **Commands are an allowlist,** each a `PlayerCommand` variant: `load` (a `mediaId`, a start time, an audio index, a subtitle id), `play`, `pause`, `seek`, `audio`, `subtitle`, `volume`, `speed`, `subtitleScale`, `stop`. The main process checks each with `isPlayerCommand` and never forwards raw mpv commands; `run`, `load-script` and an arbitrary `loadfile` stay unreachable.
- **Events are `PlayerEvent` variants:** time, buffered ranges, paused, waiting, duration, rate, tracks, ended, error, and the video's live parameters for the diagnostics. `time-pos` is throttled to about 10 updates a second.
- **Main process extras:**
  - `powerSaveBlocker.start('prevent-display-sleep')` while a video plays;
  - fullscreen: the HTML fullscreen request becomes the window's, and the surface follows the window's bounds;
  - quitting stops mpv before the host.

### Bundling libmpv

- **Windows:** shinchiro's `mpv-dev` builds of mpv-winbuild-cmake, a self-contained `libmpv-2.dll`. Releases roll daily, so `fetch:libmpv` pins one and checks its checksum against a mirrored copy.
- **macOS:** MPVKit's GPL build, which already carries the moltenvk patch, for the spike. Then our own pinned CI build (mpv, FFmpeg, libplacebo, MoltenVK, dav1d, libass, with the patch) for arm64 and x64.
- **Linux:** the system's libmpv, 0.40 or newer (Debian trixie, Ubuntu 26.04). An older one falls back to the web engine.
- **Licensing and signing:**
  - GPL libmpv and GPL jellyfin-ffmpeg make a distributed app GPL in effect. That matters only if the app is shared publicly.
  - On Apple Silicon every Mach-O must be signed, so the release signs libmpv and the addon ad hoc. Real signing later needs either every dylib signed or `com.apple.security.cs.disable-library-validation`.

## 6. Logic still worth moving to `@raven/core`

These are pure helpers that are duplicated today or sit away from their siblings. They move during the `@raven/ui` extraction:

- `score()` and the sortable `COLUMNS` are written twice, in `components/MediaList/MediaList.tsx` and `components/ShowCard/ShowViews.tsx`. Keep one copy in core.
- `languageName` is written twice, in `lib/trackLabels.ts` and `components/ImageEditor/ImageEditor.tsx`. Keep one copy in core.
- `pages/LibraryPage/librarySections.ts` (`SECTIONS`, `sectionsFor`) holds the tab rules for each library kind. Move it to `libs/raven/core/src/libraryKinds.ts`, next to `KIND_RULES`.

New in core: `src/player.ts`, the player protocol. `PlayerCommand` and `PlayerEvent` are discriminated unions on `type`, `OutputSettings` is the "This computer" shape, and `isPlayerCommand`, `isPlayerEvent` and `isOutputSettings` are their guards. The renderer, the preload and the main process all import them, so the bridge has one contract.

The other pure UI helpers stay in `@raven/ui`, now that both apps share it. They are `jumpScale`, `letters`, `itemFacts`, `shortcuts`, `selection`, `playQueue` and `history`. They move to core only if a non-React client appears.

## 7. Docs and CI

- **Root `CLAUDE.md`:** add `@raven/ui`, `@raven/mpv` and `@raven/desktop` to the project table. In the CSS section, point raven's `globals.scss` and `elements.scss` at `libs/raven/ui/src/styles/`, and name `@raven/ui` as a styled project.
- **`apps/raven/CLAUDE.md`:** note the UI lives in `@raven/ui`, the `Platform` seam, the two player engines, the desktop hosts and the player bridge.
- **`.github/workflows/desktop-release.yml`:** runs on `v*` tags. A matrix of macOS arm64, macOS x64, Windows x64 and Linux x64 fetches libmpv and ffmpeg, builds the addon, runs `bunx nx run @raven/desktop:make` and attaches the dmg, zip, installer and Linux packages to the GitHub release. Builds are unsigned for now (ad hoc on macOS).
- **`@raven/mpv` tests run headless in CI on all three OSes:** `vo=null` and `ao=null` against a clip that `lavfi` generates, so no media file is checked in. They load, seek, switch tracks, stop, and destroy a hundred times without a hang.
- PR checks pick up the new projects through `run-many` with no changes.

## Order of work (one PR each)

1. **Server spike, to be thrown away:** run `startServer` from a bun-bundled file in an Electron `utilityProcess`. Confirm better-sqlite3 loads and the web engine plays a direct, a remux and a transcode stream, locally and through the remote proxy.
2. **Native video spike, to be thrown away, about a week.** It must pass these before step 6 starts:
   - **macOS arm64:**
     - the patched libmpv loads in Electron's main process;
     - test file M2 (below) plays with `hwdec-current=videotoolbox` and drops no frames in 10 minutes, at 60 and at 120 Hz;
     - the video stays under the page through navigation, resizing, fullscreen and DevTools;
     - on an XDR display, EDR highlights are brighter than the UI's white, and M4 has correct colours;
     - 100 load and stop cycles, then quitting, end with no deadlock.
   - **Windows x64:** W1 or W3 draws the controls over the video, with resizing, snapping, maximizing and fullscreen working; HDR10 passes through with Windows HDR on; TrueHD Atmos reaches a receiver.
   - **Linux x64, X11 on GNOME and KDE:** W3 works, with VAAPI decoding on Intel.
   - **All three:** without libmpv, the app plays through the web engine.
   - The per-OS outcome is written back into this spec.
3. Extract `@raven/ui` with the `Platform` seam, plus the core dedup; web becomes the thin shell. No visible change.
4. Split the Player into chrome and engine, with only the html engine. No visible change.
5. Add `startServer` and the `./start` export to the server.
6. Scaffold `@raven/desktop` with local mode on the web engine, the chooser, and the tooling presets.
7. Add `@raven/mpv`: the addon, the wrapper, `fetch:libmpv`, CI builds and the headless tests.
8. Add the native engine, the surfaces, the bridge and "This computer".
9. Add remote mode with direct URLs and the mkv transcode, Connection lost and Switch server.
10. Bundle ffmpeg and libmpv, add the release workflow, update the docs.
11. **Follow-ups:** match the display's refresh rate to the video; switch Windows into HDR for an HDR title; Now Playing and media keys (MPNowPlayingInfoCenter, SMTC, MPRIS); Wayland with HDR on Linux.

The server work in `2026-10-12-raven-transcoding-design.md` runs alongside; step 9 needs its mkv container.

## Verification

- **Checks:** `bun run verify` passes for every project, including `typescript-only` and `one-command-per-script`.
- **After steps 3 and 4:**
  - `bunx nx run @raven/ui:test` and `bunx nx run @raven/web:test` pass.
  - `bun run dev:raven` behaves exactly as before.
  - The Docker smoke test returns a healthy `/api/health` and serves `/`.
- **Test media.** One file per row, kept outside the repo:

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

- **Pass criteria,** on each OS and output (Mac XDR, Mac SDR, an HDR TV on Windows, a receiver, headphones):
  - `hwdec-current` is not `no` wherever the GPU decodes the codec;
  - `frame-drop-count` plus `decoder-frame-drop-count` is 0 over 10 minutes;
  - the first frame shows within 1 s locally, 2 s from SMB or a remote server, and 3 s through a transcode;
  - a seek inside the cache takes at most 0.2 s; outside it, 0.5 s locally and 1.5 s remotely;
  - A/V sync stays within 20 ms, and an audio or subtitle switch takes at most 0.3 s with no reload;
  - the main process's event-loop lag stays under 20 ms at p99 while playing;
  - on an HDR output `video-target-params/gamma` is `pq`; with passthrough, `audio-out-params/format` starts with `spdif-` and the receiver names the format.
- **Desktop, local mode:** `bunx nx run @raven/desktop:make` builds an app. Choose "Run on this computer", add a local folder, and let the scan and TMDB matching finish. Then:
  - Play M1 to M15.
  - Lock a library, restart, and use the PIN dialog.
  - Quit, and check that no `node` or `ffmpeg` processes remain.
- **Desktop, remote mode:** connect to Vhagar's URL, then browse, play M2 directly, seek outside the cache, switch audio and subtitles, and unlock a locked library. Throttle the link below M2's bitrate and check that the transcode is offered and plays. Stop the remote and check that Connection lost appears.
- **Fallback:** remove libmpv from a build and check that M1 plays through the web engine.

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
