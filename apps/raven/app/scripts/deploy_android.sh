#!/usr/bin/env bash
# Puts the APK `build:android` made (the Nx target this one depends on) on the Android phone or
# emulator adb sees and opens it: installs over the raven that is there (-r keeps its sign-in and
# settings), launches it and checks it is in front. With more than one device attached,
# ANDROID_SERIAL names the one (`adb devices` lists them). An end to end build reaches the
# fixture server on the computer's loopback through `adb reverse`, so this sets that up too.
#
#   bun run app:deploy:android                 # from the repo root; the development variant
#   APP_VARIANT=production bun run app:deploy:android
#   ANDROID_SERIAL=emulator-5554 bun run app:deploy:android
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android_apk.sh

FIXTURE_PORT=8490

require_apk_and_adb build:android

say "Waiting for the device"
"$ADB" wait-for-device

say "Relaying the fixture server's port, for an end to end build"
"$ADB" reverse "tcp:$FIXTURE_PORT" "tcp:$FIXTURE_PORT"

install_apk

say "Launching"
launch_in_front "the Android phone"
