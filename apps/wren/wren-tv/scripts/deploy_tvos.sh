#!/usr/bin/env bash
# Builds Wren on TV for the paired Apple TV and puts it there, through raven's deploy script, which
# takes the app it builds from the environment and does the rest: the team off the keychain, the
# regenerated tvOS project, the signed Release, the wait for the TV, the install and the launch.
#
#   bun run wren:tv:deploy:tvos             # the development variant (plain http to a LAN server)
#   APP_VARIANT=production bun run wren:tv:deploy:tvos
#   APPLE_TV=<name or UDID> ...             # which Apple TV, when more than one is paired
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export APP_DIR
export APP_NAME=Wren
export APP_LABEL=Wren
export TV_BUNDLE_ID=app.netlify.wren.tv

exec "$APP_DIR/../../raven/app/scripts/deploy_tvos.sh"
