---
name: deploy-wren-tv
description: >-
  Use when putting the checked-out Wren on TV (`@wren/tv`, `apps/wren/wren-tv`) on the real TVs at home, the Google TV Streamer and the Apple TV, together or one at a time: "deploy Wren to my TVs", "put Wren on the TV", "install Wren on the Apple TV", "update Wren on the Android TV", "deploy the Wren TV app", "is Wren on the TV the latest", or after a change to Wren on TV that should be tried on a TV. Covers the one command, the variant it builds, what it needs from each TV, how long it takes and what to check afterwards. raven's own TV app is the `deploy-tv-apps` skill's. Not for the simulators, the emulator or the e2e flows.
---

# Deploy Wren to the TVs

Wren on TV deploys exactly as raven's TV app does (the `deploy-tv-apps` skill): the same discovery, relay, signing and launch, run for Wren's folder, project and id (`app.netlify.wren.tv`). It installs beside raven, never over it. One command builds the working tree as it is and puts it on both TVs, from the repo root:

```bash
bun run wren:tv:deploy:tvs
```

Run it yourself in the background (a cold run takes 30 to 45 minutes; a warm one about ten) and report its steps as they print. It takes the TV over: the install replaces the Wren on each TV, over whatever is playing, and opens it. Never ask before interrupting the TV, never ask for a TV's address, and never ask the user to touch Xcode: the scripts find the TVs and sign the build.

The command is `bun run --sequential wren:tv:deploy:android-tv wren:tv:deploy:tvos`: the Android TV first, then the Apple TV, each also a root script of its own. They run one after the other on purpose: both regenerate a native project with `expo prebuild --clean`, and two prebuilds at once break each other. Never run the two deploys, or a Wren on TV deploy beside a raven deploy, a build or a prebuild of the same app, at the same time. raven's and Wren's TV apps live in different folders and never touch each other's project, but the Android TV is one adb connection, so run raven's and Wren's deploys in turn too. `bun run deploy:devices` runs every device app, Wren on TV last.

## The variant

The root scripts set `APP_VARIANT=development` unless the shell sets it, so both TVs get the same variant: plain http to a LAN server is allowed, and the public raven over https works as it does in a release. `APP_VARIANT=production bun run wren:tv:deploy:tvs` builds the strict release instead. Never set `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN` for a TV: that is the fixture build, which looks for a server on the TV itself.

## What each deploy does

| Deploy                      | Steps                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wren:tv:deploy:android-tv` | Nx runs `@wren/tv:build:android-tv` first (cached on the app, its libraries and `APP_VARIANT`; `prebuild:android-tv` then Gradle's Release APK, about 20 minutes cold). `apps/wren/wren-tv/scripts/deploy_android_tv.sh` then finds the TV's cast service over mDNS, relays `127.0.0.1:15556` to its adb on `5555`, waits for the TV to accept, installs with `-r`, launches `MainActivity` and checks it is in front |
| `wren:tv:deploy:tvos`       | `apps/wren/wren-tv/scripts/deploy_tvos.sh`: reads the Apple Development team off the keychain, regenerates `ios/` with it written in (`APPLE_TEAM_ID`), builds the signed Release for `generic/platform=tvOS` into `build/tvos-device` (incremental, not Nx cached, 10 to 15 minutes cold), waits for the paired Apple TV to be reachable, installs and launches                                                      |

The Android script ends with `Wren is on the Android TV` and the tvOS one with `Wren is on the Apple TV`. `bun run --sequential` stops at the first failure, so when the Android deploy fails the Apple TV was never started: fix the cause and run the one that failed (or never ran) on its own, `bun run wren:tv:deploy:android-tv` or `bun run wren:tv:deploy:tvos`; the other TV keeps the build it got.

## What each TV needs

The same as raven's, since it is the same TV: the `deploy-tv-apps` skill's "What each TV needs".

- **Google TV Streamer**: on, with Developer options' USB debugging on (on Ethernet), and "Allow debugging?" accepted the first time this Mac connects; the script waits up to three minutes. `ANDROID_TV=<address>[:port]` skips discovery and `ANDROID_TV_NAME` picks another cast name than `Google-TV-Streamer`.
- **Apple TV**: paired with this Mac once (`xcrun devicectl list devices` shows it as `physical`) and an Apple Development certificate in the keychain. A sleeping Apple TV takes the install but refuses a foreground launch: the script then says Wren is installed and opens once the TV is woken, and exits 0. Tell the user that, rather than treating it as a failure. `APPLE_TV=<name or UDID>` picks one when several are paired. A Personal Team profile lasts seven days; running the deploy again renews it.

## Afterwards

Say which build is on each TV: the branch and commit (`git log --oneline -1`), whether uncommitted changes went with it (`git status --short`), the variant, and that both scripts printed their closing line. Wren on TV signs in with the same raven account as the phone, email and password typed on the TV's keyboard; `-r` keeps the Android TV's sign-in across installs.

## Common mistakes

The failures are raven's: see the `deploy-tv-apps` skill's table, and `run-android-tv-app`'s for the Android TV's connection. What is Wren's own:

| Symptom                                                             | Cause                                                                               | Fix                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| tvOS ends with `Wren is installed on the Apple TV, which is asleep` | The TV is asleep; the install went through and a launch is refused while it sleeps  | Nothing: wake the TV and open Wren, or run `wren:tv:deploy:tvos` again while it is awake |
| `Failed to read template file .../ios/Podfile`                      | Two prebuilds of Wren on TV at once (both deploys, or a deploy beside `build:tvos`) | Let one finish, then run the other; `wren:tv:deploy:tvs` already runs them in turn       |
