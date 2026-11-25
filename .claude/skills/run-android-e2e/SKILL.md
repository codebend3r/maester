---
name: run-android-e2e
description: >-
  Use when running raven's end to end tests for Android phones locally on a Mac, or any of its steps: "run the Android phone e2e", "run the Android e2e", "run the phone flows on the emulator", "run app:e2e:android", "run ci:app:android", "build the Android phone APK for the fixture", "test raven on an Android phone". Covers the one command that runs the whole job, the emulator it always runs on, what it installs, its Nx caching, and what appears on screen. Not for Android TV (use `run-android-tv-e2e`) or for a real phone (use `run-device-app`).
---

# Run the Android phone check locally

The device app's end to end flows for Android phones, on macOS with Apple silicon. One command runs every step, from the repo root:

```bash
bun run ci:app:android
```

It is `scripts/ci_app_android.sh`. Run it yourself in the background (it takes up to 30 minutes cold) and report its steps as they print. Before starting, tell the user what will appear on screen (below).

CI has no Android phone end to end job yet: `🎬 Build Raven Android phone` builds the APK on a pull request and nothing runs flows on it. This job is local only.

## Always the emulator

The flows run on the Android emulator, the AVD `raven_phone`, and nowhere else. Never run them on a real phone, even when one is attached over adb, and never on the Android TV emulator.

The script holds to that itself: it finds the running emulator whose AVD is `raven_phone` (`adb -s <serial> emu avd name`), exports its serial as `ANDROID_SERIAL`, which adb reads, and the flows hand the same serial to Maestro as `--udid`. So a phone on a cable, the Google TV Streamer and the `raven_tv` emulator can all be attached while it runs, and none of them is driven. A step that needs the emulator stops when `raven_phone` is not running, and says how to start it.

Do not work around it: do not set `ANDROID_SERIAL` to a real device's serial, and do not run `maestro test` by hand without `--udid`.

## What it does

Each step is a root script of its own, so one can run alone, with the job's environment, from the repo root:

| Step                     | Command                                | What runs                                                                                                                                                                                                                                                 | Nx cached    |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Tools                    | `bun run ci:app:android:tools`         | Installs what is missing: Android Studio (Gradle runs on its JDK), the SDK command-line tools, the SDK packages and the `android-36;google_apis;arm64-v8a` image (1.5 GB, licenses accepted), `ffmpeg`, `ccache`, Maestro; checks for Node 22.18 or newer | no           |
| Install                  | `bun run ci:app:install`               | `bun install --frozen-lockfile`                                                                                                                                                                                                                           | no           |
| Build the libraries      | `bun run ci:app:libraries`             | The libraries the fixture server and the app read, once, so the server and the build do not both rebuild them                                                                                                                                             | yes          |
| Start the fixture server | `bun run ci:app:fixture`               | `@raven/server:serve:fixture` on `:8490` (the whole job runs it in the background), unless something already listens there                                                                                                                                | no, a server |
| Start the emulator       | `bun run ci:app:android:emulator`      | Boots the AVD `raven_phone`, making it first with the `pixel_7` profile and 4 GiB when it does not exist; skipped when `raven_phone` is already running                                                                                                   | no           |
| Build                    | `bun run ci:app:android:build`         | `@raven/app:build:android`, which runs `prebuild:android` (`expo prebuild`, no leanback launcher) and then Gradle's `assembleRelease`                                                                                                                     | yes          |
| Wait for the emulator    | `bun run ci:app:android:emulator:wait` | `sys.boot_completed` on `raven_phone`, then animations off                                                                                                                                                                                                | no           |
| Install the APK          | `bun run ci:app:android:install`       | `adb install -r` on the emulator, uninstalling first when a build signed with another key is there                                                                                                                                                        | no, instant  |
| Wait for the fixture     | `bun run ci:app:fixture:wait`          | Waits up to three minutes for the server to listen, which it does only once it is ready                                                                                                                                                                   | no           |
| App end to end           | `bun run ci:app:android:e2e`           | `@raven/app:e2e:android`: `adb reverse tcp:8490 tcp:8490`, then the flows tagged `touch`: `library`, `item`, `play` and `search`                                                                                                                          | yes          |

It sets `ANDROID_HOME` (`~/Library/Android/sdk` unless set), `JAVA_HOME` (Android Studio's JDK), `APP_VARIANT=development`, `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490` and `ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a` (only the local emulator's ABI). The last three are baked into the APK and are Nx inputs of the build and the flows, so the cache keys stay the same run to run. The fixture server stops when the script ends; the emulator is left running so a rerun skips its boot (`adb -s <serial> emu kill` closes it).

`bun run app:e2e:android` runs the flows' target alone, without the job's environment: it needs `ANDROID_HOME` and `ANDROID_SERIAL` set, and stops when either is missing. Prefer `bun run ci:app:android:e2e`, which finds the emulator itself.

## One `android/` folder

The phone build and the Android TV build generate the same `apps/raven/app/android/` folder and write the same APK path, each prebuild wiping the other's project. Never run `ci:app:android` while `ci:app:android-tv` (or any other build of `@raven/app` for Android) is running; run them one after the other. Each job's build step restores or rebuilds its own APK, so the order does not matter.

## Caching

With the app, its dependencies, the server's `src/` and the variables unchanged, the APK is restored and a passing run of the flows replays in seconds. The tools, the emulator and the fixture server still run, since they are not tasks Nx can cache. A failure is never cached. For a real run of a passing state, only when the user asks:

```bash
bun run ci:app:android -- --skip-nx-cache
```

The arguments go to the flows' `nx run`, so the build stays cached.

## On screen

- **Android Emulator** opens as its own window ("Android Emulator - raven_phone") with a Dock icon: the Android logo for a minute or two on a cold boot, then a Pixel's home screen. macOS may ask once whether `qemu-system-aarch64` may accept incoming connections; either answer works, since everything is on the loopback.
- During the build, nothing new: Expo and Gradle print to the terminal.
- Maestro opens nothing of its own; it drives the emulator. Each flow relaunches raven with its state cleared, so each one opens straight on Home with **Kestrel Point** and **Lantern Bay**. Then, flow by flow: a library opened from See all and sorted, the film's page marked watched and back, a show's season and episode, the film playing under raven's controls and paused, and a search from Home's header.
- Ask the user not to click in the emulator while it runs; a tap can fail a flow.
- The terminal prints each flow with a pass or fail mark.

## Afterwards

On a failure, report the failing flow and step, and point at `~/.maestro/tests/<latest>/` (screenshots and Maestro's log) and the fixture log the script names.

## Common mistakes

- Running the flows on a real phone, or letting Maestro pick a device: always the `raven_phone` emulator, through `bun run ci:app:android` or its `e2e` step.
- Running it beside the Android TV job: they share `android/` and the APK path.
- Running the steps by hand with `bun run` inside `apps/raven/app`: that skips the Nx cache. Go through `bun run ci:app:android` or one of its step scripts.
- Installing an APK built without the two variables: it cannot reach the fixture, and the flows stall at sign-in.
- Changing `apps/raven/app/android/`: it is generated and wiped by every prebuild. Change the Expo config or a plugin.
