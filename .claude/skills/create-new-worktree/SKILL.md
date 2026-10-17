---
name: create-new-worktree
description: Use when a new piece of maester work should start in its own git worktree cut from main: "create a worktree", "new worktree for X", "make me a worktree", "start X in a worktree", "spin up a worktree off main", or when a plan, spec step or stacked PR needs a checkout beside the main one. Not for opening a worktree on a branch that already exists.
argument-hint: <name>
---

# Create a new worktree

A new worktree gets a new branch, cut from fresh `origin/main`, in `.claude/worktrees/<name>`, with its own `node_modules` and the gitignored `.env` files the main checkout has, and it shows up in Supacode's sidebar before the procedure reports done. Anything less leaves a worktree that commits fine but cannot run `bunx nx`, a branch that starts from whatever the current checkout happened to be on, or a worktree the user cannot see in Supacode.

## Argument

`/create-new-worktree <name>` names both the directory and the branch: `/create-new-worktree critics-ratings-redesign` makes `.claude/worktrees/critics-ratings-redesign` on branch `critics-ratings-redesign`.

The argument given this time: `$ARGUMENTS`

- Given: use it as `name` in the procedure, unchanged. If it fails the name check below, say why and stop; do not quietly rewrite it.
- Empty: pick a name per the Name section from the work described, and say which name was chosen before creating anything.

## Where and from what

| Decision  | Value                                  | Why                                                                                                                                                               |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory | `.claude/worktrees/<name>`             | Gitignored (`.gitignore` lists it), shares `.git/hooks` with the main checkout so lefthook's hooks run, and it is where the harness's own worktree tool puts them |
| Branch    | `<name>`, same as the directory        | One name to remember; `git worktree list` reads cleanly (the older `offline-mode` worktree on branch `offline-state` predates this rule)                          |
| Base      | `origin/main`, right after `git fetch` | Local `main` and the current `HEAD` can both be stale or be a feature branch                                                                                      |
| Tracking  | none (`--no-track`)                    | Branching from `origin/main` otherwise sets `origin/main` as upstream, and a bare `git push` would push to main                                                   |

Supacode's worktree layout (`~/.supacode/repos/maester/<branch>`) is not used here; its free worktree quota is spent, so this repo's worktrees live under `.claude/worktrees/`.

## Name

Follow `creating-feature-branches`: one to six kebab-case words that describe the change, lowercase letters, digits and `-` only, no `feat/` or `fix/` prefix (this repo's branches use none). Examples already here: `direct-media-client`, `library-update-logic`.

## Procedure

Run from the main checkout (`/Users/snowball/Developer/git/maester`), not from inside another worktree. Run the block as one unit: the shell resets between tool calls, so the variables would be gone, and `set -e` stops the rest of the block at the first failing step.

```bash
set -e
name="$ARGUMENTS"   # the argument, or the name chosen per the Name section
root="$(git rev-parse --show-toplevel)"
dir="$root/.claude/worktrees/$name"

printf '%s' "$name" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+){0,5}$' || { echo "bad name"; exit 1; }
git show-ref --verify --quiet "refs/heads/$name" && { echo "branch exists"; exit 1; }
[ -e "$dir" ] && { echo "dir exists"; exit 1; }

git fetch origin main --quiet
git worktree add --no-track -b "$name" "$dir" origin/main

# gitignored per-product env files; each product reads its own beside its compose file
find "$root/apps" -maxdepth 2 \( -name .env -o -name .env.local \) -print | while read -r env; do
  cp "$env" "$dir/${env#"$root/"}"
done

( cd "$dir" && bun install --frozen-lockfile )

# Supacode does not reliably notice a worktree made with plain git; this makes it rescan the repo
supacode repo open "$root"
```

The variable is `dir`, not `path`: in zsh, `path` is the array bound to `PATH`, and assigning it leaves every following command "not found".

`bun install` runs lefthook's postinstall, which re-installs the hooks into the shared `.git/hooks`. That is harmless and expected.

`supacode repo open` is the step that puts the worktree in Supacode's sidebar. Supacode sometimes picks up a plain `git worktree add` on its own and sometimes still has not seconds later, so the procedure always forces the rescan instead of waiting to see. `supacode repo worktree-new` is not a substitute: it puts the worktree in `~/.supacode/repos/`, not in `.claude/worktrees/`. The command prints nothing on success. Outside a Supacode terminal, or in a sandbox that blocks its socket, it fails with "Operation not permitted" or cannot find the socket; then say so in the report and tell the user to run it themselves.

## Verify

```bash
dir="$(git rev-parse --show-toplevel)/.claude/worktrees/<name>"
git worktree list
git -C "$dir" status --short --branch
git -C "$dir" log --oneline origin/main..HEAD
git -C "$dir" config --get "branch.<name>.remote" || echo "no upstream, as intended"
( cd "$dir" && bunx nx show projects )
supacode worktree status -w "$(printf '%s/' "$dir" | sed 's|/|%2F|g')"
```

Expected: the new path is listed on branch `<name>`, status shows `## <name>` with nothing modified, the log is empty (no commits past `origin/main`), the branch has no remote, Nx lists every project, and Supacode answers `status=unpinned` with `archived=false` rather than `Worktree not found`. Supacode's worktree id is the absolute path with a trailing slash, percent-encoded (`%2FUsers%2F...%2Fmulti-select-fix%2F`), which is what the `sed` builds. Report the absolute path, the branch, and that Supacode lists it.

## Working in it

- If this session should continue inside the worktree, call `EnterWorktree` with `path` set to the new directory. It only enters worktrees that `git worktree list` knows, so create first, enter second.
- Run tasks from the worktree's root: `bunx nx run @raven/web:test`, `bun run affected`. Nx's cache under `.nx/` is per worktree, so the first run is uncached.
- `@raven/web`, `@raven/desktop` and the servers import `@raven/ui`, `@raven/core` and `@shared/server` through their `dist`, which a fresh worktree lacks. `build`, `typecheck`, `test` and `dev` declare `dependsOn: ["^build"]` in `nx.json`, so running them through Nx builds the libs first. A bare `tsc` or `vite` in a project folder fails until something has.
- `.env` files are copies. A later change to `apps/raven/.env` in the main checkout does not reach the worktree; copy it again.

## When not to use

- **The branch already exists.** `git worktree add "$dir" <branch>` (no `-b`), or `checkout-branches-as-worktrees` for all of them at once.
- **The work should stack on another branch** (one PR per spec step, see `stacked-prs-with-subagents`): base on that branch instead of `origin/main`, with `--no-track` still, and say so in the report.
- **The user asked for a branch, not a worktree.** `creating-feature-branches`.

## Common mistakes

| Mistake                                             | Fix                                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git worktree add -b name path` with no start point | Branches from the current `HEAD`, which may be a feature branch or stale `main`. Pass `origin/main` after a fetch.                                       |
| Leaving tracking on `origin/main`                   | `git push` would target main. Always `--no-track`; the first `git push -u origin <name>` sets the right upstream.                                        |
| Skipping `bun install`                              | `bunx nx`, `bunx lint-staged` and the lefthook hooks all need the worktree's own `node_modules`; the first commit fails inside the pre-commit hook.      |
| Forgetting the `.env` files                         | They are gitignored, so the worktree has none and the servers start without their config. The existing `offline-mode` worktree was created without them. |
| Putting it in `.worktrees/` or `~/.supacode/...`    | Neither is ignored here nor in use. `.claude/worktrees/` is.                                                                                             |
| Running the procedure from inside another worktree  | `--show-toplevel` then points at that worktree and the new one nests inside it. Start from the main checkout.                                            |
| Skipping `supacode repo open`                       | Supacode may never list the worktree, and `supacode worktree status` answers `Worktree not found`. Run `supacode repo open "$root"` and check again.     |
