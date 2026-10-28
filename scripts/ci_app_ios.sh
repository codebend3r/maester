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

# CI's iPhone 16, or the runtime's newest iPhone when it has none.
step 'Boot the iPhone simulator'
device_type="$(xcrun simctl list -j runtimes iOS | jq -er --arg runtime "$SIM_RUNTIME" '.runtimes[] | select(.identifier == $runtime) | [.supportedDeviceTypes[] | select(.productFamily == "iPhone")] | (map(select(.identifier | endswith(".iPhone-16"))) + .) | first | .identifier')"
boot_simulator raven-phone "$device_type"

step 'Build for the iPhone and iPad simulator'
CURL_HOME="$WORK" bunx nx run @raven/app:build:ios --excludeTaskDependencies

# `expo prebuild` exits 0 when `pod install` fails.
step 'Check the iPhone and iPad pods'
cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock

step 'Install the build on the iPhone simulator'
xcrun simctl bootstatus "$SIM_DEVICE" -b
xcrun simctl install "$SIM_DEVICE" apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app

wait_for_fixture

step 'App end to end'
bunx nx run @raven/app:e2e "$@"
