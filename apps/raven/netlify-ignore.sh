#!/usr/bin/env bash
# Netlify's build.ignore command: exit 0 to skip the build, anything else to
# build. Every successful production deploy costs credits, so a push to main
# never builds production: the release workflow (.github/workflows/release.yml)
# triggers that through each site's build hook, which the ignore command
# cannot cancel, so a release is one deploy per site. A deploy preview is
# free but slow, so it is skipped when none of the paths given as arguments
# (the site and the libraries it bundles), nor the workspace paths every site
# builds with, changed since the last build. Netlify runs this from the base directory,
# the repo root, with CONTEXT, COMMIT_REF and CACHED_COMMIT_REF, the commit
# it last built; a first build, a retry or an unknown last build goes ahead.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "netlify-ignore.sh needs the paths whose changes mean a build" >&2
  exit 1
fi
set -- "$@" apps/raven/netlify-ignore.sh tooling tsconfig.base.json nx.json package.json bun.lock
if [ "${CONTEXT:-}" = production ]; then
  echo "Production builds come from the release workflow's build hook; skipping this push."
  exit 0
fi
if [ -z "${CACHED_COMMIT_REF:-}" ] || [ -z "${COMMIT_REF:-}" ]; then
  echo "No last build to compare against; building."
  exit 1
fi
if [ "$CACHED_COMMIT_REF" = "$COMMIT_REF" ]; then
  echo "Same commit as the last build; building."
  exit 1
fi
if ! git cat-file -e "$CACHED_COMMIT_REF^{commit}" 2>/dev/null; then
  echo "Last built commit $CACHED_COMMIT_REF is not in the clone; building."
  exit 1
fi
if git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- "$@"; then
  echo "Nothing under $* changed since $CACHED_COMMIT_REF; skipping the build."
  exit 0
fi
echo "Changes under $* since $CACHED_COMMIT_REF; building."
exit 1
