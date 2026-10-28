#!/usr/bin/env bash
# Runs the 📺 App on Apple TV job from pull-request-checks.yml on this Mac: the
# libraries, the fixture server, the Release build for the Apple TV simulator, the
# pods check, the simulator and the XCUITest the Siri Remote drives. Every heavy step
# is an Nx target, so an unchanged build or a pass replays from the cache. A missing
# tool is installed with Homebrew first; Xcode itself cannot be, so its absence stops here.
#
#   bun run ci:app:tvos                         every step
#   bun run ci:app:tvos -- --skip-nx-cache      the flow for real, even on a cached pass
set -euo pipefail

cd "$(dirname "$0")/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# Baked into the build and Nx inputs of build:tvos and e2e:tvos, as CI sets them.
export APP_VARIANT=development
export EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490
# Expo's Podfile points Xcode's compilers at ccache, so a rebuild reuses unchanged objects.
export USE_CCACHE=1
# The simulator e2e:tvos tests on, by name.
export TVOS_SIMULATOR=raven-tv

APP=apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app
DEVICE_TYPE=com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K
FIXTURE_PORT=8490
WORK="$(mktemp -d "${TMPDIR:-/tmp}/raven-ci-app-tvos.XXXXXX")"
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
    echo "Failed. The test's result bundle: apps/raven/app/build/tvos-e2e/Logs/Test; the fixture server's log: $FIXTURE_LOG" >&2
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
xcodebuild -version > /dev/null 2>&1 || {
  echo "No Xcode at $DEVELOPER_DIR: install it from the App Store, open it once and accept the license." >&2
  exit 1
}
brew_install ffmpeg ffmpeg
brew_install jq jq
brew_install pod cocoapods
brew_install ccache ccache
# Babel loads babel.config.ts through Node's type stripping.
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)' || {
  echo 'Needs Node 22.18 or newer.' >&2
  exit 1
}

sdk="$(xcrun --sdk appletvsimulator --show-sdk-version)"
runtime_of() {
  xcrun simctl list -j runtimes tvOS | jq -r --arg sdk "$sdk" '[.runtimes[] | select(.isAvailable and (.version == $sdk or (.version | startswith($sdk + "."))))] | last | .identifier // empty'
}
runtime="$(runtime_of)"
if [ -z "$runtime" ]; then
  echo "Downloading the tvOS $sdk simulator runtime (about 8 GB)"
  xcodebuild -downloadPlatform tvOS
  runtime="$(runtime_of)"
fi

step 'Install'
bun install --frozen-lockfile

# The fixture server and the app build would each run the libraries' build (it starts
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

# CocoaPods fetches the Hermes tarball with curl, which waits out a stalled mirror for
# good. Its own curlrc drops a transfer under 100 KB/s for 30 seconds and retries,
# without touching ~/.curlrc.
step 'Build for the Apple TV simulator'
printf 'speed-limit = 102400\nspeed-time = 30\nretry = 5\n' > "$WORK/.curlrc"
CURL_HOME="$WORK" bunx nx run @raven/app:build:tvos --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails, and ios/ is shared with the iPhone
# build, so this checks it is the TV project with its pods installed.
step 'Check the Apple TV pods'
grep -q 'SDKROOT = appletvos' apps/raven/app/ios/raven.xcodeproj/project.pbxproj
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock

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

step 'Boot the Apple TV simulator'
device="$(xcrun simctl list -j devices | jq -r --arg name "$TVOS_SIMULATOR" --arg runtime "$runtime" '.devices[$runtime][]? | select(.name == $name and .isAvailable) | .udid' | head -n 1)"
if [ -z "$device" ]; then
  device="$(xcrun simctl create "$TVOS_SIMULATOR" "$DEVICE_TYPE" "$runtime")"
fi
xcrun simctl boot "$device" 2> /dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$device"
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" "$APP"

step 'Apple TV end to end'
bunx nx run @raven/app:e2e:tvos "$@"
xcrun simctl io "$device" screenshot "$WORK/raven-tv.png" > /dev/null
echo "The screen the flow ended on: $WORK/raven-tv.png"
