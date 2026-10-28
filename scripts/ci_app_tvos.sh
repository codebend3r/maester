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

# Expo's Podfile points Xcode's compilers at ccache, so a rebuild reuses unchanged objects.
export USE_CCACHE=1
# The simulator e2e:tvos tests on, by name; an Nx input of e2e:tvos.
export TVOS_SIMULATOR=raven-tv
FAILURE_HINT="The test's result bundle: apps/raven/app/build/tvos-e2e/Logs/Test; $FAILURE_HINT"

step 'Tools'
require_apple_silicon
require_xcode
brew_install ffmpeg ffmpeg
brew_install jq jq
brew_install pod cocoapods
brew_install ccache ccache
require_node
runtime="$(simulator_runtime tvOS appletvsimulator)"

step 'Install'
bun install --frozen-lockfile

build_libraries
start_fixture

step 'Build for the Apple TV simulator'
CURL_HOME="$(curl_home)" bunx nx run @raven/app:build:tvos --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails, and ios/ is shared with the iPhone
# build, so this checks it is the TV project with its pods installed.
step 'Check the Apple TV pods'
grep -q 'SDKROOT = appletvos' apps/raven/app/ios/raven.xcodeproj/project.pbxproj
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock

wait_for_fixture

step 'Boot the Apple TV simulator'
device="$(boot_simulator "$TVOS_SIMULATOR" "$runtime" com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K)"
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" apps/raven/app/build/tvos/Build/Products/Release-appletvsimulator/raven.app

step 'Apple TV end to end'
bunx nx run @raven/app:e2e:tvos "$@"
xcrun simctl io "$device" screenshot "$WORK/raven-tv.png" > /dev/null
echo "The screen the flow ended on: $WORK/raven-tv.png"
