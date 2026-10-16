#!/usr/bin/env bash
# Netlify's build command (netlify.toml). Builds raven's web app with the
# version CI tagged on this commit, so the side menu shows X.Y.Z.N and not
# package.json's X.Y.Z, as it does in the image on Vhagar.
#
# CI tags a merge only after its smoke test passes, minutes after Netlify's own
# build of the push, so main-smoke-test.yml triggers a second build through the
# site's build hook once the tag exists. A build with no tag on its commit, the
# push's own or a deploy preview, leaves VITE_RAVEN_VERSION unset and shows
# package.json's version.
set -euo pipefail

# Netlify's clone may not carry tags.
git fetch --quiet --tags origin || echo "Could not fetch tags; building without a build number."

tag=$(git tag --points-at HEAD --list 'v[0-9]*.[0-9]*.[0-9]*.[0-9]*' | head -n 1)
if [ -n "$tag" ]; then
  export VITE_RAVEN_VERSION=${tag#v}
fi
echo "VITE_RAVEN_VERSION=${VITE_RAVEN_VERSION:-unset}"

exec bunx nx run @raven/web:build
