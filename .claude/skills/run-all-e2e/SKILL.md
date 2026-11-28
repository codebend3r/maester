---
name: run-all-e2e
description: >-
  Use when every end to end suite should run locally to confirm they all pass, or to find which one broke: "run all the e2e tests", "run every e2e locally", "verify all end to end tests pass", "which e2e is failing", "run the E2E Tests workflow here", "run bun run e2e", before merging a change to the E2E Tests workflow, or when a push to main turned several E2E jobs red. Covers the one command, the sixteen suites and their order, what to check first, reading the results, rerunning one suite, and the Windows suite.
---

# Run every end to end suite locally

Every job in `.github/workflows/e2e-tests.yml` has a local twin. One command runs them all, one after another, from the repo root:

```bash
bun run e2e
```

It is `scripts/run_all_e2e.sh`. Run it yourself in the background (two to three hours, longer when a build is cold) and report each suite as it finishes. It runs past Nx's cache, so every suite really runs; keeps going after a failure; tries a failed suite once more and calls a pass then **flaky**; writes each suite's whole output to a log of its own; and ends with a table of results, minutes and log paths. It exits 1 when any suite failed.

## The suites, in the order run

| #   | Suite                   | Root script             | Driven by                          | Its own skill        |
| --- | ----------------------- | ----------------------- | ---------------------------------- | -------------------- |
| 1   | Raven web               | `web:e2e`               | Playwright, Chrome                 |                      |
| 2   | Wren web                | `wren:web:e2e`          | Playwright, Chrome                 |                      |
| 3   | maester.tv              | `splash:e2e`            | Playwright, Chrome                 |                      |
| 4   | Raven for Mac           | `ci:desktop:e2e`        | Playwright, Electron               | `run-desktop-e2e`    |
| 5   | Wren for Mac            | `wren:desktop:e2e`      | Playwright, Electron               |                      |
| 6   | Raven on iPhone         | `ci:app:ios`            | Maestro, iPhone simulator          | `run-ios-e2e`        |
| 7   | Raven on iPad           | `ci:app:ipad`           | Maestro, iPad simulator, 6's build | `run-ios-e2e`        |
| 8   | Wren on iPhone          | `ci:wren`               | Maestro, iPhone simulator          |                      |
| 9   | Wren on iPad            | `ci:wren:ipad`          | Maestro, iPad simulator, 8's build |                      |
| 10  | Raven on Apple TV       | `ci:app:tvos`           | XCUITest, Apple TV simulator       | `run-tvos-e2e`       |
| 11  | Raven on Android TV     | `ci:app:android-tv`     | Maestro, `raven_tv` emulator       | `run-android-tv-e2e` |
| 12  | Raven on Android phones | `ci:app:android`        | Maestro, `raven_phone` emulator    | `run-android-e2e`    |
| 13  | Wren on Android phones  | `ci:wren:android`       | Maestro, `wren_phone` emulator     |                      |
| 14  | Wren on Apple TV        | `ci:wren:tv:tvos`       | XCUITest, Apple TV simulator       |                      |
| 15  | Wren on Android TV      | `ci:wren:tv:android-tv` | Maestro, `raven_tv` emulator       |                      |
| 16  | Raven for Windows       | `desktop:e2e:windows`   | Playwright, Electron               | Windows only, below  |

A Mac runs 1 to 15; suite 16 runs only on Windows. `bun run e2e --list` prints this order and what this system will run.

| Flag         | Does                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `--only 6,7` | Those suites alone, by number                                                                       |
| `--from 10`  | From that suite on, after a run that stopped                                                        |
| `--cached`   | Lets Nx restore a suite that already passed with the same inputs: a quick check, not a verification |
| `--no-retry` | A failure is a failure, with no second try                                                          |

## Before starting

- **Quit Raven.app and Wren.app.** Suites 4 and 5 launch the apps on the web host ports the installed apps hold (47484, 47485). The script refuses to start while either is taken.
- **Nothing else builds in this checkout meanwhile**: no other agent, dev server rebuild or second run. A library build starts by deleting its `dist`, which fails whatever is reading it at that moment with `Cannot find module`.
- **Tools install themselves.** Each suite's tools step installs what is missing (Maestro, the simulator runtimes, the Android system images). Gradle runs on Android Studio's JDK whatever the shell's `JAVA_HOME` says, so nothing needs exporting.
- **The real TVs and phones are safe.** Every Android suite drives only its own emulator (`ANDROID_SERIAL`, set from the AVD's name), never the Google TV Streamer or a phone on adb, and the Apple suites drive simulators only.

## Reading the result

- **passed**: the suite ran and passed on its first try.
- **flaky**: it failed, then passed when run again. Look at the log's first try before calling it fine; the app's screen tests and some flows have failed under load and passed alone.
- **failed**: it failed twice. Open its log from the table, then debug it with its own root script (or `bun run e2e --only N`) and the suite's skill above. Maestro keeps screenshots under `~/.maestro/tests`, Playwright traces under the app's `test-results`, and the XCUITest its result bundle under the app's `build/tvos-e2e/Logs/Test`.

Rerunning one suite costs much less than the first run: its build is cached by Nx, so only the flows run again.

## Raven for Windows (suite 16)

On a Windows x64 machine, in Git Bash (the runner is a bash script), with Bun installed:

1. ffmpeg with libx264 on the `PATH`: `choco install ffmpeg`.
2. libmpv and the addon in `libs/raven/mpv/resources/win32-x64`: build them with `bunx nx run @raven/mpv:build:native:windows` (needs Visual Studio's C++ build tools), or download CI's from a pull request run: `gh run download <run id> -n raven-native-win32-x64-<sha> -D libs/raven/mpv/resources/win32-x64`.
3. `bun run e2e` then runs suite 16 alone.

The suite leaves out the specs only macOS can run and adds `windowsChrome.e2e.ts` (`apps/raven/desktop/e2e/platformSpecs.ts`). CI's `🎬 E2E Raven Windows desktop` job is its reference run.

## Not covered

- The device apps' screen tests are jest, not end to end: `bunx nx run-many -t test:screens`.
- A pull request runs suites 1 to 3 only; the rest run on main after the merge, on the builds the pull request uploaded. A local run says the suites pass; it does not give CI a cached pass, since the local builds differ from CI's (arm64 against x86_64 on Android).

## Common mistakes

| Mistake                                            | Instead                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| A `bun run --sequential` chain of the root scripts | It stops at the first failure and hides the rest; `bun run e2e` runs them all   |
| Calling a cached pass a verification               | `bun run e2e` skips the cache; `--cached` is only a quick check                 |
| Running two suites at once                         | Builds and prebuilds collide on shared `dist` and native folders; one at a time |
| Debugging a failure from the summary alone         | Read the suite's log, then rerun it alone with `--only N`                       |
| Treating a flaky result as a pass                  | Read why its first try failed                                                   |
