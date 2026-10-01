---
name: version-bump
description: Use when cutting a release or bumping a product's version in this workspace (maester today), "bump the version", "cut a release", "tag a new version", "release a patch/minor/major", "tag maester v1.2.0". Bumps the version with semver, makes a "Release <product> vX.Y.Z" commit and puts an annotated <product>-vX.Y.Z tag on that commit.
---

# Version bump

Each released product follows [semver 2.0.0](https://semver.org). Its version lives in `apps/<product>/VERSION`, and every release is one commit, `Release <product> vX.Y.Z`, carrying an annotated tag `<product>-vX.Y.Z`. `scripts/bump_version.sh` does the whole thing; do not edit `VERSION` or create release tags by hand. Only maester has a `VERSION` file today; the script refuses any product without one. Releases before the workspace move were tagged plain `vX.Y.Z`; those tags stay as they are.

## Pick the bump

| Change since the last tag                                              | Bump    |
| ---------------------------------------------------------------------- | ------- |
| Breaking: removed or renamed a tool, env var, command or webhook shape  | `major` |
| New tool, command or behaviour that stays backward compatible           | `minor` |
| Fixes, prompt tweaks, docs, dependency bumps                            | `patch` |
| A prerelease or a specific number                                       | `X.Y.Z[-pre]` |

While the version is `0.y.z`, breaking changes may go in a `minor`. Read `git log $(git describe --tags --abbrev=0 --match '<product>-v*' 2>/dev/null || git describe --tags --abbrev=0)..HEAD --oneline -- apps/<product>` (or the whole log when there is no tag yet) to decide, and say which bump you chose and why.

## Run it

1. Be on `main`, up to date, with a clean tree: `git switch main && git pull --rebase`.
2. Preview: `scripts/bump_version.sh --dry-run <product> <major|minor|patch|X.Y.Z>`.
3. Release: `scripts/bump_version.sh <product> <bump>`. Add `--push` to push the branch and the tag in the same step.
4. Verify: `git show --stat HEAD` shows only the product's `VERSION`, its `pyproject.toml` files and their `uv.lock`, and `git describe --exact-match HEAD` prints the new tag.

## What the script guarantees

- The current version is read from `apps/<product>/VERSION`; a product without one is refused.
- `patch` on a prerelease (`1.2.0-rc.1`) releases it (`1.2.0`) rather than skipping to `1.2.1`.
- It refuses a dirty tree, an invalid version, a version that does not move forward by semver precedence, and a tag that already exists. Nothing is written when it refuses.
- It warns when the branch is not the remote's default branch.
- Every `pyproject.toml` under the product gets its first `version = "..."` line (the `[project]` table) updated, and the project's own entry in the `uv.lock` beside it, in the same commit. The image reads its version from that metadata, so `--version` and `/health` follow.

## Undo before pushing

```bash
git tag -d <product>-vX.Y.Z && git reset --hard HEAD~1
```

After a push, do not delete or move the tag; release the next patch instead.
