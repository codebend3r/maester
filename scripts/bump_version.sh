#!/usr/bin/env bash
# Bump the workspace version with semver, commit the bump and tag that commit.
#
#   scripts/bump_version.sh patch            # 0.3.1 -> 0.3.2
#   scripts/bump_version.sh minor            # 0.3.1 -> 0.4.0
#   scripts/bump_version.sh major            # 0.3.1 -> 1.0.0
#   scripts/bump_version.sh 1.0.0-rc.1       # explicit version
#   scripts/bump_version.sh --dry-run minor  # show the plan, change nothing
#   scripts/bump_version.sh --push patch     # also push the commit and tag
#
# Every app, lib and API shares one version. The current one is the latest
# vX.Y.Z tag reachable from HEAD. The bump writes it to every package.json
# under apps/ and libs/ (and their bun.lock entries), every apps/<product>/VERSION,
# and the [project] version of every pyproject.toml (and its uv.lock entry),
# commits it as "Release vX.Y.Z" and puts an annotated vX.Y.Z tag on it.
set -euo pipefail

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() { echo "✗ $*" >&2; exit 1; }

dry_run=0
push=0
target=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --push) push=1 ;;
    -h|--help) usage 0 ;;
    -*) die "unknown flag: $arg" ;;
    *)
      [ -z "$target" ] || die "expected one bump target"
      target=$arg
      ;;
  esac
done
[ -n "$target" ] || usage 1

root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$root"

# Every project of the workspace, as tracked files.
package_jsons() { git ls-files 'apps/*/*/package.json' 'libs/*/*/package.json'; }
version_files() { git ls-files 'apps/*/VERSION' 'libs/*/VERSION'; }
pyprojects() { git ls-files 'apps/**/pyproject.toml' 'libs/**/pyproject.toml'; }

# Precedence per semver 2.0.0 section 11: core numbers, then a release beats a
# prerelease, then prerelease identifiers left to right. Build metadata is
# ignored. Prints -1, 0 or 1.
compare() {
  local a=${1%%+*} b=${2%%+*}
  local a_core=${a%%-*} b_core=${b%%-*}
  local a_pre="" b_pre=""
  [ "$a" != "$a_core" ] && a_pre=${a#*-}
  [ "$b" != "$b_core" ] && b_pre=${b#*-}

  local -a ac bc ap bp
  IFS=. read -ra ac <<< "$a_core"
  IFS=. read -ra bc <<< "$b_core"
  for i in 0 1 2; do
    if ((10#${ac[i]} > 10#${bc[i]})); then echo 1; return; fi
    if ((10#${ac[i]} < 10#${bc[i]})); then echo -1; return; fi
  done

  if [ -z "$a_pre" ] && [ -z "$b_pre" ]; then echo 0; return; fi
  if [ -z "$a_pre" ]; then echo 1; return; fi
  if [ -z "$b_pre" ]; then echo -1; return; fi

  IFS=. read -ra ap <<< "$a_pre"
  IFS=. read -ra bp <<< "$b_pre"
  local n=${#ap[@]}
  ((${#bp[@]} > n)) && n=${#bp[@]}
  for ((i = 0; i < n; i++)); do
    local x=${ap[i]-} y=${bp[i]-}
    if [ -z "$x" ]; then echo -1; return; fi
    if [ -z "$y" ]; then echo 1; return; fi
    [ "$x" = "$y" ] && continue
    if [[ $x =~ ^[0-9]+$ && $y =~ ^[0-9]+$ ]]; then
      if ((10#$x > 10#$y)); then echo 1; else echo -1; fi
    elif [[ $x =~ ^[0-9]+$ ]]; then echo -1
    elif [[ $y =~ ^[0-9]+$ ]]; then echo 1
    elif [[ $x > $y ]]; then echo 1
    else echo -1
    fi
    return
  done
  echo 0
}

last_tag=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null) \
  || die "no vX.Y.Z tag reachable from HEAD; run git fetch --tags or pass an explicit version"
current=${last_tag#v}
[[ $current =~ $SEMVER_RE ]] || die "latest tag '$last_tag' is not valid semver"
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]} pre=${BASH_REMATCH[4]}

case "$target" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch)
    # Releasing a prerelease: 1.2.0-rc.1 patch -> 1.2.0
    if [ -n "$pre" ]; then next="$major.$minor.$patch"; else next="$major.$minor.$((patch + 1))"; fi
    ;;
  *)
    next=${target#v}
    [[ $next =~ $SEMVER_RE ]] || die "'$target' is not major, minor, patch or a semver version"
    ;;
esac

[ "$(compare "$next" "$current")" = 1 ] || die "$next does not move forward from $current"
tag="v$next"
title="Release v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean; commit or stash first"

branch=$(git symbolic-ref --short -q HEAD || echo "(detached)")
default=$(git symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
if [ -n "$default" ] && [ "$branch" != "$default" ]; then
  echo "! releasing from $branch, not $default"
fi

echo "→ $current -> $next on $branch"
if ((dry_run)); then
  for p in $(package_jsons); do echo "  would write $p ($(jq -r '.version // "no version"' "$p"))"; done
  [ -f bun.lock ] && echo "  would write bun.lock"
  for v in $(version_files); do echo "  would write $v"; done
  for p in $(pyprojects); do echo "  would write $p$([ -f "$(dirname "$p")/uv.lock" ] && echo " and its uv.lock")"; done
  echo "  would commit \"$title\" and tag it $tag"
  ((push)) && echo "  would push $branch and $tag"
  exit 0
fi

for p in $(package_jsons); do
  grep -q '^  "version": ' "$p" || die "$p has no top-level \"version\""
  # Only the first match, which is the top-level field.
  awk -v v="$next" '!done && /^  "version": / { sub(/"version": "[^"]*"/, "\"version\": \"" v "\""); done = 1 } { print }' \
    "$p" > "$p.tmp" && mv "$p.tmp" "$p"
  git add "$p"
  if [ -f bun.lock ]; then
    # The workspace entry is keyed by the project's folder; its version line
    # comes right after its name.
    awk -v key="    \"$(dirname "$p")\": {" -v v="$next" '
      $0 == key { inside = 1 }
      inside && /^      "version": / { sub(/"version": "[^"]*"/, "\"version\": \"" v "\""); inside = 0 }
      inside && /^    }/ { inside = 0 }
      { print }
    ' bun.lock > bun.lock.tmp && mv bun.lock.tmp bun.lock
  fi
done
[ -f bun.lock ] && git add bun.lock

for v in $(version_files); do
  echo "$next" > "$v"
  git add "$v"
done

for p in $(pyprojects); do
  grep -q '^version = ' "$p" || continue
  # Only the first match, which is the [project] table's version.
  awk -v v="$next" '!done && /^version = / { print "version = \"" v "\""; done = 1; next } { print }' \
    "$p" > "$p.tmp" && mv "$p.tmp" "$p"
  git add "$p"
  lock="$(dirname "$p")/uv.lock"
  if [ -f "$lock" ]; then
    # The project's own entry is the one installed from "."; its version line
    # sits just above that source line.
    awk -v v="$next" '
      { line[NR] = $0 }
      /^source = \{ editable = "\." \}$/ && line[NR - 1] ~ /^version = / { line[NR - 1] = "version = \"" v "\"" }
      END { for (i = 1; i <= NR; i++) print line[i] }
    ' "$lock" > "$lock.tmp" && mv "$lock.tmp" "$lock"
    git add "$lock"
  fi
done

git commit -q -m "$title"
git tag -a "$tag" -m "$title"
echo "✓ committed $(git rev-parse --short HEAD) and tagged $tag"

if ((push)); then
  git push -q origin "$branch"
  git push -q origin "$tag"
  echo "✓ pushed $branch and $tag"
else
  echo "  push with: git push origin $branch && git push origin $tag"
fi
