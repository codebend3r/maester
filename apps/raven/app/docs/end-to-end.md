# raven's device app, end to end

The flows that drive the app on a simulator or an emulator against the fixture server. Part of [raven's device app](../README.md).

`e2e/signIn.yaml` opens the accountless fixture server on a clean install, `e2e/home.yaml` then finds the film and the series on Home, `e2e/library.yaml` opens each library from Home and sorts it, `e2e/item.yaml` opens the film's page, marks it watched and back, and follows the series to its season and episode, `e2e/play.yaml` plays the film from its page under raven's controls (an MKV, so through the server's HLS remux), pauses it and goes back, and `e2e/search.yaml` searches every library from Home, opens the series it finds, says when nothing matches, and searches the film library from its own box. Start the server with `bunx nx run @raven/server:serve:fixture`, install a development-variant build with `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490` on a booted iPhone simulator and run `bun run app:e2e` from the repo root; the [raven README](../../README.md#test-it-end-to-end) has the steps.

On Android TV the same server is signed in to with the remote: `e2e/play.dpad.yaml` signs in by moving to each field, opening the platform's keyboard with select, typing and checking what the field shows (a secret as one dot a character) before sending it, finds the film focused on Home, opens it, plays it, pauses with the remote's play and pause key, skips ten seconds ahead with right, leaves with Back to a page offering to resume from that spot, finds the film under Continue watching with the focus back on the card it opened, and marks it watched and back, so the fixture is left as it was found. `e2e/home.yaml` runs there too. Build the development variant for Android TV, install it on the running emulator and run them; `e2e:android-tv` first points the emulator's `127.0.0.1:8490` at the computer's with `adb reverse`, so the app signs in to the address the iPhone uses:

```sh
export ANDROID_HOME=~/Library/Android/sdk
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bunx nx run @raven/app:build:android-tv
$ANDROID_HOME/platform-tools/adb install apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
bun run app:e2e:android-tv
```

The flows start straight at Home: the fixture server has no accounts, since `ready` needs Supabase Auth (the local stack in Docker, which the macOS runners lack, or the cloud). Playing under an account is covered by the bun and jest tests instead (`mediaAccess.test.ts`, `usePlaybackSession.test.ts`, `playerErrors.test.ts`, `Player.render.test.tsx`), and the server's own suite plays its HLS routes by account ticket and capability (`appEnforcementHls.test.ts`).

Maestro cannot drive an Apple TV, so the TV's flow is an XCUITest, `tvos-e2e/RemoteFlowTests.swift`, which presses the Siri Remote's buttons (`XCUIRemote`) and types on the platform's keyboard: it signs in, plays the film from Home, presses Menu twice and finds the film under Continue watching with the focus back on the card it opened, then presses Menu on Home and checks raven went to the background. It ends by marking the film watched and back, so the fixture is left as it was found. `prebuild:tvos` copies it into `ios/` as the `RavenRemoteTests` target and scheme (`plugins/withTvRemoteTests.ts`), so build the development variant for Apple TV, install it on the simulator and run it:

```sh
APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bunx nx run @raven/app:build:tvos
xcrun simctl install booted apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/Raven.app
bun run app:e2e:tvos
```

It runs on the simulator named `Apple TV 4K (3rd generation)`, or the one `TVOS_SIMULATOR` names, and keeps its result bundle in `build/tvos-e2e/Logs/Test`. It signs in only when the app asks; reset the simulator's keychain (`xcrun simctl keychain booted reset`) for a first launch.
