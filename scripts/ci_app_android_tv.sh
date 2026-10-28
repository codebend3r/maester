#!/usr/bin/env bash
# Runs the 📺 App on Android TV job from pull-request-checks.yml on this Mac: the
# libraries, the fixture server, the Android TV emulator, the Release APK, the install
# and the Maestro flows the remote drives. Every heavy step is an Nx target, so an
# unchanged build or a pass replays from the cache. A missing tool is installed with
# Homebrew or the SDK manager first. The emulator is arm64 here, where CI's is x86_64
# on KVM, and it is left running afterwards so a rerun skips its boot.
#
#   bun run ci:app:android-tv                         every step
#   bun run ci:app:android-tv -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail

cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# Gradle runs on Android Studio's JDK, as apps/raven/app/CLAUDE.md says.
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
# Baked into the APK and both Nx inputs of build:android-tv and e2e:android-tv, as CI sets them.
export APP_VARIANT=development
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1

APK=apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
APP_ID=io.github.codebend3r.raven.app
AVD=raven_tv
IMAGE='system-images;android-36;android-tv;arm64-v8a'
FIXTURE_PORT=8490
WORK="$(mktemp -d "${TMPDIR:-/tmp}/raven-ci-app-android-tv.XXXXXX")"
FIXTURE_LOG="$WORK/fixture.log"
fixture_pid=''

step() { printf '\n=== %s ===\n' "$1"; }

stop_fixture() {
  if [ -n "$fixture_pid" ]; then
    kill "$fixture_pid" 2> /dev/null || true
    lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN | xargs kill 2> /dev/null || true
  fi
}

on_exit() {
  local status=$?
  stop_fixture
  if [ "$status" -ne 0 ]; then
    echo "Failed. Maestro's screenshots and logs: ~/.maestro/tests; the fixture server's log: $FIXTURE_LOG" >&2
  fi
}
trap on_exit EXIT

brew_install() {
  local command="$1" formula="$2"
  if ! command -v "$command" > /dev/null; then
    echo "Installing $formula"
    brew install "$formula"
  fi
}

step 'Tools'
test "$(uname -m)" = arm64 || { echo 'Needs a Mac with Apple silicon.' >&2; exit 1; }
if [ ! -d "$JAVA_HOME" ]; then
  echo 'Installing Android Studio, for the JDK Gradle runs on'
  brew install --cask android-studio
fi
if ! command -v sdkmanager > /dev/null; then
  echo 'Installing the Android SDK command-line tools'
  brew install --cask android-commandlinetools
  yes | /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager --sdk_root="$ANDROID_HOME" 'cmdline-tools;latest'
fi
if ! sdkmanager --list_installed 2> /dev/null | grep -q 'android-36;android-tv;arm64-v8a'; then
  echo 'Installing the SDK packages and the Android TV system image (about 1.5 GB)'
  yes | sdkmanager --licenses > /dev/null
  sdkmanager platform-tools emulator 'platforms;android-36' "$IMAGE"
fi
brew_install ffmpeg ffmpeg
# React Native's CMake setup uses ccache whenever it is on the path.
brew_install ccache ccache
if ! command -v maestro > /dev/null; then
  brew tap mobile-dev-inc/tap
  brew install mobile-dev-inc/tap/maestro
fi

step 'Install'
bun install --frozen-lockfile

# The fixture server and the APK build would each run the libraries' build (it starts
# with `rm -rf dist`) at once, so they are built once here and both skip their own.
step 'Build the libraries'
bunx nx run-many -t build -p @raven/core @raven/ui @shared/server

step 'Start the fixture server'
if lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN > /dev/null; then
  echo "Something already listens on $FIXTURE_PORT; using it as the fixture server."
else
  bunx nx run @raven/server:serve:fixture --excludeTaskDependencies > "$FIXTURE_LOG" 2>&1 &
  fixture_pid=$!
  echo "In the background, logging to $FIXTURE_LOG"
fi

step 'Start the Android TV emulator'
if ! emulator -list-avds | grep -qx "$AVD"; then
  # CI's profile and RAM: 960 by 540 dp, 4 GiB.
  echo no | avdmanager create avd -n "$AVD" -k "$IMAGE" -d tv_1080p
  sed -i '' 's/^hw.ramSize=.*/hw.ramSize=4096/' "$HOME/.android/avd/$AVD.avd/config.ini"
fi
if adb devices | grep -q '^emulator-'; then
  echo 'An emulator is already running; using it.'
else
  # Detached, so it outlives this script and a rerun skips the boot.
  nohup emulator -avd "$AVD" -no-audio -no-boot-anim -no-snapshot-save -camera-back none > "$WORK/emulator.log" 2>&1 &
  disown
  echo "Booting $AVD, logging to $WORK/emulator.log"
fi

step 'Build the Android TV APK'
bunx nx run @raven/app:build:android-tv --excludeTaskDependencies

step 'Wait for the emulator'
# The loop runs in the emulator's shell, so its `$(...)` must reach it unexpanded.
# shellcheck disable=SC2016
adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 2; done'
# CI's disable-animations, which keeps Maestro's waits steady.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

step 'Install the APK'
if ! adb install -r "$APK"; then
  # A build signed with another key is on the emulator.
  adb uninstall "$APP_ID"
  adb install "$APK"
fi

step 'Wait for the fixture server'
if [ -n "$fixture_pid" ]; then
  ready=''
  for _ in $(seq 1 90); do
    if grep -q 'raven fixture server ready' "$FIXTURE_LOG"; then
      ready=yes
      break
    fi
    kill -0 "$fixture_pid" 2> /dev/null || break
    sleep 2
  done
  if [ -z "$ready" ]; then
    cat "$FIXTURE_LOG" >&2
    exit 1
  fi
  grep 'raven fixture server ready' "$FIXTURE_LOG"
fi

step 'App end to end'
bunx nx run @raven/app:e2e:android-tv "$@"
