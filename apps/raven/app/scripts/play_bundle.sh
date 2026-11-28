#!/usr/bin/env bash
# Builds the production raven for Google Play as an App Bundle signed with the upload key, for
# Android TV or for Android phones, ready to upload in Play Console.
#
#   bun run app:play:android-tv
#   bun run app:play:android
#
# The key is `play_upload_key.sh`'s, its password read from the Keychain (or
# RAVEN_UPLOAD_PASSWORD). It reaches Gradle as ORG_GRADLE_PROJECT_ properties, which
# `plugins/withUploadSigning.ts` signs the release with; nothing secret is on a command line.
#
# Play wants a versionCode above every earlier upload of the app, the TV's and the phone's alike,
# since both are one listing, and at most 2100000000, so it is the build's UTC minute as
# yy, day of the year, hour and minute (`263311742`), passed to app.config.ts as the run
# number CI would pass. TestFlight's yymmddHHMM is too large for Android. It is set even in CI,
# where Actions' own GITHUB_RUN_NUMBER counts runs and would fall below every earlier upload.
set -euo pipefail
source "$(dirname "$0")/play_key.sh"
cd "$(dirname "$0")/.."

PLATFORM="${1:?say which platform: android-tv or android}"
case "$PLATFORM" in
  android-tv | android) ;;
  *)
    echo "Unknown platform '$PLATFORM': android-tv or android." >&2
    exit 1
    ;;
esac

[ -f "$STORE_FILE" ] || { echo "No upload key at $STORE_FILE: run bun run app:play:upload-key first." >&2; exit 1; }
RAVEN_UPLOAD_PASSWORD="${RAVEN_UPLOAD_PASSWORD:-$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w)}"
export RAVEN_UPLOAD_PASSWORD
FINGERPRINT="$(key_fingerprint)"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export APP_VARIANT=production
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=
export ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a,armeabi-v7a
GITHUB_RUN_NUMBER="$(date -u +%y%j%H%M)"
export GITHUB_RUN_NUMBER

VERSION="$(bun -e 'console.log(require("./package.json").version)')"
OUT="build/play-$PLATFORM"
BUNDLE="$OUT/raven-app-$VERSION-$GITHUB_RUN_NUMBER-$PLATFORM.aab"

say "Regenerating the $PLATFORM project (production variant, versionCode $GITHUB_RUN_NUMBER)"
bun run "prebuild:$PLATFORM"

say "Building the release bundle"
ORG_GRADLE_PROJECT_RAVEN_UPLOAD_STORE_FILE="$STORE_FILE" ORG_GRADLE_PROJECT_RAVEN_UPLOAD_KEY_ALIAS="$KEY_ALIAS" \
  ORG_GRADLE_PROJECT_RAVEN_UPLOAD_PASSWORD="$RAVEN_UPLOAD_PASSWORD" ./android/gradlew -p android bundleRelease

rm -rf "$OUT"
mkdir -p "$OUT"
cp android/app/build/outputs/bundle/release/app-release.aab "$BUNDLE"

# A bundle still signed with the debug key would be refused by Play, so stop here instead.
SIGNED_BY="$("$KEYTOOL" -printcert -jarfile "$BUNDLE" | sha256_of)"
if [ "$SIGNED_BY" != "$FINGERPRINT" ]; then
  echo "$BUNDLE is signed by $SIGNED_BY, not the upload key ($FINGERPRINT)." >&2
  exit 1
fi

say "Signed bundle at $(pwd)/$BUNDLE ($(du -h "$BUNDLE" | cut -f1)), version $VERSION ($GITHUB_RUN_NUMBER)"
