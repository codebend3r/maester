#!/usr/bin/env bash
# Fails a native prebuild when a package the app links is missing its patch in `patches/` as it
# stands now. bun applies a patch only when it installs the package, so a checkout that pulled a
# changed patch without running `bun install` keeps the old one, and the build compiles it with
# nothing to say so: an APK built that way had none of #436's player changes. A patch counts as
# applied when git can take it back out of the installed files (`git apply --check -R`).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd -P)"
REPO="$(git -C "$APP" rev-parse --show-toplevel)"
cd "$REPO"

stale=0
for patch in patches/*.patch; do
  file="${patch##*/}"
  name="${file%@*}"
  link="$APP/node_modules/$name"
  [ -e "$link" ] || continue
  installed="$(cd "$link" && pwd -P)"
  if ! git apply --check -R --directory="${installed#"$REPO"/}" "$patch" 2> /dev/null; then
    echo "$name in node_modules is missing $patch as it is now: run bun install from the repo root." >&2
    stale=1
  fi
done
exit "$stale"
