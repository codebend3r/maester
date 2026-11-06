---
name: run-android-tv-e2e
description: >-
  Use when running the `📺 App on Android TV` PR check locally on a Mac, or any of its steps: "run the Android TV CI locally", "build the Android TV APK", "run the Android TV e2e", "run app:e2e:android-tv", "reproduce the Android TV job", "the Android TV check failed, run it here", "run ci:app:android-tv". Covers the one command that runs the whole job, what it installs, its Nx caching, and what appears on screen.
---

# Run the Android TV check locally

The `app-android-tv` job in `.github/workflows/pull-request-checks.yml`, on macOS with Apple silicon. One command runs every step, from the repo root:

```bash
bun run ci:app:android-tv
```

It is `scripts/ci_app_android_tv.sh`. Run it yourself in the background (it takes up to 30 minutes cold) and report its steps as they print. Before starting, tell the user what will appear on screen (below).

## What it does

Each step is a root script of its own, so one can run alone, with the job's environment, from the repo root:

| Step                     | Command                                   | What runs                                                                                                                                                                                                                                                | Nx cached    |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Tools                    | `bun run ci:app:android-tv:tools`         | Installs what is missing: Android Studio (Gradle runs on its JDK), the SDK command-line tools, the SDK packages and the `android-36;android-tv;arm64-v8a` image (1.5 GB, licenses accepted), `ffmpeg`, `ccache`, Maestro; checks for Node 22.18 or newer | no           |
| Install                  | `bun run ci:app:install`                  | `bun install --frozen-lockfile`                                                                                                                                                                                                                          | no           |
| Build the libraries      | `bun run ci:app:libraries`                | `nx run-many -t build -p @raven/core @raven/ui @raven/audio @raven/native @shared/server`, once, so the server and the build do not both rebuild them                                                                                                    | yes          |
| Start the fixture server | `bun run ci:app:fixture`                  | `@raven/server:serve:fixture` on `:8490` (the whole job runs it in the background), unless something already listens there                                                                                                                               | no, a server |
| Start the emulator       | `bun run ci:app:android-tv:emulator`      | Boots the AVD `raven_tv`, making it first with CI's `tv_1080p` profile and 4 GiB when it does not exist; skipped when an emulator is already running                                                                                                     | no           |
| Build                    | `bun run ci:app:android-tv:build`         | `@raven/app:build:android-tv`, which runs `prebuild:android-tv` (`expo prebuild` with the leanback launcher) and then Gradle's `assembleRelease`                                                                                                         | yes          |
| Wait for the emulator    | `bun run ci:app:android-tv:emulator:wait` | `sys.boot_completed`, then animations off, as CI's `disable-animations`                                                                                                                                                                                  | no           |
| Install the APK          | `bun run ci:app:android-tv:install`       | `adb install -r`, uninstalling first when a build signed with another key is there                                                                                                                                                                       | no, instant  |
| Wait for the fixture     | `bun run ci:app:fixture:wait`             | Waits up to three minutes for the server to listen, which it does only once it is ready                                                                                                                                                                  | no           |
| App end to end           | `bun run ci:app:android-tv:e2e`           | `@raven/app:e2e:android-tv`: `adb reverse tcp:8490 tcp:8490`, then the flows not tagged `touch`: `signIn`, `home` and `play.dpad`                                                                                                                        | yes          |

Run on its own, a step finds what it needs rather than reading an earlier step's variables; the fixture server then runs in the foreground, so start it in a terminal of its own. `bun run app:build:android-tv` and `bun run app:e2e:android-tv` run the same targets without the job's environment, so they build and test the production variant for every ABI.

It sets `ANDROID_HOME` (`~/Library/Android/sdk` unless set), `JAVA_HOME` (Android Studio's JDK unless set), `APP_VARIANT=development`, `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490` and `ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a` (only the local emulator's ABI, where React Native builds four by default). All three are baked into the APK and are Nx inputs of the build and the flows, so the cache keys stay the same run to run and never match CI's x86_64 build. The fixture server stops when the script ends; the emulator is left running so a rerun skips its boot (`adb emu kill` closes it).

Differences from CI, forced by the Mac: the image is `arm64-v8a`, not `x86_64` on KVM; the emulator has a window; there is no AVD snapshot cache; the APK is not uploaded.

## Caching

With the app, its dependencies, the server's `src/` and the variables unchanged, the APK is restored and a passing run of the flows replays in seconds. The tools, the emulator and the fixture server still run, since they are not tasks Nx can cache. A failure is never cached. For a real run of a passing state, only when the user asks:

```bash
bun run ci:app:android-tv -- --skip-nx-cache
```

The arguments go to the flows' `nx run`, so the build stays cached.

## On screen

- **Android Emulator** opens as its own window ("Android Emulator - raven_tv:5554") with a Dock icon: the Android logo for a minute or two on a cold boot, then the Google TV home screen. macOS may ask once whether `qemu-system-aarch64` may accept incoming connections; either answer works, since everything is on the loopback.
- During the build, nothing new: Expo and Gradle print to the terminal.
- Maestro opens nothing of its own; it drives the emulator. Each flow relaunches raven with its state cleared, so the app opens straight on the fixture's Home, with **Films** (**Kestrel Point**) and, a few presses down, **Series** (**Lantern Bay**). In `play.dpad.yaml` the film's page opens with Play focused, the film plays and its controls fade, it pauses, skips ten seconds ahead, Back offers "Resume from ...", and Back again lands on Home with **Continue watching**.
- Ask the user not to click in the emulator while it runs.
- The terminal prints each flow with a pass or fail mark.

## Afterwards

On a failure, report the failing flow and step, and point at `~/.maestro/tests/<latest>/` (screenshots and Maestro's log) and the fixture log the script names, what CI uploads as "End to end logs".

## Common mistakes

- Running the steps by hand with `bun run` inside `apps/raven/app`: that skips the Nx cache. Go through `bun run ci:app:android-tv`, or `bunx nx run` for one target.
- Installing an APK built without the two variables: it cannot reach the fixture, and the flows stall at sign-in.
- Changing `apps/raven/app/android/`: it is generated and wiped by every prebuild. Change the Expo config or a plugin.
