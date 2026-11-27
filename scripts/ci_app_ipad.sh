#!/usr/bin/env bash
# Runs the 🎬 E2E Raven iPad job on this Mac: the iPhone job's build (one build for both), on an iPad simulator of its own, with every flow a finger drives. An iPad moves by
# the side menu where an iPhone has a tab bar, so the same flows cover both layouts.
#
#   bun run ci:app:ipad                         every step
#   bun run ci:app:ipad -- --skip-nx-cache      the flows for real, even on a cached pass
#   bun run ci:app:ipad:simulator               boots the iPad simulator
#   bun run ci:app:ipad:install                 installs the build on the simulator
#   bun run ci:app:ipad:e2e                     the Maestro flows (takes --skip-nx-cache)
#
# The tools, the build and the pods check are the iPhone job's: `ci:app:ios:<step>`.
set -euo pipefail

JOB=ci:app:ipad
DEVICE=iPad
SIMULATOR=raven-pad
FAMILY=iPad
CI_TYPE=iPad-A16
E2E_TARGET=@raven/app:e2e:ipad

# shellcheck source=scripts/local_ci_ios.sh
source "$(dirname "$0")/local_ci_ios.sh"

run_steps "$@"
