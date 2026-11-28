# Pull request checks, locally

Each `ci:*` command runs one CI job on this machine, so a check that fails on a pull request can be reproduced and fixed without pushing. Run them from the repo root.

| Command                     | Script                          | What it runs                                                                                                                                                 |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run ci:docker`         | `scripts/ci_docker.sh`          | The ✅ Checks job inside an Ubuntu 24.04 container with a fresh install, CI's pinned ffmpeg and Nx Cloud off. Use it for failures that only show up on Linux CI. |
| `bun run ci:app:ios`        | `scripts/ci_app_ios.sh`         | The 🎬 Build Raven iPhone job and its end to end job: the iPhone simulator, the Release build, the pods check and the Maestro flows.                                             |
| `bun run ci:app:tvos`       | `scripts/ci_app_tvos.sh`        | The 🎬 Build Raven Apple TV job and its end to end job: the Release build for the Apple TV simulator, the pods check and the XCUITest driven by the Siri Remote.                          |
| `bun run ci:app:android-tv` | `scripts/ci_app_android_tv.sh`  | The 🎬 Build Raven Android TV job and its end to end job: the Android TV emulator (arm64), the Release APK and the Maestro flows. It leaves the emulator running so the next run skips the boot. |
| `bun run ci:app:android`    | `scripts/ci_app_android.sh`     | The 🎬 Build Raven Android phone job and its end to end job: the Android phone emulator `raven_phone` (arm64), the Release APK and the touch Maestro flows. It always drives that emulator, never an attached phone, and leaves it running. |
| `bun run ci:app:ipad`       | `scripts/ci_app_ipad.sh`        | The 🎬 E2E Raven iPad job: the iPhone job's build on an iPad simulator, `raven-pad`, with the same touch flows under a target of their own. |
| `bun run ci:wren`           | `scripts/ci_wren.sh`            | The 🎵 Build Wren iPhone job and its end to end job: the iPhone simulator, Wren's Release build, the pods check and the Maestro flows.                                          |
| `bun run ci:wren:ipad`      | `scripts/ci_wren_ipad.sh`       | The 🎵 E2E Wren iPad job: the iPhone job's build and flows on an iPad simulator, `wren-pad`. |
| `bun run ci:wren:android`   | `scripts/ci_wren_android.sh`    | The 🎵 Build Wren Android job and its end to end job: the Android phone emulator `wren_phone` (arm64), Wren's Release APK and its Maestro flows. It leaves the emulator running. |
| `bun run ci:desktop:e2e`    | `scripts/ci_desktop_e2e.sh`     | The 🎬 E2E Raven Mac desktop check from `e2e-tests.yml`: Playwright tests against the unpackaged Raven.                                                          |

The ✅ Checks job lives in `.github/workflows/pull-request-checks.yml`. The native build jobs are listed there too, one job each with no workflow called, every one on every pull request; their steps live in the actions under `.github/actions/`. The end to end jobs live in `.github/workflows/e2e-tests.yml` and nowhere else: it runs on every push to main, on the builds the merged pull request uploaded, and builds nothing.

## Options

- `ci:app:ios`, `ci:app:ipad`, `ci:app:tvos`, `ci:app:android-tv`, `ci:app:android`, `ci:wren`, `ci:wren:ipad` and `ci:wren:android` take `-- --skip-nx-cache`, which runs the flows for real even when Nx has a cached pass.
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
| `ci:app:ipad`       | macOS and Xcode                    |
| `ci:wren`           | macOS and Xcode                    |
| `ci:wren:ipad`      | macOS and Xcode                    |
| `ci:wren:android`   | The Android SDK and its emulator   |
| `ci:desktop:e2e`    | macOS                              |

`bun run raven:web:lighthouse` and `bun run wren:web:lighthouse` run the 🔦 Lighthouse Raven web and 🔦 Lighthouse Wren web checks, as those jobs do: each is its app's `lighthouse` Nx target, which Nx Cloud caches, so a run is restored while the app and the server are unchanged. Both start the server's Lighthouse fixture on its one port, so run them one after the other.

`bun run web:e2e` runs the 🌐 E2E Raven web job the same way, though its name has no `ci:` prefix: Playwright drives the web app against a fixture server. `bun run wren:web:e2e` runs the 🎵 E2E Wren web job, Wren on the web against a fixture server of its own, on its own port, so the two can run at once. Each needs Chrome and ffmpeg. Both are standard checks of a pull request, and run again on main.

`bun run splash:e2e` runs the 🏠 E2E maester.tv job: Playwright drives the built site, which needs Chrome and no server. `bun run wren:desktop:e2e` runs the 🎵 E2E Wren Mac desktop job, Playwright driving Wren for Mac against a fixture server of its own; it needs macOS and ffmpeg, and no other Wren running, since the app's port is fixed. The 🎬 E2E Raven Windows desktop job (`bun run desktop:e2e:windows`) runs on Windows alone.

`bun run e2e` (`scripts/run_all_e2e.sh`, the `run-all-e2e` skill) runs every end to end suite this system can, one after another, past Nx's cache: suites 1 to 15 on a Mac, the Windows desktop's on Windows. It keeps going past a failure, tries a failed suite once more, keeps each suite's output in a log of its own and ends with a table. It needs everything each of them needs.

[All commands](commands.md) lists every root script.
