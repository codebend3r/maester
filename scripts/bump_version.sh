#!/usr/bin/env bash
# Bump the project version with semver, commit the bump and tag that commit.
#
#   scripts/bump_version.sh patch            # 0.3.1 -> 0.3.2
#   scripts/bump_version.sh minor            # 0.3.1 -> 0.4.0
#   scripts/bump_version.sh major            # 0.3.1 -> 1.0.0
#   scripts/bump_version.sh 1.0.0-rc.1       # explicit version
#   scripts/bump_version.sh --dry-run minor  # show the plan, change nothing
#   scripts/bump_version.sh --push patch     # also push the commit and tag
#
# The current version comes from VERSION, else the newest vX.Y.Z tag, else
# 0.0.0. The bump writes VERSION (and the [project] version in pyproject.toml
# when there is one), commits it as "Release vX.Y.Z" and puts an annotated
# vX.Y.Z tag on that commit.
set -euo pipefail

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
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
    *) [ -z "$target" ] || die "only one bump target allowed"; target=$arg ;;
  esac
done
[ -n "$target" ] || usage 1

root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$root"

current_version() {
  if [ -f VERSION ]; then
    tr -d '[:space:]' < VERSION
    return
  fi
  local tag
  tag=$(git tag --list 'v[0-9]*' --sort=-v:refname | head -1)
  if [ -n "$tag" ]; then echo "${tag#v}"; else echo "0.0.0"; fi
}

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

current=$(current_version)
[[ $current =~ $SEMVER_RE ]] || die "current version '$current' is not valid semver"
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
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean; commit or stash first"

branch=$(git symbolic-ref --short -q HEAD || echo "(detached)")
default=$(git symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
if [ -n "$default" ] && [ "$branch" != "$default" ]; then
  echo "! releasing from $branch, not $default"
fi

echo "→ $current -> $next on $branch"
if ((dry_run)); then
  echo "  would write VERSION$([ -f pyproject.toml ] && echo ' and pyproject.toml')"
  echo "  would commit \"Release $tag\" and tag it $tag"
  ((push)) && echo "  would push $branch and $tag"
  exit 0
fi

echo "$next" > VERSION
git add VERSION
if [ -f pyproject.toml ] && grep -q '^version = ' pyproject.toml; then
  # Only the first match, which is the [project] table's version.
  awk -v v="$next" '!done && /^version = / { print "version = \"" v "\""; done = 1; next } { print }' \
    pyproject.toml > pyproject.toml.tmp && mv pyproject.toml.tmp pyproject.toml
  git add pyproject.toml
fi

git commit -q -m "Release $tag"
git tag -a "$tag" -m "Release $tag"
echo "✓ committed $(git rev-parse --short HEAD) and tagged $tag"

if ((push)); then
  git push -q origin "$branch"
  git push -q origin "$tag"
  echo "✓ pushed $branch and $tag"
else
  echo "  push with: git push origin $branch && git push origin $tag"
fi
