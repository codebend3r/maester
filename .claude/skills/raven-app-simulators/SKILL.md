---
name: raven-app-simulators
description: >-
  Use when trying, previewing or testing the raven device app (`apps/raven/app`) on iPhone, iPad or Apple TV simulators, above all the first time on a Mac. Covers `open -a Simulator` failing with "Unable to find application named 'Simulator'", `pod install` failing with "Error installing ExpoModulesCore", `build:ios` failing at `SwiftExplicitDependencyGeneratePcm x86_64`, "No devices are booted", and the app showing "fetch failed: Could not connect to the server."
---

# raven app on the simulators

The goal: raven running on an iPhone, an iPad and an Apple TV simulator, pointed at the fixture server. Do every step yourself, in order, from the repo root, and fix the machine rather than the code.

Every `xcrun` and `xcodebuild` command needs the full Xcode, not the Command Line Tools. When `xcode-select -p` prints `/Library/Developer/CommandLineTools`, prefix each of those commands with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` (an agent's shell forgets an `export` between calls; the app's own scripts default to it). The user can fix it for good with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`; that needs their password, so suggest it rather than running it.

## 1. Tools

| Tool      | Check                                                               | Install                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Xcode     | `xcodebuild -version`, `xcodebuild -checkFirstLaunchStatus` exits 0 | The App Store or developer.apple.com; a nonzero first launch status needs `sudo xcodebuild -runFirstLaunch` from the user                                                  |
| Bun, Node | `bun --version`, `node --version`                                   | As the `get-started` skill says. A patch newer than `packageManager`'s Bun, or a Node other than CI's `APP_NODE_VERSION`, still builds; change neither unless a step fails |
| ffmpeg    | `ffmpeg -version`                                                   | `brew install ffmpeg` (the fixture server encodes its clips)                                                                                                               |
| CocoaPods | `pod --version`                                                     | `brew install cocoapods`                                                                                                                                                   |
| jq        | `jq --version`                                                      | `brew install jq`                                                                                                                                                          |
| Maestro   | `maestro --version`                                                 | Only for the iPhone's flows: `brew tap mobile-dev-inc/tap`, then `brew install mobile-dev-inc/tap/maestro` (needs Java)                                                    |

## 2. Install and runtimes

```bash
bun install --frozen-lockfile
xcrun simctl list runtimes            # needs an iOS and a tvOS line
xcodebuild -downloadPlatform iOS      # only when iOS is missing
xcodebuild -downloadPlatform tvOS     # only when tvOS is missing
```

## 3. Simulators

`xcrun simctl list devices` lists them with their UDIDs. Use the line whose name matches exactly: `Apple TV 4K (3rd generation) (at 1080p)` is a different simulator. Create only what is missing; the Apple TV keeps this exact name, since `e2e:tvos` looks it up by it.

```bash
xcrun simctl create "iPhone 17" com.apple.CoreSimulator.SimDeviceType.iPhone-17
xcrun simctl create "iPad Pro 11-inch (M5)" com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB
xcrun simctl create "Apple TV 4K (3rd generation)" com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K
```

`xcrun simctl list devicetypes` names the types when an Xcode has others.

## 4. The fixture server

When `curl -sf http://127.0.0.1:8490/api/health` fails, start it in the background and wait for its line `raven fixture server ready at http://127.0.0.1:8490`:

```bash
bunx nx run @raven/server:serve:fixture
```

A server someone else started can stop at any time; check the health route again before step 6.

## 5. Build

One after the other, never at once: both prebuilds rewrite the same `apps/raven/app/ios/`. Each `build:*` script has a `prebuild:*` that bun runs before it (Nx's graph does not show it), which runs `pod install`; a cold build takes about three minutes. `APP_VARIANT=development` lets the app reach the fixture server over plain http, and `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490` points it there and skips the account step, since the fixture server has no accounts.

```bash
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bunx nx run @raven/app:build:ios
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bunx nx run @raven/app:build:tvos
```

After each build, `cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock` must print nothing: `expo prebuild` exits 0 even when `pod install` failed. The iPhone and the iPad share the first build, so install them (step 6) while the Apple TV's builds.

## 6. Install and launch

For each simulator, by its UDID:

```bash
xcrun simctl boot <udid>                 # "Unable to boot device in current state: Booted" is fine
xcrun simctl bootstatus <udid> -b
xcrun simctl install <udid> apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/Raven.app
xcrun simctl launch --terminate-running-process <udid> io.github.codebend3r.raven.app
```

The Apple TV installs `apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/Raven.app` instead. Wait about five seconds past the splash, then `xcrun simctl io <udid> screenshot <file>.png` and look at it: raven shows Home.

Then show the screens: Xcode 27 and later have no Simulator.app, so `open /Applications/Xcode.app/Contents/Applications/DeviceHub.app`; an older Xcode uses `open -a Simulator`.

## Done

Report to the user, per device, whether raven launched, and say there is no sign-in (the build names the server and no client asks for a PIN). Home shows Kestrel Point, the film, and Lantern Bay, the series. The automated runs are `bun run app:e2e` (iPhone, Maestro) and `bun run app:e2e:tvos` (Apple TV), with the server up.

## When it fails

| Symptom                                                       | Fix                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| "Unable to find application named 'Simulator'"                | Xcode 27 replaced it with DeviceHub, as in step 6                                         |
| `xcrun: error: unable to find utility "simctl"`               | The Command Line Tools are selected: prefix `DEVELOPER_DIR`                               |
| `pod install` fails, "Error installing ExpoModulesCore"       | Usually a download that broke midway: run the same build again                            |
| `SwiftExplicitDependencyGeneratePcm x86_64 ... .pcm` failed   | Run the same build again; it resumes. If it fails twice, build Apple silicon only (below) |
| "No devices are booted"                                       | Boot it (step 6)                                                                          |
| "fetch failed: Could not connect to the server."              | The server is down: start it (step 4), then launch the app again                          |
| The app refuses `http://127.0.0.1:8490`                       | The build lacked `APP_VARIANT=development`: build again with it                           |
| Installing the tvOS build on an iPhone, or the reverse, fails | Each platform installs its own build (step 6)                                             |

The Apple silicon only build. The prebuild puts back the iPhone's `ios/` in case the Apple TV's was built since:

```bash
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bunx nx run @raven/app:prebuild:ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -workspace apps/raven/app/ios/Raven.xcworkspace -scheme Raven -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath apps/raven/app/build/ios CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO ARCHS=arm64 build
```
