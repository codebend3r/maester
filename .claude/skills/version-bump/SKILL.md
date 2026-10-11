---
name: version-bump
description: Use when cutting a release or bumping the version in this workspace, "npm version minor", "npm version patch", "npm version major", "bump the version", "cut a release", "tag a new version", "release a patch/minor/major", "tag v1.2.0". Every app, lib and API shares one semver version; bumps all of them, makes a "Release vX.Y.Z" commit and puts an annotated vX.Y.Z tag on that commit.
---

# Version bump

The workspace follows [semver 2.0.0](https://semver.org) with one version for everything: every app, lib and API (luwin, raven, rookery, `@raven/core`, and any project added later) carries the same number. Every release is one commit, `Release vX.Y.Z`, carrying an annotated tag that is exactly `vX.Y.Z`. A tag never names a product: no `luwin-v0.4.0`, no `raven-v1.0.0`.

`scripts/bump_version.sh` does the whole thing. `npm version` does not work here (the root `package.json` has no version and does not know about the Python projects), so when asked for `npm version <bump>`, run this script instead. Never edit versions or create release tags by hand.

Older `maester-vX.Y.Z` tags stay as they are; the line continues from the latest `vX.Y.Z` tag.

## Pick the bump

| Change since the last tag                                                    | Bump          |
| ---------------------------------------------------------------------------- | ------------- |
| Breaking: removed or renamed a tool, env var, command, endpoint or API shape | `major`       |
| New tool, command, endpoint or behaviour that stays backward compatible      | `minor`       |
| Fixes, prompt tweaks, docs, dependency bumps                                 | `patch`       |
| A prerelease or a specific number                                            | `X.Y.Z[-pre]` |

While the version is `0.y.z`, breaking changes may go in a `minor`. A literal request such as `npm version minor` already names the bump; use it. Otherwise read `git log $(git describe --tags --abbrev=0 --match 'v[0-9]*')..HEAD --oneline -- apps libs` to decide, and say which bump you chose and why.

## Run it

1. Be on `main`, up to date, with a clean tree and the tags fetched: `git switch main && git pull --rebase --tags`.
2. Preview: `scripts/bump_version.sh --dry-run <major|minor|patch|X.Y.Z>`.
3. Release: `scripts/bump_version.sh <bump>`. Add `--push` only when asked to push; it pushes the branch and the tag in the same step.
4. Verify: `git show --stat HEAD` shows every `package.json` under `apps/` and `libs/`, `bun.lock`, each `apps/<product>/VERSION`, each `pyproject.toml` and its `uv.lock`, and nothing else; `git describe --exact-match HEAD` prints `vX.Y.Z`.

## What the script guarantees

- The current version is the latest `vX.Y.Z` tag reachable from HEAD; it refuses to run when there is none.
- Every tracked `apps/*/*/package.json` and `libs/*/*/package.json` gets the new top-level `version`, and its workspace entry in `bun.lock` follows, so `bun install --frozen-lockfile` still passes. A project whose version had drifted (rookery was `0.1.0` before `v0.4.0`) is pulled onto the shared version.
- Every `apps/<product>/VERSION` gets the new version (the luwin smoke test reads it).
- Every `pyproject.toml` under `apps/` and `libs/` gets its first `version = "..."` line (the `[project]` table) updated, and the project's own entry in the `uv.lock` beside it. The luwin image reads its version from that metadata, so `--version` and `/health` follow.
- `patch` on a prerelease (`1.2.0-rc.1`) releases it (`1.2.0`) rather than skipping to `1.2.1`.
- It refuses a dirty tree, an invalid version, a version that does not move forward by semver precedence, and a tag that already exists. Nothing is written when it refuses.
- It warns when the branch is not the remote's default branch.

## Undo before pushing

```bash
git tag -d vX.Y.Z && git reset --hard HEAD~1
```

After a push, do not delete or move the tag; release the next patch instead.
