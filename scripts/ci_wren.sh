#!/usr/bin/env bash
# Runs the 🎵 Build Wren iPhone job and its end to end job, which CI runs on two runners, on
# this Mac: the libraries, the fixture server, the iPhone simulator, Wren's Release build
# through ccache, the pods check, the install and the Maestro flows. Run again, it reuses the
# simulator and a fixture server already listening.
#
#   bun run ci:wren                         every step
#   bun run ci:wren -- --skip-nx-cache      the flows for real, even on a cached pass
set -euo pipefail

DEVICE=iPhone
WREN_SIMULATOR=wren-phone
FAMILY=iPhone
CI_TYPE=iPhone-16
E2E_TARGET=@wren/app:e2e

# shellcheck source=scripts/local_ci_wren.sh
source "$(dirname "$0")/local_ci_wren.sh"
