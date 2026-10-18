#!/usr/bin/env bash
# Asks Claude Code, headless, whether the commits about to be pushed follow
# CLAUDE.md: the judgement rules no linter checks (one object parameter, a
# guard at every boundary, comments only for the why, containers drive layout,
# identifiers through constants). Runs as the last pre-push job, after every
# deterministic check has passed, and as `bun run audit` by hand. It needs a
# signed-in `claude` and the network; the deterministic checks do not.
#
# A long branch's diff is too big for one review, so the changed files are
# grouped by Nx project and each group is cut into chunks of at most
# CHUNK_BYTES of diff, on file boundaries. The chunks are reviewed in
# parallel, JOBS at a time, and any violation or failed review stops the push.
set -euo pipefail

CHUNK_BYTES=200000
JOBS=8
# Haiku at medium effort keeps the push fast; the deterministic checks have
# already caught everything a tool can.
MODEL=claude-sonnet-5-5
EFFORT=medium

schema='{
  "type": "object",
  "properties": {
    "violations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "rule": { "type": "string" },
          "problem": { "type": "string" }
        },
        "required": ["file", "line", "rule", "problem"],
        "additionalProperties": false
      }
    }
  },
  "required": ["violations"],
  "additionalProperties": false
}'

# Reviews one chunk: the files listed, NUL-separated, in `files`, which belong
# to `area`, and writes claude's JSON reply to `out`.
review_chunk() {
  local base="$1" files="$2" area="$3" out="$4"
  local diff
  diff="$(xargs -0 git diff "$base" HEAD -- < "$files")"

  local prompt="You are auditing part of a diff against this repository's CLAUDE.md files before it is pushed. This part covers ${area}; other parts of the same diff are reviewed separately.

Read CLAUDE.md at the repository root, then the CLAUDE.md of the product folder these files belong to (apps/<product>/CLAUDE.md), if there is one. Those files are the only rules you enforce; do not invent rules of your own, and do not report style preferences the files do not state.

The deterministic checks (oxlint, gale, knip, the dead-css check, typecheck, tests) have already passed on this diff, so a rule those tools enforce is not what you are looking for. Look for the rules only a reader can check, among them: one object parameter instead of positional ones; a type guard at every boundary where untrusted data enters; a type derived from its constant rather than written beside it; a string literal used as an identifier instead of a constant; comments that restate the code; dead code kept 'for later'; containers driving layout and tokens instead of literal values in SCSS; wording with em or en dashes.

Report only violations the diff introduces: a rule broken by a line it adds, or by a change that makes a line break a rule it kept before. A line that broke a rule before the diff and breaks it the same way after is not a violation, even when the diff touches that line, for example to remove an \`export\` or rename a symbol. Each violation names the file, the line number in the new file, the rule as the CLAUDE.md states it (quote it), and what the line does wrong. When you are not sure a line breaks a rule, leave it out: a false report blocks a push. An empty list means this part passes.

The diff:

$diff"

  printf '%s' "$prompt" | claude -p \
    --model "$MODEL" \
    --effort "$EFFORT" \
    --output-format json \
    --json-schema "$schema" \
    --allowedTools Read Glob Grep \
    --permission-mode default > "$out" || true
}

if [ "${1:-}" = "--chunk" ]; then
  review_chunk "$2" "$3" "$(cat "$4")" "$5"
  exit 0
fi

if ! command -v claude > /dev/null; then
  echo "claude-audit: the claude CLI is not installed; see https://docs.claude.com/en/docs/claude-code" >&2
  exit 1
fi

# Audits the commits since origin/main, or since the commit given as the only
# argument (`bun run audit HEAD~1` reads the last commit alone).
base="${1:-$(git merge-base origin/main HEAD)}"
files="$(git diff --name-only "$base" HEAD -- . ':!bun.lock' ':!*.lock' ':!*.snap')"
if [ -z "$files" ]; then
  echo "claude-audit: nothing to audit"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The Nx project a file belongs to, else its product folder, else the workspace.
roots="$(git ls-files 'apps/*/*/package.json' 'libs/*/*/package.json' 'scripts/package.json' | sed 's#/package.json$##')"
area_of() {
  local root
  root="$(printf '%s\n' "$roots" | awk -v file="$1" 'index(file, $0 "/") == 1 { print; exit }')"
  if [ -n "$root" ]; then
    echo "$root"
  elif [[ "$1" =~ ^apps/[^/]+/ ]]; then
    echo "$(echo "$1" | cut -d/ -f1-2)"
  else
    echo "the workspace root"
  fi
}

chunks=0
area=""
size=0
while IFS=$'\t' read -r file_area file; do
  bytes="$(git diff "$base" HEAD -- "$file" | wc -c | tr -d ' ')"
  if [ "$file_area" != "$area" ] || { [ "$size" -gt 0 ] && [ $((size + bytes)) -gt "$CHUNK_BYTES" ]; }; then
    chunks=$((chunks + 1))
    area="$file_area"
    size=0
    printf '%s' "$area" > "$work/$chunks.area"
  fi
  printf '%s\0' "$file" >> "$work/$chunks.files"
  size=$((size + bytes))
done < <(printf '%s\n' "$files" | while IFS= read -r file; do printf '%s\t%s\n' "$(area_of "$file")" "$file"; done | sort)

echo "claude-audit: reviewing $(printf '%s\n' "$files" | wc -l | tr -d ' ') files in $chunks parts, $JOBS at a time"
seq 1 "$chunks" | xargs -P "$JOBS" -I{} bash "$0" --chunk "$base" "$work/{}.files" "$work/{}.area" "$work/{}.json"

failed="$(seq 1 "$chunks" | while IFS= read -r chunk; do
  reply="$work/$chunk.json"
  if [ ! -s "$reply" ]; then
    echo "  $(cat "$work/$chunk.area"): no reply"
  elif ! jq -e '.is_error == false and (.structured_output.violations | type) == "array"' "$reply" > /dev/null 2>&1; then
    echo "  $(cat "$work/$chunk.area"): $(jq -r '.result // "no structured reply"' "$reply" 2>/dev/null || echo 'unreadable reply')"
  fi
done)"
if [ -n "$failed" ]; then
  echo "claude-audit: some parts could not be reviewed:" >&2
  printf '%s\n' "$failed" >&2
  exit 1
fi

violations="$(jq -r -s '.[].structured_output.violations[] | "\(.file):\(.line): \(.problem)\n    rule: \(.rule)"' "$work"/*.json)"
if [ -n "$violations" ]; then
  echo "claude-audit: the diff breaks CLAUDE.md:" >&2
  printf '%s\n' "$violations" >&2
  exit 1
fi

echo "claude-audit: the diff follows CLAUDE.md"
