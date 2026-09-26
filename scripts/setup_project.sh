#!/usr/bin/env bash
# Create the "maester roadmap" GitHub Project (v2), add its fields, link it to
# the repo, and add every issue with Epic/Phase/Size/Priority filled from the
# issue's title prefix and labels. Safe to re-run: existing project, fields and
# items are reused.
#
# Prereq: gh auth refresh -s project,read:project
set -euo pipefail

OWNER=codebend3r
REPO=codebend3r/maester
TITLE="maester roadmap"

if ! gh auth status 2>&1 | grep -q "project"; then
  echo "✗ token lacks the project scope. Run:  gh auth refresh -s project,read:project"
  exit 1
fi

number=$(gh project list --owner "$OWNER" --format json --limit 100 | jq -r --arg t "$TITLE" '.projects[] | select(.title==$t) | .number' | head -1)
if [ -z "$number" ]; then
  number=$(gh project create --owner "$OWNER" --title "$TITLE" --format json | jq -r .number)
  echo "→ created project #$number"
else
  echo "→ reusing project #$number"
fi
gh project link "$number" --owner "$OWNER" --repo "$REPO" >/dev/null 2>&1 || true

ensure_field() {
  local name=$1 options=$2
  if ! gh project field-list "$number" --owner "$OWNER" --format json | jq -e --arg n "$name" '.fields[] | select(.name==$n)' >/dev/null; then
    gh project field-create "$number" --owner "$OWNER" --name "$name" --data-type SINGLE_SELECT --single-select-options "$options" >/dev/null
    echo "→ field $name"
  fi
}
ensure_field Epic "E0,E1,E2,E3,E4,E5,E6,E7,E8"
ensure_field Phase "M1,M2,M3,M4,M5"
ensure_field Size "S,M,L"
ensure_field Priority "P0,P1,P2"

project_id=$(gh project view "$number" --owner "$OWNER" --format json | jq -r .id)
fields=$(gh project field-list "$number" --owner "$OWNER" --format json)
field_id() { echo "$fields" | jq -r --arg n "$1" '.fields[] | select(.name==$n) | .id'; }
option_id() { echo "$fields" | jq -r --arg n "$1" --arg o "$2" '.fields[] | select(.name==$n) | .options[] | select(.name==$o) | .id'; }

existing_items=$(gh project item-list "$number" --owner "$OWNER" --format json --limit 500)

gh issue list -R "$REPO" --state all --limit 500 --json number,title,url,labels,milestone | jq -c '.[]' | while read -r issue; do
  url=$(echo "$issue" | jq -r .url)
  title=$(echo "$issue" | jq -r .title)
  item_id=$(echo "$existing_items" | jq -r --arg u "$url" '.items[] | select(.content.url==$u) | .id' | head -1)
  if [ -z "$item_id" ]; then
    item_id=$(gh project item-add "$number" --owner "$OWNER" --url "$url" --format json | jq -r .id)
  fi
  epic=$(echo "$title" | sed -E 's/^\[(E[0-9]+)(\.[0-9]+)?\].*/\1/')
  phase=$(echo "$issue" | jq -r '.milestone.title' | cut -d' ' -f1)
  size=$(echo "$issue" | jq -r '.labels[].name | select(startswith("size:"))' | cut -d: -f2)
  prio=$(echo "$issue" | jq -r '.labels[].name | select(test("^P[0-2]$"))')
  set_field() {
    [ -z "$2" ] && return 0
    gh project item-edit --project-id "$project_id" --id "$item_id" --field-id "$(field_id "$1")" --single-select-option-id "$(option_id "$1" "$2")" >/dev/null
  }
  set_field Epic "$epic"
  set_field Phase "$phase"
  set_field Size "$size"
  set_field Priority "$prio"
  echo "  $title"
done

echo "✓ board ready: https://github.com/users/$OWNER/projects/$number"
