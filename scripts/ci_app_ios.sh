#!/usr/bin/env bash
# Runs the 📱 App on iPhone and iPad job from pull-request-checks.yml on this Mac:
# the libraries, the fixture server, the iPhone simulator, the Release build through
# ccache, the pods check, the install and the Maestro flows.
#
#   bun run ci:app:ios                         every step
#   bun run ci:app:ios -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

# Expo's Podfile points Xcode's compilers at ccache, so a rebuild reuses unchanged objects.
export USE_CCACHE=1
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1
FAILURE_HINT="Maestro's screenshots and logs: ~/.maestro/tests; $FAILURE_HINT"
# Maestro runs on Java; a shell that has not read ~/.zshrc may have none on its path.
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
fi

step 'Tools'
require_apple_silicon
require_xcode
brew_install ffmpeg ffmpeg
brew_install jq jq
brew_install pod cocoapods
brew_install ccache ccache
install_maestro
require_node
runtime="$(simulator_runtime iOS iphonesimulator)"

step 'Install'
bun install --frozen-lockfile

build_libraries
start_fixture

# CI's iPhone 16, or the runtime's newest iPhone when it has none.
step 'Boot the iPhone simulator'
type="$(xcrun simctl list -j runtimes iOS | jq -er --arg runtime "$runtime" '.runtimes[] | select(.identifier == $runtime) | [.supportedDeviceTypes[] | select(.productFamily == "iPhone")] | (map(select(.identifier | endswith(".iPhone-16"))) + .) | first | .identifier')"
device="$(boot_simulator raven-phone "$runtime" "$type")"

step 'Build for the iPhone and iPad simulator'
CURL_HOME="$(curl_home)" bunx nx run @raven/app:build:ios --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails.
step 'Check the iPhone and iPad pods'
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock

step 'Install the build on the iPhone simulator'
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app

wait_for_fixture

step 'App end to end'
bunx nx run @raven/app:e2e "$@"
