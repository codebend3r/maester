#!/usr/bin/env bash
# What the device app's iPhone and iPad jobs share on top of local_ci_app.sh, sourced by
# ci_app_ios.sh and ci_app_ipad.sh once each has named its own:
#
#   JOB          the root script of the whole job, whose own steps are `$JOB:<step>`
#   DEVICE       how the step names call it: "iPhone", "iPad"
#   SIMULATOR    the simulator the job makes, boots and drives, and no other
#   FAMILY       the simulator's product family, and CI_TYPE the device type CI boots
#   E2E_TARGET   the Nx target that runs the flows
#
# One build runs on both, so the tools, the build and the pods check are `ci:app:ios:<step>`
# for either job; the simulator, the install and the flows are the job's own.
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "${BASH_SOURCE[0]}")/local_ci_app.sh"

export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_CLI_NO_ANALYTICS=1
FAILURE_HINT="Maestro's screenshots and logs: ~/.maestro/tests; $FAILURE_HINT"
# Maestro runs on Java; a shell that has not read ~/.zshrc may have none on its path.
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
fi

APP=apps/raven/app/build/ios/Build/Products/Release-iphonesimulator/Raven.app

# Sets DEVICE_TYPE (find_device_type) and SIM_DEVICE to the simulator of that type.
find_device() {
  apple_runtime iOS iphonesimulator
  find_device_type "$FAMILY" "$CI_TYPE"
  find_simulator "$SIMULATOR" "$DEVICE_TYPE"
}

step_tools() {
  require_apple_tools iOS iphonesimulator
  install_maestro
}

step_simulator() {
  step "Boot the $DEVICE simulator"
  find_device
  boot_simulator "$SIMULATOR" "$DEVICE_TYPE"
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
  step "Install the build on the $DEVICE simulator"
  find_device
  xcrun simctl bootstatus "$SIM_DEVICE" -b
  skip_keyboard_tutorial
  xcrun simctl install "$SIM_DEVICE" "$APP"
}

# Named by its id, so the flows run on this simulator even with another one booted.
step_e2e() {
  step 'App end to end'
  find_device
  bunx nx run "$E2E_TARGET" "$@" -- --device "$SIM_DEVICE"
}

# The whole job, each step through its own root script.
run_job() {
  start_job ci:app:ios:tools
  bun run "$JOB:simulator"
  bun run ci:app:ios:build
  bun run ci:app:ios:pods
  bun run "$JOB:install"
  bun run ci:app:fixture:wait
  bun run "$JOB:e2e" "$@"
}
