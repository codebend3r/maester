#!/usr/bin/env bash
# Production uses the same commit-based build number as CI, even before CI
# creates its tag. Previews keep package.json's version.
set -euo pipefail

unset VITE_RAVEN_VERSION
if [ "${CONTEXT:-}" = production ] && [ "${BRANCH:-}" = main ]; then
  # Counting first-parent commits requires full history. Fail rather than
  # silently publish a misleading version when fetching is unavailable.
  # Netlify keeps its clone between builds, so a tag moved on GitHub (a build
  # number reused after a force push) is stale there. --force takes GitHub's,
  # where a plain fetch refuses to clobber it and fails every build after.
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
    git fetch --force --unshallow --tags origin
  else
    git fetch --force --tags origin
  fi

  tag=$(git tag --points-at HEAD --list 'v[0-9]*' | head -n 1)
  if [ -n "$tag" ]; then
    export VITE_RAVEN_VERSION=${tag#v}
  else
    VITE_RAVEN_VERSION=$(bash scripts/bump_version.sh --print build)
    export VITE_RAVEN_VERSION
  fi
fi
echo "VITE_RAVEN_VERSION=${VITE_RAVEN_VERSION:-unset}"

exec bunx nx run @raven/web:build
