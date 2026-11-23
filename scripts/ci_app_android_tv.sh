#!/usr/bin/env bash
# Runs the 🏗️ Build Android TV job and its end to end job, which CI runs on two runners, on
# this Mac: the libraries, the fixture server, the Android TV emulator, the Release APK through
# ccache, the install and the Maestro flows the remote drives. The emulator is arm64 here, where
# CI's is x86_64 on KVM, and the flows run on the AVD raven_tv alone (local_ci_android.sh).
# Each step is a root script of its own, which the whole job runs in order:
#
#   bun run ci:app:android-tv                         every step
#   bun run ci:app:android-tv -- --skip-nx-cache      the flows for real, even on a cached pass
#   bun run ci:app:android-tv:tools                   Android Studio, the SDK, the TV image, Maestro
#   bun run ci:app:install                            bun install
#   bun run ci:app:libraries                          the libraries' build
#   bun run ci:app:fixture                            the fixture server, in the foreground
#   bun run ci:app:android-tv:emulator                starts the Android TV emulator
#   bun run ci:app:android-tv:build                   the Release APK
#   bun run ci:app:android-tv:emulator:wait           waits for the emulator to boot
#   bun run ci:app:android-tv:install                 installs the APK on the emulator
#   bun run ci:app:fixture:wait                       waits for the fixture server
#   bun run ci:app:android-tv:e2e                     the Maestro flows (takes --skip-nx-cache)
set -euo pipefail

JOB=ci:app:android-tv
DEVICE='Android TV'
AVD=raven_tv
IMAGE='system-images;android-36;android-tv;arm64-v8a'
# CI's profile, 960 by 540 dp, with CI's 4 GiB.
PROFILE=tv_1080p
BUILD_SCRIPT=app:build:android-tv
E2E_SCRIPT=app:e2e:android-tv

# shellcheck source=scripts/local_ci_android.sh
source "$(dirname "$0")/local_ci_android.sh"

run_steps "$@"
