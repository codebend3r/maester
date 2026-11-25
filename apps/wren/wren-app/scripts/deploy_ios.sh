#!/usr/bin/env bash
# Builds Wren for real iPhones and iPads and puts it on every one paired with this Mac, through
# raven's deploy script, which takes the app it builds from the environment and does the rest:
# the team off the keychain, the regenerated iOS project, one signed Release, an install and a
# launch per device.
#
#   bun run wren:deploy:ios                 # the development variant (plain http to a LAN server)
#   APP_VARIANT=production bun run wren:deploy:ios
#   IOS_DEVICES="<name or UDID>,..." ...    # only these, when not every paired one
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export APP_DIR
export APP_NAME=Wren
export APP_LABEL=Wren
export IOS_BUNDLE_ID=app.netlify.wren

exec "$APP_DIR/../../raven/app/scripts/deploy_ios.sh"
