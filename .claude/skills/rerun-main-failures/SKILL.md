---
name: rerun-main-failures
description: Use when asked to re-run the failed or cancelled GitHub Actions jobs on main, "rerun the cancelled jobs", "rerun the failed jobs on main", "retry main's CI", "kick main's native checks again", or after a main run went red because macOS runners were never acquired. Main only; never for a pull request branch or a feature branch.
---

# Re-run main's failed jobs

Main's workflows run on every merge: `🚀 Main smoke test and release` (`main-smoke-test.yml`), `E2E Tests` (`e2e-tests.yml`) and `🗃️ App build caches` (`app-caches.yml`). Native checks has been the usual red one, and often not because of a test: its macOS jobs (`runs-on: macos-26`) wait for a hosted runner, and when GitHub has no macOS arm64 capacity the job is cancelled with "The job was not acquired by Runner of type hosted even after multiple attempts". Those jobs never ran, so re-running them is the fix.

This skill touches main's runs only. For a PR's checks, use `fix-ci-until-green`.

## 1. List main's latest runs

```sh
gh run list --branch main --limit 10 \
  --json databaseId,workflowName,status,conclusion,headSha,displayTitle \
  --template '{{range .}}{{.databaseId}}	{{.workflowName}}	{{.status}}	{{.conclusion}}	{{slice .headSha 0 9}}	{{.displayTitle}}{{"\n"}}{{end}}'
```

Take the runs for the newest `headSha` only. An older commit's red run is history; re-running it proves nothing about main today. Skip a run whose `status` is not `completed`: GitHub refuses to re-run a run that is still going.

## 2. Check the run is main's and see why it failed

```sh
gh run view <id> --json headBranch,event --jq '"\(.headBranch) \(.event)"'   # must print "main push"
gh run view <id> --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"'
gh run view <id> | sed -n '/ANNOTATIONS/,$p' | head -30
```

Stop if `headBranch` is not `main`. Then sort the jobs:

- **Cancelled, with the "not acquired by Runner" annotation:** the runner never came. Re-run.
- **Cancelled, with no such annotation:** collateral from another job's failure (a failing native job cancels the rest). Find the job that actually failed.
- **Failed:** read `gh run view <id> --log-failed | grep -iE "error|fail" | tail -40` before re-running. A flaky flow (emulator focus, an adb daemon that did not start) is worth one re-run; a real assertion or build error is a bug to report, and re-running it only burns minutes.

## 3. Re-run

```sh
gh run rerun <id> --failed
```

`--failed` re-runs every failed and cancelled job in the run, plus the jobs that depend on them, and leaves the passed jobs alone. Never re-run the whole run (`gh run rerun <id>` with no flag) unless asked: it repeats the jobs that already passed.

## 4. Report

Say which run IDs and jobs were re-run and why (no runner, flaky, or deliberately left alone). Then follow the re-run with `gh run watch <id> --exit-status` in the background, or tell the user to check `gh run view <id>` later. The macOS jobs can sit in the queue for most of their 15 minutes when capacity is short, so a second "not acquired" cancel is GitHub, not the code; say so rather than re-running in a loop. Re-run at most once more without asking.
