#!/usr/bin/env bash
# Runs the ✅ Checks job's steps from pull-request-checks.yml inside an Ubuntu
# 24.04 container, so a failure that only shows on CI (a Linux-only path, a
# missing tool, a cold cache) reproduces here. The working tree is copied in,
# minus whatever .gitignore skips, and installed fresh, so the host's macOS
# node_modules and Nx cache never leak in. Nx Cloud is off, as it is for a
# fork's PR.
#
#   bun run ci:docker                      all steps
#   bun run ci:docker -- test lint         only these steps, in this order
#   PLATFORM=linux/amd64 bun run ci:docker CI's x86_64 (slow under emulation)
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=maester-ci
PLATFORM="${PLATFORM:-linux/arm64}"
APP_NODE_VERSION="$(sed -nE 's/^ *APP_NODE_VERSION: *([0-9.]+).*/\1/p' .github/workflows/pull-request-checks.yml)"
BUN_VERSION="$(sed -nE 's/^ *"packageManager": *"bun@([0-9.]+)".*/\1/p' package.json)"

docker build \
  --platform "$PLATFORM" \
  --build-arg "NODE_VERSION=$APP_NODE_VERSION" \
  --build-arg "BUN_VERSION=$BUN_VERSION" \
  --tag "$IMAGE" \
  --file scripts/ci.Dockerfile \
  scripts

docker run --rm \
  --platform "$PLATFORM" \
  --volume "$PWD:/src:ro" \
  --env CI=true \
  --env NX_NO_CLOUD=true \
  --env UV_FROZEN=1 \
  "$IMAGE" \
  bash -euo pipefail -c '
    rsync -a --filter=":- .gitignore" /src/ /work/
    cd /work
    bun install --frozen-lockfile
    steps=("$@")
    [ ${#steps[@]} -eq 0 ] && steps=(format:check typecheck spellcheck lint test dead-code dead-css test:screens build)
    for step in "${steps[@]}"; do
      echo "=== $step ==="
      case "$step" in
        test | test:screens) bun run "$step" --outputStyle=static ;;
        *) bun run "$step" ;;
      esac
    done
  ' ci "$@"
