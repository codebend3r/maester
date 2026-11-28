#!/usr/bin/env bash
# Runs the 🎬 Build Raven iPhone job and its end to end job, which CI runs on two runners, on this
# Mac: the libraries, the fixture server, the iPhone simulator, the Release build through
# ccache, the pods check, the install and the Maestro flows. Each step is a root script of its
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

JOB=ci:app:ios
DEVICE=iPhone
SIMULATOR=raven-phone
FAMILY=iPhone
CI_TYPE=iPhone-16
E2E_TARGET=@raven/app:e2e

# shellcheck source=scripts/local_ci_ios.sh
source "$(dirname "$0")/local_ci_ios.sh"

run_steps "$@"
