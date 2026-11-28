#!/usr/bin/env bash
# Runs the 🎵 E2E Wren iPad job on this Mac: the iPhone job's build (one build for both), on an iPad simulator of its own, with the same flows.
#
#   bun run ci:wren:ipad                         every step
#   bun run ci:wren:ipad -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail

DEVICE=iPad
WREN_SIMULATOR=wren-pad
FAMILY=iPad
CI_TYPE=iPad-A16
E2E_TARGET=@wren/app:e2e:ipad

# shellcheck source=scripts/local_ci_wren.sh
source "$(dirname "$0")/local_ci_wren.sh"
