#!/usr/bin/env bash
# Runs the 🎵 Build Wren Android TV job and its end to end job on this Mac, as raven's
# ci_app_android_tv.sh does for raven: the libraries, the fixture server, the Android TV emulator
# (the same raven_tv AVD), Wren on TV's Release APK, the install and the Maestro flows the remote
# drives. Each step is a root script of its own, which the whole job runs in order:
#
#   bun run ci:wren:tv:android-tv                       every step
#   bun run ci:wren:tv:android-tv -- --skip-nx-cache    the flows for real, even on a cached pass
#   bun run ci:wren:tv:android-tv:build                 the Release APK
#   bun run ci:wren:tv:android-tv:install               installs the APK on the emulator
#   bun run ci:wren:tv:android-tv:e2e                   the Maestro flows (takes --skip-nx-cache)
set -euo pipefail

JOB=ci:wren:tv:android-tv
DEVICE='Android TV'
AVD=raven_tv
IMAGE='system-images;android-36;android-tv;arm64-v8a'
# CI's profile, 960 by 540 dp, with CI's 4 GiB.
PROFILE=tv_1080p
BUILD_SCRIPT=wren:tv:build:android-tv
E2E_SCRIPT=wren:tv:e2e:android-tv
APK=apps/wren/wren-tv/android/app/build/outputs/apk/release/app-release.apk
APP_ID=app.netlify.wren.tv

# shellcheck source=scripts/local_ci_android.sh
source "$(dirname "$0")/local_ci_android.sh"

run_steps "$@"
