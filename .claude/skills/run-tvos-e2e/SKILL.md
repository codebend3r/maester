---
name: run-tvos-e2e
description: Use when running the `📺 App on Apple TV` PR check locally on a Mac, or `app:e2e:tvos`: "run the Apple TV CI locally", "run the tvOS e2e", "run the Siri Remote test", "reproduce the app-tvos job", "the Apple TV check failed, run it here", "run ci:app:tvos". Covers the one command that runs the whole job, what it installs, its Nx caching, and what appears on screen.
---

# Run the Apple TV check locally

The `app-tvos` job in `.github/workflows/pull-request-checks.yml`, on macOS with Apple silicon. One command runs every step, from the repo root:

```bash
bun run ci:app:tvos
```

It is `scripts/ci_app_tvos.sh`. Run it yourself in the background (it takes up to 30 minutes cold) and report its steps as they print. Before starting, tell the user what will appear on screen (below).

The flow is not Maestro (it cannot drive tvOS) but an XCUITest, `apps/raven/app/tvos-e2e/RemoteFlowTests.swift`, which the tvOS prebuild adds as the `RavenRemoteTests` scheme.

## What it does

| Step                        | What runs                                                                                                                                                          | Nx cached    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Tools                       | Installs what is missing with Homebrew: `ffmpeg`, `jq`, `cocoapods`, `ccache`. Downloads the tvOS simulator runtime matching Xcode's SDK when there is none (8 GB) | no           |
| Install                     | `bun install --frozen-lockfile`                                                                                                                                    | no           |
| Build the libraries         | `nx run-many -t build -p @raven/core @raven/ui @shared/server`, once, so the server and the build do not both rebuild them                                         | yes          |
| Start the fixture server    | `@raven/server:serve:fixture` in the background on `:8490`, unless something already listens there                                                                 | no, a server |
| Build                       | `@raven/app:build:tvos`, which runs `prebuild:tvos` (`EXPO_TV=1 expo prebuild`, `pod install`, the test target) and then `xcodebuild`'s Release build              | yes          |
| Check the pods              | `ios/` is the TV project (`SDKROOT = appletvos`) and `Podfile.lock` matches `Pods/Manifest.lock`, since `expo prebuild` exits 0 when `pod install` fails           | no, instant  |
| Wait for the fixture        | Its `raven fixture server ready` line, up to three minutes                                                                                                         | no           |
| Boot the Apple TV simulator | Reuses the simulator `raven-tv` on the SDK's runtime, or makes one (CI's Apple TV 4K, 3rd generation), boots it and installs `raven.app`                           | no           |
| Apple TV end to end         | `@raven/app:e2e:tvos`: `xcodebuild test` of `RavenRemoteTests` on `raven-tv`, then a screenshot of where it ended                                                  | yes          |

It sets `APP_VARIANT=development`, `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490`, `DEVELOPER_DIR` (`/Applications/Xcode.app/Contents/Developer` unless set) and `TVOS_SIMULATOR=raven-tv`. All four are Nx inputs, so the cache keys stay the same run to run. The fixture server stops when the script ends, pass or fail; the simulator stays booted.

CI's last steps (zipping and uploading the simulator app and the screenshot) are left out: the build stays at `apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app`, and the script prints where the screenshot went.

`ios/` is shared with the iPhone build. A cached `build:tvos` restores the TV project over an iPhone one, so `ci:app:ios` and `ci:app:tvos` can run one after the other, never at the same time.

## Caching

With the app (the Swift test included), its dependencies, the server's `src/`, the variables and the Xcode version unchanged, the build is restored and a passing test replays in seconds. The tools, the simulator and the fixture server still run, since they are not tasks Nx can cache. A failure is never cached. For a real run of a passing state, only when the user asks:

```bash
bun run ci:app:tvos -- --skip-nx-cache
```

The arguments go to the test's `nx run`, so the build stays cached.

## On screen

- **Simulator** opens with the Apple TV (`raven-tv`) and boots it to the tvOS home screen. It stays open afterwards.
- During the build, nothing new: Expo, CocoaPods and `xcodebuild` print to the terminal.
- The XCUITest launches raven and drives it with the Siri Remote: the PIN and admin password typed on tvOS's keyboard, Home with the film focused, the film's page, Play, about twenty seconds of the film, Menu to the page (now offering Resume), Menu to Home with the film under Continue watching, then Watched and back to clear the spot, and Menu on Home sends raven to the background.
- Xcode's test runner may briefly show **RavenRemoteTests-Runner** on the Apple TV as it starts; that is the test, not a second app to dismiss.
- Ask the user not to click in Simulator or press keys while it runs; a stray press moves the focus and fails the test.
- The terminal prints `xcodebuild`'s test output, ending in `** TEST SUCCEEDED **` or `** TEST FAILED **`.

## Afterwards

On a failure, report the failing assertion and point at `apps/raven/app/build/tvos-e2e/Logs/Test` (the result bundle, which `open` shows in Xcode, with screenshots of each step) and the fixture log the script names, what CI uploads as "End to end logs".

## Common mistakes

- Running `ci:app:ios` and `ci:app:tvos` at once: both write `apps/raven/app/ios/`.
- Running the steps by hand with `bun run` inside `apps/raven/app`: that skips the Nx cache. Go through `bun run ci:app:tvos`, or `bunx nx run` for one target.
- A run stopped part way leaves the film under Continue watching; a fresh fixture server clears it, so let the script start its own.
