#!/usr/bin/env bash
# Runs the 🎵 Build Wren Android job and its end to end job on this Mac, as raven's
# ci_app_android.sh does for raven: the libraries, the fixture server, an Android phone emulator
# of Wren's own, Wren's Release APK, the install and the Maestro flows. Each step is a root
# script of its own, which the whole job runs in order:
#
#   bun run ci:wren:android                       every step
#   bun run ci:wren:android -- --skip-nx-cache    the flows for real, even on a cached pass
#   bun run ci:wren:android:tools                 Android Studio, the SDK, the phone image, Maestro
#   bun run ci:wren:android:emulator              starts the Android phone emulator
#   bun run ci:wren:android:build                 the Release APK
#   bun run ci:wren:android:emulator:wait         waits for the emulator to boot
#   bun run ci:wren:android:install               installs the APK on the emulator
#   bun run ci:wren:android:e2e                   the Maestro flows (takes --skip-nx-cache)
set -euo pipefail

JOB=ci:wren:android
DEVICE='Android phone'
AVD=wren_phone
IMAGE='system-images;android-36;google_apis;arm64-v8a'
PROFILE=pixel_7
BUILD_SCRIPT=wren:build:android
E2E_SCRIPT=wren:e2e:android
APK=apps/wren/wren-app/android/app/build/outputs/apk/release/app-release.apk
APP_ID=app.netlify.wren

# shellcheck source=scripts/local_ci_android.sh
source "$(dirname "$0")/local_ci_android.sh"

run_steps "$@"
