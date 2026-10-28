#!/usr/bin/env bash
# What the device app's ci_app_*.sh scripts share on top of local_ci.sh: the build
# environment, the fixture server (stopped on exit if this script started it), the
# libraries' build, Maestro and the Apple simulators.

# shellcheck source=scripts/local_ci.sh
source "$(dirname "${BASH_SOURCE[0]}")/local_ci.sh"

# The flows reach the accountless fixture over plain http on the loopback; the
# development variant allows it, and Expo bundles the fixture's address into the build.
# Both are Nx inputs of the build and e2e targets, as CI sets them.
export APP_VARIANT=development
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490

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

# simulator_runtime <iOS|tvOS> <sdk>: the simulator runtime matching Xcode's SDK,
# downloaded when there is none (about 8 GB).
simulator_runtime() {
  local platform="$1" sdk runtime
  sdk="$(xcrun --sdk "$2" --show-sdk-version)"
  runtime_of() {
    xcrun simctl list -j runtimes "$platform" | jq -r --arg sdk "$sdk" '[.runtimes[] | select(.isAvailable and (.version == $sdk or (.version | startswith($sdk + "."))))] | last | .identifier // empty'
  }
  runtime="$(runtime_of)"
  if [ -z "$runtime" ]; then
    echo "Downloading the $platform $sdk simulator runtime (about 8 GB)" >&2
    xcodebuild -downloadPlatform "$platform" >&2
    runtime="$(runtime_of)"
  fi
  [ -n "$runtime" ] || { echo "No $platform $sdk simulator runtime, even after the download." >&2; exit 1; }
  echo "$runtime"
}

# boot_simulator <name> <runtime> <device type>: the simulator of that name on the
# runtime, made with the device type when there is none, booted and shown in Simulator.
boot_simulator() {
  local device
  device="$(xcrun simctl list -j devices | jq -r --arg name "$1" --arg runtime "$2" '.devices[$runtime][]? | select(.name == $name and .isAvailable) | .udid' | head -n 1)"
  if [ -z "$device" ]; then
    device="$(xcrun simctl create "$1" "$3" "$2")"
  fi
  [ -n "$device" ] || { echo "Could not make the simulator $1." >&2; exit 1; }
  xcrun simctl boot "$device" 2> /dev/null || true
  open -a Simulator --args -CurrentDeviceUDID "$device"
  echo "$device"
}

# curl_home: a CURL_HOME whose .curlrc drops a transfer under 100 KB/s for 30 seconds
# and retries, since CocoaPods fetches the Hermes tarball with curl, which otherwise
# waits out a stalled mirror for good. ~/.curlrc is left alone.
curl_home() {
  printf 'speed-limit = 102400\nspeed-time = 30\nretry = 5\n' > "$WORK/.curlrc"
  echo "$WORK"
}
