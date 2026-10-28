---
name: board-sync
description: Use when the "maester roadmap" GitHub Project board (github.com/users/codebend3r/projects/1) may not match the issues. Triggers include "sync the board", "update the project", "move closed stories to Done", "what's in progress", "is the roadmap up to date", "tick the roadmap", "close the epic", after merging a PR that closes stories, or when a board item looks stale (closed issue still In Progress, finished epic still Todo, issue missing from the board, a closed story still unticked in docs/roadmap.md).
---

# Board sync

> [!IMPORTANT]
> The "maester roadmap" board was closed on 2026-10-27. Work is tracked as one GitHub Project per feature now (below). `sync_board.py` lists open boards only, so it would plan to create a new roadmap board: skip that step and apply only the issue and `docs/roadmap.md` steps.

## Feature projects

Each feature has its own project, and its pull requests are its stories: In Progress while open, Done once merged. `scripts/features.py` maps a PR's head branch to its feature, a `Feature: <name>` line in the PR body overrides that, and a PR matching neither becomes a feature of its own named after its title. Work with no PR yet goes in a feature's `stories` as a draft item.

- The `🗂️ Feature projects` workflow runs `scripts/sync_features.py --pr <n>` on every PR event, with the `PROJECTS_TOKEN` secret (a token with the `project` scope)
- To backfill or repair: `python3 scripts/sync_features.py` (open PRs and those merged in the last 5 days; `--days N`, `--dry-run`). It is idempotent
- A new feature: add it to `FEATURES` with its branch prefixes before opening its first PR, or put the `Feature:` line in the PR body

The rest of this skill covers the issues and `docs/roadmap.md`.

The issues and their PRs are the source of truth, and the board and the checkboxes in `docs/roadmap.md` follow them. The board's built-in workflows are on but miss transitions: PR #77 closed three stories and they stayed In Progress. Audit the board; don't trust the automation.

## Pick the tool

| What drifted                                                                                                      | Run                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Status, Epic/Phase/Size/Priority, an issue missing from the board, a finished epic still open, a roadmap checkbox | `scripts/sync_board.py`                                                                |
| An epic or story added, renamed, resized or reprioritized                                                         | Edit `scripts/catalog.py`, run `scripts/sync_tracker.py`, then `scripts/sync_board.py` |
| Board deleted or being rebuilt                                                                                    | `scripts/sync_board.py`, applying and re-auditing until it is clean                    |

A new story takes the next free key in its epic (`"key": "E3.12"`), never a renumbered one: the key is its issue's title prefix, so renumbering would hand an existing issue another story's text. `sync_tracker.py` renders epic checklists already ticked from the stories' issues, replaces stale priority, size and area labels, and leaves unchanged issues alone.

## Run it

1. Needs the `project` scope. On `missing required scopes [project]`, ask the user to run `! gh auth refresh -s project`
2. Audit: `uv run python scripts/sync_board.py`. It is read-only and saves the plan
3. Show the user the plan table and the "Needs a decision" list as printed, then ask which steps to apply. Closing an epic and editing its checklist change the issue itself, not just the board
4. Apply what they approved: `uv run python scripts/sync_board.py --apply` or `--apply --only 1,3`. Steps already done since the audit are skipped
5. Re-run the audit. An added issue gets its fields and status on this second pass. Stop when it prints `✓ board matches the issues`, or only flags remain. Rebuilding a deleted board takes three passes: the board, then its fields and items, then the items' fields
6. The roadmap step edits `docs/roadmap.md` in the working tree. Tell the user it needs committing, using `commit-format`

## What the audit checks

| Issue state                                                      | Board becomes                           |
| ---------------------------------------------------------------- | --------------------------------------- |
| Closed as completed                                              | Done                                    |
| Open with an open PR that closes it                              | In Progress                             |
| Epic with any story closed or In Progress                        | In Progress                             |
| Epic with every story closed                                     | Checklist ticked, issue closed, Done    |
| Open with no status                                              | Todo                                    |
| Title `[E3.1]`, milestone `M2 …`, labels `size:M`, `P0`          | Epic E3, Phase M2, Size M, Priority P0  |
| Issue in the repo but not on the board                           | Added                                   |
| No board titled "maester roadmap"                                | Created and linked to the repo          |
| A field missing from the board                                   | Created with the catalog's options      |
| Epic or story closed as completed, unticked in `docs/roadmap.md` | Roadmap re-rendered with its box ticked |

Only issue items are audited. PR and draft items on the board are left alone.

It flags these for the user and never changes them:

- **Open issue showing Done.** Reopened, or moved early? Ask whether to reopen the work or close the issue
- **Closed as not planned.** Ask whether to mark it Done or archive the item
- **Closed epic with open stories.** Ask whether the stories move to another epic or the epic reopens
- **A field option the board lacks** (a new epic `E9`, or milestone `M6`). The script creates missing fields but never edits an existing one, so ask the user to add the option in the board's field settings, then audit again
- **An epic body that differs from the catalog** beyond its ticks. Run `scripts/sync_tracker.py`, which owns the rest of the body

To answer "what's in progress" or "what's left", audit first so stale statuses aren't reported as fact, then read the board with `gh project item-list 1 --owner codebend3r --format json --limit 200`.

## Common mistakes

- **Setting Done on an open issue by hand.** The Auto-close issue workflow closes it. Close the issue instead, or let the script close the epic
- **Trusting the built-in workflows.** "Item closed" is enabled and still missed #10, #11 and #13
- **Ticking `docs/roadmap.md` by hand.** It is generated, so the next render overwrites it. Close the issue, then run the audit
- **Editing the board to change scope.** Board fields come from labels and milestones, so the next audit reverts them. Change the catalog or the labels instead

## Reporting back

In chat only, one line per applied step, as the script prints it: `✓ 2. #15 close the issue as completed` or `✓ 3. docs/roadmap.md re-render the checkboxes`. End with the audit's final line.
