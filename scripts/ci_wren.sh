#!/usr/bin/env bash
# Runs the macOS half of the 🎵 Wren job from pull-request-checks.yml on this Mac: the
# libraries, the fixture server, the iPhone simulator, Wren's Release build through ccache,
# the pods check, the install and the Maestro flows. Run again, it reuses the simulator and a
# fixture server already listening.
#
#   bun run ci:wren                         every step
#   bun run ci:wren -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

# CI's simulator, by name and device type; a runtime with no such iPhone takes its newest.
WREN_SIMULATOR=wren-phone
WREN_DEVICE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-16
WREN_APP=apps/raven/music/build/ios/Build/Products/Release-iphonesimulator/Wren.app

export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1
FAILURE_HINT="Maestro's screenshots and logs: ~/.maestro/tests; $FAILURE_HINT"
# Maestro runs on Java; a shell that has not read ~/.zshrc may have none on its path.
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
fi

require_apple_tools iOS iphonesimulator
install_maestro
prepare_app

step 'Boot the iPhone simulator'
device_type="$(xcrun simctl list -j runtimes iOS | jq -er --arg runtime "$SIM_RUNTIME" --arg type "$WREN_DEVICE_TYPE" '.runtimes[] | select(.identifier == $runtime) | [.supportedDeviceTypes[] | select(.productFamily == "iPhone")] | (map(select(.identifier == $type)) + .) | first | .identifier')"
boot_simulator "$WREN_SIMULATOR" "$device_type"

step "Build Wren for the iPhone simulator"
CURL_HOME="$WORK" bunx nx run @raven/music:build:ios --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails.
step "Check Wren's pods"
cmp apps/raven/music/ios/Podfile.lock apps/raven/music/ios/Pods/Manifest.lock

step 'Install Wren on the iPhone simulator'
xcrun simctl bootstatus "$SIM_DEVICE" -b
xcrun simctl install "$SIM_DEVICE" "$WREN_APP"

wait_for_fixture

# Named by its id, so the flows run on this simulator even with another one booted.
step 'Wren end to end'
bunx nx run @raven/music:e2e "$@" -- --device "$SIM_DEVICE"
