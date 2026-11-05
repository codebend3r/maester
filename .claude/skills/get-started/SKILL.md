---
name: get-started
description: >-
  Use when setting up maester on a new machine or fresh clone, onboarding to the repo, installing everything needed to run its commands (dev servers, prebuilds, builds, unit and e2e tests, lint, typecheck, format), or when `bun run verify` (or the lefthook pre-push hook, which runs the same checks) fails on tasks nobody changed. Covers errors like "Failed to inspect Python interpreter", "Bad CPU type in executable", `Executable not found in $PATH: "ffmpeg"`, `uvx: command not found`, `nx: command not found` or `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` on `nx login`, `maestro: command not found` on `app:e2e`, a missing `pod`, `watchman` or Xcode, a wrong Bun version, or `bun run mpv:native` failing with missing source archives or `native-build/prefix/bin/ffmpeg ENOENT`.
---

# Get started

The goal is a machine ready to run every command in the root `package.json`, not just `bun run verify`. Read its current `scripts` and the project scripts they invoke before setup; do not assume this skill's command list stays exhaustive. Install all required tool tiers by default for a full `/get-started` request, unless the user explicitly scopes it down. Inventory each root script against its tools, generated artifacts, services, credentials and platform requirements. Report blockers rather than claiming readiness from `verify` alone.

`bun run verify` is the baseline gate. It runs spellcheck, typescript-only, one-command-per-script, dead-code, dead-css, lint (Python, TypeScript, SCSS), format check, typecheck, unit and screen tests, and generic builds. It does not prove native builds, packaging, simulator flows, Docker or authenticated tools work.

A fresh clone that fails `verify` almost always has an environment problem, not a code problem. Fix the machine; don't edit source, configs or tests to make a check pass, and never skip the hooks.

## 1. Check the tools

Install by tier. A full setup includes every tier below; a scoped setup includes the tiers its commands need. The repo is macOS on Apple silicon first: the device app, desktop and their e2e need it. Installing prerequisites is not permission to deploy, publish, sign in as the user, overwrite credentials, migrate personal app data or leave services running. Ask before privileged changes, changing `xcode-select`, or large Xcode/runtime downloads unless the user already approved them.

**Core** (`verify`, lint, typecheck, format, unit tests, `dev:*`, `sandbox:sparrow`)

| Tool               | Why                                                                                                   | Check                                 | Install                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Bun                | Runs everything; must match `packageManager` in `package.json`                                        | `bun --version`                       | `curl -fsSL https://bun.sh/install \| bash -s bun-v<pinned>` |
| uv / uvx           | Python lint, format and tests; `uvx typos` spellcheck                                                 | `uv --version`                        | `brew install uv`                                            |
| Python 3.12        | `apps/sparrow/api` pins `>=3.12,<3.13`; `scripts` uses its env                                        | `uv python find 3.12`                 | `uv python install 3.12`                                     |
| ffmpeg and ffprobe | `@raven/server` and `@raven/core` tests make real clips, and the dev server probes with them          | `ffmpeg -version && ffprobe -version` | `brew install ffmpeg`                                        |
| Nx CLI (optional)  | `nx login`, which signs this machine in to the Nx Cloud workspace that `nxCloudId` in `nx.json` names | `nx --version`                        | `brew install nx`                                            |

**Device app** (`app:prebuild:*`, `app:build:ios`, `app:build:tvos`, `app:start`, `test:screens`, `app:e2e`)

| Tool                | Why                                                                                                                                                                  | Check                                                                          | Install                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Node 22.18 or newer | Babel loads `babel.config.ts` through Node's type stripping; Metro and jest need it                                                                                  | `node --version`                                                               | `brew install node@22` (CI runs 24)                                               |
| Xcode (full app)    | `xcodebuild` and the simulators. `xcode-select` may point at the Command Line Tools; the scripts use `DEVELOPER_DIR` or `/Applications/Xcode.app/Contents/Developer` | `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version` | App Store, then accept the license and install the simulator runtimes (see below) |
| CocoaPods           | `expo prebuild` runs `pod install`                                                                                                                                   | `pod --version`                                                                | `brew install cocoapods`                                                          |
| watchman            | Without it Metro serves stale bundles; `app:start` stops when it is missing                                                                                          | `watchman --version`                                                           | `brew install watchman`                                                           |
| Maestro 2.11.0      | `app:e2e` (Java comes with the formula)                                                                                                                              | `maestro --version`                                                            | `brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`          |

Missing Xcode is a download to start, not something to hand back to the user. Start it as soon as the check fails: `brew install mas`, then `mas get 497799835`. mas 7 installs through `sudo`, which an agent cannot answer, so have the user run `! sudo mas get 497799835`, or open the App Store page with `open "macappstore://apps.apple.com/app/id497799835"` for them to click Get. The download lands in `$(getconf DARWIN_USER_CACHE_DIR)com.apple.appstoreagent` first; `/Applications/Xcode.app` appears only once installing starts. Xcode 27 is about 4 GB installed, since its platforms download separately, so don't wait for a bigger bundle: `mas list` showing Xcode and `/Applications/Xcode.app/Contents/_MASReceipt` mean it is done. Then `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -checkFirstLaunchStatus`: exit 69 means the license is unaccepted, so the user runs `! sudo /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -license accept && sudo /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -runFirstLaunch`, after which it exits 0. Only then download the Metal Toolchain and the iOS and tvOS runtimes. In zsh, write those flags out literally: an unquoted `$var` holding `-downloadPlatform iOS` is not split into words, and `xcodebuild` exits 64 with its usage text.

The Maestro tap installs its latest release (2.12.1 in November 2026), not the 2.11.0 CI pins as `MAESTRO_VERSION` in `.github/workflows/native-checks.yml`. For the exact pin, unzip `https://github.com/mobile-dev-inc/maestro/releases/download/cli-2.11.0/maestro.zip` instead. Either way it needs `JAVA_HOME` (see the failure table).

**Android TV** (`app:prebuild:android-tv`, `app:build:android-tv`): Android Studio with the SDK in `~/Library/Android/sdk` (`ANDROID_HOME`), a TV emulator named `raven_tv`, and Gradle on Android Studio's JDK (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`). CI runs this job on Linux because GitHub's macOS runners cannot run the emulator.

**Desktop** (`desktop:dev`, `desktop:build`, `desktop:e2e`, `desktop:test:native`, `desktop:make`): macOS on Apple silicon, Xcode as above. After `bun install`, `bunx nx run @raven/desktop:install:electron` fetches the Electron binary. For ordinary desktop development, use the CI-built `libs/raven/mpv/resources/darwin-arm64` (gitignored). Do not build libmpv or the addon without the full native toolchain; explicitly reproducing the Desktop native job needs the additional setup below. `desktop:smoke:packaged` writes into your own `~/Library/Application Support/raven`.

**Supabase** (`@raven/supabase`'s `test:db`, `lint:db`, `check:functions`, `test:functions`; none run in `verify`): Docker with its daemon running (`brew install --cask docker`), and Deno (`brew install deno`, CI runs 2.9.7). The Supabase CLI itself arrives with `bun install` (a devDependency), so there is nothing to install for it.

**Docker images** (`ci:docker`, `docker build -f apps/<product>/Dockerfile .`): Docker as above. Check `docker info`, not just `docker --version`: the daemon must be running. `ci:docker` builds the disposable Linux checks image; it cannot run the macOS native or simulator jobs. It stops at the first failing step, so rerun only the rest by naming them: `bun run ci:docker -- test dead-code dead-css test:screens build`. Its image installs Ubuntu's apt `ffmpeg`, not the BtbN ffmpeg 9.0.2 the PR checks pin, so `@raven/server`'s playback test "draws the subtitle while it is up" fails there every time (`expected 33.645364 to be less than 30`). That is a gap in `scripts/ci.Dockerfile`, not the machine; report it rather than counting `ci:docker` as broken setup. Don't run anything heavy on the host while it runs: the container's tests time out under load.

**Git and authenticated tooling** (`affected`, `affected:tasks`, `lint-staged`, `claude-audit`, `dev:sparrow`, `sandbox:sparrow`): Apple's Git and command-line tools, `jq` for the simulator recipes, and a signed-in Claude Code CLI with network access. Install missing `jq` with `brew install jq` and Claude Code with `brew install --cask claude-code`; check `git --version`, `jq --version`, `claude --version` and `claude auth status`. Let the user complete any sign-in, never collect their credentials. Read `scripts/audit_claude_md.sh` for its current model/access requirements; the root command is `bun run claude-audit`, not `bun run audit`. Fetch `origin` so affected checks and audits have their base ref. `lint-staged` operates on the user's index: do not stage files just to exercise it. `graph` needs no extra global package; Nx comes with the workspace install. A browser is only needed to view its interactive output.

One shot for a Mac that needs everything but the GUI apps:

```bash
brew install uv ffmpeg node@22 cocoapods watchman deno nx jq cmake ninja meson pkgconf
brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro
brew install --cask docker android-studio claude-code
uv python install 3.12
```

Run `uv python install 3.12` even when some Python is on the PATH. uv only accepts 3.12, and it fails outright on a broken interpreter it meets while searching (see below), so a uv-managed 3.12 is the reliable fix.

`verify` and every task run through `bunx nx`, so the global Nx CLI is only for `nx login`. That command opens a browser, so run it yourself rather than through an agent (in Claude Code, `! nx login`). Homebrew's `nx` can be newer than the `nx` pinned in `package.json`; inside the repo it hands off to the pinned one, so `nx --version` printing a newer `Global` than `Local` is expected.

Env files: copy `apps/raven/.env.example`, `apps/sparrow/.env.example` and `apps/rookery/.env.example` to `.env` beside them when you run that product's dev server, without overwriting an existing one (`cp -n`). Never put a `.env` at the repo root.

- rookery: `dev:rookery`'s server exits with `missing required environment: PUBLIC_URL, SERVICE_TOKEN` until both are set. Locally, `PUBLIC_URL=http://localhost:5180` (Vite's address) and `SERVICE_TOKEN` from `openssl rand -hex 32`. Give sparrow the same token as `ROOKERY_SERVICE_TOKEN`.
- sparrow: `sandbox:sparrow` is the local way to test it. It needs no keys and calls the model through `claude -p` on your own sign-in, so keep `ANTHROPIC_API_KEY` empty for it. `dev:sparrow` runs the real server, which refuses to boot (`MissingConfig`) without `ANTHROPIC_API_KEY`, `SEERR_API_KEY`, `ROOKERY_PUBLIC_URL` and the API key of every Radarr, Sonarr, SABnzbd, Lidarr and Tautulli instance the file configures with a URL. Those are the user's credentials: report `dev:sparrow` as blocked on them, never fill them in.
- raven: a `.env` usually exists already. `dev:raven` moves Vite to the next free port (5174) when another checkout already holds 5173.

## 2. Install and verify

```bash
bun install --frozen-lockfile   # deps, Nx, and the lefthook git hooks
bun run verify
```

A first run takes a minute or two. Nx caches results, so `bun run verify:uncached` reruns everything after an environment change.

A few UI and media tests wait on timers (`waitFor` at 5000 ms, a frame-likeness threshold), so they fail when the Mac is busy: other worktrees' test runs, a long-running `dev:raven:prod`, Docker starting up or a large install. Nx then names them as flaky (`@raven/web:test`, `@raven/server:test`, `@raven/music:test:screens`). Check `uptime`, rerun just the failed task, and run `verify` again once the machine is quiet; a test that fails alone with the same message every time is a real failure. Don't start dev servers or `ci:docker` alongside `verify`.

## 3. Run each kind of command

Everything goes through Nx from the repo root; `bun run <script>` is a wrapper.

| Kind              | Command                                                                                                | Needs                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Dev servers       | `bun run dev:raven`, `dev:sparrow`, `dev:rookery`, `sandbox:sparrow`, `app:start`, `desktop:dev`       | core; each product's `.env`            |
| Prebuild          | `bun run app:prebuild:ios`, `app:prebuild:tvos`, `app:prebuild:android-tv`                             | device app tier (Android for the last) |
| Build             | `bun run build`, `app:build:ios`, `app:build:tvos`, `app:build:android-tv`, `desktop:build`            | as above                               |
| Unit tests        | `bun run test`, `test:screens` (device app render tests)                                               | core, Node and Xcode for screens       |
| Lint              | `bun run lint` (or `lint:ts`, `lint:css`, `lint:py`), `lint:fix`                                       | core                                   |
| Typecheck         | `bun run typecheck`                                                                                    | core                                   |
| Format            | `bun run format`, `format:check`                                                                       | core                                   |
| Device app e2e    | see below                                                                                              | device app tier                        |
| Desktop e2e       | `bun run desktop:e2e`                                                                                  | desktop tier                           |
| Database and Edge | `bunx nx run @raven/supabase:db:start`, then `test:db`, `lint:db`; `check:functions`, `test:functions` | Docker, Deno                           |

Use an iPhone that the runtime supports (`xcrun simctl list -j runtimes` shows each runtime's device types; iOS 27.0 has iPhone 17 and 18 Pro, not 16). `xcodebuild -downloadPlatform iOS` can also install a device-specific runtime such as `iOS-27-2-iPhone19-4` that supports no simulator device type, so pick the runtime by its supported devices, as the e2e steps below do, never just the last available one. A `maestro` run from a non-interactive shell needs `JAVA_HOME` exported inline.

The device app's build, prebuild and e2e targets are cached by Nx (their inputs include `APP_VARIANT` and the Xcode version). Add `--skip-nx-cache` to force a real run.

### Desktop native PR job, locally

`bun run mpv:native` selects `${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}` and runs the audit and real native tests through Nx. Its task dependencies first build or restore pinned libmpv/MoltenVK/FFmpeg, then run the uncached addon build, which refreshes the current HEAD's source bundle and provenance before either check starts. No manual shell export or separate build command is needed for this root command with Xcode at its default path. For a different Xcode installation, supply `DEVELOPER_DIR`. CI also uses `.github/actions/raven-desktop-native/action.yml`; read it and `libs/raven/mpv/README.md` for the current toolchain.

A full setup includes this source build so `mpv:native` can run; CI-built runtime resources are only a shortcut for scoped desktop development. First check the full toolchain: macOS arm64, full Xcode with its Metal Toolchain, cmake, ninja, meson, pkgconf, Python 3, make, patch and Apple's command-line tools. Check `uname -m`, `xcodebuild -version`, `xcrun metal --version`, `cmake --version`, `ninja --version`, `meson --version`, `pkgconf --version`, `python3 --version`, `make --version` and `patch --version`. Supply `DEVELOPER_DIR` explicitly if needed. CI currently selects Xcode 26.6. Homebrew can provide build tools (`brew install cmake ninja meson pkgconf`), never the shipped runtime libraries. Do not blindly copy CI's disposable-machine setup onto the user's Mac.

If `xcrun metal --version` reports a missing Metal Toolchain, install it after obtaining approval for the Xcode component download, then verify it. An installed Xcode app does not imply Metal is installed. Use the same Xcode installation for the component install and build. Direct `bunx nx` native targets need `DEVELOPER_DIR` when `xcode-select` points to Command Line Tools; the root `mpv:native` command supplies the default itself. The cache key invokes `xcodebuild -version`:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -downloadComponent MetalToolchain
xcrun metal --version
```

This selects Xcode for the current shell without changing the machine's `xcode-select`. Stop and report a failed download, license prompt or permission error rather than bypassing it.

Once the toolchain is available, run from the repo root, stopping on any failure:

```bash
bun install --frozen-lockfile
bun run mpv:native
```

`fetch:libmpv` builds the pinned runtime sources and preserves matching source archives, the private FFmpeg executable and runtime resources. It is Nx-cached and can take several minutes cold. `build:native` depends on it and builds the addon against that prefix. Audit and native tests depend on `build:native`, so Nx enforces ordering and builds their shared prerequisite once. Keep `build:native` uncached: `refreshSourceBundle` must run after cached runtime restoration, on every HEAD, even after a rebase, squash or unrelated commit. `fetch:sources` alone only downloads sources, so it cannot replace `fetch:libmpv`.

`Native source receipt mismatch` is not a missing package. The audit checks the source revision against `git rev-parse HEAD`, along with archive and source-lock hashes. Cached native outputs can belong to a previous HEAD even when their compilation inputs are unchanged. Do not weaken that check or hand-edit the receipt. The root command must rebuild the addon and regenerate the matching source archive/provenance before auditing. If this returns, inspect the Nx dependency graph and confirm `build:native` ran after `fetch:libmpv`, rather than prescribing another tool install. Validate setup by running the exact `bun run mpv:native` command with `DEVELOPER_DIR` unset, not only a manually prepared shell; run it twice to cover cached runtime restoration.

The CI-built runtime resources alone are sufficient for ordinary desktop setup, not this full audit/test command: the audit also needs matching source archives in `native-build/source-bundle`, and the tests create clips with `libs/raven/mpv/native-build/prefix/bin/ffmpeg`. A Homebrew FFmpeg on `PATH` does not replace that private executable. Fix missing build outputs rather than weakening the audit, substituting runtime libraries or editing tests. These native checks remain outside `verify`.

### Device app e2e, step by step

The root `ci:app:ios`, `ci:app:tvos`, `ci:app:android-tv`, `ci:wren` and `ci:desktop:e2e` scripts run each PR job end to end on this Mac the way CI does: they set the build environment, start and stop the fixture server, make the simulator or emulator, build, check the pods, install and run the flows. Prefer them for a pass/fail answer, and add `-- --skip-nx-cache` to run the flows for real on a cached pass. `ci:app:android-tv` leaves its emulator running. The manual steps below are for iterating on one flow.

`bun run app:e2e` runs Maestro's flows in `apps/raven/app/e2e`. It needs three things in place first, the way the PR checks set them up:

1. Build the fixture build: `APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bun run app:build:ios`. The development variant allows plain http to the loopback, and the bypass origin is the fixture server Expo bakes into the bundle, so the app opens straight on Home. Without it every flow fails within a minute on `Assertion is false: "Kestrel Point" is visible`, starting with `signIn.yaml`, because the app never reaches the fixture. Both values are Nx inputs, so a cached build made without them does not stand in.
2. Start the fixture server in a second terminal and wait for `raven fixture server ready`: `bunx nx run @raven/server:serve:fixture`.
3. Boot an iPhone simulator and install the build on it:

   ```bash
   runtime="$(xcrun simctl list -j runtimes iOS | jq -r '[.runtimes[] | select(.isAvailable) | select(any(.supportedDeviceTypes[]; .name == "iPhone 17"))] | last | .identifier')"
   device="$(xcrun simctl create raven-phone com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
   xcrun simctl boot "$device" && xcrun simctl bootstatus "$device" -b
   xcrun simctl install "$device" apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/Raven.app
   ```

Then `bun run app:e2e`. A cold Maestro driver can start slowly; set `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000` if it times out. Maestro cannot drive tvOS; `app:e2e:tvos` instead uses XCUITest and the Siri Remote. Android TV uses `app:e2e:android-tv` with Maestro and adb. Stop the fixture server when done.

To run one flow, call Maestro directly: `maestro test apps/raven/app/e2e/<flow>.yaml`. To iterate on the flows, build iOS once and rerun `bun run app:e2e` with the fixture server up.

### Apple and Android TV commands

Read `apps/raven/app/README.md`, its `CLAUDE.md`, current package scripts and `.github/workflows/pull-request-checks.yml` before device setup. Both Apple jobs require macOS and Xcode; neither Docker nor `act` substitutes for them. Check available runtimes with `xcrun simctl list -j runtimes`. If missing, obtain approval for the large downloads, then install with `xcodebuild -downloadPlatform iOS` and `xcodebuild -downloadPlatform tvOS`. Use compatible device types, not a hardcoded iPhone from a different runtime.

Build the device app with the Xcode CI pins, not just the newest one: `.github/actions/raven-app-setup/action.yml` selects `Xcode_26.6.app`. The App Store only serves the latest Xcode, and Xcode 27.2's Swift 6.4.2 compiler crashes building the tvOS app (`swift-frontend` dies in SILGen on `expo-modules-core`'s `AsyncFunctionDefinition`, the build exits 65, and the log's only `error:` lines are bun's), though the iOS build gets through. To match CI, install the pinned Xcode beside the App Store one as `/Applications/Xcode_26.6.app` (from developer.apple.com/download/all, signed in as the user) and point `DEVELOPER_DIR` at it for the app targets. When a build fails with no compiler `error:`, search the log for `Stack dump:` before anything else.

Run Apple builds sequentially with `APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490`. The tvOS e2e runs against the `ios/` project the tvOS prebuild generates, and the iOS prebuild overwrites it, so finish the iOS flows before building tvOS, and build tvOS right before `app:e2e:tvos`. After each build, compare `apps/raven/app/ios/Podfile.lock` with `Pods/Manifest.lock`; `expo prebuild` can exit 0 despite a failed pod install. For tvOS also check the generated project uses `SDKROOT = appletvos`. Boot and install on an Apple TV simulator, start the fixture server and wait for its ready line, then run `bun run app:e2e:tvos` with `TVOS_SIMULATOR` set to that simulator's name. This is the Siri Remote XCUITest, not merely a launch check. For iOS use the Maestro flow above.

For Android, check Android Studio's bundled Java, `ANDROID_HOME`, SDK command-line tools, platform-tools (`adb`), emulator, and the SDK platform, build-tools and NDK versions required by the generated project. Use Android Studio's SDK Manager or `sdkmanager` to install missing packages; let the user accept license terms instead of blindly accepting them. Check `adb version`, `java -version` and `emulator -list-avds`. Create an Android TV AVD named `raven_tv` using an available TV image for the host architecture (arm64 on this Mac, not CI's x86_64 image), and boot it before flows. Export the SDK and Android Studio JDK paths for Android commands; for Maestro use a working Java installation and verify `maestro --version` actually runs.

For the Android TV flows, start the fixture server and wait for readiness, then run:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bun run app:build:android-tv
"$ANDROID_HOME/platform-tools/adb" install -r apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
bun run app:e2e:android-tv
```

The e2e command reverses port 8490 so the emulator can reach the fixture server. `app:dev:ios`, `app:dev:ipad` and `app:dev:tvos` use the named simulators `raven-phone`, `raven-pad` and `raven-tv`; create compatible devices if absent. `app:start` needs watchman and Metro's port available; `app:server` runs the real development server, not the fixture server.

`prebuild` runs `expo prebuild --clean`, which regenerates `ios/` on every build, so never hand edit it. The builds compile arm64 only (`ARCHS=arm64`), so they need an Apple Silicon Mac, and each takes several minutes cold; later local builds reuse `apps/raven/app/build/`. A `raven-phone` or `raven-tv` simulator left over from `dev:ios` or `dev:tvos` clashes with the `simctl create` names, so delete it (`xcrun simctl delete raven-phone`) first.

### Desktop packaging and other root commands

After preparing native resources, install Electron with `bunx nx run @raven/desktop:install:electron`. Run `bun run desktop:build`, `bun run desktop:test:native` and `bun run desktop:e2e`. Playwright is a workspace dependency; these tests drive Electron, so do not install unrelated browser binaries unless a current test explicitly requires them. Read the desktop README and Forge config for packaging tools and output paths. `desktop:make` produces the app and installers; `desktop:audit:bundle` and `desktop:smoke:packaged` inspect an existing packaged app, not just the TypeScript build. Keep the default ad-hoc signing unless the user explicitly requests signing/notarization and supplies their own credentials.

Ask before `desktop:smoke:packaged`: it launches the real app, checks GitHub for updates, writes `updates.checkedAt`, and can migrate the user's `~/Library/Application Support/raven/desktop-config.json` to version 5; its logs go to `~/Library/Logs/raven`. This is not a throwaway test profile. Report it as untested if permission is withheld.

For `dev:raven`, `dev:rookery`, `dev:sparrow` and `sandbox:sparrow`, use product-local env examples, check port availability and required backend sign-ins, and verify startup without disclosing secrets. Do not overwrite existing env files. For `ci:docker`, verify Docker is running and allow space/time for a cold image build; use `PLATFORM=linux/amd64` only when explicitly reproducing CI's architecture on this arm64 Mac. Maintenance commands (`lint:fix`, `format`, `lint-staged`) may modify files; inspect the diff and preserve the user's work. `affected` needs the chosen Git base/head, and `graph` is a long-running viewer rather than a pass/fail check.

## 4. Read the failure

Nx ends with a `Failed tasks:` list. Rerun just one to see its output: `bunx nx run <project>:<target> --skip-nx-cache` (for example `bunx nx run @sparrow/api:lint:py --skip-nx-cache`).

| Symptom                                                                                               | Cause                                                                                         | Fix                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sparrow/api` and `scripts` fail `lint:py`, `format:check` and `test` together                       | uv has no usable Python 3.12                                                                  | `uv python install 3.12`                                                                                                                                              |
| `Failed to inspect Python interpreter ... /usr/local/bin/python3` / `Bad CPU type in executable`      | A leftover Intel Homebrew in `/usr/local` on Apple silicon without Rosetta                    | `uv python install 3.12`; optionally remove the stale `/usr/local` Homebrew                                                                                           |
| `Executable not found in $PATH: "ffmpeg"`, `spawn ffmpeg ENOENT` in `@raven/server` or `@raven/core`  | ffmpeg not installed                                                                          | `brew install ffmpeg`                                                                                                                                                 |
| `xcrun metal --version` reports `missing Metal Toolchain`                                             | Full Xcode is installed but its optional Metal component is absent                            | With approval, export `DEVELOPER_DIR`, run `xcodebuild -downloadComponent MetalToolchain`, then recheck Metal as above                                                |
| `mpv:native` fails with `Native source receipt mismatch`                                              | Generated provenance or cached sources belong to a different HEAD                             | Run the root command, whose uncached `build:native` dependency refreshes the current HEAD after runtime cache restoration; never bypass the audit or edit the receipt |
| `mpv:native` audit fails with `Missing matching source archive: mpv`                                  | Matching native source bundle is missing                                                      | With the full native toolchain available, run the Desktop native build sequence above; runtime resources alone are insufficient                                       |
| `mpv:native` tests fail with `native-build/prefix/bin/ffmpeg ENOENT`                                  | The private source-built FFmpeg is missing                                                    | Run `fetch:libmpv`, then `build:native`, then `bun run mpv:native` as above; installing Homebrew FFmpeg does not fix this path                                        |
| `spellcheck` fails with `uvx: command not found`                                                      | uv not installed                                                                              | `brew install uv`                                                                                                                                                     |
| `nx login` fails with `nx: command not found`                                                         | No global Nx CLI; the repo's Nx lives in `node_modules`                                       | `brew install nx`                                                                                                                                                     |
| `nx login` fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` after "Its time to update Nx"          | An old global Nx (pnpm or npm, below v23) shadows Homebrew's and can't hand off to the repo's | `which -a nx`; remove the stale one (`pnpm rm -g nx`) or upgrade it (`npm i -g nx@latest`), then `hash -r`                                                            |
| Odd failures in many tasks at once, env values you didn't set                                         | A `.env` at the repo root; Nx loads it into every task                                        | Move it to `apps/<product>/.env`                                                                                                                                      |
| `Unable to locate a Java Runtime` from `app:e2e` (Maestro installed)                                  | Homebrew's openjdk is keg-only, so `java` is only macOS's stub                                | Add `export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"` to `~/.zshrc`, open a new shell                                                  |
| `You have 0 devices connected` from `app:e2e`                                                         | No booted simulator; `app:e2e` boots none, and a new Xcode may ship no runtime                | `xcodebuild -downloadPlatform iOS` (about 8 GB), then boot an iPhone as in the e2e steps                                                                              |
| `maestro: command not found` (exit 127) from `app:e2e`                                                | Maestro not installed                                                                         | `brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`                                                                                              |
| `app:start` stops at `watchman`; Metro serves stale code                                              | watchman not installed                                                                        | `brew install watchman`                                                                                                                                               |
| `xcode-select: error` or `xcodebuild requires Xcode` in a prebuild or build                           | Only the Command Line Tools are selected, or Xcode is not installed                           | Install Xcode; set `DEVELOPER_DIR` or run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`                                                           |
| Prebuild "exits 0" but `ios/Pods` is missing                                                          | `pod install` failed inside `expo prebuild`                                                   | `brew install cocoapods`, rerun the prebuild, then `cmp ios/Podfile.lock ios/Pods/Manifest.lock`                                                                      |
| Nx prints `Nx Cloud organization has been disabled` (401)                                             | The free plan was exceeded; remote caching is off until it is re-enabled                      | Ignore it; local caching still works                                                                                                                                  |
| Nx prints `You do not have sufficient access to this workspace` (401)                                 | This machine is not signed in to the Nx Cloud workspace                                       | Optional: `! nx login`; local caching works without it                                                                                                                |
| `sudo: a terminal is required to read the password` from `mas get`                                    | mas 7 installs through `sudo`, and an agent's shell has no terminal                           | The user runs `! sudo mas get 497799835`, or clicks Get on the App Store page                                                                                         |
| `xcodebuild` exits 69, or `-checkFirstLaunchStatus` returns 69                                        | Xcode's license is not accepted yet                                                           | The user runs `sudo xcodebuild -license accept` and `sudo xcodebuild -runFirstLaunch` with Xcode's full path                                                          |
| `app:build:tvos` exits 65 with `Command SwiftCompile failed` in `ExpoModulesCore` and a `Stack dump:` | A newer Xcode's Swift compiler crashes on Expo's module core for tvOS                         | Build with the Xcode CI pins (`Xcode_26.6.app`), with `DEVELOPER_DIR` pointing at it                                                                                  |
| `supabase start` or `test:db` cannot reach Docker                                                     | The Docker daemon is not running                                                              | Open Docker Desktop, then rerun                                                                                                                                       |
| `bun --version` differs from `packageManager` in `package.json`                                       | Wrong Bun installed                                                                           | Install the pinned Bun                                                                                                                                                |
| `format:check` or `lint:*` fails on files you edited                                                  | A real issue in your change                                                                   | `bun run format`, `bun run lint:fix`, then fix what remains by hand                                                                                                   |

`ECONNREFUSED ... :8484` stack traces in the test output are logged by passing tests. Ignore them unless that task is in `Failed tasks:`.

## Done

For full onboarding, reconcile every current root script with the setup inventory. Run the uncached baseline and representative checks for every installed tier, including the native build/audit/tests, desktop packaging checks and device flows when their services and runtimes are ready. Do not run destructive or personal-data commands merely to check installation. Dev servers and Metro are long-running: check startup, then stop only the processes you started. Do not run every root script blindly or concurrently: iOS and tvOS prebuilds overwrite the same generated directory, and any build whose dependencies include `@raven/ui` (`desktop:build`, `web:build`, `build`) starts by deleting `libs/raven/ui/dist`. Run one of those beside an app prebuild and the prebuild fails reading `app.config.ts` with `ERR_MODULE_NOT_FOUND ... @raven/ui/dist/headless.js`; rerun the prebuild alone once the other build is done.

Report tools installed, session environment overrides, each command actually tested and its exit code, and anything untested or blocked by credentials, permissions, downloads or external services. `verify` success alone is baseline-ready, not all-command-ready. `bun run verify` ends with `Successfully ran targets ... for <N> projects` and exits 0. Report the fixes made and preserve unrelated working-tree changes.
