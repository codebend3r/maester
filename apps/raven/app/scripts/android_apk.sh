#!/usr/bin/env bash
# What the two Android deploys share, sourced by `deploy_android.sh` and `deploy_android_tv.sh`
# from the app's folder: where adb and the Release APK are, and the install and launch steps.
# adb acts on the device ANDROID_SERIAL names, or on the only one attached.

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
APK=android/app/build/outputs/apk/release/app-release.apk
APP_ID="${ANDROID_APP_ID:-io.github.codebend3r.raven.app}"
APP_LABEL="${APP_LABEL:-raven}"

say() { printf '\n==> %s\n' "$*"; }

# Stops unless the APK and adb are there; $1 is the build target that makes the APK.
require_apk_and_adb() {
  [ -f "$APK" ] || { echo "No APK at $APK: run $1 first (the deploy target depends on it)." >&2; exit 1; }
  [ -x "$ADB" ] || { echo "No adb at $ADB: install the Android SDK platform tools (the get-started skill)." >&2; exit 1; }
}

# Installs over the raven that is there: -r keeps its sign-in and settings.
install_apk() {
  say "Installing $APK ($(du -h "$APK" | cut -f1))"
  "$ADB" install -r "$APK"
}

# Opens raven and checks it is in front; $1 names the device in what is said.
launch_in_front() {
  local front
  "$ADB" shell am start -W -n "$APP_ID/.MainActivity" > /dev/null
  front="$("$ADB" shell dumpsys activity activities | grep -m1 topResumedActivity || true)"
  case "$front" in
    *"$APP_ID"*) say "$APP_LABEL is on $1" ;;
    *) echo "$APP_LABEL was installed but is not in front: $front" >&2; exit 1 ;;
  esac
}
