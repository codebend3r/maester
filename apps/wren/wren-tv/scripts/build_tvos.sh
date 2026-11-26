#!/usr/bin/env bash
# Builds Wren on TV's Release for the Apple TV simulator through raven's build script, which takes
# the app it builds from the environment and shows the build's progress in brief.
#
#   bun run wren:tv:build:tvos     through Nx, with its dependencies
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export APP_DIR
export APP_NAME=Wren

exec "$APP_DIR/../../raven/app/scripts/build_tvos.sh"
