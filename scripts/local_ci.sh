#!/usr/bin/env bash
# What the ci_*.sh scripts share, sourced by each: they run a PR check from
# pull-request-checks.yml on this Mac, installing what is missing first, with every
# heavy step an Nx target. Sourcing it moves to the repo root, makes a temp folder
# ($WORK) and stops the fixture server, if one was started, when the script exits.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# Baked into the device app's builds and Nx inputs of their build and e2e targets, as CI sets them.
export APP_VARIANT=development
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490

FIXTURE_PORT=8490
WORK="$(mktemp -d "${TMPDIR:-/tmp}/raven-local-ci.XXXXXX")"
FIXTURE_LOG="$WORK/fixture.log"
# Printed when the script fails; each script names its own logs.
FAILURE_HINT="The fixture server's log: $FIXTURE_LOG"
fixture_pid=''

step() { printf '\n=== %s ===\n' "$1"; }

on_exit() {
  local status=$?
  if [ -n "$fixture_pid" ]; then
    kill "$fixture_pid" 2> /dev/null || true
    lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN | xargs kill 2> /dev/null || true
  fi
  if [ "$status" -ne 0 ]; then
    echo "Failed. $FAILURE_HINT" >&2
  fi
}
trap on_exit EXIT

# brew_install <command> <formula>: installs the formula when the command is missing.
brew_install() {
  if ! command -v "$1" > /dev/null; then
    echo "Installing $2"
    brew install "$2"
  fi
}

require_apple_silicon() {
  test "$(uname -m)" = arm64 || { echo 'Needs a Mac with Apple silicon.' >&2; exit 1; }
}

# Xcode comes from the App Store, so its absence stops the script.
require_xcode() {
  xcodebuild -version > /dev/null 2>&1 || {
    echo "No Xcode at $DEVELOPER_DIR: install it from the App Store, open it once and accept the license." >&2
    exit 1
  }
}

# Babel loads babel.config.ts through Node's type stripping.
require_node() {
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)' || {
    echo 'Needs Node 22.18 or newer.' >&2
    exit 1
  }
}

# install_maestro: Maestro's Homebrew formula, which brings its Java.
install_maestro() {
  if ! command -v maestro > /dev/null; then
    brew tap mobile-dev-inc/tap
    brew install mobile-dev-inc/tap/maestro
  fi
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
  xcrun simctl boot "$device" 2> /dev/null || true
  open -a Simulator --args -CurrentDeviceUDID "$device"
  echo "$device"
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

# curl_home: a CURL_HOME whose .curlrc drops a transfer under 100 KB/s for 30 seconds
# and retries, since CocoaPods fetches the Hermes tarball with curl, which otherwise
# waits out a stalled mirror for good. ~/.curlrc is left alone.
curl_home() {
  printf 'speed-limit = 102400\nspeed-time = 30\nretry = 5\n' > "$WORK/.curlrc"
  echo "$WORK"
}
