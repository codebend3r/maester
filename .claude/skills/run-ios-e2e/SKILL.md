---
name: run-ios-e2e
description: Use when running the `📱 App on iPhone and iPad` PR check locally on a Mac, or `app:e2e`: "run the iPhone CI locally", "run the iOS e2e", "run the app e2e on the simulator", "reproduce the app-ios job", "the iPhone and iPad check failed, run it here", "run ci:app:ios". Covers the one command that runs the whole job, what it installs, its Nx caching, and what appears on screen.
---

# Run the iPhone and iPad check locally

The `app-ios` job in `.github/workflows/pull-request-checks.yml`, on macOS with Apple silicon. One command runs every step, from the repo root:

```bash
bun run ci:app:ios
```

It is `scripts/ci_app_ios.sh`. Run it yourself in the background (it takes up to 30 minutes cold) and report its steps as they print. Before starting, tell the user what will appear on screen (below).

## What it does

| Step                      | What runs                                                                                                                                                                                                  | Nx cached    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Tools                     | Installs what is missing with Homebrew: `ffmpeg`, `jq`, `cocoapods`, `ccache`, Maestro; checks for Node 22.18 or newer. Downloads the iOS simulator runtime matching Xcode's SDK when there is none (8 GB) | no           |
| Install                   | `bun install --frozen-lockfile`                                                                                                                                                                            | no           |
| Build the libraries       | `nx run-many -t build -p @raven/core @raven/ui @shared/server`, once, so the server and the build do not both rebuild them                                                                                 | yes          |
| Start the fixture server  | `@raven/server:serve:fixture` in the background on `:8490`, unless something already listens there                                                                                                         | no, a server |
| Boot the iPhone simulator | Reuses the simulator `raven-phone` on the SDK's runtime, or makes one (CI's iPhone 16, else the runtime's newest iPhone)                                                                                   | no           |
| Build                     | `@raven/app:build:ios`, which runs `prebuild:ios` (`expo prebuild`, `pod install`) and then `xcodebuild`'s Release build                                                                                   | yes          |
| Check the pods            | `cmp Podfile.lock Pods/Manifest.lock`, since `expo prebuild` exits 0 when `pod install` fails                                                                                                              | no, instant  |
| Install the build         | `xcrun simctl install` of `raven.app`                                                                                                                                                                      | no, instant  |
| Wait for the fixture      | Its `raven fixture server ready` line, up to three minutes                                                                                                                                                 | no           |
| App end to end            | `@raven/app:e2e`: every flow in `apps/raven/app/e2e` but the `dpad` ones                                                                                                                                   | yes          |

It sets `APP_VARIANT=development`, `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490` and `DEVELOPER_DIR` (`/Applications/Xcode.app/Contents/Developer` unless set) for every step. They are Nx inputs of the build and the flows, so the cache keys stay the same run to run. The fixture server is stopped when the script ends, pass or fail.

CI's last two steps (zipping and uploading the simulator app) are left out: the build stays at `apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app`.

## Caching

With the app, its dependencies, the server's `src/`, the variables and the Xcode version unchanged, the build is restored and a passing run of the flows replays in seconds. The tools, the simulator boot and the fixture server still run, since they are not tasks Nx can cache. A failure is never cached. For a real run of a passing state, only when the user asks:

```bash
bun run ci:app:ios -- --skip-nx-cache
```

The arguments go to the flows' `nx run`, so the build stays cached.

## On screen

- **Simulator** opens with the iPhone (`raven-phone`) and boots it to the home screen. It stays open afterwards.
- During the build, nothing new: Expo, CocoaPods and `xcodebuild` print to the terminal.
- Maestro opens nothing of its own; it drives the iPhone in Simulator. Each flow relaunches raven with its state cleared, so the sign-in repeats for each one: the PIN screen ("This server keeps some libraries behind a PIN."), the PIN `1357` and the admin password typed in by taps, then Home with **Kestrel Point** and **Lantern Bay**. Then, flow by flow: a library opened from See all and sorted, the film's page marked watched and back, a show's season and episode, the film playing under raven's controls and paused, and a search from Home's header.
- Ask the user not to click in Simulator while it runs; a tap can fail a flow.
- The terminal prints each flow with a pass or fail mark.

## Afterwards

On a failure, report the failing flow and step, and point at `~/.maestro/tests/<latest>/` (screenshots and Maestro's log) and the fixture log the script names, what CI uploads as "End to end logs".

## Common mistakes

- Another simulator booted beside `raven-phone`, such as an iPad or the Apple TV: Maestro may pick it. Shut the others down first (`xcrun simctl shutdown <name>`).
- A missing Xcode: the script stops; Xcode comes from the App Store and must be opened once to accept its license.
- Running the steps by hand with `bun run` inside `apps/raven/app`: that skips the Nx cache. Go through `bun run ci:app:ios`, or `bunx nx run` for one target.
