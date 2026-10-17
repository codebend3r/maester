# raven desktop native playback (P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship step P5 of the desktop spec: local files play through embedded libmpv under raven's own React controls (the native engine `useNativeEngine` and `NativeStage` in `@raven/ui`, the main-process player service in `src/main/player/`, the MessagePort bridge, `tracksFromMpv`, the macOS surface with a transparent watch route, the title bar behaviour, next in folder on the native path, "This computer" output settings and the stats overlay), with the html engine as the fallback when libmpv, the addon or the surface fails. M1 to M15 play from local disk.

**Architecture:** The renderer still holds only opaque ids. It names a `PlayerSource` (a granted `fileId`) and sends `PlayerCommand`s over one MessagePort per page load that main creates on the page's `ready` and the preload forwards with `window.postMessage`; main narrows every message with `isPlayerRequest`, resolves the source to a path through the grants, picks known fields, clamps numbers and drives `@raven/mpv` with async calls only. mpv's observed properties come back as `PlayerEvent`s, which `fromPlayerEvent` in `@raven/ui` folds into the same `videoReducer` the html engine uses, so `PlayerChrome` is unchanged in shape. Main-process modules stay pure or take their Electron and mpv pieces as arguments, so `bun test` covers them; a Node `test:native` target runs the real player service against headless libmpv (`vo=null`, `ao=null`); `src/main/main.ts` alone wires Electron, and e2e drives the built app with headless mpv.

**Tech Stack:** Electron 44.7.0, `@raven/mpv` (N-API addon over libmpv 0.41 with the moltenvk context and our resize patch, client API 131077), React 19.3 + React Router 7 + TanStack Query 5, `@raven/ui` (Vite library), `bun test` + happy-dom, Node 24 `node:test` via tsx 4.23.15 for real libmpv, `@playwright/test` 1.64.1 `_electron`, Nx 23 over Bun 1.4.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (P5 under "Order of work > Phase 1"; sections 1 "Player engines and chrome", 4 "Window", "Menus", "State that persists", "Security", "Keyboard and accessibility", 5 in full, 6 "Player protocol" and "From mpv to the reducer", 8, 9, "Verification", "Spike outcomes"). Builds on `docs/superpowers/plans/2026-10-16-raven-desktop-shell.md` (P4), whose Rulings still hold.

## Rulings (where the spec, the brief and the repo disagree or the spec is silent)

1. **The engine switch lives in `Player`, not `Stage`.** Spec section 1 says `Stage` switches on `engine.kind`. Today `Player` already branches before `Stage` (the html ladder, Unplayable), and the native path has no ladder or server tracks. So `Player` switches on `engine.kind` with the `never` check, `html` renders today's code (its `Stage` takes only the html variant), `native` renders `NativeView` with `NativeStage`. Different component types at that position remount, which is what the spec's keying is for.
2. **`@raven/mpv`'s JavaScript is bundled into `dist/main/main.js`; the addon and libmpv never are.** Verified: `bun build` keeps `createRequire(import.meta.url)` and the `loadAddon(addonPath)` call as runtime code, but `openMpv`'s default `addonPath` (`new URL('../resources/...', import.meta.url)`) then points at `dist/resources`, which does not exist. So main always passes `addonPath` from `addonPathFor` (Task 5): unpackaged, `<appPath>/../../../libs/raven/mpv/resources/darwin-arm64/raven_mpv.node` (the workspace's downloaded or CI-built resources); packaged, `<resourcesPath>/mpv/darwin-arm64/raven_mpv.node`, which P7 fills. Until P7, a packaged build (the CI `make` artifact) has no addon and plays through the html fallback; that is the spec's "with libmpv removed" check, not a bug.
3. **Track picks reach the renderer through `describeFile`.** `LocalFile` gains `tracks: { audio, subtitle } | null` (the stored pick), the shared player receives it as an optional `PlayerServices.trackPicks.start`, and only picks by hand are written back (`saveTracks`). Automatic choices from the language preferences are not stored, so a pick means a person chose it (spec "Track picks ... on pick").
4. **Stale events are dropped on both sides.** The spec is silent on rapid load, stop and load. Main keeps a phase (`idle`, `loading`, `loaded`): property events are forwarded only while `loaded`, an `eof` end-file while `loading` belongs to the file being replaced and is ignored, and at `file-loaded` main reads and emits a snapshot (`paused`, `duration`, `rate`, `waiting: false`, `tracks`), because an unchanged `pause` raises no change event. The renderer ignores events until its `load` command is answered; the port is ordered, so events after the reply belong to that load.
5. **An `eof` well short of the end is an error.** A read failure on a network volume ends some files with `eof`. When the last `time-pos` is more than `EOF_SHORT_S = 5` seconds before a known duration, main reports `{ type: 'error', reason: 'decode' }` instead of `ended`, so the resume point survives and next in folder does not fire.
6. **`buffered` is throttled too.** The spec throttles `time` (the wrapper already limits `time-pos` to four a second). `demuxer-cache-state` changes as often, so main emits `buffered` at most once per `BUFFERED_MS = 1000` and only when a range moved by 0.5 s or more.
7. **The quiet page holds values rather than unmounting.** "Renders the scrubber and time label only while it is shown" is met by holding the scrubber's and clock's `time` and `buffered` at the values they had when the controls hid, so nothing in the DOM changes while hidden and a focused scrubber keeps focus. This applies to both engines (no visible change on the web: the controls are invisible while held).
8. **Stats is `i`, offered only by an engine that has it.** `PlayerAction` gains `toggleStats` on `i` (mpv's own key) and `EngineActions` gains an optional `toggleStats`; the html engine has none, so on the web `i` does nothing and the shortcuts dialog does not list it. Playback menu "Video Info" sends the menu action `stats`, mapped to the same `PlayerAction`.
9. **`OutputSettings` shape.** Spec names a profile, a device and passthrough formats. Core gets `{ profile: 'pcm' | 'passthrough' | 'headphones', device: string, passthrough: ('ac3' | 'eac3' | 'dts' | 'dts-hd' | 'truehd')[], spatial: boolean }`; `spatial` is the headphones choice of `ao=avfoundation` (spec "Headphones"). The formats list is mpv's `audio-spdif` vocabulary, so Windows and Linux reuse it later; the macOS Settings screen offers only AC3 and DTS, which is what CoreAudio carries (spec "Receiver passthrough").
10. **`desktop-config.json` is version 1 with `output` only.** Spec puts servers there too; they are P6, which bumps the version with a reader for version 1.
11. **The title bar is a desktop request, not a player command.** `PlayerCommand` is the player's allowlist and stays as the spec writes it. Window buttons show and hide through a new `windowButtons` request on the existing request channel, sent from an optional `PlayerServices.chrome.shown` callback.
12. **Port hand-over.** On each `ready`, main posts on IPC channel `raven:player` either `{ status: 'native' }` with one `MessagePortMain`, or `{ status: 'unavailable', message }` with none; the preload forwards it to the page with `window.postMessage({ type: 'raven:player-port', connection }, 'app://raven', ports)` (P0 proved the transfer). A second `ready` (a reload) closes the old port and stops playback first.
13. **DevTools.** The packaged app has no DevTools entry. Unpackaged, View gains "Toggle Developer Tools" (`Alt+CommandOrControl+I`), which always opens them detached (spec "DevTools open detached on the watch route": detached everywhere is the simple form of that).
14. **Budget marks stay on stdout, unpackaged only** (P4 Ruling: the log is P7): `raven-first-frame-ms <n>` from the `load` command to mpv's next `playback-restart`, and `raven-loop-lag-p99-ms <n>` every 5 s while a video plays (`monitorEventLoopDelay`, resolution 10 ms). e2e asserts the lag under twice the 20 ms budget, as P4 does for launch.
15. **Test hook `RAVEN_DESKTOP_MPV`** (`headless` or `off`), read only when `app.isPackaged` is false (spec section 4 "Test hooks"). e2e runs `headless` by default; the html suite runs `off`, which is the fallback check. The window surface is never driven by CI.
16. **Server sources are refused in P5.** A `load` naming `{ kind: 'server' }` is answered `ok: false` ("raven player cannot play server titles yet."); P6 resolves them.
17. **Volume under passthrough** is fixed twice: the shared player disables its volume controls through an optional `PlayerServices.isVolumeFixed`, and main ignores `volume` commands while the profile is `passthrough`.

## Spikes (proved inside the tasks named, not as throwaway tasks)

- **A transparent page over the video.** `BrowserWindow.setBackgroundColor('#00000000')` should also clear the web contents' base background (Electron's hex alpha is `#AARRGGBB`, so this value is the same either way). Task 9 proves it by hand (M1's picture under the controls). Fallback: call `setBackgroundColor('#00000000')` on the `WebContentsView` among `window.contentView.children`; if neither shows the video, stop and report, since the next step is rebuilding the window as `BaseWindow` plus `WebContentsView`.
- **`loadfile <path> replace -1 start=<s>` on mpv 0.41** (the `index` argument arrived in 0.38). Task 8 proves it against real libmpv. Fallback: `set start` then `loadfile <path> replace`.
- **`script-binding stats/display-stats-toggle` and `audio-device-list` with `vo=null`, `ao=null`.** Task 8 proves both resolve. Fallback: a failing `stats` is answered `ok: false` and logged; an unreadable device list is `[]`.
- **The window handle.** Not a spike: `getNativeWindowHandle()` returns the `NSView*` the addon expects (`native/surface.h`), and Electron's main process JavaScript runs on the macOS main thread the addon requires. A surface that attaches but draws nothing would not be caught automatically; Task 9's manual smoke is the check.

## Deferred, so nothing is lost

| Spec item | Lands in |
| --- | --- |
| Server sources for `load` (`http-header-fields` with `raven_unlock` and `raven_admin`, `sub-add` for server sidecars), `servers` in `desktop-config.json` (version 2), the browser fallback for server titles, `readPlayLink`, trust prompt, `UnlockDialog`, "Open in raven player" | P6 |
| The addon and libmpv inside the packaged app (`extraResource` to `<resourcesPath>/mpv/darwin-arm64`, signing), dmg, `desktop-release.yml` | P7 |
| Rotating log (mpv warnings, bridge refusals and the budget marks go to the console until then), Copy Diagnostics (versions, `hwdec`, refresh rate, EDR headroom), crash reporter, update check | P7 |
| Memory and CPU budgets (section 8), docs (root `CLAUDE.md` table, `apps/raven/CLAUDE.md`, `apps/raven/README.md`, the spec's outcomes) | P7 |
| Remote transcode (`rebase-start-time=no`, `STREAM_TIME_SHIFT`, reload outside the cache, the slow-link offer), library modes, `Platform` | D1 to D4 |
| Matching the display's refresh rate to the video, the colourspace from the moltenvk context, Now Playing and media keys | Follow-ups |
| `access-references=no` in the addon's init options; the addon's cleanup hook segfaulting on teardown with a player still alive (avoided today: mpv is destroyed, or the process killed, before Node tears down) | Next addon rebuild |
| Playlist entry ids (`start-file` and its entry id) from the addon, so stale events are gated without relying on reply order | Next addon rebuild |
| Real-hardware gates before P5 ships: the picture under the transparent page (the window-surface smoke used an empty page), full screen, detached DevTools, and the XDR and 120 Hz measurement (if it fails, ship with `target-colorspace-hint=no`, the spec's Risks fallback) | Before P5 ships |

## Global Constraints

Binding for every task. From the root `CLAUDE.md` and the P4 plan unless marked.

- Run tasks through Nx from the repo root. Every task ends green on `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop @raven/ui @raven/core @raven/mpv @raven/web`, and `bunx nx run @raven/desktop:e2e` stays green on macOS (12 tests at the start of P5).
- TypeScript only: no `.js`, `.jsx`, `.mjs` or `.cjs` source or config file. A `package.json` script runs one command (`bun run --sequential a b`, never `&&`, `||` or `;`); every desktop script is in `nx.includedScripts`.
- Imports of a project's own modules go through `@/` with no extension (`@/main/player/playerService`); assets keep theirs. Only exception: `forge.config.ts`.
- No em dashes or en dashes anywhere, including comments, UI copy and test names.
- Type guards wherever possible; never `any`; never cast (`as const` is not a cast); `unknown` when a type cannot be inferred; discriminated unions switched with a `never` check in `default`; no enums; `type`, never `interface`; `as const satisfies T`; derive types (`Infer`, `ReturnType`, indexed access); no non-null assertion outside tests; never `@ts-ignore`.
- Validate untrusted data at the boundary with a guard: every port message and IPC payload in main and in the renderer, `window` messages, `location.state`, files read from disk, every value out of `@raven/mpv` (the wrapper guards them). Past the boundary, trust the narrowed type.
- No `for`, `for...of` or `for...in`; array methods, `reduce`, recursion for sequential async work. `!!value`; `?.` with `??`; one object parameter (library-fixed callbacks exempt); JSX `&&`; guard clauses; `const`; never mutate inputs; `??` for defaults; no floating promises; throw only `Error`s; named exports only; booleans named `is`/`has`/`should`/`can`; comments only for a non-obvious why.
- CSS: SCSS modules through `@/`; grid with `gap` and container padding, no flex, no margins for spacing; named `grid-template-areas` in fixed layouts, overlays share a named area; semantic elements first; raven's tokens from `libs/raven/ui/src/styles/globals.scss`; desktop first (`30rem`, `40rem`, `48rem`, `64rem`); works at 320px; motion inside `@media (prefers-reduced-motion: no-preference)`; no `:global()`; a label on every control and `:focus-visible` with `--focus-ring`.
- `libs/raven/core` stays platform-agnostic: no DOM, no Node APIs.
- Main-process modules other than `src/main/main.ts` import `electron` with `import type` only and take Electron's pieces, the file system and mpv as arguments, so `bun test` runs them without Electron or libmpv. Only main-process code imports `@raven/mpv`; the renderer and preload never do.
- **The bridge (P4 review carry-forwards, binding):** the port accepts only `isPlayerRequest`; raw mpv commands (`run`, `load-script`, an arbitrary `loadfile`) are unreachable; main builds every mpv argument from narrowed fields it picks itself and never forwards a renderer object; the renderer names a `PlayerSource` and main resolves it; numbers are finite (core's `isNumber`) and clamped where applied: volume 0 to 1, speed 0.25 to 4, subtitle scale 0.5 to 3, seek 0 to the duration, start at least 0; track indexes must be whole numbers 0 or more.
- **mpv lifecycle:** every native call goes through the async `@raven/mpv` wrapper; `await mpv.destroy()` (terminate runs on a worker) before the BrowserWindow is disposed; quitting destroys mpv before flushing the stores; the addon and libmpv are never bundled (Ruling 2).
- **The quiet page:** `time` reaches the page at most four times a second, `buffered` at most once a second, and while the controls are hidden nothing on the watch route's DOM changes.
- `savePosition` keeps the stored duration when a save arrives without one (P4, already in `playerState.ts`; do not regress it).
- `@raven/ui` stays web-identical: every new `PlayerServices` field and `EngineActions` member is optional and the web passes none; `@raven/web`'s tests pass untouched; UI and web keep their 96% line and 88% function coverage floors.
- Test hooks (`RAVEN_DESKTOP_USER_DATA`, `RAVEN_DESKTOP_MPV`) are read only when `app.isPackaged` is false.
- Never build libmpv locally (no Metal toolchain here). The CI-built `libs/raven/mpv/resources/darwin-arm64` is present in the worktree (gitignored); use it. The Desktop CI job rebuilds it whenever its cache key changes.
- Nothing for P6 or P7 (see "Deferred").
- Commits follow the `commit-format` skill: `MAE:` subject, short bullet body, no agent attribution. Never `--no-verify`.

## Review Focus

The inputs most likely to bite a person playing local files, most likely first. Each has its test in the owning task.

1. **A file mpv cannot open** (a damaged MKV, a text file named `.mkv`): Unplayable with "raven player could not play this video." and mpv's reason, never a spinner forever. (Task 6 fake `end-file` error while loading; Task 8 real libmpv on a text file named `.mkv`; Task 4 renderer shows Unplayable.)
2. **A file that vanishes or stops reading mid-play** (a network share unmounted, a USB drive pulled): an error, not `ended`, so the resume point stays and next in folder does not jump. (Task 6: `end-file` error while loaded, and `eof` more than 5 s short of the duration.)
3. **Rapid load, stop, load** (clicking Next twice, StrictMode's double mount, Back then a recent): the last load plays, nothing from the replaced file marks the new one ended or errored. (Task 6 stale-event tests; Task 4 events before the load reply ignored; Task 8 twenty real cycles.)
4. **A seek past the end or before the start** (End, typed fractions, a forged `seek`): clamped, the clip ends and the next one plays. (Task 4 renderer clamp; Task 6 main clamp; Task 12 End then next.)
5. **Closing the window or quitting mid-playback:** mpv is destroyed before the window goes and before the stores flush, within 1 s, with no process left. (Task 9 shutdown order and close gate tests; manual matrix.)
6. **A display unplugged or the window moved to another display:** `display-fps-override` and the EDR hint follow the new display. (Task 5 `displayOptions`; Task 9 re-applies on `moved`, `display-removed`, `display-metrics-changed`; manual.)
7. **A repeated `ready`** (a renderer reload or crash): a fresh port, the old one closed and playback stopped, never two ports driving mpv. (Task 7 connector tests.)
8. **A forged command from the renderer** (`{ type: 'run' }`, `{ type: 'load', source: { kind: 'path', path: '/etc/hosts' } }`, extra fields, a string id): refused without touching mpv. (Task 7 port tests; Task 6 picks fields.)
9. **Simultaneous track switches** (two audio picks in one frame): applied in order, the last wins, replies in order. (Task 7 serial queue test.)
10. **A `time` and cache event flood:** throttled in main, held in the chrome. (Task 6 buffered throttle; Task 3 quiet chrome.)

---

### Task 1: `OutputSettings` in core and the desktop config store

**Files:**
- Modify: `libs/raven/core/src/player.ts`, `libs/raven/core/src/player.test.ts`
- Modify: `apps/raven/desktop/src/main/stateStore.ts`, `src/main/stateStore.test.ts`
- Create: `apps/raven/desktop/src/main/desktopConfig.ts`, `src/main/desktopConfig.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts` (load the config, quit gate over both stores)

**Interfaces:**
- Produces (`@raven/core`): `isAudioProfile = oneOf(['pcm', 'passthrough', 'headphones'])`, `isPassthroughFormat = oneOf(['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'])`, `isOutputSettings = object({ profile: isAudioProfile, device: isString, passthrough: listOf(isPassthroughFormat), spatial: isBoolean })`, types `AudioProfile`, `PassthroughFormat`, `OutputSettings` by `Infer`, and `DEFAULT_OUTPUT_SETTINGS: OutputSettings = { profile: 'pcm', device: 'auto', passthrough: ['ac3', 'dts'], spatial: false }`. Doc comments: `device` is mpv's `audio-device` name, `'auto'` follows the system; `spatial` is headphones only.
- Produces (`@/main/stateStore`), generalising P4's store with no behaviour change:
  - `loadJson<T>({ fs, file, now, guard, empty }: { fs: StateFs; file: string; now: () => number; guard: (value: unknown) => value is T; empty: T }): Promise<T>` (P4's `loadState` rules: missing is `empty`; unparsable or rejected is renamed `<file>.corrupt-<now()>` and `empty`; never throws);
  - `type JsonStore<T> = { read: () => T; update: (change: (value: T) => T) => void; flush: () => Promise<void>; isDirty: () => boolean }` and `createJsonStore<T>({ fs, file, initial, timers, debounceMs, onError })`;
  - kept as thin wrappers so every P4 caller and test stands: `type StateStore = JsonStore<PlayerState>`, `loadState(...)`, `createStateStore(...)`.
- Produces (`@/main/desktopConfig`): `isDesktopConfig = object({ version: oneOf([1]), output: isOutputSettings })`, `DesktopConfig`, `EMPTY_CONFIG: DesktopConfig = { version: 1, output: DEFAULT_OUTPUT_SETTINGS }`, `CONFIG_FILE = 'desktop-config.json'`, `setOutput(config, { output }): DesktopConfig`, `pickOutput(output: OutputSettings): OutputSettings` (rebuilds the object from its four known fields; `passthrough` deduplicated and ordered as `isPassthroughFormat.values`), `type ConfigStore = JsonStore<DesktopConfig>`.

- [ ] **Step 1: Write the failing tests.**
  - `player.test.ts`: `isOutputSettings` accepts `DEFAULT_OUTPUT_SETTINGS` and `{ profile: 'headphones', device: 'coreaudio/BuiltInSpeakerDevice', passthrough: [], spatial: true }`; rejects `profile: 'bitstream'`, `passthrough: ['mp3']`, `device: 3`, a missing `spatial`; `isPassthroughFormat.values` equals `['ac3', 'eac3', 'dts', 'dts-hd', 'truehd']`.
  - `desktopConfig.test.ts`: `isDesktopConfig(EMPTY_CONFIG)`; rejects `version: 2`; `setOutput` returns a new object and leaves its input deep-equal to a `structuredClone` taken before; `pickOutput({ ...DEFAULT_OUTPUT_SETTINGS, passthrough: ['dts', 'ac3', 'dts'], extra: 'x' })` (built as a variable so the excess field type-checks) equals `{ profile: 'pcm', device: 'auto', passthrough: ['ac3', 'dts'], spatial: false }` and has exactly four keys.
  - `stateStore.test.ts`: every existing test still passes unchanged; new: `loadJson` with `guard: isDesktopConfig, empty: EMPTY_CONFIG` loads a valid config, renames a truncated one to `desktop-config.json.corrupt-1700000000000` and returns `EMPTY_CONFIG`.
- [ ] **Step 2: Run to verify they fail.** `bunx nx run-many -t test -p @raven/core @raven/desktop`.
- [ ] **Step 3: Implement** the guards (core, beside the player protocol, re-exported by `index.ts` already through `@/player`), the generic store and `desktopConfig.ts`. In `main.ts`, load `join(userData, CONFIG_FILE)` with `loadJson`, create the config store with `debounceMs: 0`, and make the quit gate's `isDirty` true when either store is dirty and its `flush` flush both (`Promise.all`).
- [ ] **Step 4: Verify** with the Global Constraints command.
- [ ] **Step 5: Commit** `MAE: add output settings to core and a desktop config store`.

---

### Task 2: Desktop protocol, service and menus for P5

**Files:**
- Modify: `apps/raven/desktop/src/shared/protocol.ts`, `src/shared/protocol.test.ts`
- Modify: `apps/raven/desktop/src/main/desktopService.ts`, `src/main/desktopService.test.ts`
- Modify: `apps/raven/desktop/src/main/menu.ts`, `src/main/menu.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts`, `src/renderer/PlayPage/playerServices.ts` (exhaustive switch), renderer test fixtures that build a `LocalFile` (add `tracks: null`)

**Interfaces:**
- Consumes: `isOutputSettings`, `OutputSettings` (Task 1), `setTrackPick`, `trackPickFor` (P4 `playerState.ts`), `pickOutput`, `ConfigStore` (Task 1).
- Produces (`@/shared/protocol`), additions only:

```ts
export const PLAYER_PORT_CHANNEL = 'raven:player'
export const PLAYER_PORT_MESSAGE = 'raven:player-port'
export const isTrackChoice = object({ audio: nullable(isNumber), subtitle: nullable(isString) })
export type TrackChoice = Infer<typeof isTrackChoice>
// isLocalFile gains: tracks: nullable(isTrackChoice)
// isMenuPlayerAction gains 'stats'
export const isAudioDevice = object({ name: isString, description: isString })
export type AudioDevice = Infer<typeof isAudioDevice>
// isDesktopRequest gains:
//   object({ type: oneOf(['saveTracks']), fileId: isOpaqueId, audio: nullable(isNumber), subtitle: nullable(isString) })
//   object({ type: oneOf(['windowButtons']), isVisible: isBoolean })
//   object({ type: oneOf(['readOutput']) })
//   object({ type: oneOf(['writeOutput']), output: isOutputSettings })
// isDesktopReply gains:
//   object({ type: oneOf(['output']), output: isOutputSettings, devices: listOf(isAudioDevice), isEngineReady: isBoolean })
export const isPlayerConnection = union(
  object({ status: oneOf(['native']) }),
  object({ status: oneOf(['unavailable']), message: isString }),
)
export type PlayerConnectionStatus = Infer<typeof isPlayerConnection>
export const isPlayerPortMessage = object({ type: oneOf([PLAYER_PORT_MESSAGE]), connection: isPlayerConnection })
```

- Produces (`@/main/desktopService`): `DesktopServiceDeps` gains `output: { read: () => Promise<{ output: OutputSettings; devices: AudioDevice[]; isEngineReady: boolean }>; write: (output: OutputSettings) => Promise<void> }` and `setWindowButtons: (isVisible: boolean) => void`.
- Produces (`@/main/menu`): `menuTemplate({ appName, isDevelopment, actions })`, `MenuActions` gains `toggleDevTools: () => void`.

Behaviour:
- `describeFile` adds `tracks: trackPickFor(store.read(), { path: file.path })`.
- `saveTracks`: `fileOf` or refused `MESSAGES.notOpen`; `store.update(setTrackPick(state, { path, audio, subtitle, at: now() }))`; `done`.
- `windowButtons`: `setWindowButtons(isVisible)`; `done`.
- `readOutput`: `{ type: 'output', ...(await output.read()) }`.
- `writeOutput`: `await output.write(pickOutput(request.output))`; `done`.
- Menu: Playback gains `{ label: 'Video Info', action: 'stats' }` after Next (still no accelerator). With `isDevelopment`, View gains a separator and `{ label: 'Toggle Developer Tools', accelerator: 'Alt+CommandOrControl+I', click: actions.toggleDevTools }`; without it, View is unchanged.
- `main.ts` for now: `output.read` answers the config's output, `devices: []`, `isEngineReady: false`; `output.write` updates the config store; `setWindowButtons` calls `setWindowButtonVisibility` on the live window; `toggleDevTools` opens DevTools with `{ mode: 'detach' }` or closes them; `isDevelopment: !app.isPackaged`. Task 9 replaces the output pieces.
- `playerActionFor('stats')` returns `null` in this task (Task 10 maps it).

- [ ] **Step 1: Write the failing tests.**
  - `protocol.test.ts`: the P4 cases that rejected `stats` now accept it; each new request and reply variant accepts one valid value; rejected: `saveTracks` with `audio: '1'`, `windowButtons` with `isVisible: 'yes'`, `writeOutput` with `output: { profile: 'pcm' }`, a `LocalFile` without `tracks`; `isPlayerPortMessage` accepts `{ type: 'raven:player-port', connection: { status: 'native' } }` and the unavailable form, rejects `connection: { status: 'broken' }`, an `unavailable` without `message` and `type: 'raven:player'`.
  - `desktopService.test.ts`: after `saveTracks` (`audio: 1, subtitle: 'embedded-0'`) a fresh `describeFile` of the same file has `tracks: { audio: 1, subtitle: 'embedded-0' }`; an unknown id is refused `notOpen`; `windowButtons` calls `setWindowButtons(false)`; `readOutput` answers what `output.read` resolves; `writeOutput` with `passthrough: ['dts', 'ac3', 'dts']` calls `output.write` with `['ac3', 'dts']`.
  - `menu.test.ts`: Playback labels are `['Play or Pause', 'Skip Back', 'Skip Forward', 'Next', 'Video Info']`; clicking Video Info sends `{ type: 'player', action: 'stats' }`; with `isDevelopment: false` no item is labelled Toggle Developer Tools; with `true` it exists and its click calls `toggleDevTools`; every accelerator still holds a modifier; the absent-items list drops Video Info and keeps Check for Updates, Open Link, Show Logs, Show Crash Reports, Copy Diagnostics.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: add track picks, output and window button requests to the desktop protocol`.

---

### Task 3: `@raven/ui` seams for a native host

**Files:**
- Create: `libs/raven/ui/src/components/Player/fromPlayerEvent.ts`, `fromPlayerEvent.test.ts`
- Modify: `libs/raven/ui/src/components/Player/useVideoState.ts` (export `Ranges`), `PlayerServices.tsx`, `engine.ts` (`toggleStats?`), `Stage.tsx` (`PlayerChrome`), `Controls.tsx`, `usePlayerActions.ts`, `ShortcutsDialog.tsx`, `Unplayable.tsx`, `Player.module.scss`, `lib/shortcuts.ts`
- Modify: `libs/raven/ui/src/styles/globals.scss`, `libs/raven/ui/src/index.ts`, `libs/raven/ui/README.md`
- Test: `libs/raven/ui/src/components/Player/playerEngine.test.tsx` (add cases)

**Interfaces:**
- Produces:

```ts
// fromPlayerEvent.ts
export const rangesFrom = (ranges: readonly { start: number; end: number }[]): Ranges
export const fromPlayerEvent = ({ event, buffered }: { event: PlayerEvent; buffered: Ranges }): VideoEvent | null
// PlayerServices.tsx, all optional
export type TrackChoice = { audio: number | null; subtitle: string | null }
export type PlayerServices = {
  // ...P4 fields
  /** The host remembers picks by hand: where to start, and where to save the next. */
  trackPicks?: { start: TrackChoice | null; save: (choice: TrackChoice) => void }
  /** Told when the controls show and hide (the desktop's traffic lights follow them). */
  chrome?: { shown: (isShown: boolean) => void }
  /** The output carries the bitstream untouched, so volume and mute do nothing. */
  isVolumeFixed?: boolean
  /** Replaces Unplayable's "This video can't play in this browser." */
  unplayableNote?: string
}
// engine.ts: EngineActions gains `toggleStats?: () => void`
// shortcuts.ts: PlayerAction gains { type: 'toggleStats' }, FIXED gains i; export const STATS_SHORTCUT = { keys: ['i'], action: 'Video info' } as const
```

- Exported from the root entry: `fromPlayerEvent`, `TrackChoice` (type).

`fromPlayerEvent` is the spec's table "From mpv to the reducer": `time` is `{ type: 'moved', time, buffered }`; `buffered` is `{ type: 'buffered', buffered: rangesFrom(ranges) }`; `paused` is `paused` or `played`; `waiting` is `waiting` or `flowing`; `duration` is `{ type: 'duration', duration }` with a non-positive value as `null`; `rate` is `rate`; `ended` is `ended`; `tracks` and `error` are `null` (the engine handles them). Switch with the `never` check.

`PlayerChrome` changes:
- holds `time` and `buffered` for `Controls` (Scrubber and clock) at their values from the last render where the controls were shown, derived during render (React's "store information from previous renders" pattern, no effect); `useWatchProgress` and actions keep reading live state;
- calls `chrome?.shown(chromeShown)` in an effect on `chromeShown`, and `chrome?.shown(true)` in its cleanup on unmount;
- passes `canShowStats={!!actions.toggleStats}` to `ShortcutsDialog`, which inserts `STATS_SHORTCUT` before the `?` row only then;
- passes `isVolumeFixed` to `Controls`.
- `usePlayerActions`: `toggleStats` calls `actions.toggleStats?.()` with no flash; `changeVolume` and `toggleMute`, when `isVolumeFixed`, flash `{ icon: 'volume', text: 'Volume is set on your receiver' }` and call nothing.
- `Controls` gains optional `isVolumeFixed?: boolean`: the mute button and the slider are `disabled`, the mute button's label becomes `Volume is set on your receiver`.
- `Unplayable`: `<p>{unplayableNote ?? "This video can't play in this browser."}</p>`.
- `Player.module.scss`: `.chrome` gets `-webkit-app-region: drag` with its `button` and `a` descendants `no-drag`, and `.chromeHidden` `no-drag` (a hidden header must not swallow the pointer moves that wake it); comment that browsers ignore it and the desktop's window drags by the player header. Add `.nativeSurface { grid-area: stage; width: 100%; height: 100dvh; }` for Task 4.
- `globals.scss`: under a comment that a desktop host draws video under the page, `:root[data-surface='native'] { --color-stage: transparent; }` and `:root[data-surface='native'] body { background: transparent; }`.
- README: hosts may also pass `trackPicks`, `chrome`, `isVolumeFixed` and `unplayableNote`; the web passes none.

- [ ] **Step 1: Write the failing tests.**
  - `fromPlayerEvent.test.ts`: `it.each` over the table, one row per `PlayerEvent` variant, including `paused: false` to `played`, `waiting: false` to `flowing`, `duration: 0` to `{ type: 'duration', duration: null }`, `time` carrying the passed `buffered` (`[[0, 10]]`), `buffered` converting `[{ start: 0, end: 4 }, { start: 8, end: 9 }]` to `[[0, 4], [8, 9]]`, `tracks` and `error` to `null`.
  - `playerEngine.test.tsx`, through the existing fake handle and `jest.advanceTimersByTime` (as `Player.test.tsx` does):
    - "holds the clock and the scrubber still while the controls are hidden": rerender with `time: 30`: slider `aria-valuenow` 30; advance 10,000 ms; rerender `time: 40`: still 30; `pointerMove` on the stage: 40.
    - "tells the host when the controls show and hide": `chrome.shown` called with `true` on mount, `false` after 10,000 ms idle, `true` after a pointer move, `true` on unmount.
    - "toggles video info only for an engine that has it": with `toggleStats` in the fake actions, key `i` calls it once and `?` lists `Video info`; without it, `i` throws nothing, calls nothing, and the dialog has no `Video info` row.
    - "keeps volume fixed when the host says so": `isVolumeFixed: true`: the `Volume` slider and the mute button are disabled; `ArrowUp` and `m` call no `setVolume` and the live region reads `Volume is set on your receiver`.
    - "shows the host's note on Unplayable": `Player` with an html file source whose element fires `error`, services `unplayableNote: 'raven player could not play this video.'`: that text shows and "This video can't play in this browser." does not.
- [ ] **Step 2: Run to verify they fail.** `bunx nx run @raven/ui:test`.
- [ ] **Step 3: Implement**, then **verify** with the Global Constraints command; `@raven/web` passes with no test edited.
- [ ] **Step 4: Commit** `MAE: let player hosts hold the clock, fix volume and offer video info`.

---

### Task 4: The native engine in `@raven/ui`

**Files:**
- Modify: `libs/raven/ui/src/components/Player/engine.ts`, `Player.tsx`, `Stage.tsx`
- Create: `libs/raven/ui/src/components/Player/useNativeEngine.tsx`, `useNativeTrackSelection.ts`, `NativeStage.tsx`, `nativeEngine.test.tsx`
- Modify: `libs/raven/ui/src/index.ts`, `libs/raven/ui/README.md`

**Interfaces:**
- Consumes: Task 3's `fromPlayerEvent`, `Ranges`, `PlayerServices` fields, `.nativeSurface`, `data-surface` CSS; `PlayerCommand`, `PlayerEvent`, `PlayerSource`, `MediaTracks` (types) from `@raven/core`; `preferredAudio`, `preferredSubtitle` (`selection.ts`); `usePlayerPrefs`.
- Produces:

```ts
// engine.ts
export type NativePlayer = {
  send: (command: PlayerCommand) => Promise<void>
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
}
export type Engine =
  | { kind: 'html'; source: HtmlSource }
  | { kind: 'native'; player: NativePlayer; source: PlayerSource }
// useNativeTrackSelection.ts
export const useNativeTrackSelection = ({ tracks, player }: { tracks: MediaTracks | null; player: NativePlayer }): TrackSelection
// useNativeEngine.tsx
export const useNativeEngine = ({ player, source, onFailure, toggleFullscreen }: {
  player: NativePlayer; source: PlayerSource; onFailure: (message: string) => void; toggleFullscreen: () => void
}): { engine: EngineHandle; selection: TrackSelection }
// NativeStage.tsx
export const NativeStage = ({ engine, onBack, onFailure }: {
  engine: Extract<Engine, { kind: 'native' }>; onBack: () => void; onFailure: (message: string) => void
}) => JSX.Element
```

- Exported from the root entry: `NativePlayer` (type); `Engine` now carries both variants.

Behaviour:
- **`Player`** switches on `engine.kind` (Ruling 1): `html` is today's body (`HtmlView` with the `source.kind` switch); `native` is `NativeView`, which holds `failure` state like `FilePlayer` and renders `Unplayable` (`problems: [failure]`, `onTryAnyway: null`) or `NativeStage`. `StageProps.engine` becomes `Extract<Engine, { kind: 'html' }>` and `Stage` renders `HtmlStage` directly.
- **`useNativeEngine`**: `useReducer(videoReducer, title.resumeAt, initialVideoState)`; `position` ref starts at `resumeAt`; a `buffered` ref. On mount: subscribe first, then send `{ type: 'load', source, start: title.resumeAt, audio: trackPicks?.start?.audio ?? null, subtitle: trackPicks?.start?.subtitle ?? null }`. Events are ignored until that send resolves (Ruling 4). After it resolves: send `{ type: 'volume', volume, muted }` from the preferences unless `isVolumeFixed`, then `{ type: 'subtitleScale', scale: captionScale }`. A rejected load calls `onFailure(error.message)`. Each event: `tracks` sets the tracks state; `error` calls `onFailure(event.message)`; `time` updates `position.current`; `buffered` updates the ref; everything else goes through `fromPlayerEvent` into `dispatch`. Unmount: unsubscribe and send `{ type: 'stop' }`. Every send other than `load` handles its rejection (`.catch` to nothing).
- **Actions:** `play` and `pause` send theirs; `seek(target)` clamps to 0 and `(duration ?? Infinity) - 0.5` as the html engine does, sets `position.current`, dispatches `sought`, sends `seek`; `setVolume` sends `volume` and stores the preference; `setRate` sends `speed`; `setSubtitleScale` sends `subtitleScale` and stores `captionScale`; `setAudio`/`setSubtitle` are the selection's picks; `toggleStats` sends `stats`.
- **Handle:** `duration` is `title.duration ?? state.elementDuration`; `drawsSubtitles: true`; `focusSurface` does nothing (shortcuts are window-wide); `surface` is `<div className={styles.nativeSurface} onClick={toggle play} onDoubleClick={toggleFullscreen} />` with the same oxlint disable comment and reason as the html `<video>`.
- **`useNativeTrackSelection`**: holds `audio: number | null` and `subtitleId: string | null`, starting from `trackPicks?.start`. When `tracks` first arrive and there is no start pick, it applies `preferredAudio({ tracks, language: audioLanguage })` and `preferredSubtitle({ tracks, subtitles })`, sending `audio`/`subtitle` only for a non-null result, and saves nothing. `pickAudio(index)`: set state, send `{ type: 'audio', index }`, `setAudioLanguage(language of that track ?? null)`, `trackPicks?.save({ audio: index, subtitle: subtitleId })`. `pickSubtitle(id)`: set state, send `{ type: 'subtitle', id }`, `setSubtitles({ on: id != null, language })` as `useTrackSelection` does, `trackPicks?.save({ audio, subtitle: id })`. Returns `TrackSelection` with `tracksFailed: false`, `tracksPending: tracks === null`, `isDefaultAudio: audio == null || audio === tracks?.defaultAudio`, `isWaitingForTracks: false`.
- **`NativeStage`**: `useFullscreen()`, `useNativeEngine`, an effect setting `document.documentElement.dataset.surface = 'native'` on mount and deleting it on unmount, and `<PlayerChrome engine={...} onBack mode="direct" selection subtitleStatus={selection.subtitle ? 'ready' : 'off'} fullscreen />`.

- [ ] **Step 1: Write the failing tests** in `nativeEngine.test.tsx` with a fake `NativePlayer` (records `send` calls; a `deferLoad` option holds the load promise; `emit(event)` drives subscribers; `listenerCount()`), rendering `<Player engine={{ kind: 'native', player, source: { kind: 'file', fileId: 'f1' } }} />` in the existing provider harness:
  - "loads the source at the resume point with the stored picks": `resumeAt: 20`, `trackPicks.start { audio: 1, subtitle: 'embedded-0' }`: the first send is `{ type: 'load', source: { kind: 'file', fileId: 'f1' }, start: 20, audio: 1, subtitle: 'embedded-0' }`, then `{ type: 'volume', volume: 1, muted: false }`, then `{ type: 'subtitleScale', scale: 1 }`; no `video` element exists.
  - "ignores events until the load is answered": with the load held, emit `ended`: no navigation to `title.next`; resolve, emit `ended`: navigates to `title.next.to`.
  - "folds events into the controls": emit `paused: false`: a button named `Pause (k)`; `duration: 120`: slider `aria-valuemax` 120; `time: 42`: `aria-valuenow` 42.
  - "applies the language preferences once tracks arrive": prefs `audioLanguage: 'fr'`, `subtitles: { on: true, language: 'en' }`; emit `tracks` with English (index 0, default) and French (index 1) audio and an English `embedded-0`: sends `{ type: 'audio', index: 1 }` and `{ type: 'subtitle', id: 'embedded-0' }`; `trackPicks.save` not called.
  - "sends, remembers and saves a pick by hand": open Settings, choose the French radio: sends `{ type: 'audio', index: 1 }`, `usePlayerPrefs.getState().audioLanguage` is `'fr'`, `trackPicks.save` called with `{ audio: 1, subtitle: null }`.
  - "clamps a seek short of the end": after `duration: 120`, `End` sends `{ type: 'seek', time: 119.5 }`.
  - "shows Unplayable on an error event and on a refused load": emit `{ type: 'error', reason: 'decode', message: 'Bad frame' }`: `Bad frame` and the host's `unplayableNote` show; a fresh render whose load rejects with `Error('That video is no longer open.')` shows that message.
  - "stops and lets go on unmount": unmount: the last send is `{ type: 'stop' }`, `listenerCount()` is 0, `document.documentElement.dataset.surface` is `undefined` (it was `'native'` while mounted).
  - "offers video info": `i` sends `{ type: 'stats' }`; clicking the surface sends `play` when paused.
  - "never sends volume when it is fixed": `isVolumeFixed: true`: no `volume` command after load.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (UI coverage floors hold; `@raven/web` untouched).
- [ ] **Step 3: Commit** `MAE: add the native engine to the shared player`.

---

### Task 5: Pure main-process player pieces

**Files:**
- Modify: `libs/raven/mpv/src/properties.ts`, `src/properties.test.ts` (track flags)
- Modify: `apps/raven/desktop/package.json` (`"@raven/mpv": "workspace:*"` in `dependencies`), `bun.lock` (by `bun install`)
- Create under `apps/raven/desktop/src/main/player/`: `tracksFromMpv.ts`, `outputOptions.ts`, `displayOptions.ts`, `engine.ts`, `sleepGuard.ts`, each with its `*.test.ts`

**Interfaces:**
- Consumes: `MpvTrack`, `MpvSurface` from `@raven/mpv`; `languageTag`, `MediaTracks`, `OutputSettings` from `@raven/core`; `AudioDevice` (Task 2).
- `@raven/mpv`: `isMpvTrack` gains `forced: optional(isBoolean)` and `'hearing-impaired': optional(isBoolean)`.
- Produces:

```ts
// tracksFromMpv.ts
export const tracksFromMpv = ({ list, frameRate }: { list: readonly MpvTrack[]; frameRate: number | null }): MediaTracks
export const aidFor = ({ list, index }: { list: readonly MpvTrack[]; index: number }): number | null
export const sidFor = ({ list, id }: { list: readonly MpvTrack[]; id: string }): number | null
// outputOptions.ts
export type MpvOption = { name: string; value: string | number | boolean }
export const outputOptions = ({ output, devices, canChooseAo }: {
  output: OutputSettings; devices: readonly AudioDevice[]; canChooseAo: boolean
}): MpvOption[]
export const isVolumeFixedFor = (output: OutputSettings): boolean
// displayOptions.ts
export const displayOptions = ({ refreshRate, edrHeadroom }: { refreshRate: number; edrHeadroom: number }): MpvOption[]
// engine.ts
export type EngineMode = 'window' | 'headless' | 'off'
export const engineModeFrom = ({ isPackaged, env }: { isPackaged: boolean; env: Readonly<Record<string, string | undefined>> }): EngineMode
export const addonPathFor = ({ isPackaged, appPath, resourcesPath }: { isPackaged: boolean; appPath: string; resourcesPath: string }): string
export const ENGINE_MESSAGES = {
  unavailable: 'raven player could not start its video engine, so it plays only the videos Chromium can.',
  off: 'The video engine is off for this run.',
} as const
export type OpenedEngine<T> = { status: 'native'; engine: T } | { status: 'unavailable'; message: string }
export const openEngine = <T>({ mode, surfaceFor, open, warn }: {
  mode: EngineMode
  surfaceFor: (mode: 'window' | 'headless') => MpvSurface
  open: (surface: MpvSurface) => Promise<T>
  warn: (message: string) => void
}): Promise<OpenedEngine<T>>
// sleepGuard.ts
export const createSleepGuard = ({ start, stop }: { start: () => number; stop: (id: number) => void }): { set: (isPlaying: boolean) => void }
```

Rules:
- **`tracksFromMpv`** (spec "Tracks from mpv"): audio is the `audio` entries in list order, `index` their position, `codec: codec ?? null`, `channels: demux-channel-count ?? null`, `language: languageTag(lang ?? null)`, `title: title ?? null`, `default: default ?? false`. Subtitles are the `sub` entries in list order; an entry with `external: true` is `external-N` counting externals, else `embedded-N` counting embedded ones; `source` matches; `forced` and `hearingImpaired` from the flags (default false); `supported: true` always. `defaultAudio` is the index of the first audio flagged default, else `0` when there is audio, else `null`. `frameRate` is `frameRate` when above 0, else `null`. Video entries are skipped.
- **`aidFor`** is the mpv `id` of the audio entry at `index`; **`sidFor`** parses `/^(embedded|external)-(\d+)$/` and returns that kind's Nth entry's `id`; both `null` when absent or malformed.
- **`outputOptions`** (spec "Audio"), in this order: `audio-device` is `output.device` when it is `'auto'` or a `name` in `devices`, else `'auto'`; then per profile:
  - `pcm`: `audio-spdif` `''`, `audio-channels` `'auto-safe'`, `audio-exclusive` `false`, `audio-normalize-downmix` `false`, `ao` `'coreaudio'`;
  - `passthrough`: `audio-spdif` the formats joined by `,` (empty list behaves as `pcm`), `audio-channels` `'auto-safe'`, `audio-exclusive` `true`, `audio-normalize-downmix` `false`, `ao` `'coreaudio'`, `volume` `100`, `mute` `false`;
  - `headphones`: `audio-spdif` `''`, `audio-exclusive` `false`; without `spatial`: `audio-channels` `'stereo'`, `audio-normalize-downmix` `true`, `ao` `'coreaudio'`; with `spatial`: `audio-channels` `'auto-safe'`, `audio-normalize-downmix` `false`, `ao` `'avfoundation'`.
  - With `canChooseAo: false` (headless) every `ao` entry is left out. `isVolumeFixedFor` is true only for `passthrough` with at least one format.
- **`displayOptions`** (spec "Surfaces" and "HDR"): `{ name: 'display-fps-override', value: refreshRate }` only when `refreshRate > 0`, then `{ name: 'target-colorspace-hint', value: edrHeadroom > 1 ? 'yes' : 'no' }`.
- **`engineModeFrom`**: packaged is always `window`; else `RAVEN_DESKTOP_MPV` `headless` or `off`, anything else `window`. **`addonPathFor`**: Ruling 2's two paths, built with `join`.
- **`openEngine`**: `off` resolves `{ status: 'unavailable', message: ENGINE_MESSAGES.off }` without calling `open`; otherwise `open(surfaceFor(mode))`, and any rejection or throw is `warn`ed with its message and resolves `unavailable` with `ENGINE_MESSAGES.unavailable`.
- **`createSleepGuard`**: `set(true)` starts once (a second `true` does nothing), `set(false)` stops the started id once.

- [ ] **Step 1: Write the failing tests.**
  - `properties.test.ts`: a `track-list` entry with `forced: true, 'hearing-impaired': false` passes; `forced: 'yes'` fails.
  - `tracksFromMpv.test.ts` with a fixture list: video id 1; audio id 1 `eng` default `truehd` 8 channels; audio id 2 `fra` `ac3` 6; sub id 1 `eng` `hdmv_pgs_subtitle`; sub id 2 `eng` forced `subrip`; sub id 3 external `spa` `subrip`. Expect audio indexes `[0, 1]`, languages `['en', 'fr']`, channels `[8, 6]`; subtitle ids `['embedded-0', 'embedded-1', 'external-0']`, sources, `forced` on the second, every `supported` true; `defaultAudio` 0; with no default flag `defaultAudio` is 0; no audio gives `null`; `frameRate: 23.976` kept, `0` and `null` give `null`. `aidFor` index 1 is 2, index 5 `null`; `sidFor('embedded-1')` is 2, `'external-0'` is 3, `'external-1'`, `'embedded-x'` and `'pgs-0'` `null`.
  - `outputOptions.test.ts`: one exact array per profile as above (`toEqual`); an unknown device becomes `'auto'`; `canChooseAo: false` has no `ao`; passthrough with `[]` equals the `pcm` array; `isVolumeFixedFor` table.
  - `displayOptions.test.ts`: `{ refreshRate: 120, edrHeadroom: 16 }` gives fps 120 and `'yes'`; `{ 60, 1 }` gives `'no'`; `{ 0, 1 }` gives only the hint.
  - `engine.test.ts`: `engineModeFrom` table (packaged with `headless` set is `window`); `addonPathFor` both; `openEngine` with `off` never calls `open`; a rejecting `open` resolves unavailable with the message and `warn` got the error text; a resolving one gives `native` with the value; `surfaceFor` got `'headless'` in headless mode.
  - `sleepGuard.test.ts`: `true, true, false, false` gives one start and one stop with the started id.
- [ ] **Step 2: Run to verify they fail**, **implement**, `bun install`, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: map mpv tracks, output and display settings for the desktop player`.

---

### Task 6: The player service (main), against a fake mpv

**Files:**
- Create: `apps/raven/desktop/src/main/player/playerService.ts`, `src/main/player/playerService.test.ts`

**Interfaces:**
- Consumes: Task 5's `tracksFromMpv`, `aidFor`, `sidFor`, `outputOptions`, `displayOptions`, `isVolumeFixedFor`; `Mpv`, `MpvEvent` from `@raven/mpv`; `PlayerCommand`, `PlayerEvent`, `PlayerSource`, `OutputSettings` from `@raven/core`; `AudioDevice` (Task 2); `Grants` (P4), `Timers` (P4).
- Produces:

```ts
export type MpvControl = Pick<Mpv, 'command' | 'set' | 'read' | 'observe'>
export type PlayerOutcome = { ok: true } | { ok: false; message: string }
export type PlayerActivity = { isPlaying: boolean; isShowing: boolean }
export const PLAYER_MESSAGES = {
  serverTitles: 'raven player cannot play server titles yet.',
  notOpen: 'That video is no longer open. Open it again from Home.',
  cannotOpen: 'raven player could not open this video.',
  stopped: 'raven player could not keep playing this video.',
  engineStopped: "raven player's video engine stopped. Open the video again.",
  noTrack: 'That track is not in this video.',
  failed: 'raven player could not do that.',
} as const
export const OBSERVED = ['time-pos', 'duration', 'pause', 'paused-for-cache', 'seeking', 'speed',
  'track-list', 'container-fps', 'demuxer-cache-state'] as const
export const BUFFERED_MS = 1000
export const EOF_SHORT_S = 5
export const resolveSourceWith = ({ grants }: { grants: Pick<Grants, 'fileOf'> }):
  (source: PlayerSource) => { ok: true; path: string } | { ok: false; message: string }
export type PlayerService = {
  handle: (command: PlayerCommand) => Promise<PlayerOutcome>
  receive: (event: MpvEvent) => void
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
  reset: () => Promise<void>
  applyOutput: (input: { output: OutputSettings; devices: readonly AudioDevice[] }) => Promise<void>
  applyDisplay: (input: { refreshRate: number; edrHeadroom: number }) => Promise<void>
}
export const createPlayerService = (deps: {
  mpv: MpvControl
  resolveSource: ReturnType<typeof resolveSourceWith>
  canChooseAo: boolean
  timers: Timers
  onActivity: (activity: PlayerActivity) => void
  onFirstFrame: () => void
  warn: (message: string) => void
}): PlayerService
```

Rules:
- Creation observes every name in `OBSERVED`.
- **Phases** (Ruling 4): `idle`, `loading`, `loaded`; `dead` after `shutdown`, `overflow` or a wrapper `error` event, which emit `{ type: 'error', reason: 'engine', message: engineStopped }` once; in `dead` every command answers `ok: false, engineStopped`.
- **`load`**: `resolveSource` (server sources refused `serverTitles`, unknown files `notOpen`); remember `wanted = { audio, subtitle }`; phase `loading`; `onActivity({ isPlaying: false, isShowing: true })`; `set pause false`; `command(['loadfile', path, 'replace', '-1', \`start=${Math.max(0, start)}\`])`; `ok`. The path comes only from the grant.
- **`file-loaded`**: phase `loaded`; read `track-list` and `container-fps`; apply `wanted` (`aid` is `'auto'` for `null`, else `aidFor`; `sid` is `'no'` for `null`, else `sidFor`; an unknown pick falls back to `'auto'`/`'no'`); then read `pause`, `duration`, `speed` and emit `paused`, `duration`, `rate`, `{ type: 'waiting', waiting: false }`, `tracks`; `onActivity({ isPlaying: !pause, isShowing: true })`. The first `playback-restart` after each `load` calls `onFirstFrame()`.
- **Property events** (only while `loaded`): `time-pos` number emits `time` and records the last time; `duration`, `speed`, `pause` emit theirs (`pause` also calls `onActivity`); `paused-for-cache` or `seeking` emit `waiting` with their OR, only when it changes; `track-list` and `container-fps` store and emit `tracks`; `demuxer-cache-state` emits `buffered` from `seekable-ranges` at most once per `BUFFERED_MS` (a trailing timer sends the latest) and only when a start or end moved by 0.5 s or more.
- **`end-file`**: `eof` while `loading` is ignored; `eof` while `loaded` emits `ended`, unless the duration is known and the last time is more than `EOF_SHORT_S` before it, which emits `{ type: 'error', reason: 'decode', message: stopped }`; `error` emits `{ type: 'error', reason: phase === 'loading' ? 'open' : 'decode', message: phase === 'loading' ? cannotOpen : stopped }`; `stop`, `quit`, `redirect` emit nothing. Any ending sets phase `idle` and `onActivity({ isPlaying: false, isShowing: true })`. `log` events are `warn`ed as `mpv <level> <prefix>: <text>`.
- **Other commands:** `play`/`pause` set `pause`; `seek` clamps to 0 and the known duration, sends `['seek', String(time), 'absolute']` while `loaded`, and while `loading` replaces the start (applied by a seek at `file-loaded`); `audio` and `subtitle` require a whole number 0 or more or a known id (`noTrack` otherwise) while `loaded`, and while `loading` update `wanted`; `volume` is ignored with `ok` while the applied output fixes volume, else sets `volume` to `Math.round(clamp(volume, 0, 1) * 1000) / 10` and `mute`; `speed` sets `speed` clamped 0.25 to 4; `subtitleScale` sets `sub-scale` clamped 0.5 to 3; `stats` runs `['script-binding', 'stats/display-stats-toggle']`; `stop` runs `['stop']`, phase `idle`, `onActivity({ isPlaying: false, isShowing: false })`. A rejected mpv call answers `ok: false, failed` and is `warn`ed.
- **`reset()`** is `stop` when not `idle`. **`applyOutput`** sets each `outputOptions({ ..., canChooseAo })` entry in order, records whether volume is fixed, and while `loaded` runs `['ao-reload']` (a failure is only `warn`ed). **`applyDisplay`** sets each `displayOptions` entry.

- [ ] **Step 1: Write the failing tests** with a fake `MpvControl` (records `command` and `set` calls in one ordered log; `read` answers from a table the test sets; can reject on demand), fake timers, and `resolveSourceWith` over a fake `fileOf` that knows `f1` at `/m/Film.mkv`:
  - creation observes `OBSERVED` in order;
  - `load` of `f1` at `start: -3` logs `set pause false` then `loadfile /m/Film.mkv replace -1 start=0`; a server source is `{ ok: false, message: serverTitles }` with nothing logged; an unknown file id is `notOpen`;
  - a `load` whose command carries extra fields (`{ ...load, args: ['run', 'rm'] }`, built as a variable) logs exactly the same calls as without them;
  - events before `file-loaded` (`time-pos`, `duration`) emit nothing; `file-loaded` emits `paused`, `duration`, `rate`, `waiting`, `tracks` in that order and applies a wanted `audio: 1` as `set aid <id of the second audio>` and `subtitle: null` as `set sid no`;
  - an `eof` while `loading` emits nothing; an `error` end-file while `loading` emits `reason: 'open'`; while `loaded`, `reason: 'decode'`;
  - `eof` at last time 118 of 120 emits `ended`; at 60 of 120 emits `error` `decode`; with no duration emits `ended`;
  - seek 500 with duration 120 sends `seek 120 absolute`; seek -4 sends `seek 0 absolute`; seek while `loading` changes nothing until `file-loaded`, which then logs `seek <t> absolute`;
  - volume 1.7 sets `volume 100`; muted sets `mute true`; after `applyOutput` with passthrough `['ac3']`, `volume` logs nothing and answers `ok`; speed 9 sets 4, 0.1 sets 0.25; subtitleScale 7 sets `sub-scale 3`;
  - `audio` index `1.5`, `-1` and an index past the list answer `noTrack`; `subtitle` `'embedded-9'` answers `noTrack`;
  - `stats` logs the script binding; a rejecting command answers `failed` and `warn` was called;
  - `paused-for-cache` true then `seeking` true emits one `waiting: true`; both false emits one `waiting: false`;
  - twelve `demuxer-cache-state` events within 1 s emit one `buffered` at once and one trailing with the latest ranges; an unchanged range emits nothing more;
  - `shutdown` emits one `engine` error and later commands answer `engineStopped`;
  - `onActivity` sequence for load, file-loaded unpaused, pause, stop: `{ false, true }`, `{ true, true }`, `{ false, true }`, `{ false, false }`; `onFirstFrame` once per load.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: drive mpv from an allowlisted desktop player service`.

---

### Task 7: The port bridge, the connector and the preload forwarder

**Files:**
- Create: `apps/raven/desktop/src/main/player/playerPort.ts`, `playerPort.test.ts` (`connectPort`)
- Create: `apps/raven/desktop/src/main/player/connector.ts`, `connector.test.ts`
- Create: `apps/raven/desktop/src/preload/playerPort.ts`, `playerPort.test.ts` (`forwardPlayerPort`)

**Interfaces:**
- Consumes: `PlayerService` (Task 6); `isPlayerRequest`, `PlayerEvent` from `@raven/core`; `isPlayerConnection`, `PlayerConnectionStatus`, `PLAYER_PORT_MESSAGE` (Task 2); `OpenedEngine` (Task 5).
- Produces:

```ts
// @/main/player/playerPort
export type PortLike = {
  onMessage: (listener: (data: unknown) => void) => void
  onClose: (listener: () => void) => void
  post: (message: unknown) => void
  start: () => void
  close: () => void
}
export const UNKNOWN_COMMAND = 'raven player does not understand that command.'
export const connectPort = ({ port, service, warn }: { port: PortLike; service: PlayerService; warn: (message: string) => void }): { close: () => void }
// @/main/player/connector
export const createConnector = <T extends { service: PlayerService }>({ engine, channel, post, warn }: {
  engine: () => Promise<OpenedEngine<T>>
  channel: () => { local: PortLike; remote: unknown }
  post: (input: { connection: PlayerConnectionStatus; ports: unknown[] }) => void
  warn: (message: string) => void
}): { connect: () => Promise<void>; disconnect: () => void }
// @/preload/playerPort
export const forwardPlayerPort = ({ payload, ports, post }: {
  payload: unknown
  ports: readonly MessagePort[]
  post: (message: unknown, transfer: MessagePort[]) => void
}): void
```

Rules:
- **`connectPort`** subscribes to the service's events and posts each event object as is; starts the port. Each message: `isPlayerRequest(data)` is queued, handled one at a time in arrival order, and answered `{ id, ok: true }` or `{ id, ok: false, message }`; a message that fails the guard but is an object with a numeric `id` is answered `{ id, ok: false, message: UNKNOWN_COMMAND }`; anything else is dropped; both are `warn`ed. Only `data.command` (the narrowed command) reaches `service.handle`. On the port's `close`, or `close()`, it unsubscribes, drops queued work, calls `service.reset()` (rejection handled) and closes the port.
- **`createConnector`**: `connect()` first closes any previous connection (so a repeated `ready` never leaves two ports), awaits `engine()`, and either makes a channel, `connectPort`s its `local`, and `post`s `{ connection: { status: 'native' }, ports: [remote] }`, or `post`s `{ connection: { status: 'unavailable', message }, ports: [] }`. `disconnect()` closes the current one.
- **`forwardPlayerPort`** posts `{ type: PLAYER_PORT_MESSAGE, connection }`, with `connection` rebuilt from its known fields, and the ports, only when `isPlayerConnection(payload)` and the port count fits (`native` exactly one, `unavailable` none); anything else is dropped.

- [ ] **Step 1: Write the failing tests** with a fake port (records posts; the test pushes messages and fires close) and a fake service (records `handle`; `deferNext()` holds one reply):
  - `{ id: 1, command: { type: 'play' } }` reaches `handle` as `{ type: 'play' }` and posts `{ id: 1, ok: true }`;
  - `{ id: 2, command: { type: 'run', args: ['quit'] } }`, `{ id: 3, command: { type: 'load', source: { kind: 'path', path: '/etc/hosts' }, start: 0, audio: null, subtitle: null } }` and `{ id: 4, command: { type: 'seek', time: 'end' } }` post `ok: false` with `UNKNOWN_COMMAND` and never reach `handle`; `{ id: '5', command: { type: 'play' } }` and `'play'` post nothing; `warn` ran for each;
  - two `audio` requests sent together while the first reply is held: `handle` gets the second only after the first resolves, replies post in id order;
  - a service event is posted to the port; after close, events are not posted and `reset` ran once;
  - connector: first `connect` posts `native` with one port; a second `connect` closes the first local port (its `close` ran, `reset` ran) before posting a new one; an unavailable engine posts `{ status: 'unavailable', message }` with `[]`;
  - forwarder: `{ status: 'native' }` with one port posts it; with zero or two ports posts nothing; `{ status: 'unavailable', message: 'x' }` with no ports posts it; `{ status: 'nope' }` posts nothing; `{ status: 'native', path: '/x' }` with one port posts a connection of exactly `{ status: 'native' }`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: carry player commands over one guarded port per page`.

---

### Task 8: The player service against real headless libmpv

**Files:**
- Create: `apps/raven/desktop/test/player.native.ts`
- Modify: `apps/raven/desktop/e2e/clips.ts` (add `makeTrackClip`)
- Modify: `apps/raven/desktop/package.json` (`"test:native": "node --import tsx --test --test-timeout=120000 test/player.native.ts"` in `scripts` and `includedScripts`; `nx.targets["test:native"]`: `{ "cache": false, "dependsOn": ["^build"] }`; devDependency `tsx` 4.23.15), `tsconfig.main.json` (`include` gains `"test"`), `.oxlintrc.json` (test override gains `test/**`), `bun.lock`
- Modify: `.github/workflows/pull-request-checks.yml`

**Interfaces:**
- Consumes: `openMpv` from `@raven/mpv`; Tasks 5 to 6 (`addonPathFor`, `createPlayerService`, `resolveSourceWith`, `outputOptions`); P4's `createNodeTimers`.
- Produces (`@/e2e/clips`): `makeTrackClip(): Promise<{ folder: string; path: string }>` writing `Tracks 01.mkv` (30 s) with `RAVEN_E2E_FFMPEG ?? 'ffmpeg'` and `-f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -f lavfi -i sine=frequency=880:sample_rate=48000 -i <srt> -map 0:v -map 1:a -map 2:a -map 3:s -t 30 -c:v mpeg4 -c:a aac -c:s srt -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -metadata:s:s:0 language=eng` (the same encoders `@raven/mpv`'s native test uses, all built into ffmpeg), plus `notes.mkv` holding plain text.

Run with `node:test` (`describe`/`test`, `assert`): one `openMpv({ surface: { kind: 'headless' }, addonPath: addonPathFor({ isPackaged: false, appPath: <project dir>, resourcesPath: '' }), onEvent: (event) => service.receive(event) })`, a service over it with `canChooseAo: false`, `resolveSourceWith` over a fake `fileOf` (`t1` is the track clip, `bad` is `notes.mkv`), and an `eventAfter`-style helper waiting up to 10 s for a matching `PlayerEvent`.

- [ ] **Step 1: Write the tests.**
  - "loads and reports the clip's tracks": after `load t1`, a `tracks` event has two audio tracks with languages `['en', 'fr']` and one subtitle `embedded-0`; a `duration` event is within 0.5 of 30; `paused: false` arrives.
  - "pauses, seeks and clamps a seek past the end": `pause` gives `paused: true`; `seek 4` gives a `time` within 0.5 of 4; `seek 9999` then `play` gives `ended` within 10 s.
  - "switches audio by index and subtitles by id": `audio 1` then `mpv.read({ name: 'aid' })` equals the second audio entry's id from `track-list`; `subtitle 'embedded-0'` sets `sid` to its id; `subtitle null` reads `false`.
  - "applies picks sent with the load": `load t1` with `audio: 1, subtitle: 'embedded-0'`: after `tracks`, `aid` and `sid` match those entries.
  - "reports an open error for a file it cannot read": `load bad` gives `{ type: 'error', reason: 'open' }`.
  - "toggles the stats overlay and reads the device list": `stats` answers `ok: true`; `read({ name: 'audio-device-list' })` resolves an array (the spike in "Spikes").
  - "applies output settings without touching ao": `applyOutput` for each profile resolves; `read({ name: 'mpv-version' })` still answers.
  - "survives twenty load, stop and load cycles": cycles without awaiting events between them, then the last `load` reaches `paused: false` and `tracks`; then `destroy()` resolves within 5 s.
- [ ] **Step 2: Run** `bunx nx run @raven/desktop:test:native` locally (uses the worktree's `resources/darwin-arm64` and Homebrew's `ffmpeg`): all pass. If `loadfile ... -1 start=` fails, apply the Spikes fallback in Task 6's code and its test, and note it in the commit body.
- [ ] **Step 3: CI.** In the `desktop` job, after `🧪 Real headless libmpv tests`, add `🧪 Desktop player against headless libmpv` running `bunx nx run @raven/desktop:test:native` with `env: RAVEN_E2E_FFMPEG: ${{ github.workspace }}/libs/raven/mpv/native-build/prefix/bin/ffmpeg`. This and Task 5's `properties.ts` change alter the native cache key, so the first run rebuilds libmpv once; expected.
- [ ] **Step 4: Verify** with the Global Constraints command (the Ubuntu job never runs `test:native`).
- [ ] **Step 5: Commit** `MAE: test the desktop player service against headless libmpv`.

---

### Task 9: Main process wiring and the macOS surface

**Files:**
- Create: `apps/raven/desktop/src/main/shutdown.ts`, `src/main/shutdown.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts`, `src/preload/preload.ts`, `src/shared/bridge.ts` (comment only: the port arrives by `window.postMessage`)

**Interfaces:**
- Consumes: everything from Tasks 1, 2, 5, 6, 7; `openMpv`, `Mpv` from `@raven/mpv`; P4's `createQuitGate`.
- Produces (`@/main/shutdown`):

```ts
export const createShutdown = ({ engine, stores, warn }: {
  engine: { isAlive: () => boolean; destroy: () => Promise<void> }
  stores: readonly { isDirty: () => boolean; flush: () => Promise<void> }[]
  warn: (message: string) => void
}): { isPending: () => boolean; settle: () => Promise<void> }
```

`isPending` is true while the engine is alive or any store is dirty; `settle` destroys the engine first (a rejection is `warn`ed and settling goes on), then flushes every store.

`main.ts`, in this order (spec section 5 "The bridge" and "Surfaces"):
1. **Engine:** `mode = engineModeFrom({ isPackaged: app.isPackaged, env: process.env })`; one lazy `engine()` per window, started at `ready-to-show` or the first `ready`, whichever comes first, through `openEngine` with `surfaceFor` giving `{ kind: 'window', handle: window.getNativeWindowHandle() }` or `{ kind: 'headless' }` and `open` calling `openMpv({ surface, addonPath: addonPathFor({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath }), onEvent })`; `onEvent` forwards to the service once it exists. On success it creates the service (`resolveSourceWith({ grants })`, `canChooseAo: mode === 'window'`), applies the stored output and the current display, and resolves `{ status: 'native', engine: { mpv, service } }`.
2. **Connector:** `createConnector` with `channel` from `new MessageChannelMain()` (the `local` adapted to `PortLike`: `port.on('message', (event) => listener(event.data))`, `port.on('close', ...)`), and `post` calling `window.webContents.postMessage(PLAYER_PORT_CHANNEL, connection, ports)` only while the window is live and `isAppUrl(window.webContents.getURL())`. The desktop service's `onReady` also calls `connect()` (handle its rejection).
3. **Activity:** `onActivity` drives `createSleepGuard` over `powerSaveBlocker.start('prevent-display-sleep')`/`stop`, and on a change of `isShowing` calls `window.setBackgroundColor(isShowing ? '#00000000' : NIGHT)` and, when it turns false, `setWindowButtonVisibility(true)`.
4. **Display:** `applyDisplay` at engine start and on the window's `moved`, `enter-full-screen`, `leave-full-screen` and `screen`'s `display-added`, `display-removed`, `display-metrics-changed`, with `refreshRate` from `screen.getDisplayMatching(window.getBounds()).displayFrequency`, falling back to `mpv.display().refreshRate`, and `edrHeadroom` from `mpv.display()` (a throw after destroy is ignored).
5. **Output:** the desktop service's `output.read` answers the config's output, `devices` from `mpv.read({ name: 'audio-device-list' })` (`[]` on failure or without an engine) and `isEngineReady`; `output.write` updates the config store, then `service.applyOutput`.
6. **Marks** (unpackaged only, Ruling 14): `onFirstFrame` writes `raven-first-frame-ms <n>` measured from the last `load`; while `isPlaying`, a `monitorEventLoopDelay({ resolution: 10 })` histogram prints `raven-loop-lag-p99-ms <Math.round(percentile(99) / 1e6)>` every 5,000 ms and resets.
7. **Shutdown:** `createShutdown` over the engine (`isAlive` until `destroy` was called) and both stores feeds `createQuitGate` for `before-quit` and `will-quit` (so mpv stops before the stores flush and before Electron tears down windows); the window's `close` event goes through a second `createQuitGate` with `isDirty: engine alive`, `flush: destroy`, `quit: () => window.close()`, `exit: () => window.destroy()`, so mpv is destroyed before the window is disposed.
8. **Preload:** `ipcRenderer.on(PLAYER_PORT_CHANNEL, (event, payload) => forwardPlayerPort({ payload, ports: event.ports, post: (message, transfer) => window.postMessage(message, APP_ORIGIN, transfer) }))`. Nothing new is exposed through `contextBridge`.

- [ ] **Step 1: Write the failing tests** for `createShutdown`: with the engine alive, `isPending` is true; `settle` records `destroy` before every `flush`; a rejecting `destroy` still flushes and `warn` ran; with the engine dead and clean stores `isPending` is false. And through P4's `createQuitGate` with these pieces: a close while the engine is alive is prevented, `destroy` runs once, then `quit` (here `window.close`) runs.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command; `dist/main` holds no `.node` file (`ls dist/main`).
- [ ] **Step 3: Smoke it by hand** (the Spikes): `RAVEN_DESKTOP_USER_DATA=$(mktemp -d) bunx nx run @raven/desktop:dev -- /path/to/M1.mp4` with no `RAVEN_DESKTOP_MPV`:
  - M1's picture shows under the controls, the page transparent over it; the controls fade after 10 s and the traffic lights go with them; a mouse move brings both back; the window drags by the player header;
  - resize, fullscreen (`f`) and leaving it keep the video under the page; Alt Command I opens DevTools detached and the video stays visible;
  - `pmset -g assertions` lists `PreventUserIdleDisplaySleep` from raven player while it plays and not while paused;
  - Escape returns Home on the night background with the traffic lights shown;
  - Command Q mid-play quits within 1 s and `pgrep -f "raven player|Electron"` finds nothing.
  Record each result in the commit body. If the page does not show the video, apply the transparency fallback from "Spikes".
- [ ] **Step 4: Commit** `MAE: wire libmpv into the desktop window under a transparent page`.

---

### Task 10: The renderer picks its engine

**Files:**
- Create: `apps/raven/desktop/src/renderer/desktop/playerConnection.ts`, `playerConnection.test.ts`
- Modify: `apps/raven/desktop/src/renderer/desktop/DesktopContext.tsx`, `src/renderer/main.tsx`, `src/renderer/test/render.tsx`
- Modify: `apps/raven/desktop/src/renderer/PlayPage/PlayPage.tsx`, `playerServices.ts`, `PlayPage.test.tsx`, `playerServices.test.ts`

**Interfaces:**
- Consumes: Task 2's protocol; Task 3 and 4's `NativePlayer`, `TrackChoice` and service fields from `@raven/ui`; `isPlayerReply`, `isPlayerEvent` from `@raven/core`.
- Produces:

```ts
// @/renderer/desktop/playerConnection
export type PlayerConnection =
  | { status: 'waiting' }
  | { status: 'native'; player: NativePlayer }
  | { status: 'unavailable'; message: string }
export type PlayerConnections = { read: () => PlayerConnection; subscribe: (listener: () => void) => () => void }
export type RendererPort = Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'addEventListener'>
export const REPLY_TIMEOUT_MS = 10_000
export const nativePlayerOver = ({ port, timeoutMs }: { port: RendererPort; timeoutMs: number }): NativePlayer & { close: () => void }
export const listenForPlayer = ({ target, origin }: { target: Pick<Window, 'addEventListener'>; origin: string }): PlayerConnections
export const usePlayerConnection = (): PlayerConnection
// @/renderer/PlayPage/playerServices
export const ENGINE_NOTES = {
  native: 'raven player could not play this video.',
  fallback: "raven player's video engine did not start, and this video needs it.",
} as const
export const OUTPUT_KEY = ['desktop', 'output'] as const
export const servicesFor = ({ file, client, menu, engine, isVolumeFixed }: {
  file: LocalFile; client: DesktopClient; menu: MenuHub; engine: 'native' | 'html'; isVolumeFixed: boolean
}): PlayerServices
```

Behaviour:
- **`nativePlayerOver`**: `send` posts `{ id, command }` with increasing ids and resolves on `{ id, ok: true }`, rejects with `Error(message)` on `ok: false` and with `Error('raven player did not answer.')` after `timeoutMs`; messages are narrowed with `isPlayerReply` then `isPlayerEvent`, anything else dropped with `console.warn`; `subscribe` adds a listener; `close` rejects what is pending and closes the port.
- **`listenForPlayer`**: listens for `message` events whose `origin` is `origin` and whose `data` passes `isPlayerPortMessage`; `native` with exactly one port becomes `{ status: 'native', player: nativePlayerOver(...) }` (the previous player is closed), `unavailable` becomes that; starts `waiting`. `DesktopProvider` and `useDesktop` carry `player: PlayerConnections`; `usePlayerConnection` reads it through `useSyncExternalStore`. `main.tsx` calls `listenForPlayer({ target: window, origin: APP_ORIGIN })` before rendering. `renderDesktop` takes an optional `player` (default: a fixed `unavailable` store, so P4's tests keep the html engine).
- **`servicesFor`** adds `trackPicks: { start: file.tracks, save: (choice) => send saveTracks }`, `chrome: { shown: (isShown) => send { type: 'windowButtons', isVisible: isShown } }`, `isVolumeFixed`, `unplayableNote: ENGINE_NOTES[engine === 'native' ? 'native' : 'fallback']`; `playerActionFor('stats')` becomes `{ type: 'toggleStats' }`. Every send handles its promise.
- **`PlayPage`**: alongside `describeFile`, `useQuery({ queryKey: OUTPUT_KEY, queryFn: readOutput, staleTime: Infinity })` (a refused reply counts as not fixed); `isVolumeFixed` is `output.profile === 'passthrough' && output.passthrough.length > 0`. While the connection is `waiting`, the waiting view. `native`: `<Player engine={{ kind: 'native', player, source: { kind: 'file', fileId } }} />`; `unavailable`: today's html engine over `fileUrlFor(fileId)`. On unmount it sends `windowButtons` `true`.

- [ ] **Step 1: Write the failing tests.**
  - `playerConnection.test.ts` (a fake port with `emit(data)` and recorded posts): `send({ type: 'play' })` posts `{ id: 1, command: { type: 'play' } }` and resolves on `{ id: 1, ok: true }`; `ok: false` rejects with its message; no reply rejects after `timeoutMs` (fake timers); an event `{ type: 'time', time: 3 }` reaches subscribers and `{ type: 'time', time: 'x' }` does not; `close` rejects pending. `listenForPlayer`: a `MessageEvent` from another origin is ignored; a valid native message with one port moves to `native`; a second one closes the first port; an unavailable message moves to `unavailable` with its text.
  - `playerServices.test.ts`: `servicesFor` with `file.tracks { audio: 1, subtitle: null }` gives `trackPicks.start` that value; `trackPicks.save({ audio: 0, subtitle: 'embedded-0' })` sends `{ type: 'saveTracks', fileId, audio: 0, subtitle: 'embedded-0' }`; `chrome.shown(false)` sends `{ type: 'windowButtons', isVisible: false }`; `unplayableNote` per engine; `playerActionFor('stats')` is `{ type: 'toggleStats' }`.
  - `PlayPage.test.tsx`: with a `native` connection over a fake player, no `video` element renders and the fake player received `load` with `{ kind: 'file', fileId: A }`; with `waiting`, the busy view; with `unavailable`, the `video` element's `src` is `raven-file://A` (P4's tests unchanged); a `passthrough` output disables the Volume slider; leaving to Home sends `windowButtons` `true`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: play local files through the native engine with the html fallback`.

---

### Task 11: "This computer" in Settings

**Files:**
- Create: `apps/raven/desktop/src/renderer/SettingsPage/ThisComputer.tsx`, `ThisComputer.module.scss`, `ThisComputer.test.tsx`
- Modify: `apps/raven/desktop/src/renderer/SettingsPage/SettingsPage.tsx`

**Interfaces:**
- Consumes: `OUTPUT_KEY` (Task 10); `readOutput`/`writeOutput` (Task 2); `OutputSettings`, `AudioProfile` from `@raven/core`.
- Produces: `ThisComputer` (a section), rendered in `SettingsPage` above Recents.

Behaviour and copy (spec "Screens" and "Audio"):
- `<section aria-labelledby="computer-title">` with `<h2 id="computer-title">This computer</h2>` and `<p>How raven player sends sound from this Mac.</p>`.
- `<fieldset>` `<legend>Sound output</legend>` with three radios: `pcm` "Speakers or TV (PCM, up to 7.1)", `passthrough` "Receiver passthrough", `headphones` "Headphones".
- With `passthrough`: a `<fieldset>` `<legend>Formats your receiver decodes</legend>` with checkboxes "Dolby Digital (AC3)" (`ac3`) and "DTS" (`dts`), and `<p>macOS passes Dolby Digital and DTS core to the receiver; TrueHD, DTS-HD MA and E-AC3 play as PCM. Volume is set on your receiver.</p>`.
- With `headphones`: a checkbox "Spatial audio (AirPods)" (`spatial`).
- `<label>` "Output device" around a `<select>`: "System default" (`auto`), then each device from the reply except the one named `auto`, by `description`.
- Without `isEngineReady`: `<p>raven player's video engine did not start, so sound settings wait until it does.</p>`.
- Each change sends `writeOutput` with the whole settings object, invalidates `OUTPUT_KEY`, and puts `Sound output saved.` (or a refusal's message) in an always-mounted `<output>`.
- Styles: a grid with `gap`, tokens only, `:focus-visible` with `--focus-ring`, works at 320px.

- [ ] **Step 1: Write the failing tests** (fake client answering `readOutput` with `DEFAULT_OUTPUT_SETTINGS`, devices `[{ name: 'auto', description: 'Autoselect device' }, { name: 'coreaudio/Den', description: 'Den receiver' }]`, `isEngineReady: true`): "Speakers or TV (PCM, up to 7.1)" is checked; the device select lists `System default` and `Den receiver` only; choosing "Receiver passthrough" sends `writeOutput` with `profile: 'passthrough'` and shows the format checkboxes with AC3 and DTS checked; unchecking DTS sends `passthrough: ['ac3']`; "Headphones" shows "Spatial audio (AirPods)", which sends `spatial: true`; choosing `Den receiver` sends `device: 'coreaudio/Den'`; `Sound output saved.` shows; with `isEngineReady: false` the waiting note shows.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: choose how raven player sends sound in This computer`.

---

### Task 12: e2e for native playback

**Files:**
- Modify: `apps/raven/desktop/e2e/harness.ts`, `e2e/player.e2e.ts`, `e2e/launch.e2e.ts` (mark reading only)
- Create: `apps/raven/desktop/e2e/native.e2e.ts`, `e2e/output.e2e.ts`

**Interfaces:**
- Consumes: `RAVEN_DESKTOP_MPV` (Task 9), the stdout marks (Task 9), `makeClips`, `makeTrackClip` (Task 8).
- Produces (`@/e2e/harness`): `launchApp({ userData, mpv = 'headless' }: { userData: string; mpv?: 'headless' | 'off' })` and `withApp` passing it through, setting `RAVEN_DESKTOP_MPV`; the P4 launch mark reader generalised to `markWithin({ launched, name, ms }): Promise<number>` over every `raven-<name> <n>` line (`launch-ms`, `first-frame-ms`, `loop-lag-p99-ms`), with `launchMarkWithin` kept as a wrapper.

- [ ] **Step 1: The html fallback.** `player.e2e.ts` launches with `mpv: 'off'` and its describe reads `playing a local file through the web engine fallback`; its assertions are unchanged (this is the spec's "with libmpv removed, plays M1 through the web engine").
- [ ] **Step 2: `native.e2e.ts`**, a `test.describe.serial` with one userData, the two MP4 clips and the track clip, headless mpv. Reading the clock: wake the controls with `page.mouse.move`, then the `slider`'s `aria-valuenow`.
  - "plays natively, pauses, seeks and resumes after a relaunch": `openFile(first)`; heading `Clip 01`; `page.locator('video')` has count 0; a button named `Pause (k)` shows; the clock moves more than a second; `k` shows `Play (k)`; `5` puts the clock within 1 of 15; `watchedPercent` reaches 50; the `first-frame-ms` mark arrives; relaunch and reopen: `Resumed at 0:15`.
  - "keeps the main process responsive while playing": after 6 s of play, `markWithin({ name: 'loop-lag-p99-ms' })` is under 40 (twice the 20 ms budget).
  - "plays the next video in the folder when one ends": open `first`, press `End`: heading `Clip 02 Été` within 15 s.
  - "switches audio and remembers the pick": open the track clip; the `Settings` button opens the menu with radios `English` and `French` under Audio; choosing `French` checks it; relaunch and reopen: `French` is checked.
  - "offers video info": with a clip playing, `?` lists `Video info`; pressing `i` leaves no notice in `role="status"` and the clip still plays.
- [ ] **Step 3: `output.e2e.ts`**: Settings shows "This computer"; choosing "Headphones" shows `Sound output saved.`; after a relaunch Headphones is still checked; choosing "Receiver passthrough", then opening `first`: the `Volume` slider is disabled.
- [ ] **Step 4: Verify on macOS.** `bunx nx run @raven/desktop:e2e` passes locally (P4's 12 plus 6 new) and `bunx nx run-many -t typecheck lint:ts format:check -p @raven/desktop` passes.
- [ ] **Step 5: Commit** `MAE: test native playback and output settings end to end`.

---

## Testing for the PR (manual, macOS arm64)

What tests prove: the protocol and every guard (core, desktop), the mapping (`fromPlayerEvent`, `tracksFromMpv`, output and display options), the service's rules against a fake mpv and against real headless libmpv (load, tracks, picks, seeks, open errors, stats, output, cycles, destroy), the port's allowlist and ordering, the renderer's engine choice and fallback, the quiet chrome, and the app end to end with `vo=null`/`ao=null`, the null output paced like a 60 Hz display (`vo-null-fps`) so the clock runs in real time: play, pause, seek and volume through the chrome, resuming after a relaunch, the loop lag mark, next in folder at the end, audio and subtitle picks kept across a relaunch, Video Info, Escape and Back, a reload's fresh port, forged port commands refused with nothing shown, quitting mid-film within a second with no process left, "This computer" across a relaunch with passthrough disabling the volume, and the html fallback with mpv off. What only a person can check: the picture, HDR, frame pacing, audio devices and receivers, the title bar and window behaviour. Run `bunx nx run @raven/desktop:dev -- <file>` (window surface) and record per output (an XDR display, an SDR display, headphones; a receiver if at hand), with Video Info (`i`) open:

- M1 to M15 from the spec's Verification table, opened by Finder's Open With on the dev app (`open -a`), by drop, and from Open Recent: `hwdec-current` is not `no` where the GPU decodes; the first frame within 1 s; a seek inside the cache at most 0.2 s, outside 0.5 s; audio and subtitle switches at most 0.3 s with no reload; PGS (M2, M12), VobSub (M13), DVB (M11), ASS with fonts (M10) and both sidecar encodings (M15) show; M4 has no green or purple cast; M5 plays its base layer.
- The display gate from Risks: on the XDR display `video-target-params/gamma` is `pq` for M2 and highlights exceed the UI's white, and 0 drops over 10 minutes of M2 and M14 at 120 Hz; if either fails, P5 ships with `target-colorspace-hint=no` and the gap is written into the spec.
- On an SDR display the hint reads `no` and M2 tone maps; moving the window between displays and unplugging the external one mid-film updates `display-fps-override`.
- Each output profile: PCM 7.1 on M2's TrueHD; passthrough with AC3 and DTS gives `audio-out-params/format` starting `spdif-` and the receiver names the format, the volume controls disabled; headphones downmix, and spatial audio on AirPods.
- The title bar, drag, fullscreen, detached DevTools, display sleep and quit checks from Task 9's smoke; sleep and wake mid-film.
- Quitting mid-film and reopening resumes locally; reaching the end clears it and plays the next in the folder.
- With `libs/raven/mpv/resources/darwin-arm64` renamed away: M1 plays through the html engine and M2 shows Unplayable with "raven player's video engine did not start, and this video needs it."; the CI `make` artifact behaves the same until P7 bundles libmpv.

## Self-review notes

- **Spec coverage (P5):** `useNativeEngine`, `NativeStage`, `fromPlayerEvent` (Tasks 3, 4); the macOS surface, transparent watch route, detached DevTools, `display-fps-override`, EDR hint, `powerSaveBlocker`, fullscreen following bounds (Tasks 5, 9); the bridge, one port per window, allowlist, events (Tasks 6, 7, 9, 10); `tracksFromMpv` (Task 5); title bar behaviour and drag region (Tasks 3, 9, 10); next in folder on the native path (Tasks 4, 12, P4's `grantNext`); "This computer" and `OutputSettings` (Tasks 1, 5, 6, 11); stats overlay and Video Info (Tasks 2, 3, 6, 10); track picks written (Tasks 2, 4, 10); the html fallback and its message (Tasks 5, 9, 10, 12); the quiet page (Tasks 3, 6); `sub-scale` from the caption size (Tasks 4, 6); quitting stops mpv first (Task 9); headless libmpv tests and the e2e (Tasks 8, 12); the first-frame and event-loop marks (Tasks 9, 12).
- **Types across tasks:** `OutputSettings`, `DEFAULT_OUTPUT_SETTINGS` (1) in 2, 5, 6, 11; `JsonStore`, `ConfigStore`, `pickOutput` (1) in 2, 9; `TrackChoice`, `AudioDevice`, `PlayerConnectionStatus`, `isPlayerPortMessage`, `PLAYER_PORT_CHANNEL` (2) in 7, 9, 10, 11; `fromPlayerEvent`, `Ranges`, the optional services (3) in 4, 10; `NativePlayer`, `Engine` (4) in 10; `MpvOption`, `outputOptions`, `displayOptions`, `openEngine`, `OpenedEngine`, `addonPathFor`, `engineModeFrom`, `createSleepGuard` (5) in 6, 7, 8, 9; `PlayerService`, `resolveSourceWith`, `PLAYER_MESSAGES` (6) in 7, 8, 9; `PortLike`, `connectPort`, `createConnector`, `forwardPlayerPort` (7) in 9; `makeTrackClip` (8) in 12; `OUTPUT_KEY`, `servicesFor` (10) in 11.
