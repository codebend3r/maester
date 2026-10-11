#!/usr/bin/env bash
# A package.json script runs one command; steps chain through
# `bun run --sequential` (or `--parallel`), never `&&`, `||` or `;`. Runs as the
# root project's `one-command-per-script` target, so in `verify`, `affected`
# and the PR checks. The pattern lives here, not in package.json, so it can't
# match itself.
set -euo pipefail

chained="$(git grep -nE '&&|\|\||; ' -- 'package.json' '**/package.json' || true)"
if [ -n "$chained" ]; then
  echo "Split chained package.json scripts into their own and run them with bun run --sequential:" >&2
  echo "$chained" >&2
  exit 1
fi
