---
name: get-started
description: Use when setting up maester on a new machine or fresh clone, onboarding to the repo, installing everything needed to run its commands (dev servers, prebuilds, builds, unit and e2e tests, lint, typecheck, format), or when `bun run verify` (or the lefthook pre-push hook, which runs the same checks) fails on tasks nobody changed. Covers errors like "Failed to inspect Python interpreter", "Bad CPU type in executable", `Executable not found in $PATH: "ffmpeg"`, `uvx: command not found`, `nx: command not found` on `nx login`, `maestro: command not found` on `app:e2e`, a missing `pod`, `watchman` or Xcode, and a wrong Bun version.
---

# Get started

The goal is `bun run verify` exiting 0 from the repo root. It runs spellcheck, typescript-only, one-command-per-script, lint (Python, TypeScript, SCSS), format check, typecheck, test and build for every project.

A fresh clone that fails `verify` almost always has an environment problem, not a code problem. Fix the machine; don't edit source, configs or tests to make a check pass, and never skip the hooks.

## 1. Check the tools

Install by tier. Everyone needs the core tier; add the others for the commands you will run. The repo is macOS on Apple silicon first: the device app, desktop and their e2e need it.

**Core** (`verify`, lint, typecheck, format, unit tests, `dev:*`, `sandbox:luwin`)

| Tool               | Why                                                                                                   | Check                                 | Install                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Bun                | Runs everything; must match `packageManager` in `package.json`                                        | `bun --version`                       | `curl -fsSL https://bun.sh/install \| bash -s bun-v<pinned>` |
| uv / uvx           | Python lint, format and tests; `uvx typos` spellcheck                                                 | `uv --version`                        | `brew install uv`                                            |
| Python 3.12        | `apps/luwin/api` pins `>=3.12,<3.13`; `scripts` uses its env                                          | `uv python find 3.12`                 | `uv python install 3.12`                                     |
| ffmpeg and ffprobe | `@raven/server` and `@raven/core` tests make real clips, and the dev server probes with them          | `ffmpeg -version && ffprobe -version` | `brew install ffmpeg`                                        |
| Nx CLI (optional)  | `nx login`, which signs this machine in to the Nx Cloud workspace that `nxCloudId` in `nx.json` names | `nx --version`                        | `brew install nx`                                            |

**Device app** (`app:prebuild:*`, `app:build:ios`, `app:build:tvos`, `app:start`, `test:screens`, `app:e2e`)

| Tool                | Why                                                                                                                                                                  | Check                                                                          | Install                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Node 22.18 or newer | Babel loads `babel.config.ts` through Node's type stripping; Metro and jest need it                                                                                  | `node --version`                                                               | `brew install node@22` (CI runs 24)                                                              |
| Xcode (full app)    | `xcodebuild` and the simulators. `xcode-select` may point at the Command Line Tools; the scripts use `DEVELOPER_DIR` or `/Applications/Xcode.app/Contents/Developer` | `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version` | App Store; open it once and accept the license, then install the iOS and tvOS simulator runtimes |
| CocoaPods           | `expo prebuild` runs `pod install`                                                                                                                                   | `pod --version`                                                                | `brew install cocoapods`                                                                         |
| watchman            | Without it Metro serves stale bundles; `app:start` stops when it is missing                                                                                          | `watchman --version`                                                           | `brew install watchman`                                                                          |
| Maestro 2.11.0      | `app:e2e` (Java comes with the formula)                                                                                                                              | `maestro --version`                                                            | `brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`                         |

**Android TV** (`app:prebuild:android-tv`, `app:build:android-tv`): Android Studio with the SDK in `~/Library/Android/sdk` (`ANDROID_HOME`), a TV emulator named `raven_tv`, and Gradle on Android Studio's JDK (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`). CI runs this job on Linux because GitHub's macOS runners cannot run the emulator.

**Desktop** (`desktop:dev`, `desktop:build`, `desktop:e2e`, `desktop:test:native`, `desktop:make`): macOS on Apple silicon, Xcode as above. After `bun install`, `bunx nx run @raven/desktop:install:electron` fetches the Electron binary. Never build libmpv or the addon locally; use the CI-built `libs/raven/mpv/resources/darwin-arm64` (gitignored). `desktop:smoke:packaged` writes into your own `~/Library/Application Support/raven`.

**Supabase** (`@raven/supabase`'s `test:db`, `lint:db`, `check:functions`, `test:functions`; none run in `verify`): Docker with its daemon running (`brew install --cask docker`), and Deno (`brew install deno`, CI runs 2.9.7). The Supabase CLI itself arrives with `bun install` (a devDependency), so there is nothing to install for it.

**Docker images** (`ci:docker`, `docker build -f apps/<product>/Dockerfile .`): Docker as above.

One shot for a Mac that needs everything but the GUI apps:

```bash
brew install uv ffmpeg node@22 cocoapods watchman deno nx
brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro
brew install --cask docker android-studio
uv python install 3.12
```

Run `uv python install 3.12` even when some Python is on the PATH. uv only accepts 3.12, and it fails outright on a broken interpreter it meets while searching (see below), so a uv-managed 3.12 is the reliable fix.

`verify` and every task run through `bunx nx`, so the global Nx CLI is only for `nx login`. That command opens a browser, so run it yourself rather than through an agent (in Claude Code, `! nx login`). Homebrew's `nx` can be newer than the `nx` pinned in `package.json`; inside the repo it hands off to the pinned one, so `nx --version` printing a newer `Global` than `Local` is expected.

Env files: copy `apps/raven/.env.example`, `apps/luwin/.env.example` and `apps/rookery/.env.example` to `.env` beside them when you run that product's dev server. Never put a `.env` at the repo root. Keep luwin's `ANTHROPIC_API_KEY` empty locally; its local runs go through `claude -p` on your own sign-in.

## 2. Install and verify

```bash
bun install --frozen-lockfile   # deps, Nx, and the lefthook git hooks
bun run verify
```

A first run takes a minute or two. Nx caches results, so `bun run verify:uncached` reruns everything after an environment change.

## 3. Run each kind of command

Everything goes through Nx from the repo root; `bun run <script>` is a wrapper.

| Kind              | Command                                                                                                | Needs                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Dev servers       | `bun run dev:raven`, `dev:luwin`, `dev:rookery`, `sandbox:luwin`, `app:start`, `desktop:dev`           | core; each product's `.env`            |
| Prebuild          | `bun run app:prebuild:ios`, `app:prebuild:tvos`, `app:prebuild:android-tv`                             | device app tier (Android for the last) |
| Build             | `bun run build`, `app:build:ios`, `app:build:tvos`, `app:build:android-tv`, `desktop:build`            | as above                               |
| Unit tests        | `bun run test`, `test:screens` (device app render tests)                                               | core, Node and Xcode for screens       |
| Lint              | `bun run lint` (or `lint:ts`, `lint:css`, `lint:py`), `lint:fix`                                       | core                                   |
| Typecheck         | `bun run typecheck`                                                                                    | core                                   |
| Format            | `bun run format`, `format:check`                                                                       | core                                   |
| Device app e2e    | see below                                                                                              | device app tier                        |
| Desktop e2e       | `bun run desktop:e2e`                                                                                  | desktop tier                           |
| Database and Edge | `bunx nx run @raven/supabase:db:start`, then `test:db`, `lint:db`; `check:functions`, `test:functions` | Docker, Deno                           |

Use an iPhone that the runtime supports (`xcrun simctl list -j runtimes` shows each runtime's device types; iOS 27.0 has iPhone 17 and 18 Pro, not 16). A `maestro` run from a non-interactive shell needs `JAVA_HOME` exported inline.

The device app's build, prebuild and e2e targets are cached by Nx (their inputs include `APP_VARIANT` and the Xcode version). Add `--skip-nx-cache` to force a real run.

### Device app e2e, step by step

`bun run app:e2e` runs Maestro's flows in `apps/raven/app/e2e`. It needs three things in place first, the way the PR checks set them up:

1. Build the development variant, which allows plain http to the loopback: `APP_VARIANT=development bun run app:build:ios`.
2. Start the fixture server in a second terminal and wait for `raven fixture server ready`: `bunx nx run @raven/server:serve:fixture`.
3. Boot an iPhone simulator and install the build on it:

   ```bash
   runtime="$(xcrun simctl list -j runtimes iOS | jq -r '[.runtimes[] | select(.isAvailable)] | last | .identifier')"
   device="$(xcrun simctl create raven-phone com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
   xcrun simctl boot "$device" && xcrun simctl bootstatus "$device" -b
   xcrun simctl install "$device" apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app
   ```

Then `bun run app:e2e`. A cold Maestro driver can start slowly; set `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000` if it times out. Maestro cannot drive tvOS, so only the iPhone flows run locally. Stop the fixture server when done.

## 4. Read the failure

Nx ends with a `Failed tasks:` list. Rerun just one to see its output: `bunx nx run <project>:<target> --skip-nx-cache` (for example `bunx nx run @luwin/api:lint:py --skip-nx-cache`).

| Symptom                                                                                              | Cause                                                                          | Fix                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `@luwin/api` and `scripts` fail `lint:py`, `format:check` and `test` together                        | uv has no usable Python 3.12                                                   | `uv python install 3.12`                                                                                             |
| `Failed to inspect Python interpreter ... /usr/local/bin/python3` / `Bad CPU type in executable`     | A leftover Intel Homebrew in `/usr/local` on Apple silicon without Rosetta     | `uv python install 3.12`; optionally remove the stale `/usr/local` Homebrew                                          |
| `Executable not found in $PATH: "ffmpeg"`, `spawn ffmpeg ENOENT` in `@raven/server` or `@raven/core` | ffmpeg not installed                                                           | `brew install ffmpeg`                                                                                                |
| `spellcheck` fails with `uvx: command not found`                                                     | uv not installed                                                               | `brew install uv`                                                                                                    |
| `nx login` fails with `nx: command not found`                                                        | No global Nx CLI; the repo's Nx lives in `node_modules`                        | `brew install nx`                                                                                                    |
| Odd failures in many tasks at once, env values you didn't set                                        | A `.env` at the repo root; Nx loads it into every task                         | Move it to `apps/<product>/.env`                                                                                     |
| `Unable to locate a Java Runtime` from `app:e2e` (Maestro installed)                                 | Homebrew's openjdk is keg-only, so `java` is only macOS's stub                 | Add `export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"` to `~/.zshrc`, open a new shell |
| `You have 0 devices connected` from `app:e2e`                                                        | No booted simulator; `app:e2e` boots none, and a new Xcode may ship no runtime | `xcodebuild -downloadPlatform iOS` (about 8 GB), then boot an iPhone as in the e2e steps                             |
| `maestro: command not found` (exit 127) from `app:e2e`                                               | Maestro not installed                                                          | `brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro`                                             |
| `app:start` stops at `watchman`; Metro serves stale code                                             | watchman not installed                                                         | `brew install watchman`                                                                                              |
| `xcode-select: error` or `xcodebuild requires Xcode` in a prebuild or build                          | Only the Command Line Tools are selected, or Xcode is not installed            | Install Xcode; set `DEVELOPER_DIR` or run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`          |
| Prebuild "exits 0" but `ios/Pods` is missing                                                         | `pod install` failed inside `expo prebuild`                                    | `brew install cocoapods`, rerun the prebuild, then `cmp ios/Podfile.lock ios/Pods/Manifest.lock`                     |
| Nx prints `Nx Cloud organization has been disabled` (401)                                            | The free plan was exceeded; remote caching is off until it is re-enabled       | Ignore it; local caching still works                                                                                 |
| `supabase start` or `test:db` cannot reach Docker                                                    | The Docker daemon is not running                                               | Open Docker Desktop, then rerun                                                                                      |
| `bun --version` differs from `packageManager` in `package.json`                                      | Wrong Bun installed                                                            | Install the pinned Bun                                                                                               |
| `format:check` or `lint:*` fails on files you edited                                                 | A real issue in your change                                                    | `bun run format`, `bun run lint:fix`, then fix what remains by hand                                                  |

`ECONNREFUSED ... :8484` stack traces in the test output are logged by passing tests. Ignore them unless that task is in `Failed tasks:`.

## Done

For a full onboarding, also run one command from each tier you installed (for example `bun run app:build:ios`, `bun run desktop:e2e`) and report which passed.

`bun run verify` ends with `Successfully ran targets ... for <N> projects` and exits 0. Report the exit code and the fixes you made.
