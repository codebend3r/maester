---
name: rebase-stack
description: >-
  Use when stacked PR branches in maester need to move onto the latest origin/main: "rebase these stacked branches against origin/main", "restack", "the bottom of my stack merged", "rebase the stack and push", "fix the stack's conflicts". Finds the stack from the open PRs' base branches, rebases each branch onto the one below it (the bottom onto origin/main), resolves conflicts, verifies, and force-pushes the whole stack with `--force-with-lease`. Not for rebasing every unrelated branch; use `rebase-everything-against-main` for that.
---

# Rebase a stack onto origin/main

Do the whole job without check-ins: rebase, resolve conflicts, verify, push. Report what changed at the end.

## 1. Find the stack

```bash
git fetch --prune origin
gh pr list --state all --limit 30 --json number,headRefName,baseRefName,state
```

- Walk `baseRefName` links from the branch the user named (or the current branch) down to `main`. Each open PR whose base is another open PR's head is one layer.
- A PR already `MERGED` is not a layer. Drop it. When the bottom merged, the next layer's PR base must become `main` (`gh pr edit <n> --base main`, after the push).
- Note every branch's current tip before touching anything: `git rev-parse <branch>`. `rebase --onto` needs the old tip of the layer below.

## 2. Rebase bottom up

Bottom layer:

```bash
git checkout <bottom> && git rebase origin/main
```

Each layer above, with `<old-parent-tip>` noted in step 1:

```bash
git checkout <layer> && git rebase --onto <parent> <old-parent-tip> <layer>
```

Work on a temp branch (`git checkout -q -B <layer>-new <tip>`) when a layer may need commits skipped, then move the real branch with `git branch -f`.

## 3. Resolve conflicts

- Read `git diff` for the conflict before choosing. Keep both sides when both add imports or members; keep one when they restate the same thing.
- macOS `sed -i` needs `-i ''`, and BSD sed has no `\b`; use `perl -pi -e` for word boundaries.
- Main moves fast on shared conventions (constants for identifiers, `@/` imports, no dashes). A layer commit that does the same refactor main already landed under other names is superseded: `git rebase --skip` it, then typecheck, because later commits may still use the old names.
- Never leave conflict markers: `git grep -n '<<<<<<<\|>>>>>>>'` before `git add`.
- `GIT_EDITOR=true git rebase --continue` avoids the editor.
- Never use `git stash` in a worktree agent, and never `--no-verify`.

## 4. Verify before pushing

```bash
bunx nx run-many -t typecheck lint:ts test -p <the touched projects and their dependents>
```

Run it on the top layer; a green top covers the layers below for typecheck, and rerun on a lower layer if a fix touched it.

## 5. Push the stack

```bash
git push --force-with-lease origin <bottom> <next> <top>
```

One push, every layer. The pre-push hook runs the checks, then the CLAUDE.md audit, which reads the pushed commits against `CLAUDE.md` and reports one batch of violations per run.

- A rebase can surface violations from code that was merged before the audit existed (string literals for identifiers, non-predicate booleans, header and query key literals, literal route paths). Fix each in a small `MAE:` commit on the top layer, then push again; repeat until the audit says the diff follows CLAUDE.md.
- A failed `format check` can come from an untracked, gitignored folder such as `graphify-out/` that root `oxfmt --check .` still scans; run `bunx oxfmt <folder>` on it.
- After the push, `git fetch` and compare `git rev-parse origin/<branch>` with the local tip for each layer to confirm it landed.
- Commit messages follow `commit-format` (`MAE:` prefix, no attribution).

## 6. Report

List each layer with its old and new tip, the conflicts and how they were resolved, the commits skipped as superseded, and any follow-up commits the audit forced.
