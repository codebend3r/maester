---
name: version-bump
description: Use when cutting a release or bumping maester's version, "bump the version", "cut a release", "tag a new version", "release a patch/minor/major", "tag v1.2.0". Bumps the version with semver, makes a "Release vX.Y.Z" commit and puts an annotated vX.Y.Z tag on that commit.
---

# Version bump

maester versions follow [semver 2.0.0](https://semver.org). The version lives in `VERSION` at the repo root and every release is one commit, `Release vX.Y.Z`, carrying an annotated tag `vX.Y.Z`. `scripts/bump_version.sh` does the whole thing; do not edit `VERSION` or create release tags by hand.

## Pick the bump

| Change since the last tag                                              | Bump    |
| ---------------------------------------------------------------------- | ------- |
| Breaking: removed or renamed a tool, env var, command or webhook shape  | `major` |
| New tool, command or behaviour that stays backward compatible           | `minor` |
| Fixes, prompt tweaks, docs, dependency bumps                            | `patch` |
| A prerelease or a specific number                                       | `X.Y.Z[-pre]` |

While the version is `0.y.z`, breaking changes may go in a `minor`. Read `git log $(git describe --tags --abbrev=0)..HEAD --oneline` (or the whole log when there is no tag yet) to decide, and say which bump you chose and why.

## Run it

1. Be on `main`, up to date, with a clean tree: `git switch main && git pull --rebase`.
2. Preview: `scripts/bump_version.sh --dry-run <major|minor|patch|X.Y.Z>`.
3. Release: `scripts/bump_version.sh <bump>`. Add `--push` to push the branch and the tag in the same step.
4. Verify: `git show --stat HEAD` shows only `VERSION` (and `pyproject.toml` if present) and `git describe --exact-match HEAD` prints the new tag.

## What the script guarantees

- The current version is read from `VERSION`, else the newest `vX.Y.Z` tag, else `0.0.0`.
- `patch` on a prerelease (`1.2.0-rc.1`) releases it (`1.2.0`) rather than skipping to `1.2.1`.
- It refuses a dirty tree, an invalid version, a version that does not move forward by semver precedence, and a tag that already exists. Nothing is written when it refuses.
- It warns when the branch is not the remote's default branch.
- When `pyproject.toml` has a `version = "..."` line, the first one (the `[project]` table) is updated in the same commit.

## Undo before pushing

```bash
git tag -d vX.Y.Z && git reset --hard HEAD~1
```

After a push, do not delete or move the tag; release the next patch instead.
