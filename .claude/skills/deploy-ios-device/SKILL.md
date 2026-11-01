---
name: deploy-ios-device
description: Use when building and installing raven on a physical iPad or iPhone connected to the Mac by cable, including "deploy to my iPad", "install on my iPhone", "build for my connected iPad", or "run without Metro". Covers generating the iOS project, Xcode device selection, Apple signing, Developer Mode, and a standalone Release build. Not for simulators, TestFlight, or App Store distribution.
---

# Deploy raven to a connected iPad or iPhone

Build `@raven/app` for a physical Apple device through Xcode. Default to a Release build that runs without Metro or the cable. This is raven, not Wren (`@raven/music`).

Read the root `CLAUDE.md`, `apps/raven/CLAUDE.md`, `apps/raven/app/CLAUDE.md`, and the app's current `package.json` before running commands. Use the repository's `get-started` skill for missing tools.

If the user asks how, give these steps. If asked to perform the deployment, run the terminal steps and let the user complete Apple Account sign-in, device trust, Developer Mode and signing choices. Never request passwords or claim installation succeeded without verifying it.

## 1. Prepare the Mac and device

- Full Xcode, CocoaPods, the workspace's Bun and Node versions, and installed workspace dependencies are required. Run `bun install --frozen-lockfile` from the checkout root if dependencies are missing.
- Connect and unlock the iPad or iPhone. Accept **Trust This Computer** on the device.
- Xcode's **Window > Devices and Simulators** should list it as connected and ready. Let Xcode finish pairing and preparing device support.
- Enable **Settings > Privacy & Security > Developer Mode** on the device if requested, then restart and confirm it.
- Do not change the machine's `xcode-select`, download large Xcode components, or sign in as the user without approval.

### Check readiness from the terminal

With `DEVELOPER_DIR` set to the Xcode installation for each shell call:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl list devices
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device info details --device <ipad-udid>
security find-identity -v -p codesigning
```

Select the physical iPad by its UDID, not whichever device is first: an iPhone and simulators may also be listed. The details report the model, OS version, wired transport, pairing and Developer Mode. `available (paired)` in the list does not prove readiness: on a wired iPad Pro running iOS 26.7, details reported Developer Mode Disabled and warned it could not retrieve complete information. Ask the user to enable it, restart, confirm and unlock; recheck details before installation or launch. Prebuild can proceed while they do this.

During the restart, details can still show the previous Developer Mode Disabled value while the connection is `unavailable`. Wait for reconnection, have the user confirm the post-restart Developer Mode prompt and unlock the device, then query details again; do not treat that stale value as a failed setting change.

A valid Apple Development identity is necessary but does not prove that the app has a team or provisioning profile. Ask the user to choose the team in Xcode rather than infer one from the certificate's display name. With no valid identity, the user must configure their Apple Account and signing first.

## 2. Generate the iOS project

From the checkout root:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
APP_VARIANT=development \
bunx nx run @raven/app:prebuild:ios
```

Use the user's `DEVELOPER_DIR` instead if Xcode is elsewhere. Nx builds the shared libraries first. The development variant permits plain HTTP to a local or LAN server; it does not force a Debug build.

Do not set `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN` for normal use: that is for accountless fixture tests, and `127.0.0.1` on the iPad is the iPad, not the Mac.

Check that CocoaPods completed:

```bash
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock
```

No output and exit 0 means the locks match. Expo can exit successfully after a pod-install failure, so resolve a mismatch before building.

The prebuild regenerates `ios/`. Do not run an iOS and tvOS prebuild concurrently, or run another prebuild after configuring signing below.

## 3. Open Xcode and configure signing

```bash
open apps/raven/app/ios/Raven.xcworkspace
```

Open the workspace, not `Raven.xcodeproj`.

1. Select the **Raven** scheme and the connected device as the run destination, not an iPad simulator or a generic destination.
2. Select the **Raven** app target, then **Signing & Capabilities**.
3. Enable **Automatically manage signing** and choose the user's Apple development team.
4. If no team is available, have the user add their Apple Account in **Xcode > Settings > Accounts**.
5. If Xcode cannot provision the bundle identifier, explain the conflict and ask before changing it. A different identifier installs a separate app with separate data.

Before a terminal build, check that the user's team selection reached both Debug and Release in `apps/raven/app/ios/Raven.xcodeproj/project.pbxproj` (`DEVELOPMENT_TEAM`). A certificate alone does not configure this. Xcode can still show an iPhone simulator in the top toolbar while the correct app target's signing pane is open: have the user select the physical iPad there for Command-R. A terminal build instead selects it explicitly by UDID.

Local signing selections in this generated project are temporary. Do not edit tracked Expo configuration or add credentials just to preserve them unless asked.

## 4. Build, install and launch a standalone app

1. Open **Product > Scheme > Edit Scheme > Run > Info**.
2. Set **Build Configuration** to **Release** so the JavaScript bundle is embedded and Metro is unnecessary.
3. Press **Command-R**. Xcode builds for the device, signs, installs and launches raven.
4. If the device refuses an untrusted developer, follow its prompt under **Settings > General > VPN & Device Management** to trust the user's developer identity, then run again.
5. Verify raven opens past the splash, then disconnect the cable and relaunch it to confirm it is standalone.

Sign in normally. For a backend on the Mac, use the Mac's reachable LAN address, never `localhost` or `127.0.0.1`. A cable installation does not by itself forward the Mac's server ports to the device. Allow Local Network access if prompted.

## Pitfalls

- `app:build:ios` currently builds with `-sdk iphonesimulator` and disables normal device signing. Its output cannot be installed on a physical iPad.
- `app:dev:ipad` currently selects the simulator named `raven-pad`, not the connected device.
- `simctl install` installs on simulators only. Use Xcode for this workflow.
- A Debug build generally needs Metro; use Release for an app that works after disconnecting.
- A free Personal Team provisioning profile normally expires after seven days; rebuild and reinstall when it expires. Paid-team provisioning follows its own profile expiry.
- Another clean prebuild wipes signing changes made only in Xcode. Reapply them after regeneration.
- Do not uninstall an existing app as a troubleshooting shortcut: uninstalling can remove its local data. Ask first.

## Optional terminal build and installation

After the user has configured signing, the remaining steps can run from the terminal. Do not substitute a simulator build or disable signing to get past a provisioning error.

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -workspace apps/raven/app/ios/Raven.xcworkspace \
  -scheme Raven -configuration Release \
  -destination 'id=<ipad-udid>' \
  -derivedDataPath apps/raven/app/build/device build
```

A cold device build compiles the native dependencies again; the simulator build is not reusable as an installable device app. Run a long build in the background with a log and its exit status saved, and check both the exit status and `BUILD SUCCEEDED` before installing. Keep the iPad connected and unlocked, and do not start a second Xcode build while this one runs.

If provisioning requires account access or device registration, explain the error and let the user resolve it in Xcode. Do not silently add provisioning-update flags or switch bundle identifiers or teams.

Only after a successful signed device build:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun devicectl device install app --device <ipad-udid> \
  apps/raven/app/build/device/Build/Products/Release-iphoneos/Raven.app

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun devicectl device process launch --device <ipad-udid> \
  io.github.codebend3r.raven.app
```

If installation succeeds but launch returns `CoreDeviceError 10002`, `FBSOpenApplicationErrorDomain` with `Security`, and says the signature, entitlements or profile trust is invalid, do not assume the build is broken. Check the local bundle first:

```bash
codesign --verify --deep --strict --verbose=2 \
  apps/raven/app/build/device/Build/Products/Release-iphoneos/Raven.app
```

A successful verification does not prove device provisioning is valid, but this happened with a successfully signed and installed build before the developer was trusted. Have the user open **Settings > General > VPN & Device Management**, select their developer identity and trust it, following any internet verification or restart prompt. Then retry launch without rebuilding or uninstalling. If trust is already granted and launch still fails, inspect provisioning and entitlements instead of disabling signing.

A launch command succeeding proves process launch, not that the screen got past the splash or that sign-in and playback work. Have the user check those and manually relaunch after disconnecting. Keep separate results for each verification.

## Report

State the device, build configuration, and whether build, installation, launch and cable-free relaunch were actually verified. Name any signing or device step left for the user. Creating this skill or explaining the steps does not authorize a build, deployment, commit or push.
