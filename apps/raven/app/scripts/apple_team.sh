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

# Sets AUTH to xcodebuild's App Store Connect API key flags, or to nothing. With the key, automatic
# signing makes and renews its profiles without an Apple ID signed in to Xcode, which Xcode drops
# every week or two. The issuer is ASC_KEY_ISSUER_ID, else the one line of
# ~/.appstoreconnect/issuer_id; the key is ASC_KEY_PATH, else the one .p8 in
# ~/.appstoreconnect/private_keys. With no issuer, xcodebuild falls back to Xcode's account.
asc_auth() {
  local issuer key id
  AUTH=()
  issuer="${ASC_KEY_ISSUER_ID:-$(tr -d '[:space:]' <"$HOME/.appstoreconnect/issuer_id" 2>/dev/null || true)}"
  if [ -z "$issuer" ]; then
    return
  fi
  key="${ASC_KEY_PATH:-$(find "$HOME/.appstoreconnect/private_keys" -name 'AuthKey_*.p8' 2>/dev/null | head -1)}"
  if [ -z "$key" ]; then
    echo "An App Store Connect issuer is set but no AuthKey_*.p8 is in ~/.appstoreconnect/private_keys: set ASC_KEY_PATH." >&2
    exit 1
  fi
  id="$(basename "$key" .p8)"
  AUTH=(-authenticationKeyPath "$key" -authenticationKeyID "${id#AuthKey_}" -authenticationKeyIssuerID "$issuer")
}
