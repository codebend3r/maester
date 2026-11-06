#!/usr/bin/env bash
# Runs the 📱 App on iPhone and iPad job from main-native-checks.yml on this Mac: the
# libraries, the fixture server, the iPhone simulator, the Release build through ccache,
# the pods check, the install and the Maestro flows. Each step is a root script of its
# own, which the whole job runs in order:
#
#   bun run ci:app:ios                          every step
#   bun run ci:app:ios -- --skip-nx-cache       the flows for real, even on a cached pass
#   bun run ci:app:ios:tools                    Homebrew's tools, Maestro, the simulator runtime
#   bun run ci:app:install                      bun install
#   bun run ci:app:libraries                    the libraries' build
#   bun run ci:app:fixture                      the fixture server, in the foreground
#   bun run ci:app:ios:simulator                boots the iPhone simulator
#   bun run ci:app:ios:build                    the Release build for the simulator
#   bun run ci:app:ios:pods                     checks pod install finished
#   bun run ci:app:ios:install                  installs the build on the simulator
#   bun run ci:app:fixture:wait                 waits for the fixture server
#   bun run ci:app:ios:e2e                      the Maestro flows (takes --skip-nx-cache)
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

SIMULATOR=raven-phone
APP=apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/raven.app

# Sets IPHONE_TYPE to CI's iPhone 16, or the runtime's newest iPhone when it has none, and
# SIM_DEVICE to the simulator of that type.
find_iphone() {
  apple_runtime iOS iphonesimulator
  IPHONE_TYPE="$(xcrun simctl list -j runtimes iOS | jq -er --arg runtime "$SIM_RUNTIME" '.runtimes[] | select(.identifier == $runtime) | [.supportedDeviceTypes[] | select(.productFamily == "iPhone")] | (map(select(.identifier | endswith(".iPhone-16"))) + .) | first | .identifier')"
  find_simulator "$SIMULATOR" "$IPHONE_TYPE"
}

step_tools() {
  require_apple_tools iOS iphonesimulator
  install_maestro
}

step_simulator() {
  step 'Boot the iPhone simulator'
  find_iphone
  boot_simulator "$SIMULATOR" "$IPHONE_TYPE"
}

step_build() {
  step 'Build for the iPhone and iPad simulator'
  CURL_HOME="$WORK" bunx nx run @raven/app:build:ios --excludeTaskDependencies
}

# `expo prebuild` exits 0 when `pod install` fails.
step_pods() {
  step 'Check the iPhone and iPad pods'
  cmp apps/raven/app/ios/Podfile.lock apps/raven/app/ios/Pods/Manifest.lock
}

step_install() {
  step 'Install the build on the iPhone simulator'
  find_iphone
  xcrun simctl bootstatus "$SIM_DEVICE" -b
  xcrun simctl install "$SIM_DEVICE" "$APP"
}

step_e2e() {
  step 'App end to end'
  bunx nx run @raven/app:e2e "$@"
}

# The whole job, each step through its own root script.
run_job() {
  start_job ci:app:ios:tools
  bun run ci:app:ios:simulator
  bun run ci:app:ios:build
  bun run ci:app:ios:pods
  bun run ci:app:ios:install
  bun run ci:app:fixture:wait
  bun run ci:app:ios:e2e "$@"
}

run_steps "$@"
