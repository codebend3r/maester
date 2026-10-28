#!/usr/bin/env bash
# Runs the 📺 App on Apple TV job from pull-request-checks.yml on this Mac: the
# libraries, the fixture server, the Release build for the Apple TV simulator through
# ccache, the pods check, the simulator and the XCUITest the Siri Remote drives.
#
#   bun run ci:app:tvos                         every step
#   bun run ci:app:tvos -- --skip-nx-cache      the flow for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

# The simulator e2e:tvos tests on, by name; an Nx input of e2e:tvos.
export TVOS_SIMULATOR=raven-tv
FAILURE_HINT="The test's result bundle: apps/raven/app/build/tvos-e2e/Logs/Test; $FAILURE_HINT"

require_apple_tools tvOS appletvsimulator
prepare_app

step 'Build for the Apple TV simulator'
CURL_HOME="$WORK" bunx nx run @raven/app:build:tvos --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails, and ios/ is shared with the iPhone
# build, so this checks it is the TV project with its pods installed.
step 'Check the Apple TV pods'
grep -q 'SDKROOT = appletvos' apps/raven/app/ios/raven.xcodeproj/project.pbxproj
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock

wait_for_fixture

step 'Boot the Apple TV simulator'
boot_simulator "$TVOS_SIMULATOR" com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K
xcrun simctl bootstatus "$SIM_DEVICE" -b
xcrun simctl install "$SIM_DEVICE" apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app

step 'Apple TV end to end'
bunx nx run @raven/app:e2e:tvos "$@"
xcrun simctl io "$SIM_DEVICE" screenshot "$WORK/raven-tv.png" > /dev/null
echo "The simulator's screen now: $WORK/raven-tv.png"
