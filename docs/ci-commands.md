# Pull request checks, locally

Each `ci:*` command runs one CI job on this machine, so a check that fails on a pull request can be reproduced and fixed without pushing. Run them from the repo root.

| Command                     | Script                          | What it runs                                                                                                                                                 |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run ci:docker`         | `scripts/ci_docker.sh`          | The ✅ Checks job inside an Ubuntu 24.04 container with a fresh install, CI's pinned ffmpeg and Nx Cloud off. Use it for failures that only show up on Linux CI. |
| `bun run ci:app:ios`        | `scripts/ci_app_ios.sh`         | The 📱 App on iPhone and iPad job: the iPhone simulator, the Release build, the pods check and the Maestro flows.                                             |
| `bun run ci:app:tvos`       | `scripts/ci_app_tvos.sh`        | The 📺 App on Apple TV job: the Release build for the Apple TV simulator, the pods check and the XCUITest driven by the Siri Remote.                          |
| `bun run ci:app:android-tv` | `scripts/ci_app_android_tv.sh`  | The 📺 App on Android TV job: the Android TV emulator (arm64), the Release APK and the Maestro flows. It leaves the emulator running so the next run skips the boot. |
| `bun run ci:wren`           | `scripts/ci_wren.sh`            | The macOS half of the 🎵 Wren job: the iPhone simulator, Wren's Release build, the pods check and the Maestro flows.                                          |
| `bun run ci:desktop:e2e`    | `scripts/ci_desktop_e2e.sh`     | The 🎬 Desktop end to end check from `main-native-checks.yml`: Playwright tests against the unpackaged Raven.                                                 |

The jobs live in `.github/workflows/pull-request-checks.yml`, except the desktop end to end check, which is in `.github/workflows/main-native-checks.yml`.

## Options

- `ci:app:ios`, `ci:app:tvos`, `ci:app:android-tv` and `ci:wren` take `-- --skip-nx-cache`, which runs the flows for real even when Nx has a cached pass.
- `ci:docker` runs `format:check`, `typecheck`, `spellcheck`, `lint`, `test`, `dead-code`, `dead-css`, `test:screens` and `build` in that order, stopping at the first failure. Name steps to run only those: `bun run ci:docker -- test lint`.
- `ci:docker` runs on arm64 by default. `PLATFORM=linux/amd64 bun run ci:docker` matches CI's x86_64, slowly, under emulation.

## What they need

| Command             | Needs                              |
| ------------------- | ---------------------------------- |
| `ci:docker`         | Docker running                     |
| `ci:app:ios`        | macOS and Xcode                    |
| `ci:app:tvos`       | macOS and Xcode                    |
| `ci:app:android-tv` | The Android SDK and its emulator   |
| `ci:wren`           | macOS and Xcode                    |
| `ci:desktop:e2e`    | macOS                              |

`bun run web:e2e` runs the 🌐 Web end to end job the same way, though its name has no `ci:` prefix: Playwright drives the web app against a fixture server. It needs Chrome and ffmpeg.

[All commands](commands.md) lists every root script.
