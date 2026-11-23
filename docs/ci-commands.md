# Pull request checks, locally

Each `ci:*` command runs one CI job on this machine, so a check that fails on a pull request can be reproduced and fixed without pushing. Run them from the repo root.

| Command                     | Script                          | What it runs                                                                                                                                                 |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run ci:docker`         | `scripts/ci_docker.sh`          | The ✅ Checks job inside an Ubuntu 24.04 container with a fresh install, CI's pinned ffmpeg and Nx Cloud off. Use it for failures that only show up on Linux CI. |
| `bun run ci:app:ios`        | `scripts/ci_app_ios.sh`         | The 🏗️ Build iPhone job and its end to end job: the iPhone simulator, the Release build, the pods check and the Maestro flows.                                             |
| `bun run ci:app:tvos`       | `scripts/ci_app_tvos.sh`        | The 🏗️ Build Apple TV job and its end to end job: the Release build for the Apple TV simulator, the pods check and the XCUITest driven by the Siri Remote.                          |
| `bun run ci:app:android-tv` | `scripts/ci_app_android_tv.sh`  | The 🏗️ Build Android TV job and its end to end job: the Android TV emulator (arm64), the Release APK and the Maestro flows. It leaves the emulator running so the next run skips the boot. |
| `bun run ci:app:android`    | `scripts/ci_app_android.sh`     | The Android phone end to end job, which CI does not run yet: the Android phone emulator `raven_phone` (arm64), the Release APK and the touch Maestro flows. It always drives that emulator, never an attached phone, and leaves it running. |
| `bun run ci:wren`           | `scripts/ci_wren.sh`            | The 🎵 Build Wren iPhone job and its end to end job: the iPhone simulator, Wren's Release build, the pods check and the Maestro flows.                                          |
| `bun run ci:desktop:e2e`    | `scripts/ci_desktop_e2e.sh`     | The 🎬 E2E Raven Mac desktop check from `native-checks.yml`: Playwright tests against the unpackaged Raven.                                                          |

The ✅ Checks job lives in `.github/workflows/pull-request-checks.yml`. The native build jobs are listed there too, one job each with no workflow called, for the groups a change affects; their steps live in the actions under `.github/actions/`. The end to end jobs live in `.github/workflows/native-checks.yml` and nowhere else: it runs on every push to main, on the builds the merged pull request uploaded, and builds nothing.

## Options

- `ci:app:ios`, `ci:app:tvos`, `ci:app:android-tv`, `ci:app:android` and `ci:wren` take `-- --skip-nx-cache`, which runs the flows for real even when Nx has a cached pass.
- `ci:docker` runs `format:check`, `typecheck`, `spellcheck`, `lint`, `test`, `dead-code`, `dead-css`, `test:screens` and `build` in that order, stopping at the first failure. Name steps to run only those: `bun run ci:docker -- test lint`.
- `ci:docker` runs on arm64 by default. `PLATFORM=linux/amd64 bun run ci:docker` matches CI's x86_64, slowly, under emulation.

## What they need

| Command             | Needs                              |
| ------------------- | ---------------------------------- |
| `ci:docker`         | Docker running                     |
| `ci:app:ios`        | macOS and Xcode                    |
| `ci:app:tvos`       | macOS and Xcode                    |
| `ci:app:android-tv` | The Android SDK and its emulator   |
| `ci:app:android`    | The Android SDK and its emulator   |
| `ci:wren`           | macOS and Xcode                    |
| `ci:desktop:e2e`    | macOS                              |

`bun run ci:raven:web <target>` and `bun run ci:wren:web <target>` run one of the 🦅 Raven web or 🐦 Wren web checks on that app alone, as its job in the PR checks does: `bun run ci:wren:web lighthouse`. Raven's and Wren's Lighthouse runs both start the server's Lighthouse fixture on its one port, so run them one after the other.

`bun run web:e2e` runs the 🌐 E2E Raven web job the same way, though its name has no `ci:` prefix: Playwright drives the web app against a fixture server. It needs Chrome and ffmpeg.

`bun run e2e` runs every end to end job above and `web:e2e` one after another (web, the Mac desktop, iPhone, Wren, Apple TV, Android TV, Android phones), stopping at the first failure. It needs everything each of them needs.

[All commands](commands.md) lists every root script.
