---
name: build-all-apps
description: Use when building every raven app and putting it on every physical device at once: "build all the apps", "build and deploy everything", "put this branch on all my devices", "build web, desktop, Apple TV, Google TV and iPhone", "update every device", "check everything builds", "build the Mac and Windows desktop". Builds the working tree and installs it on this Mac, the Google TV Streamer, the Apple TV and every paired iPhone and iPad; never stops at a simulator or emulator. Covers the order, the commands, what a Mac cannot build (Windows) and how long each takes.
---

# Build every app and put it on every device

The point of this skill is the devices: the working tree, built, installed and opened on every real device raven runs on. A build that only reached a simulator, an emulator or a folder is not done. Run it from the repo root on a Mac with Apple silicon and Xcode. Each step goes through Nx, so a step whose inputs are unchanged replays from the cache in seconds.

Run the steps **one after another, never at once**: every device deploy regenerates a native project with `expo prebuild --clean`, and two prebuilds at once break each other. Run each long step in the background, report its steps as they print, and never ask before taking a device over: each install replaces raven on that device, over whatever is playing, and opens it.

## The steps

| #   | Device                          | Command                                                             | Cold time                         |
| --- | ------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| 0   | Install                         | `bun install --frozen-lockfile`                                     | 1 min                             |
| 1   | Every project's build (web too) | `bun run build`                                                     | 2 min                             |
| 2   | Mac: native pieces              | see [Desktop for Mac](#desktop-for-mac)                             | 40 min, or seconds with a handoff |
| 3   | Mac: signed, notarized, audited | see [Signing](#signing): `desktop:make` then `desktop:audit:bundle` | 5 min, plus Apple's notary        |
| 4   | **This Mac**                    | `bun run desktop:deploy`                                            | seconds                           |
| 5   | **Google TV Streamer**          | `bun run app:deploy:android-tv`                                     | 20 min cold, 2 min warm           |
| 6   | **Apple TV**                    | `bun run app:deploy:tvos`                                           | 15 min cold                       |
| 7   | **Every iPhone and iPad**       | `bun run app:deploy:ios`                                            | 15 min cold                       |
| 8   | Windows                         | CI only, see [Desktop for Windows](#desktop-for-windows)            | Windows only                      |

Steps 4 to 7 are one command, `bun run deploy:devices` (`bun run --sequential desktop:deploy app:deploy:android-tv app:deploy:tvos app:deploy:ios`). `bun run --sequential` stops at the first failure, so when one deploy fails, fix it and run the ones after it on their own.

Before steps 5 to 7, export Android Studio's JDK: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. The shell's own `JAVA_HOME` is Homebrew's newest Java, which Gradle refuses, and the scripts default to Android Studio's only when the shell sets none.

Stop at the first failure and report it, unless the user said to keep going; then note it and run the next device. A device that is off or out of reach is not a failure of the others: say which one and go on.

## What each deploy does and needs

- **This Mac** (`apps/raven/desktop/scripts/deploy_mac.sh`): quits the running Raven, replaces `/Applications/Raven.app` with `out/Raven-darwin-arm64/Raven.app`, the one step 3 made, and opens it. It builds nothing, so it never replaces the signed build with an unsigned one; with no package it says to run `desktop:make` first. The data in `~/Library/Application Support/raven` stays. It prints `Raven <version> is on this Mac`.
- **Google TV Streamer** and **Apple TV**: the `deploy-tv-apps` skill holds the details (discovery, the adb relay, pairing, a sleeping Apple TV). They print `raven is on the Android TV` and `raven is on the Apple TV`.
- **iPhones and iPads** (`apps/raven/app/scripts/deploy_ios.sh`): reads the team off the keychain, regenerates `ios/` with it, builds one signed Release for `generic/platform=iOS` into `build/ios-device`, then installs and launches it on every paired physical iPhone and iPad `xcrun devicectl list devices` shows. A device out of reach for two minutes (`IOS_WAIT_SECONDS`) is skipped and named at the end; a locked one takes the install and opens once unlocked. `IOS_DEVICES="Morty Jr,Naruto Smith"` limits it. It ends with which devices have raven open, which have it installed and which were skipped.

All three device apps build the development variant (`APP_VARIANT=development`, plain http to a LAN server allowed); `APP_VARIANT=production bun run deploy:devices` builds the strict release. Never set `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN` for a device: that is the fixture build, which looks for a server on the device itself.

## Signing

Every build this skill makes is signed by the team **VF8PR3CHKX** (Chester Rivas, an Individual membership of the Apple Developer Program, so its Apple ID is the Account Holder).

**Raven for Mac is signed with the Developer ID and notarized.** Step 3 is:

```bash
export RAVEN_SIGN_IDENTITY="Developer ID Application: Chester Rivas (VF8PR3CHKX)"
export RAVEN_NOTARIZE_PROFILE=raven
bun run desktop:make
bun run desktop:audit:bundle
```

`forgeOptions.ts`'s `signingFrom` reads both: the identity signs the app with the hardened runtime through `osxSign`, and the profile has Forge send it to Apple's notary and staple the ticket. Notarizing waits on Apple, a few minutes as a rule. With `RAVEN_SIGN_IDENTITY` set, `audit:bundle` also asks Gatekeeper (`spctl`), so a pass is a build Gatekeeper accepts. To check by hand:

```bash
A=apps/raven/desktop/out/Raven-darwin-arm64/Raven.app
codesign --verify --deep --strict --verbose=2 "$A"   # valid on disk, satisfies its Designated Requirement
xcrun stapler validate "$A"                          # The validate action worked!
spctl -a -vvv -t exec "$A"                           # accepted, source=Notarized Developer ID
```

The dmg (`out/make/dmg/darwin/arm64/raven-player-<version>-arm64.dmg`) is not signed itself (`spctl` on it says `no usable signature`); the app inside carries its stapled ticket, which is what Gatekeeper checks once it is copied out. Without the two variables `desktop:make` signs ad hoc, which runs on this Mac (a local build has no quarantine) and nowhere else; `Unnotarized Developer ID` from `spctl` means the identity was set and the profile was not.

What the Mac holds for it, and how to set it up again on another Mac:

- **The certificate**, `Developer ID Application: Chester Rivas (VF8PR3CHKX)` in the login keychain with its private key (`security find-identity -v -p codesigning` lists it). Xcode's Manage Certificates refuses to make one ("This operation can only be performed by the Account Holder") even for the Account Holder, so make it on the website: a CSR from Keychain Access (Certificate Assistant, Request a Certificate From a Certificate Authority, saved to disk) or `openssl req -new -newkey rsa:2048 -nodes`, its key imported into the login keychain (`openssl rsa -traditional`, then `security import <key> -k ~/Library/Keychains/login.keychain-db -t priv -f openssl -T /usr/bin/codesign`); then developer.apple.com, Certificates, **+**, Developer ID Application, upload the CSR, download the `.cer` and add it to the **login** keychain. To move it to another Mac, export the identity as a `.p12` from Keychain Access.
- **The notary profile `raven`**, in the keychain through `xcrun notarytool store-credentials raven --key <.p8> --key-id <key id> --issuer <issuer id>`. The key is an App Store Connect **Team Key** with the Developer role (appstoreconnect.apple.com, Users and Access, Integrations, App Store Connect API); its `.p8` downloads once and lives in `~/.appstoreconnect/private_keys/`, mode 600. The Issuer ID is shown above the keys table. `xcrun notarytool history --keychain-profile raven` proves the profile works.
- **CI** signs a tagged release the same way once the repo has `RAVEN_DEVELOPER_ID_P12` (the exported `.p12`, base64), `RAVEN_DEVELOPER_ID_P12_PASSWORD`, `RAVEN_NOTARY_KEY` (the `.p8`), `RAVEN_NOTARY_KEY_ID` and `RAVEN_NOTARY_ISSUER_ID` (`.github/actions/raven-desktop-signing`). Setting secrets publishes them to GitHub, so only on the user's say-so.

**The Apple TV, iPhones and iPads are signed with Apple Development**, which the deploy scripts pick up themselves: they read the team off the keychain's Apple Development certificate and build with `-allowProvisioningUpdates`, so Xcode makes or renews the profiles (a year each on this paid team). That needs the Apple ID signed in to Xcode (Settings, Accounts); `No Accounts: Add a new account in Accounts settings` from `xcodebuild` means it is not, and only the user can sign in. A revoked Apple Development certificate beside a valid one is harmless.

Never put a key, a password or a `.p8` in the repo, a log line or a commit.

## Desktop for Mac

`desktop:make` runs `stage:mpv`, which copies libmpv and the addon from `libs/raven/mpv/resources/darwin-arm64`. Get them first:

1. If `libs/raven/mpv/resources/darwin-arm64/raven_mpv.node` exists, use it.
2. Otherwise `bun run ci:desktop:e2e` downloads CI's native handoff from a recent `native-checks.yml` run whose addon sources match this checkout and unpacks it in place (it needs `gh auth login`), then runs the desktop e2e.
3. If no run has a matching handoff, build them from source as the `raven-desktop-native` action does: `brew install cmake ninja meson pkgconf`, `xcodebuild -downloadComponent MetalToolchain` when `xcrun metal --version` fails, then `bunx nx run @raven/mpv:fetch:libmpv` and `bunx nx run @raven/mpv:build:native`. The `get-started` skill covers this toolchain.

Then `bun run mpv:native` audits them and runs the headless libmpv tests, as CI does.

## Desktop for Windows

A Mac cannot build it: the addon, libmpv and Forge's installer are all Windows x64. On a Windows x64 machine, from the repo root: `bun install --frozen-lockfile`, `bun run mpv:native:windows`, `bun run desktop:make`, `bun run desktop:audit:bundle`, `bun run desktop:smoke:packaged`; the installer lands in `apps/raven/desktop/out/make`. From the Mac the only way is a pull request's checks (`🎬 Build Raven Windows native`, `🎬 Build Raven Windows app`). Never report Windows as built after a Mac run.

## CI's checks, only when asked

The simulators, the emulator and the e2e suites are CI's checks, not this skill's job. Run them only when the user asks for the tests or for CI locally, and always after the devices have their builds, never in their place: `bun run web:e2e`, `bun run wren:web:e2e`, `bun run ci:desktop:e2e`, `bun run ci:app:ios`, `bun run ci:app:tvos`, `bun run ci:app:android-tv` (their skills: `run-desktop-e2e`, `run-ios-e2e`, `run-tvos-e2e`, `run-android-tv-e2e`). `desktop:smoke:packaged` launches the packaged Raven with the user's own profile and makes a real update check; say so before it. Shut down each simulator before the next (`xcrun simctl shutdown all`).

## Afterwards

Report per device: for the Mac, whether Gatekeeper accepted it as notarized; the branch and commit (`git log --oneline -1`), whether uncommitted changes went with it (`git status --short`), the variant, and whether its deploy printed its closing line (open, installed but not opened, or skipped and why). Name Windows as not built.

## Common mistakes

- Treating a `ci:app:*` run as a deploy: it installs the fixture build on a simulator or emulator, never on a device, and that build cannot reach a real server.
- Running two deploys, or a deploy and a `ci:app:*` script, at once: the prebuilds collide.
- Leaving the shell's Homebrew `JAVA_HOME` in place for the Android TV build.
- Asking before taking a TV or a phone over, or asking for a device's address: the scripts find them.
