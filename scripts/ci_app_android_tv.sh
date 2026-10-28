#!/usr/bin/env bash
# Runs the 📺 App on Android TV job from pull-request-checks.yml on this Mac: the
# libraries, the fixture server, the Android TV emulator, the Release APK through
# ccache, the install and the Maestro flows the remote drives. The emulator is arm64
# here, where CI's is x86_64 on KVM, and is left running so a rerun skips its boot.
#
#   bun run ci:app:android-tv                         every step
#   bun run ci:app:android-tv -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# Gradle runs on Android Studio's JDK, as apps/raven/app/CLAUDE.md says.
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
# React Native compiles its native code once per ABI, four by default; the emulator here
# is arm64, so the build makes only that. An Nx input of the build and the flows.
export ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1
FAILURE_HINT="Maestro's screenshots and logs: ~/.maestro/tests; $FAILURE_HINT"

APK=apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
AVD=raven_tv
IMAGE='system-images;android-36;android-tv;arm64-v8a'
# The SDK's own manager, never another on the path, whose default SDK root is its own folder.
SDK_TOOLS="$ANDROID_HOME/cmdline-tools/latest/bin"
emulator_pid=''

# Fed by process substitution, not a pipe: `yes` dies of SIGPIPE when the manager exits,
# which pipefail would turn into the script's failure.
sdkmanager() { "$SDK_TOOLS/sdkmanager" --sdk_root="$ANDROID_HOME" "$@" < <(yes); }

step 'Tools'
require_apple_silicon
if [ ! -d "$JAVA_HOME" ]; then
  echo 'Installing Android Studio, for the JDK Gradle runs on'
  brew install --cask android-studio
fi
if [ ! -x "$SDK_TOOLS/sdkmanager" ]; then
  echo 'Installing the Android SDK command-line tools'
  brew install --cask android-commandlinetools
  /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager --sdk_root="$ANDROID_HOME" 'cmdline-tools;latest' < <(yes)
fi
if ! sdkmanager --list_installed 2> /dev/null | grep -qF "${IMAGE#system-images;}"; then
  echo 'Installing the SDK packages and the Android TV system image (about 1.5 GB)'
  sdkmanager --licenses > /dev/null
  sdkmanager platform-tools emulator 'platforms;android-36' "$IMAGE"
fi
# React Native's CMake setup uses ccache whenever it is on the path.
require_app_tools
install_maestro

prepare_app

step 'Start the Android TV emulator'
if ! emulator -list-avds | grep -qx "$AVD"; then
  # CI's profile and RAM: 960 by 540 dp, 4 GiB.
  echo no | "$SDK_TOOLS/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d tv_1080p
  sed -i '' 's/^hw.ramSize=.*/hw.ramSize=4096/' "$HOME/.android/avd/$AVD.avd/config.ini"
fi
if adb devices | grep -q '^emulator-'; then
  echo 'An emulator is already running; using it.'
else
  # Detached, so it outlives this script and a rerun skips the boot.
  nohup emulator -avd "$AVD" -no-audio -no-boot-anim -no-snapshot-save -camera-back none > "$WORK/emulator.log" 2>&1 &
  emulator_pid=$!
  disown
  echo "Booting $AVD, logging to $WORK/emulator.log"
fi

step 'Build the Android TV APK'
bunx nx run @raven/app:build:android-tv --excludeTaskDependencies

# Up to ten minutes; an emulator this script started that dies stops the wait.
step 'Wait for the emulator'
booted=''
for _ in $(seq 1 300); do
  if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; then
    booted=yes
    break
  fi
  if [ -n "$emulator_pid" ] && ! kill -0 "$emulator_pid" 2> /dev/null; then
    break
  fi
  sleep 2
done
if [ -z "$booted" ]; then
  echo 'The emulator did not finish booting.' >&2
  [ -z "$emulator_pid" ] || cat "$WORK/emulator.log" >&2
  exit 1
fi
# CI's disable-animations, which keeps Maestro's waits steady.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

step 'Install the APK'
if ! adb install -r "$APK"; then
  # A build signed with another key is on the emulator.
  adb uninstall io.github.codebend3r.raven.app
  adb install "$APK"
fi

wait_for_fixture

step 'App end to end'
bunx nx run @raven/app:e2e:android-tv "$@"
