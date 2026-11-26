#!/usr/bin/env bash
# Finds the builds a push to main can run its end to end jobs on, for the raven-native-select
# action: the pull request the pushed commit merged, that pull request's head commit, and its passing
# pull request checks run, whose artifacts are named for the head commit. Run from a checkout of the
# pushed commit.
#
# Prints, as lines for GITHUB_OUTPUT: `run_id` and `sha` (the run and the head commit), and
# `app`, `music` or `desktop` as `true` for each group whose every build the end to end jobs read
# is in that run and has not expired. It prints nothing for a push with no pull request, a manual
# run, or a lookup that fails, so the caller builds what it tests; it never fails the run. What it
# found, and why it found nothing, go to stderr as notices.
#
# Reads GH_TOKEN, REPO (owner/name), SHA (the pushed commit) and EVENT (the workflow's event).
set -uo pipefail

nothing() {
  echo "::notice::$1, so this run builds what it tests." >&2
  exit 0
}

[ "$EVENT" = push ] || nothing "Not a push to main"
merged="$(gh api "repos/$REPO/commits/$SHA/pulls" --jq 'map(select(.merged_at != null)) | .[0] // empty | "\(.number) \(.head.sha)"' || true)"
[ -n "$merged" ] || nothing "No merged pull request names $SHA"
read -r number head <<< "$merged"
run="$(gh api "repos/$REPO/actions/workflows/pull-request-checks.yml/runs?head_sha=$head&event=pull_request&status=success&per_page=1" --jq '.workflow_runs[0].id // empty' || true)"
[ -n "$run" ] || nothing "Pull request #$number has no passing checks run for $head"
built="$(gh api --paginate "repos/$REPO/actions/runs/$run/artifacts?per_page=100" --jq '.artifacts[] | select(.expired | not) | .name' || true)"

# Whether the run holds every artifact named, each under the head commit.
has() {
  local name
  for name in "$@"; do
    grep -qxF "$name-$head" <<< "$built" || return 1
  done
}

echo "run_id=$run"
echo "sha=$head"
if has raven-app-ios-simulator raven-app-tvos-simulator raven-app-tvos-simulator-test-project raven-app-android-tv; then
  echo app=true
fi
if has raven-music-ios-simulator wren-tv-tvos-simulator wren-tv-tvos-simulator-test-project wren-tv-android-tv; then
  echo music=true
fi
if has raven-native-handoff; then
  echo desktop=true
fi

{
  echo "Pull request #$number built $head in run $run:"
  echo "$built"
  # A branch behind main when it merged was built without main's newer commits.
  if git fetch --quiet --depth=1 origin "$head" && [ "$(git rev-parse "$head^{tree}")" != "$(git rev-parse "HEAD^{tree}")" ]; then
    echo "::notice::Pull request #$number was not level with main when it merged, so its builds are of $head and not exactly of $SHA."
  fi
} >&2
