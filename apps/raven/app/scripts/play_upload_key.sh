#!/usr/bin/env bash
# Makes the Play upload key once: a PKCS12 store outside the repo, its password random and kept
# in the login Keychain, never in a file. Google Play App Signing holds the key the apps are
# finally signed with; this one only proves an upload is ours, and Play can reset it if lost.
#
#   bun run app:play:upload-key
#
# The store is RAVEN_UPLOAD_STORE_FILE, ~/.config/maester/raven-play-upload.p12 unless set, and
# the Keychain item is the generic password `raven-play-upload`, which `play_bundle.sh` reads.
set -euo pipefail
source "$(dirname "$0")/play_key.sh"

if [ -f "$STORE_FILE" ]; then
  echo "An upload key is already at $STORE_FILE: keep it, or move it away to make a new one." >&2
  exit 1
fi
if security find-generic-password -s "$KEYCHAIN_SERVICE" > /dev/null 2>&1; then
  echo "The Keychain already holds $KEYCHAIN_SERVICE with no store beside it: delete it first." >&2
  exit 1
fi

mkdir -p "$(dirname "$STORE_FILE")"
chmod 700 "$(dirname "$STORE_FILE")"
RAVEN_UPLOAD_PASSWORD="$(openssl rand -hex 24)"
export RAVEN_UPLOAD_PASSWORD

security add-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w "$RAVEN_UPLOAD_PASSWORD" \
  -l "raven Play upload key" -j "The password of $STORE_FILE"

# keytool reads the password from the environment, so it never stands on a command line.
"$KEYTOOL" -genkeypair -v \
  -storetype PKCS12 -keystore "$STORE_FILE" -alias "$KEY_ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=raven, O=maester" \
  -storepass:env RAVEN_UPLOAD_PASSWORD -keypass:env RAVEN_UPLOAD_PASSWORD
chmod 600 "$STORE_FILE"

say "Upload key made at $STORE_FILE (password in the Keychain as $KEYCHAIN_SERVICE)"
echo "SHA-256 fingerprint: $(key_fingerprint)"
echo "Back the store up somewhere safe; Play can reset a lost upload key, but only through support."
