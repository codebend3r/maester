# raven desktop release (P7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship step P7 of the desktop spec, the first release of raven player for macOS arm64. The packaged app carries libmpv, MoltenVK and the addon outside the asar, with every Mach-O signed ad hoc from the inside out, and plays natively instead of falling back to html. `make` produces a dmg and a zip. `desktop-release.yml` builds, audits and smoke-tests the app on a release tag and attaches the dmg, the zip, the matching sources and `SHA256SUMS` to the tag's GitHub release; a dry run proves it on the PR. The app gains the daily update check (Settings switch, Check for Updates, a quiet notice), the crash reporter, a rotating log of launches, opens, refusals, mpv's warnings and every budget mark, the memory and CPU budget marks, Help's Show Logs, Show Crash Reports and Copy Diagnostics, and the docs.

**Architecture:** Main-process logic stays in pure modules that take Electron, the file system and the network as arguments (`src/main/log/`, `budgets.ts`, `diagnostics.ts`, `help.ts`, `updates.ts`, `updateService.ts`), so `bun test` covers them; `src/main/main.ts` alone wires them. Packaging logic lives in `src/build/` with no project imports, because Forge loads `forge.config.ts` through jiti: a staging step copies the CI-built `@raven/mpv` resources into `staging/mpv`, Forge's `extraResource` puts them at `Contents/Resources/mpv/darwin-arm64` (the path `addonPathFor` already reads), the `postPackage` hook signs every Mach-O deepest first and the app last, and a small custom maker builds the dmg with `hdiutil`. A bundle audit (`audit:bundle`) and a packaged smoke (`smoke:packaged`) run after `make` locally, in the PR's Desktop job and in the release workflow, which share one composite action for the native build.

**Tech Stack:** Electron 44.7.0 (`crashReporter`, `app.setAppLogsPath`, `app.getAppMetrics`, `net.fetch`, `clipboard`, `shell.openPath`, `dialog.showMessageBox`), Electron Forge 8.0.1 (`extraResource`, `postPackage`, `@electron-forge/maker-base` 8.0.1 for the dmg maker, `maker-zip`), `codesign`, `otool`, `lipo`, `plutil`, `hdiutil`, `ditto`, GitHub Actions on `macos-26` with `gh`, `@raven/mpv` (unchanged), React 19.3 + React Router 7 + TanStack Query 5, `bun test` + happy-dom, `@playwright/test` 1.64.1 `_electron`, Nx 23 over Bun 1.4.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (P7 under "Order of work > Phase 1"; sections 4 "Menus", "Settings" under "Screens", "Security", 5 "Bundling libmpv", 7 in full, 8, 9, "Risks", "Rollout", "Verification", "Follow-ups"). Builds on `docs/superpowers/plans/2026-10-16-raven-desktop-shell.md` (P4), `2026-10-16-raven-desktop-native-playback.md` (P5) and `2026-10-16-raven-desktop-server-titles.md` (P6); their Rulings still hold, and P7 owns every row their "Deferred" tables mark P7.

## Rulings (where the spec, the earlier plans and the repo disagree or the spec is silent)

1. **The addon and libmpv are staged, then copied by `extraResource`.** Forge copies an `extraResource` entry into `Contents/Resources/` under its own name, so `stage:mpv` copies exactly `raven_mpv.node`, `lib/libmpv.2.dylib`, `lib/libMoltenVK.dylib` and `provenance/**` (the license notices and receipts) from `libs/raven/mpv/resources/darwin-arm64` into the gitignored `apps/raven/desktop/staging/mpv/darwin-arm64`, and `extraResource: ['staging/mpv']` lands them at `Contents/Resources/mpv/darwin-arm64`, the packaged `addonPathFor` path from P5 Ruling 2. The loader-relative rpaths CI already writes (`@loader_path/lib` in the addon, `@loader_path` in libmpv) keep working because the layout is unchanged. `stage:mpv` fails when any of the three Mach-O files is missing, so `package` and `make` never produce an app without the video engine.
2. **Sign inside out, never `--deep`.** The `postPackage` hook (ad hoc only, as today) lists every regular Mach-O file and every `.app` or `.framework` directory inside the app (symlinks skipped), signs them with `codesign --sign - --force <path>` deepest path first, then the app itself, then runs `codesign --verify --deep --strict --verbose=2` on the app (`--deep` is fine for verifying). `adHocSealArgs` and its `--deep` go.
3. **The dmg comes from `hdiutil`, not `@electron-forge/maker-dmg`.** That maker's only backend, `electron-installer-dmg`, needs `appdmg`, whose `fs-xattr` and `macos-alias` are node-gyp addons; Bun does not run untrusted install scripts, so they would never build, and they would join every Ubuntu install. A 60-line maker on `@electron-forge/maker-base` 8.0.1 copies the app with `ditto` (signatures and symlinks intact) beside an `Applications` link and runs `hdiutil create -format UDZO`.
4. **Release assets have no spaces, and the sources ship with them.** `raven-player-<version>-arm64.dmg`, `raven-player-<version>-arm64.zip`, `raven-player-<version>-sources.tar.gz` and `SHA256SUMS` (all three, `shasum -a 256 -c` format). The repo is public, so a release is public distribution: `libs/raven/mpv/README.md` says P7 must ship the matching source bundle with the app, and the spec's Risks say a public build needs the source offer. The tarball is CI's `libs/raven/mpv/native-build/source-bundle` (every pinned upstream archive, both patches, the build scripts and the exact repository revision).
5. **`desktop-release.yml` triggers on three-number tags only**, `v[0-9]+.[0-9]+.[0-9]+` and `v[0-9]+.[0-9]+.[0-9]+-*`, rather than the spec's `v*`, so a hand-pushed build tag (`v0.5.4.9`) never builds a dmg. (Build tags made by `main-smoke-test.yml` use `GITHUB_TOKEN`, which triggers no workflow anyway.) `release.yml` is unchanged and still creates the release from the commit log; the desktop workflow fails fast unless the tag is `v` plus `apps/raven/desktop/package.json`'s version, waits up to 10 minutes for `release.yml`'s release to exist, uploads with `--clobber` (a re-run replaces), and appends `apps/raven/desktop/release/install-notes.md` to the notes once (only when the body lacks its `## Installing raven player` heading).
6. **The dry run is a `pull_request` (path-filtered) or `workflow_dispatch` run, which never publishes.** A `workflow_dispatch` workflow can only be dispatched once its file is on the default branch, so the PR proves the workflow through a `pull_request` trigger filtered to the files that shape a release. Only a tag `push` runs the `publish` job. Nobody in this work pushes a tag.
7. **One composite action builds the native pieces for both workflows**, `.github/actions/raven-desktop-native/action.yml` (Bun, the toolchain, install, the wrapper, the cached libmpv build, `build:native`, `audit:native`), so the release builds exactly as the PR job does and the `🖥️ Desktop` check keeps its name. The cache key swaps `.github/workflows/pull-request-checks.yml` for the action file, so editing the PR workflow no longer rebuilds libmpv. A tag run cannot read a PR's cache, so it builds libmpv cold (hence a 150-minute timeout) unless a dispatch on `main` warmed `main`'s cache first; the README says so.
8. **The update check reads the releases list, not `/releases/latest`.** `main-smoke-test.yml` marks every build release (`vX.Y.Z.N (<sha>)`) as latest, and those carry no app. The check reads `GET https://api.github.com/repos/codebend3r/maester/releases?per_page=30` and takes the highest `vX.Y.Z` (exactly three numbers) that is neither a draft nor a prerelease and carries an asset named `raven-player-<X.Y.Z>-arm64.dmg`, so a release whose desktop job has not finished is not offered. The release page link is built from that tag (`https://github.com/codebend3r/maester/releases/tag/vX.Y.Z`), never taken from the reply. Nothing is downloaded or installed. (Final review C1: GitHub sorts the list by tag name, so the check now asks for `per_page=100`, follows same-list `Link: rel="next"` pages up to 5, and reports "GitHub listed no raven player release." rather than "newest" when nothing it read carries the app. The spec's P7 outcome 8 has the details.)
9. **`desktop-config.json` becomes version 3** with `updates: { isEnabled: boolean, checkedAt: number | null }`, read from versions 1 and 2 as `{ isEnabled: true, checkedAt: null }`. A check is due at launch when it is enabled and `checkedAt` is null, at least 24 hours old, or in the future (a clock moved back). The menu's check always runs.
10. **Unpackaged, the launch check runs only when the test hook `RAVEN_DESKTOP_RELEASES_URL` is set** (and then against that URL); the menu's check uses GitHub unless the hook is set. So `dev` and e2e never call GitHub on their own. Packaged, the hook is never read.
11. **Logs live in `~/Library/Logs/raven`**, pinned with `app.setAppLogsPath` for the same reason `userData` is pinned to `raven` (the rename to "raven" must move nothing); with the `RAVEN_DESKTOP_USER_DATA` hook they go to `<userData>/logs`. The spec's "`logs`" is Electron's `logs` path. Files are `raven.log` then `raven.log.1` to `raven.log.4`, each at most 1,048,576 bytes; the folder is created `0o700` and the files `0o600`. Crash dumps stay in Electron's `crashDumps` path, pinned to `<userData>/Crashpad` before `crashReporter.start`.
12. **What the log never holds:** cookie values, request bodies, PINs, passwords, file paths or file names. Opens are logged as `open file .mkv` (the extension only) or `open server title 7 on <server name>`. Every line passes `redact`, which blanks `Cookie:` and `Set-Cookie:` header values, `raven_unlock=` and `raven_admin=` values and JSON `"pin"` and `"password"` strings, in case an mpv warning or an error message carries one (mpv's warnings can name a server's file URL, which holds no secret and stays). Control characters become spaces and a line is cut at 4,096 characters. At most 200 lines are written per 10 s; the rest are counted and one `log: <n> lines dropped` line follows, so an mpv warning flood cannot evict the history.
13. **The budget marks are always on and always logged.** The marks module, the quit mark and the launch mark write to the log, packaged too; unpackaged they still also print on stdout, which e2e reads (P5 Ruling 14). New marks: `raven-open-to-frame-ms` (the first `open-file` before the window is ready to that file's first frame, the spec's cold "Open With" budget), `raven-memory-idle-mb` (the sum of `app.getAppMetrics()` working sets after 60 s on Home), `raven-memory-playing-mb` (every 10 s while playing) and `raven-cpu-paused-percent` (the summed `percentCPUUsage` over 60 s paused; Electron counts 100 as one full core). The test hook `RAVEN_DESKTOP_BUDGET_MS` (unpackaged only) shortens both the 60 s window and the 10 s period. e2e asserts only the idle mark under twice its budget, as P4 does for launch; playing M2 and paused CPU are measured by hand.
14. **No addon rebuild and no `@raven/mpv` change in P7.** The three "next addon rebuild" items (`access-references=no` in the addon's init options, the teardown-hook segfault, playlist entry ids) stay in Follow-ups. A release should ship the addon, wrapper and libmpv that P5 and P6 CI exercised; this Mac cannot build the addon (no `native-build/prefix`), so every C++ change would be proven only by CI round trips; `access-references=no` is already set by the player service before any load, which refuses loads when it fails; the segfault needs Node to tear down with a live player, which the shutdown order prevents; and the reply-ordered stale-event gating is tested. It also keeps `libs/raven/mpv/src/**` out of the native cache key's churn. Diagnostics read only properties the wrapper already guards (`mpv-version`, `ffmpeg-version`, `hwdec-current`) and report the profile's `hwdec=auto` as the constant the addon sets.
15. **Copy Diagnostics** holds the app's version and whether it is packaged, the macOS version, the Electron, Chromium and Node versions, the mpv and FFmpeg versions (or why the engine is unavailable), `hwdec=auto` and `hwdec-current` (or `none (nothing playing)`), the window's display refresh rate from Electron and from mpv, and the EDR headroom. It holds no paths, file names, server origins or names, or cookies.
16. **The packaged smoke runs the packaged binary as a person would**, with no test hook (a packaged app reads none): it launches `Contents/MacOS/raven player`, waits for its launch, engine and launch-mark lines in `~/Library/Logs/raven/raven.log`, sends `SIGTERM` (Electron should quit through `before-quit` on it; Task 10 proves it, with its fallback there), and expects the quit mark and an exit within 5 s. It therefore uses the real `~/Library/Application Support/raven` and `~/Library/Logs/raven`: disposable on CI, the developer's own on a Mac (it opens nothing; as a packaged app it makes the real launch check against GitHub, which writes `updates.checkedAt` and moves an older `desktop-config.json` to version 3), and it refuses to start while another raven player runs.
17. **The version is already shared.** `scripts/bump_version.sh` writes every `apps/*/*/package.json`, including the desktop's, so `version-bump` covers it and About shows `app.getVersion()`. P7 pins it: the bundle audit checks the packaged `CFBundleShortVersionString` against `package.json`, and the release workflow checks the tag. Nothing edits a version by hand.
18. **Developer ID signing and notarization stay as P4 wired them**, `signingFrom` reading `RAVEN_SIGN_IDENTITY` and `RAVEN_NOTARIZE_PROFILE`, and no workflow sets either. With an identity, `@electron/osx-sign` signs every Mach-O it finds, the staged resources included; that path stays untested until a certificate exists.
19. **The update notice is quiet:** an `aside` in the Shell, shown on Home and Settings only, never on a watch route (the quiet page), with "See what's new" and "Dismiss". The renderer never holds the release URL: "See what's new" sends `openRelease`, and main opens the page it built (Ruling 8).

## Deferred, so nothing is lost

| Spec item | Lands in |
| --- | --- |
| Developer ID signing, notarization, Squirrel.Mac silent updates | When a certificate exists (spec "Signing", "Updates") |
| `access-references=no` in the addon's init options, the addon's teardown-hook segfault, playlist entry ids from the addon | The next addon rebuild (Ruling 14) |
| Real-hardware gates: XDR and 120 Hz, Gatekeeper on a downloaded build, Safari and Chrome `raven://` clicks, Finder Open With and double-click, Dock drop | "Testing for the PR" below, by hand |
| A server advertising its canonical origin (the Netlify handoff), a server name endpoint | Follow-ups |
| Library modes, embedded server, `Platform`, standalone ffmpeg, macOS x64 | D1 to D5 |

## Global Constraints

Binding for every task. From the root `CLAUDE.md` and the P4 to P6 plans unless marked.

- Run tasks through Nx from the repo root. Every task ends green on `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop @raven/ui @raven/core @raven/mpv @raven/web`, and `bunx nx run @raven/desktop:e2e` stays green on macOS (35 tests at the start of P7). The `@raven/mpv` "native wake/teardown races" test is a known local flake that passes on CI; it is not a P7 failure.
- TypeScript only: no `.js`, `.jsx`, `.mjs` or `.cjs` source or config file. A `package.json` script runs one command (`bun run --sequential a b`, never `&&`, `||` or `;`); every desktop script is in `nx.includedScripts`. Workflow and composite action YAML may run shell.
- Imports of a project's own modules go through `@/` with no extension; assets keep theirs. Exceptions: `forge.config.ts`, which imports the `src/build/` files Forge loads relatively (`forgeOptions.ts`, `machO.ts`, `stageMpv.ts`, `dmgMaker.ts`); those four import nothing from the project, because jiti does not read tsconfig `paths`.
- No em dashes or en dashes anywhere, including comments, UI copy, test names, docs, workflow names and release notes.
- Type guards wherever possible; never `any`; never cast (`as const` is not a cast); `unknown` when a type cannot be inferred; discriminated unions switched with a `never` check in `default`; no enums (a library's own, such as `FuseV1Options`, may be used); `type`, never `interface`; `as const satisfies T`; derive types (`Infer`, `ReturnType`, indexed access); no non-null assertion outside tests; never `@ts-ignore`.
- Validate untrusted data at the boundary with a guard: every IPC payload in main and in the renderer, files read from disk, every GitHub reply, every `otool`, `codesign` and `plutil` output parsed by the audit. Past the boundary, trust the narrowed type.
- No `for`, `for...of` or `for...in`; array methods, `reduce`, recursion for sequential async work. `!!value`; `?.` with `??`; one object parameter (library-fixed callbacks and class methods a base class fixes exempt); JSX `&&`; guard clauses; `const`; never mutate inputs; `??` for defaults; no floating promises; throw only `Error`s; named exports only (Forge's default-exported config exempt); booleans named `is`/`has`/`should`/`can`; comments only for a non-obvious why.
- CSS: SCSS modules through `@/`; grid with `gap` and container padding, no flex, no margins for spacing; named `grid-template-areas` in fixed layouts; semantic elements first; raven's tokens from `libs/raven/ui/src/styles/globals.scss`; desktop first (`30rem`, `40rem`, `48rem`, `64rem`); works at 320px; motion inside `@media (prefers-reduced-motion: no-preference)`; no `:global()`; a label on every control and `:focus-visible` with `--focus-ring`.
- Main-process modules other than `src/main/main.ts` import `electron` with `import type` only and take Electron's pieces, the file system, the network and mpv as arguments. Only main-process code imports `@raven/mpv`.
- **Security posture (P4 to P6, binding):** the renderer holds only ids, no cookies, no URLs, no network beyond `app://raven`; the CSP and `connect-src 'self'` are unchanged; fuses unchanged (`RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on). The only network call the app makes on its own is the release check to `api.github.com`, which the Settings switch turns off; it sends no cookie (`credentials: 'omit'`) and nothing about the machine beyond a `user-agent` of `raven-player/<version>`. No telemetry, no upload: `crashReporter.start({ uploadToServer: false })`.
- Test hooks (`RAVEN_DESKTOP_USER_DATA`, `RAVEN_DESKTOP_MPV`, and P7's `RAVEN_DESKTOP_RELEASES_URL` and `RAVEN_DESKTOP_BUDGET_MS`) are read only when `app.isPackaged` is false.
- Never build libmpv or the addon locally; use the CI-built `libs/raven/mpv/resources/darwin-arm64` already in the worktree (gitignored). `bunx nx run @raven/desktop:make` works locally and packages those real resources.
- Never push a tag, never run `scripts/bump_version.sh`, never edit a version, never set `RAVEN_SIGN_IDENTITY` or `RAVEN_NOTARIZE_PROFILE`.
- Commits follow the `commit-format` skill: `MAE:` subject, short bullet body, no agent attribution. Never `--no-verify`.

## Review Focus

The inputs most likely to bite a person using the release, most likely first. Each has its test in the owning task.

1. **A secret reaching the log:** an mpv warning that echoes `http-header-fields`, an error message carrying `Cookie: raven_unlock=...`, a body with a PIN. Redacted before it is written, and an e2e run with a cookie-gated title leaves no cookie value in the log. (Task 1 `redact` tests; Task 2 e2e.)
2. **A log that cannot keep up or cannot be written:** mpv spamming a warning per frame, a read-only or missing `~/Library/Logs`, a full disk. Capped at 200 lines per 10 s, rotated at 1 MiB across 5 files, failures reported once to the console, never a throw, never a stalled quit. (Task 1 flood, rotation and failure tests; Task 2 quit stays within the e2e quit budget.)
3. **GitHub answering something other than a newer release:** a build release marked latest (`v0.5.4.9`), a prerelease, a draft, a release whose dmg is not attached yet, `v10.0.0` against `v9.9.9`, a 403 rate limit, HTML, 3 MB of JSON, a hang, an `html_url` pointing elsewhere. Only a newer full release with the dmg is offered, the link is always `https://github.com/codebend3r/maester/releases/tag/vX.Y.Z`, failures are one quiet line. (Task 5 tests; Task 7 e2e.)
4. **A bundle that reaches outside itself or is not sealed:** an absolute `/opt/homebrew` link or rpath, an `@rpath` dylib missing from `Resources/mpv`, a Mach-O signed before a later step changed it, a non-arm64 file. The audit fails `make`'s job with the file named. (Task 10 tests; Task 8 sign order tests.)
5. **The packaged app without a working engine** (a damaged addon, a libmpv that will not load): it still launches, plays through html, logs why, and Copy Diagnostics says `Video engine: unavailable (...)`. (Task 4 tests; Task 10 smoke fails loudly when the engine line is missing; manual check with the resources removed.)
6. **The release racing itself:** the desktop job finishing before `release.yml` made the release, a re-run on a release that already has assets or notes. It waits, replaces assets, appends the install notes once. (Task 11; the dry run never publishes, so the reviewer reads the `publish` job against these three cases, and the first real tag exercises it.)
7. **Clocks and switches in "once a day":** `checkedAt` in the future, the switch turned off then on, a menu check while the switch is off. Due when stale or in the future; the menu always checks; off means no launch call. (Task 5 `isCheckDue` tests; Task 6 service tests.)
8. **Diagnostics leaking what the user did not mean to send:** a file path, a server origin, a cookie. None of them appear. (Task 4 tests assert their absence.)

---

### Task 1: The rotating log

**Files:**
- Create: `apps/raven/desktop/src/main/log/log.ts`, `src/main/log/log.test.ts`

**Interfaces:**
- Consumes: `Timers` (`@/main/stateStore`).
- Produces (`@/main/log/log`):

```ts
export const LOG_FILE = 'raven.log'
export const LOG_MAX_BYTES = 1_048_576
export const LOG_FILES = 5
export const LOG_LINE_MAX = 4096
export const LOG_BURST_LINES = 200
export const LOG_BURST_MS = 10_000
export type LogLevel = 'info' | 'warn' | 'error'
export type LogFs = {
  mkdir: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>
  size: (path: string) => Promise<number | null>
  appendFile: (path: string, data: string, options: { mode: number }) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  remove: (path: string) => Promise<void>
}
export type Log = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  /** Resolves once every line written so far is on disk. */
  flush: () => Promise<void>
  isDirty: () => boolean
  file: string
}
export const redact = (text: string): string
export const logLine = ({ at, level, message }: { at: number; level: LogLevel; message: string }): string
export const rotationMoves = ({ file, files }: { file: string; files: number }): { from: string; to: string }[]
export const createLog = ({ dir, fs, now, timers, onError }: {
  dir: string; fs: LogFs; now: () => number; timers: Timers; onError: (error: unknown) => void
}): Log
```

Rules (Rulings 11 and 12):
- `redact`: `/(cookie|set-cookie)(\s*:\s*)[^\r\n]*/gi` keeps the header name and separator and writes `[redacted]`; `/(raven_unlock|raven_admin)=[^;,\s"]*/g` becomes `$1=[redacted]`; `/("(?:pin|password)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi` becomes `$1"[redacted]"`.
- `logLine`: `` `${new Date(at).toISOString()} ${level} ${text}\n` `` where `text` is `redact(message)` with every `/\p{Cc}/gu` replaced by a space, cut to `LOG_LINE_MAX` characters.
- `rotationMoves({ file: '/l/raven.log', files: 5 })` is `[{ from: '/l/raven.log.3', to: '/l/raven.log.4' }, { from: '/l/raven.log.2', to: '/l/raven.log.3' }, { from: '/l/raven.log.1', to: '/l/raven.log.2' }, { from: '/l/raven.log', to: '/l/raven.log.1' }]`.
- `createLog`: `file` is `join(dir, LOG_FILE)`. Calls only queue; one drain at a time runs on `timers.set(..., 0)`: the first drain `mkdir(dir, { recursive: true, mode: 0o700 })` and reads `size(file)` (null is 0); a batch that would take the file past `LOG_MAX_BYTES` first removes `raven.log.4` (a missing file is not an error), applies `rotationMoves` in order (a missing source is skipped) and starts the count at 0; then one `appendFile(file, batch, { mode: 0o600 })`. More than `LOG_BURST_LINES` lines inside one `LOG_BURST_MS` window (from `now()`) are dropped and counted; the first line after the window closes is preceded by `log: <n> lines dropped`. A failing fs call reports `onError` once per failure kind and drops that batch; nothing throws to a caller. `flush` resolves after the current and queued drains; `isDirty` is true while any line is queued or being written.

- [ ] **Step 1: Write the failing tests** in `log.test.ts` with an in-memory `LogFs` (a `Map` of path to text, a switch to make each call reject) and fake timers that run on demand:
  - "blanks cookie headers, unlock cookies and JSON secrets": `redact('mpv http: Cookie: raven_unlock=a.b; raven_admin=c')` is `'mpv http: Cookie: [redacted]'`; `redact('url?x=1 raven_admin=zz; other=1')` is `'url?x=1 raven_admin=[redacted]; other=1'`; `redact('{"pin":"3001","x":1}')` is `'{"pin":"[redacted]","x":1}'`; `redact('set-cookie: raven_unlock=t; Path=/api')` is `'set-cookie: [redacted]'`; `redact('https://raven.example/api/media/7/file')` is unchanged.
  - "writes one stamped line per message": `logLine({ at: 0, level: 'warn', message: 'a\nb\u0007c' })` is `'1970-01-01T00:00:00.000Z warn a b c\n'`; a 5,000-character message gives a line of `LOG_LINE_MAX` characters of text plus the stamp.
  - "appends in order and creates the folder private": `info('one')`, `warn('two')`, flush: `mkdir` got mode `0o700`, `appendFile` got mode `0o600` once with both lines in order.
  - "rotates before a write would pass 1 MiB": a file already at `LOG_MAX_BYTES - 10` and a 50-byte line: `raven.log.4` removed, the four renames in `rotationMoves` order, the new `raven.log` holds only the new line; with `raven.log.2` missing the other moves still run.
  - "drops a flood and says how many": 250 lines inside 10 s write 200; advancing `now` past the window and writing one more line writes `log: 50 lines dropped` before it.
  - "never throws when the disk refuses": with `appendFile` rejecting, `info` does not throw, `flush` resolves, `onError` ran once for two failing drains of the same kind; once the fs recovers the next line is written.
  - "is dirty until written": `isDirty()` is false at first, true after `info`, false after `flush`.
- [ ] **Step 2: Run to verify they fail.** `bunx nx run @raven/desktop:test:main`.
- [ ] **Step 3: Implement** `log.ts`.
- [ ] **Step 4: Verify** with the Global Constraints command.
- [ ] **Step 5: Commit** `MAE: keep a rotating raven player log that redacts secrets`.

---

### Task 2: Logs, crash reports and budget marks in main

**Files:**
- Create: `apps/raven/desktop/src/main/log/opens.ts`, `src/main/log/opens.test.ts`
- Modify: `apps/raven/desktop/src/main/player/marks.ts`, `marks.test.ts`, `src/main/quitMark.ts` (doc comment only), `src/main/main.ts`
- Modify: `apps/raven/desktop/e2e/harness.ts`; Create: `apps/raven/desktop/e2e/logs.e2e.ts`

**Interfaces:**
- Consumes: `createLog`, `Log`, `LOG_FILE` (Task 1); `startFixtureServer`, `FIXTURE_MEDIA`, `stubTrustPrompt`, `openUrl` (P6 e2e); `playLinkFor` (core).
- Produces (`@/main/log/opens`):

```ts
export type OpenedTitle = { kind: 'file'; path: string } | { kind: 'server'; serverName: string; mediaId: number }
/** `open file .mkv`, `open file (no extension)`, `open server title 7 on Vhagar`: never a path or a file name. */
export const openLine = (opened: OpenedTitle): string
/** Where the log goes: Electron's pinned logs path, or `<userData>/logs` under the test hook. */
export const logsDirFor = ({ home, userDataOverride }: { home: string; userDataOverride: string | null }): string
```

- Produces (`@/main/player/marks`): `createMarks` gains `opened: () => void` (call on each `open-file` that arrives before the window is ready); `firstFrame` also writes `raven-open-to-frame-ms <n>` once, for the first frame after the first such `opened`, and never again. `isEnabled` stays a parameter; main passes `true`.
- Produces (`@/e2e/harness`): `logPathFor({ userData }: { userData: string }): string` (`<userData>/logs/raven.log`) and `readLog({ userData }): Promise<string[]>` (its lines, `[]` when absent).

`main.ts`, in this order (Rulings 11, 12, 13):
1. Right after `app.setPath('userData', userData)`: `app.setPath('crashDumps', join(userData, 'Crashpad'))`, `crashReporter.start({ uploadToServer: false })`, `app.setAppLogsPath(logsDirFor({ home: app.getPath('home'), userDataOverride }))` where `userDataOverride` is the hook value or null (refactor `userDataDir` to expose it), then `const log = createLog({ dir: app.getPath('logs'), fs, now: Date.now, timers, onError })` over `node:fs/promises` (`size` is `stat(path).then(({ size }) => size, () => null)`; `remove` is `rm(path, { force: true })`); `onError` is `console.error('raven player could not write its log.', error)`.
2. `log.info(\`launch raven player ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'unpackaged'}), Electron ${process.versions.electron}, macOS ${process.getSystemVersion()}\`)` before anything else is logged.
3. `warn` becomes `log.warn(message)` plus `console.warn(message)` when unpackaged; every `console.error(text, error)` in `main.ts` becomes `log.error(\`${text} ${messageOf(error)}\`)` (plus the console when unpackaged). The request handler, trust log, connector and player service already take `warn`; they now reach the log.
4. A `mark(line)` helper: `log.info(line.trim())`, and `process.stdout.write(line)` when unpackaged. The launch mark, `createQuitMark` (with `isEnabled: true`) and `createMarks` (with `isEnabled: true`) write through it. `open-file` calls `marks.opened()` while no window is ready (the marks object moves to app scope so the `will-finish-launching` handler reaches it).
5. Opens: the `handle` given to `createRequestHandler` logs `openLine({ kind: 'file', path })` for a page `describeFile` request whose `fileId` `grants.fileOf` knows (narrow with `isInvokeEnvelope` and `isDesktopRequest`; anything else passes straight through), then calls `service.handle`. Server titles: the `servers.resolve` given to `resolveSourceWith` logs `openLine({ kind: 'server', serverName, mediaId })` after a successful resolve, the name from `serverById`.
6. Engine: after `openNative` resolves, `log.info(\`video engine ready: ${mpv.version}, FFmpeg ${ffmpeg}\`)` with `ffmpeg` from `mpv.read({ name: 'ffmpeg-version' })` (a failed read writes `unknown`). The existing open failure stays `warn` (`raven player could not open its video engine: ...`).
7. Quit: `createShutdown`'s `stores` gains the log (it has `flush` and `isDirty`).

- [ ] **Step 1: Write the failing tests.**
  - `opens.test.ts`: `openLine({ kind: 'file', path: '/Volumes/Media/Secret Film (2024).MKV' })` is `'open file .mkv'`; a path without an extension gives `'open file (no extension)'`; `openLine({ kind: 'server', serverName: 'Vhagar', mediaId: 7 })` is `'open server title 7 on Vhagar'`; the file line contains neither `'Secret'` nor `'/Volumes'`; `logsDirFor({ home: '/Users/a', userDataOverride: null })` is `'/Users/a/Library/Logs/raven'`, with `'/tmp/u'` it is `'/tmp/u/logs'`.
  - `marks.test.ts` (existing tests stand): `opened()` then a `load` then `firstFrame` writes `raven-first-frame-ms <n>` and `raven-open-to-frame-ms <n>` measured from `opened`; a second load's first frame writes only `raven-first-frame-ms`; `firstFrame` without any `opened` writes no open-to-frame mark.
  - `logs.e2e.ts` (headless mpv):
    - "writes the launch, the engine and the budget marks to its log": launch, open the e2e clip through `openFile`, wait for `Pause (k)`, quit; `readLog` holds, in order, a line containing `launch raven player ` and `(unpackaged)`, one containing `video engine ready: mpv v0.`, one containing `raven-launch-ms`, one containing `open file .mp4`, one containing `raven-first-frame-ms`, and one containing `raven-quit-ms`; no line contains the clip's folder or file name.
    - "never writes a cookie": P6's locked fixture (`isLocked: true`, PIN `3001`), `stubTrustPrompt` `add`, a play link to `FIXTURE_MEDIA.first`, unlock with `3001`, play 3 s, quit; the log holds `open server title 1 on 127.0.0.1:<port>`, and no line contains the fixture's issued `raven_unlock` token value or `3001`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (e2e 37).
- [ ] **Step 3: Commit** `MAE: log launches, opens, refusals, mpv warnings and the budget marks`.

---

### Task 3: Memory and CPU budgets

**Files:**
- Create: `apps/raven/desktop/src/main/budgets.ts`, `src/main/budgets.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts`, `e2e/harness.ts` (`launchApp` and `withApp` gain `env?: Readonly<Record<string, string>>`, merged last), `e2e/launch.e2e.ts` (one test)

**Interfaces:**
- Consumes: `PlayerActivity` (`@/main/player/playerService`), `Timers`.
- Produces (`@/main/budgets`):

```ts
export const BUDGET_WINDOW_MS = 60_000
export const PLAYING_SAMPLE_MS = 10_000
export const BUDGETS = { idleMemoryMb: 300, playingMemoryMb: 700, pausedCpuPercent: 2 } as const
export type MetricLike = { memory: { workingSetSize: number }; cpu: { percentCPUUsage: number } }
/** Working sets are in KB; 100 percent is one full core. */
export const sumMetrics = (metrics: readonly MetricLike[]): { memoryMb: number; cpuPercent: number }
export type BudgetState = 'home' | 'playing' | 'paused'
export const stateOf = (activity: PlayerActivity): BudgetState
export const createBudgets = ({ metrics, timers, mark, windowMs, sampleMs }: {
  metrics: () => readonly MetricLike[]; timers: Timers; mark: (line: string) => void
  windowMs: number; sampleMs: number
}): { report: (activity: PlayerActivity) => void; dispose: () => void }
export const budgetWindowFrom = ({ isPackaged, env }: { isPackaged: boolean; env: Readonly<Record<string, string | undefined>> }): number | null
```

Rules (Ruling 13): `sumMetrics` rounds memory to whole MB (`/ 1024`) and CPU to one decimal. `stateOf`: not showing is `home`, showing and playing is `playing`, else `paused`. `createBudgets` starts in `home` at creation and restarts its timers only when the state changes: `home` writes `raven-memory-idle-mb <n>\n` once after `windowMs`; `playing` writes `raven-memory-playing-mb <n>\n` every `sampleMs`; `paused` calls `metrics()` once at the start (Electron's CPU figure counts from the previous call) and writes `raven-cpu-paused-percent <n>\n` once after `windowMs`. `budgetWindowFrom` is `null` when packaged or when `RAVEN_DESKTOP_BUDGET_MS` is not a whole number from 100 to 600000; main uses it for both `windowMs` and `sampleMs`, else the two constants. Main passes `metrics: () => app.getAppMetrics()`, `mark` from Task 2, and calls `report` from `createActivity`'s callbacks (`onPlaying` and `onShowing` both feed one `report` with the latest pair); `dispose` on window `closed`.

- [ ] **Step 1: Write the failing tests.**
  - `budgets.test.ts`: `sumMetrics` of working sets `[204800, 102400]` KB and CPU `[0.4, 1.25]` is `{ memoryMb: 300, cpuPercent: 1.7 }`; `stateOf` of the three activity pairs; with fake timers: after `windowMs` on Home one idle mark; leaving Home before `windowMs` writes none; playing writes a playing mark at each `sampleMs` and stops when paused; paused calls `metrics` at the start and writes one CPU mark after `windowMs`; a repeated `report` with the same state does not restart the window; `budgetWindowFrom` is `null` packaged, `null` for `'abc'`, `'50'` and `'700000'`, and `2000` for `'2000'` unpackaged.
  - `launch.e2e.ts`: "logs idle memory under twice its budget": `withApp` with `env: { RAVEN_DESKTOP_BUDGET_MS: '3000' }`; within 10 s stdout's marks include `raven-memory-idle-mb <n>` with `n < 2 * BUDGETS.idleMemoryMb`, printed with the value like the launch test.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (e2e 38).
- [ ] **Step 3: Commit** `MAE: mark memory and CPU against the desktop budgets`.

---

### Task 4: Help menu: Show Logs, Show Crash Reports, Copy Diagnostics

**Files:**
- Create: `apps/raven/desktop/src/main/diagnostics.ts`, `diagnostics.test.ts`, `src/main/help.ts`, `help.test.ts`
- Modify: `apps/raven/desktop/src/main/menu.ts`, `menu.test.ts`, `src/main/main.ts`
- Create: `apps/raven/desktop/e2e/help.e2e.ts`

**Interfaces:**
- Consumes: `Mpv` (type, `@raven/mpv`), `ENGINE_MESSAGES` (`@/main/player/engine`), the `notice` desktop event.
- Produces (`@/main/diagnostics`):

```ts
export type EngineDiagnostics =
  | { kind: 'native'; mpv: string; ffmpeg: string | null; hwdecCurrent: string | null
      display: { refreshRate: number; edrHeadroom: number } | null }
  | { kind: 'unavailable'; reason: string }
export type DiagnosticsInput = {
  app: { version: string; isPackaged: boolean; arch: string }
  os: string
  versions: { electron: string; chrome: string; node: string }
  engine: EngineDiagnostics
  displayHz: number | null
}
export const readEngineDiagnostics = (mpv: Pick<Mpv, 'version' | 'read' | 'display'>): Promise<Extract<EngineDiagnostics, { kind: 'native' }>>
export const diagnosticsText = (input: DiagnosticsInput): string
```

- Produces (`@/main/help`):

```ts
export const HELP_MESSAGES = {
  copied: 'Copied the diagnostics.',
  notCopied: 'raven player could not copy the diagnostics.',
  noLogs: 'raven player could not open its logs folder.',
  noCrashReports: 'raven player could not open its crash reports folder.',
} as const
export type HelpActions = { showLogs: () => Promise<void>; showCrashReports: () => Promise<void>; copyDiagnostics: () => Promise<void> }
export const createHelpActions = ({ folders, mkdir, openPath, writeClipboard, diagnostics, notify, warn }: {
  folders: { logs: string; crashDumps: string }
  mkdir: (path: string) => Promise<unknown>
  /** Electron's `shell.openPath`: '' on success, else why it failed. */
  openPath: (path: string) => Promise<string>
  writeClipboard: (text: string) => void
  diagnostics: () => Promise<string>
  notify: (message: string) => void
  warn: (message: string) => void
}): HelpActions
```

- Produces (`@/main/menu`): `MenuActions` gains `showLogs`, `showCrashReports`, `copyDiagnostics` (each `() => void`); Help becomes `Keyboard Shortcuts`, separator, `Show Logs` (`id: 'show-logs'`), `Show Crash Reports` (`id: 'show-crash-reports'`), `Copy Diagnostics` (`id: 'copy-diagnostics'`), none with an accelerator.

Rules (Rulings 14 and 15):
- `readEngineDiagnostics`: `mpv.version`; `ffmpeg-version` and `hwdec-current` by `read`, each `null` when the read rejects; `display()` or `null` when it throws.
- `diagnosticsText` is these lines joined by `\n` with a trailing `\n`:
  `raven player <version> (<packaged|unpackaged>, <arch>)`, `macOS <os>`, `Electron <e>, Chromium <c>, Node <n>`, then for `native`: `Video engine: <mpv>, FFmpeg <ffmpeg ?? 'unknown'>`, `Hardware decoding: hwdec=auto, hwdec-current=<hwdecCurrent ?? 'none (nothing playing)'>`, `Display: <displayHz ?? 'unknown'> Hz (mpv <refreshRate> Hz), EDR headroom <edrHeadroom.toFixed(1)>` (with `display` null: `Display: <hz> Hz, EDR headroom unknown`); for `unavailable`: `Video engine: unavailable (<reason>)`, `Hardware decoding: unknown`, `Display: <hz> Hz, EDR headroom unknown`.
- `createHelpActions`: `showLogs` and `showCrashReports` `mkdir` their folder, then `openPath`; a rejection or a non-empty answer notifies `noLogs` or `noCrashReports` and `warn`s the answer. `copyDiagnostics` writes `await diagnostics()` to the clipboard and notifies `copied`; a failure notifies `notCopied` and `warn`s.
- `main.ts`: `folders` are `app.getPath('logs')` and `app.getPath('crashDumps')`; `mkdir` is `mkdir(path, { recursive: true, mode: 0o700 })`; `openPath` is `shell.openPath`; `writeClipboard` is `clipboard.writeText`; `notify` sends `{ type: 'notice', message }`. `diagnostics` builds `DiagnosticsInput` from `app.getVersion()`, `app.isPackaged`, `process.arch`, `process.getSystemVersion()`, `process.versions`, `screen.getDisplayMatching(window.getBounds()).displayFrequency` for the live window (`null` without one), and the engine: the slot's current engine through `readEngineDiagnostics`, else `{ kind: 'unavailable', reason }` where `reason` is `ENGINE_MESSAGES.off` in `off` mode, the last message `openEngine` warned (kept in a variable), or `'still opening'`.

- [ ] **Step 1: Write the failing tests.**
  - `diagnostics.test.ts`: a native input gives exactly the six lines with `mpv v0.41.0`, `FFmpeg 8.1.2`, `hwdec-current=videotoolbox`, `Display: 120 Hz (mpv 120 Hz), EDR headroom 16.0`; `hwdecCurrent: null` gives `hwdec-current=none (nothing playing)`; an unavailable engine gives `Video engine: unavailable (raven player could not start its video engine, so it plays only the videos Chromium can.)` and `EDR headroom unknown`; the text contains no `/`, no `http` and no `raven_` (no paths, origins or cookies); `readEngineDiagnostics` over a fake mpv whose `hwdec-current` read rejects and whose `display` throws gives `hwdecCurrent: null, display: null`.
  - `help.test.ts`: `showLogs` made the logs folder then opened it; an `openPath` answer `'No application'` notifies `noLogs` and warns it; `copyDiagnostics` wrote the text and notified `copied`; a rejecting `diagnostics` notifies `notCopied`.
  - `menu.test.ts`: "leaves out the items later steps add" is replaced by "ends Help with the logs, the crash reports and the diagnostics": the Help labels are `Keyboard Shortcuts`, a separator, `Show Logs`, `Show Crash Reports`, `Copy Diagnostics` with their ids, and clicking each calls its action once.
  - `help.e2e.ts`: "copies diagnostics from the Help menu": `app.evaluate` clicks `Menu.getApplicationMenu().getMenuItemById('copy-diagnostics')`; the notice `Copied the diagnostics.` shows; `clipboard.readText()` (through `app.evaluate`) starts with `raven player ` and holds `Video engine: mpv v0.` and `hwdec=auto`; the same with `mpv: 'off'` holds `Video engine: unavailable (The video engine is off for this run.)`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (e2e 40; the second case is its own test).
- [ ] **Step 3: Commit** `MAE: show logs and crash reports and copy diagnostics from Help`.

---

### Task 5: The release check and the update setting

**Files:**
- Create: `apps/raven/desktop/src/main/updates.ts`, `updates.test.ts`
- Modify: `apps/raven/desktop/src/main/desktopConfig.ts`, `desktopConfig.test.ts`

**Interfaces:**
- Consumes: core guards (`object`, `isString`, `isBoolean`, `listOf`, `nullable`, `isNumber`).
- Produces (`@/main/updates`):

```ts
export const RELEASES_URL = 'https://api.github.com/repos/codebend3r/maester/releases?per_page=30'
export const RELEASE_PAGE_PREFIX = 'https://github.com/codebend3r/maester/releases/tag/'
export const CHECK_INTERVAL_MS = 86_400_000
export const UPDATE_TIMEOUT_MS = 10_000
export const MAX_RELEASES_CHARS = 2_097_152
export const dmgNameFor = (version: string): string // `raven-player-${version}-arm64.dmg`
export const isGithubRelease = object({ tag_name: isString, draft: isBoolean, prerelease: isBoolean, assets: listOf(object({ name: isString })) })
export type ReleaseVersion = { major: number; minor: number; patch: number }
export const parseVersion = (text: string): ReleaseVersion | null // /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/
export const compareVersions = (a: ReleaseVersion, b: ReleaseVersion): number
export type UpdateFinding = { kind: 'current' } | { kind: 'newer'; version: string; pageUrl: string }
export const findUpdate = ({ releases, current }: { releases: unknown; current: string }): UpdateFinding | null
export const UPDATE_PROBLEMS = {
  unreachable: 'GitHub did not answer.',
  busy: 'GitHub is busy. Try again later.',
  unreadable: 'GitHub sent something raven player could not read.',
} as const
export type UpdateFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
  Promise<{ status: number; text: () => Promise<string> }>
export type UpdateCheck = { ok: true; finding: UpdateFinding } | { ok: false; problem: string }
export const checkForUpdates = ({ fetch, url, current }: { fetch: UpdateFetch; url: string; current: string }): Promise<UpdateCheck>
export const isCheckDue = ({ isEnabled, checkedAt, now }: { isEnabled: boolean; checkedAt: number | null; now: number }): boolean
```

- Produces (`@/main/desktopConfig`): `isUpdateSettings = object({ isEnabled: isBoolean, checkedAt: nullable(isNumber) })`, `UpdateSettings`, `DEFAULT_UPDATE_SETTINGS = { isEnabled: true, checkedAt: null }`; `isDesktopConfig` is version 3 with `updates: isUpdateSettings`; `isStoredConfig` is the union of versions 1, 2 and 3; `EMPTY_CONFIG.version` is 3; `upgradeConfig` returns version 3 (versions 1 and 2 get `DEFAULT_UPDATE_SETTINGS`; version 3 rebuilds `updates` from its two fields); `setUpdates({ config, updates }): DesktopConfig`.

Rules (Rulings 8 and 9):
- `findUpdate`: `null` unless `releases` is a list; entries failing `isGithubRelease` are skipped; candidates are not `draft`, not `prerelease`, `parseVersion(tag_name)` with a leading `v` and exactly three numbers, and an asset named `dmgNameFor('X.Y.Z')`; the highest by `compareVersions` is `newer` when above `parseVersion(current)` (a current that does not parse counts as `0.0.0`), else `current`. `pageUrl` is `` `${RELEASE_PAGE_PREFIX}v${version}` ``.
- `checkForUpdates`: `fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': \`raven-player/${current}\` }, signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) })`; a rejection is `unreachable`; 403 or 429 is `busy`; another non-200, text over `MAX_RELEASES_CHARS`, invalid JSON or `findUpdate` `null` is `unreadable`.
- `isCheckDue`: false when disabled; true when `checkedAt` is null, `now - checkedAt >= CHECK_INTERVAL_MS`, or `checkedAt > now`.

- [ ] **Step 1: Write the failing tests.**
  - `updates.test.ts`, with a release builder `release({ tag, draft = false, prerelease = false, assets = [dmgNameFor(tag.slice(1))] })`:
    - `parseVersion('v0.5.4')` is `{ 0, 5, 4 }`; `'v0.5.4.9'`, `'v1.0.0-rc.1'`, `'0.5'`, `'vX'` are `null`; `compareVersions` orders `10.0.0` above `9.9.9` and `0.10.0` above `0.9.12`.
    - "offers the highest full release that carries the app": releases `v0.5.4.9` (a build, marked first), `v0.7.0-rc.1` (prerelease), `v0.8.0` (draft), `v0.6.1` with no assets, `v0.6.0`, current `0.5.4`: `newer` `0.6.0` with `pageUrl` `'https://github.com/codebend3r/maester/releases/tag/v0.6.0'`.
    - "is current when nothing is newer": `v0.5.4` and `v0.5.3`, current `0.5.4`: `current`.
    - "ignores the reply's own links": a release carrying `html_url: 'https://evil.example/'` still gives the built `pageUrl`.
    - "skips entries that are not releases": a list holding `null`, `{ tag_name: 3 }` and one valid newer release finds the valid one; a non-list is `null`.
    - `checkForUpdates`: sends `accept` and `user-agent: raven-player/0.5.4`; a rejection is `{ ok: false, problem: UPDATE_PROBLEMS.unreachable }`; 403 and 429 are `busy`; 500, `'<html>'`, 3 MB of text and `{"message":"x"}` are `unreadable`; a 200 list with a newer release is `ok` with it.
    - `isCheckDue`: disabled is false; null is true; 23 h ago false; 24 h ago true; one hour in the future true.
  - `desktopConfig.test.ts`: existing cases updated to version 3; version 1 and 2 files upgrade with `updates: { isEnabled: true, checkedAt: null }`; a version 3 file keeps `{ isEnabled: false, checkedAt: 5 }` and drops an extra field in `updates`; `isDesktopConfig` rejects `updates: { isEnabled: 'yes', checkedAt: null }`; `setUpdates` does not mutate its input.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: find a newer raven player release on GitHub`.

---

### Task 6: Updates in main: the service, the protocol and Check for Updates

**Files:**
- Create: `apps/raven/desktop/src/main/updateService.ts`, `updateService.test.ts`
- Modify: `apps/raven/desktop/src/shared/protocol.ts`, `protocol.test.ts`
- Modify: `apps/raven/desktop/src/main/desktopService.ts`, `desktopService.test.ts`, `src/main/openBatch.ts` (`eventForOpen` exhaustive case), `src/renderer/Shell/openReply.ts` and `Shell.tsx` (exhaustive cases only; the UI is Task 7)
- Modify: `apps/raven/desktop/src/main/menu.ts`, `menu.test.ts`, `src/main/main.ts`

**Interfaces:**
- Consumes: Task 5 (`checkForUpdates`, `isCheckDue`, `UpdateCheck`, `UpdateFinding`, `RELEASES_URL`, `setUpdates`, `UpdateSettings`).
- Produces (`@/shared/protocol`):

```ts
export const isUpdateStatus = object({
  isEnabled: isBoolean, current: isString, checkedAt: nullable(isNumber),
  latest: nullable(isString), problem: nullable(isString),
})
export type UpdateStatus = Infer<typeof isUpdateStatus>
// isDesktopRequest gains:
//   object({ type: oneOf(['readUpdates']) })
//   object({ type: oneOf(['setUpdateCheck']), isEnabled: isBoolean })
//   object({ type: oneOf(['checkForUpdates']) })
//   object({ type: oneOf(['openRelease']) })
// isDesktopReply gains: object({ type: oneOf(['updates']), status: isUpdateStatus })
// isDesktopEvent gains: object({ type: oneOf(['updateAvailable']), version: isString })
```

- Produces (`@/main/updateService`):

```ts
export const UPDATE_COPY = {
  newer: (version: string) => `raven player ${version} is out.`,
  newerDetail: 'Download it from its release page. While raven player is signed ad hoc it cannot update itself.',
  current: (version: string) => `raven player ${version} is the newest release.`,
  failed: 'raven player could not check for updates.',
  noRelease: 'raven player has not found a newer release.',
} as const
export type UpdateDialog = { type: 'info' | 'warning'; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number; opensRelease: boolean }
export const updateDialogFor = ({ check, current }: { check: UpdateCheck; current: string }): UpdateDialog
export type UpdateService = {
  status: () => UpdateStatus
  setEnabled: (isEnabled: boolean) => UpdateStatus
  checkNow: () => Promise<UpdateCheck>
  /** At launch: checks only when due and enabled, and tells the page about a newer release. */
  atLaunch: () => Promise<void>
  openRelease: () => Promise<boolean>
}
export const createUpdateService = ({ config, check, current, now, openExternal, announce, warn }: {
  config: ConfigStore; check: () => Promise<UpdateCheck>; current: string; now: () => number
  openExternal: (url: string) => Promise<void>; announce: (version: string) => void; warn: (message: string) => void
}): UpdateService
```

Rules (Rulings 8 to 10, 19):
- `checkNow` runs `check`, writes `checkedAt: now()` into the config whatever the outcome (so a failing GitHub is not asked again at every launch), remembers a `newer` finding (cleared by a `current` one) and the last problem, and `warn`s a failure. Two calls at once share one check.
- `status` is `{ isEnabled, current, checkedAt, latest: finding?.version ?? null, problem }`.
- `atLaunch`: when `isCheckDue`, `checkNow`; a `newer` finding calls `announce(version)`.
- `openRelease`: `false` with no finding; else `openExternal(pageUrl)`, `true` (a rejection is `warn`ed, `false`).
- `updateDialogFor`: newer is `{ type: 'info', message: newer(v), detail: newerDetail, buttons: ['See Release', 'Later'], defaultId: 0, cancelId: 1, opensRelease: true }`; current is `{ type: 'info', message: current(c), detail: '', buttons: ['OK'], defaultId: 0, cancelId: 0, opensRelease: false }`; failed is `{ type: 'warning', message: failed, detail: problem, buttons: ['OK'], ... opensRelease: false }`.
- Desktop service (deps gain `updates: UpdateService`): `readUpdates` and `setUpdateCheck` answer `updates`; `checkForUpdates` awaits `checkNow` then answers `updates`; `openRelease` answers `done`, or refused `UPDATE_COPY.noRelease` when it returns `false`. `eventForOpen` returns `null` for an `updates` reply; the renderer's exhaustive switches over replies and events gain no-op cases.
- Menu: the app menu becomes `About`, separator, `Settings…`, `Check for Updates…` (`id: 'check-for-updates'`, no accelerator), separator, the hide roles, separator, `Quit`; `MenuActions` gains `checkForUpdates`.
- `main.ts`: `check` is `checkForUpdates({ fetch, url, current: app.getVersion() })` with `url` from the hook when unpackaged and set, else `RELEASES_URL`, and `fetch` is `net.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' })`. The menu item awaits `checkNow`, shows `dialog.showMessageBox` (on the live window) with `updateDialogFor`'s fields, and calls `openRelease` when `opensRelease` and the answer is 0. `atLaunch` runs once after the page's first `ready`, only when packaged or the hook is set (Ruling 10); `announce` sends `{ type: 'updateAvailable', version }`.

- [ ] **Step 1: Write the failing tests.**
  - `protocol.test.ts`: one valid value per new variant; rejected: `setUpdateCheck` with `isEnabled: 'true'`, an `updates` reply whose `latest` is `3`, an `updateAvailable` without `version`.
  - `updateService.test.ts` (a real config store over the fake `StateFs`, a scripted `check`): `atLaunch` with `checkedAt` null checks once, stores `checkedAt`, and announces `0.6.0` for a newer finding; with `checkedAt` an hour ago it neither checks nor announces; disabled it never checks while `checkNow` still does; a failing check stores `checkedAt` and `problem` and warns; two `checkNow` at once call `check` once; `openRelease` with no finding is `false` and opens nothing, after a newer finding it opens `'https://github.com/codebend3r/maester/releases/tag/v0.6.0'`; `setEnabled(false)` persists and `status().isEnabled` is false; `updateDialogFor` for each of the three outcomes equals the shapes above.
  - `desktopService.test.ts`: each new request answers as above; `openRelease` with nothing found is refused `has not found a newer release`.
  - `menu.test.ts`: the app menu's items in order with `Check for Updates…` after `Settings…`; clicking it calls `checkForUpdates`; it has no accelerator.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: check for raven player updates at launch and from the menu`.

---

### Task 7: Updates in the renderer and end to end

**Files:**
- Create: `apps/raven/desktop/src/renderer/SettingsPage/Updates.tsx`, `Updates.module.scss`, `Updates.test.tsx`
- Create: `apps/raven/desktop/src/renderer/Shell/UpdateNotice.tsx`, `UpdateNotice.module.scss`, `UpdateNotice.test.tsx`
- Modify: `apps/raven/desktop/src/renderer/SettingsPage/SettingsPage.tsx`, `SettingsPage.module.scss`, `src/renderer/Shell/Shell.tsx`, `Shell.module.scss`, `Shell.test.tsx`
- Create: `apps/raven/desktop/e2e/releasesFixture.ts`, `e2e/updates.e2e.ts`

**Interfaces:**
- Consumes: Task 6's requests, reply and event; `UPDATE_COPY` copy is repeated in the renderer, which cannot import main.
- Produces (`@/e2e/releasesFixture`): `startReleasesFixture({ releases }: { releases: unknown }): Promise<{ url: string; requests: () => number; close: () => Promise<void> }>` (`node:http` on `127.0.0.1:0`, `GET /releases` answers the JSON, everything else 404).

Behaviour (Ruling 19, spec "Settings" holds "the update check switch"):
- **Settings > Updates** (a `section` labelled by its `h2` `Updates`, after This computer and before Recents): a checkbox `Check for updates once a day` with the hint `raven player asks GitHub for its newest release and sends nothing else. It never installs one by itself.`, sending `setUpdateCheck`; the line `This is raven player <current>.`; `Last checked <toLocaleString of checkedAt>.` or `Not checked yet.`; a `Check now` button sending `checkForUpdates`; when `latest` is set, `raven player <latest> is out.` and a `See what's new` button sending `openRelease`; when `problem` is set, `raven player could not check for updates. <problem>`. One always-mounted `output` announces results. Data comes from `readUpdates` through TanStack Query under `UPDATES_KEY = ['desktop', 'updates']`.
- **The notice:** the Shell keeps the version from `updateAvailable`; `UpdateNotice` is an `aside` labelled `Update`, with the text `raven player <version> is out.`, `See what's new` (sends `openRelease`, then hides) and `Dismiss` (hides for the session). It renders only when the path is `/` or `/settings`, so the watch routes never repaint for it; it stays pending and shows on returning Home. Grid with named areas `text actions`, stacking below `30rem`, tokens only, `:focus-visible` with `--focus-ring`.

- [ ] **Step 1: Write the failing tests.**
  - `Updates.test.tsx` (the fake desktop client): renders the status lines for `{ isEnabled: true, current: '0.5.4', checkedAt: null, latest: null, problem: null }` with `Not checked yet.`; the checkbox is labelled and checked; unchecking sends `{ type: 'setUpdateCheck', isEnabled: false }`; `Check now` sends `checkForUpdates` and then shows `raven player 0.6.0 is out.` from the reply; `See what's new` sends `openRelease`; a reply with `problem: 'GitHub did not answer.'` shows it.
  - `UpdateNotice.test.tsx` and `Shell.test.tsx`: an `updateAvailable` event on Home shows `raven player 0.6.0 is out.`; on `/play/f1` it does not show, and navigating to `/` shows it; `Dismiss` hides it; `See what's new` sends `openRelease` and hides it.
  - `updates.e2e.ts`:
    - "tells you about a newer release and opens its page": a fixture with `v99.0.0` carrying `raven-player-99.0.0-arm64.dmg`, launched with `env: { RAVEN_DESKTOP_RELEASES_URL: url }`, `stubBrowser`; the notice `raven player 99.0.0 is out.` shows within 10 s; `See what's new`; `browserOpens` equals `['https://github.com/codebend3r/maester/releases/tag/v99.0.0']`.
    - "says nothing when this is the newest full release": releases `v99.0.0.1` (no dmg), `v99.1.0-rc.1` (prerelease, with a dmg name), `v98.0.0` without a dmg, and the app's own version with its dmg; after 3 s no notice; the fixture saw exactly one request.
    - "never asks GitHub with the switch off": Settings, uncheck `Check for updates once a day`, quit; relaunch on the same userData with the config's `checkedAt` rewritten to `null` by the test before launch; after 3 s the fixture saw no new request.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (e2e 43).
- [ ] **Step 3: Commit** `MAE: show the update switch in Settings and a quiet notice on Home`.

---

### Task 8: libmpv in the packaged app, signed inside out

**Files:**
- Create: `apps/raven/desktop/src/build/stageMpv.ts`, `stageMpv.test.ts`, `src/build/machO.ts`, `machO.test.ts`
- Modify: `apps/raven/desktop/src/build/forgeOptions.ts`, `forgeOptions.test.ts`, `forge.config.ts`, `package.json`, `.gitignore` (`/staging/`), `.oxlintrc.json` (`staging` in `ignorePatterns`)

**Interfaces:**
- Produces (`@/build/stageMpv`):

```ts
export const MPV_SOURCE = join('..', '..', '..', 'libs', 'raven', 'mpv', 'resources', 'darwin-arm64')
export const MPV_STAGING = join('staging', 'mpv')
export const MPV_MACH_O = ['raven_mpv.node', 'lib/libmpv.2.dylib', 'lib/libMoltenVK.dylib'] as const
export const STAGED_PATHS = [...MPV_MACH_O, 'provenance'] as const
export const missingMpvFiles = ({ exists }: { exists: (relative: string) => boolean }): string[]
export const stageMpv = ({ from, to, fs }: {
  from: string; to: string
  fs: { exists: (path: string) => boolean; remove: (path: string) => Promise<void>; copy: (from: string, to: string) => Promise<void> }
}): Promise<void>
```

- Produces (`src/build/machO.ts`, no project imports):

```ts
export const MACH_O_MAGICS = [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca] as const
export const isMachO = (header: Uint8Array): boolean
export type Signable = { path: string; kind: 'machO' | 'bundle' }
export const signingOrder = ({ app, entries }: { app: string; entries: readonly Signable[] }): string[]
export const listSignables = ({ app }: { app: string }): Promise<Signable[]>
export const adHocSignArgs = ({ path }: { path: string }): string[] // ['--sign', '-', '--force', path]
export const verifyAppArgs = ({ app }: { app: string }): string[] // ['--verify', '--deep', '--strict', '--verbose=2', app]
```

- Produces (`@/build/forgeOptions`): `resealTargets` is renamed `adHocApps({ platform, signing, outputPaths, appName }): string[]` (the app paths, none off macOS or with an identity); `adHocSealArgs` is removed; `isPackagedPath` unchanged.

Rules (Rulings 1, 2, 18):
- `stageMpv` throws `Error(\`raven player packages the video engine, and these are missing from ${from}: ${missing.join(', ')}. CI builds them (bunx nx run @raven/mpv:build:native).\`)` when `missingMpvFiles` is not empty; else removes `to`, then copies each of `STAGED_PATHS` (the real fs `copy` is `cp(from, to, { recursive: true, verbatimSymlinks: true })`). Run as `bun src/build/stageMpv.ts` when it is the main module.
- `isMachO` reads the first four bytes big-endian; fewer than four bytes is `false`.
- `listSignables` walks `app` with `readdir({ recursive: true, withFileTypes: true })`, skips symlinks, keeps regular files whose first four bytes pass `isMachO` as `machO`, and directories named `*.app` or `*.framework` other than `app` itself as `bundle`.
- `signingOrder` drops entries outside `app`, sorts by path depth (separator count) descending, ties by path ascending, and appends `app` last.
- `forge.config.ts`: `packagerConfig.extraResource: [MPV_STAGING]`; `postPackage` for each of `adHocApps(...)`: `listSignables`, then `codesign` with `adHocSignArgs` for each path of `signingOrder`, one after another (a `reduce` over promises), then `codesign` with `verifyAppArgs`.
- `package.json`: script `"stage:mpv": "bun src/build/stageMpv.ts"` in `nx.includedScripts`, target `stage:mpv` with `cache: false`; `package` and `make` depend on `["build", "stage:mpv"]`.

- [ ] **Step 1: Write the failing tests.**
  - `stageMpv.test.ts`: with every file present `missingMpvFiles` is `[]`; with `lib/libMoltenVK.dylib` absent it is `['lib/libMoltenVK.dylib']` and `stageMpv` rejects naming it and copies nothing; a full stage removes `to` first and copies the four paths in `STAGED_PATHS` order to `join(to, path)`.
  - `machO.test.ts`: `isMachO` accepts `cf fa ed fe` (arm64 little-endian) and `cafebabe` (a universal binary), refuses `50 4b 03 04` (zip), `7b 22` and an empty array; `signingOrder` for an app `/o/a.app` with `Contents/MacOS/a`, `Contents/Frameworks/E.framework`, `Contents/Frameworks/E.framework/Versions/A/E`, `Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib`, `Contents/Frameworks/H.app`, `Contents/Frameworks/H.app/Contents/MacOS/H`, `Contents/Resources/mpv/darwin-arm64/raven_mpv.node`, `Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib` and an outside `/o/other` gives each file before the bundle that holds it, `libmpv.2.dylib` before `raven_mpv.node`, `/o/a.app` last, no `/o/other`; `adHocSignArgs` and every list the hook would run contain no `--deep`; `verifyAppArgs` is the five arguments above.
  - `forgeOptions.test.ts`: the `resealTargets` cases move to `adHocApps` (`['/o/raven player-darwin-arm64/raven player.app']` on darwin without identity, `[]` with one, `[]` on linux); the `adHocSealArgs` case is deleted.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Package and check by hand.** `bunx nx run @raven/desktop:make`, then: `codesign --verify --deep --strict --verbose=2 "apps/raven/desktop/out/raven player-darwin-arm64/raven player.app"` passes; `otool -L` on the staged `raven_mpv.node` inside the app lists `@rpath/libmpv.2.dylib`; launching the packaged app (Rulings 16's caveats apply) and opening M1 plays through mpv (the stats overlay with `i` shows `gpu-next`), and `~/Library/Logs/raven/raven.log` has `video engine ready: mpv v0.41.0`. Record each in the commit body.
- [ ] **Step 4: Commit** `MAE: bundle libmpv in raven player and sign every Mach-O inside out`.

---

### Task 9: The dmg maker

**Files:**
- Create: `apps/raven/desktop/src/build/dmgMaker.ts`, `dmgMaker.test.ts`
- Modify: `apps/raven/desktop/forge.config.ts`, `package.json` (devDependency `@electron-forge/maker-base` `8.0.1`), `bun.lock`

**Interfaces:**
- Produces (`src/build/dmgMaker.ts`, no project imports):

```ts
export const dmgFileName = ({ version, arch }: { version: string; arch: string }): string // `raven-player-${version}-${arch}.dmg`
export const hdiutilArgs = ({ volumeName, sourceDir, output }: { volumeName: string; sourceDir: string; output: string }): string[]
// ['create', '-volname', volumeName, '-srcfolder', sourceDir, '-format', 'UDZO', '-ov', output]
export const versionOf = (packageJSON: unknown): string // throws Error('package.json has no version') unless a non-empty string
export class MakerDmg extends MakerBase<Record<string, never>> // name 'dmg', defaultPlatforms ['darwin']
```

Rules (Ruling 3): `isSupportedOnCurrentPlatform` is `process.platform === 'darwin'`. `make({ dir, makeDir, appName, packageJSON, targetArch })`: a fresh `mkdtemp` staging folder holds `ditto <dir>/<appName>.app <stage>/<appName>.app` and a symlink `Applications` to `/Applications`; `hdiutil` with `volumeName: appName` writes `join(makeDir, 'dmg', 'darwin', targetArch, dmgFileName(...))` (folder made first); the staging folder is removed in a `finally`; it returns `[output]`. `forge.config.ts` makers: `[new MakerDmg({}, ['darwin']), new MakerZIP({}, ['darwin'])]`.

- [ ] **Step 1: Write the failing tests** in `dmgMaker.test.ts`: `dmgFileName({ version: '0.5.4', arch: 'arm64' })` is `'raven-player-0.5.4-arm64.dmg'`; `hdiutilArgs` is exactly the list above; `versionOf({ version: '0.5.4' })` is `'0.5.4'`, `versionOf({})` and `versionOf(null)` throw; `new MakerDmg({}, ['darwin']).name` is `'dmg'`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Make and mount by hand.** `bunx nx run @raven/desktop:make` writes `out/make/dmg/darwin/arm64/raven-player-0.5.4-arm64.dmg` beside the zip; `hdiutil attach` shows `raven player.app` and `Applications`; `codesign --verify --deep --strict` passes on the app inside the mounted image; `hdiutil detach`. Record in the commit body.
- [ ] **Step 4: Commit** `MAE: make a raven player dmg with hdiutil`.

---

### Task 10: The bundle audit and the packaged smoke

**Files:**
- Create: `apps/raven/desktop/src/build/bundleAudit.ts`, `bundleAudit.test.ts`, `src/build/auditBundle.ts`
- Create: `apps/raven/desktop/src/build/smokeVerdict.ts`, `smokeVerdict.test.ts`, `src/build/smokePackaged.ts`
- Modify: `apps/raven/desktop/package.json`

**Interfaces:**
- Consumes: `listSignables`, `isMachO` (`@/build/machO`), `MPV_MACH_O` (`@/build/stageMpv`), `LOG_FILE` (`@/main/log/log`).
- Produces (`@/build/bundleAudit`):

```ts
export const PACKAGED_APP = join('out', 'raven player-darwin-arm64', 'raven player.app')
export const MPV_IN_APP = join('Contents', 'Resources', 'mpv', 'darwin-arm64')
export const parseLinks = (otoolL: string): string[]       // the paths after the header line, without "(compatibility ...)"
export const parseRpaths = (otoolLoad: string): string[]   // each LC_RPATH `path`
export const parseArchs = (lipoArchs: string): string[]
export type AuditedFile = { relative: string; dir: string; links: string[]; rpaths: string[]; archs: string[] }
export const fileProblems = ({ file, exists }: { file: AuditedFile; exists: (path: string) => boolean }): string[]
export const bundleProblems = ({ files, exists, plistVersion, packageVersion }: {
  files: readonly AuditedFile[]; exists: (relative: string) => boolean; plistVersion: string; packageVersion: string
}): string[]
```

- Produces (`@/build/smokeVerdict`):

```ts
export const SMOKE_START_MS = 30_000
export const SMOKE_QUIT_MS = 5_000
export type SmokeStage = 'started' | 'quit'
/** The needles the new log lines still lack for a stage, in order: [] when the stage passed. */
export const smokeGaps = ({ lines, stage, version }: { lines: readonly string[]; stage: SmokeStage; version: string }): string[]
```

Rules:
- `fileProblems`: each link must start with `/System/Library/`, `/usr/lib/`, `@rpath/`, `@loader_path/` or `@executable_path/` (`<relative> links <link> from outside the app`); each rpath must start with `@loader_path` or `@executable_path` (`<relative> searches <rpath>`); `archs` must include `arm64`; for a file under `MPV_IN_APP`, each `@rpath/<name>` link other than its own id resolves to an existing file through one of its rpaths with `@loader_path` as `dir` (`<relative> cannot find <name>`).
- `bundleProblems`: every `MPV_MACH_O` file exists under `MPV_IN_APP`; `plistVersion` equals `packageVersion` (`Info.plist says <a>, package.json says <b>`); plus every `fileProblems`.
- `auditBundle.ts` (script `audit:bundle`, `bun src/build/auditBundle.ts`): refuses with `Run bunx nx run @raven/desktop:make first.` when `PACKAGED_APP` is missing; for every `machO` from `listSignables` runs `otool -L`, `otool -l`, `lipo -archs` and `codesign --verify --strict`; reads `plutil -extract CFBundleShortVersionString raw <app>/Contents/Info.plist`; runs `codesign --verify --deep --strict --verbose=2` on the app; prints each problem and exits 1 on any, else prints `raven player bundle: <n> Mach-O files, all inside the app and signed.`.
- `smokeGaps`: the needles for `started` are `launch raven player <version> (packaged)`, `video engine ready: mpv v` and `raven-launch-ms `; `quit` adds `raven-quit-ms `. Each needle no line contains is returned as is. A line containing `could not open its video engine` replaces the engine needle with `the video engine did not open: <that line>`.
- `smokePackaged.ts` (script `smoke:packaged`, `bun src/build/smokePackaged.ts`, Ruling 16): refuses when `PACKAGED_APP` is missing or `pgrep -f "raven player.app/Contents/MacOS/raven player"` finds one running; notes the size of `~/Library/Logs/raven/raven.log` (0 when absent); spawns `<app>/Contents/MacOS/raven player` with the environment minus every `RAVEN_DESKTOP_*` variable; polls the lines written after that size every 250 ms until `smokeGaps(started)` is empty or `SMOKE_START_MS` passes; sends `SIGTERM`; waits up to `SMOKE_QUIT_MS` for the exit and `smokeGaps(quit)` empty; on any failure kills the process, prints the gaps and the new lines, exits 1; else prints the launch and quit marks.
- `package.json`: scripts `audit:bundle` and `smoke:packaged` in `nx.includedScripts`, both targets `cache: false` with no `dependsOn` (they read what `make` left).

- [ ] **Step 1: Write the failing tests.**
  - `bundleAudit.test.ts`: `parseLinks` of a real `otool -L` listing of `libmpv.2.dylib` (paste three lines of it) gives the paths only; `parseRpaths` of an `otool -l` excerpt with two `LC_RPATH` commands gives both; `fileProblems` flags `/opt/homebrew/lib/libass.9.dylib`, `/usr/local/lib/x.dylib` and an rpath `/opt/homebrew/lib`, accepts `/System/Library/Frameworks/Metal.framework/Versions/A/Metal`, `/usr/lib/libc++.1.dylib` and `@rpath/libMoltenVK.dylib` with rpath `@loader_path` when `lib/libMoltenVK.dylib` exists beside it, flags the same link when it does not, and flags `archs: ['x86_64']`; `bundleProblems` names a missing `lib/libmpv.2.dylib` and a version mismatch `0.5.3` against `0.5.4`.
  - `smokeVerdict.test.ts`: the three started lines for version `0.5.4` give `[]` for `started` and `['raven-quit-ms ']` for `quit`; with `(unpackaged)` in place of `(packaged)` `started` gives `['launch raven player 0.5.4 (packaged)']`; a log with `raven player could not open its video engine: no addon` and no ready line gives `['the video engine did not open: <that line>']`; all four lines give `[]` for `quit`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Run both against Task 9's `make` output.** `bunx nx run @raven/desktop:audit:bundle` passes; `bunx nx run @raven/desktop:smoke:packaged` passes (quit raven player first). Spike: if `SIGTERM` exits without a `raven-quit-ms` line (Electron not running `before-quit` on it), say so in the commit body and make the `quit` stage require only the exit within `SMOKE_QUIT_MS`; the quit mark is then checked by hand in "Testing for the PR". Then rename `staging/mpv/darwin-arm64/lib/libmpv.2.dylib` away, `make`, and confirm the smoke fails with `the video engine did not open` or, since `stage:mpv` refuses first, that `make` fails naming it; restore it.
- [ ] **Step 4: Commit** `MAE: audit the packaged bundle and smoke the packaged app`.

---

### Task 11: CI: the shared native build, the PR job and `desktop-release.yml`

**Files:**
- Create: `.github/actions/raven-desktop-native/action.yml`
- Modify: `.github/workflows/pull-request-checks.yml` (the `desktop` job)
- Create: `.github/workflows/desktop-release.yml`
- Create: `apps/raven/desktop/src/build/releaseAssets.ts`, `releaseAssets.test.ts`, `apps/raven/desktop/release/install-notes.md`
- Modify: `apps/raven/desktop/package.json` (script `release:assets`)

**Interfaces:**
- Consumes: `dmgFileName` (Task 9), `PACKAGED_APP` (Task 10).
- Produces (`@/build/releaseAssets`):

```ts
export const RELEASE_DIR = join('out', 'release')
export const SOURCE_BUNDLE = join('..', '..', '..', 'libs', 'raven', 'mpv', 'native-build', 'source-bundle')
export const releaseAssetNames = ({ version }: { version: string }) => ({
  dmg: `raven-player-${version}-arm64.dmg`, zip: `raven-player-${version}-arm64.zip`,
  sources: `raven-player-${version}-sources.tar.gz`, sums: 'SHA256SUMS',
}) as const
export const sha256Sums = (entries: readonly { name: string; sha256: string }[]): string
export const sourcesFrom = (argv: readonly string[]): string // the value after `--sources`, else SOURCE_BUNDLE
```

Rules (Rulings 4 to 7, 17):
- `sha256Sums` sorts by name and writes `` `${sha256}  ${name}\n` `` per entry (two spaces).
- `releaseAssets.ts` (script `release:assets`, `bun src/build/releaseAssets.ts`): empties `RELEASE_DIR`; copies `out/make/dmg/darwin/arm64/raven-player-<v>-arm64.dmg` and `out/make/zip/darwin/arm64/raven player-darwin-arm64-<v>.zip` under their release names; refuses when the source bundle folder is missing (`The source offer ships with the app: build libmpv first, or pass --sources <dir>.`); runs `tar -czf <RELEASE_DIR>/<sources> -C <parent> <folder>`; hashes the three with streaming SHA-256 and writes `SHA256SUMS`.
- **The composite action** holds, as `shell: bash` steps where they run shell: `oven-sh/setup-bun@v2` (`bun-version-file: package.json`), the toolchain step, `bun install --frozen-lockfile`, `bunx nx run @raven/mpv:build`, `actions/cache@v5` with `id: native-cache`, the same paths, and the key `raven-mpv-darwin-arm64-xcode26.6-${{ hashFiles('libs/raven/mpv/native/**', 'libs/raven/mpv/src/**', 'libs/raven/mpv/test/**', 'libs/raven/mpv/package.json', 'libs/raven/mpv/README.md', 'libs/raven/mpv/tsconfig*.json', 'libs/raven/core/src/**', 'bun.lock', 'tsconfig.base.json', '.github/actions/raven-desktop-native/action.yml') }}`, `fetch:libmpv` on a miss, `build:native`, `audit:native`. Copy the step names and comments from today's job.
- **The PR `desktop` job** keeps its name, runner, timeout and env: checkout, `uses: ./.github/actions/raven-desktop-native`, then its remaining steps unchanged, and after `📦 Make the unsigned app`: `🔎 Audit the packaged bundle` (`bunx nx run @raven/desktop:audit:bundle`) and `🚬 Smoke the packaged app` (`bunx nx run @raven/desktop:smoke:packaged`); the artifact still uploads `apps/raven/desktop/out/make` (now the dmg and the zip).
- **`desktop-release.yml`**, `name: 🖥️ Desktop release`, with a header comment saying what it does and how it coexists with `release.yml`:
  - `on`: `push.tags` the two patterns of Ruling 5; `workflow_dispatch`; `pull_request.paths` `.github/workflows/desktop-release.yml`, `.github/actions/raven-desktop-native/**`, `apps/raven/desktop/forge.config.ts`, `apps/raven/desktop/src/build/**`, `apps/raven/desktop/release/**`. `permissions: contents: read`. `concurrency: desktop-release-${{ github.ref }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
  - Job `build` (`🖥️ Build raven player for macOS arm64`), `macos-26`, `timeout-minutes: 150`, the PR job's env: checkout (the PR head SHA on `pull_request`); on `push` only, `🏷️ Check the tag` fails unless `$GITHUB_REF_NAME` equals `v$(jq -r .version apps/raven/desktop/package.json)`; the composite action; `bunx nx run @raven/mpv:test:native`; `bunx nx run @raven/desktop:make`; `audit:bundle`; `smoke:packaged`; `bunx nx run @raven/desktop:release:assets`; `actions/upload-artifact@v7` of `apps/raven/desktop/out/release` named `raven-player-release-${{ github.sha }}`, `if-no-files-found: error`.
  - Job `publish` (`🏷️ Attach raven player to the release`), `needs: build`, `if: github.event_name == 'push'`, `ubuntu-24.04`, `timeout-minutes: 20`, `permissions: contents: write`: checkout (for the notes file); download the artifact; wait for `gh release view "$TAG"` up to 30 tries 20 s apart (fail after); `gh release upload "$TAG" release/* --clobber`; if `gh release view "$TAG" --json body -q .body` lacks a line `## Installing raven player`, write the body, a blank line and `apps/raven/desktop/release/install-notes.md` to a file and `gh release edit "$TAG" --notes-file` it. `GH_TOKEN: ${{ github.token }}`, `TAG: ${{ github.ref_name }}`.
- **`install-notes.md`** starts with `## Installing raven player`, then: download the dmg (or the zip) for Apple Silicon; check it with `shasum -a 256 -c SHA256SUMS --ignore-missing`; drag raven player to Applications; on the first open macOS says it cannot verify the app, because it is signed ad hoc: open System Settings, Privacy and Security, and choose Open Anyway beside raven player, once; the sources for libmpv and its libraries are in the sources tarball; raven player checks for updates once a day and can be told not to in Settings.

- [ ] **Step 1: Write the failing tests** in `releaseAssets.test.ts`: `releaseAssetNames({ version: '0.6.0' })` equals the four names; `sha256Sums([{ name: 'b', sha256: '2' }, { name: 'a', sha256: '1' }])` is `'1  a\n2  b\n'`; `sourcesFrom(['--sources', '/tmp/s'])` is `'/tmp/s'` and `sourcesFrom([])` is `SOURCE_BUNDLE`.
- [ ] **Step 2: Run to verify they fail**, **implement** the script, the action, both workflows and the notes, **verify** with the Global Constraints command plus `bunx nx run maester:spellcheck`.
- [ ] **Step 3: Check locally.** After `make`, `bunx nx run @raven/desktop:release:assets -- --sources "$(mktemp -d)"` writes the four files and `(cd apps/raven/desktop/out/release && shasum -a 256 -c SHA256SUMS)` passes. Each of the three YAML files parses: `bun --print 'Bun.YAML.parse(await Bun.file("<file>").text()).name'` prints its name.
- [ ] **Step 4: Commit** `MAE: build, audit and attach raven player to each release tag`. The dry run is proved when the branch is pushed: the PR's `🖥️ Desktop` job and the path-filtered `🖥️ Build raven player for macOS arm64` both pass, and the latter's artifact holds the four files; `publish` is skipped.

---

### Task 12: Docs and the spec's outcomes

**Files:**
- Modify: `CLAUDE.md` (root), `apps/raven/CLAUDE.md`, `apps/raven/README.md`, `docs/superpowers/specs/2026-10-12-raven-desktop-design.md`, `.claude/skills/version-bump/SKILL.md` (no new README anywhere)

Content (spec section 7 "Documentation", "Rollout" 3):
- **Root `CLAUDE.md`:** project table rows `@raven/mpv` (`libs/raven/mpv`, "N-API addon over our pinned libmpv build: macOS video surface, typed async wrapper") and `@raven/desktop` (`apps/raven/desktop`, "raven player: Electron 44 and Forge, renderer on `@raven/ui`, libmpv through `@raven/mpv`, Playwright e2e"); the CSS section's opening names `@raven/ui` and the desktop renderer with the web apps; the tooling bullets add `tooling/tsconfig/node.json` and `tooling/oxlint/node.json` for Node code that is neither a server nor a web app; one Rules bullet: `e2e`, `test:native`, `audit:bundle` and `smoke:packaged` need macOS and run in the `🖥️ Desktop` job, not `verify`.
- **`apps/raven/CLAUDE.md`:** Structure names `@raven/mpv` and `@raven/desktop`. A new "Desktop" section: the UI lives in `@raven/ui`; two player engines (html, native) behind `Engine` and `PlayerServices`; main owns paths, servers, cookies and mpv, the renderer holds ids; the bridge (`PlayerCommand` allowlist on one MessagePort) and the eight-call server allowlist; main-process modules take Electron as arguments so `bun test` runs them; test hooks only unpackaged (all four named); never build libmpv or the addon without the toolchain (CI does); logs in `~/Library/Logs/raven`, redacted; the release flow (`desktop-release.yml` on a release tag, its dry run, Developer ID off). The `Platform` seam, `RavenProvider` and the library hosts are named as phase 2 per the spec, not yet present.
- **`apps/raven/README.md`:** a "raven player (macOS)" section after "Develop": install from a release (the four assets, checking `SHA256SUMS`, Open Anyway once, the terminal alternative `xattr -dr com.apple.quarantine "/Applications/raven player.app"` for someone who prefers it); opening files (Open, drop, Open With, Always Open With at `Alternate` rank, Open Recent, next in folder); servers and handoff (adding a server, the trust prompt, a session per server, the PIN asked again after a relaunch, the web setting "Open videos in raven player", and the Netlify advice: add the server's own origin, not the Netlify site's); This computer (PCM, receiver passthrough of AC3 and DTS on macOS, headphones and spatial audio); diagnostics (logs folder and rotation, crash reports kept locally, Copy Diagnostics, nothing sent unless you send it); updates (the daily check, the switch, no silent install while ad hoc signed); building (`bunx nx run @raven/desktop:dev`, `make`, `audit:bundle`, `smoke:packaged`, `e2e`); releasing (`version-bump` with `--push`, `release.yml` and `desktop-release.yml` together, the PR dry run, dispatching it on `main` to warm the libmpv cache before tagging). "Not there yet" gains library modes, Intel Macs, Windows and Linux.
- **The spec:** the status line says P7 shipped and names the plan; a new "### P7 release outcomes" under "Spike outcomes" records Rulings 1 to 19 in a sentence each where they change or narrow the spec (staging, inside-out signing, `hdiutil`, asset names and the sources tarball, the tag filter, the dry run, the composite action and cold tag builds, the releases-list check, logs path, what the log never holds, marks always logged, no addon rebuild), and a table of the budgets measured on this Mac from the packaged app's log (launch cold and warm, idle memory, CPU paused, first frame of M1; M2's memory and the XDR rows marked as owed with "Testing for the PR"); "Follow-ups" keeps the addon rebuild items and adds Developer ID signing and notarization, then silent updates.
- **`version-bump` skill:** step 3 says the pushed tag runs `release.yml` and `desktop-release.yml`, which attaches raven player's dmg, zip, sources and `SHA256SUMS` once its build passes.

- [ ] **Step 1: Measure** on the packaged app (quit any raven player first): its first launch since login counts as cold, the next two as warm; sit 60 s on Home, play M1, pause 60 s, quit; read the marks from `~/Library/Logs/raven/raven.log`.
- [ ] **Step 2: Write the docs** above. No em or en dashes; `bunx nx run maester:spellcheck` and `bunx nx run-many -t format:check` pass.
- [ ] **Step 3: Verify** with the Global Constraints command.
- [ ] **Step 4: Commit** `MAE: document raven player's install, diagnostics and release`.

---

## Testing for the PR (manual, macOS arm64)

What tests prove: redaction, rotation, flood control and log failures; the launch, engine, open, first-frame, quit, idle-memory and open-to-frame lines; Help's three actions and the diagnostics text with and without an engine; the release check against builds, prereleases, drafts, missing dmgs, bad replies and clocks; the update service, menu, Settings switch and quiet notice end to end against a fixture; staging, inside-out signing order, the dmg maker, the bundle audit and the packaged smoke; the release assets and sums. What only a person can check, on the PR's `raven-player-darwin-arm64-<sha>` artifact downloaded through a browser (so it carries quarantine):

- **Gatekeeper:** open the downloaded dmg, drag raven player to Applications, open it: macOS refuses once; System Settings, Privacy and Security, Open Anyway; it opens, and later opens without asking. The zip does the same. Never "is damaged".
- **Finder:** Open With on M1 and M2 from a cold start plays each (the log's `raven-open-to-frame-ms` under 1,500 for M1 from local disk); after Always Open With, a double-click plays; a drop on the Dock icon plays.
- **Links:** with raven web's "Open videos in raven player" on, "Open in raven player" from Safari and from Chrome, cold and warm, reaches the installed app with the browser's own confirmation, and M2 from a locked library with the admin lock on plays after the password and the PIN.
- **Display:** on an XDR display at 120 Hz if one is at hand, M2 shows EDR highlights above the UI's white with `target-colorspace-hint` on, and 10 minutes show 0 dropped frames (`i`); otherwise record it as still owed.
- **Budgets from the log:** launch under 800 ms cold and 400 ms warm; idle memory under 300 MB; M2 playing 10 minutes under 700 MB plus the demuxer cache; CPU paused under 2; quit under 1 s with no process left (`pgrep -f "raven player"`).
- **Help and updates:** Show Logs and Show Crash Reports open Finder on their folders; Copy Diagnostics pastes the six lines with real versions and EDR headroom, and nothing private; Check for Updates says this is the newest release (or offers the newer one) and opens the GitHub page.
- **Without the engine:** in the installed copy, rename `Contents/Resources/mpv` away in a throwaway copy and reseal only its outer bundle (`codesign --sign - --force "<copy>.app"`): M1 plays through html, a server title opens in the browser, the log says why, Copy Diagnostics says `unavailable`.
- **The workflow:** the PR's path-filtered `🖥️ Build raven player for macOS arm64` passed and its artifact holds the dmg, the zip, the sources and `SHA256SUMS`; `shasum -a 256 -c SHA256SUMS` passes on the downloaded files.

## Self-review notes

- **Spec coverage (P7):** libmpv, MoltenVK and the addon outside the asar with every Mach-O signed, `@rpath` and loader-relative paths kept, `addonPath` from `process.resourcesPath` (Tasks 8, 10); dmg and zip (Tasks 8, 9); `desktop-release.yml` on release tags for arm64 with ad hoc signing and the dmg, the zip and `SHA256SUMS` attached, plus the sources (Task 11); Developer ID and notarization wired behind env vars and off (Ruling 18, unchanged `signingFrom`); the shared version and About (Ruling 17, Task 10's audit, Task 11's tag check); the update check at launch at most daily, from the menu, switchable, a quiet notice linking the release page, shaped to become an install later (Tasks 5 to 7); `crashReporter.start({ uploadToServer: false })` into `crashDumps` (Task 2); the rotating log of 5 files of 1 MB recording launches, opens, refusals, mpv's warnings and errors and the budget marks (Tasks 1, 2); Show Logs, Show Crash Reports, Copy Diagnostics with every field the spec lists (Task 4); memory and CPU budgets (Task 3); the docs and the spec's outcomes (Task 12).
- **Types across tasks:** `createLog`, `Log`, `LOG_FILE` (1) in 2, 10; `openLine`, `logsDirFor` (2) in 2; the `mark` helper (2) in 3; `BUDGETS`, `createBudgets` (3) in 3, 12; `diagnosticsText`, `createHelpActions` (4) in 4; `checkForUpdates`, `isCheckDue`, `UpdateCheck`, `RELEASES_URL`, `dmgNameFor`, `setUpdates` (5) in 6; `UpdateStatus`, `UpdateService`, the four requests, the `updates` reply and the `updateAvailable` event (6) in 7; `MPV_MACH_O`, `listSignables`, `isMachO`, `signingOrder` (8) in 10; `dmgFileName` (9) in 11 (the release names repeat its pattern); `PACKAGED_APP` (10) in 11. `dmgNameFor` (Task 5) and `dmgFileName({ arch: 'arm64' })` (Task 9) must agree; Task 9's test pins the same string Task 5's builder uses.
