#!/usr/bin/env bash
# What the Play scripts share, sourced from the app's scripts: where the upload key is, its
# alias, the Keychain item that holds its password, the JDK whose keytool reads it, and the
# key's SHA-256 fingerprint, which is how a signed bundle is checked.

# Android Studio's JDK wins over the shell's: Homebrew's newer Java fails Gradle's plugins.
STUDIO_JDK="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if [ -x "$STUDIO_JDK/bin/java" ]; then
  export JAVA_HOME="$STUDIO_JDK"
fi
KEYTOOL="${JAVA_HOME:-}/bin/keytool"
STORE_FILE="${RAVEN_UPLOAD_STORE_FILE:-$HOME/.config/maester/raven-play-upload.p12}"
KEY_ALIAS=raven-upload
KEYCHAIN_SERVICE=raven-play-upload

say() { printf '\n==> %s\n' "$*"; }

# The first SHA-256 fingerprint keytool prints, from whatever listing it is handed on stdin.
sha256_of() { grep -m1 -oE 'SHA256: [0-9A-F:]+' | cut -d' ' -f2; }

# The upload key's fingerprint, read with the password in RAVEN_UPLOAD_PASSWORD.
key_fingerprint() {
  "$KEYTOOL" -list -v -keystore "$STORE_FILE" -alias "$KEY_ALIAS" \
    -storepass:env RAVEN_UPLOAD_PASSWORD | sha256_of
}

[ -x "$KEYTOOL" ] || { echo "No keytool at $KEYTOOL: install Android Studio or set JAVA_HOME." >&2; exit 1; }
