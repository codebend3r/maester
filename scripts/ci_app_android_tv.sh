#!/usr/bin/env bash
# Runs the 📺 App on Android TV job from main-native-checks.yml on this Mac: the
# libraries, the fixture server, the Android TV emulator, the Release APK through
# ccache, the install and the Maestro flows the remote drives. The emulator is arm64
# here, where CI's is x86_64 on KVM, and is left running so a rerun skips its boot. Each
# step is a root script of its own, which the whole job runs in order:
#
#   bun run ci:app:android-tv                         every step
#   bun run ci:app:android-tv -- --skip-nx-cache      the flows for real, even on a cached pass
#   bun run ci:app:android-tv:tools                   Android Studio, the SDK, the TV image, Maestro
#   bun run ci:app:install                            bun install
#   bun run ci:app:libraries                          the libraries' build
#   bun run ci:app:fixture                            the fixture server, in the foreground
#   bun run ci:app:android-tv:emulator                starts the Android TV emulator
#   bun run ci:app:android-tv:build                   the Release APK
#   bun run ci:app:android-tv:emulator:wait           waits for the emulator to boot
#   bun run ci:app:android-tv:install                 installs the APK on the emulator
#   bun run ci:app:fixture:wait                       waits for the fixture server
#   bun run ci:app:android-tv:e2e                     the Maestro flows (takes --skip-nx-cache)
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
# Outside $WORK, which each step makes afresh, so the wait can show what the start logged.
EMULATOR_LOG="${TMPDIR:-/tmp}/raven-$AVD-emulator.log"

# Fed by process substitution, not a pipe: `yes` dies of SIGPIPE when the manager exits,
# which pipefail would turn into the script's failure.
sdkmanager() { "$SDK_TOOLS/sdkmanager" --sdk_root="$ANDROID_HOME" "$@" < <(yes); }

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
    echo 'Installing the SDK packages and the Android TV system image (about 1.5 GB)'
    sdkmanager --licenses > /dev/null
    sdkmanager platform-tools emulator 'platforms;android-36' "$IMAGE"
  fi
  # React Native's CMake setup uses ccache whenever it is on the path.
  require_build_tools
  install_maestro
}

step_emulator() {
  step 'Start the Android TV emulator'
  if ! emulator -list-avds | grep -qx "$AVD"; then
    # CI's profile and RAM: 960 by 540 dp, 4 GiB.
    echo no | "$SDK_TOOLS/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d tv_1080p
    sed -i '' 's/^hw.ramSize=.*/hw.ramSize=4096/' "$HOME/.android/avd/$AVD.avd/config.ini"
  fi
  if adb devices | grep -q '^emulator-'; then
    echo 'An emulator is already running; using it.'
    return
  fi
  # Detached, so it outlives this step and a rerun skips the boot.
  nohup emulator -avd "$AVD" -no-audio -no-boot-anim -no-snapshot-save -camera-back none > "$EMULATOR_LOG" 2>&1 &
  disown
  echo "Booting $AVD, logging to $EMULATOR_LOG"
}

emulator_running() { pgrep -f -- "-avd $AVD" > /dev/null; }

# Up to ten minutes, then CI's disable-animations, which keeps Maestro's waits steady. An
# emulator that has gone stops the wait.
step_emulator_wait() {
  step 'Wait for the emulator'
  local _
  for _ in $(seq 1 300); do
    if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; then
      adb shell settings put global window_animation_scale 0
      adb shell settings put global transition_animation_scale 0
      adb shell settings put global animator_duration_scale 0
      return
    fi
    if ! emulator_running && ! adb devices | grep -q '^emulator-'; then
      break
    fi
    sleep 2
  done
  echo 'The emulator did not finish booting: start it with bun run ci:app:android-tv:emulator.' >&2
  [ ! -f "$EMULATOR_LOG" ] || cat "$EMULATOR_LOG" >&2
  exit 1
}

step_install() {
  step 'Install the APK'
  if ! adb install -r "$APK"; then
    # A build signed with another key is on the emulator.
    adb uninstall io.github.codebend3r.raven.app
    adb install "$APK"
  fi
}

step_build() {
  step 'Build the Android TV APK'
  bunx nx run @raven/app:build:android-tv --excludeTaskDependencies
}

step_e2e() {
  step 'App end to end'
  bunx nx run @raven/app:e2e:android-tv "$@"
}

# The whole job, each step through its own root script.
run_job() {
  start_job ci:app:android-tv:tools
  bun run ci:app:android-tv:emulator
  bun run ci:app:android-tv:build
  bun run ci:app:android-tv:emulator:wait
  bun run ci:app:android-tv:install
  bun run ci:app:fixture:wait
  bun run ci:app:android-tv:e2e "$@"
}

run_steps "$@"
