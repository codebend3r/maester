#!/usr/bin/env bash
# Builds raven's Release for the Apple TV simulator and shows its progress in brief: a line
# for each target as xcodebuild first reaches it, a line for each build script it runs, every
# error as it happens, then how it ended, with the end of the log when it failed. xcodebuild
# writes some 20,000 lines for this build, so the whole of it goes to a log and only those
# lines reach the terminal.
#
#   bun run app:build:tvos         through Nx, with its dependencies
#   bun run ci:app:tvos:build      the command the Apple TV check runs, without them
#
# Wren on TV's build (apps/wren/wren-tv/scripts/build_tvos.sh) runs this script too, naming its own
# folder and Xcode project through APP_DIR and APP_NAME.
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPTS/../../../.." && pwd)"
cd "${APP_DIR:-$SCRIPTS/..}"
APP_NAME="${APP_NAME:-Raven}"
# The app's folder from the repo root, for the paths it prints.
SHOWN_DIR="${PWD#"$REPO/"}"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
DERIVED=build/tvos
LOG="$DERIVED/xcodebuild.log"
APP="$DERIVED/Build/Products/Release-appletvsimulator/$APP_NAME.app"
# How much of the log's end a failed build prints, where xcodebuild lists what failed and why.
FAILURE_LINES="${BUILD_FAILURE_LINES:-100}"

elapsed() { printf '%dm %02ds' $((SECONDS / 60)) $((SECONDS % 60)); }

# What of xcodebuild's output is worth a line: a target the first time it is named
# ("... (in target 'X' from project 'Y')"), a script phase the first time it runs, and each
# distinct error, the linker's included.
brief() {
  awk '
    /error:|^ld: |^Undefined symbols/ {
      if (!said[$0]++) { print "  " $0; fflush() }
      next
    }
    /^PhaseScriptExecution / {
      phase = $0
      sub(/^PhaseScriptExecution /, "", phase)
      sub(/ \/.*/, "", phase)
      gsub(/\\/, "", phase)
      if (!ran[phase]++) { print "  script: " phase; fflush() }
    }
    match($0, /\(in target \047[^\047]+\047 from project/) {
      split(substr($0, RSTART, RLENGTH), parts, "\047")
      if (!built[parts[2]]++) { print "  [" ++targets "] " parts[2]; fflush() }
    }
  '
}

mkdir -p "$DERIVED"
echo "Building $APP_NAME for the Apple TV simulator (Release). Full log: $SHOWN_DIR/$LOG"

status=0
xcodebuild -workspace "ios/$APP_NAME.xcworkspace" -scheme "$APP_NAME" -configuration Release \
  -sdk appletvsimulator -destination 'generic/platform=tvOS Simulator' \
  -derivedDataPath "$DERIVED" ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO build 2>&1 | tee "$LOG" | brief || status=${PIPESTATUS[0]}

warnings=$(grep -c 'warning:' "$LOG" || true)

if ((status != 0)); then
  echo "Build failed after $(elapsed) (xcodebuild exited $status), with $warnings warnings in the log."
  echo "The last $FAILURE_LINES lines of the log:"
  tail -n "$FAILURE_LINES" "$LOG"
  echo "Full log: $SHOWN_DIR/$LOG"
  exit "$status"
fi

echo "Built in $(elapsed), with $warnings warnings in the log: $SHOWN_DIR/$APP"
