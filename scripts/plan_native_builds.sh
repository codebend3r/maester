#!/usr/bin/env bash
# Plans each native group for the raven-native-select action, as lines for GITHUB_OUTPUT:
# whether the commit selected it, whether to build it in this run, and which run and commit its
# builds are read from.
#
# Reads, per group (app, music, desktop): SELECTED_<group>, `true` when the commit affects it, and
# FOUND_<group>, `true` when the merged pull request's run holds every build main's flows read.
# Also THIS_RUN and THIS_SHA (this run and its commit), and FOUND_RUN and FOUND_SHA (the pull
# request's run and head commit, when one was found).
#
# A selected group that was found is not built again: its builds come from the pull request's run
# under its head commit. Any other selected group is planned as one to build, read from this run;
# main builds nothing, so its end to end job fails on that, saying so.
set -euo pipefail

for group in app music desktop; do
  selected="SELECTED_$group"
  found="FOUND_$group"
  is_selected=false
  build=false
  run="$THIS_RUN"
  sha="$THIS_SHA"
  if [ "${!selected:-}" = true ]; then
    is_selected=true
    if [ "${!found:-}" = true ]; then
      run="$FOUND_RUN"
      sha="$FOUND_SHA"
    else
      build=true
    fi
  fi
  echo "${group}_selected=$is_selected"
  echo "${group}_build=$build"
  echo "${group}_run=$run"
  echo "${group}_sha=$sha"
done
