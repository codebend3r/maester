# raven desktop shell (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship step P4 of the desktop spec: the player protocol in `@raven/core`, the Node tooling presets, and a new Electron app `@raven/desktop` that opens local videos (open dialog, drop, Finder `open-file`, Open Recent, next in folder), remembers recents, resume positions and window bounds, and plays them through the shared `@raven/ui` Player's html engine over a `raven-file://<fileId>` range scheme, behind the spec's security baseline, with a Playwright `_electron` e2e suite run by the macOS CI job. M1 plays through the html engine.

**Architecture:** The main process owns every path: `grant(path)` turns a user-chosen file into an opaque `fileId`, and the renderer (a sandboxed page on `app://raven`, memory router, Home / Play / Settings) only ever holds ids. Main-process modules are pure or take their Electron and file system pieces as arguments, so `bun test` covers them without Electron; `src/main/main.ts` alone wires them to Electron and is covered by e2e. The renderer reaches main through one preload-built invoke envelope and one push channel, both narrowed by guards in `src/shared/protocol.ts`.

**Tech Stack:** Electron 44.7.0, Electron Forge 8.0.1 (`@electron-forge/plugin-fuses`, `maker-zip`), `@electron/fuses` 2.1.3, React 19.3 + React Router 7 memory router + TanStack Query 5, Vite 8, SCSS modules, `bun test` + happy-dom, `@playwright/test` 1.64.1 `_electron`, Nx 23 over Bun 1.4.2 workspaces (isolated linker).

**Spec:** `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (P4 under "Order of work > Phase 1"; sections 4, 6, 7, 8, 9, "Verification" and "Spike outcomes > P0").

## Rulings (where the brief, the spec and the repo disagree)

1. **Spellcheck is `typos`, not cspell.** The repo runs `uvx typos@1.51.1` over `_typos.toml`. typos flags known misspellings only, so new vocabulary needs no list. A real false positive goes under `[default.extend-words]` in `_typos.toml` as `word = "word"`.
2. **Electron 44.7.0, not 44.8.0.** 44.8.0 was published today (2026-10-16); 44.7.0 is the version P0 ran and checksum-verified. Forge 8.0.1 (2026-09-29), `@electron/fuses` 2.1.3 (the plugin's peer), `@playwright/test` 1.64.1 (P0's `playwright-core` version), `@types/node` 24.19.0 (Electron 44 is Node 24, matching `@raven/mpv`). All exact.
3. **`build:main` bundles with `bun build`, not `tsc` then `tsc-alias`.** The repo uses Bun's isolated linker (`node_modules/.bun` store, per-project symlinks); packaging those symlinks is exactly what spec section 4 "Build and bundling" avoids for the hosts, and P0 bundled main and preload the same way. One ESM file with `electron` external needs no `node_modules` in the asar and no alias rewrite. `typecheck:main` still checks the sources with `tsgo`.
4. **Three tsconfigs under a solution `tsconfig.json`**, not two: `tsconfig.main.json` (node preset, no DOM), `tsconfig.preload.json` (node preset plus DOM, for the sandboxed preload and the Playwright tests whose page callbacks run in the window), `tsconfig.renderer.json` (react preset). The solution `tsconfig.json` also carries `paths`, because `bun build` and `bun test` read `@/` from the nearest `tsconfig.json`. Verified: `tsgo --noEmit -p` works on a solution file whose references are not `composite`.
5. **IPC shape.** Spec: "one `invoke` channel for requests and the player's MessagePort". P4 has no MessagePort (P5). It has one invoke channel, `raven:request`, whose envelope the preload builds (`{ kind: 'page', request }` or `{ kind: 'drop', paths }`), so the page can never send a path; and one push channel, `raven:event`, for what main starts (menu actions, `open-file`, notices).
6. **`build:main` entry has no `__dirname`.** Main finds its files through `app.getAppPath()` (spec section 4).
7. **Three additive `@raven/ui` seams in P4** (Task 3), none visible on the web: `ProgressSink.duration?` (recents need the share watched and the html engine is the only one that knows the length), `PlayerServices.hostActions?` (the Playback menu "sends its `PlayerAction` to the page"), and a `--titlebar-inset` token defaulting to `0px` (spec "Window" puts the traffic lights over the player header, and `hiddenInset` is P4's window; the lights' show and hide with the controls stays in P5).
8. **Packaging in P4 is the zip maker only.** The dmg maker joins with the release in P7 (section 7). The macOS job makes the zip and uploads it, per "Rollout" step 2 ("P3 to P6 produce an unsigned app on every PR"); this supersedes the P3 workflow comment "P7 adds app packaging".
9. **`raven://` in P4** is registered in Info.plist (Forge `protocols`) and caught by `open-url` (queued before ready), answered with a notice. Parsing and playing links is P6. Never `app.setAsDefaultProtocolClient` (it would register the dev Electron binary).
10. **Every new desktop script is in `nx.includedScripts`,** as the spec and the brief say, although `@raven/web` and `@raven/ui` leave their sub-steps out.
11. **`forge.config.ts` imports `./src/build/forgeOptions` relatively.** Forge 8 loads the config with jiti, which does not read tsconfig `paths`. Its `.oxlintrc.json` override turns `no-restricted-imports` off for that one file, with the reason in a comment; the tested logic lives in `src/build/forgeOptions.ts`.
12. **The e2e clip** is made by ffmpeg with `h264_videotoolbox -allow_sw 1` (H.264 in MP4, which Chromium decodes), from `RAVEN_E2E_FFMPEG` or `ffmpeg` on `PATH`. CI points it at `@raven/mpv`'s source-built ffmpeg (`--enable-videotoolbox`, already in the job's cache).
13. **`OutputSettings` / `isOutputSettings`** (section 6) is "This computer", so it lands in P5 with its settings screen.
14. **Track picks:** the stored shape and its reducer land in P4 (section 4 table); nothing writes them until P5, since the html engine reports no tracks for a local file.
15. **`electron` joins the root `trustedDependencies`** so its postinstall downloads the binary under `bun install`; the Ubuntu checks set `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, since nothing there launches Electron. Docker already installs with `--ignore-scripts`.

## Deferred, so nothing is lost

| Spec item | Lands in |
| --- | --- |
| `useNativeEngine`, `NativeStage`, `fromPlayerEvent`, the macOS surface, the MessagePort bridge, `src/main/player/`, `tracksFromMpv`, `@raven/mpv` as a dependency, mpv test hooks (`vo=null`), transparent watch route, detached DevTools, `powerSaveBlocker`, `display-fps-override`, EDR hint | P5 |
| Title bar behaviour: `setWindowButtonVisibility` with the controls, a drag region over the player | P5 |
| "This computer" (output profile, device, passthrough), `OutputSettings` and `isOutputSettings` in core, its Settings section | P5 |
| Stats overlay and the Playback menu's Video Info (`stats`) | P5 |
| Writing track picks (store API lands in P4) | P5 |
| `servers.ts`, `desktop-config.json`, `readPlayLink` / `PlayRequest`, playing `raven://` links, the trust prompt, `persist:server:<id>` sessions, `bridgedFetch` and the eight-call allowlist, `UnlockDialog` into `@raven/ui`, progress and history to the server, up next from a link, the browser fallback ("Open in browser" escape) | P6 |
| File menu Open Link (Command L); Settings' servers section; server recents (`kind: 'server'`); e2e "a request off the allowlist is refused" for server calls and "a play link to an unknown server shows the prompt" | P6 |
| The web setting "Open videos in raven player" and its two actions | P6 |
| libmpv bundled and signed in the app, the dmg maker, `desktop-release.yml` | P7 |
| `updates.ts`, Check for Updates menu item, the update switch in Settings | P7 |
| `crashReporter`, the rotating log (launch marks go there; P4 prints them to stdout), Help's Show Logs, Show Crash Reports, Copy Diagnostics | P7 |
| Memory and CPU budgets (section 8 rows other than launch) | P7 |
| Docs: root `CLAUDE.md` project table and CSS section, `apps/raven/CLAUDE.md`, `apps/raven/README.md`, the spec's outcomes | P7 |

## Global Constraints

Binding for every task. From the root `CLAUDE.md` unless marked.

- Run tasks through Nx from the repo root: `bunx nx run @raven/desktop:test`, `bunx nx run-many -t typecheck lint:ts format:check test -p <projects>`.
- TypeScript only: no `.js`, `.jsx`, `.mjs` or `.cjs` source or config file anywhere. Build output in `dist/` is gitignored and exempt.
- A `package.json` script runs one command. Steps become scripts of their own, chained with `bun run --sequential a b` (or `--parallel`), never `&&`, `||` or `;`. Every desktop script goes in `nx.includedScripts`.
- Every import of a project's own modules goes through its `@/` alias and names no extension: `@/main/grants`, never `./grants` or `@/main/grants.js`. Non-TypeScript assets keep their extension (`@/renderer/HomePage/HomePage.module.scss`). Only exception: `forge.config.ts` (Ruling 11).
- No em dashes or en dashes anywhere, including comments, UI copy and test names.
- Type guards wherever possible; never `any`; never cast (`as const` is not a cast); `unknown` when a type cannot be inferred; discriminated unions switched on their discriminant with a `never` check in `default`; no enums (a library's own enum, such as `FuseV1Options`, may be used); `type`, never `interface` (except declaration merging in a `.d.ts`); `as const satisfies T`; derive types (`Infer`, `ReturnType`, indexed access); no non-null assertion outside test files; never `@ts-ignore`.
- Validate untrusted data at the boundary with a guard: IPC payloads in main and in the renderer, `location.state`, file contents read from disk. Code past the boundary trusts the narrowed type.
- No `for`, `for...of` or `for...in`; array methods, `reduce` to accumulate, recursion for sequential async attempts. `!!value` for booleans. `?.` always paired with `??`. One object parameter, never several positional ones (callbacks whose shape a library fixes are exempt). JSX `&&`, not a ternary with `null`. Guard clauses, no `else` after return. `const` by default. Never mutate inputs: spread, `toSorted`, `toReversed`, `with`. `??` for defaults. No floating promises. Throw only `Error`s. Named exports only (config files a tool reads by default export are exempt in `.oxlintrc.json`). Booleans named `is`/`has`/`should`/`can`. Comments only for a non-obvious why.
- CSS (desktop renderer is a raven web app for these rules): SCSS modules imported through `@/`; layout is CSS grid with `gap` and container padding, no flex, no margins for spacing; named `grid-template-areas` in fixed layouts, overlays share a named area; semantic elements first, a `div` only with a class; colors, fonts, sizes, spacing, radii and focus ring from raven's tokens in `libs/raven/ui/src/styles/globals.scss`; desktop-first `@media (max-width: 48rem)` (reuse `30rem`, `40rem`, `48rem`, `64rem`); works at 320px; every animation or transition inside `@media (prefers-reduced-motion: no-preference)`; no `:global()`; a label on every control and a visible `:focus-visible` using `--focus-ring`.
- `libs/raven/core` stays platform-agnostic: no DOM, no Node APIs.
- Main-process modules other than `src/main/main.ts` import from `electron` with `import type` only, and take Electron's pieces (and the file system) as arguments, so `bun test` runs them without Electron (spec section 9).
- Identity (spec): product name `raven player`; bundle id `io.github.codebend3r.raven`; `userData` pinned to `join(app.getPath('appData'), 'raven')`, set before `requestSingleInstanceLock`.
- Renderer origin `app://raven`; CSP, sent on every `app://` response, exactly: `default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- Window: `contextIsolation: true`, `sandbox: true` plus `app.enableSandbox()`, `nodeIntegration: false`, `webviewTag: false`; `will-navigate` refuses anything off `app://raven`; `setWindowOpenHandler` denies every window and sends http and https links to `shell.openExternal`; every permission request and check denied except `fullscreen`; IPC accepted only from a sender frame on `app://raven`.
- Fuses: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- Test hooks (`RAVEN_DESKTOP_USER_DATA`) are read only when `app.isPackaged` is false.
- Pinned exact versions, matching the repo where a package already appears: React 19.3.0, React DOM 19.3.0, react-router-dom 7.18.4, @tanstack/react-query 5.103.1, zustand 5.0.15, vite 8.3.0, @vitejs/plugin-react 6.1.1, sass 1.104.1, stylelint 17.15.0, stylelint-config-recommended-scss 17.0.1, typescript 7.0.2, @typescript/native-preview 7.0.0-dev.20260707.2, oxlint 1.83.0, oxfmt 0.68.0, @types/bun 1.4.2, @types/react 19.3.0, @types/react-dom 19.3.0, happy-dom 20.14.5, @happy-dom/global-registrator 20.14.5, @testing-library/react 16.3.3, @testing-library/user-event 14.6.7, @testing-library/jest-dom 7.0.1, @fontsource/young-serif 5.3.0, @fontsource-variable/instrument-sans 5.3.0, plus Ruling 2's versions.
- Commits follow the `commit-format` skill: `MAE:` subject, short bullet body, no agent attribution. Never `--no-verify`.
- e2e is not part of `verify`; it runs on the macOS `🖥️ Desktop` job.

## Review Focus

The input classes most likely to bite a person using this build, most likely first. Each has its test in the owning task.

1. **A folder full of decoys.** macOS writes AppleDouble `._Name.mkv` sidecars on exFAT and SMB volumes, and season folders hold `.nfo`, `.srt` and images. Next in folder must skip dotfiles and non-videos and still order `Episode 2` before `Episode 10`. (Task 5: `followingVideos` tests.)
2. **Symlinks.** A symlink to a video should play; a symlink named `trailer.mp4` pointing at a non-video (say `~/.ssh/id_rsa`) must not be granted, because folder siblings are granted automatically. (Task 5: `grant` tests on the real path's name.)
3. **A damaged or foreign state file, and quitting mid-write.** Truncated JSON, a valid JSON of the wrong shape, or a future `version` must be kept as `player-state.json.corrupt-<time>` and the app must start empty; a quit during a write must leave the old file intact (temp file plus rename) and never hang the quit. (Task 4: store tests; Task 10: quit gate tests.)
4. **A file replaced on disk since its position was saved** (re-encoded, re-downloaded under the same name): it must start at 0, not seek into a different film. (Task 4: `resumeFor` size and mtime tests.)
5. **Opens that arrive early, in bursts, or in bulk.** Finder sends one `open-file` per file, possibly before `ready`, and a user can drop 5,000 files. They must be batched in order (first plays, rest queue), held until the renderer says it is ready, and capped at 100 queued. A second launch with a file must reach the running instance. (Task 10: batch and argv tests; Task 7: cap test.)

Also pinned by tests: unicode and spaces in names (Task 11 e2e uses `Clip 02 Été.mp4`), Range header edge cases and encoded path traversal (Task 6), a dropped `File` the page made itself (Tasks 10 and 11).

---

### Task 1: Player protocol in `@raven/core`

**Files:**
- Create: `libs/raven/core/src/player.ts`
- Create: `libs/raven/core/src/player.test.ts`
- Modify: `libs/raven/core/src/index.ts` (add `export * from '@/player'`)

**Interfaces:**
- Consumes: `isMediaTracks` from `@/contract`; `Infer`, `isBoolean`, `isNumber`, `isString`, `listOf`, `nullable`, `object`, `oneOf`, `union` from `@/schema`.
- Produces (exported from `@raven/core`): `isPlayerSource`, `PlayerSource`, `isPlayerCommand`, `PlayerCommand`, `isPlayerErrorReason`, `isPlayerEvent`, `PlayerEvent`, `isPlayerRequest`, `isPlayerReply`. P4 uses none of them at runtime; P5's bridge does.

- [ ] **Step 1: Write the failing tests** in `player.test.ts`, in `contract.test.ts`'s style (`describe` per guard, one valid value per variant accepted, each malformed field rejected). Valid fixtures:

```ts
const tracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }
const valid = {
  sources: [{ kind: 'server', serverId: 'vhagar', mediaId: 42 }, { kind: 'file', fileId: 'f1' }],
  commands: [
    { type: 'load', source: { kind: 'file', fileId: 'f1' }, start: 0, audio: null, subtitle: null },
    { type: 'play' }, { type: 'pause' }, { type: 'seek', time: 12.5 },
    { type: 'audio', index: 1 }, { type: 'subtitle', id: 'embedded-0' },
    { type: 'volume', volume: 0.5, muted: false }, { type: 'speed', rate: 1.5 },
    { type: 'subtitleScale', scale: 1.2 }, { type: 'stats' }, { type: 'stop' },
  ],
  events: [
    { type: 'time', time: 3 }, { type: 'buffered', ranges: [{ start: 0, end: 10 }] },
    { type: 'paused', paused: true }, { type: 'waiting', waiting: false },
    { type: 'duration', duration: null }, { type: 'rate', rate: 1 },
    { type: 'tracks', tracks }, { type: 'ended' },
    { type: 'error', reason: 'decode', message: 'bad frame' },
  ],
}
```

Assertions (each its own `it`):
  - every value in `valid.sources`, `valid.commands`, `valid.events` passes its guard (`it.each`);
  - `isPlayerSource` rejects `{ kind: 'path', path: '/etc/hosts' }`, `{ kind: 'server', serverId: 'v', mediaId: '42' }`, `{ kind: 'file' }`;
  - `isPlayerCommand` rejects `{ type: 'run', args: [] }`, `{ type: 'loadfile', url: 'https://x' }`, `load` with `start: '0'`, `load` with `audio: '1'`, `load` with `subtitle: 3`, `load` with `source: { kind: 'url', url: 'x' }`, `seek` with `time: Number.NaN`, `seek` with `time: Infinity`, `volume` with `muted: 'no'`;
  - `isPlayerEvent` rejects `{ type: 'error', reason: 'crash', message: 'x' }`, `{ type: 'tracks', tracks: { audio: 'x' } }`, `{ type: 'buffered', ranges: [{ start: 0 }] }`;
  - `isPlayerErrorReason.values` equals `['open', 'decode', 'network', 'locked', 'engine']`;
  - `isPlayerRequest` accepts `{ id: 1, command: { type: 'play' } }`, rejects `{ id: '1', command: { type: 'play' } }` and `{ id: 1, command: { type: 'nope' } }`;
  - `isPlayerReply` accepts `{ id: 1, ok: true }` and `{ id: 1, ok: false, message: 'x' }`, rejects `{ id: 1, ok: false }` and `{ id: 1, ok: 'yes' }`.

- [ ] **Step 2: Run to verify they fail.** `bunx nx run @raven/core:test` fails: `@/player` does not exist.

- [ ] **Step 3: Implement `player.ts`** exactly as the code block in spec section 6 "Player protocol" (lines 668 to 730), including `export type PlayerSource`, `PlayerCommand`, `PlayerEvent` read off the guards with `Infer`, and the doc comments there. Add the `index.ts` re-export.

- [ ] **Step 4: Verify.** `bunx nx run-many -t typecheck lint:ts format:check test -p @raven/core` passes.

- [ ] **Step 5: Commit** `MAE: add the player protocol guards to core`.

---

### Task 2: Node presets and the `@raven/desktop` project with its shared protocol

**Files:**
- Create: `tooling/tsconfig/node.json`, `tooling/oxlint/node.json`
- Modify: `libs/raven/mpv/tsconfig.json` (extend `../../../tooling/tsconfig/node.json`, keep `paths`, `types: ["bun-types", "node"]`, `include`), `libs/raven/mpv/.oxlintrc.json` (extend `../../../tooling/oxlint/node.json`, drop its own `env`)
- Create: `apps/raven/desktop/package.json`, `tsconfig.json`, `tsconfig.main.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`
- Create: `apps/raven/desktop/src/shared/protocol.ts`, `src/shared/protocol.test.ts`, `src/shared/bridge.ts`
- Modify: root `package.json` (`trustedDependencies` gains `"electron"`), `bun.lock` (by `bun install`)

**Interfaces:**
- Consumes: `@raven/core` combinators (`object`, `oneOf`, `union`, `listOf`, `nullable`, `isString`, `isNumber`, `Infer`).
- Produces (`@/shared/protocol`):
  - constants `APP_ORIGIN = 'app://raven'`, `APP_SCHEME = 'app'`, `APP_HOST = 'raven'`, `FILE_SCHEME = 'raven-file'`, `REQUEST_CHANNEL = 'raven:request'`, `EVENT_CHANNEL = 'raven:event'`, `MAX_QUEUE = 100`;
  - `isOpaqueId(value: unknown): value is string` (a lowercase v4 UUID, what `crypto.randomUUID()` returns; lowercase matters because a standard scheme lowercases its host);
  - `fileUrlFor(fileId: string): string` returning `` `raven-file://${fileId}` ``;
  - guards and their `Infer` types: `isPlayTarget`/`PlayTarget`, `isLocalFile`/`LocalFile`, `isRecentView`/`RecentView`, `isMenuPlayerAction`/`MenuPlayerAction`, `isDesktopRequest`/`DesktopRequest`, `isDesktopReply`/`DesktopReply`, `isDesktopEvent`/`DesktopEvent`, `isInvokeEnvelope`/`InvokeEnvelope`.
- Produces (`@/shared/bridge`): `type RavenDesktopBridge = { request: (request: unknown) => Promise<unknown>; dropFiles: (files: readonly File[]) => Promise<unknown>; subscribe: (listener: (event: unknown) => void) => () => void }` (what the preload exposes as `window.ravenDesktop`).

Guard shapes (`fileId`, `recentId` and queue entries are `isOpaqueId`):

```ts
isPlayTarget = object({ fileId, queue: listOf(isOpaqueId) })
isLocalFile = object({
  fileId, label: isString, folder: isString, resumeAt: isNumber,
  next: nullable(object({ fileId, label: isString, queue: listOf(isOpaqueId) })),
})
isRecentView = object({ recentId, label: isString, from: isString, watched: nullable(isNumber) })
isMenuPlayerAction = oneOf(['togglePlay', 'skipBack', 'skipForward', 'next', 'showShortcuts'])
isDesktopRequest = union(
  object({ type: oneOf(['ready']) }),
  object({ type: oneOf(['openDialog']) }),
  object({ type: oneOf(['describeFile']), fileId, queue: listOf(isOpaqueId) }),
  object({ type: oneOf(['savePosition']), fileId, position: isNumber, duration: nullable(isNumber) }),
  object({ type: oneOf(['listRecents']) }),
  object({ type: oneOf(['openRecent']), recentId }),
  object({ type: oneOf(['removeRecent']), recentId }),
  object({ type: oneOf(['clearRecents']) }),
)
isDesktopReply = union(
  object({ type: oneOf(['play']), target: isPlayTarget }),
  object({ type: oneOf(['file']), file: isLocalFile }),
  object({ type: oneOf(['recents']), recents: listOf(isRecentView) }),
  object({ type: oneOf(['done']) }),
  object({ type: oneOf(['refused']), message: isString }),
)
isDesktopEvent = union(
  object({ type: oneOf(['play']), target: isPlayTarget }),
  object({ type: oneOf(['player']), action: isMenuPlayerAction }),
  object({ type: oneOf(['navigate']), to: oneOf(['home', 'settings']) }),
  object({ type: oneOf(['notice']), message: isString }),
  object({ type: oneOf(['recentsChanged']) }),
)
isInvokeEnvelope = union(
  object({ kind: oneOf(['page']), request: isDesktopRequest }),
  object({ kind: oneOf(['drop']), paths: listOf(isString) }),
)
```

- [ ] **Step 1: Presets.** `tooling/tsconfig/node.json`: comment `// A Node or Electron main process: Node's types, no decorators.`, extends `../../tsconfig.base.json`, `compilerOptions.types: ["node"]`. `tooling/oxlint/node.json`: `$schema` as the others, extends `./base.json`, `env: { "node": true }`, nothing else. Point `@raven/mpv` at both. Run `bunx nx run-many -t typecheck lint:ts -p @raven/mpv`: passes unchanged.

- [ ] **Step 2: Project files.**
  - `package.json`: `"name": "@raven/desktop"`, `"version": "0.5.4"` (the workspace's shared version; `scripts/bump_version.sh` rewrites it), `"private": true`, `"type": "module"`, `"productName": "raven player"`, `"description": "raven player: local videos under raven's own controls"`, `"main": "dist/main/main.js"`. `dependencies`: `@raven/core` and `@raven/ui` (`workspace:*`), react, react-dom, react-router-dom, @tanstack/react-query, zustand, the two @fontsource packages. `devDependencies`: `electron` 44.7.0, `@electron-forge/cli` 8.0.1, `@electron-forge/maker-zip` 8.0.1, `@electron-forge/plugin-fuses` 8.0.1, `@electron-forge/shared-types` 8.0.1, `@electron/fuses` 2.1.3, `@playwright/test` 1.64.1, `@types/node` 24.19.0 and the web app's test, lint and build devDependencies at its versions (Global Constraints list). Electron must be in `devDependencies`: Forge reads it from there. Scripts for this task only: `"typecheck": "tsgo --noEmit -p tsconfig.main.json"`, `"lint:ts": "oxlint"`, `"lint:ts:fix": "oxlint --fix"`, `"format": "oxfmt ."`, `"format:check": "oxfmt --check ."`, `"test": "bun run --sequential test:main"`, `"test:main": "bun test --dots src/main src/shared src/preload src/build"`, `"test:watch": "bun test --dots --watch src/main src/shared"`. `nx`: `projectType: "application"`, `tags: ["scope:desktop", "lang:ts"]`, `includedScripts` listing every script. (`bun test` with path filters runs only files under those folders; ones that do not exist yet match nothing, so `src/shared`'s tests keep it non-empty.)
  - `tsconfig.json`: `{ "files": [], "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "references": [{ "path": "./tsconfig.main.json" }] }` with a comment that Bun reads `paths` from this file. Task 8 appends the `tsconfig.renderer.json` reference and Task 10 the `tsconfig.preload.json` one, each with the file it creates.
  - `tsconfig.main.json`: extends `../../../tooling/tsconfig/node.json`, `paths` as above, `types: ["node", "bun"]`, `include: ["src/main", "src/shared", "src/build", "forge.config.ts"]`.
  - `.oxlintrc.json`: `$schema`, extends `../../../tooling/oxlint/node.json`, `ignorePatterns: ["dist", "out", "test-results"]`, overrides: test files (`src/**/*.test.ts`, `src/**/*.test.tsx`, `src/renderer/test/**`) turn off `typescript/no-non-null-assertion` and `unicorn/consistent-function-scoping`.
  - `.oxfmtrc.json`: identical options to `apps/raven/web/.oxfmtrc.json`, `ignorePatterns: ["dist", "out", "test-results", "bun.lock"]`.
  - `.gitignore`: `/out/`, `/test-results/`, `/playwright-report/`.
  - Root `package.json`: append `"electron"` to `trustedDependencies`.

- [ ] **Step 3: Install.** `bun install` from the root. Expect `bun.lock` to gain the workspace and `apps/raven/desktop/node_modules/electron` to link into `node_modules/.bun`. Check the binary downloaded: `ls apps/raven/desktop/node_modules/electron/dist/Electron.app` exists (on macOS).

- [ ] **Step 4: Write the failing tests** in `src/shared/protocol.test.ts`:
  - `isOpaqueId` accepts `crypto.randomUUID()`; rejects `'ABCDEF00-0000-4000-8000-000000000000'` (uppercase), `'../etc'`, `''`, `42`;
  - `fileUrlFor('0f8f...')` (a fixed UUID) equals `'raven-file://0f8f...'`;
  - one valid value per variant of `isDesktopRequest`, `isDesktopReply`, `isDesktopEvent`, `isInvokeEnvelope` passes;
  - rejected: `describeFile` with `fileId: '/Users/me/film.mkv'`; `savePosition` with `position: '12'`; `savePosition` without `duration`; `navigate` to `'devtools'`; `player` with `action: 'stats'` (P5); envelope `{ kind: 'page', request: { type: 'readFile', path: '/etc/hosts' } }`; envelope `{ kind: 'drop', paths: [1] }`; envelope `{ kind: 'shell', command: 'ls' }`.

- [ ] **Step 5: Run to verify they fail**, then **implement** `protocol.ts` and `bridge.ts` with the shapes above. Run `bunx nx run-many -t typecheck lint:ts format:check test -p @raven/desktop @raven/mpv`: passes.

- [ ] **Step 6: Commit** `MAE: add node presets and the desktop project with its protocol`.

---

### Task 3: `@raven/ui` host seams: duration, host actions, title bar inset

**Files:**
- Modify: `libs/raven/ui/src/components/Player/PlayerServices.tsx`, `useWatchProgress.ts`, `Stage.tsx` (`PlayerChrome`), `Player.module.scss` (`.chrome`)
- Modify: `libs/raven/ui/src/styles/globals.scss` (new token), `libs/raven/ui/src/index.ts`, `libs/raven/ui/README.md`
- Test: `libs/raven/ui/src/components/Player/playerEngine.test.tsx` (add cases)

**Interfaces:**
- Produces (exported from `@raven/ui`):
  - `ProgressSink` gains `duration?: (seconds: number) => void` ("the engine learned how long the video is");
  - `export type HostActions = { subscribe: (listener: (action: PlayerAction) => void) => () => void }`, and `PlayerServices` gains `hostActions?: HostActions`;
  - `export type { PlayerAction } from '@/lib/shortcuts'` and `export type { HostActions }` from the root entry;
  - CSS token `--titlebar-inset` (default `0px`).
- Consumed by: Task 9's `servicesFor` and Task 10's `desktop.scss`.

- [ ] **Step 1: Write the failing tests** in `playerEngine.test.tsx`:
  - `useWatchProgress` "reports the engine's duration to an optional duration sink once known": render the hook with `duration: null`, then rerender with `duration: 120`; `services.progress.duration` called once with `120`; rerender with the same `120`: still once; a services object without `duration` renders without throwing.
  - `PlayerChrome` "acts on actions the host sends": render `PlayerChrome` with the existing fake handle (`actionsFor()`), state paused, and `hostActions` built on a tiny local emitter; emit `{ type: 'togglePlay' }`: `actions.play` called; emit `{ type: 'seekBy', seconds: 10 }`: `actions.seek` called with the time plus 10; unmount: the emitter has no listeners left.

- [ ] **Step 2: Run to verify they fail.** `bunx nx run @raven/ui:test`.

- [ ] **Step 3: Implement.**
  - `useWatchProgress`: a `useEffect` on `[duration, progress]` that calls `progress.duration?.(duration)` when `duration` is a finite number above 0 and differs from the last reported (a ref).
  - `PlayerChrome`: `const onHostAction = useEffectEvent((action: PlayerAction) => { idle.wake(); controls.act(action) })` and `useEffect(() => hostActions?.subscribe(onHostAction) ?? undefined, [hostActions])`, with `hostActions` read from `usePlayerServices()`.
  - `globals.scss`: `--titlebar-inset: 0px;` beside the spacing tokens, commented: a desktop host sets it so the player header clears the window's traffic lights.
  - `.chrome`: top padding becomes `calc(var(--space-3) + var(--titlebar-inset))`, the rest of the shorthand unchanged, so the web renders identically.
  - README "Build and consume" gains one sentence: hosts may pass `progress.duration` and `hostActions`; the web passes neither.

- [ ] **Step 4: Verify.** `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/ui @raven/web` passes, coverage floors included (`@raven/web` proves no visible change: its tests pass untouched).

- [ ] **Step 5: Commit** `MAE: let player hosts learn the duration and send actions`.

---

### Task 4: Player state and its store

**Files:**
- Create: `apps/raven/desktop/src/main/playerState.ts`, `src/main/playerState.test.ts`
- Create: `apps/raven/desktop/src/main/stateStore.ts`, `src/main/stateStore.test.ts`

**Interfaces:**
- Produces (`@/main/playerState`), all pure:
  - constants `RECENTS_CAP = 50`, `RESUME_CAP = 1000`, `TRACKS_CAP = 1000`, `END_MARGIN_S = 10`;
  - guards and types `isRecentEntry` (`object({ kind: oneOf(['file']), path: isString, openedAt: isNumber })`; P6 adds a `server` variant), `isResumeEntry` (`{ path, size, mtimeMs, position, duration: nullable(isNumber), playedAt }`), `isTrackPick` (`{ path, audio: nullable(isNumber), subtitle: nullable(isString), pickedAt }`), `isWindowBounds` (`{ x, y, width, height, displayId }`, all numbers), `isPlayerState` (`object({ version: oneOf([1]), recents: listOf(isRecentEntry), resume: listOf(isResumeEntry), tracks: listOf(isTrackPick), window: nullable(isWindowBounds) })`), and `PlayerState`, `ResumeEntry`, `WindowBounds` via `Infer`;
  - `EMPTY_STATE: PlayerState`;
  - `type FileFacts = { path: string; size: number; mtimeMs: number }`;
  - `addRecent(state, { path, at }): PlayerState`, `removeRecent(state, { path })`, `clearRecents(state)`;
  - `savePosition(state, { file: FileFacts, position: number, duration: number | null, at: number }): PlayerState`;
  - `resumeFor(state, { file: FileFacts }): number`;
  - `watchedShare(state, { path }): number | null`;
  - `setTrackPick(state, { path, audio, subtitle, at })`, `trackPickFor(state, { path }): { audio: number | null; subtitle: string | null } | null`;
  - `setWindowBounds(state, { bounds: WindowBounds })`.
- Produces (`@/main/stateStore`):
  - `type StateFs = { readFile: (path: string) => Promise<string>; writeFile: (path: string, data: string) => Promise<void>; rename: (from: string, to: string) => Promise<void> }`;
  - `type Timers = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void }`;
  - `loadState({ fs, file, now }): Promise<PlayerState>`;
  - `createStateStore({ fs, file, initial, timers, debounceMs, onError }): StateStore` with `type StateStore = { read: () => PlayerState; update: (change: (state: PlayerState) => PlayerState) => void; flush: () => Promise<void>; isDirty: () => boolean }`; `debounceMs` is 2000 in production.
  - `isMissingFile(error: unknown): boolean` (an `Error` with `code` `'ENOENT'`, narrowed with a guard).

Rules (spec section 4 "State that persists"):
  - `addRecent` dedupes by path, puts the newest first, keeps 50.
  - `savePosition`: when `duration != null && position >= duration - END_MARGIN_S`, or `position <= 0`, it removes the path's entry (reaching the end clears it); otherwise it upserts `{ ...file, position, duration, playedAt: at }` first and keeps 1,000, dropping the least recently played.
  - `resumeFor` returns the saved position only when path, `size` and `mtimeMs` all match and `position > 0` and (`duration == null` or `position < duration - END_MARGIN_S`); else 0.
  - `watchedShare` is `position / duration` clamped to 0..1 when both are known, else `null`.
  - `setTrackPick` upserts newest first, keeps 1,000.

Store rules: `loadState` returns `EMPTY_STATE` when the file is missing; when JSON fails to parse or `isPlayerState` rejects it, it renames the file to `` `${file}.corrupt-${now()}` `` and returns `EMPTY_STATE`, never throwing (a failed rename is reported nowhere and still yields empty). `update` applies the change in memory, marks dirty and (re)starts one debounce timer. A write serialises the latest state as JSON to `` `${file}.tmp` `` then renames it over `file`; writes run one at a time (a promise chain). `flush` cancels the timer and writes now if dirty, after any write in flight; a failed write calls `onError(error)` and leaves the store dirty, so the next flush retries.

- [ ] **Step 1: Write the failing tests** for `playerState.ts`:
  - `addRecent` moves an existing path to the front without duplicating it; the 51st distinct path drops the oldest (`recents.length === 50`, the first added is gone);
  - `savePosition` at 40 of 120 stores the entry; at 115 of 120 removes it; at 0 removes it; with `duration: null` at 40 stores it; 1,001 distinct paths keep 1,000 and drop the least recently played;
  - `resumeFor` returns 40 for matching facts; 0 when `size` differs; 0 when `mtimeMs` differs (the replaced file); 0 for an unknown path; 0 when the stored entry is within 10 s of its end;
  - `watchedShare` is 0.5 for 60 of 120, `null` without a duration, `null` for an unknown path;
  - `isPlayerState` accepts `EMPTY_STATE`, rejects `{ ...EMPTY_STATE, version: 2 }` and `{ ...EMPTY_STATE, recents: 'x' }`;
  - no reducer mutates its input (deep-equal the input to a `structuredClone` taken before).

- [ ] **Step 2: Write the failing tests** for `stateStore.ts` against an in-memory fake `StateFs` that records calls in order and fake `Timers` the test fires by hand:
  - missing file loads `EMPTY_STATE` and renames nothing;
  - `'{"version":1,'` (truncated) loads empty and renames to `player-state.json.corrupt-1700000000000` (with `now: () => 1700000000000`);
  - valid JSON with `version: 2` loads empty and is renamed;
  - a valid file loads as written;
  - three `update`s then firing the timer writes once, with the third change, as `writeFile(tmp)` then `rename(tmp, file)`;
  - `flush()` with nothing dirty writes nothing; after an `update`, `flush()` writes immediately and the timer, fired later, writes nothing more;
  - a `writeFile` that rejects calls `onError` once, `isDirty()` stays true, and the next `flush()` writes;
  - an `update` during an in-flight write, then `flush()`: the second write starts only after the first resolves and carries the newer state.

- [ ] **Step 3: Run to verify they fail**, **implement** both modules, **run to verify they pass**: `bunx nx run @raven/desktop:test`.

- [ ] **Step 4: Commit** `MAE: keep desktop player state in an atomic JSON store`.

---

### Task 5: Grants and next in folder

**Files:**
- Create: `apps/raven/desktop/src/main/grants.ts`, `src/main/grants.test.ts`
- Create: `apps/raven/desktop/src/main/folder.ts`, `src/main/folder.test.ts`

**Interfaces:**
- Consumes: `isVideoFile` from `@raven/core`.
- Produces (`@/main/grants`):

```ts
export type GrantedFile = { fileId: string; path: string; name: string; size: number; mtimeMs: number }
export type GrantRefusal = 'missing' | 'not-a-file' | 'not-a-video'
export type GrantResult = { ok: true; file: GrantedFile } | { ok: false; reason: GrantRefusal }
export type GrantFs = {
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ isFile: () => boolean; size: number; mtimeMs: number }>
}
export type Grants = { grant: (path: string) => Promise<GrantResult>; fileOf: (fileId: string) => GrantedFile | null }
export const createGrants = ({ fs, newId }: { fs: GrantFs; newId: () => string }): Grants
```

- Produces (`@/main/folder`):

```ts
/** The videos after `current` in its folder, in natural order: what plays next, then the fallbacks. */
export const followingVideos = ({ current, siblings }: { current: string; siblings: readonly string[] }): string[]
export const NEXT_ATTEMPTS = 10
export const grantNext = ({ path, readdir, grants }: {
  path: string
  readdir: (dir: string) => Promise<string[]>
  grants: Grants
}): Promise<GrantedFile | null>
```

Rules (spec section 4 "Opening files"): `grant(path)` refuses a non-absolute path as `missing`; resolves `realpath` (any rejection is `missing`); refuses unless `isVideoFile` accepts both `basename(path)` and `basename(real)` (`not-a-video`), so a symlink named `x.mp4` pointing at a non-video is refused while a symlink to a video plays; `stat(real)` must be a regular file (`not-a-file`); `path` and `name` in the result are the real path and its basename; granting the same real path again returns the same `fileId` with refreshed `size` and `mtimeMs`. `followingVideos` drops names starting with `.` (AppleDouble `._x.mkv`), names `isVideoFile` rejects, and `current` itself; sorts with `new Intl.Collator(undefined, { numeric: true })`; returns those comparing after `current` (so a deleted `current` still has a next). `grantNext` reads `dirname(path)`, walks `followingVideos(...)` in order trying at most `NEXT_ATTEMPTS` with `grants.grant`, recursively (no loops), and returns the first granted file; a `readdir` rejection returns `null`.

- [ ] **Step 1: Write the failing tests** with a fake `GrantFs` (a map of path to `{ real, isFile, size, mtimeMs }`; unknown paths reject with an `ENOENT` `Error`):
  - grants `/m/Film.mkv`, returns a `fileId` from `newId`, `fileOf(id)` returns it, `fileOf('unknown')` is `null`;
  - refuses `relative/Film.mkv` (`missing`), `/m/gone.mkv` (`missing`), `/m/notes.txt` (`not-a-video`), a directory `/m/Season 1.mkv` (`not-a-file`);
  - `/m/link.mp4` whose real path is `/m/Film.mp4` grants with `path: '/m/Film.mp4'`; `/m/trailer.mp4` whose real path is `/home/me/.ssh/id_rsa` is refused `not-a-video`;
  - granting the same file twice returns the same `fileId`; after its fake `size` changes, the second grant reports the new size;
  - `/m/Été 02 (1080p).mkv` grants with `name: 'Été 02 (1080p).mkv'`.
- [ ] **Step 2: Write the failing tests** for `followingVideos` and `grantNext`:
  - siblings `['Episode 10.mkv', 'Episode 2.mkv', 'Episode 1.mkv', '._Episode 2.mkv', 'Episode 2.srt', 'cover.jpg', '.DS_Store']` with current `'Episode 1.mkv'` give `['Episode 2.mkv', 'Episode 10.mkv']`;
  - current `'Episode 10.mkv'` gives `[]`;
  - current `'Episode 3.mkv'` (no longer present) gives `['Episode 10.mkv']`;
  - `grantNext` skips a candidate whose grant is refused (a broken symlink) and grants the following one; a `readdir` that rejects gives `null`; with 20 refusing candidates it calls `grant` exactly 10 times and gives `null`.
- [ ] **Step 3: Run to verify they fail**, **implement**, **verify** `bunx nx run @raven/desktop:test` passes.
- [ ] **Step 4: Commit** `MAE: grant opened files by opaque id and find the next in folder`.

---

### Task 6: Protocol handlers and the security policy

**Files:**
- Create: `apps/raven/desktop/src/main/appProtocol.ts`, `src/main/appProtocol.test.ts`
- Create: `apps/raven/desktop/src/main/fileProtocol.ts`, `src/main/fileProtocol.test.ts`
- Create: `apps/raven/desktop/src/main/security.ts`, `src/main/security.test.ts`

**Interfaces:**
- Consumes: `Grants` (`fileOf`) from Task 5; `APP_SCHEME`, `APP_HOST`, `FILE_SCHEME` from `@/shared/protocol`; `extensionOf` from `@raven/core`.
- Produces (`@/main/appProtocol`): `CONTENT_SECURITY_POLICY` (the exact string in Global Constraints); `createAppHandler({ root, readFile }: { root: string; readFile: (path: string) => Promise<Uint8Array> }): (request: Request) => Promise<Response>`.
- Produces (`@/main/fileProtocol`):

```ts
export type ByteRange = { kind: 'all' } | { kind: 'range'; start: number; end: number } | { kind: 'unsatisfiable' }
export const parseRange = ({ header, size }: { header: string | null; size: number }): ByteRange
export const contentTypeFor = (fileName: string): string
export const createFileHandler = ({ grants, stat, readRange }: {
  grants: Pick<Grants, 'fileOf'>
  stat: (path: string) => Promise<{ size: number } | null>
  readRange: (input: { path: string; start: number; end: number }) => ReadableStream<Uint8Array>
}) => (request: Request) => Promise<Response>
```

- Produces (`@/main/security`): `isAppUrl(url: string): boolean`, `isExternalLink(url: string): boolean`, `windowOpenFor(url: string): { action: 'deny'; shouldOpenExternally: boolean }`, `isPermissionAllowed(permission: string): boolean`, `isTrustedSender(frameUrl: string | null | undefined): boolean`.

Rules:
- **app://** (P0 verified these): only host `raven` (else 404); only `GET` and `HEAD` (else 405); `/` serves `index.html`; the pathname is percent-decoded (a decode failure is 400), resolved inside `root`, and refused with 403 when the result is neither `root` nor under `root + sep`; a missing file is 404; every response, errors included, carries `Content-Security-Policy: CONTENT_SECURITY_POLICY` and `X-Content-Type-Options: nosniff`; `Content-Type` by extension: `html` `text/html; charset=utf-8`, `js` `text/javascript; charset=utf-8`, `css` `text/css; charset=utf-8`, `svg` `image/svg+xml`, `json` `application/json`, `png` `image/png`, `ico` `image/x-icon`, `woff2` `font/woff2`, `woff` `font/woff`, else `application/octet-stream`. Node's `URL` gives custom schemes an opaque `origin` (`'null'`), so compare `protocol` and `host`, never `origin`.
- **raven-file://<fileId>**: the host is the `fileId`; unknown id or a file `stat` cannot find is 404; methods as above; `parseRange`: `null` is `all`; `bytes=0-` is 0..size-1; `bytes=100-199` is 100..199 with `end` clamped to size-1; `bytes=-500` is the last 500 (all of it when larger than the file); `start >= size` is `unsatisfiable`; anything malformed or multi-range (`bytes=0-1,5-6`, `items=0-1`, `bytes=abc`) is `all`. Responses: `all` is 200 with the whole file, `range` is 206 with `Content-Range: bytes start-end/size`, `unsatisfiable` is 416 with `Content-Range: bytes */size`; all carry `Accept-Ranges: bytes`, `Content-Length`, `Content-Type` from `contentTypeFor` (`mp4` and `m4v` `video/mp4`, `webm` `video/webm`, `mkv` `video/x-matroska`, `mov` `video/quicktime`, `ogv` `video/ogg`, `ts`, `m2ts` and `mts` `video/mp2t`, `avi` `video/x-msvideo`, else `application/octet-stream`) and `Cache-Control: no-store`; `HEAD` has no body; a 0-byte file answers 200 with an empty body. `stat` runs per request, since the file may change while open.
- **Security:** `isAppUrl` is true only for `protocol === 'app:'` and `host === 'raven'`; `isExternalLink` for `http:` and `https:`; `windowOpenFor` always denies and opens externally only http and https; `isPermissionAllowed` only `'fullscreen'`; `isTrustedSender` is `isAppUrl` of the frame URL, false for `null`, `undefined` and `''`.

- [ ] **Step 1: Write the failing tests.** `Request` and `Response` are Bun globals; build requests like `new Request('app://raven/index.html')`.
  - app: `/` and `/index.html` serve the fake root's bytes with `text/html; charset=utf-8` and the exact CSP; `/assets/app-1a2b.js` gets `text/javascript; charset=utf-8`; `app://raven/%2e%2e/package.json`, `app://raven/..%2fpackage.json` and `app://raven/assets/%2e%2e%2f%2e%2e%2fsecret` are 403 (or 404 when URL parsing already removed the segment; assert `status !== 200` and `readFile` never called with a path outside root); `app://other/index.html` is 404; `POST` is 405; missing file is 404 and still carries the CSP; `app://raven/%E0%A4%A` is 400.
  - file: a 1,000-byte granted file: no `Range` is 200 with `Content-Length: 1000`; `bytes=0-` is 206 `bytes 0-999/1000`; `bytes=100-199` is 206 `Content-Length: 100`; `bytes=900-5000` is 206 `bytes 900-999/1000`; `bytes=-100` is 206 `bytes 900-999/1000`; `bytes=1000-` is 416 `bytes */1000`; `bytes=0-1,5-6` is 200; unknown id is 404; a granted file whose `stat` now gives `null` is 404; `HEAD` has headers and an empty body; `readRange` received the right `start` and `end` (record its calls); `contentTypeFor('Film.MKV')` is `video/x-matroska`.
  - security: `isAppUrl('app://raven/index.html')` true; `app://raven.evil/`, `app://other/`, `https://raven/`, `file:///etc/hosts`, `''` false; `windowOpenFor('https://example.com')` is `{ action: 'deny', shouldOpenExternally: true }`, `windowOpenFor('about:blank')` and `windowOpenFor('file:///x')` deny without opening; `isPermissionAllowed('fullscreen')` true, `'media'`, `'notifications'`, `'clipboard-read'`, `'openExternal'` false; `isTrustedSender(null)` false.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** `bunx nx run @raven/desktop:test` passes.
- [ ] **Step 3: Commit** `MAE: serve the renderer and granted files through guarded schemes`.

---

### Task 7: The desktop service (main's answer to every request)

**Files:**
- Create: `apps/raven/desktop/src/main/desktopService.ts`, `src/main/desktopService.test.ts`

**Interfaces:**
- Consumes: `Grants`, `GrantedFile` (Task 5), `grantNext` (Task 5), `StateStore` and the reducers (Task 4), `isInvokeEnvelope`, `DesktopReply`, `MAX_QUEUE` (Task 2), `titleFromFileName` from `@raven/core`.
- Produces (`@/main/desktopService`):

```ts
export const MESSAGES = {
  notVideo: 'raven player opens video files only.',
  missing: 'That file could not be found.',
  nothingDropped: 'Drop a video file to play it.',
  notOpen: 'That video is no longer open. Open it again from Home.',
  unknownRecent: 'That video is no longer in your recents.',
  unknownRequest: 'raven player does not understand that request.',
} as const
export type DesktopServiceDeps = {
  grants: Grants
  store: StateStore
  readdir: (dir: string) => Promise<string[]>
  showOpenDialog: () => Promise<string[]>
  addRecentDocument: (path: string) => void
  clearRecentDocuments: () => void
  onReady: () => void
  newId: () => string
  now: () => number
}
export type DesktopService = {
  handle: (envelope: unknown) => Promise<DesktopReply>
  openPaths: (paths: readonly string[]) => Promise<DesktopReply>
  openDialog: () => Promise<DesktopReply>
}
export const createDesktopService = (deps: DesktopServiceDeps): DesktopService
```

Behaviour:
- `handle` narrows with `isInvokeEnvelope`; anything else is `{ type: 'refused', message: MESSAGES.unknownRequest }` (main logs the refusal, Task 10). A `drop` envelope goes to `openPaths(paths)`, with `MESSAGES.nothingDropped` when `paths` is empty.
- `openPaths` takes at most `MAX_QUEUE + 1` paths, grants them all, keeps the granted in the given order: the first is `target.fileId`, the rest `target.queue`. None granted is refused with the first refusal's message (`not-a-video` and `not-a-file` are `notVideo`, `missing` is `missing`).
- `openDialog` calls `showOpenDialog()`; an empty list (cancelled) is `done`; else `openPaths`.
- `ready` calls `onReady()` and replies `done`.
- `describeFile`: `fileOf(fileId)` or refused `notOpen`; `label` is `titleFromFileName(file.name)`, `folder` is `basename(dirname(file.path))`, `resumeAt` is `resumeFor`; `next` is the first queue entry `fileOf` still knows (with `queue` the entries after it), else `grantNext` in the folder (with `queue: []`), else `null`; it also records the open: `addRecent`, `addRecentDocument(file.path)`.
- `savePosition`: `fileOf` or refused `notOpen`; `store.update(savePosition(...))` with the grant's facts and `now()`; `done`.
- `listRecents`: each recent becomes `{ recentId, label, from, watched }`; `recentId` comes from a per-session map from path to an id made with `newId`, stable for the session, so the renderer never sees a path.
- `openRecent`: unknown id is refused `unknownRecent`; a grant refusal keeps the recent and answers its message; else `play` with an empty queue.
- `removeRecent` and `clearRecents` update the store (`clearRecents` also calls `clearRecentDocuments()`); `done`.

- [ ] **Step 1: Write the failing tests** with real `createGrants` over a fake fs, a real `createStateStore` over a fake `StateFs` and manual timers, and sequential `newId` values (`'00000000-0000-4000-8000-00000000000' + n`, valid `isOpaqueId`):
  - `handle({ kind: 'page', request: { type: 'readFile', path: '/etc/hosts' } })` is refused `unknownRequest`; `handle('nope')` likewise;
  - `handle({ kind: 'drop', paths: [] })` is refused `nothingDropped`;
  - `openPaths(['/m/a.mkv', '/m/notes.txt', '/m/b.mkv'])` plays `a` with queue `[b]`; `openPaths(['/m/notes.txt'])` is refused `notVideo`; `openPaths(['/m/gone.mkv'])` is refused `missing`;
  - 5,000 video paths: the target has 100 queued and `grant` ran 101 times (spy on the fake `stat`);
  - `openDialog` with a cancelled dialog is `done`;
  - `describeFile` of `/m/Show/Episode 1.mkv` gives label `'Episode 1'`, folder `'Show'`, `resumeAt` 0, `next.label` `'Episode 2'` from the folder, and `addRecentDocument` was called with the path; with a queue of one granted id the queue wins over the folder;
  - after `savePosition` at 40 of 120, a fresh `describeFile` of the same file gives `resumeAt: 40`; after the fake file's `mtimeMs` changes and it is granted again, `resumeAt` is 0;
  - `listRecents` after two describes lists both newest first, `watched` 0.33 (40/120, rounded in the test with `toBeCloseTo`) for the saved one and `null` for the other, and no field contains a `/`;
  - `openRecent` with an id from `listRecents` plays; after the file is deleted from the fake fs it answers `missing` and the recent is still listed; `removeRecent` removes it; `clearRecents` empties the list and called `clearRecentDocuments`;
  - `describeFile` and `savePosition` with an id never granted are refused `notOpen`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** `bunx nx run @raven/desktop:test` passes.
- [ ] **Step 3: Commit** `MAE: answer the desktop renderer's requests in the main process`.

---

### Task 8: Renderer foundation, Shell and Home

**Files:**
- Create: `apps/raven/desktop/index.html`, `vite.config.ts`, `tsconfig.renderer.json` (and its reference in `tsconfig.json`), `.stylelintrc.json`, `src/renderer/.oxlintrc.json`
- Create: `src/renderer/main.tsx`, `src/renderer/routes.tsx`, `src/renderer/styles/desktop.scss`
- Create: `src/renderer/desktop/client.ts`, `client.test.ts`, `DesktopContext.tsx`, `menuHub.ts`, `menuHub.test.ts`
- Create: `src/renderer/Shell/Shell.tsx`, `Shell.module.scss`, `Shell.test.tsx`, `useFileDrop.ts`
- Create: `src/renderer/HomePage/HomePage.tsx`, `HomePage.module.scss`, `HomePage.test.tsx`
- Create: `src/renderer/test/happy-dom.ts`, `src/renderer/test/setup.ts`, `src/renderer/test/render.tsx`
- Modify: `apps/raven/desktop/package.json` (scripts), `.oxlintrc.json` (config-file default export override), `lint-staged.config.ts`

**Interfaces:**
- Consumes: Task 2's protocol and bridge type; `Button`, `Icon` from `@raven/ui`; `@raven/ui/styles.css`.
- Produces:
  - `@/renderer/desktop/client`: `type DesktopClient = { request: (request: DesktopRequest) => Promise<DesktopReply>; dropFiles: (files: readonly File[]) => Promise<DesktopReply>; subscribe: (listener: (event: DesktopEvent) => void) => () => void }`; `isRavenDesktopBridge(value: unknown): value is RavenDesktopBridge` (an object whose three members are functions); `clientFor(bridge: unknown): DesktopClient | null`. Replies failing `isDesktopReply`, and rejected invokes, become `{ type: 'refused', message: 'raven player could not read its own reply.' }`; events failing `isDesktopEvent` are dropped with `console.warn`.
  - `@/renderer/desktop/menuHub`: `type MenuHub = { emit: (action: MenuPlayerAction) => void; subscribe: (listener: (action: MenuPlayerAction) => void) => () => void }`; `createMenuHub(): MenuHub`.
  - `@/renderer/desktop/DesktopContext`: `DesktopProvider({ client, menu, children })`, `useDesktop(): { client: DesktopClient; menu: MenuHub }` (throws an `Error` outside the provider).
  - `@/renderer/Shell/Shell`: `Shell` (the root layout route), `useDragging(): boolean`, `useOpenReply(): (reply: DesktopReply) => void`, `RECENTS_KEY = ['desktop', 'recents'] as const`.
  - `@/renderer/routes`: `desktopRoutes: RouteObject[]` (this task: the `Shell` layout with an index route `HomePage`; Task 9 adds `play/:fileId` and `settings`).
  - `@/renderer/HomePage/HomePage`: `HomePage`, `watchedLabel(watched: number | null): string`.
  - `@/renderer/test/render`: `fakeClient(overrides?)` (mocked `request`, `dropFiles`, `subscribe`, plus `emit(event: DesktopEvent)` driving subscribers), `renderDesktop({ client, route })` returning `{ router, menu, queryClient }` (fresh `QueryClient` with `retry: false`, `createMemoryRouter(desktopRoutes, { initialEntries: [route] })`, the providers).

Behaviour:
- **`main.tsx`**: imports `@fontsource/young-serif`, `@fontsource-variable/instrument-sans/wdth.css`, `@raven/ui/styles.css`, then `@/renderer/styles/desktop.scss`; `const client = clientFor('ravenDesktop' in window ? window.ravenDesktop : undefined)`; without a client renders `<main><h1>raven player could not start</h1></main>`; else `StrictMode`, `QueryClientProvider`, `DesktopProvider` with `createMenuHub()`, `RouterProvider` over `createMemoryRouter(desktopRoutes)`.
- **`desktop.scss`**: `:root { --titlebar-inset: 1.75rem; }` with a comment that the window is `hiddenInset` and this clears the traffic lights; nothing else.
- **`Shell`**: on mount subscribes to `client` events, then sends `{ type: 'ready' }` (main holds opens until then); `play` navigates to `/play/<fileId>` with state `{ queue }`, `replace: true` when the current path starts with `/play/` (so Back always returns Home); `navigate` goes to `/` or `/settings`; `player` calls `menu.emit(action)`; `notice` shows the message in a `<p role="status">` cleared after 6 s; `recentsChanged` invalidates `RECENTS_KEY`. `useOpenReply` applies the same `play` and `refused` (as a notice) handling to a reply; `done` does nothing. `useFileDrop` listens on `window` for `dragenter`, `dragover`, `dragleave` and `drop`, calls `preventDefault` on `dragover` and `drop`, tracks `dragging` (a counter, so child elements do not flicker it), and on `drop` sends `[...event.dataTransfer.files]` in the order dropped to `client.dropFiles`, then `useOpenReply`. Renders `<Outlet />` inside a `DraggingContext` provider, and the notice.
- **Home** (spec "Screens"): `<main className={styles.home} aria-labelledby="home-title">` a grid with named areas: `'bar bar' 'open recents'` above `48rem`, `'bar' 'open' 'recents'` below. `bar` is a `<header>` drag strip (`-webkit-app-region: drag`, padded by `--titlebar-inset`; its buttons `no-drag`) holding `<h1 id="home-title" tabIndex={-1}>raven player</h1>`, focused on arrival, and a Settings button (`icon="settings"`, `aria-label="Settings"`, to `/settings`). `open` is a `<section aria-labelledby>` with `<h2>Open a video</h2>`, `<p>Drop a video anywhere in this window, or choose one.</p>` and `<Button tone="primary" icon="file-play">Choose a video</Button>` sending `openDialog` through `useOpenReply`. While `useDragging()` is true, a `<p className={styles.drop}>Drop to play</p>` overlay shares the `open` area. `recents` is a `<section>` with `<h2>Recent</h2>` and either `<p>Nothing opened yet.</p>` or a `<ul>` of `<li>`: a `<button>` (opens the recent through `openRecent` and `useOpenReply`) holding the title, the folder (`from`) and `<progress max={1} value={watched ?? 0} aria-label={watchedLabel(watched)} />`, beside `<Button icon="close" aria-label="Remove from recents" />`. Recents come from `useQuery({ queryKey: RECENTS_KEY, queryFn })` over `listRecents` (a `refused` reply throws an `Error` with its message). `watchedLabel(null)` is `'Not started'`, else `` `${Math.round(watched * 100)}% watched` ``. Styles follow the CSS constraints: grid and `gap`, no flex, no margins, tokens only, `--focus-ring` on `:focus-visible`, the overlay's fade inside `prefers-reduced-motion: no-preference`, works at 320px.
- **Config**: `index.html` like web's (no favicons, `<title>raven player</title>`, `<meta name="theme-color" content="#15201e" />`, `<script type="module" src="/src/renderer/main.tsx">`). `vite.config.ts` like web's: `react()`, alias `@` to `./src`, `build: { outDir: 'dist/renderer', emptyOutDir: false }` (the clean script owns removal), no proxy, no Netlify plugin. `tsconfig.renderer.json` extends `../../../tooling/tsconfig/react.json` with `paths`, `include: ["src/renderer", "src/shared", "vite.config.ts", "../../../tooling/web"]`. `src/renderer/.oxlintrc.json` (oxlint's nested config for the renderer) extends `../../../../../tooling/oxlint/react.json` with the same test-file override as web's. The project `.oxlintrc.json` gains an override turning `import/no-default-export` off for `vite.config.ts`, `playwright.config.ts` and `forge.config.ts`, and `no-restricted-imports` off for `forge.config.ts` alone (Ruling 11), each with its reason. `.stylelintrc.json` identical to web's. `lint-staged.config.ts` gains `'apps/raven/desktop/**/*.scss': ['bun --cwd apps/raven/desktop stylelint --fix', oxfmt]`. Test harness: `happy-dom.ts` registers `GlobalRegistrator` with `url: 'app://raven/'`; `setup.ts` imports jest-dom and runs `cleanup` after each test.
- **Scripts** added (and to `includedScripts`): `"build": "bun run --sequential build:clean build:renderer"`, `"build:clean": "rm -rf dist"`, `"build:renderer": "vite build"`, `"typecheck": "bun run --parallel typecheck:main typecheck:renderer"`, `"typecheck:main": "tsgo --noEmit -p tsconfig.main.json"`, `"typecheck:renderer": "tsgo --noEmit -p tsconfig.renderer.json"`, `"lint:css": "stylelint \"src/**/*.scss\""`, `"lint:css:fix": "stylelint --fix \"src/**/*.scss\""`, `"test": "bun run --sequential test:main test:renderer"`, `"test:renderer": "bun test --dots --preload ./src/renderer/test/happy-dom.ts --preload ../../../tooling/web/scss-modules.ts --preload ./src/renderer/test/setup.ts src/renderer"`. The renderer's DOM globals load only in `test:renderer`, so `test:main` keeps Bun's own `Request`, `Response` and `ReadableStream`.

- [ ] **Step 1: Write the failing tests.**
  - `client.test.ts`: `clientFor(undefined)` and `clientFor({ request: 1 })` are `null`; a bridge whose `request` resolves `{ type: 'done' }` gives `done`; resolving `{ type: 'weird' }` gives the refused reply; rejecting gives the refused reply; `request` wraps nothing itself (it forwards the request object unchanged to the bridge); `subscribe` delivers a valid `notice` and drops `{ type: 'navigate', to: 'devtools' }`; the returned function unsubscribes.
  - `menuHub.test.ts`: two subscribers both get `next`; an unsubscribed one does not.
  - `Shell.test.tsx` (through `renderDesktop`): after mount `request` was called with `{ type: 'ready' }` and only after `subscribe`; emitting `play` moves `router.state.location.pathname` to `/play/<id>` with `state` `{ queue: [] }`; a second `play` while on `/play/...` replaces (history length unchanged); `navigate` `settings` moves to `/settings`; `player` `togglePlay` reaches a `menu.subscribe` listener; `notice` shows its text in `role="status"`; a `drop` event on `window` whose `dataTransfer.files` holds two `File`s calls `dropFiles` with both in order, and a `refused` reply shows its message.
  - `HomePage.test.tsx`: the heading `raven player` has focus after render; "Choose a video" sends `openDialog` and a `play` reply navigates to `/play/<id>`; with recents `[{ recentId, label: 'Clip 01', from: 'Clips', watched: 0.5 }, { ..., label: 'Clip 02', watched: null }]` the list shows both buttons, a `progress` named `50% watched` and one named `Not started`; clicking "Clip 01" sends `openRecent` with its `recentId`; "Remove from recents" on it sends `removeRecent` and refetches; an empty list shows `Nothing opened yet.`; during a `dragenter` on window "Drop to play" shows, and it hides after `dragleave`; `watchedLabel(0.333)` is `'33% watched'`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop` passes. `build` prints Vite's gzip sizes; note the total against the 250 KB renderer budget (spec section 8) in the commit body.
- [ ] **Step 3: Commit** `MAE: add the desktop renderer shell and Home`.

---

### Task 9: Play and Settings screens

**Files:**
- Create: `apps/raven/desktop/src/renderer/PlayPage/PlayPage.tsx`, `PlayPage.module.scss`, `PlayPage.test.tsx`, `playerServices.ts`, `playerServices.test.ts`
- Create: `apps/raven/desktop/src/renderer/SettingsPage/SettingsPage.tsx`, `SettingsPage.module.scss`, `SettingsPage.test.tsx`
- Modify: `apps/raven/desktop/src/renderer/routes.tsx`

**Interfaces:**
- Consumes: Task 3's `PlayerServices` (`progress.duration`, `hostActions`), `PlayerAction`, `Player`, `PlayerServicesProvider`, `Button` from `@raven/ui`; Task 8's `useDesktop`, `useOpenReply`, `RECENTS_KEY`, `MenuHub`; `fileUrlFor`, `isOpaqueId`, `LocalFile`, `MenuPlayerAction` from `@/shared/protocol`.
- Produces:
  - `@/renderer/PlayPage/playerServices`: `playerActionFor(action: MenuPlayerAction): PlayerAction | null`; `servicesFor({ file, client, menu }: { file: LocalFile; client: DesktopClient; menu: MenuHub }): PlayerServices`; `isPlayState` (`object({ queue: listOf(isOpaqueId) })`).
  - `@/renderer/PlayPage/PlayPage`: `PlayRoute` (route element).
  - `@/renderer/SettingsPage/SettingsPage`: `SettingsPage`.

Behaviour:
- `playerActionFor`: `togglePlay` is `{ type: 'togglePlay' }`, `skipBack` `{ type: 'seekBy', seconds: -10 }`, `skipForward` `{ type: 'seekBy', seconds: 10 }` (the web's `j` and `l`), `showShortcuts` `{ type: 'showShortcuts' }`, `next` `null`; switch with the `never` check.
- `servicesFor`: `title` is `{ label: file.label, duration: null, resumeAt: file.resumeAt, backTo: '/', next }` where `next` is `{ to: '/play/<next.fileId>', state: { queue: next.queue }, label: next.label }` or `null`; `progress.started` does nothing (local files have no history); `progress.duration` remembers the length in a closure; `progress.save(position)` and `progress.left(position)` send `{ type: 'savePosition', fileId, position, duration }` with the remembered length (handle the promise; ignore its reply); `posterUrl: null`; `escape: null`; `hostActions.subscribe(listener)` subscribes to `menu` and forwards only actions `playerActionFor` maps.
- `PlayRoute` reads `fileId` from the params (`isOpaqueId`, else render the refused view) and `queue` from `location.state` through `isPlayState` (default `[]`), and renders `<PlayPage key={fileId} ... />`, so a new file remounts the Player and its unmount saves the old position first (spec "Opening while playing"). `PlayPage` runs `useQuery({ queryKey: ['desktop', 'file', fileId, queue], queryFn, staleTime: Infinity })` over `describeFile`; while pending, `<main className={styles.waiting} aria-busy="true" />`; a refusal renders `<main>` with `<h1>This video can't be opened</h1>`, the message and `<Button icon="back">Home</Button>`; else `PlayerServicesProvider` with `servicesFor(...)` around `<Player engine={{ kind: 'html', source: { kind: 'file', url: fileUrlFor(fileId) } }} />`. It also subscribes to `menu` for `next` and navigates to the next link with `replace: true` when there is one. Back and Escape returning Home come from the Player (`backTo: '/'`).
- **Settings** (P4 scope: only what exists now): `<main>` grid with a `<header>` drag strip (as Home's) holding `<Button icon="back">Back</Button>` (to `/`) and `<h1 tabIndex={-1}>Settings</h1>` focused on arrival; one `<section aria-labelledby>` "Recents" with `<p>raven player remembers the videos you open and where you stopped.</p>` and `<Button tone="danger">Clear recents</Button>` sending `clearRecents`, then invalidating `RECENTS_KEY` and showing `Recents cleared.` in a `<p role="status">`. Servers, "This computer" and updates join in P5 to P7.
- Routes: `{ path: 'play/:fileId', element: <PlayRoute /> }`, `{ path: 'settings', element: <SettingsPage /> }`.

- [ ] **Step 1: Write the failing tests.**
  - `playerServices.test.ts`: `playerActionFor` table for all five; `servicesFor` with `next: { fileId: B, label: 'Clip 02', queue: [C] }` gives `title.next` `{ to: '/play/B', state: { queue: [C] }, label: 'Clip 02' }`; after `progress.duration(30)`, `progress.save(12)` sent `{ type: 'savePosition', fileId: A, position: 12, duration: 30 }`; before any duration it sends `duration: null`; `hostActions` forwards `skipForward` as `{ type: 'seekBy', seconds: 10 }` and drops `next`; `isPlayState` rejects `{ queue: ['../x'] }`.
  - `PlayPage.test.tsx` (fake client answering `describeFile` with `{ fileId: A, label: 'Clip 01', folder: 'Clips', resumeAt: 0, next: { fileId: B, label: 'Clip 02', queue: [] } }`): the `video` element's `src` is `raven-file://A`; the heading `Clip 01` shows; a link named `Next: Clip 02` points at `/play/B`; the Back button returns to `/`; emitting a menu `next` navigates to `/play/B` replacing the entry; navigating to `/play/B` sent a `savePosition` for A (the unmount save) before `describeFile` for B; a `refused` describe shows `This video can't be opened` and the message, and its Home button returns to `/`; a `fileId` that is not an opaque id renders the refused view without calling `request`.
  - `SettingsPage.test.tsx`: the heading has focus; "Clear recents" sends `clearRecents` and shows `Recents cleared.`; Back goes to `/`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop` passes.
- [ ] **Step 3: Commit** `MAE: play local files through the shared player in the desktop app`.

---

### Task 10: Main process lifecycle, menus and the preload

**Files:**
- Create: `apps/raven/desktop/src/main/openBatch.ts`, `openBatch.test.ts` (`createOpenBatch`, `pathsFromArgv`)
- Create: `apps/raven/desktop/src/main/menu.ts`, `menu.test.ts`
- Create: `apps/raven/desktop/src/main/quitGate.ts`, `quitGate.test.ts`
- Create: `apps/raven/desktop/src/main/windowBounds.ts`, `windowBounds.test.ts`
- Create: `apps/raven/desktop/src/main/main.ts`
- Create: `apps/raven/desktop/src/preload/preload.ts`, `src/preload/dropPaths.ts`, `src/preload/dropPaths.test.ts`
- Create: `apps/raven/desktop/tsconfig.preload.json` (and its reference in `tsconfig.json`)
- Modify: `apps/raven/desktop/package.json` (scripts, `nx.targets.dev`)

**Interfaces:**
- Consumes: everything from Tasks 2 and 4 to 7; `VIDEO_EXTENSIONS` from `@raven/core`.
- Produces:

```ts
// @/main/openBatch
export const createOpenBatch = <T>({ delayMs, timers, deliver }: {
  delayMs: number
  timers: Timers
  deliver: (items: T[]) => void
}): { push: (item: T) => void; ready: () => void }
export const pathsFromArgv = (argv: readonly string[]): string[]
// @/main/menu
export type MenuActions = {
  openDialog: () => void
  send: (event: DesktopEvent) => void
}
export const menuTemplate = ({ appName, actions }: { appName: string; actions: MenuActions }): MenuItemConstructorOptions[]
// @/main/quitGate
export const createQuitGate = ({ isDirty, flush, timeoutMs, quit, exit, wait }: {
  isDirty: () => boolean
  flush: () => Promise<void>
  timeoutMs: number
  quit: () => void
  exit: () => void
  wait: (ms: number) => Promise<void>
}): (event: { preventDefault: () => void }) => void
// @/main/windowBounds
export type Rect = { x: number; y: number; width: number; height: number }
export const DEFAULT_SIZE = { width: 1280, height: 800 } as const
export const placeWindow = ({ saved, displays, primary }: {
  saved: WindowBounds | null
  displays: readonly { id: number; workArea: Rect }[]
  primary: { workArea: Rect }
}): Rect
// @/preload/dropPaths
export const dropPaths = ({ files, pathOf }: { files: readonly unknown[]; pathOf: (file: File) => string }): string[]
```

Rules:
- **`createOpenBatch`**: items pushed before `ready()` are held; `ready()` delivers them as one batch at once; after ready, pushes within `delayMs` of each other (100 ms in production) are delivered together in push order; `ready()` again (a renderer reload) is harmless.
- **`pathsFromArgv`**: entries after the first that are absolute paths (`isAbsolute`) and do not start with `-`.
- **`menuTemplate`** (spec "Menus", P4 items only): `appName` menu: `{ role: 'about' }`, separator, `Settings…` with `accelerator: 'CommandOrControl+,'` sending `navigate` `settings`, separator, `{ role: 'hide' }`, `{ role: 'hideOthers' }`, `{ role: 'unhide' }`, separator, `{ role: 'quit' }`. File: `Open…` `CommandOrControl+O` calling `openDialog`; `Open Recent` with `role: 'recentDocuments'` and `submenu: [{ role: 'clearRecentDocuments' }]` (macOS's native list, fed by `app.addRecentDocument`; choosing one fires `open-file`); separator; `{ role: 'close' }` (Command W). Playback, no accelerators: Play or Pause, Skip Back, Skip Forward, Next, each sending `{ type: 'player', action }` with `togglePlay`, `skipBack`, `skipForward`, `next`. View: `{ role: 'togglefullscreen' }` (Control Command F). Window: `{ role: 'windowMenu' }`. Help: `{ role: 'help', submenu: [Keyboard Shortcuts sending player showShortcuts] }`. Items for P5 to P7 are added by those PRs.
- **`createQuitGate`**: when `isDirty()` is false, allows the event; else calls `preventDefault`, starts one flush (a second event while flushing only prevents), races it against `wait(timeoutMs)`; afterwards `quit()` if no longer dirty, else `exit()` (a hung or failed write never blocks quitting). Production `timeoutMs` is 1000. Used for both `before-quit` and `will-quit`, because the renderer's last `savePosition` can land between them.
- **`placeWindow`**: `saved` wins when a display with `saved.displayId` exists and the saved rect overlaps that display's work area by at least 64 by 64 px; its width and height are clamped to that work area. Otherwise `DEFAULT_SIZE`, clamped to the primary work area and centred in it.
- **`dropPaths`**: keeps only `File` instances, maps each through `pathOf`, drops `''` (a `File` the page made has no path), and keeps order.
- **`preload.ts`** (bundled to one CommonJS file): `contextBridge.exposeInMainWorld('ravenDesktop', bridge satisfies RavenDesktopBridge)` where `request` invokes `REQUEST_CHANNEL` with `{ kind: 'page', request }`, `dropFiles` invokes it with `{ kind: 'drop', paths: dropPaths({ files, pathOf: webUtils.getPathForFile }) }`, and `subscribe` adds an `ipcRenderer.on(EVENT_CHANNEL, ...)` handler passing only the payload and returns its removal. Nothing else is exposed.
- **`main.ts`** (the only untested module; wiring in this order):
  1. `const launchedAt = performance.now()` first.
  2. `userData`: `join(app.getPath('appData'), 'raven')`, or `RAVEN_DESKTOP_USER_DATA` when `!app.isPackaged` and set; `app.setPath('userData', ...)`; then `requestSingleInstanceLock()`, quitting when it fails; `second-instance` focuses the window and pushes `pathsFromArgv(argv)` into the batch.
  3. `app.enableSandbox()`; `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, { scheme: 'raven-file', privileges: { standard: true, secure: true, stream: true } }])` (P0's `app` privileges; `stream` lets `<video>` read ranges; neither bypasses CSP).
  4. `will-finish-launching`: `open-file` (`preventDefault`, push the path) and `open-url` (`preventDefault`, push into a second batch that answers each batch with the notice `raven links open server titles, which this version cannot play yet.`). Cold-launch `pathsFromArgv(process.argv)` joins the file batch.
  5. Load the state (`loadState` with `node:fs/promises`, file `join(userData, 'player-state.json')`), create the store (`debounceMs: 2000`, `setTimeout`/`clearTimeout`, `onError` `console.error`), grants (`newId: randomUUID`), the desktop service (`showOpenDialog` filtered to `VIDEO_EXTENSIONS`, `properties: ['openFile', 'multiSelections']`; `onReady` calls both batches' `ready`). File batch delivery: `openPaths`, then send `play` or `notice` and show and focus the window.
  6. `whenReady`: `protocol.handle('app', createAppHandler({ root: join(app.getAppPath(), 'dist', 'renderer'), readFile }))`; `protocol.handle('raven-file', createFileHandler(...))` with `readRange` from `createReadStream(path, { start, end })` through `Readable.toWeb`; default session `setPermissionRequestHandler` and `setPermissionCheckHandler` through `isPermissionAllowed`; `web-contents-created`: `will-navigate` prevents unless `isAppUrl`, `will-attach-webview` prevents, `setWindowOpenHandler` uses `windowOpenFor` and calls `shell.openExternal` (handle its promise) when it says so; `ipcMain.handle(REQUEST_CHANNEL, ...)` refuses unless `isTrustedSender(event.senderFrame?.url)` and otherwise returns `service.handle(payload)`, `console.warn`-ing every refusal; `Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(...)))` with `send` posting `EVENT_CHANNEL` to the window; `app.setAboutPanelOptions({ applicationName: 'raven player', applicationVersion: app.getVersion() })`.
  7. The window: `placeWindow` from the stored bounds and `screen`, `minWidth: 320`, `minHeight: 240`, `show: false`, `titleBarStyle: 'hiddenInset'`, `backgroundColor: '#15201e'` (raven's night, so no white flash), `title: 'raven player'`, `webPreferences: { preload: join(app.getAppPath(), 'dist', 'preload', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false }`; `loadURL('app://raven/')`; `ready-to-show` shows it and, when `!app.isPackaged`, writes `` `raven-launch-ms ${Math.round(performance.now() - launchedAt)}\n` `` to stdout (the launch budget's mark until P7's log); `moved` and `resized` store `setWindowBounds` with `screen.getDisplayMatching(bounds).id`.
  8. Quit: `before-quit` and `will-quit` both through `createQuitGate`; `window-all-closed` quits (one window).
- **Scripts** (and `includedScripts`): `"build": "bun run --sequential build:clean build:renderer build:main build:preload"`, `"build:main": "bun build src/main/main.ts --target node --format esm --external electron --sourcemap=linked --outfile dist/main/main.js"`, `"build:preload": "bun build src/preload/preload.ts --target node --format cjs --external electron --outfile dist/preload/preload.cjs"`, `"typecheck": "bun run --parallel typecheck:main typecheck:preload typecheck:renderer"`, `"typecheck:preload": "tsgo --noEmit -p tsconfig.preload.json"`, `"dev": "electron ."`. `nx.targets.dev`: `{ "dependsOn": ["build"] }` (it runs the built app). `tsconfig.preload.json`: extends the node preset, `lib: ["ES2023", "DOM"]`, `types: ["node"]`, `paths`, `include: ["src/preload", "src/shared", "e2e", "playwright.config.ts"]` (the e2e files arrive in Task 11).

- [ ] **Step 1: Write the failing tests** for the four pure modules and `dropPaths`:
  - batch: three pushes before `ready()` deliver nothing; `ready()` delivers `[a, b, c]` once; after ready, `a` then `b` within 100 ms deliver `[a, b]` once when the timer fires; `c` after that is its own batch; a second `ready()` delivers nothing new.
  - `pathsFromArgv(['/Applications/raven player.app/Contents/MacOS/raven player', '--inspect', '/m/Film.mkv', '.', 'relative.mkv'])` is `['/m/Film.mkv']`.
  - menu: labels in order `['raven player', 'File', 'Playback', 'View', 'Window', 'Help']` (top items' `label` or `role`); Settings… accelerator `CommandOrControl+,`; Open… `CommandOrControl+O` and its `click` calls `openDialog`; Open Recent has role `recentDocuments` with a `clearRecentDocuments` child; no Playback item has an `accelerator`; clicking Skip Forward sends `{ type: 'player', action: 'skipForward' }`; every accelerator anywhere in the template contains `Command`, `Control` or `CommandOrControl` (no single keys, spec "Menus"); no item is labelled Check for Updates, Open Link, Video Info, Show Logs, Show Crash Reports or Copy Diagnostics.
  - quit gate: not dirty: `preventDefault` not called, `quit` and `exit` not called; dirty with a flush that clears it: `preventDefault` once, `flush` once, then `quit` once; two events while flushing: `flush` still once; a flush that never settles: `exit` after `wait(1000)` resolves; a flush that rejects: `exit`.
  - placement: saved bounds on a present display are returned; saved on a removed display give `DEFAULT_SIZE` centred on primary (`x = workArea.x + (workArea.width - 1280) / 2`); saved bounds 10 px inside a display's edge (overlap under 64) fall back to primary; a 1024 by 700 primary clamps the default to 1024 by 700.
  - `dropPaths`: two `File`s with paths in order keep their order; a `File` whose `pathOf` gives `''` is dropped; a non-`File` value is dropped.
- [ ] **Step 2: Run to verify they fail**, **implement** the modules, `preload.ts` and `main.ts`, **verify** `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop` passes.
- [ ] **Step 3: Smoke it by hand** (macOS): `bunx nx run @raven/desktop:dev -- /path/to/M1.mp4` with `RAVEN_DESKTOP_USER_DATA=$(mktemp -d)`: the window opens on Home then plays M1 through the html engine; Escape returns Home with M1 in Recent; Command O opens the dialog filtered to videos; Command comma opens Settings; dropping a `.txt` shows `raven player opens video files only.`; quit and relaunch with the same `RAVEN_DESKTOP_USER_DATA`: M1 resumes ("Resumed at"). Record the results in the commit body.
- [ ] **Step 4: Commit** `MAE: wire the desktop main process, menus and preload`.

---

### Task 11: The Playwright `_electron` e2e suite

**Files:**
- Create: `apps/raven/desktop/playwright.config.ts`
- Create: `apps/raven/desktop/e2e/harness.ts`, `e2e/clips.ts`, `e2e/player.e2e.ts`, `e2e/security.e2e.ts`, `e2e/launch.e2e.ts`
- Modify: `apps/raven/desktop/package.json` (`"e2e": "playwright test"` in `scripts` and `includedScripts`; `nx.targets.e2e`: `{ "cache": false, "dependsOn": ["build"] }`)

**Interfaces:**
- Consumes: the built app (`dist/`), `main.ts`'s `RAVEN_DESKTOP_USER_DATA` hook and `raven-launch-ms` stdout mark (Task 10).
- Produces (`e2e/harness.ts`): `launchApp({ userData }: { userData: string }): Promise<{ app: ElectronApplication; page: Page }>` (`_electron.launch({ args: ['.'], cwd: <project dir>, env: { ...process.env, RAVEN_DESKTOP_USER_DATA: userData } })`, then `firstWindow()`); `openFile({ app, path }): Promise<void>` (`app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault: () => undefined }, file) }, path)`, the same event Finder sends); `freshUserData(): Promise<string>` (`mkdtemp`). `e2e/clips.ts`: `makeClips(): Promise<{ folder: string; first: string; second: string }>` writing, once per run into a temp folder, `Clip 01.mp4` and `Clip 02 Été.mp4` (30 s each) plus the decoys `._Clip 01b.mp4` (a few bytes) and `notes.txt`, with `RAVEN_E2E_FFMPEG ?? 'ffmpeg'` and `-f lavfi -i testsrc2=size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 30 -c:v h264_videotoolbox -allow_sw 1 -b:v 1M -pix_fmt yuv420p -c:a aac -movflags +faststart`; a failing ffmpeg throws an `Error` naming the binary and its stderr.

`playwright.config.ts`: `testDir: 'e2e'`, `testMatch: '**/*.e2e.ts'` (Bun's runner never picks these up), `workers: 1`, `timeout: 60_000`, `retries: process.env.CI ? 1 : 0`, `forbidOnly: !!process.env.CI`, `reporter: 'list'`, `use: { trace: 'retain-on-failure' }`, `outputDir: 'test-results'`, default export.

Tests (spec section 9 "End to end", P4's part):

- [ ] **Step 1: `player.e2e.ts`**, a `test.describe.serial` block sharing one userData made in `beforeAll` (the second test reads what the first left).
  - "opens a clip from Finder, plays, pauses, seeks and resumes after a relaunch": `openFile(first)`; heading `Clip 01` visible; the page's `video` reaches `readyState >= 2` and `paused === false`; press `5` and expect `currentTime` within 1 s of 15; press `k` and expect `paused`; a link named `Next: Clip 02 Été` is visible (the folder's decoys skipped, unicode and spaces intact); `app.close()`; relaunch with the same userData; `openFile(first)`; text `Resumed at 0:15` visible.
  - "lists recents after a relaunch and removes one": relaunch on the same userData: Home lists a button with `Clip 01` and a `progress` named `50% watched`; Escape from the player returns to Home; "Remove from recents" removes it and `Nothing opened yet.` shows.
  - "refuses a File the page made": dispatch on `window` a `drop` whose `DataTransfer` holds `new File(['x'], '/tmp/Clip 01.mp4')`; `Drop a video file to play it.` shows in `role="status"` and the URL is still Home.
- [ ] **Step 2: `security.e2e.ts`.**
  - `typeof require` and `typeof process` in the page are `'undefined'`;
  - `location.href = 'https://example.com'` leaves `page.url()` starting `app://raven/`;
  - `window.open('about:blank')` returns `null` and no second window appears (`app.windows().length === 1`);
  - the bridge refuses a request off its list: `window.ravenDesktop.request({ type: 'readFile', path: '/etc/hosts' })` (reached through `'ravenDesktop' in window` and a `typeof ... === 'function'` check) resolves an object whose `type` is `'refused'`;
  - `fetch('/index.html')` answers with the exact CSP header; `fetch('/%2e%2e/package.json')` is not 200;
  - a `video` element given `src = 'raven-file://00000000-0000-4000-8000-000000000000'` fires `error`.
- [ ] **Step 3: `launch.e2e.ts`.** Five sequential launches (a `reduce` over promises), each with fresh userData, read `raven-launch-ms <n>` from `app.process().stdout`; the median stays under 1,600 ms (twice the 800 ms cold budget, spec section 8).
- [ ] **Step 4: Verify on macOS.** `bunx nx run @raven/desktop:e2e` passes locally; `bunx nx run-many -t typecheck lint:ts format:check -p @raven/desktop` passes (the e2e files typecheck through `tsconfig.preload.json`).
- [ ] **Step 5: Commit** `MAE: add the desktop end to end suite`.

---

### Task 12: Forge packaging and the macOS CI job

**Files:**
- Create: `apps/raven/desktop/src/build/forgeOptions.ts`, `src/build/forgeOptions.test.ts`
- Create: `apps/raven/desktop/forge.config.ts`
- Modify: `apps/raven/desktop/package.json` (`"package": "electron-forge package"`, `"make": "electron-forge make"` in `scripts` and `includedScripts`; `nx.targets.package` and `nx.targets.make`: `{ "cache": false, "dependsOn": ["build"] }`)
- Modify: `.github/workflows/pull-request-checks.yml`

**Interfaces:**
- Consumes: `VIDEO_EXTENSIONS` from `@raven/core`; `@electron-forge/shared-types` (`ForgeConfig`), `@electron-forge/maker-zip` (`MakerZIP`), `@electron-forge/plugin-fuses` (`FusesPlugin`), `@electron/fuses` (`FuseVersion`, `FuseV1Options`).
- Produces (`@/build/forgeOptions`):

```ts
export const DOCUMENT_UTIS = [
  'public.movie', 'public.mpeg-4', 'com.apple.quicktime-movie', 'public.avi',
  'public.mpeg-2-transport-stream', 'org.matroska.mkv', 'org.webmproject.webm',
] as const
export type DocumentUti = (typeof DOCUMENT_UTIS)[number]
export const utiFor = (extension: string): DocumentUti | null
export const documentTypes = (extensions: readonly string[]): {
  CFBundleDocumentTypes: { CFBundleTypeName: string; CFBundleTypeRole: 'Viewer'; LSHandlerRank: 'Alternate'; LSItemContentTypes: DocumentUti[] }[]
  UTImportedTypeDeclarations: { UTTypeIdentifier: string; UTTypeDescription: string; UTTypeConformsTo: string[]; UTTypeTagSpecification: { 'public.filename-extension': string[]; 'public.mime-type': string[] } }[]
}
export const FUSES = {
  RunAsNode: false, EnableNodeOptionsEnvironmentVariable: false, EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true, OnlyLoadAppFromAsar: true, EnableCookieEncryption: true,
} as const
export const signingFrom = (env: Readonly<Record<string, string | undefined>>):
  { osxSign?: { identity: string }; osxNotarize?: { keychainProfile: string } }
export const isPackagedPath = (file: string): boolean
```

Rules (spec sections 4 and 7):
- `utiFor` lowercases its input, then: `mp4`, `m4v` `public.mpeg-4`; `mov` `com.apple.quicktime-movie`; `avi` `public.avi`; `ts`, `m2ts`, `mts` `public.mpeg-2-transport-stream`; `mkv` `org.matroska.mkv`; `webm` `org.webmproject.webm`; `3gp`, `flv`, `mpeg`, `mpg`, `ogv`, `wmv` `public.movie` (they conform to it where macOS knows them); anything else `null`. Never a bare extension in `CFBundleDocumentTypes`, so `.ts` source files stay with the editor.
- `documentTypes` throws an `Error` naming every extension `utiFor` cannot place (so a new entry in core's `VIDEO_EXTENSIONS` fails the test until it is mapped), and returns one document type `{ CFBundleTypeName: 'Video', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes }` whose UTIs are the used ones in `DOCUMENT_UTIS` order, plus imported declarations for `org.matroska.mkv` (`Matroska video`, conforms to `public.movie`, extension `mkv`, mime `video/x-matroska`) and `org.webmproject.webm` (`WebM video`, `public.movie`, `webm`, `video/webm`).
- `signingFrom`: nothing when `RAVEN_SIGN_IDENTITY` is unset or empty (ad hoc, the default); `osxSign: { identity }` when set; `osxNotarize: { keychainProfile: RAVEN_NOTARIZE_PROFILE }` only when both are set.
- `isPackagedPath`: true for `''`, `/package.json`, `/dist` and anything under `/dist/`; false for `/node_modules/...`, `/src/...`, `/e2e/...`, `/out/...`, `/forge.config.ts`.
- `forge.config.ts` (default export, relative import of `./src/build/forgeOptions` per Ruling 11): `packagerConfig: { name: 'raven player', executableName: 'raven player', appBundleId: 'io.github.codebend3r.raven', appCategoryType: 'public.app-category.video', asar: { unpack: '**/*.node' }, prune: false, ignore: (file) => !isPackagedPath(file), protocols: [{ name: 'raven link', schemes: ['raven'] }], extendInfo: documentTypes(VIDEO_EXTENSIONS), ...signingFrom(process.env) }`; `makers: [new MakerZIP({}, ['darwin'])]`; `plugins: [new FusesPlugin({ version: FuseVersion.V1, [FuseV1Options.RunAsNode]: FUSES.RunAsNode, ... })]` for all six. With no `osxSign`, the plugin resets the ad hoc signature on arm64 after flipping fuses. `prune: false` plus the `ignore` filter keeps Bun's symlinked `node_modules` out of the asar; main and preload are self-contained bundles.

- [ ] **Step 1: Write the failing tests** (`forgeOptions.test.ts`): `utiFor('MKV')` is `'org.matroska.mkv'`; `utiFor('srt')` is `null`; `documentTypes(VIDEO_EXTENSIONS)` has exactly one document type with `LSItemContentTypes` equal to `DOCUMENT_UTIS` in order, rank `Alternate`, role `Viewer`; its imported declarations are the two above, exactly; `documentTypes(['mp4', 'xyz'])` throws an error mentioning `xyz`; `JSON.stringify(documentTypes(VIDEO_EXTENSIONS))` contains no `"ts"` inside `CFBundleDocumentTypes`; `FUSES` matches the Global Constraints; `signingFrom({})` is `{}`; with only `RAVEN_NOTARIZE_PROFILE` it is `{}`; with both it has both; the `isPackagedPath` table above.
- [ ] **Step 2: Run to verify they fail**, **implement** `forgeOptions.ts` and `forge.config.ts`, **verify** `bunx nx run-many -t typecheck lint:ts format:check test -p @raven/desktop` passes.
- [ ] **Step 3: Package and inspect by hand** (macOS): `bunx nx run @raven/desktop:package`, then on `out/raven player-darwin-arm64/raven player.app`:
  - `plutil -p .../Contents/Info.plist` shows `CFBundleIdentifier` `io.github.codebend3r.raven`, the one document type with the seven UTIs and `LSHandlerRank` `Alternate`, both imported declarations, and `CFBundleURLTypes` with scheme `raven`;
  - `bunx @electron/fuses read --app ".../raven player.app"` shows the six fuses as set;
  - `codesign --verify --deep --strict ".../raven player.app"` passes;
  - `open -a ".../raven player.app" <M1.mp4>` plays M1 through the html engine on a cold launch, and again warm (P0's explicit-app LaunchServices delivery); the state lands in `~/Library/Application Support/raven/player-state.json` (`RAVEN_DESKTOP_USER_DATA` is ignored when packaged);
  - `bunx nx run @raven/desktop:make` writes a zip under `out/make/zip/darwin/arm64/`.
  Record the results in the commit body. Finder double-click, Dock drops and Safari or Chrome link clicks stay in the manual matrix (P0's pending gates).
- [ ] **Step 4: CI.** In `pull-request-checks.yml`:
  - the Ubuntu `checks` job's `env` gains `ELECTRON_SKIP_BINARY_DOWNLOAD: '1'` with a comment that nothing there launches Electron;
  - in the `desktop` job, replace the comment `# P4 adds shell/e2e targets, P7 adds app packaging. Do not call absent targets.` and, after `🧪 Real headless libmpv tests`, add: `🏗️ Build desktop app` running `bunx nx run @raven/desktop:build` (its log carries Vite's gzip sizes for the 250 KB budget); `🎬 Desktop end to end` running `bunx nx run @raven/desktop:e2e` with `env: RAVEN_E2E_FFMPEG: ${{ github.workspace }}/libs/raven/mpv/native-build/prefix/bin/ffmpeg` (the runner's logged-in GUI session shows the window; e2e launches `electron .`, never the packaged app, because the packaged app's fuses turn off the inspector Playwright needs); `📤 End to end traces` with `if: failure()` uploading `apps/raven/desktop/test-results` (`if-no-files-found: ignore`); `📦 Make the unsigned app` running `bunx nx run @raven/desktop:make`; `📤 Unsigned raven player` uploading `apps/raven/desktop/out/make` as `raven-player-darwin-arm64-${{ github.event.pull_request.head.sha }}` (`if-no-files-found: error`). Keep the two existing native uploads.
  - The native cache key hashes this workflow file, so this PR's first run rebuilds libmpv from source once; that is expected and needs no change.
- [ ] **Step 5: Verify.** `bun run verify` passes from the root (spellcheck, TypeScript only, one command per script, lint, format, typecheck, test, build). Push and check the `🖥️ Desktop` job goes green with both new uploads (only when the user has asked for a push).
- [ ] **Step 6: Commit** `MAE: package raven player with Forge and run its e2e in CI`.

---

## Self-review notes

- **Spec coverage (P4):** `player.ts` (Task 1); `node.json` presets (Task 2); `app://raven` with CSP and containment (Tasks 6, 10); security baseline, permissions, sender checks (Tasks 6, 10); fuses (Task 12); menus (Task 10); Home, Play, Settings (Tasks 8, 9); grants (Task 5); open dialog (Tasks 7, 10); drop through `webUtils.getPathForFile` (Tasks 8, 10); `open-file` queued from `will-finish-launching` (Task 10); document types by UTI, `Alternate` rank (Task 12); `raven://` registration (Tasks 10, 12); the JSON store with recents, resume, track picks, window bounds, corrupt handling, atomic writes, last write at quit (Tasks 4, 10); next in folder by natural order with granted siblings (Tasks 5, 7, 9); opening while playing saves first (Task 9); the html engine over `raven-file://` ranges (Tasks 6, 9); Forge config with signing behind env vars (Task 12); Playwright e2e and the launch budget (Task 11); CI build, e2e and make (Task 12). Keyboard and accessibility for Home and Settings: focus on arrival and labels (Tasks 8, 9); the player's own shortcuts come from `@raven/ui`.
- **Types used across tasks:** `GrantedFile`, `Grants` (5) in 6 and 7; `StateStore`, `FileFacts`, reducers (4) in 7 and 10; `DesktopReply`, `DesktopEvent`, `MenuPlayerAction`, `MAX_QUEUE` (2) in 7 to 10; `DesktopClient`, `MenuHub`, `useOpenReply`, `RECENTS_KEY` (8) in 9; `HostActions`, `PlayerAction`, `ProgressSink.duration` (3) in 9; `Timers` (4) in 10.
