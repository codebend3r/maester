#!/usr/bin/env bash
# Archives the production raven for the iPhone and iPad, or for the Apple TV, and uploads it to
# App Store Connect, where it lands in TestFlight once Apple has processed it (5 to 30 minutes).
#
#   bun run app:testflight:ios
#   bun run app:testflight:tvos
#
# Signing is Xcode's automatic, cloud-managed signing for the paid team: the archive is signed
# for development and the export signs it again with an Apple Distribution certificate and an
# App Store profile, both of which Xcode makes the first time. It authenticates with the App
# Store Connect API key when apple_team.sh's asc_auth finds an issuer (ASC_KEY_ISSUER_ID, or
# ~/.appstoreconnect/issuer_id), and with the Apple ID signed in to Xcode otherwise. The app
# record (bundle id io.github.codebend3r.raven.app, with the tvOS platform added for the Apple
# TV) must already exist in App Store Connect: the API cannot create one.
#
# Every upload of a version needs a build number above the last, so the build number is the
# time of the build (yymmddHHMM), passed to app.config.ts as the run number CI would pass.
set -euo pipefail
source "$(dirname "$0")/apple_team.sh"
cd "$(dirname "$0")/.."

PLATFORM="${1:?say which platform: ios or tvos}"
case "$PLATFORM" in
  ios)
    PREBUILD=prebuild:ios
    DESTINATION='generic/platform=iOS'
    ;;
  tvos)
    PREBUILD=prebuild:tvos
    DESTINATION='generic/platform=tvOS'
    ;;
  *)
    echo "Unknown platform '$PLATFORM': ios or tvos." >&2
    exit 1
    ;;
esac

export APP_VARIANT=production
export GITHUB_RUN_NUMBER="${GITHUB_RUN_NUMBER:-$(date +%y%m%d%H%M)}"
OUT="build/testflight-$PLATFORM"
ARCHIVE="$OUT/Raven.xcarchive"

# The paid team is read off its Apple Distribution or Developer ID certificate; a Personal Team's
# Apple Development one cannot upload.
require_team "No paid team found: set APPLE_TEAM_ID, or install the team's Developer ID or Apple Distribution certificate." \
  "Apple Distribution" "Developer ID Application"

asc_auth

say "Regenerating the $PLATFORM project for team $TEAM (production variant, build $GITHUB_RUN_NUMBER)"
bun run "$PREBUILD"

rm -rf "$OUT"
mkdir -p "$OUT"

say "Archiving"
xcodebuild -workspace ios/Raven.xcworkspace -scheme Raven -configuration Release \
  -destination "$DESTINATION" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic archive -quiet

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>teamID</key>
  <string>$TEAM</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

say "Uploading to App Store Connect"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

say "Build $GITHUB_RUN_NUMBER is uploaded: it shows in TestFlight once App Store Connect has processed it"
