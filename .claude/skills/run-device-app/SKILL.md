---
name: run-device-app
description: Use when running raven's device app (`@raven/app`) locally on an iPhone, iPad or Apple TV simulator: "run the app in the simulator", "start the iPhone app dev server", "run the dev client", "hot reload the app", "build the iOS app", "run the app e2e flows", "boot a simulator for raven". Covers creating the simulators, the dev scripts (Metro and a Debug build with the raven server), the Release build, Xcode, and the Maestro flows.
---

# Run the device app

`@raven/app` (`apps/raven/app`) is the Expo app on the `react-native-tvos` fork. Tools are installed by the `get-started` skill (Xcode with simulator runtimes, CocoaPods, watchman, Maestro, Java); run that first on a new machine.

## 1. Simulators, once

The dev scripts launch simulators by name: `raven-phone` (iPhone), `raven-pad` (iPad) and `raven-tv` (Apple TV). Create the ones you need. A runtime must be installed first (`xcrun simctl list runtimes`; none means `xcodebuild -downloadPlatform iOS`, or `tvOS`, about 8 GB each).

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl list -j devicetypes runtimes   # which device types a runtime supports
xcrun simctl create raven-phone com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl create raven-pad "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB" com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl create raven-tv com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K <a tvOS runtime id>
```

A device type must be one the runtime lists, so check before creating (iOS 27.0 has iPhone 17 and 18 Pro, not 16).

## 2. Dev loop (hot reload)

From the repo root. The app asks for a server address at sign-in, so the dev scripts start no server of their own: type Vhagar's, `http://192.168.50.6:8484` (plain http to the LAN works in the development variant). If the app shows Home with "fetch failed", it is holding a server that no longer answers (the e2e fixture's `127.0.0.1:8490`, say): clear it with `xcrun simctl keychain booted reset`, then relaunch the app and the sign-in screen asks again.

| Device   | Command                | What it runs                                                     |
| -------- | ---------------------- | ---------------------------------------------------------------- |
| iPhone   | `bun run app:dev:ios`  | `prebuild:ios`, then `expo run:ios --device raven-phone`         |
| iPad     | `bun run app:dev:ipad` | the same on `raven-pad`                                          |
| Apple TV | `bun run app:dev:tvos` | `prebuild:tvos`, then `EXPO_TV=1 expo run:ios --device raven-tv` |

Against a local backend instead, run `bun run app:server` (`@raven/server`'s `dev`, on `:8484`) in a second terminal and sign in at `http://localhost:8484`.

What happens: the app's `predev:*` script regenerates `ios/` with `APP_VARIANT=development` (plain http to the loopback, needed for Debug builds against Metro), then `expo run:ios` builds the Debug configuration, installs and launches it, and keeps Metro on `:8081`. Edits to `src/` and `app/` reload live. A change to `@raven/core` or `@raven/ui` needs their `dist` rebuilt (`bunx nx run @raven/core:build`), since Metro reads the built package.

- `ios/` is shared by iOS and tvOS, and `prebuild --clean` rewrites it, so switching devices re-runs the prebuild (a few minutes for `pod install`). Never edit `ios/`; change the Expo config or a plugin.
- A local server needs `apps/raven/.env` and a library: pull Vhagar's `raven.db`, or use the fixture server (`bunx nx run @raven/server:serve:fixture`, `http://127.0.0.1:8490`, PIN `1357`).
- If Vhagar refuses connections, check its container with the `synology-nas-ssh` skill: after an auto-update the `raven` container can sit in `Created` when Docker cannot make the `/volume1/Vhagar/Caraxes` bind mount; `docker start raven` brings it up.
- A debugger and native logs: after `bun run app:prebuild:ios`, open `apps/raven/app/ios/Raven.xcworkspace` (the workspace, not the project) in Xcode, pick the `Raven` scheme and a simulator, run it, and keep Metro going with `bun run app:start`. Xcode does not start Metro; a red "no bundle URL" screen means Metro is not running.

## 3. Release build (no hot reload)

```bash
APP_VARIANT=development bun run app:build:ios     # or app:build:tvos
xcrun simctl boot raven-phone && open -a Simulator
xcrun simctl install booted apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/Raven.app
xcrun simctl launch booted io.github.codebend3r.raven.app
```

`app:build:*` runs its `prebuild:*` first and is cached by Nx. Omit `APP_VARIANT=development` for a build that keeps App Transport Security strict.

## 4. End to end (Maestro)

Needs the development-variant Release build installed on a booted iPhone simulator and the fixture server running.

```bash
APP_VARIANT=development bun run app:build:ios
bunx nx run @raven/server:serve:fixture            # second terminal; wait for "raven fixture server ready"
xcrun simctl install booted apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/Raven.app
JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home MAESTRO_DRIVER_STARTUP_TIMEOUT=300000 bun run app:e2e
```

`JAVA_HOME` is only needed inline in a shell that has not read `~/.zshrc`. Maestro cannot drive tvOS, so only the iPhone flows run locally. Add `--skip-nx-cache` to force a real run, since a pass is cached.

## Other checks

`bun run test:screens` (jest render tests), `bunx nx run @raven/app:typecheck`, and `bun run verify` cover the rest. See `apps/raven/app/CLAUDE.md` for the pins and toolchain.
