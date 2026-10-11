#!/usr/bin/env bash
# Every script and config is TypeScript; a tracked JavaScript file is a mistake.
# Runs as the root project's `typescript-only` target, so in `verify`,
# `affected` and the PR checks.
set -euo pipefail

js="$(git ls-files '*.js' '*.jsx' '*.mjs' '*.cjs')"
if [ -n "$js" ]; then
  echo "Only TypeScript belongs in the repo. Convert these to .ts or .tsx:" >&2
  echo "$js" >&2
  exit 1
fi
