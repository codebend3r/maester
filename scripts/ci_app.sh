#!/usr/bin/env bash
# The steps the device app's local jobs share, one per root script, so each runs on its
# own with the job's environment (`ci_app_ios.sh` and `ci_app_android_tv.sh` run them in
# order):
#
#   bun run ci:app:install         bun install --frozen-lockfile
#   bun run ci:app:libraries       the libraries the fixture server and the app read
#   bun run ci:app:fixture         the fixture server on :8490, in the foreground
#   bun run ci:app:fixture:wait    waits up to three minutes for it to answer
set -euo pipefail
# shellcheck source=scripts/local_ci_app.sh
source "$(dirname "$0")/local_ci_app.sh"

step_install() { install_dependencies; }
step_libraries() { build_libraries; }
step_fixture() { run_fixture; }
step_fixture_wait() { await_fixture; }

run_steps "$@"
