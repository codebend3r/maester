#!/usr/bin/env bash
# Builds raven for a real Apple TV and puts it there, with nothing to click in Xcode: finds the
# Apple Development team on this Mac's keychain, regenerates the tvOS project with that team
# written in (APPLE_TEAM_ID, read by app.config.ts), builds the signed Release, waits for the
# paired Apple TV to be reachable, installs the app and launches it.
#
#   bun run app:deploy:tvos                 # the development variant (plain http to a LAN server)
#   APP_VARIANT=production bun run app:deploy:tvos
#   APPLE_TV=<name or UDID> ...             # which Apple TV, when more than one is paired
#
# The Apple TV must already be paired with this Mac (Xcode's Devices window, or
# `xcrun devicectl manage pair`), and a signing certificate must be in the keychain (sign in
# to Xcode once). A Personal Team's profile lasts seven days; run this again to renew it.
set -euo pipefail
source "$(dirname "$0")/apple_team.sh"
cd "$(dirname "$0")/.."

export APP_VARIANT="${APP_VARIANT:-development}"
BUNDLE_ID=io.github.codebend3r.raven.app
DERIVED=build/tvos-device
APP="$DERIVED/Build/Products/Release-appletvos/Raven.app"

# The paired Apple TV's hardware UDID, which xcodebuild and devicectl both take. A pairing id
# (36 characters) is not a destination; the hardware one is 40 hex characters.
apple_tv() {
  local wanted="${APPLE_TV:-}"
  xcrun devicectl list devices --hide-headers 2>/dev/null \
    | awk -v wanted="$wanted" '
        /AppleTV/ && / physical/ {
          udid = ""
          for (i = 1; i <= NF; i++) if ($i ~ /^[0-9a-f]{40}$/) udid = $i
          if (udid == "") next
          if (wanted == "" || index($0, wanted) > 0) { print udid; exit }
        }'
}

require_team "No Apple Development certificate in the keychain: sign in to Xcode (Settings > Accounts) once." "Apple Development"

UDID="$(apple_tv)"
if [ -z "$UDID" ]; then
  echo "No paired Apple TV: pair it in Xcode's Devices window, or 'xcrun devicectl manage pair --device <name>'." >&2
  exit 1
fi

say "Regenerating the tvOS project for team $TEAM ($APP_VARIANT variant)"
bun run prebuild:tvos

say "Building the signed Release"
xcodebuild -workspace ios/Raven.xcworkspace -scheme Raven -configuration Release \
  -destination 'generic/platform=tvOS' -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build -quiet

say "Waiting for the Apple TV ($UDID)"
until xcrun devicectl list devices 2>/dev/null | grep "$UDID" | grep -qwE 'available|connected'; do
  sleep 10
done

say "Installing"
xcrun devicectl device install app --device "$UDID" "$APP" --quiet

say "Launching"
# A sleeping Apple TV takes the install but refuses a foreground launch, and nothing here wakes it.
if ! launch_log="$(xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" --quiet 2>&1)"; then
  case "$launch_log" in
    *"System is asleep"*)
      say "raven is installed on the Apple TV, which is asleep: it opens once the TV is woken"
      exit 0
      ;;
    *)
      printf '%s\n' "$launch_log" >&2
      exit 1
      ;;
  esac
fi
say "raven is on the Apple TV"
