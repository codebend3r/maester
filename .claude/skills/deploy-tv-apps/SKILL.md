---
name: deploy-tv-apps
description: >-
  Use when putting the checked-out raven (`@raven/app`) on the real TVs at home, the Google TV Streamer and the Apple TV, together or one at a time: "deploy to my TVs", "put this branch on the TV", "install raven on the Apple TV", "update the Android TV app", "deploy the TV apps", "is the TV on the latest", or after a change to the app that should be tried on a TV. Covers the one command, the variant it builds, what it needs from each TV, how long it takes and what to check afterwards. Not for the simulators, the emulator or the e2e flows.
---

# Deploy raven to the TVs

One command builds the working tree as it is and puts it on both TVs, from the repo root:

```bash
bun run app:deploy:tvs
```

Run it yourself in the background (a cold run takes 30 to 45 minutes; a warm one about ten) and report its steps as they print. It takes the TV over: the install replaces the raven on each TV, over whatever is playing, and opens it. Never ask before interrupting the TV, never ask for a TV's address, and never ask the user to touch Xcode: the scripts find the TVs and sign the build.

The command is `bun run --sequential app:deploy:android-tv app:deploy:tvos`: the Android TV first, then the Apple TV, each also a root script of its own. They run one after the other on purpose. Both regenerate a native project with `expo prebuild --clean`, and two prebuilds at once break each other (the Android one failed with `Failed to read template file ios/Podfile` while the tvOS one was clearing `ios/`). Never run the two deploys, or a deploy and another prebuild or build of the app, at the same time.

## The variant

The three root scripts set `APP_VARIANT=development` unless the shell sets it, so both TVs get the same variant: plain http to a LAN server is allowed, and the public raven over https works as it does in a release. `APP_VARIANT=production bun run app:deploy:tvs` builds the strict release instead. Never set `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN` for a TV: that is the fixture build, which looks for a server on the TV itself.

## What each deploy does

| Deploy              | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy:android-tv` | Nx runs `build:android-tv` first (cached on the app, its dependencies and `APP_VARIANT`; `prebuild:android-tv` then Gradle's Release APK, about 20 minutes cold, with `ANDROID_HOME` and `JAVA_HOME` defaulting to this Mac's SDK and Android Studio's JDK when the shell sets neither). `apps/raven/app/scripts/deploy_android_tv.sh` then finds the TV's cast service over mDNS, relays `127.0.0.1:15556` to its adb on `5555` with Apple's python3, waits for the TV to accept, installs with `-r`, launches `MainActivity` and checks it is in front |
| `deploy:tvos`       | `apps/raven/app/scripts/deploy_tvos.sh`: reads the Apple Development team off the keychain, regenerates `ios/` with it written in (`APPLE_TEAM_ID`), builds the signed Release for `generic/platform=tvOS` into `build/tvos-device` (incremental, not Nx cached, 10 to 15 minutes cold), waits for the paired Apple TV to be reachable, installs and launches. A Personal Team profile lasts seven days; running it again renews it                                                                                                                      |

The Android script ends with `raven is on the Android TV` and the tvOS one with `raven is on the Apple TV`. `bun run --sequential` stops at the first failure, so when the Android deploy fails the Apple TV was never started: fix the cause and run the one that failed (or never ran) on its own, `bun run app:deploy:android-tv` or `bun run app:deploy:tvos`; the other TV keeps the build it got. The Android relay ends with its script; a relay already listening on `15556` (from the `run-android-tv-app` skill) is used as it is.

## What each TV needs

- **Google TV Streamer**: what `run-android-tv-app` says in "A real TV": on, with Developer options' USB debugging on (on Ethernet, where Wireless debugging refuses to turn on), and the "Allow debugging?" prompt accepted the first time this Mac connects; the script waits up to three minutes for it. `ANDROID_TV=<address>[:port]` skips discovery and `ANDROID_TV_NAME` picks another cast name than `Google-TV-Streamer`; the ports, the relay and the mDNS lookup are that skill's to describe.
- **Apple TV**: paired with this Mac once (`xcrun devicectl list devices` shows it as `physical`) and an Apple Development certificate in the keychain. A sleeping Apple TV takes the install but refuses a foreground launch (`System is asleep - foreground app launch forbidden`), and nothing on the Mac wakes it: the script then says raven is installed and opens once the TV is woken, and exits 0. Tell the user that, rather than treating it as a failure. Pairing is `xcrun devicectl manage pair --device "<name>"` with the TV on Settings, Remotes and Devices, Remote App and Devices; it reads the PIN the TV shows from stdin and fails at once without one, so run it with stdin on a fifo kept open by a `sleep` writer, ask the user for the code, and `echo <pin> > <fifo>`. A sleeping TV shows `unavailable`; the script waits for it. `APPLE_TV=<name or UDID>` picks one when several are paired.

## Afterwards

Say which build is on each TV: the branch and commit (`git log --oneline -1`), whether uncommitted changes went with it (`git status --short`), the variant, and that both scripts printed their closing line. The Android script's last lines name the activity in front; the tvOS one prints `raven is on the Apple TV`. The Apple TV takes a Release build with no Metro, so a change needs another run.

## Common mistakes

The Android TV's own failures (no Streamer on the network, no answer on `5555`, the connection never accepted, adb `offline`) are in `run-android-tv-app`'s table.

| Symptom                                                                            | Cause                                                                                                        | Fix                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Android installs but `topResumedActivity` is a launcher dialog or `DreamActivity`  | A system dialog sits over raven, or the TV was in its screensaver and the wake the script sends did not take | Dismiss it on the TV, or press a remote key; raven is installed                          |
| tvOS ends with `raven is installed on the Apple TV, which is asleep`               | The TV is asleep; the install went through and a launch is refused while it sleeps                           | Nothing: wake the TV and open raven, or run `app:deploy:tvos` again while it is awake    |
| `No paired Apple TV`                                                               | The TV was never paired with this Mac, or `devicectl` lists it only as a pairing id                          | Pair it (above); the script wants the 40-character hardware UDID, which pairing provides |
| `No Apple Development certificate in the keychain`                                 | Xcode has no signed-in account                                                                               | Sign in once in Xcode, Settings, Accounts                                                |
| The tvOS build fails on provisioning                                               | The free profile expired, or the TV is not registered to the team                                            | Run again: `-allowProvisioningUpdates` renews and registers                              |
| `Failed to read template file .../ios/Podfile. Was it removed mid-operation?`      | Two `expo prebuild --clean` runs at once (both deploys, or a deploy beside a simulator build)                | Let one finish, then run the other; `app:deploy:tvs` already runs them in turn           |
| Each TV got a different variant                                                    | A deploy was run through `nx run` directly, without the root script's `APP_VARIANT`                          | Use the root scripts, which set it                                                       |
| `check:patches` fails: `react-native-video in node_modules is missing patches/...` | The checkout pulled a changed patch without `bun install`, so bun still holds the old one                    | `bun install` from the repo root, then deploy again                                      |
| Both builds restart from scratch every run                                         | `APP_VARIANT` differs from last time, or the libraries changed                                               | Expected; keep the variant the same between runs                                         |
