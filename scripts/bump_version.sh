#!/usr/bin/env bash
# Bump the workspace version with semver, commit the bump and tag that commit.
#
#   scripts/bump_version.sh patch            # 0.3.1 -> 0.3.2
#   scripts/bump_version.sh minor            # 0.3.1 -> 0.4.0
#   scripts/bump_version.sh major            # 0.3.1 -> 1.0.0
#   scripts/bump_version.sh 1.0.0-rc.1       # explicit version
#   scripts/bump_version.sh build            # 0.3.1.4 -> 0.3.1.5, a tag and no commit
#   scripts/bump_version.sh --dry-run minor  # show the plan, change nothing
#   scripts/bump_version.sh --print build    # print the next version, change nothing
#   scripts/bump_version.sh --push patch     # also push the commit and tag, in one push
#
# Every app, lib and API shares one version. The current one is the latest
# vX.Y.Z tag reachable from HEAD. The bump writes it to every package.json
# under apps/ and libs/ (and their bun.lock entries), every apps/<product>/VERSION,
# and the [project] version of every pyproject.toml (and its uv.lock entry),
# commits it as "Release vX.Y.Z" and puts an annotated vX.Y.Z tag on it.
#
# `build` is CI's, run after every merge into main: it tags HEAD vX.Y.Z.N, the
# Nth build of X.Y.Z, and writes nothing, since four numbers are not semver and
# the files stay at X.Y.Z. N is the number of commits on main since vX.Y.Z, so
# merges that build at the same time each get their own; a number whose tag sits
# on a commit main lost to a force push is skipped. A build tag counts as its
# X.Y.Z, so the next bump drops the build number: 0.3.1.5 patch -> 0.3.2.
set -euo pipefail

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
# Exactly four numbers; a prerelease has a `-`, so it never looks like a build.
BUILD_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.[1-9][0-9]*$'

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() { echo "✗ $*" >&2; exit 1; }

dry_run=0
print=0
push=0
target=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --print) print=1 ;;
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
[[ $current =~ $BUILD_RE ]] && current=${current%.*}
[[ $current =~ $SEMVER_RE ]] || die "latest tag '$last_tag' is not valid semver"
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]} pre=${BASH_REMATCH[4]}

case "$target" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch)
    # Releasing a prerelease: 1.2.0-rc.1 patch -> 1.2.0
    if [ -n "$pre" ]; then next="$major.$minor.$patch"; else next="$major.$minor.$((patch + 1))"; fi
    ;;
  build)
    [ "$current" = "$major.$minor.$patch" ] || die "$current is a prerelease; only X.Y.Z releases get builds"
    # The merges on top of the release, not the tags already pushed, so a
    # commit's build number is the same whatever order its runs finish in.
    merges=$(git rev-list --count --first-parent "v$current..HEAD" 2>/dev/null) \
      || die "v$current is not reachable from HEAD; run git fetch --tags"
    next="$current.$merges"
    ;;
  *)
    next=${target#v}
    [[ $next =~ $SEMVER_RE ]] || die "'$target' is not major, minor, patch, build or a semver version"
    ;;
esac

if [ "$target" = build ]; then
  # One version per commit: a release commit already has its own.
  on_head=$(git tag --points-at HEAD --list 'v[0-9]*' | tr '\n' ' ')
  [ -z "$on_head" ] || die "HEAD is already tagged ${on_head% }"
  # A force push to main can leave a build tag on a commit main no longer has,
  # holding the number this commit counts to. Step past it, so the rewrite
  # costs a skipped number instead of a failed build.
  while orphan=$(git rev-parse -q --verify "refs/tags/v$next^{commit}") \
    && ! git merge-base --is-ancestor "$orphan" HEAD; do
    echo "! v$next is on $(git rev-parse --short "$orphan"), which HEAD does not contain; skipping it" >&2
    next="$current.$((${next##*.} + 1))"
  done
else
  [ "$(compare "$next" "$current")" = 1 ] || die "$next does not move forward from $current"
fi
tag="v$next"
title="Release v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
if ((print)); then
  echo "$next"
  exit 0
fi
[ -z "$(git status --porcelain)" ] || die "working tree is not clean; commit or stash first"

branch=$(git symbolic-ref --short -q HEAD || echo "(detached)")
default=$(git symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
if [ -n "$default" ] && [ "$branch" != "$default" ]; then
  echo "! releasing from $branch, not $default"
fi

echo "→ $current -> $next on $branch"
if [ "$target" = build ]; then
  if ((dry_run)); then
    echo "  would tag $(git rev-parse --short HEAD) $tag, with no commit"
    ((push)) && echo "  would push $tag"
    exit 0
  fi
  git tag -a "$tag" -m "$title"
  echo "✓ tagged $(git rev-parse --short HEAD) $tag"
  if ((push)); then
    git push -q origin "refs/tags/$tag"
    echo "✓ pushed $tag"
  else
    echo "  push with: git push origin $tag"
  fi
  exit 0
fi

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
  # Together, so main never has the release commit without its tag: CI reads
  # a "Release vX.Y.Z" commit as yours and releases that tag.
  git push -q --atomic origin "$branch" "refs/tags/$tag"
  echo "✓ pushed $branch and $tag"
else
  echo "  push with: git push --atomic origin $branch $tag"
fi
