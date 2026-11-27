#!/usr/bin/env bash
# Puts the Wren that `make` just packaged on this Mac: quits the Wren that is running, replaces
# /Applications/Wren.app with the packaged one and opens it. The user's data in
# ~/Library/Application Support/wren stays as it is.
#
#   bun run wren:desktop:deploy
set -euo pipefail
cd "$(dirname "$0")/.."

# Absolute, since `defaults read` takes a relative path for a domain name.
PACKAGED="$PWD/out/Wren-darwin-arm64/Wren.app"
INSTALLED="/Applications/Wren.app"

say() { printf '\n==> %s\n' "$*"; }

if [ ! -d "$PACKAGED" ]; then
  echo "No packaged Wren at $PACKAGED: run bun run wren:desktop:make first." >&2
  exit 1
fi

version_of() { defaults read "$1/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo none; }

say "Replacing Wren $(version_of "$INSTALLED") with $(version_of "$PACKAGED")"
if pgrep -xq Wren; then
  osascript -e 'quit app "Wren"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -xq Wren || break
    sleep 1
  done
  pkill -x Wren || true
fi
rm -rf "$INSTALLED"
ditto "$PACKAGED" "$INSTALLED"

say "Opening"
open "$INSTALLED"
say "Wren $(version_of "$INSTALLED") is on this Mac"
