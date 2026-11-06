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
# The Apple builds compile through ccache, through Expo's Podfile, so a rebuild reuses
# unchanged objects; Android's CMake uses it whenever it is on the path.
export USE_CCACHE=1

# CocoaPods fetches the Hermes tarball with curl, which otherwise waits out a stalled
# mirror for good: an Apple build runs with CURL_HOME="$WORK", whose .curlrc drops a
# transfer under 100 KB/s for 30 seconds and retries. ~/.curlrc is left alone.
printf 'speed-limit = 102400\nspeed-time = 30\nretry = 5\n' > "$WORK/.curlrc"

FIXTURE_PORT=8490
# Outside $WORK, which each step makes afresh, so the wait can show what the start logged.
FIXTURE_LOG="${TMPDIR:-/tmp}/raven-fixture.log"
FAILURE_HINT="The fixture server's log: $FIXTURE_LOG"
fixture_pid=''

fixture_listening() { lsof -tiTCP:"$FIXTURE_PORT" -sTCP:LISTEN > /dev/null; }
fixture_running() { pgrep -f 'src/e2e/fixtureServer.ts' > /dev/null; }

cleanup() {
  if [ -n "$fixture_pid" ]; then
    kill "$fixture_pid" 2> /dev/null || true
    pkill -f 'src/e2e/fixtureServer.ts' 2> /dev/null || true
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
  bunx nx run-many -t build -p @raven/core @raven/ui @raven/audio @raven/native @shared/server
}

# run_fixture: the fixture server in the foreground (`bun run ci:app:fixture`), unless
# something already listens on its port.
run_fixture() {
  step 'Start the fixture server'
  if fixture_listening; then
    echo "Something already listens on $FIXTURE_PORT; using it as the fixture server."
    return
  fi
  exec bunx nx run @raven/server:serve:fixture --excludeTaskDependencies
}

# start_fixture: the same in the background, stopped when the job ends.
start_fixture() {
  if fixture_listening; then
    echo "Something already listens on $FIXTURE_PORT; using it as the fixture server."
    return
  fi
  bun run ci:app:fixture > "$FIXTURE_LOG" 2>&1 &
  fixture_pid=$!
  echo "The fixture server runs in the background, logging to $FIXTURE_LOG"
}

# await_fixture: waits up to three minutes for the fixture server, wherever it was
# started. It listens only once its libraries are scanned and it has printed its ready
# line, so a listening port is a ready server, and no server process is a failed one.
await_fixture() {
  step 'Wait for the fixture server'
  local tries
  for tries in $(seq 1 90); do
    if fixture_listening; then
      echo "The fixture server answers on $FIXTURE_PORT."
      return
    fi
    # A few seconds' grace for a server started a moment ago.
    if [ "$tries" -gt 5 ] && ! fixture_running; then
      break
    fi
    sleep 2
  done
  echo "No fixture server on $FIXTURE_PORT: start it with bun run ci:app:fixture." >&2
  [ ! -s "$FIXTURE_LOG" ] || cat "$FIXTURE_LOG" >&2
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

install_dependencies() {
  step 'Install'
  bun install --frozen-lockfile
}

# prepare_app: once the tools are in, the install, the libraries and the fixture server.
prepare_app() {
  install_dependencies
  build_libraries
  step 'Start the fixture server'
  start_fixture
}

# start_job <tools script>: how a job split into root scripts opens, each step through its
# own: the tools, the install, the libraries and the fixture server in the background.
start_job() {
  bun run "$1"
  bun run ci:app:install
  bun run ci:app:libraries
  start_fixture
}

# run_steps "$@": a job script's entry. A step's name runs its `step_<name>` with the
# arguments after it; nothing, or only arguments for nx, runs the whole job (`run_job`)
# in a script that has one.
run_steps() {
  if { [ -z "${1:-}" ] || [ "${1#-}" != "$1" ]; } && declare -F run_job > /dev/null; then
    run_job "$@"
    return
  fi
  if [ -n "${1:-}" ] && declare -F "step_$1" > /dev/null; then
    local name="$1"
    shift
    "step_$name" "$@"
    return
  fi
  FAILURE_HINT=''
  echo "Usage: $(basename "$0") [$(declare -F | awk '$3 ~ /^step_/ { sub(/^step_/, "", $3); print $3 }' | paste -sd '|' -)] [nx arguments]" >&2
  exit 2
}

# require_apple_tools <iOS|tvOS> <sdk>: the tools and the simulator runtime matching
# Xcode's SDK (SIM_RUNTIME, downloaded when there is none, about 8 GB).
require_apple_tools() {
  step 'Tools'
  require_apple_silicon
  require_xcode
  require_build_tools
  brew_install jq jq
  brew_install pod cocoapods
  SIM_SDK="$(xcrun --sdk "$2" --show-sdk-version)"
  find_runtime "$1"
  if [ -z "$SIM_RUNTIME" ]; then
    echo "Downloading the $1 $SIM_SDK simulator runtime (about 8 GB)"
    xcodebuild -downloadPlatform "$1"
    find_runtime "$1"
  fi
  [ -n "$SIM_RUNTIME" ] || { echo "No $1 $SIM_SDK simulator runtime, even after the download." >&2; exit 1; }
}

# apple_runtime <iOS|tvOS> <sdk>: sets SIM_SDK and SIM_RUNTIME for a step run on its own,
# downloading nothing: the tools step does that.
apple_runtime() {
  SIM_SDK="$(xcrun --sdk "$2" --show-sdk-version)"
  find_runtime "$1"
  [ -n "$SIM_RUNTIME" ] || { echo "No $1 $SIM_SDK simulator runtime: run the job's tools step first." >&2; exit 1; }
}

# find_simulator <name> <device type>: sets SIM_DEVICE to the simulator of that name on
# SIM_RUNTIME, made with the device type when there is none.
find_simulator() {
  SIM_DEVICE="$(xcrun simctl list -j devices | jq -r --arg name "$1" --arg runtime "$SIM_RUNTIME" '.devices[$runtime][]? | select(.name == $name and .isAvailable) | .udid' | head -n 1)"
  if [ -z "$SIM_DEVICE" ]; then
    SIM_DEVICE="$(xcrun simctl create "$1" "$2" "$SIM_RUNTIME")"
  fi
}

# boot_simulator <name> <device type>: sets SIM_DEVICE to the simulator of that name on
# SIM_RUNTIME, made with the device type when there is none, booted and shown on screen.
# Showing it is a convenience: Xcode 27 has no Simulator.app, its simulators are in
# DeviceHub, and the flows run on a booted simulator with no window at all.
boot_simulator() {
  find_simulator "$1" "$2"
  xcrun simctl boot "$SIM_DEVICE" 2> /dev/null || true
  open -a Simulator --args -CurrentDeviceUDID "$SIM_DEVICE" 2> /dev/null ||
    open -b com.apple.dt.Devices 2> /dev/null ||
    echo 'Neither Simulator nor DeviceHub opened; the simulator runs without a window.'
}
