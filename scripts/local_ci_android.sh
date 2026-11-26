#!/usr/bin/env bash
# What the device app's Android jobs share on top of local_ci_app.sh, sourced by
# ci_app_android_tv.sh and ci_app_android.sh once each has named its own:
#
#   JOB           the root script of the whole job, whose steps are `$JOB:<step>`
#   DEVICE        how the step names and messages call it: "Android TV", "Android phone"
#   AVD           the emulator the job makes, boots and drives, and no other
#   IMAGE         the system image it is made from
#   PROFILE       its hardware profile
#   BUILD_SCRIPT  the root script that builds the APK
#   E2E_SCRIPT    the root script that runs the flows
#   APK, APP_ID   the APK the build makes and the app it installs, raven's device app's unless
#                 named (Wren on TV names its own)
#
# Every step finds the running emulator whose AVD is $AVD and exports its serial as
# ANDROID_SERIAL, which adb reads and the flows hand to Maestro, so a phone on a cable or the
# other job's emulator is never the one driven. The emulator is left running so a rerun skips
# its boot. Each step is a root script of its own, which the whole job runs in order.

# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "${BASH_SOURCE[0]}")/local_ci_app.sh"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# Gradle runs on Android Studio's JDK, as apps/raven/app/CLAUDE.md says, whatever the shell's
# JAVA_HOME names: a newer JDK (Homebrew's 27) fails the build with "Unsupported class file".
export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
# React Native compiles its native code once per ABI, four by default; the emulator here
# is arm64, so the build makes only that. An Nx input of the build and the flows.
export ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1
FAILURE_HINT="Maestro's screenshots and logs: ~/.maestro/tests; $FAILURE_HINT"

APK="${APK:-apps/raven/app/android/app/build/outputs/apk/release/app-release.apk}"
APP_ID="${APP_ID:-io.github.codebend3r.raven.app}"
# The SDK's own manager, never another on the path, whose default SDK root is its own folder.
SDK_TOOLS="$ANDROID_HOME/cmdline-tools/latest/bin"
# Outside $WORK, which each step makes afresh, so the wait can show what the start logged.
EMULATOR_LOG="${TMPDIR:-/tmp}/raven-$AVD-emulator.log"

# Fed by process substitution, not a pipe: `yes` dies of SIGPIPE when the manager exits,
# which pipefail would turn into the script's failure.
sdkmanager() { "$SDK_TOOLS/sdkmanager" --sdk_root="$ANDROID_HOME" "$@" < <(yes); }

# find_emulator: sets and exports ANDROID_SERIAL to the running emulator whose AVD is $AVD,
# or to nothing.
find_emulator() {
  local serial
  ANDROID_SERIAL=''
  for serial in $(adb devices | awk '/^emulator-/ { print $1 }'); do
    if [ "$(adb -s "$serial" emu avd name 2> /dev/null | head -n 1 | tr -d '\r')" = "$AVD" ]; then
      ANDROID_SERIAL="$serial"
      break
    fi
  done
  export ANDROID_SERIAL
}

require_emulator() {
  find_emulator
  [ -n "$ANDROID_SERIAL" ] || {
    echo "The $AVD emulator is not running: start it with bun run $JOB:emulator." >&2
    exit 1
  }
}

emulator_running() { pgrep -f -- "-avd $AVD" > /dev/null; }

step_tools() {
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
    echo "Installing the SDK packages and the $DEVICE system image (about 1.5 GB)"
    sdkmanager --licenses > /dev/null
    sdkmanager platform-tools emulator 'platforms;android-36' "$IMAGE"
  fi
  # React Native's CMake setup uses ccache whenever it is on the path.
  require_build_tools
  install_maestro
}

step_emulator() {
  step "Start the $DEVICE emulator"
  if ! emulator -list-avds | grep -qx "$AVD"; then
    echo no | "$SDK_TOOLS/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d "$PROFILE"
    sed -i '' 's/^hw.ramSize=.*/hw.ramSize=4096/' "$HOME/.android/avd/$AVD.avd/config.ini"
  fi
  find_emulator
  if [ -n "$ANDROID_SERIAL" ]; then
    echo "$AVD is already running as $ANDROID_SERIAL; using it."
    return
  fi
  # Detached, so it outlives this step and a rerun skips the boot.
  nohup emulator -avd "$AVD" -no-audio -no-boot-anim -no-snapshot-save -camera-back none > "$EMULATOR_LOG" 2>&1 &
  disown
  echo "Booting $AVD, logging to $EMULATOR_LOG"
}

# Up to ten minutes, then CI's disable-animations, which keeps Maestro's waits steady. An
# emulator that has gone stops the wait.
step_emulator_wait() {
  step 'Wait for the emulator'
  local _
  for _ in $(seq 1 300); do
    find_emulator
    if [ -n "$ANDROID_SERIAL" ] && [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; then
      adb shell settings put global window_animation_scale 0
      adb shell settings put global transition_animation_scale 0
      adb shell settings put global animator_duration_scale 0
      echo "$AVD is up as $ANDROID_SERIAL."
      return
    fi
    if [ -z "$ANDROID_SERIAL" ] && ! emulator_running; then
      break
    fi
    sleep 2
  done
  echo "The emulator did not finish booting: start it with bun run $JOB:emulator." >&2
  [ ! -f "$EMULATOR_LOG" ] || cat "$EMULATOR_LOG" >&2
  exit 1
}

step_build() {
  step "Build the $DEVICE APK"
  bun run "$BUILD_SCRIPT" --excludeTaskDependencies
}

step_install() {
  step 'Install the APK'
  require_emulator
  if ! adb install -r "$APK"; then
    # A build signed with another key is on the emulator.
    adb uninstall "$APP_ID"
    adb install "$APK"
  fi
}

step_e2e() {
  step 'App end to end'
  require_emulator
  bun run "$E2E_SCRIPT" "$@"
}

# The whole job, each step through its own root script.
run_job() {
  start_job "$JOB:tools"
  bun run "$JOB:emulator"
  bun run "$JOB:build"
  bun run "$JOB:emulator:wait"
  bun run "$JOB:install"
  bun run ci:app:fixture:wait
  bun run "$JOB:e2e" "$@"
}
