#!/usr/bin/env bash
# A comment that spans lines is one /* */ block, never stacked // lines (CLAUDE.md).
# Lint directives (oxlint-, eslint-, @ts-, triple-slash) are not prose and never count.
# Runs as the root project's `comment-style` target, so in `verify`, `affected` and the PR checks.
set -euo pipefail

stacked="$(git ls-files -z '*.ts' '*.tsx' '*.scss' | xargs -0 awk '
  FNR == 1 { run = 0 }
  /^[[:space:]]*\/\/\// || /^[[:space:]]*\/\/[[:space:]]*(oxlint-|eslint-|@ts-)/ { run = 0; next }
  /^[[:space:]]*\/\// { run++; if (run == 2) print FILENAME ":" FNR - 1; next }
  { run = 0 }
')"
if [ -n "$stacked" ]; then
  echo "Stacked // comments: turn each run into one /* */ block (file:first line):" >&2
  echo "$stacked" >&2
  exit 1
fi
