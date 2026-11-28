#!/usr/bin/env bash
# Runs every end to end suite CI has, one after another on this machine, and says which passed.
# Unlike a chain that stops at the first failure, it runs them all, tries a failed suite once more
# (a pass then is called flaky), keeps each suite's whole output in a log of its own, and ends with
# a table. Each suite is the root script its CI job's local twin is, so a failure here is debugged
# with that script and its skill. A Mac runs suites 1 to 15; Windows runs 16 alone.
#
#   bun run e2e                     every suite this system can run, past Nx's cache
#   bun run e2e --list              the suites in order, and nothing run
#   bun run e2e --only 6,7          those suites alone, by number
#   bun run e2e --from 10           from that suite on
#   bun run e2e --cached            let Nx restore a suite that passed with the same inputs
#   bun run e2e --no-retry          a failure is a failure, with no second try
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# Number, the system it runs on, its name, and the root script that runs it, in the order run:
# the quick browser and desktop suites first, then each app's build and flows, the iPhone's build
# before the iPad's, which reuses it.
SUITES='1|mac|Raven web|web:e2e
2|mac|Wren web|wren:web:e2e
3|mac|maester.tv|splash:e2e
4|mac|Raven for Mac|ci:desktop:e2e
5|mac|Wren for Mac|wren:desktop:e2e
6|mac|Raven on iPhone|ci:app:ios
7|mac|Raven on iPad|ci:app:ipad
8|mac|Wren on iPhone|ci:wren
9|mac|Wren on iPad|ci:wren:ipad
10|mac|Raven on Apple TV|ci:app:tvos
11|mac|Raven on Android TV|ci:app:android-tv
12|mac|Raven on Android phones|ci:app:android
13|mac|Wren on Android phones|ci:wren:android
14|mac|Wren on Apple TV|ci:wren:tv:tvos
15|mac|Wren on Android TV|ci:wren:tv:android-tv
16|windows|Raven for Windows|desktop:e2e:windows'

# The ports the desktop apps' web hosts take, fixed in each app; a running app fails its suite.
RAVEN_HOST_PORT=47484
WREN_HOST_PORT=47485

usage() {
  echo 'Usage: bun run e2e [--list] [--only N,N] [--from N] [--cached] [--no-retry]' >&2
  exit 2
}

case "$(uname -s)" in
  Darwin) SYSTEM=mac ;;
  MINGW* | MSYS* | CYGWIN*) SYSTEM=windows ;;
  *) SYSTEM=other ;;
esac

IS_LIST=false
ONLY=''
FROM=1
CACHE_ARGS=(--skip-nx-cache)
TRIES=2
while [ $# -gt 0 ]; do
  case "$1" in
    --list) IS_LIST=true ;;
    --only) ONLY=",${2:-},"; shift ;;
    --from) FROM="${2:-}"; shift ;;
    --cached) CACHE_ARGS=() ;;
    --no-retry) TRIES=1 ;;
    *) usage ;;
  esac
  shift
done
case "$FROM" in '' | *[!0-9]*) usage ;; esac

# Whether a suite is one this run takes: on this system, and picked by --only or --from.
is_picked() {
  local number="$1" system="$2"
  [ "$system" = "$SYSTEM" ] || return 1
  if [ -n "$ONLY" ]; then
    case "$ONLY" in *",$number,"*) return 0 ;; *) return 1 ;; esac
  fi
  [ "$number" -ge "$FROM" ]
}

if [ "$IS_LIST" = true ]; then
  printf '%-3s %-25s %-23s %s\n' '#' 'Suite' 'Root script' 'Here'
  while IFS='|' read -r number system name script; do
    here='not picked'
    [ "$system" = "$SYSTEM" ] || here="no, $system only"
    is_picked "$number" "$system" && here='yes'
    printf '%-3s %-25s %-23s %s\n' "$number" "$name" "$script" "$here"
  done <<< "$SUITES"
  exit 0
fi

# Whether something listens on a loopback port, without lsof, which can hang on this Mac.
is_listening() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

picked_count=0
while IFS='|' read -r number system _ _; do
  is_picked "$number" "$system" && picked_count=$((picked_count + 1))
done <<< "$SUITES"
if [ "$picked_count" -eq 0 ]; then
  echo "No suite to run here: suites 1 to 15 need macOS and suite 16 needs Windows." >&2
  exit 2
fi

# Raven.app and Wren.app hold the web host ports their suites launch on.
if [ "$SYSTEM" = mac ]; then
  for pair in "4:$RAVEN_HOST_PORT:Raven" "5:$WREN_HOST_PORT:Wren"; do
    IFS=':' read -r number port app <<< "$pair"
    if is_picked "$number" mac && is_listening "$port"; then
      echo "Something listens on $port, most likely $app.app: quit it first, since suite $number launches $app there." >&2
      exit 1
    fi
  done
fi

LOGS="${TMPDIR:-/tmp}/maester-e2e-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOGS"
echo "Each suite's output goes to $LOGS"

RESULTS=''
failed=0
while IFS='|' read -r number system name script; do
  is_picked "$number" "$system" || continue
  log="$LOGS/$(printf '%02d' "$number")-${script//:/-}.log"
  result=failed
  started=$SECONDS
  try=1
  while [ "$try" -le "$TRIES" ]; do
    printf '\n=== %s. %s (bun run %s), try %s ===\n' "$number" "$name" "$script" "$try" | tee -a "$log"
    # stdin from /dev/null, so no suite reads the rest of this loop's list.
    if bun run "$script" "${CACHE_ARGS[@]}" < /dev/null 2>&1 | tee -a "$log"; then
      result=passed
      [ "$try" -gt 1 ] && result=flaky
      break
    fi
    try=$((try + 1))
  done
  minutes=$(((SECONDS - started + 59) / 60))
  [ "$result" = failed ] && failed=$((failed + 1))
  RESULTS="$RESULTS$number|$name|$result|$minutes|$log
"
done <<< "$SUITES"

printf '\n%-3s %-25s %-7s %5s  %s\n' '#' 'Suite' 'Result' 'Min' 'Log'
while IFS='|' read -r number name result minutes log; do
  [ -n "$number" ] || continue
  printf '%-3s %-25s %-7s %5s  %s\n' "$number" "$name" "$result" "$minutes" "$log"
done <<< "$RESULTS"

if [ "$failed" -gt 0 ]; then
  echo "$failed suite(s) failed. Run one again with its root script, as the log's first line names it." >&2
  exit 1
fi
echo 'Every suite passed.'
