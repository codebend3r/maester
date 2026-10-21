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
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app
xcrun simctl launch booted io.github.codebend3r.raven.app
```

## Dev loop

- **Metro and a debug build.** Generate the development variant's project, start Metro, and run the debug build from Xcode (`ios/raven.xcworkspace`) or Android Studio (`android/`) on a simulator, the emulator or a device. A change to the app reloads from Metro; a change to `app.config.ts`, a config plugin or a native dependency needs a prebuild again.

  ```sh
  APP_VARIANT=development bunx nx run @raven/app:prebuild:ios
  bunx nx run @raven/app:start
  ```

- **Release builds.** `build:ios`, `build:tvos` and `build:android-tv` carry their own bundle, so they run with no Metro. `APP_VARIANT=development` before one lets it reach the fixture server or a LAN server over plain http; without it the build is the one a device gets.
- **Tests.** `test` and `test:screens` run in `verify` and in every PR's checks, and need no simulator.
- **End to end.** `bunx nx run @raven/server:serve:fixture` starts a real server on `http://127.0.0.1:8490`. Against it, on a development-variant build, `bun run app:e2e` runs the iPhone's Maestro flows, `bun run app:e2e:tvos` the Apple TV's XCUITest and `bun run app:e2e:android-tv` the Android TV's Maestro flows, as [End to end](#end-to-end) says.

## Reaching a server

The first launch asks for the server's address, such as `https://raven.<tailnet>.ts.net`, its PIN when it has locked libraries, and then its admin password when the [admin lock](../README.md#admin-lock) would still hide them. The app keeps a list of servers, one active at a time, each with its own cookies, in the device's keychain or keystore.

A release build reaches a server over https only: App Transport Security stays on, and Android sends no cleartext. To sign in to a LAN server over plain http, build the development variant (the build's own prebuild reads the variant):

```sh
APP_VARIANT=development bunx nx run @raven/app:build:tvos
```

It sets `NSAllowsLocalNetworking` on Apple and `usesCleartextTraffic` on Android. A debug build that loads its bundle from Metro needs it too, since Metro is plain http.

Media plays with tickets, so set `RAVEN_MEDIA_SECRET` on the server. Without it, sign-in says so, and the player falls back to sending the cookie.

The app signs in only to a server with accounts `off`, or one older than the accounts. A server with accounts `ready` needs an account the app cannot sign in with yet: sign-in reads the server's auth config first and says so on the address step. A listed server keeps the sign-in it was first seen with pinned, and the app asks before it follows the server to another. Account sign-in comes later in PR 10 (the plan's Ruling 28).

To install a build on your own iPhone, iPad, Apple TV or Android TV, follow the [raven README](../README.md#raven-app-iphone-ipad-apple-tv-android-tv).

## Playing

On an iPhone or iPad a title plays under raven's own controls: Back, the title and the audio and subtitle pickers along the top, play and pause between ten-second skips, and the time over a line to drag. A tap hides or shows them, and they fade by themselves once the video has played untouched for the linger the player preferences keep (five seconds unless changed). Picture in Picture starts from its button or when the app leaves the screen mid-play, AirPlay is in Control Center, and the screen stays on while the video plays.

On Apple TV a title plays under the system's own player, which the Siri Remote drives as in Apple's apps: press to play and pause, swipe or hold to scrub, click the edges to skip ten seconds, swipe down for the info panel (the title, its synopsis and its poster), and use the Subtitles and Audio buttons for the tracks. Subtitles come as the stream's HLS renditions, which the system draws in its own style, so a file with subtitles (a sidecar or a text track inside it) plays through the server's remux even when the TV could play it as it is. Menu leaves the player and saves the spot.

On Android TV a title plays under raven's own controls, driven by the d-pad: the title along the top, and the time over a line, then Play or Pause, the audio and subtitle pickers and Back along the bottom. The line has the focus as the controls appear, and left and right on it skip ten seconds; down moves to the buttons. The controls fade once the video has played untouched for the player preferences' linger, and any press brings them back; while they are hidden, left and right still skip, and the remote's play, rewind and fast forward keys work wherever the focus is. raven draws the subtitles itself, as on an iPhone, so a file with subtitles still plays as it is. A file whose sound the TV can neither play nor pass on (DTS or TrueHD on many TVs) counts as one that failed to start, so it plays through the remux, whose sound the server makes Dolby Digital Plus. Back leaves the player and saves the spot.

Everywhere else on Apple TV, Menu goes back a screen, and on Home it leaves raven for the TV's home screen, as tvOS's own apps do. Going back lands on the card you opened, not on the first one, and moving down or up into a row of cards lands on one of its cards: its first the first time, then the one you last left there. A library shelf's See all sits above its row, beside the shelf's title, and is reached as anything else on the screen is, by moving towards it.

A file the device plays as it is (on Apple, an MP4 or MOV of H.264 or HEVC with audio it decodes; on Android TV, also MKV and WebM, AV1 and VP9, and Opus, Vorbis and MP3) plays straight from the server; anything else plays through the server's HLS remux, or its transcode when the video itself must change. When one way fails to start, or has not started within 15 seconds, the next is tried from the same spot. Play and Resume start where the item's page says, the spot is saved every ten seconds, on a pause and on leaving, and the play counts in the library's history as soon as it starts.

## Settings

Settings opens from the gear beside Search at the top of Home on an iPhone or iPad, and from the Settings button beside Search on a TV. Everything in it stays on the device; it changes nothing on any server.

- **Servers.** Each server the device knows, the one in use marked. Use switches to another, and Home reads it afresh. Rename gives one a name of your own; on a TV, Menu or Back while renaming cancels it and stays in Settings. Remove asks first, then forgets the server and its sign-in on this device; removing the one in use switches to the first one left, or, with none left, goes back to sign-in. Add a server goes through sign-in, up to twenty servers.
- **Theme.** One of the web's seven themes, from the system's sheet under the thumb or a list on a TV. Every screen takes it up at once, with no restart, and it is the theme raven opens in next time. Patina and Mint are light, and wear the logo drawn for a light ground; on them the system's own sheets, alerts and keyboards are light too. The player looks the same in every theme, dark over the picture as on the web: its buttons, track chips and the lists and sheets they open are dark glass, and only its played line takes the theme's colour. raven opens on its splash in the default theme's dark and holds it until the theme picked is ready, so it never flashes white or the wrong theme.
- **Playback.** These only ever narrow what the server allows. Prefer direct play (on unless turned off) tries a file the device may refuse as it is first, such as HEVC in MP4 on Apple or DTS on Android TV; off, such a file starts at the server's remux. Allow transcoding (on) lets the server re-encode what the device cannot play; off, the server only remuxes, and a file that needs a transcode says so. Away from home caps a transcode played over the internet to save data: at 1080p (the default) it asks the server's lowest 1080p size, 8 Mb/s, at 720p its lowest 720p size, 2 Mb/s, and at 4K it asks nothing, leaving the server's own settings.

## End to end

`e2e/signIn.yaml` signs in to the fixture server with its PIN and admin password, `e2e/home.yaml` then finds the locked film on Home, which only both unlocks show, `e2e/library.yaml` opens each library from Home and sorts it, `e2e/item.yaml` opens the film's page, marks it watched and back, and follows the series to its season and episode, `e2e/play.yaml` plays the film from its page under raven's controls (an MKV, so through the server's HLS remux), pauses it and goes back, and `e2e/search.yaml` searches every library from Home, opens the series it finds (the server's search leaves locked libraries out), says when nothing matches, and searches the film library from its own box. Start the server with `bunx nx run @raven/server:serve:fixture`, install a development-variant build on a booted iPhone simulator and run `bun run app:e2e` from the repo root; the [raven README](../README.md#test-it-end-to-end) has the steps. The address, PIN and admin password are in `signIn.yaml`'s `env`, matching what the server prints.

On Android TV the same server is signed in to with the remote: `e2e/play.dpad.yaml` signs in by moving to each field, opening the platform's keyboard with select, typing and checking what the field shows (a secret as one dot a character) before sending it, finds the film focused on Home, opens it, plays it, pauses with the remote's play and pause key, skips ten seconds ahead with right, leaves with Back to a page offering to resume from that spot, finds the film under Continue watching with the focus back on the card it opened, and marks it watched and back, so the fixture is left as it was found. `e2e/home.yaml` runs there too. Build the development variant for Android TV, install it on the running emulator and run them; `e2e:android-tv` first points the emulator's `127.0.0.1:8490` at the computer's with `adb reverse`, so the app signs in to the address the iPhone uses:

```sh
export ANDROID_HOME=~/Library/Android/sdk
APP_VARIANT=development bunx nx run @raven/app:build:android-tv
$ANDROID_HOME/platform-tools/adb install apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
bun run app:e2e:android-tv
```

Maestro cannot drive an Apple TV, so the TV's flow is an XCUITest, `tvos-e2e/RemoteFlowTests.swift`, which presses the Siri Remote's buttons (`XCUIRemote`) and types on the platform's keyboard: it signs in, plays the film from Home, presses Menu twice and finds the film under Continue watching with the focus back on the card it opened, then presses Menu on Home and checks raven went to the background. It ends by marking the film watched and back, so the fixture is left as it was found. `prebuild:tvos` copies it into `ios/` as the `RavenRemoteTests` target and scheme (`plugins/withTvRemoteTests.ts`), so build the development variant for Apple TV, install it on the simulator and run it:

```sh
APP_VARIANT=development bunx nx run @raven/app:build:tvos
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app
bun run app:e2e:tvos
```

It runs on the simulator named `Apple TV 4K (3rd generation)`, or the one `TVOS_SIMULATOR` names, and keeps its result bundle in `build/tvos-e2e/Logs/Test`. It signs in only when the app asks; reset the simulator's keychain (`xcrun simctl keychain booted reset`) for a first launch.

## The device checklist

Ruling 21 of the [plan](../../../docs/superpowers/plans/2026-10-18-raven-device-apps.md) leaves the real-device pass to the person with the devices. CI has only an iPhone simulator, an Apple TV simulator and an Android TV emulator: none shows HDR or Dolby Vision, decodes in a real TV's hardware, passes sound to a receiver, or does Picture in Picture and AirPlay as a device does, and the emulator decodes no AC-3, E-AC-3, DTS, TrueHD or ALAC. So nothing in CI can fill this table. Play each file on the iPhone or iPad, the Apple TV 4K and the Android TV, installed as the [raven README](../README.md#raven-app-iphone-ipad-apple-tv-android-tv) says, from a server that has them, and write in Result, for each device, whether it played, and what was wrong if not: no picture, no sound, the wrong colours, missing subtitles, a step down that never came.

The files are the desktop spec's test media (`docs/superpowers/specs/2026-10-12-raven-desktop-design.md`, "Shared test media"), one per row, kept outside the repo.

|     | File                                                                       | What it checks                                         | Result |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| M1  | MP4, H.264 1080p24, AAC 2.0, mov_text                                      | the baseline                                           |        |
| M2  | MKV, HEVC 10-bit 2160p HDR10, TrueHD 7.1 Atmos and AC3, PGS, 60 to 80 Mb/s | HDR, passthrough, picture subtitles                    |        |
| M3  | HEVC Dolby Vision profile 8.1, E-AC3 Atmos, SRT                            | Dolby Vision with an HDR10 base                        |        |
| M4  | HEVC Dolby Vision profile 5, E-AC3                                         | reshaping: no green or purple cast                     |        |
| M5  | Dolby Vision profile 7 FEL, from a UHD Blu-ray                             | the base layer plays                                   |        |
| M6  | HLG 2160p50                                                                | HLG                                                    |        |
| M7  | HDR10+                                                                     | dynamic metadata                                       |        |
| M8  | AV1 10-bit HDR, Opus 5.1                                                   | AV1 in hardware where the device has it                |        |
| M9  | WebM, VP9 profile 2 HDR                                                    | VP9 HDR                                                |        |
| M10 | H.264 High 10, FLAC, ASS with attached fonts                               | the transcode for 10-bit H.264, FLAC, styled subtitles |        |
| M11 | TS, MPEG-2 1080i, DVB subtitles                                            | deinterlacing                                          |        |
| M12 | M2TS, VC-1, DTS-HD MA, PGS                                                 | an older Blu-ray                                       |        |
| M13 | DVD MPEG-2 480i, VobSub                                                    | VobSub                                                 |        |
| M14 | HEVC 2160p60, peaks of 100 Mb/s                                            | frame pacing under load                                |        |
| M15 | DTS core, LPCM 7.1, SRT sidecars in UTF-8 and cp1252, WebVTT               | audio variety, sidecars                                |        |

Check these on the devices too, since only a device can answer them:

- **The cookie on Apple devices.** On a server with no `RAVEN_MEDIA_SECRET`, a title in a locked library plays, direct and through the remux. The app sends the cookie as a header beside the system's own cookie store (`AVURLAssetHTTPCookiesKey`); the simulator's end to end plays the remux that way, and a device is still to confirm it.
- **Subtitles under the thumb.** raven draws them (Ruling 25), since on the simulator AVPlayer drew neither a sidecar nor an HLS rendition. Check whether a device's AVPlayer draws its own tracks; Picture in Picture and AirPlay show none either way.
- **Subtitles on Apple TV.** A file with a text subtitle starts at the remux (Ruling 22), and the system's Subtitles panel lists and draws its renditions.
- **Sound on Android TV.** A file whose sound the TV can neither decode nor pass on steps down to the remux, where it plays as E-AC-3.
- **Away from home.** With Settings' cap at 1080p, a transcode played from a `public` origin asks for the server's lowest 1080p size.

## Known gaps

- **No audio choice in an Apple TV stream.** The server's HLS master playlist lists no alternate audio renditions, so in a remux or a transcode the system's Audio panel offers only the track the session asked for. Under raven's own controls (iPhone, iPad, Android TV) a pick reloads the stream with it.
- **Apple TV forgets a subtitle picked in its panel.** The system's Subtitles panel is the system's: a pick there is not written to the player preferences, so the next title, or a step down the ladder, starts with the preferred track again.
- **No picture in Apple TV's info panel for a locked library.** `react-native-video` fetches the panel's poster with no headers, and a locked library's pictures need the unlock cookie.
- **ALAC over HLS may be silent on Android TV.** The remux copies ALAC, which ExoPlayer leaves out on a TV with no ALAC decoder, and `canStream` cannot see it. The fix is the server's: make ALAC FLAC or E-AC-3 over HLS, or say what the stream carries.
- **See all may open a library with its first bucket shut on Android TV.** On the emulator, Home's See all pressed with `adb shell input keyevent DPAD_CENTER` opened the library with the remote on its first bucket heading and that bucket shut, as if the key reached the heading too. It is still to be checked with a real remote.
- **No covers view.** The web's bare covers view has no layout in the app yet: a library left on covers opens on the grid, and the app's view picker does not offer it.
