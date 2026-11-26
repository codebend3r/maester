#!/usr/bin/env bash
# Puts the APK `build:android-tv` made on the real Android TV and opens it, through raven's deploy
# script, which takes the app from the environment and does the rest: the TV found over mDNS, the
# adb relay, the wait for the TV to accept, the install over the Wren there and the launch.
#
#   bun run wren:tv:deploy:android-tv       # from the repo root; the development variant
#   ANDROID_TV=192.168.50.62:5555 ...       # skip discovery; the port is 5555 unless given
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export APP_DIR
export APP_LABEL=Wren
export ANDROID_APP_ID=app.netlify.wren.tv

exec "$APP_DIR/../../raven/app/scripts/deploy_android_tv.sh"
