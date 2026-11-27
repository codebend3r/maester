#!/usr/bin/env bash
# Runs the 🎬 Build Raven Android phone job and its end to end job on this Mac: the libraries, the fixture server, the Android phone emulator, the Release APK through
# ccache, the install and the Maestro flows a finger drives. The flows always run on the AVD
# raven_phone, never on a phone attached over adb or on the Android TV emulator
# (local_ci_android.sh). Each step is a root script of its own, which the whole job runs in
# order:
#
#   bun run ci:app:android                         every step
#   bun run ci:app:android -- --skip-nx-cache      the flows for real, even on a cached pass
#   bun run ci:app:android:tools                   Android Studio, the SDK, the phone image, Maestro
#   bun run ci:app:install                         bun install
#   bun run ci:app:libraries                       the libraries' build
#   bun run ci:app:fixture                         the fixture server, in the foreground
#   bun run ci:app:android:emulator                starts the Android phone emulator
#   bun run ci:app:android:build                   the Release APK
#   bun run ci:app:android:emulator:wait           waits for the emulator to boot
#   bun run ci:app:android:install                 installs the APK on the emulator
#   bun run ci:app:fixture:wait                    waits for the fixture server
#   bun run ci:app:android:e2e                     the Maestro flows (takes --skip-nx-cache)
set -euo pipefail

JOB=ci:app:android
DEVICE='Android phone'
AVD=raven_phone
IMAGE='system-images;android-36;google_apis;arm64-v8a'
PROFILE=pixel_7
BUILD_SCRIPT=app:build:android
E2E_SCRIPT=app:e2e:android

# shellcheck source=scripts/local_ci_android.sh
source "$(dirname "$0")/local_ci_android.sh"

run_steps "$@"
