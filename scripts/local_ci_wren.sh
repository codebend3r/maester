#!/usr/bin/env bash
# Wren's iPhone and iPad jobs, top to bottom, sourced by ci_wren.sh and ci_wren_ipad.sh once each
# has named its own:
#
#   DEVICE          how the step names call it: "iPhone", "iPad"
#   WREN_SIMULATOR  CI's simulator, by name
#   FAMILY          its product family, and CI_TYPE the device type CI boots
#   E2E_TARGET      the Nx target that runs the flows
#
# One build runs on both. Run again, it reuses the simulator and a fixture server already
# listening. The arguments are Nx's, for the flows.
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "${BASH_SOURCE[0]}")/local_ci_app.sh"

WREN_APP=apps/wren/wren-app/build/ios/Build/Products/Release-iphonesimulator/Wren.app

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

step "Boot the $DEVICE simulator"
find_device_type "$FAMILY" "$CI_TYPE"
boot_simulator "$WREN_SIMULATOR" "$DEVICE_TYPE"

step 'Build Wren for the iPhone and iPad simulator'
CURL_HOME="$WORK" bunx nx run @wren/app:build:ios --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails.
step "Check Wren's pods"
cmp apps/wren/wren-app/ios/Podfile.lock apps/wren/wren-app/ios/Pods/Manifest.lock

step "Install Wren on the $DEVICE simulator"
xcrun simctl bootstatus "$SIM_DEVICE" -b
skip_keyboard_tutorial
xcrun simctl install "$SIM_DEVICE" "$WREN_APP"

await_fixture

# Named by its id, so the flows run on this simulator even with another one booted.
step 'Wren end to end'
bunx nx run "$E2E_TARGET" "$@" -- --device "$SIM_DEVICE"
