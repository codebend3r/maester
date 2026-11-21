#!/usr/bin/env bash
# Plans each native group for native-checks.yml's selection job, as lines for GITHUB_OUTPUT:
# whether to build it in this run, whether to run its end to end jobs, and which run and commit
# its builds are read from.
#
# Reads, per group (app, music, desktop): SELECTED_<group>, `true` when the commit affects it, and
# FOUND_<group>, `true` when the merged pull request's run holds every build its end to end jobs
# read. Also STAGE (`build` or `e2e`), THIS_RUN and THIS_SHA (this run and its commit), and
# FOUND_RUN and FOUND_SHA (the pull request's run and head commit, when one was found).
#
# A selected group that was found is not built again: its builds come from the pull request's run
# under its head commit. Any other selected group is built here and read from this run. The end to
# end jobs run for every selected group, in the `e2e` stage alone.
set -euo pipefail

for group in app music desktop; do
  selected="SELECTED_$group"
  found="FOUND_$group"
  build=false
  e2e=false
  run="$THIS_RUN"
  sha="$THIS_SHA"
  if [ "${!selected:-}" = true ]; then
    if [ "${!found:-}" = true ]; then
      run="$FOUND_RUN"
      sha="$FOUND_SHA"
    else
      build=true
    fi
    if [ "$STAGE" = e2e ]; then
      e2e=true
    fi
  fi
  echo "${group}_build=$build"
  echo "${group}_e2e=$e2e"
  echo "${group}_run=$run"
  echo "${group}_sha=$sha"
done
