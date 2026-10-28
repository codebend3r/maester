#!/usr/bin/env bash
# What the device app's ci_app_*.sh scripts share on top of local_ci.sh: the build
# environment, the fixture server (stopped on exit if this script started it), the
# libraries' build, Maestro and the Apple simulators. Helpers that find something set a
# variable rather than print it: bash 3.2 runs `$(...)` without `set -e`, so a failure
# inside one would pass unnoticed.

# shellcheck source=scripts/local_ci.sh
source "$(dirname "${BASH_SOURCE[0]}")/local_ci.sh"

# The flows reach the accountless fixture over plain http on the loopback; the
# development variant allows it, and Expo bundles the fixture's address into the build.
# Both are Nx inputs of the build and e2e targets, as CI sets them.
export APP_VARIANT=development
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490

# CocoaPods fetches the Hermes tarball with curl, which otherwise waits out a stalled
# mirror for good: an Apple build runs with CURL_HOME="$WORK", whose .curlrc drops a
# transfer under 100 KB/s for 30 seconds and retries. ~/.curlrc is left alone.
printf 'speed-limit = 102400\nspeed-time = 30\nretry = 5\n' > "$WORK/.curlrc"

FIXTURE_PORT=8490
FIXTURE_LOG="$WORK/fixture.log"
FAILURE_HINT="The fixture server's log: $FIXTURE_LOG"
fixture_pid=''

cleanup() {
  if [ -n "$fixture_pid" ]; then
    kill "$fixture_pid" 2> /dev/null || true
    lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN | xargs kill 2> /dev/null || true
  fi
}

# Babel loads babel.config.ts through Node's type stripping, which every build bundles with.
require_node() {
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)' || {
    echo 'Needs Node 22.18 or newer.' >&2
    exit 1
  }
}

# Maestro's Homebrew formula, which brings its Java.
install_maestro() {
  if ! command -v maestro > /dev/null; then
    brew tap mobile-dev-inc/tap
    brew install mobile-dev-inc/tap/maestro
  fi
}

# The fixture server and an app build would each run the libraries' build (it starts
# with `rm -rf dist`) at once, so they are built once here and both skip their own.
build_libraries() {
  step 'Build the libraries'
  bunx nx run-many -t build -p @raven/core @raven/ui @shared/server
}

start_fixture() {
  step 'Start the fixture server'
  if lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN > /dev/null; then
    echo "Something already listens on $FIXTURE_PORT; using it as the fixture server."
    return
  fi
  bunx nx run @raven/server:serve:fixture --excludeTaskDependencies > "$FIXTURE_LOG" 2>&1 &
  fixture_pid=$!
  echo "In the background, logging to $FIXTURE_LOG"
}

# Its ready line comes once its libraries are scanned, up to three minutes.
wait_for_fixture() {
  step 'Wait for the fixture server'
  [ -n "$fixture_pid" ] || return 0
  local _
  for _ in $(seq 1 90); do
    if grep -q 'raven fixture server ready' "$FIXTURE_LOG"; then
      grep 'raven fixture server ready' "$FIXTURE_LOG"
      return
    fi
    kill -0 "$fixture_pid" 2> /dev/null || break
    sleep 2
  done
  cat "$FIXTURE_LOG" >&2
  exit 1
}

# find_runtime <iOS|tvOS>: sets SIM_RUNTIME to the available runtime matching $SIM_SDK,
# or to nothing.
find_runtime() {
  SIM_RUNTIME="$(xcrun simctl list -j runtimes "$1" | jq -r --arg sdk "$SIM_SDK" '[.runtimes[] | select(.isAvailable and (.version == $sdk or (.version | startswith($sdk + "."))))] | last | .identifier // empty')"
}

# The tools every app build needs: ffmpeg for the fixture's clips, ccache for the
# compile, and Node for Babel.
require_build_tools() {
  brew_install ffmpeg ffmpeg
  brew_install ccache ccache
  require_node
}

# prepare_app: once the tools are in, the install, the libraries and the fixture server.
prepare_app() {
  step 'Install'
  bun install --frozen-lockfile

  build_libraries
  start_fixture
}

# require_apple_tools <iOS|tvOS> <sdk>: the tools and the simulator runtime matching
# Xcode's SDK (SIM_RUNTIME, downloaded when there is none, about 8 GB). ccache is on,
# through Expo's Podfile, so a rebuild reuses unchanged objects.
require_apple_tools() {
  step 'Tools'
  require_apple_silicon
  require_xcode
  require_build_tools
  brew_install jq jq
  brew_install pod cocoapods
  export USE_CCACHE=1
  SIM_SDK="$(xcrun --sdk "$2" --show-sdk-version)"
  find_runtime "$1"
  if [ -z "$SIM_RUNTIME" ]; then
    echo "Downloading the $1 $SIM_SDK simulator runtime (about 8 GB)"
    xcodebuild -downloadPlatform "$1"
    find_runtime "$1"
  fi
  [ -n "$SIM_RUNTIME" ] || { echo "No $1 $SIM_SDK simulator runtime, even after the download." >&2; exit 1; }
}

# boot_simulator <name> <device type>: sets SIM_DEVICE to the simulator of that name on
# SIM_RUNTIME, made with the device type when there is none, booted and shown on screen.
# Showing it is a convenience: Xcode 27 has no Simulator.app, its simulators are in
# DeviceHub, and the flows run on a booted simulator with no window at all.
boot_simulator() {
  SIM_DEVICE="$(xcrun simctl list -j devices | jq -r --arg name "$1" --arg runtime "$SIM_RUNTIME" '.devices[$runtime][]? | select(.name == $name and .isAvailable) | .udid' | head -n 1)"
  if [ -z "$SIM_DEVICE" ]; then
    SIM_DEVICE="$(xcrun simctl create "$1" "$2" "$SIM_RUNTIME")"
  fi
  xcrun simctl boot "$SIM_DEVICE" 2> /dev/null || true
  open -a Simulator --args -CurrentDeviceUDID "$SIM_DEVICE" 2> /dev/null ||
    open -b com.apple.dt.Devices 2> /dev/null ||
    echo 'Neither Simulator nor DeviceHub opened; the simulator runs without a window.'
}
