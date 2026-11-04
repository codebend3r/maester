---
name: build-all-apps
description: >-
  Use when building every raven app at once, or running all of CI's build and app checks locally on a Mac before pushing: "build all the apps", "run the whole CI locally", "build web, desktop, Apple TV, Google TV and iPhone", "check everything builds", "run every native check here", "reproduce main's native checks", "build the Mac and Windows desktop". Covers the order, which commands CI runs for each app, what a Mac cannot run (Windows) and how long each takes.
---

# Build every app and run CI's checks locally

One pass over every raven client, the way CI builds and checks it: the web app, the desktop app for Mac and Windows, Apple TV, Google TV (Android TV) and the iPhone and iPad app. Run it from the repo root on a Mac with Apple silicon and Xcode. Each step is an existing `bun run` script that goes through Nx, so a step whose inputs are unchanged replays from the cache in seconds.

Run the steps **one after another, never at once**. The device app scripts share the fixture server on `:8490` and each rebuilds the libraries (their `build` starts with `rm -rf dist`), so two at once break each other. Run each long step in the background, report its steps as they print, and tell the user before a step that takes over the screen (below).

## The steps

| #   | App                             | Command                                                                                                           | CI job it mirrors                     | Cold time                         |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| 0   | Install                         | `bun install --frozen-lockfile`                                                                                   | every job                             | 1 min                             |
| 1   | Web, plus every project's build | `bun run build`                                                                                                   | `🏗️ Build` (PR checks)                | 2 min                             |
| 2   | Web in Chrome                   | `bun run web:e2e`                                                                                                 | `🌐 Web end to end` (PR checks)       | 3 min                             |
| 3   | Desktop for Mac, native pieces  | see [Desktop for Mac](#desktop-for-mac)                                                                           | `🎞️ Desktop native`                   | 40 min, or seconds with a handoff |
| 4   | Desktop for Mac, the app        | `bun run desktop:build`, `bun run desktop:make`, `bun run desktop:audit:bundle`, `bun run desktop:smoke:packaged` | `📦 Desktop app`                      | 5 min                             |
| 5   | Desktop for Mac, playback       | `bun run ci:desktop:e2e`                                                                                          | `🎬 Desktop end to end`               | 5 min                             |
| 6   | iPhone and iPad                 | `bun run ci:app:ios`                                                                                              | `📱 App on iPhone and iPad`           | 30 min                            |
| 7   | Apple TV                        | `bun run ci:app:tvos`                                                                                             | `📺 App on Apple TV`                  | 30 min                            |
| 8   | Google TV (Android TV)          | `bun run ci:app:android-tv`                                                                                       | `📺 App on Android TV`                | 30 min                            |
| 9   | Desktop for Windows             | see [Desktop for Windows](#desktop-for-windows)                                                                   | `🪟 Windows native`, `🪟 Windows app` | Windows only                      |

Stop at the first failure and report it, unless the user said to keep going past failures; then note it and run the next step. Steps 6 to 8 each have their own skill with the details of what they install and show: `run-ios-e2e`, `run-tvos-e2e`, `run-android-tv-e2e`. Read the matching one when a step fails.

If the user asked only for **builds**, without the tests, steps 2 and 5 drop out. Steps 6 to 8 stay, since their scripts are the only path that sets the build environment (`APP_VARIANT`, `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN`, `DEVELOPER_DIR`) and the pods check the way CI does. The builds land at:

- Web: `apps/raven/web/dist`
- Desktop for Mac: `apps/raven/desktop/out/make` (unsigned)
- iPhone and iPad: `apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app` (simulator, unsigned)
- Apple TV: `apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app` (simulator, unsigned)
- Google TV: `apps/raven/app/android/app/build/outputs/apk/release/app-release.apk` (sideloadable)

## Desktop for Mac

`desktop:make` runs `stage:mpv`, which copies libmpv and the addon from `libs/raven/mpv/resources/darwin-arm64`. Get them first:

1. If `libs/raven/mpv/resources/darwin-arm64/raven_mpv.node` exists, use it.
2. Otherwise run step 5 (`bun run ci:desktop:e2e`) **first**: it downloads CI's native handoff from a recent `main-native-checks.yml` run whose addon sources match this checkout, and unpacks it in place. It needs `gh auth login`.
3. If no run has a matching handoff, build them from source as the `raven-desktop-native` action does: `brew install cmake ninja meson pkgconf`, `xcodebuild -downloadComponent MetalToolchain` when `xcrun metal --version` fails, then `bunx nx run @raven/mpv:fetch:libmpv` and `bunx nx run @raven/mpv:build:native`. The `get-started` skill covers this toolchain.

Then `bun run mpv:native` audits them and runs the headless libmpv tests, as CI does.

`desktop:smoke:packaged` launches the packaged Raven with the user's own `~/Library/Application Support/raven` and `~/Library/Logs/raven`, makes the real update check against GitHub and writes `updates.checkedAt` into `desktop-config.json`. Say so before running it.

## Desktop for Windows

A Mac cannot build it: the addon, libmpv and Forge's installer are all Windows x64. On a Windows x64 machine, run from the repo root:

```bash
bun install --frozen-lockfile
bun run mpv:native:windows
bun run desktop:make
bun run desktop:audit:bundle
bun run desktop:smoke:packaged
```

`mpv:native:windows` places the pinned libmpv DLL under `libs/raven/mpv/resources/win32-x64` and tests it; the installer lands in `apps/raven/desktop/out/make`.

From the Mac, the only way is CI: a manual run of `🧱 Main native checks` on the branch runs every job, Windows included. Starting it publishes a run on GitHub, so do it only when the user asks: `gh workflow run main-native-checks.yml --ref <branch>`, then `gh run watch`.

## On screen

- Step 2: Chrome opens windows that Playwright drives.
- Step 4: the packaged Raven opens briefly during the smoke.
- Step 5: Raven windows open and play the test clips.
- Steps 6 and 7: Simulator boots `raven-phone`, then the Apple TV, and Maestro or XCUITest drives them. Ask the user not to click in Simulator.
- Step 8: the `raven_tv` emulator boots and stays running afterwards.

Shut down each simulator before the next device step (`xcrun simctl shutdown all`), or Maestro may pick the wrong one.

## Common mistakes

- Running two steps at once to save time: the fixture server and the libraries' `rm -rf dist` collide. One at a time.
- Running a target inside `apps/raven/app` with `bun run build:ios`: it skips Nx's cache and `prebuild:ios`, and builds without CI's environment. Use the `ci:app:*` scripts.
- Forcing a real run with `--skip-nx-cache` on every step: a cached pass is a pass. Add `-- --skip-nx-cache` to one `ci:*` script only when the user asks for a fresh run of it.
- Reporting Windows as built after a Mac run: it was not. Say it needs Windows or a CI run.
