---
name: get-started
description: Use when setting up maester on a new machine or fresh clone, onboarding to the repo, or when `bun run verify` (or the lefthook pre-push hook, which runs the same checks) fails on tasks nobody changed. Covers errors like "Failed to inspect Python interpreter", "Bad CPU type in executable", `Executable not found in $PATH: "ffmpeg"`, `uvx: command not found`, and a wrong Bun version.
---

# Get started

The goal is `bun run verify` exiting 0 from the repo root. It runs spellcheck, typescript-only, one-command-per-script, lint (Python, TypeScript, SCSS), format check, typecheck, test and build for every project.

A fresh clone that fails `verify` almost always has an environment problem, not a code problem. Fix the machine; don't edit source, configs or tests to make a check pass, and never skip the hooks.

## 1. Check the tools

| Tool               | Why                                                            | Check                                 | Install                                                      |
| ------------------ | -------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Bun                | Runs everything; must match `packageManager` in `package.json` | `bun --version`                       | `curl -fsSL https://bun.sh/install \| bash -s bun-v<pinned>` |
| uv / uvx           | Python lint, format and tests; `uvx typos` spellcheck          | `uv --version`                        | `brew install uv`                                            |
| Python 3.12        | `apps/luwin/api` pins `>=3.12,<3.13`; `scripts` uses its env   | `uv python find 3.12`                 | `uv python install 3.12`                                     |
| ffmpeg and ffprobe | `@raven/server` and `@raven/core` tests make real clips        | `ffmpeg -version && ffprobe -version` | `brew install ffmpeg`                                        |

Run `uv python install 3.12` even when some Python is on the PATH. uv only accepts 3.12, and it fails outright on a broken interpreter it meets while searching (see below), so a uv-managed 3.12 is the reliable fix.

## 2. Install and verify

```bash
bun install --frozen-lockfile   # deps, Nx, and the lefthook git hooks
bun run verify
```

A first run takes a minute or two. Nx caches results, so `bun run verify:uncached` reruns everything after an environment change.

## 3. Read the failure

Nx ends with a `Failed tasks:` list. Rerun just one to see its output: `bunx nx run <project>:<target> --skip-nx-cache` (for example `bunx nx run @luwin/api:lint:py --skip-nx-cache`).

| Symptom                                                                                              | Cause                                                                      | Fix                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@luwin/api` and `scripts` fail `lint:py`, `format:check` and `test` together                        | uv has no usable Python 3.12                                               | `uv python install 3.12`                                                    |
| `Failed to inspect Python interpreter ... /usr/local/bin/python3` / `Bad CPU type in executable`     | A leftover Intel Homebrew in `/usr/local` on Apple silicon without Rosetta | `uv python install 3.12`; optionally remove the stale `/usr/local` Homebrew |
| `Executable not found in $PATH: "ffmpeg"`, `spawn ffmpeg ENOENT` in `@raven/server` or `@raven/core` | ffmpeg not installed                                                       | `brew install ffmpeg`                                                       |
| `spellcheck` fails with `uvx: command not found`                                                     | uv not installed                                                           | `brew install uv`                                                           |
| Odd failures in many tasks at once, env values you didn't set                                        | A `.env` at the repo root; Nx loads it into every task                     | Move it to `apps/<product>/.env`                                            |
| `bun --version` differs from `packageManager` in `package.json`                                      | Wrong Bun installed                                                        | Install the pinned Bun                                                      |
| `format:check` or `lint:*` fails on files you edited                                                 | A real issue in your change                                                | `bun run format`, `bun run lint:fix`, then fix what remains by hand         |

`ECONNREFUSED ... :8484` stack traces in the test output are logged by passing tests. Ignore them unless that task is in `Failed tasks:`.

## Done

`bun run verify` ends with `Successfully ran targets ... for <N> projects` and exits 0. Report the exit code and the fixes you made.
