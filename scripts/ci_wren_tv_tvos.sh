#!/usr/bin/env bash
# Runs the 🎵 Build Wren Apple TV job and its end to end job on this Mac, as raven's
# ci_app_tvos.sh does for raven: the libraries, the fixture server, Wren on TV's Release build
# for the Apple TV simulator through ccache, the pods check, the simulator and the XCUITest the
# Siri Remote drives.
#
#   bun run ci:wren:tv:tvos                         every step
#   bun run ci:wren:tv:tvos -- --skip-nx-cache      the flow for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

# The simulator e2e:tvos tests on, by name; an Nx input of e2e:tvos.
export TVOS_SIMULATOR=wren-tv
FAILURE_HINT="The test's result bundle: apps/wren/wren-tv/build/tvos-e2e/Logs/Test; $FAILURE_HINT"

require_apple_tools tvOS appletvsimulator
prepare_app

step 'Build Wren for the Apple TV simulator'
CURL_HOME="$WORK" bun run ci:wren:tv:tvos:build

# `expo prebuild` exits 0 when `pod install` fails.
step "Check Wren on TV's pods"
grep -q 'SDKROOT = appletvos' apps/wren/wren-tv/ios/Wren.xcodeproj/project.pbxproj
cmp apps/wren/wren-tv/ios/Podfile.lock apps/wren/wren-tv/ios/Pods/Manifest.lock

await_fixture

step 'Boot the Apple TV simulator'
boot_simulator "$TVOS_SIMULATOR" com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K
xcrun simctl bootstatus "$SIM_DEVICE" -b
xcrun simctl install "$SIM_DEVICE" apps/wren/wren-tv/build/tvos/Build/Products/Release-appletvsimulator/Wren.app

step 'Wren on Apple TV end to end'
bun run wren:tv:e2e:tvos "$@"
xcrun simctl io "$SIM_DEVICE" screenshot "$WORK/wren-tv.png" > /dev/null
echo "The simulator's screen now: $WORK/wren-tv.png"
