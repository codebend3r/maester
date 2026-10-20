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
| `e2e`                                            | Maestro flows in `e2e/`, against `@raven/server`'s `serve:fixture`                         |
| `e2e:tvos`                                       | The Apple TV's XCUITest in `tvos-e2e/`, driven by the Siri Remote, against the same server |

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

## Playing

On an iPhone or iPad a title plays under raven's own controls: Back, the title and the audio and subtitle pickers along the top, play and pause between ten-second skips, and the time over a line to drag. A tap hides or shows them, and they fade by themselves once the video has played untouched for the linger the player preferences keep (five seconds unless changed). Picture in Picture starts from its button or when the app leaves the screen mid-play, AirPlay is in Control Center, and the screen stays on while the video plays.

On Apple TV a title plays under the system's own player, which the Siri Remote drives as in Apple's apps: press to play and pause, swipe or hold to scrub, click the edges to skip ten seconds, swipe down for the info panel (the title, its synopsis and its poster), and use the Subtitles and Audio buttons for the tracks. Subtitles come as the stream's HLS renditions, which the system draws in its own style, so a file with subtitles (a sidecar or a text track inside it) plays through the server's remux even when the TV could play it as it is. Menu leaves the player and saves the spot.

On Android TV a title plays under raven's own controls, driven by the d-pad: the title along the top, and the time over a line, then Play or Pause, the audio and subtitle pickers and Back along the bottom. The line has the focus as the controls appear, and left and right on it skip ten seconds; down moves to the buttons. The controls fade once the video has played untouched for the player preferences' linger, and any press brings them back; while they are hidden, left and right still skip, and the remote's play, rewind and fast forward keys work wherever the focus is. raven draws the subtitles itself, as on an iPhone, so a file with subtitles still plays as it is. A file whose sound the TV can neither play nor pass on (DTS or TrueHD on many TVs) counts as one that failed to start, so it plays through the remux, whose sound the server makes Dolby Digital Plus. Back leaves the player and saves the spot.

Everywhere else on Apple TV, Menu goes back a screen, and on Home it leaves raven for the TV's home screen, as tvOS's own apps do. Going back lands on the card you opened, not on the first one, and moving down or up into a row of cards lands on one of its cards: its first the first time, then the one you last left there. A library shelf's See all sits above its row, beside the shelf's title, and is reached as anything else on the screen is, by moving towards it.

A file the device plays as it is (on Apple, an MP4 or MOV of H.264 or HEVC with audio it decodes; on Android TV, also MKV and WebM, AV1 and VP9, and Opus, Vorbis and MP3) plays straight from the server; anything else plays through the server's HLS remux, or its transcode when the video itself must change. When one way fails to start, or has not started within 15 seconds, the next is tried from the same spot. Play and Resume start where the item's page says, the spot is saved every ten seconds, on a pause and on leaving, and the play counts in the library's history as soon as it starts.

## End to end

`e2e/signIn.yaml` signs in to the fixture server with its PIN and admin password, `e2e/home.yaml` then finds the locked film on Home, which only both unlocks show, `e2e/library.yaml` opens each library from Home and sorts it, `e2e/item.yaml` opens the film's page, marks it watched and back, and follows the series to its season and episode, `e2e/play.yaml` plays the film from its page under raven's controls (an MKV, so through the server's HLS remux), pauses it and goes back, and `e2e/search.yaml` searches every library from Home, opens the series it finds (the server's search leaves locked libraries out), says when nothing matches, and searches the film library from its own box. Start the server with `bunx nx run @raven/server:serve:fixture`, install a development-variant build on a booted iPhone simulator and run `bun run app:e2e` from the repo root; the [raven README](../README.md#test-it-end-to-end) has the steps. The address, PIN and admin password are in `signIn.yaml`'s `env`, matching what the server prints.

Maestro cannot drive an Apple TV, so the TV's flow is an XCUITest, `tvos-e2e/RemoteFlowTests.swift`, which presses the Siri Remote's buttons (`XCUIRemote`) and types on the platform's keyboard: it signs in, plays the film from Home, presses Menu twice and finds the film under Continue watching with the focus back on the card it opened, then presses Menu on Home and checks raven went to the background. It ends by marking the film watched and back, so the fixture is left as it was found. `prebuild:tvos` copies it into `ios/` as the `RavenRemoteTests` target and scheme (`plugins/withTvRemoteTests.ts`), so build the development variant for Apple TV, install it on the simulator and run it:

```sh
APP_VARIANT=development bunx nx run @raven/app:build:tvos
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app
bun run app:e2e:tvos
```

It runs on the simulator named `Apple TV 4K (3rd generation)`, or the one `TVOS_SIMULATOR` names, and keeps its result bundle in `build/tvos-e2e/Logs/Test`. It signs in only when the app asks; reset the simulator's keychain (`xcrun simctl keychain booted reset`) for a first launch.
