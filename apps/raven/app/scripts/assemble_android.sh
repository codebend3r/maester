#!/usr/bin/env bash
# Builds the Release APK of the app in the current folder, which is raven's or Wren on TV's:
# `build:android` and `build:android-tv` run it from the app's folder, after its prebuild.
#
# Gradle runs on Android Studio's JDK wherever Android Studio is installed, whatever the shell's
# JAVA_HOME names: a newer JDK (Homebrew's 27) fails the build with "Unsupported class file major
# version". Without Android Studio (CI's Linux runner) the shell's JAVA_HOME stands.
set -euo pipefail

STUDIO_JDK='/Applications/Android Studio.app/Contents/jbr/Contents/Home'

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -d "$STUDIO_JDK" ]; then
  export JAVA_HOME="$STUDIO_JDK"
fi

exec ./android/gradlew -p android assembleRelease
