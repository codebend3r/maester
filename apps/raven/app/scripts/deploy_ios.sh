#!/usr/bin/env bash
# Builds raven for real iPhones and iPads and puts it on every one paired with this Mac, with
# nothing to click in Xcode: finds the Apple Development team on the keychain, regenerates the
# iOS project with that team written in (APPLE_TEAM_ID, read by app.config.ts), builds one signed
# Release for any iOS device, then installs and launches it on each paired iPhone and iPad.
#
#   bun run app:deploy:ios                  # the development variant (plain http to a LAN server)
#   APP_VARIANT=production bun run app:deploy:ios
#   IOS_DEVICES="<name or UDID>,..." ...    # only these, when not every paired one
#
# Each device must already be paired (Xcode's Devices window) with Developer Mode on, and a
# signing certificate must be in the keychain (sign in to Xcode once). A Personal Team's profile
# lasts seven days; run this again to renew it. A device that is not reachable within
# IOS_WAIT_SECONDS (120 by default) is skipped and named at the end, so one iPad left in a drawer
# never holds the others back.
set -euo pipefail
cd "$(dirname "$0")/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export APP_VARIANT="${APP_VARIANT:-development}"
BUNDLE_ID=io.github.codebend3r.raven.app
DERIVED=build/ios-device
APP="$DERIVED/Build/Products/Release-iphoneos/Raven.app"
WAIT_SECONDS="${IOS_WAIT_SECONDS:-120}"

say() { printf '\n==> %s\n' "$*"; }

# The team is the OU of the Apple Development certificate, the one field that names it.
team_id() {
  security find-certificate -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1
}

# Every paired physical iPhone and iPad as "UDID<tab>name", the hardware UDID being what
# xcodebuild and devicectl take (00008112-000170223A45401E, or 40 hex characters on older ones).
ios_devices() {
  local wanted="${IOS_DEVICES:-}"
  xcrun devicectl list devices --hide-headers 2>/dev/null \
    | awk -v wanted="$wanted" '
        /\((iPhone|iPad)[0-9]+,[0-9]+\)/ && / physical/ {
          udid = ""; at = 0
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/ || $i ~ /^[0-9a-f]{40}$/) { udid = $i; at = i; break }
          }
          if (udid == "") next
          name = $1
          for (i = 2; i < at; i++) if ($i !~ /^[a-z0-9.-]+\.local$/) name = name " " $i
          if (wanted != "") {
            hit = 0; n = split(wanted, names, ",")
            for (j = 1; j <= n; j++) if (names[j] == udid || names[j] == name) hit = 1
            if (!hit) next
          }
          print udid "\t" name
        }'
}

is_reachable() {
  xcrun devicectl list devices 2>/dev/null | grep "$1" | grep -qwE 'available|connected'
}

TEAM="${APPLE_TEAM_ID:-$(team_id)}"
if [ -z "$TEAM" ]; then
  echo "No Apple Development certificate in the keychain: sign in to Xcode (Settings > Accounts) once." >&2
  exit 1
fi
export APPLE_TEAM_ID="$TEAM"

DEVICES="$(ios_devices)"
if [ -z "$DEVICES" ]; then
  echo "No paired iPhone or iPad: pair one in Xcode's Devices window." >&2
  exit 1
fi
say "Deploying to: $(printf '%s\n' "$DEVICES" | cut -f2 | paste -sd ',' - | sed 's/,/, /g')"

say "Regenerating the iOS project for team $TEAM ($APP_VARIANT variant)"
bun run prebuild:ios

say "Building the signed Release"
xcodebuild -workspace ios/Raven.xcworkspace -scheme Raven -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build -quiet

deployed=()
installed=()
skipped=()
while IFS=$'\t' read -r udid name; do
  say "Waiting for $name ($udid)"
  waited=0
  until is_reachable "$udid"; do
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      break
    fi
    sleep 10
    waited=$((waited + 10))
  done
  if ! is_reachable "$udid"; then
    say "$name is not reachable: skipped"
    skipped+=("$name")
    continue
  fi

  say "Installing on $name"
  # iOS refuses an install to a device that has not been unlocked recently, and says so.
  if ! install_log="$(xcrun devicectl device install app --device "$udid" "$APP" --quiet 2>&1)"; then
    case "$install_log" in
      *"still locked"* | *"not been unlocked"*)
        say "$name is locked: unlock it and run this again"
        skipped+=("$name (locked)")
        ;;
      *)
        printf '%s\n' "$install_log" >&2
        say "The install on $name failed: skipped"
        skipped+=("$name")
        ;;
    esac
    continue
  fi

  say "Launching on $name"
  # A locked device takes the install but refuses a foreground launch until it is unlocked.
  if launch_log="$(xcrun devicectl device process launch --device "$udid" "$BUNDLE_ID" --quiet 2>&1)"; then
    deployed+=("$name")
    continue
  fi
  case "$launch_log" in
    *[Ll]ocked*)
      installed+=("$name")
      ;;
    *)
      printf '%s\n' "$launch_log" >&2
      installed+=("$name")
      ;;
  esac
done <<<"$DEVICES"

[ "${#deployed[@]}" -gt 0 ] && say "raven is open on: ${deployed[*]}"
[ "${#installed[@]}" -gt 0 ] && say "raven is installed but not opened (locked or refused) on: ${installed[*]}"
[ "${#skipped[@]}" -gt 0 ] && say "Not deployed (unreachable or the install failed): ${skipped[*]}"
if [ "${#deployed[@]}" -eq 0 ] && [ "${#installed[@]}" -eq 0 ]; then
  exit 1
fi
exit 0
