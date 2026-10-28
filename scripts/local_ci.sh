#!/usr/bin/env bash
# What every ci_*.sh script shares, sourced by each (the device app's through
# local_ci_app.sh): they run a PR check from pull-request-checks.yml on this Mac,
# installing what is missing first, with every heavy step an Nx target. Sourcing it moves
# to the repo root, makes a temp folder ($WORK) and, when the script exits, runs its
# `cleanup` and prints $FAILURE_HINT on a failure.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# `xcodebuild -version` is in the Apple targets' Nx cache keys, and fails under the
# Command Line Tools that xcode-select may point at.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# shellcheck disable=SC2034  # read by the scripts that source this
WORK="$(mktemp -d "${TMPDIR:-/tmp}/raven-local-ci.XXXXXX")"
FAILURE_HINT=''

# Overridden by a script with something to stop on exit.
cleanup() { :; }

on_exit() {
  local status=$?
  cleanup
  if [ "$status" -ne 0 ] && [ -n "$FAILURE_HINT" ]; then
    echo "Failed. $FAILURE_HINT" >&2
  fi
}
trap on_exit EXIT

step() { printf '\n=== %s ===\n' "$1"; }

# brew_install <command> <formula>: installs the formula when the command is missing.
brew_install() {
  if ! command -v "$1" > /dev/null; then
    echo "Installing $2"
    brew install "$2"
  fi
}

require_apple_silicon() {
  test "$(uname -m)" = arm64 || { echo 'Needs a Mac with Apple silicon.' >&2; exit 1; }
}

# Xcode comes from the App Store, so its absence stops the script.
require_xcode() {
  xcodebuild -version > /dev/null 2>&1 || {
    echo "No Xcode at $DEVELOPER_DIR: install it from the App Store, open it once and accept the license." >&2
    exit 1
  }
}
