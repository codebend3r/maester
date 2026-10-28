#!/usr/bin/env bash
# Runs the 🎬 Desktop end to end check from pull-request-checks.yml on this Mac:
# Playwright drives the unpackaged Raven against the fixture servers and fake Auth the
# tests start themselves. Without libmpv's addon, CI's native handoff is downloaded
# from a recent run. `xcodebuild -version` is in the target's Nx cache key, which is
# why DEVELOPER_DIR is set even though the tests never call Xcode.
#
#   bun run ci:desktop:e2e                         every step
#   bun run ci:desktop:e2e -- --skip-nx-cache      the tests for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci.sh
source "$(dirname "$0")/local_ci.sh"

FAILURE_HINT='Playwright traces: apps/raven/desktop/test-results (bunx playwright show-trace <trace.zip>)'
SOURCE_FFMPEG=libs/raven/mpv/native-build/prefix/bin/ffmpeg

step 'Tools'
require_apple_silicon
require_xcode
brew_install ffmpeg ffmpeg

step 'Install'
bun install --frozen-lockfile

step 'libmpv'
if [ -f libs/raven/mpv/resources/darwin-arm64/raven_mpv.node ]; then
  echo 'Using libs/raven/mpv/resources/darwin-arm64'
else
  brew_install gh gh
  gh auth status > /dev/null || { echo 'Sign in to GitHub first: gh auth login' >&2; exit 1; }
  # The handoff CI's desktop-native job packs lives one day, so the newest run that has it wins.
  found=''
  while read -r id sha; do
    if gh run download "$id" -n "raven-native-handoff-$sha" -D "$WORK" > /dev/null 2>&1; then
      tar -xf "$WORK/raven-native-handoff.tar"
      echo "Unpacked the handoff from run $id"
      found=yes
      break
    fi
  done < <(gh run list --workflow pull-request-checks.yml --limit 20 --json databaseId,headSha --jq '.[] | "\(.databaseId) \(.headSha)"')
  if [ -z "$found" ]; then
    echo 'No run from the last day has the libmpv handoff. Build it with bun run mpv:native (the full native toolchain, see the get-started skill).' >&2
    exit 1
  fi
fi

# The ffmpeg that makes the test clips: CI's source-built one when the handoff brought it.
if [ -x "$SOURCE_FFMPEG" ]; then
  export RAVEN_E2E_FFMPEG="$PWD/$SOURCE_FFMPEG"
else
  RAVEN_E2E_FFMPEG="$(command -v ffmpeg)"
  export RAVEN_E2E_FFMPEG
fi

step 'Desktop end to end'
bunx nx run @raven/desktop:e2e "$@"
