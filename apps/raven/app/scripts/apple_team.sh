#!/usr/bin/env bash
# What the Apple builds share, sourced by `deploy_ios.sh`, `deploy_tvos.sh` and `testflight.sh`:
# which Xcode builds, and which team signs, read off a certificate in this Mac's keychain.

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

say() { printf '\n==> %s\n' "$*"; }

# The team of the first of the named certificates in the keychain: its OU, the one field that names it.
team_of() {
  local name team
  for name in "$@"; do
    team="$(security find-certificate -c "$name" -p 2>/dev/null \
      | openssl x509 -noout -subject 2>/dev/null \
      | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1 || true)"
    if [ -n "$team" ]; then
      echo "$team"
      return
    fi
  done
}

# Sets TEAM and exports it as APPLE_TEAM_ID (app.config.ts reads it): the shell's APPLE_TEAM_ID,
# else the team of the first certificate named after $1, which is what to say when there is none.
require_team() {
  local missing="$1"
  shift
  TEAM="${APPLE_TEAM_ID:-$(team_of "$@")}"
  if [ -z "$TEAM" ]; then
    echo "$missing" >&2
    exit 1
  fi
  export APPLE_TEAM_ID="$TEAM"
}
