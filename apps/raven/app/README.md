# raven for iPhone, iPad, Apple TV and Android TV

raven's device app: an [Expo](https://expo.dev) app on [`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos), the React Native fork that builds for Apple TV and Android TV as well as phones and tablets. It is `@raven/app` in the workspace; the [root README](../../../README.md) covers the workspace and the [design](../../../docs/superpowers/specs/2026-10-17-raven-device-apps-design.md) covers the app.

## What you need

- Xcode in `/Applications/Xcode.app`, with the iOS and tvOS simulators. Unless `DEVELOPER_DIR` names another Xcode, the scripts point it there, so `xcode-select` can stay on the Command Line Tools.
- CocoaPods and watchman: `brew install cocoapods watchman`.
- For Android TV: Android Studio, its SDK in `~/Library/Android/sdk` (`export ANDROID_HOME=~/Library/Android/sdk`), a TV emulator, and its bundled JDK as `JAVA_HOME` (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`).
- Node 22.18 or newer: Babel loads `babel.config.ts` through Node's type stripping.

## Running it

Run every script through Nx from the repo root, as `bunx nx run @raven/app:<script>`.

| Script                                           | Does                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `prebuild:ios`                                   | Generates `ios/` for iPhone and iPad                                                       |
| `prebuild:tvos`                                  | Generates `ios/` for Apple TV                                                              |
| `prebuild:android-tv`                            | Generates `android/` for Android TV                                                        |
| `build:ios`, `build:tvos`                        | A Release simulator build of the generated project, into `build/ios` or `build/tvos`       |
| `build:android-tv`                               | A Release APK, into `android/app/build/outputs/apk/release`                                |
| `start`                                          | Metro, for a debug build on a simulator or device; stops at once when watchman is missing  |
| `typecheck`, `lint:ts`, `format`, `format:check` | As every project                                                                           |
| `test`                                           | bun test, for everything that renders nothing                                              |
| `test:screens`                                   | jest-expo, for the tests that render (`*.render.test.tsx`)                                 |
| `e2e`                                            | Maestro flows in `e2e/` on the iPhone, against `@raven/server`'s `serve:fixture`           |
| `e2e:tvos`                                       | The Apple TV's XCUITest in `tvos-e2e/`, driven by the Siri Remote, against the same server |
| `e2e:android-tv`                                 | The Maestro flows the remote drives, on the Android TV emulator, against the same server   |

`ios/`, `android/` and `build/` are generated and gitignored. `prebuild:ios` and `prebuild:tvos` write the same `ios/` folder. Each `build:*` runs its own `prebuild:*` first (bun runs a `pre` script before the script it names), so a build always starts from a fresh native project for its platform.

To try a simulator build, install it on a booted simulator:

```sh
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/Raven.app
xcrun simctl launch booted io.github.codebend3r.raven.app
```

## Dev loop

- **Metro and a debug build.** Generate the development variant's project, start Metro, and run the debug build from Xcode (`ios/Raven.xcworkspace`) or Android Studio (`android/`) on a simulator, the emulator or a device. A change to the app reloads from Metro; a change to `app.config.ts`, a config plugin or a native dependency needs a prebuild again.

  ```sh
  APP_VARIANT=development bunx nx run @raven/app:prebuild:ios
  bunx nx run @raven/app:start
  ```

- **Release builds.** `build:ios`, `build:tvos` and `build:android-tv` carry their own bundle, so they run with no Metro. `APP_VARIANT=development` before one lets it reach the fixture server or a LAN server over plain http; without it the build is the one a device gets.
- **Tests.** `test` and `test:screens` run in `verify` and in every PR's checks, and need no simulator.
- **End to end.** `bunx nx run @raven/server:serve:fixture` starts a real server on `http://127.0.0.1:8490`. Against it, on a development-variant build, `bun run app:e2e` runs the iPhone's Maestro flows, `bun run app:e2e:tvos` the Apple TV's XCUITest and `bun run app:e2e:android-tv` the Android TV's Maestro flows, as [End to end](docs/end-to-end.md) says.

## More

- [Using the app](docs/using.md): how it reaches raven, how a title plays on each device, and its Settings.
- [End to end](docs/end-to-end.md): the Maestro flows and the Apple TV's XCUITest, and how to run them.
- [On real devices](docs/device-checklist.md): the device checklist and the known gaps.
- To install a build on your own iPhone, iPad, Apple TV or Android TV, follow the [raven README](../README.md#raven-app-iphone-ipad-apple-tv-android-tv).
