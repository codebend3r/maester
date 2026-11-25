#!/usr/bin/env bash
# Puts the Raven that `make` just packaged on this Mac: quits the Raven that is running, replaces
# /Applications/Raven.app with the packaged one and opens it. The user's data in
# ~/Library/Application Support/raven stays as it is.
#
#   bun run desktop:deploy
set -euo pipefail
cd "$(dirname "$0")/.."

# Absolute, since `defaults read` takes a relative path for a domain name.
PACKAGED="$PWD/out/Raven-darwin-arm64/Raven.app"
INSTALLED="/Applications/Raven.app"

say() { printf '\n==> %s\n' "$*"; }

if [ ! -d "$PACKAGED" ]; then
  echo "No packaged Raven at $PACKAGED: run bun run desktop:make first." >&2
  exit 1
fi

version_of() { defaults read "$1/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo none; }

say "Replacing Raven $(version_of "$INSTALLED") with $(version_of "$PACKAGED")"
if pgrep -xq Raven; then
  osascript -e 'quit app "Raven"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -xq Raven || break
    sleep 1
  done
  pkill -x Raven || true
fi
rm -rf "$INSTALLED"
ditto "$PACKAGED" "$INSTALLED"

say "Opening"
open "$INSTALLED"
say "Raven $(version_of "$INSTALLED") is on this Mac"
