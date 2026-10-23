# raven for iPhone, iPad, Apple TV and Android TV

raven's device app: an [Expo](https://expo.dev) app on [`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos), the React Native fork that builds for Apple TV and Android TV as well as phones and tablets. It is `@raven/app` in the workspace; the [root README](../../../README.md) covers the workspace and the [design](../../../docs/superpowers/specs/2026-10-17-raven-device-apps-design.md) covers the app.

## What you need

- Xcode in `/Applications/Xcode.app`, with the iOS and tvOS simulators. Unless `DEVELOPER_DIR` names another Xcode, the scripts point it there, so `xcode-select` can stay on the Command Line Tools.
- CocoaPods and watchman: `brew install cocoapods watchman`.
- For Android TV: Android Studio, its SDK in `~/Library/Android/sdk` (`export ANDROID_HOME=~/Library/Android/sdk`), a TV emulator, and its bundled JDK as `JAVA_HOME` (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`).
- Node 22.18 or newer: Babel loads `babel.config.ts` through Node's type stripping.

## Running it

Run every script through Nx from the repo root, as `bunx nx run @raven/app:<script>`.

| Script                                           | Does                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `prebuild:ios`                                   | Generates `ios/` for iPhone and iPad                                                      |
| `prebuild:tvos`                                  | Generates `ios/` for Apple TV                                                             |
| `prebuild:android-tv`                            | Generates `android/` for Android TV                                                       |
| `build:ios`, `build:tvos`                        | A Release simulator build of the generated project, into `build/ios` or `build/tvos`      |
| `build:android-tv`                               | A Release APK, into `android/app/build/outputs/apk/release`                               |
| `start`                                          | Metro, for a debug build on a simulator or device; stops at once when watchman is missing |
| `typecheck`, `lint:ts`, `format`, `format:check` | As every project                                                                          |
| `test`                                           | bun test, for everything that renders nothing                                             |
| `test:screens`                                   | jest-expo, for the tests that render (`*.render.test.tsx`)                                |
| `e2e`                                            | Maestro flows in `e2e/`, against `@raven/server`'s `serve:fixture`                        |

`ios/`, `android/` and `build/` are generated and gitignored. `prebuild:ios` and `prebuild:tvos` write the same `ios/` folder. Each `build:*` runs its own `prebuild:*` first (bun runs a `pre` script before the script it names), so a build always starts from a fresh native project for its platform.

To try a simulator build, install it on a booted simulator:

```sh
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app
xcrun simctl launch booted io.github.codebend3r.raven.app
```

## Reaching a server

The first launch asks for the server's address, such as `http://192.168.1.20:8484`, its PIN when it has locked libraries, and then its admin password when the [admin lock](../README.md#admin-lock) would still hide them. The app keeps a list of servers, one active at a time, each with its own cookies, in the device's keychain or keystore.

A release build reaches a server over https only: App Transport Security stays on, and Android sends no cleartext. To sign in to a LAN server over plain http, build the development variant (the build's own prebuild reads the variant):

```sh
APP_VARIANT=development bunx nx run @raven/app:build:tvos
```

It sets `NSAllowsLocalNetworking` on Apple and `usesCleartextTraffic` on Android. A debug build that loads its bundle from Metro needs it too, since Metro is plain http.

Media plays with tickets, so set `RAVEN_MEDIA_SECRET` on the server. Without it, sign-in says so, and the player falls back to sending the cookie.

## End to end

`e2e/signIn.yaml` signs in to the fixture server with its PIN and admin password, and `e2e/home.yaml` then finds the locked film on Home, which only both unlocks show. Start the server with `bunx nx run @raven/server:serve:fixture`, install a development-variant build on a booted iPhone simulator and run `bun run app:e2e` from the repo root; the [raven README](../README.md#test-it-end-to-end) has the steps. The address, PIN and admin password are in `signIn.yaml`'s `env`, matching what the server prints.
